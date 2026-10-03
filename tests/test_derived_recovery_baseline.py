"""Exact transformation and provenance; selector behavior has its own JS tests."""

import hashlib
import json
import tempfile
import unittest
from dataclasses import asdict, replace
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence import derived_recovery_baseline as subject
from maimai_intelligence import release_assembly as assembly
from maimai_intelligence.release_composition import (
    PathOwnership,
    RuntimeClosure,
    artifact_inventory_sha256,
    inventory_from_records,
    plan_release_composition,
)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fingerprints(assets):
    return {name: {"bytes": len(raw), "sha256": sha(raw)} for name, raw in assets.items()}


class DerivedRecoveryTests(unittest.TestCase):
    def setUp(self):
        # Fixture authority is replaced only by unittest.mock, never a public
        # parameter or supported production policy. The exact retained cc5
        # bytes are separately exercised by release acceptance.
        bundle = (
            "(() => {\n"
            + subject.SOURCE_CATALOG
            + "\n"
            + subject.SOURCE_FOCUS
            + "\n"
            + subject.SOURCE_LOOP
            + "renderFullChart(key,chart,index);}\n"
            + subject.SOURCE_MORE
            + "\n}\n})();"
        ).encode()
        loader = (
            "const script=document.createElement('script');"
            "script.src='challenge-review.js?v=" + sha(bundle)[:16] + "';"
            "script.onerror=()=>showFailure();document.body.append(script);"
        ).encode()
        index = (
            '<html><head><link rel="preload" href="challenge-review.js?v='
            + sha(bundle)[:16]
            + '"></head><body><script defer src="lab-loader.js?v='
            + sha(loader)[:16]
            + '"></script></body></html>'
        ).encode()
        self.selector = b"((rows, visible, focusedKey) => [])"
        self.sources = {"index": index, "loader": loader, "bundle": bundle}
        self.assets = {
            "index.html": index,
            "lab-loader.js": loader,
            "challenge-review.js": bundle,
            "catalogs/retained.json": b"{}",
        }
        self.inventory = inventory_from_records(fingerprints(self.assets))
        self.addCleanup(patch.stopall)
        patch.object(subject, "SOURCE_BUNDLE_SHA256", sha(bundle)).start()
        patch.object(subject, "SOURCE_LOADER_SHA256", frozenset({sha(loader)})).start()

    def derive(self, **changes):
        values = {
            **self.sources,
            "selector": self.selector,
            "selector_sha256": sha(self.selector),
        }
        return subject.derive_recovery_baseline(self.inventory, **{**values, **changes})

    def verify(self, value, **changes):
        subject.verify_recovery_derivation(
            value,
            self.inventory,
            **{
                **self.sources,
                "selector": self.selector,
                "selector_sha256": sha(self.selector),
                **changes,
            },
        )

    def test_four_substitutions_preserve_every_other_bundle_byte(self):
        result = self.derive()
        patched = result.assets[1].content
        restored = patched.replace(
            b"const recoveryRows=" + self.selector + b";\n" + subject.DERIVED_CATALOG.encode(),
            subject.SOURCE_CATALOG.encode(),
            1,
        ).replace(subject.DERIVED_FOCUS.encode(), subject.SOURCE_FOCUS.encode(), 1)
        restored = restored.replace(subject.DERIVED_LOOP.encode(), subject.SOURCE_LOOP.encode(), 1)
        restored = restored.replace(subject.DERIVED_MORE.encode(), subject.SOURCE_MORE.encode(), 1)
        self.assertEqual(restored, self.sources["bundle"])
        self.assertIn(b"if(focusKey)selectedCharts.delete(focusKey);", patched)
        self.assertIn(b"for(const {index,row:{key,chart}}", patched)
        self.assertNotIn(b"visible=Math.max", patched)
        self.assertEqual(patched.count(b"recoveryRows(rows,visible,focusedKey)"), 1)
        self.assertIn(b"el('more').hidden=rows.length<=selectedRows.length;", patched)

    def test_only_index_changes_and_new_hash_scripts_preserve_all_old_urls(self):
        result = self.derive()
        records = {item.path: asdict(item.fingerprint) for item in result.inventory.files}
        for path, record in fingerprints(self.assets).items():
            if path != "index.html":
                self.assertEqual(records[path], record)
        self.assertEqual(len(records), len(self.assets) + 2)
        index, bundle, loader = result.assets
        for asset in (bundle, loader):
            self.assertEqual(asset.path, "browser-resources/" + sha(asset.content) + ".js")
        self.assertIn(('href="/' + bundle.path + '"').encode(), index.content)
        self.assertIn(('src="/' + loader.path + '"').encode(), index.content)
        self.assertIn(("script.src='/" + bundle.path + "'").encode(), loader.content)
        self.assertNotIn(b"challenge-review.js?v=", loader.content)
        self.assertIn(b"script.onerror=()=>showFailure()", loader.content)

    def test_evidence_and_exact_rederivation(self):
        result = self.derive()
        self.assertEqual(result, self.derive())
        evidence = json.loads(result.evidence)
        self.assertEqual(
            evidence["original_inventory_sha256"], artifact_inventory_sha256(self.inventory)
        )
        self.assertEqual(
            evidence["derived_inventory_sha256"], artifact_inventory_sha256(result.inventory)
        )
        self.assertEqual(evidence["shared_pagination_sha256"], sha(self.selector))
        self.assertEqual(result.evidence_sha256, sha(result.evidence))
        self.verify(result)
        for changed in (
            None,
            replace(result, evidence=b"{}"),
            replace(result, original_inventory_sha256="0" * 64),
            replace(result, inventory=self.inventory),
            replace(result, assets=result.assets[:1]),
        ):
            with self.subTest(changed=changed), self.assertRaisesRegex(ValueError, "differs"):
                self.verify(changed)
        with self.assertRaises(TypeError):
            result.asset_map["index.html"] = b"bad"

    def test_source_tampering_or_mutable_bytes_rejected(self):
        for name in self.sources:
            for raw in (self.sources[name] + b" ", bytearray(self.sources[name])):
                with (
                    self.subTest(name=name),
                    self.assertRaisesRegex(ValueError, "source inventory"),
                ):
                    self.derive(**{name: raw})

    def test_matching_inventory_does_not_authorize_an_unknown_loader_or_fallback(self):
        loader = self.sources["loader"] + b"script.onerror=()=>loadOriginalBundle();"
        inventory = inventory_from_records(fingerprints({**self.assets, "lab-loader.js": loader}))
        with self.assertRaisesRegex(ValueError, "Unsupported legacy recovery loader"):
            subject.derive_recovery_baseline(
                inventory,
                **{
                    **self.sources,
                    "loader": loader,
                    "selector": self.selector,
                    "selector_sha256": sha(self.selector),
                },
            )

    def test_unsupported_bundle_even_with_matching_hash_argument_is_rejected(self):
        for bundle in (b"unknown", bytearray(self.sources["bundle"])):
            with (
                self.subTest(bundle=bundle),
                self.assertRaisesRegex(ValueError, "Unsupported legacy"),
            ):
                subject.derive_bundle(
                    bundle, selector=self.selector, selector_sha256=sha(self.selector)
                )

    def test_selector_size_hash_bytes_and_encoding_are_validated(self):
        for raw, digest in (
            (b"", sha(b"")),
            (b"x" * 8193, sha(b"x" * 8193)),
            (bytearray(self.selector), sha(self.selector)),
            (self.selector, "0" * 64),
        ):
            with (
                self.subTest(size=len(raw)),
                self.assertRaisesRegex(ValueError, "pagination asset"),
            ):
                self.derive(selector=raw, selector_sha256=digest)
        with self.assertRaisesRegex(ValueError, "UTF-8"):
            self.derive(selector=b"\xff", selector_sha256=sha(b"\xff"))

    def test_changed_or_duplicate_anchors_rejected(self):
        for raw in (b"", b"aa"):
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, "anchor changed"):
                subject._once(raw, "a", "b")

    def test_already_derived_marker_rejected(self):
        index = self.sources["index"].replace(b"<head>", b"<head><!-- maimai-recovery-runtime -->")
        self.inventory = inventory_from_records(fingerprints({**self.assets, "index.html": index}))
        with self.assertRaisesRegex(ValueError, "already derived"):
            self.derive(index=index)

    def test_immutable_collision_is_rejected_but_identical_prior_asset_is_valid(self):
        result = self.derive()
        for content, raises in ((b"other", True), (result.assets[1].content, False)):
            self.inventory = inventory_from_records(
                fingerprints(
                    {
                        **self.assets,
                        result.assets[1].path: content,
                    }
                )
            )
            if raises:
                with self.assertRaisesRegex(ValueError, "collides"):
                    self.derive()
            else:
                self.assertEqual(self.derive().assets, result.assets)

    def assembly_fixture(self, root, *, target="recovery"):
        old, new = root / "old", root / "new"
        new_assets = {"index.html": b"new page", "browser/new.js": b"new application"}
        for directory, assets in ((old, self.assets), (new, new_assets)):
            for path, raw in assets.items():
                destination = directory / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(raw)
        derived = self.derive()
        new_inventory = inventory_from_records(fingerprints(new_assets))
        old_runtime = RuntimeClosure(
            "a" * 64, tuple(item for item in derived.inventory.files if item.path.endswith(".js"))
        )
        new_runtime = RuntimeClosure(
            "b" * 64, tuple(item for item in new_inventory.files if item.path.endswith(".js"))
        )
        old_records = {item.path: item.fingerprint for item in derived.inventory.files}
        new_records = {item.path: item.fingerprint for item in new_inventory.files}
        choices = []
        for path in sorted(old_records.keys() | new_records.keys()):
            owner = "baseline" if path in old_records else "candidate"
            if path == "index.html":
                owner = "baseline" if target == "recovery" else "candidate"
            choices.append(
                PathOwnership(
                    path,
                    owner,
                    (old_records if owner == "baseline" else new_records)[path],
                    "Exact reviewed fixture ownership",
                )
            )
        plan = plan_release_composition(
            derived.inventory,
            new_inventory,
            target=target,
            ownership=tuple(choices),
            baseline_runtime=old_runtime,
            candidate_runtime=new_runtime,
        )
        options = {
            "plan": plan,
            "baseline_runtime": old_runtime,
            "candidate_runtime": new_runtime,
            "receipt_path": root / "receipt.json",
            "derived_baseline": derived,
        }
        return old, new, root / "output", options

    def run_assembly(self, fixture, **changes):
        old, new, output, options = fixture
        with patch.object(
            assembly, "recovery_pagination_asset", return_value=(self.selector, sha(self.selector))
        ):
            return assembly.assemble_release(old, new, output, **{**options, **changes})

    def test_both_directions_retain_derived_scripts_and_bind_original_origin(self):
        for target in ("candidate", "recovery"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                fixture = self.assembly_fixture(root, target=target)
                self.run_assembly(fixture)
                original, _, output, options = fixture
                derived = options["derived_baseline"]
                expected = derived.assets[0].content if target == "recovery" else b"new page"
                self.assertEqual((output / "index.html").read_bytes(), expected)
                for asset in derived.assets[1:]:
                    self.assertEqual((output / asset.path).read_bytes(), asset.content)
                for name, raw in self.assets.items():
                    self.assertEqual((original / name).read_bytes(), raw)
                    if name != "index.html":
                        self.assertEqual((output / name).read_bytes(), raw)
                receipt = json.loads(options["receipt_path"].read_bytes())
                evidence = receipt["derived_baseline"]
                self.assertEqual(
                    evidence["original_inventory_sha256"], artifact_inventory_sha256(self.inventory)
                )
                self.assertEqual(evidence["evidence_sha256"], derived.evidence_sha256)
                self.assertEqual(evidence["evidence"], json.loads(derived.evidence))
                self.assertEqual(
                    receipt["plan"]["baseline_inventory_sha256"],
                    artifact_inventory_sha256(derived.inventory),
                )

    def test_forged_derived_or_changed_physical_input_is_rejected_before_writes(self):
        for kind in ("evidence", "physical", "wrong_plan"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                fixture = self.assembly_fixture(Path(temporary))
                old, _, output, options = fixture
                if kind == "physical":
                    (old / "index.html").write_bytes(b"changed")
                elif kind == "evidence":
                    options["derived_baseline"] = replace(
                        options["derived_baseline"], evidence=b"{}"
                    )
                else:
                    options["plan"] = replace(options["plan"], baseline_inventory_sha256="0" * 64)
                with self.assertRaises(ValueError):
                    self.run_assembly(fixture)
                self.assertFalse(output.exists())
                self.assertFalse(options["receipt_path"].exists())

    def test_different_installed_selector_cannot_authorize_supplied_derivation(self):
        with tempfile.TemporaryDirectory() as temporary:
            old, new, output, options = self.assembly_fixture(Path(temporary))
            different = self.selector + b" "
            with patch.object(
                assembly, "recovery_pagination_asset", return_value=(different, sha(different))
            ):
                with self.assertRaisesRegex(ValueError, "differs"):
                    assembly.assemble_release(old, new, output, **options)
            self.assertFalse(output.exists())

    def test_both_derived_scripts_are_required_in_runtime_closure(self):
        for missing in (1, 2):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as temporary:
                fixture = self.assembly_fixture(Path(temporary), target="candidate")
                _, _, output, options = fixture
                path = options["derived_baseline"].assets[missing].path
                options["baseline_runtime"] = replace(
                    options["baseline_runtime"],
                    files=tuple(
                        item for item in options["baseline_runtime"].files if item.path != path
                    ),
                )
                with self.assertRaisesRegex(
                    ValueError, "must belong to the baseline runtime closure"
                ):
                    self.run_assembly(fixture)
                self.assertFalse(output.exists())

    def test_physical_baseline_change_during_candidate_copy_prevents_completion(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.assembly_fixture(Path(temporary), target="candidate")
            old, _, _, options = fixture
            original_copy = assembly._copy_file

            def change_original(source, destination, fingerprint):
                (old / "index.html").write_bytes(b"changed after initial verification")
                original_copy(source, destination, fingerprint)

            with patch.object(assembly, "_copy_file", side_effect=change_original):
                with self.assertRaisesRegex(ValueError, "input artifact changed"):
                    self.run_assembly(fixture)
            self.assertFalse(options["receipt_path"].exists())


if __name__ == "__main__":
    unittest.main()
