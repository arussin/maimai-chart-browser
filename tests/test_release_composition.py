"""Explicit byte ownership is necessary, but never sufficient for rollout safety."""

import itertools
import unittest
from dataclasses import FrozenInstanceError, asdict, replace

from maimai_intelligence.release_composition import (
    MAX_FILE_BYTES,
    MAX_FILES,
    ArtifactInventory,
    InventoryFile,
    PathOwnership,
    RuntimeClosure,
    inventory_from_records,
    plan_release_composition,
)
from maimai_intelligence.release_transition import Fingerprint


def record(digest="a", size=5):
    return {"bytes": size, "sha256": digest * 64}


class ReleaseCompositionTests(unittest.TestCase):
    def setUp(self):
        self.old = inventory_from_records(
            {
                "index.html": record("a"),
                "old.js": record("b"),
                "shared.css": record("c"),
                "manifest.json": record("d"),
            }
        )
        self.new = inventory_from_records(
            {
                "index.html": record("e"),
                "new.js": record("f"),
                "shared.css": record("c"),
                "manifest.json": record("0"),
            }
        )
        self.old_runtime = RuntimeClosure(
            "1" * 64,
            tuple(file for file in self.old.files if file.path in ("old.js", "shared.css")),
        )
        self.new_runtime = RuntimeClosure(
            "2" * 64,
            tuple(file for file in self.new.files if file.path in ("new.js", "shared.css")),
        )

    def choices(self, target="candidate", old=None, new=None):
        sources = {"baseline": old or self.old, "candidate": new or self.new}
        records = {
            name: {file.path: file.fingerprint for file in value.files}
            for name, value in sources.items()
        }
        choices = []
        for path in sorted(records["baseline"].keys() | records["candidate"].keys()):
            owner = "candidate" if path in records["candidate"] else "baseline"
            if path == "index.html" and target == "recovery":
                owner = "baseline"
            choices.append(PathOwnership(path, owner, records[owner][path], "Reviewed selection"))
        return tuple(choices)

    def plan(self, **options):
        target = options.pop("target", "candidate")
        return plan_release_composition(
            options.pop("baseline", self.old),
            options.pop("candidate", self.new),
            target=target,
            ownership=options.pop("ownership", self.choices(target)),
            baseline_runtime=options.pop("baseline_runtime", self.old_runtime),
            candidate_runtime=options.pop("candidate_runtime", self.new_runtime),
            **options,
        )

    def test_all_paths_and_all_collisions_have_explicit_owners(self):
        result = self.plan()
        self.assertEqual(result.file_count, 5)
        self.assertEqual(result.max_files, MAX_FILES)
        self.assertEqual(result.max_file_bytes, MAX_FILE_BYTES)
        self.assertEqual(result.total_bytes, 25)
        self.assertEqual(
            tuple(file.path for file in result.files),
            ("index.html", "manifest.json", "new.js", "old.js", "shared.css"),
        )
        self.assertEqual(
            [(item.path, item.differs) for item in result.collisions],
            [("index.html", True), ("manifest.json", True), ("shared.css", False)],
        )
        self.assertEqual(result.scope, "declared_file_composition_only")
        self.assertNotIn("safe", asdict(result))
        self.assertNotIn("deployable", asdict(result))
        self.assertEqual(result.baseline_observations_sha256, "1" * 64)
        self.assertEqual(result.candidate_observations_sha256, "2" * 64)
        self.assertNotEqual(result.baseline_inventory_sha256, result.candidate_inventory_sha256)

    def test_recovery_document_is_exactly_owned_by_baseline(self):
        result = self.plan(target="recovery")
        self.assertEqual(result.files[0].owner, "baseline")
        self.assertEqual(result.files[0].expected, self.old.files[0].fingerprint)
        for target, wrong in (
            ("recovery", self.choices()),
            ("candidate", self.choices("recovery")),
        ):
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "document owner"):
                self.plan(target=target, ownership=wrong)

    def test_identical_bytes_still_require_an_owner_and_no_path_can_be_dropped(self):
        for dropped in self.choices():
            with (
                self.subTest(path=dropped.path),
                self.assertRaisesRegex(ValueError, "Every input path"),
            ):
                self.plan(ownership=tuple(item for item in self.choices() if item != dropped))
        with self.assertRaisesRegex(ValueError, "Duplicate ownership"):
            self.plan(ownership=self.choices() + self.choices()[:1])

    def test_changed_byte_expectation_wrong_owner_or_missing_path_rejects(self):
        choice = next(item for item in self.choices() if item.path == "old.js")
        bad = (
            replace(choice, expected=Fingerprint(6, "b" * 64)),
            replace(choice, expected=Fingerprint(5, "a" * 64)),
            replace(choice, owner="candidate"),
            replace(choice, path="missing.js"),
        )
        for item in bad:
            with self.subTest(item=item), self.assertRaisesRegex(ValueError, "source artifact"):
                self.plan(ownership=(item,) + tuple(row for row in self.choices() if row != choice))

    def test_both_runtime_closures_must_match_their_inputs(self):
        for name in ("baseline_runtime", "candidate_runtime"):
            for files in (
                (InventoryFile("absent.js", Fingerprint(5, "a" * 64)),),
                (InventoryFile("shared.css", Fingerprint(6, "c" * 64)),),
            ):
                with (
                    self.subTest(name=name, files=files),
                    self.assertRaisesRegex(ValueError, "source artifact"),
                ):
                    self.plan(**{name: RuntimeClosure("3" * 64, files)})
            with self.assertRaisesRegex(ValueError, "cannot be empty"):
                self.plan(**{name: RuntimeClosure("3" * 64, ())})

    def test_conflicting_runtime_bytes_cannot_be_resolved_by_picking_a_winner(self):
        old_files = {file.path: file.fingerprint for file in self.old.files}
        new_files = {file.path: file.fingerprint for file in self.new.files}
        for owner in ("baseline", "candidate"):
            choices = tuple(
                replace(
                    item,
                    owner=owner,
                    expected=(old_files if owner == "baseline" else new_files)[item.path],
                )
                if item.path == "manifest.json"
                else item
                for item in self.choices()
            )
            old_runtime = replace(
                self.old_runtime,
                files=self.old_runtime.files
                + (InventoryFile("manifest.json", old_files["manifest.json"]),),
            )
            new_runtime = replace(
                self.new_runtime,
                files=self.new_runtime.files
                + (InventoryFile("manifest.json", new_files["manifest.json"]),),
            )
            with self.subTest(owner=owner), self.assertRaisesRegex(ValueError, "immutable runtime"):
                self.plan(
                    ownership=choices, baseline_runtime=old_runtime, candidate_runtime=new_runtime
                )

    def test_order_does_not_change_plan_or_inventory_identity(self):
        expected = self.plan()
        for sequence in itertools.permutations(self.choices()):
            self.assertEqual(self.plan(ownership=sequence), expected)
        self.assertEqual(
            self.plan(
                baseline=ArtifactInventory(tuple(reversed(self.old.files))),
                candidate=ArtifactInventory(tuple(reversed(self.new.files))),
            ),
            expected,
        )
        changed = tuple(
            replace(item, reason="Different reviewed rationale") for item in self.choices()
        )
        self.assertEqual(
            self.plan(ownership=changed).baseline_inventory_sha256,
            expected.baseline_inventory_sha256,
        )

    def test_mapping_inputs_are_detached_and_results_deeply_immutable(self):
        source = {"index.html": record(), "音楽 page/a.js": record("b", 0)}
        inventory = inventory_from_records(source)
        source["index.html"]["bytes"] = 99
        self.assertEqual(inventory.files[0].fingerprint.bytes, 5)
        with self.assertRaises(FrozenInstanceError):
            inventory.files[0].fingerprint.bytes = 7
        result = self.plan()
        with self.assertRaises(FrozenInstanceError):
            result.files[0].reason = "changed"
        with self.assertRaises(FrozenInstanceError):
            result.collisions[0].owner = "baseline"

    def test_input_id_changes_with_bytes_and_size_even_outside_runtime_closure(self):
        result = self.plan()
        for fingerprint in (Fingerprint(6, "d" * 64), Fingerprint(5, "9" * 64)):
            old = ArtifactInventory(
                tuple(
                    replace(file, fingerprint=fingerprint) if file.path == "manifest.json" else file
                    for file in self.old.files
                )
            )
            changed = self.plan(baseline=old)
            self.assertNotEqual(changed.baseline_inventory_sha256, result.baseline_inventory_sha256)

    def test_invalid_paths_are_rejected_before_planning(self):
        invalid = (
            "",
            "/a",
            "//host/a",
            "a/",
            "a//b",
            "./a",
            "../a",
            "a/../b",
            "a\\b",
            "C:/a",
            "https://host/a",
            "a%2fb",
            "a?q=1",
            "a#f",
            "a\0",
            "a\n",
            "a\x7f",
            "a./b",
            "a /b",
            "a*b",
            "a|b",
            'a"b',
            "a<b",
            "a>b",
            "NUL",
            "com1.js",
            "AUX/name.js",
            "nested/LpT9.txt",
            "COM¹.txt",
            "LPT².dat",
            "CONIN$.txt",
            "CONOUT$.txt",
            "NUL .txt",
            1,
        )
        for path in invalid:
            with self.subTest(path=path), self.assertRaises(ValueError):
                inventory_from_records({path: record()})
        self.assertEqual(
            inventory_from_records({"ja/音楽 page.js": record()}).files[0].path, "ja/音楽 page.js"
        )

    def test_duplicate_case_alias_and_file_directory_overlap_reject(self):
        file = self.old.files[0]
        for files in (
            (file, file),
            (file, replace(file, path="INDEX.html")),
            (file, replace(file, path="index.html/child")),
        ):
            with self.subTest(files=files), self.assertRaises(ValueError):
                self.plan(baseline=ArtifactInventory(files))
        for path in ("OLD.js", "old.js/child"):
            candidate = ArtifactInventory(
                self.new.files + (InventoryFile(path, Fingerprint(0, "a" * 64)),)
            )
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.plan(candidate=candidate)

    def test_directory_prefix_case_aliases_reject_within_and_between_artifacts(self):
        for paths in (
            ("Assets/old.js", "assets/new.js"),
            ("assets/Nested/old.js", "assets/nested/new.js"),
        ):
            with self.subTest(paths=paths), self.assertRaisesRegex(ValueError, "exact spelling"):
                inventory_from_records({path: record() for path in paths})
            old = ArtifactInventory(
                self.old.files + (InventoryFile(paths[0], Fingerprint(0, "a" * 64)),)
            )
            new = ArtifactInventory(
                self.new.files + (InventoryFile(paths[1], Fingerprint(0, "a" * 64)),)
            )
            with self.subTest(paths=paths), self.assertRaisesRegex(ValueError, "exact spelling"):
                self.plan(baseline=old, candidate=new)
        inventory_from_records({"Assets/a.js": record(), "Assets/b.js": record()})

    def test_malformed_file_records_are_rejected(self):
        bad = (
            None,
            [],
            {},
            {"bytes": 5},
            {"sha256": "a" * 64},
            {"bytes": 5, "sha256": "a" * 64, "extra": 1},
            record(size=True),
            record(size=-1),
            record(size=0.5),
            record("A"),
            record("g"),
            {"bytes": 5, "sha256": None},
            {"bytes": 5, "sha256": "a" * 63},
        )
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                inventory_from_records({"index.html": value})
        with self.assertRaises(ValueError):
            inventory_from_records([])

    def test_malformed_typed_inputs_reject_without_duck_typed_ownership(self):
        for overrides in (
            {"target": "anything"},
            {"baseline": None},
            {"candidate": None},
            {"baseline": ArtifactInventory(())},
            {"candidate": ArtifactInventory(())},
            {"baseline": ArtifactInventory(list(self.old.files))},
            {"baseline": ArtifactInventory((None,))},
            {"baseline_runtime": None},
            {"baseline_runtime": RuntimeClosure("bad", self.old_runtime.files)},
            {"ownership": list(self.choices())},
            {"ownership": (None,)},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.plan(**overrides)
        first, *rest = self.choices()
        for bad in (
            replace(first, owner="newest"),
            replace(first, expected=None),
            replace(first, reason=" "),
            replace(first, reason=None),
            replace(first, expected=Fingerprint(True, "a" * 64)),
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.plan(ownership=(bad, *rest))

    def test_capacity_limits_are_exact_and_cannot_enable_a_paid_profile(self):
        self.assertEqual(self.plan(max_files=5, max_file_bytes=5).file_count, 5)
        with self.assertRaisesRegex(ValueError, "file capacity"):
            self.plan(max_files=4)
        with self.assertRaisesRegex(ValueError, "per-file capacity"):
            self.plan(max_file_bytes=4)
        for name, values in (
            ("max_files", (True, 0, -1, 1.5, MAX_FILES + 1)),
            ("max_file_bytes", (True, 0, -1, 1.5, MAX_FILE_BYTES + 1)),
        ):
            for value in values:
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    self.plan(**{name: value})

    def test_default_pages_file_boundary_and_empty_assets(self):
        extra = tuple(
            InventoryFile(f"retained/{index}.txt", Fingerprint(0, "a" * 64))
            for index in range(MAX_FILES - 5)
        )
        old = ArtifactInventory(self.old.files + extra)
        result = self.plan(baseline=old, ownership=self.choices(old=old))
        self.assertEqual(result.file_count, MAX_FILES)
        self.assertEqual(result.total_bytes, 25)
        old = ArtifactInventory(
            old.files + (InventoryFile("one-too-many.txt", Fingerprint(0, "a" * 64)),)
        )
        with self.assertRaisesRegex(ValueError, "file capacity"):
            self.plan(baseline=old, ownership=self.choices(old=old))

    def test_default_pages_asset_boundary(self):
        for size in (MAX_FILE_BYTES, MAX_FILE_BYTES + 1):
            extra = InventoryFile("retained.bin", Fingerprint(size, "a" * 64))
            old = ArtifactInventory(self.old.files + (extra,))
            if size == MAX_FILE_BYTES:
                self.assertEqual(
                    self.plan(baseline=old, ownership=self.choices(old=old)).total_bytes,
                    MAX_FILE_BYTES + 25,
                )
            else:
                with self.assertRaisesRegex(ValueError, "per-file capacity"):
                    self.plan(baseline=old, ownership=self.choices(old=old))


if __name__ == "__main__":
    unittest.main()
