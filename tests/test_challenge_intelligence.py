"""Authored-only controls for challenge profiles, retrieval and explicit joins."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.test_simai_subset import parse

from maimai_analyzer.challenge import _tokens, path_geometry, profile_chart, snippet
from maimai_analyzer.challenge_similarity import align, query_challenges, reference_scale
from maimai_analyzer.contracts import content_hash, normalize_chart
from maimai_analyzer.dataset import identity_join, inventory_delta, review_benchmark
from maimai_analyzer.fixtures import synthetic_charts


class ChallengeTests(unittest.TestCase):
    def test_phased_pairs_require_recurrence_phase_and_alternating_roles(self):
        from maimai_analyzer.pattern_evidence import phased_pairs

        body = "(120){8}1-5[4:1]/8,2,8-4[4:1]/1,7,1-5[4:1]/8,2,8-4[4:1]/1,7,E"
        result = phased_pairs(parse(body)[0])
        self.assertEqual(len(result["occurrences"]), 1)
        self.assertEqual(result["occurrences"][0]["pair_count"], 4)
        self.assertFalse(result["automatic_community_tagging"])
        self.assertEqual(
            phased_pairs(parse(body.replace("[4:1]", "[0.75##0.5]", 1))[0])["occurrences"], []
        )
        self.assertEqual(phased_pairs(parse("(120){8}1-5[4:1]/8,2,E")[0])["occurrences"], [])

    def test_uncertain_review_is_not_rejection_or_validation(self):
        from maimai_analyzer.challenge_evaluation import evaluate_review
        from maimai_analyzer.challenge_similarity import POLICY

        benchmark = {
            "benchmark_hash": "a" * 64,
            "complete": True,
            "queries": [{"chart_id": "q", "partition": "held_out"}],
        }
        review = [{"query_id": "q", "candidates": [{"chart_id": str(i)} for i in range(5)]}]
        supplied = {
            "version": "challenge-judgments-1",
            "benchmark_hash": "a" * 64,
            "policy": POLICY,
            "judgments": [
                {
                    "query_id": "q",
                    "candidate_id": str(i),
                    "judgment": "Useful" if i < 4 else "Uncertain",
                }
                for i in range(5)
            ],
        }
        report = evaluate_review(benchmark, review, supplied)
        self.assertFalse(report["held_out_target_met"])
        self.assertEqual(report["judgment_counts"]["Uncertain"], 1)
        self.assertFalse(report["production_adoption"])
        supplied["judgments"][-1]["judgment"] = "Not useful"
        self.assertTrue(evaluate_review(benchmark, review, supplied)["held_out_target_met"])
        with self.assertRaises(ValueError):
            evaluate_review(benchmark, review, {**supplied, "benchmark_hash": "b" * 64})

    def test_offline_package_build_is_reproducible_and_checks_corruption(self):
        from tests.test_maichart_pack import REVISION, fixture

        from scripts import build_challenge_package as package
        from scripts.prepare_maichart_pack import prepare

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            root.mkdir()
            fixture(root)
            prepare(root)
            output = Path(directory) / "package"
            with patch.dict(package.SOURCE_LOCK, {"revision": REVISION}):
                with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
                    first = package.build(root, output, review_count=0)
                    again = package.build(root, output, review_count=0)
                self.assertEqual(first, again)
                self.assertEqual(first["outcomes"], {"analyzed": 1})
                cache = next((output / "profiles").glob("*.json"))
                cache.write_text("{}", encoding="utf-8")
                with self.assertRaises((ValueError, KeyError)):
                    package.build(root, output, review_count=0)

    def test_active_span_excludes_silence_and_includes_final_hold(self):
        raw, _ = parse("(120){4},,,,1,2h[2:1],,,,,,,,E")
        before = copy.deepcopy(raw)
        p = profile_chart(raw)
        self.assertEqual(
            p["active_span"], {"start_us": 2000000, "end_us": 3500000, "basis": "active_events"}
        )
        self.assertEqual(before, raw)
        self.assertEqual(p, profile_chart(raw))
        self.assertEqual({w["width_beats"] for w in p["windows"]}, {4, 8, 16})

    def test_tempo_change_uses_beats_and_snippet_keeps_active_hold(self):
        raw, _ = parse("(120){4}1h[1:4],2,3,4,(240)5,6,7,8,1,E")
        p = profile_chart(raw)
        w = next(w for w in p["windows"] if w["window_id"] == "4:4")
        self.assertEqual((w["start_us"], w["end_us"]), (2000000, 3000000))
        s = snippet(raw, w)
        self.assertEqual(len(s["holds"]), 1)
        self.assertEqual(s["holds"][0]["start_us"], 0)

    def test_rotation_across_ring_boundary_and_reflection(self):
        raw, _ = parse("(120){8}1/8,2,4,7,1,3,6,E")
        tokens = _tokens(raw["onsets"])
        rotated = copy.deepcopy(raw)
        for event in rotated["onsets"]:
            event["position"] = event["position"] % 8 + 1
        self.assertEqual(tokens, _tokens(rotated["onsets"]))
        mirror = copy.deepcopy(raw)
        for event in mirror["onsets"]:
            event["position"] = 9 - event["position"]
        self.assertNotEqual(tokens, _tokens(mirror["onsets"]))

    def test_minor_edit_does_not_require_exact_trigrams(self):
        raw, _ = parse("(120){8}1,3,2,4,1,3,2,4,E")
        tokens = _tokens(raw["onsets"])
        changed = copy.deepcopy(tokens)
        changed[3][2] = [7]
        self.assertGreater(align(tokens, changed), 0)
        self.assertLess(align(tokens, changed), 0.15)
        self.assertIsNone(align([], tokens))

    def test_geometry_unknown_is_not_substitute_path(self):
        self.assertIsNone(path_geometry("simai:1p5"))
        self.assertIsNone(path_geometry("simai:1-3-5"))
        self.assertEqual(path_geometry("simai:1v4")["points"][1], [0, 0])
        self.assertEqual(len(path_geometry("simai:1-5")["points"]), 2)

    def test_missing_groups_do_not_gain_zero_distance(self):
        raw = synthetic_charts()[0]
        missing = copy.deepcopy(raw)
        missing["capabilities"] = [
            x
            for x in raw["capabilities"]
            if x not in {"positions", "hold_intervals", "slide_movement", "slide_wait"}
        ]
        p = profile_chart(missing)
        self.assertEqual(p["demand"]["spatial"], {})
        self.assertEqual(p["demand"]["holds"], {})
        full = profile_chart(raw)
        full["song_id"] = "synthetic:other"
        self.assertEqual(query_challenges(p, [full], reference_scale([p, full])), [])

    def test_retrieval_works_offline_and_deduplicates_songs(self):
        profiles = [profile_chart(r) for r in synthetic_charts()]
        scale = reference_scale(profiles)
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            matches = query_challenges(profiles[0], profiles, scale)
        self.assertTrue(matches)
        self.assertEqual(len(matches), len({m["song_id"] for m in matches}))
        self.assertNotIn(profiles[0]["song_id"], [m["song_id"] for m in matches])
        self.assertTrue(all(m["relevance"] == "unjudged" for m in matches))

    def test_review_partition_is_stable_and_family_disjoint(self):
        profiles = []
        base = profile_chart(synthetic_charts()[0])
        for i in range(60):
            p = copy.deepcopy(base)
            p.update(
                chart_id=f"synthetic:{i}",
                song_id=f"synthetic:song:{i // 2}",
                format="STD" if i % 2 else "DX",
                source_hash=content_hash(i),
            )
            profiles.append(p)
        b = review_benchmark(profiles, count=24)
        self.assertTrue(b["complete"])
        self.assertEqual(b, review_benchmark(list(reversed(profiles)), count=24))
        families = [q["song_family"] for q in b["queries"]]
        self.assertEqual(len(families), len(set(families)))
        self.assertEqual(sum(q["partition"] == "held_out" for q in b["queries"]), 12)
        self.assertTrue(all(q["review_status"] == "unjudged" for q in b["queries"]))

    def test_identity_join_requires_reviewed_body_bound_one_to_one_mapping(self):
        source = {
            "chart_id": "source:1",
            "source_hash": "a" * 64,
            "format": "DX",
            "difficulty": "MASTER",
        }
        m = {
            "source_chart_id": "source:1",
            "report_chart_id": "report:9",
            "source_hash": "a" * 64,
            "format": "DX",
            "difficulty": "MASTER",
            "status": "reviewed",
            "evidence": "authored mapping",
        }
        overlay = {"report:9": {"score": 99}}
        self.assertEqual(identity_join(source, [m], overlay), {"score": 99})
        self.assertIsNone(identity_join(source, [], overlay))
        self.assertIsNone(identity_join(source, [m, {**m, "source_chart_id": "source:2"}], overlay))
        self.assertIsNone(identity_join({**source, "source_hash": "b" * 64}, [m], overlay))

    def test_inventory_delta_preserves_changed_and_removed(self):
        a = [{"input_id": "one", "body_sha256": "a"}, {"input_id": "two", "body_sha256": "b"}]
        b = [{"input_id": "one", "body_sha256": "c"}, {"input_id": "three", "body_sha256": "d"}]
        self.assertEqual(
            inventory_delta(a, b),
            {"added": ["three"], "removed": ["two"], "changed": {"one": ["body_sha256"]}},
        )

    def test_shared_head_unequal_waits_preserve_each_timeline(self):
        raw, audit = parse("(120){4}2-5[0.25##0.5]*-7[0.75##1],E")
        self.assertEqual(len(raw["onsets"]), 1)
        self.assertEqual(
            [(s["movement_start_us"], s["movement_end_us"]) for s in raw["slides"]],
            [(250000, 750000), (750000, 1750000)],
        )
        self.assertEqual(len({s["head_id"] for s in raw["slides"]}), 1)
        self.assertEqual(len(audit["tokens"][0]["paths"]), 2)
        normalize_chart(raw)

    def test_sealed_renderer_escapes_hostile_metadata(self):
        from maimai_intelligence.challenge_review import render_review

        html = render_review(
            {"source": {}},
            [{"title": "</script><img src=x onerror=bad>"}],
            [],
            {},
            {"benchmark_hash": "a" * 64},
        )
        self.assertNotIn("<img src=x", html)
        payload = html.split('<script id="challenge-data" type="application/json">')[1].split(
            "</script>"
        )[0]
        self.assertEqual(
            json.loads(payload)["catalog"][0]["title"], "</script><img src=x onerror=bad>"
        )


if __name__ == "__main__":
    unittest.main()
