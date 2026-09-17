import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from maimai_intelligence.metadata_waterfall import accept, parse, project, propose
from maimai_intelligence.registry import digest, empty
from maimai_intelligence.registry_catalog import build_registry_package, project_registry
from tests.registry_fixture import admit, fixture, official_row


def capture(provider="arcade-songs", *, bpm=160, constant="14.0", duplicate=False):
    row = {
        "title": "ソテリア",
        "artist": "Rafutsuri feat.桜あおい",
        "bpm": bpm,
        "sheets": [
            {
                "type": "dx",
                "difficulty": "master",
                "level": "14",
                "internalLevel": constant,
                "internalLevelValue": 14.6,
            }
        ],
    }
    raw = json.dumps({"songs": [row, row] if duplicate else [row]}).encode()
    return (
        provider,
        raw,
        {
            "url": "https://example.org/public.json",
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "captured_at": "2026-09-17T12:00:00Z",
        },
    )


class WaterfallTests(unittest.TestCase):
    def setUp(self):
        self.value, _ = admit(empty(), [official_row()])

    def accepted(self, inputs):
        proposal = propose(self.value, inputs)
        review = {
            "proposal_sha256": digest(proposal),
            "evidence": "Authored fixture review",
            "accept": [c["observation_id"] for c in proposal["claims"]],
        }
        return accept(self.value, proposal, review), proposal, review

    def test_explicit_constants_only_and_invalid_numbers_stay_missing(self):
        for missing in (None, "", "0", "NaN", "Infinity", True):
            provider, raw, _ = capture(constant=missing)
            self.assertIsNone(parse(raw, provider)[0]["chart_constant"])
        provider, raw, _ = capture()
        self.assertEqual(parse(raw, provider)[0]["chart_constant"], 14)

    def test_failed_source_falls_through_and_does_not_delete_retained_observations(self):
        bad = list(capture())
        bad[2] = {**bad[2], "sha256": "0" * 64}
        value, proposal, _ = self.accepted([tuple(bad), capture()])
        self.assertEqual(len(proposal["failures"]), 1)
        self.assertEqual(len(proposal["claims"]), 2)
        for key, row in self.value["observations"].items():
            self.assertEqual(value["observations"][key], row)

    def test_ambiguous_identity_does_not_guess(self):
        proposal = propose(self.value, [capture(duplicate=True)])
        self.assertEqual(proposal["claims"], [])
        self.assertEqual(len(proposal["ambiguous"]), 1)

    def test_metadata_populates_metrics_without_fabricating_analysis(self):
        value, _, _ = self.accepted([capture()])
        data = project_registry(value, {})
        chart = next(c for c in data["catalog"] if c["difficulty"] == "MASTER")
        nav = data["navigation"]["charts"][chart["chart_id"]]
        self.assertEqual((nav["bpm"], nav["chart_constant"]), (160, 14))
        self.assertEqual(nav["regional_metrics"]["chart_constant"], {"JP": 14, "INTL": None})
        self.assertEqual(nav["metric_sources"]["chart_constant"]["provider"], "Arcade Songs")
        self.assertNotIn("demand", chart)
        self.assertEqual(chart["capabilities"]["flow"], "not_prepared")

    def test_fallback_is_per_field_and_primary_values_are_preserved(self):
        _, proposal, _ = self.accepted([capture(bpm=None)])
        rows = proposal["claims"]
        nav = project({"bpm": 150}, rows, proposal["sources"])
        self.assertEqual((nav["bpm"], nav["chart_constant"]), (150, 14))
        preserved = project({"bpm": 150, "chart_constant": 13.9}, rows, proposal["sources"])
        self.assertEqual(preserved, {"bpm": 150, "chart_constant": 13.9})

    def test_japan_preference_preserves_international_choice_and_its_provenance(self):
        _, proposal, _ = self.accepted([capture()])
        japan = next(c for c in proposal["claims"] if c["field"] == "chart_constant")
        international = {
            **japan,
            "region": "INTL",
            "value": 13.8,
            "priority": 10,
            "snapshot_id": "international",
            "release": "Intl fixture",
            "source_url": "https://example.org/international",
        }
        sources = {**proposal["sources"], "international": {"provider": "reviewed-page"}}
        nav = project({}, [japan, international], sources)
        self.assertEqual(nav["chart_constant"], 14)
        self.assertEqual(nav["metric_sources"]["chart_constant"]["region"], "JP")
        self.assertEqual(nav["regional_metrics"]["chart_constant"], {"JP": 14, "INTL": 13.8})
        source = nav["regional_metric_sources"]["chart_constant"]["INTL"]
        self.assertEqual(source["region"], "INTL")
        self.assertEqual(source["release"], "Intl fixture")
        self.assertEqual(source["url"], "https://example.org/international")
        only_international = project({}, [international], sources)
        self.assertEqual(only_international["chart_constant"], 13.8)
        self.assertIsNone(only_international["regional_metrics"]["chart_constant"]["JP"])

    def test_otoge_fills_missing_bpm_without_inventing_a_constant(self):
        row = {**official_row(), "bpm": "160", "dx_lev_mas_i": ""}
        raw = json.dumps([row]).encode()
        other = (
            "otoge-db",
            raw,
            {**capture()[2], "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()},
        )
        value, _, _ = self.accepted([capture(bpm=None), other])
        data = project_registry(value, {})
        nav = next(r for r in data["navigation"]["charts"].values() if r.get("chart_constant"))
        self.assertEqual(nav["metric_sources"]["bpm"]["provider"], "OTOGE DB")
        self.assertEqual(nav["chart_constant"], 14)

    def test_package_reuse_preserves_supplemental_provenance_and_original_analysis(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.value, _, package = fixture(root)
            value, _, _ = self.accepted([capture()])
            first = build_registry_package(value, package, root / "first")
            second = build_registry_package(value, root / "first", root / "second")
            self.assertEqual(first["navigation"], second["navigation"])
            self.assertEqual(first["catalog"], second["catalog"])
            self.assertEqual(first["analysis"], second["analysis"])

    def test_review_replay_and_aliases_are_bound_to_the_original_registry(self):
        value, proposal, review = self.accepted([capture()])
        sid = next(iter(value["songs"]))
        review["song_aliases"] = {
            sid: {"aliases": ["Soteria"], "evidence": "User supplied reading"}
        }
        accepted = accept(self.value, proposal, review)
        self.assertEqual(accepted["songs"][sid]["metadata"]["aliases"], ["Soteria"])
        with self.assertRaises(ValueError):
            accept(value, proposal, review)
        changed = deepcopy(proposal)
        changed["claims"][0]["value"] = 99
        with self.assertRaises(ValueError):
            accept(self.value, changed, review)

    def test_newer_snapshot_replaces_same_source_field_but_keeps_other_source_disagreement(self):
        _, proposal, _ = self.accepted([capture()])
        rows = [c for c in proposal["claims"] if c["field"] == "chart_constant"]
        newer = {**rows[0], "value": 14.1, "observed_at": "2026-09-18T00:00:00Z"}
        nav = project({}, [*rows, newer], proposal["sources"])
        self.assertEqual(nav["chart_constant"], 14.1)
        self.assertNotIn("metadata_alternatives", nav)
        sources = {**proposal["sources"], "wiki": {"provider": "reviewed-page"}}
        wiki = {**newer, "value": 14.2, "snapshot_id": "wiki", "priority": 10}
        nav = project({}, [*rows, newer, wiki], sources)
        self.assertEqual(nav["chart_constant"], 14.2)
        self.assertEqual(len(nav["metadata_alternatives"]["chart_constant"]), 2)


if __name__ == "__main__":
    unittest.main()
