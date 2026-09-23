"""Invariant tests for the extracted pure preparation and explanation decisions."""

import unittest
from itertools import product

from maimai_intelligence.corpus_explain import explain_record, explain_registry, source_references
from maimai_intelligence.corpus_policy import ReuseIdentity, SourceSelection, compare_records


class CorpusPolicyTests(unittest.TestCase):
    def test_every_source_selection_combination_respects_offline_and_replay_rules(self):
        for values in product((False, True), repeat=7):
            choice = SourceSelection(*values)
            valid = (
                not (choice.package and choice.revision)
                and (choice.package or choice.revision or choice.registry)
                and (not choice.replay or choice.offline and choice.registry)
                and (not choice.revision or choice.artwork_cache)
                and (not choice.offline or choice.retained_links or choice.registry)
            )
            with self.subTest(values=values):
                if valid:
                    choice.validate()
                else:
                    with self.assertRaises(ValueError):
                        choice.validate()

    def test_reuse_requires_exact_base_policy_and_review_binding(self):
        original = ReuseIdentity("base", "policy", "review")
        original.require_equal(original)
        for changed in (
            ReuseIdentity("new", "policy", "review"),
            ReuseIdentity("base", "new", "review"),
            ReuseIdentity("base", "policy", "new"),
        ):
            with self.assertRaises(ValueError):
                original.require_equal(changed)

    def test_changes_do_not_hide_removed_records_or_unchanged_values(self):
        changes = compare_records(
            {"kept": 1, "removed": 2, "changed": 3}, {"kept": 1, "added": 4, "changed": 5}
        )
        self.assertEqual(changes.added, ("added",))
        self.assertEqual(changes.removed, ("removed",))
        self.assertEqual(changes.changed, ("changed",))
        self.assertEqual(compare_records({}, {}).changed, ())

    def test_explanations_distinguish_source_assertions_legacy_and_unresolved_mappings(self):
        value = {
            "songs": {"song:a": {"song_id": "song:a", "evidence": "legacy admission"}},
            "charts": {
                "chart:a": {
                    "chart_id": "chart:a",
                    "song_id": "song:a",
                    "evidence": {"snapshot_id": "fixture:1"},
                }
            },
            "sources": {"fixture:1": {"sha256": "a" * 64}},
            "observations": {"observation": {"subject_id": "chart:a", "snapshot_id": "fixture:1"}},
            "mappings": {
                "rejected": {"subject_id": "chart:a", "state": "rejected"},
                "accepted": {"subject_id": "chart:a", "state": "accepted"},
            },
        }
        records = explain_registry(value)
        self.assertEqual(records[0]["origin"]["kind"], "legacy_origin")
        self.assertEqual(records[1]["origin"]["references"][0]["retained_bytes"], "not_checked")
        self.assertEqual(len(records[1]["outstanding"]), 1)
        self.assertEqual(
            source_references(
                {"snapshot_id": 7, "nested": ({"availability_snapshot_id": "fixture:2"}, None)}
            ),
            {"fixture:2"},
        )
        with self.assertRaisesRegex(ValueError, "Unknown"):
            explain_record(value, "absent")
        del value["sources"]["fixture:1"]
        with self.assertRaisesRegex(ValueError, "missing source"):
            explain_record(value, "chart:a")


class MetadataSelectionTests(unittest.TestCase):
    def test_latest_evidence_primary_retention_and_independent_fields(self):
        from maimai_intelligence.metadata_selection import eligible_claims

        projection = {
            "catalog": [{"chart_id": "primary"}, {"chart_id": "secondary"}, {"chart_id": "new"}],
            "navigation": {
                "charts": {
                    "primary": {"bpm": 120},
                    "secondary": {"bpm": 120, "metric_sources": {"bpm": {}}},
                    "new": {},
                }
            },
        }

        def claim(cid, value, time="2026-01-01", policy="metadata-waterfall-1"):
            return {
                "subject_id": cid,
                "field": "bpm",
                "region": None,
                "release": None,
                "value": value,
                "snapshot_id": "capture",
                "observed_at": time,
                "observation_id": time,
                "policy": policy,
            }

        sources = {"capture": {"provider": "fixture"}}
        old = {
            "first": claim("secondary", 130),
            "latest": claim("secondary", 120, "2026-02-01"),
            "unrelated": claim("new", 150, policy="unrelated"),
        }
        candidates = [
            claim("primary", 140),
            claim("secondary", 120),
            claim("secondary", 130),
            claim("new", 150),
        ]
        self.assertEqual(
            eligible_claims(projection, {"sources": sources, "claims": candidates}, old, sources),
            candidates[2:],
        )
        self.assertEqual(
            eligible_claims(
                {"catalog": [], "navigation": {"charts": {}}}, {"sources": {}, "claims": []}, {}, {}
            ),
            [],
        )

    def test_metadata_numeric_bounds_and_explicit_policy(self):
        from maimai_intelligence.metadata_policy import MetadataSourcePolicy, number

        for invalid in (None, "", True, {}, "abc", "NaN", "Infinity", 0, -1):
            self.assertIsNone(number(invalid, "bpm"))
        self.assertIsNone(number(15.1, "chart_constant"))
        self.assertEqual(number("2000", "bpm"), 2000)
        self.assertEqual(number(15, "chart_constant"), 15)
        MetadataSourcePolicy("fixture", 50)
        for label, priority in (("", 50), ("x" * 101, 50), ("fixture", -1), ("fixture", 1001)):
            with self.assertRaises(ValueError):
                MetadataSourcePolicy(label, priority)
