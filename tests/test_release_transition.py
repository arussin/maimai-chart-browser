"""Inventory-only transition checks do not stand in for browser rollout tests."""

import unittest
from dataclasses import FrozenInstanceError, asdict

from maimai_intelligence.release_transition import compare_request_inventory


def file_record(size=5, digest="a"):
    return {"bytes": size, "sha256": digest * 64}


class ReleaseTransitionTests(unittest.TestCase):
    def compare(self, requests, target, **options):
        return compare_request_inventory(
            requests,
            target,
            observations_sha256=options.pop("observations_sha256", "e" * 64),
            direction=options.pop("direction", "old_to_new"),
            **options,
        )

    def test_exact_match_is_explicitly_limited_to_declared_inventory(self):
        requests = {"browser/application-a.js": file_record(), "empty.txt": file_record(0)}
        target = {**requests, "unobserved.json": file_record(7, "b")}
        result = self.compare(requests, target)
        self.assertEqual(result.status, "inventory_match")
        self.assertEqual(result.scope, "declared_request_inventory_only")
        self.assertEqual(result.matched, tuple(sorted(requests)))
        self.assertEqual(result.missing, ())
        self.assertEqual(result.conflicts, ())
        self.assertEqual(result.observations_sha256, "e" * 64)
        self.assertNotIn("safe", asdict(result))
        self.assertNotIn("passed", asdict(result))

    def test_missing_lazy_chunk_is_reported_without_filename_inference(self):
        result = self.compare({"browser/application-a.js": file_record()}, {})
        self.assertEqual(result.status, "inventory_conflicts")
        self.assertEqual(result.missing, ("browser/application-a.js",))
        self.assertEqual(result.conflicts, ())

    def test_mutable_path_conflicts_retain_both_expected_and_target_fingerprints(self):
        result = self.compare(
            {"manifest.json": file_record(), "browser-config.json": file_record()},
            {"manifest.json": file_record(5, "b"), "browser-config.json": file_record(6)},
        )
        self.assertEqual(result.status, "inventory_conflicts")
        self.assertEqual(
            tuple(item.path for item in result.conflicts),
            ("browser-config.json", "manifest.json"),
        )
        self.assertEqual(result.conflicts[0].expected.bytes, 5)
        self.assertEqual(result.conflicts[0].actual.bytes, 6)
        self.assertEqual(result.conflicts[1].expected.sha256, "a" * 64)
        self.assertEqual(result.conflicts[1].actual.sha256, "b" * 64)

    def test_both_directions_require_their_own_observed_requests(self):
        old_requests = {"old.js": file_record()}
        new_requests = {"browser/new.js": file_record(8, "b")}
        candidate = {**old_requests, **new_requests}
        old_to_new = self.compare(old_requests, candidate)
        new_to_fallback = self.compare(new_requests, old_requests, direction="new_to_fallback")
        self.assertEqual(old_to_new.status, "inventory_match")
        self.assertEqual(new_to_fallback.status, "inventory_conflicts")
        self.assertEqual(new_to_fallback.direction, "new_to_fallback")
        self.assertEqual(new_to_fallback.missing, ("browser/new.js",))

    def test_results_are_deterministic_and_detached_from_mutable_inputs(self):
        requests = {"z.json": file_record(), "a.json": file_record(), "middle.json": file_record()}
        target = {"z.json": file_record(2), "a.json": file_record()}
        result = self.compare(requests, target)
        self.assertEqual(
            result,
            self.compare(
                dict(reversed(list(requests.items()))), dict(reversed(list(target.items())))
            ),
        )
        target["z.json"]["bytes"] = 5
        self.assertEqual(result.conflicts[0].actual.bytes, 2)
        with self.assertRaises(FrozenInstanceError):
            result.conflicts[0].actual.bytes = 100

    def test_unsafe_or_noncanonical_paths_reject_on_either_side(self):
        paths = (
            "",
            "/",
            "/absolute",
            "//host/file",
            "C:/file",
            "https://host/file",
            "../file",
            "a/../b",
            "./file",
            "a//b",
            "a/",
            "a\\b",
            "a/%2e%2e/b",
            "a%2fb",
            "file?q=1",
            "file#fragment",
            "file\n",
            "file\x7f",
            "file\0",
            "a./b",
            "a /b",
            "a*b",
            "a|b",
            'a"b',
            "a<b",
            "a>b",
            1,
        )
        for path in paths:
            for side in ("requests", "target"):
                with self.subTest(path=path, side=side):
                    values = {
                        "requests": {"ok.json": file_record()},
                        "target": {"ok.json": file_record()},
                    }
                    values[side] = {path: file_record()}
                    with self.assertRaises(ValueError):
                        self.compare(**values)

    def test_valid_unicode_and_spaces_are_exact_inventory_names(self):
        name = "ja/songs/音楽 page/index.html"
        self.assertEqual(
            self.compare({name: file_record()}, {name: file_record()}).matched, (name,)
        )

    def test_malformed_records_reject_even_if_target_path_is_unobserved(self):
        invalid = (
            None,
            [],
            {},
            {"bytes": 1},
            {"sha256": "a" * 64},
            {"bytes": 1, "sha256": "a" * 64, "extra": True},
            {"bytes": True, "sha256": "a" * 64},
            {"bytes": -1, "sha256": "a" * 64},
            {"bytes": 1.5, "sha256": "a" * 64},
            {"bytes": 1, "sha256": "A" * 64},
            {"bytes": 1, "sha256": "a" * 63},
            {"bytes": 1, "sha256": None},
        )
        for record in invalid:
            with self.subTest(record=record):
                with self.assertRaises(ValueError):
                    self.compare({"ok.json": file_record()}, {"unobserved.json": record})
        with self.assertRaises(ValueError):
            self.compare([], {})
        with self.assertRaises(ValueError):
            self.compare({"ok.json": file_record()}, [])

    def test_empty_observations_cannot_produce_a_vacuous_match(self):
        with self.assertRaises(ValueError):
            self.compare({}, {"extra.json": file_record()})

    def test_evidence_hash_and_direction_are_required_and_validated(self):
        for evidence in (None, "", "g" * 64):
            with self.subTest(evidence=evidence), self.assertRaises(ValueError):
                self.compare({"ok.json": file_record()}, {}, observations_sha256=evidence)
        with self.assertRaises(ValueError):
            self.compare({"ok.json": file_record()}, {}, direction="fallback_to_anything")
        with self.assertRaises(TypeError):
            compare_request_inventory({"ok.json": file_record()}, {})
