"""Mapping preservation and import guards, using public metadata and fictional scores."""

import hashlib
import json
import shutil
import subprocess
import unittest
from copy import deepcopy
from pathlib import Path

from maimai_intelligence.catalog_loading import progressive_catalog
from maimai_intelligence.maishift_mapping import match_chart, validate_mapping
from maimai_intelligence.provider_mapping import integration_catalog
from maimai_intelligence.registry import digest, read_registry
from maimai_intelligence.registry_catalog import project_registry
from scripts.install_maishift_mappings import install_snapshot

ROOT = Path(__file__).resolve().parents[1]


class MaishiftMappingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = read_registry(ROOT / "registry")
        cls.snapshot = json.loads((ROOT / "registry/maishift-source-20260921.json").read_bytes())
        cls.review = json.loads((ROOT / "registry/maishift-review-20260921.json").read_bytes())
        cls.data = project_registry(cls.registry, {})
        cls.mapping = cls.data["maishift_mapping"]

    def test_installed_snapshot_replays_without_changing_any_identity(self):
        self.assertEqual(install_snapshot(self.registry, self.snapshot, self.review), self.registry)
        self.assertEqual(len(self.mapping["charts"]), 12474)
        self.assertEqual(sum(k.startswith("maishift:intl:") for k in self.mapping["charts"]), 6031)
        source = self.registry["sources"]["maishift-public-charts:" + digest(self.snapshot)]
        self.assertEqual(
            source["sha256"],
            hashlib.sha256(
                (ROOT / "registry/maishift-source-20260921.json").read_bytes()
            ).hexdigest(),
        )

    def test_changed_or_ambiguous_source_identity_needs_new_review(self):
        for change in ("artist", "difficulty"):
            snapshot = deepcopy(self.snapshot)
            snapshot["charts"][0]["source"][change] = "Different"
            with self.assertRaises(ValueError):
                install_snapshot(self.registry, snapshot, self.review)
        snapshot = deepcopy(self.snapshot)
        snapshot["charts"].append(deepcopy(snapshot["charts"][0]))
        with self.assertRaises(ValueError):
            install_snapshot(self.registry, snapshot, self.review)

    def test_matching_guard_parity_includes_region_provider_raw_text_and_variant(self):
        key = "maishift:intl:170"  # Reviewed empty-title exception, never normalized at import.
        row = self.mapping["charts"][key]
        target = self.registry["charts"][row["chart_id"]]
        player = {"provider": "maishift", "key": "maishift:maimaidx:intl:fictional"}
        chart = {"chartID": key, **row["expected_source"]}
        cases = [[player, chart, row, target]]
        for field, value in [
            ("title", "　"),
            ("artist", "Changed"),
            ("format", "STD"),
            ("difficulty", "MASTER"),
            ("chartID", "maishift:jp:170"),
        ]:
            cases.append([player, {**chart, field: value}, row, target])
        cases += [
            [{**player, "provider": "kamaitachi"}, chart, row, target],
            [{**player, "key": "maishift:maimaidx:jp:fictional"}, chart, row, target],
            [player, chart, {**row, "acceptance_basis": "candidate"}, target],
            [player, chart, row, {**target, "format": "STD"}],
        ]
        expected = [match_chart(*args) for args in cases]
        self.assertEqual(expected, [True] + [False] * (len(cases) - 1))
        script = (
            "require('./src/maimai_intelligence/assets/player-maishift.js');"
            "let s='';process.stdin.on('data',x=>s+=x);"
            "process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s)"
            ".map(x=>maimaiPlayerMaishift.matchChart(...x)))));"
        )
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is needed for matching parity")
        actual = subprocess.run(  # noqa: S603 - repository code; fixture data only on stdin
            [node, "-e", script],
            cwd=ROOT,
            input=json.dumps(cases),
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(json.loads(actual.stdout), expected)

    def test_duplicate_target_and_variant_change_rejected(self):
        for bad in ("duplicate", "variant"):
            mapping = deepcopy(self.mapping)
            key = next(iter(mapping["charts"]))
            if bad == "duplicate":
                mapping["charts"]["maishift:intl:999999"] = deepcopy(mapping["charts"][key])
            else:
                mapping["charts"][key]["expected_source"]["difficulty"] = "Unknown"
            with self.assertRaises(ValueError):
                validate_mapping(mapping, self.data["catalog"])

    def test_progressive_catalog_retains_source_guards_and_legacy_export_is_unchanged(self):
        original = deepcopy(self.mapping)
        manifest, assets = progressive_catalog(self.data, "0" * 64)
        projected = json.loads(assets[manifest["path"]])
        self.assertEqual(self.data["maishift_mapping"], original)
        self.assertEqual(
            projected["maishift_mapping"],
            {
                **original,
                "charts": {
                    cid: {key: value for key, value in row.items() if key != "snapshot_id"}
                    for cid, row in original["charts"].items()
                },
            },
        )
        without = {k: v for k, v in self.data.items() if k != "maishift_mapping"}
        self.assertEqual(
            integration_catalog(self.data, "test"), integration_catalog(without, "test")
        )


if __name__ == "__main__":
    unittest.main()
