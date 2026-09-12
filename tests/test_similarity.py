"""Synthetic order-sensitive, directed, and cross-consumer retrieval tests."""

import copy
import json
import shutil
import subprocess
import unittest
from fractions import Fraction
from pathlib import Path

from maimai_analyzer import analyze, pattern_registry, synthetic_charts
from maimai_analyzer.catalog import build_catalog
from maimai_analyzer.similarity import (
    DEMAND_KEYS,
    FEATURE_KEYS,
    POLICY_VERSION,
    _local_run_rates,
    compact_descriptor,
    distance,
    query_profiles,
)


def profile(cid, sequence=("tap:0", "star:2", "tap:-1", "tap:0") * 3, rate=4):
    return {
        "chart_id": cid,
        "descriptor": {
            "sequence": list(sequence),
            "coverage": 1,
            "features": dict.fromkeys(FEATURE_KEYS, 0.2),
        },
        "metrics": dict.fromkeys(DEMAND_KEYS, rate),
        "tags": [
            {
                "pattern_id": "pattern.two_position_alternation",
                "status": "detected",
                "coverage": "complete",
                "occurrence_count": 1,
                "occurrences_truncated": False,
            }
        ],
        "occurrences": [
            {
                "pattern_id": "pattern.two_position_alternation",
                "occurrence_id": cid + ":run",
                "start_us": 0,
                "end_us": round(8_000_000 / rate) + 1,
                "measurements": {"onset_count": 9},
                "definition_version": "0.1.0",
                "detector_version": "0.1.0",
                "evidence": {"timing": "supported_section"},
            }
        ],
    }


def analyzed_local_rate_examples():
    query = synthetic_charts()[0]
    faster = copy.deepcopy(query)
    faster.update(
        chart_id="synthetic:faster-with-rest:STD:EXPERT:r1",
        song_id="synthetic:faster-with-rest",
        track_duration_us=16_000_000,
    )
    faster["bpm_segments"][0]["bpm"] = [150, 1]
    for onset in faster["onsets"]:
        onset["time_us"] = onset["time_us"] * 4 // 5
    slower = synthetic_charts()[1]
    # Later unrelated activity raises the query's global peak. Its selected run
    # remains 4/s, while the faster candidate runs at 5/s then rests.
    for i in range(6):
        instant = 6_500_000 + i * 200_000
        beat = Fraction(instant, 500_000)
        query["onsets"].append(
            {
                "event_id": f"extra-tap-{i}",
                "time_us": instant,
                "beat": [beat.numerator, beat.denominator],
                "role": "tap",
                "position": 5,
            }
        )
    charts = [query, faster, slower]
    metadata = [
        {
            **{
                key: chart[key]
                for key in ("chart_id", "song_id", "format", "difficulty", "revision")
            },
            "title": chart["chart_id"],
            "availability": "available",
            "source_status": "available",
            "identity_status": "exact",
            "source_id": chart["source"]["source_id"],
            "source_revision": chart["source"]["revision"],
        }
        for chart in charts
    ]
    pack, _ = build_catalog(
        metadata,
        [analyze(chart) for chart in charts],
        pattern_registry(),
        catalog_id="authored-local-rate-counterexample",
    )
    lookup = {chart["chart_id"]: chart for chart in pack["charts"]}
    return [lookup[chart["chart_id"]] for chart in charts]


class SimilarityTests(unittest.TestCase):
    def test_actual_faster_motif_with_rest_is_not_a_simpler_setting(self):
        query, faster, slower = analyzed_local_rate_examples()
        self.assertLess(faster["metrics"]["onset_rate"], query["metrics"]["onset_rate"])
        self.assertLess(faster["metrics"]["peak_onset_rate"], query["metrics"]["peak_onset_rate"])
        results = query_profiles(
            query, [faster, slower], mode="easier", pattern_id="pattern.two_position_alternation"
        )
        self.assertEqual([row["chart_id"] for row in results], [slower["chart_id"]])
        relation = results[0]["local_demand_relation"]
        self.assertEqual(relation["query"]["min"], 4)
        self.assertEqual(relation["candidate"]["max"], 2)
        # Overall similarity still reports the structural neighbor.
        self.assertTrue(query_profiles(query, [faster]))

    def test_run_cadence_is_independent_of_run_length_and_requires_exact_evidence(self):
        pattern = "pattern.two_position_alternation"
        short, long = profile("short"), profile("long")
        for chart, count in ((short, 6), (long, 32)):
            chart["occurrences"][0]["measurements"]["onset_count"] = count
            chart["occurrences"][0]["end_us"] = (count - 1) * 250_000 + 1
            self.assertEqual(_local_run_rates(chart, pattern), [4])
        long["metrics"].update(onset_rate=2)
        self.assertEqual(query_profiles(short, [long], mode="easier", pattern_id=pattern), [])
        query, candidate = profile("query"), profile("candidate", rate=2)
        for change in (
            "missing_count",
            "unknown_version",
            "truncated",
            "missing_window",
            "unknown_timing",
            "duplicate_window",
        ):
            changed = copy.deepcopy(candidate)
            occurrence = changed["occurrences"][0]
            if change == "missing_count":
                occurrence["measurements"] = {}
            elif change == "unknown_version":
                occurrence["detector_version"] = "future"
            elif change == "truncated":
                changed["tags"][0]["occurrences_truncated"] = True
            elif change == "missing_window":
                changed["tags"][0]["occurrence_count"] = 2
            elif change == "unknown_timing":
                occurrence["evidence"]["timing"] = "unknown"
            else:
                changed["occurrences"].append(copy.deepcopy(occurrence))
                changed["tags"][0]["occurrence_count"] = 2
            with self.subTest(change=change):
                self.assertEqual(
                    query_profiles(query, [changed], mode="easier", pattern_id=pattern), []
                )

    def test_selected_pattern_next_step_needs_a_local_cadence_increase(self):
        pattern = "pattern.two_position_alternation"
        query, candidate = profile("query"), profile("candidate", rate=5)
        candidate["metrics"] = {**query["metrics"], "onset_rate": 5, "peak_onset_rate": 5}
        results = query_profiles(query, [candidate], mode="next-step", pattern_id=pattern)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["local_demand_relation"]["candidate"]["min"], 5)
        candidate["occurrences"][0]["end_us"] = query["occurrences"][0]["end_us"]
        self.assertEqual(
            query_profiles(query, [candidate], mode="next-step", pattern_id=pattern), []
        )
        self.assertEqual(
            query_profiles(
                query,
                [profile("slower", rate=2)],
                mode="easier",
                pattern_id=pattern,
                lower_dimension="hold_occupancy",
            ),
            [],
        )
        for chart in (query, candidate):
            chart["tags"][0]["pattern_id"] = "pattern.slide_tap_interleave"
            chart["occurrences"][0]["pattern_id"] = "pattern.slide_tap_interleave"
        self.assertEqual(
            query_profiles(
                query, [candidate], mode="next-step", pattern_id="pattern.slide_tap_interleave"
            ),
            [],
        )

    @unittest.skipUnless(shutil.which("node"), "Node required for local-demand parity")
    def test_javascript_matches_actual_local_cadence_and_unknown_evidence(self):
        query, faster, slower = analyzed_local_rate_examples()
        unknown = copy.deepcopy(slower)
        unknown["chart_id"] = "synthetic:unknown-local-rate"
        unknown["occurrences"][0]["measurements"] = {}
        cases = [
            {
                "q": query,
                "cs": [faster, slower, unknown],
                "opts": {"mode": mode, "pattern_id": "pattern.two_position_alternation"},
            }
            for mode in ("overall", "same-pattern", "easier", "next-step")
        ]
        nq, nc = profile("next-query"), profile("next-candidate", rate=5)
        nc["metrics"] = {**nq["metrics"], "onset_rate": 5, "peak_onset_rate": 5}
        cases.append(
            {
                "q": nq,
                "cs": [nc],
                "opts": {"mode": "next-step", "pattern_id": "pattern.two_position_alternation"},
            }
        )
        runner = (
            "global.window={};require(process.argv[1]);let s='';"
            "process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{"
            "console.log(JSON.stringify(JSON.parse(s).map(c=>"
            "window.maimaiExploreSimilarity(c.q,c.cs,c.opts))))})"
        )
        output = subprocess.run(  # noqa: S603
            [
                shutil.which("node"),
                "-e",
                runner,
                str(
                    Path(__file__).resolve().parents[1]
                    / "src/maimai_intelligence/assets/explore-similarity.js"
                ),
            ],
            input=json.dumps(cases),
            text=True,
            capture_output=True,
            check=True,
        )
        for case, actual in zip(cases, json.loads(output.stdout), strict=True):
            expected = query_profiles(case["q"], case["cs"], **case["opts"])
            self.assertEqual(
                [row["chart_id"] for row in actual], [row["chart_id"] for row in expected]
            )
            self.assertEqual(
                [row.get("local_demand_relation") for row in actual],
                [row.get("local_demand_relation") for row in expected],
            )

    def test_same_counts_different_order_does_not_match(self):
        a = profile("a")
        b = profile("b", sorted(a["descriptor"]["sequence"]))
        self.assertGreater(distance(a["descriptor"], b["descriptor"])["distance"], 0.6)
        self.assertEqual(query_profiles(a, [b]), [])

    def test_slower_same_structure_is_directed_and_not_global_easier(self):
        a, b = profile("a"), profile("b", rate=2)
        result = query_profiles(
            a, [b], mode="easier", pattern_id="pattern.two_position_alternation"
        )
        self.assertEqual(result[0]["distance"], 0)
        self.assertEqual(result[0]["differences"]["onset_rate"]["delta"], -2)
        self.assertEqual(
            query_profiles(b, [a], mode="easier", pattern_id="pattern.two_position_alternation"), []
        )
        b["metrics"]["max_concurrency"] = 9
        self.assertEqual(
            query_profiles(a, [b], mode="easier", pattern_id="pattern.two_position_alternation"), []
        )

    def test_unknown_not_zero_and_selected_pattern_requires_evidence(self):
        a, b = profile("a"), profile("b")
        b["descriptor"]["coverage"] = 0.1
        self.assertIsNone(distance(a["descriptor"], b["descriptor"]))
        b = profile("b")
        b["tags"][0]["status"] = "unknown"
        self.assertEqual(
            query_profiles(
                a, [b], mode="same-pattern", pattern_id="pattern.two_position_alternation"
            ),
            [],
        )
        self.assertEqual(query_profiles(a, [b], mode="same-pattern"), [])

    def test_next_step_allows_only_the_selected_independent_demand_family(self):
        query = profile("query")
        all_higher = profile("all-higher", rate=4.8)
        self.assertEqual(query_profiles(query, [all_higher], mode="next-step"), [])
        rates = profile("rates")
        rates["metrics"].update(onset_rate=4.8, peak_onset_rate=4.8)
        self.assertEqual(query_profiles(query, [rates], mode="next-step")[0]["chart_id"], "rates")
        for key in set(DEMAND_KEYS) - {"onset_rate", "peak_onset_rate"}:
            changed = copy.deepcopy(rates)
            changed["metrics"][key] += 0.000002
            with self.subTest(prerequisite=key):
                self.assertEqual(query_profiles(query, [changed], mode="next-step"), [])
        rates["metrics"]["hold_occupancy"] += 0.000001
        self.assertEqual(len(query_profiles(query, [rates], mode="next-step")), 1)

    def test_next_step_selected_nonrate_dimension_does_not_raise_rates(self):
        query, candidate = profile("query"), profile("candidate")
        candidate["metrics"]["hold_occupancy"] = 4.4
        options = {"mode": "next-step", "lower_dimension": "hold_occupancy"}
        self.assertEqual(len(query_profiles(query, [candidate], **options)), 1)
        candidate["metrics"]["onset_rate"] = 4.1
        self.assertEqual(query_profiles(query, [candidate], **options), [])

    def test_directed_queries_require_every_prerequisite_measurement(self):
        for mode, rate in (("easier", 2), ("next-step", 4.8)):
            query, candidate = profile("query"), profile("candidate")
            candidate["metrics"].update(onset_rate=rate, peak_onset_rate=rate)
            for key in DEMAND_KEYS:
                changed = copy.deepcopy(candidate)
                changed["metrics"][key] = None
                with self.subTest(mode=mode, missing=key):
                    self.assertEqual(
                        query_profiles(
                            query,
                            [changed],
                            mode=mode,
                            pattern_id="pattern.two_position_alternation",
                        ),
                        [],
                    )

    def test_filters_before_rerank_and_discovery_scope(self):
        candidates = [profile(str(i)) for i in range(100)]
        result = query_profiles(profile("query"), candidates, eligible_ids={"99"})
        self.assertEqual([m["chart_id"] for m in result], ["99"])
        self.assertEqual(
            query_profiles(
                profile("query"),
                candidates,
                mode="discovery",
                eligible_ids={"99"},
                recorded_ids={"99"},
            ),
            [],
        )

    def test_section_can_match_inside_unrelated_whole_chart(self):
        a, b = profile("a"), profile("b", ["different"] * 20)
        section_a = {**profile("ignored"), "section_id": "phrase-a"}
        section_b = {**profile("ignored"), "section_id": "phrase-b"}
        a["sections"], b["sections"] = [section_a], [section_b]
        self.assertEqual(query_profiles(a, [b]), [])
        match = query_profiles(a, [b], mode="section", section_id="phrase-a")[0]
        self.assertEqual(match["section_id"], "phrase-b")

    def test_compact_counts_preserve_order_measure_and_input_immutability(self):
        a, b = profile("a"), profile("b")
        original = copy.deepcopy(a)
        compact = compact_descriptor(a["descriptor"])
        self.assertNotIn("sequence", compact)
        self.assertEqual(distance(compact, b["descriptor"])["distance"], 0)
        query_profiles(a, [b])
        self.assertEqual(a, original)

    @unittest.skipUnless(shutil.which("node"), "Node required for browser/Python policy parity")
    def test_javascript_matches_python_distances_and_selection(self):
        root = Path(__file__).resolve().parents[1]
        a, b, c = profile("a"), profile("b", rate=2), profile("c", ["different"] * 12)
        for item in (a, b, c):
            item["descriptor"] = compact_descriptor(item["descriptor"])
        runner = (
            "global.window={};require(process.argv[1]);let s='';"
            "process.stdin.on('data',x=>s+=x);"
            "process.stdin.on('end',()=>{const d=JSON.parse(s);"
            "console.log(JSON.stringify(window.maimaiExploreSimilarity(d.q,d.cs,d.opts)))})"
        )
        for mode in ("overall", "same-pattern", "easier", "next-step", "discovery"):
            opts = {"mode": mode, "pattern_id": "pattern.two_position_alternation"}
            output = subprocess.run(  # noqa: S603
                [
                    shutil.which("node"),
                    "-e",
                    runner,
                    str(root / "src/maimai_intelligence/assets/explore-similarity.js"),
                ],
                input=json.dumps({"q": a, "cs": [b, c], "opts": opts}),
                text=True,
                capture_output=True,
                check=True,
            )
            actual = json.loads(output.stdout)
            expected = query_profiles(a, [b, c], **opts)
            for key in ("chart_id", "distance", "coverage", "differences", "policy_version"):
                self.assertEqual([r[key] for r in actual], [r[key] for r in expected])

    @unittest.skipUnless(shutil.which("node"), "Node required for directed-policy parity")
    def test_javascript_matches_next_step_covariation_and_numeric_boundaries(self):
        query = profile("query")
        rates = profile("rates")
        rates["metrics"].update(onset_rate=4.8, peak_onset_rate=4.8)
        all_higher = profile("all-higher", rate=4.8)
        numeric_edge = copy.deepcopy(rates)
        numeric_edge["chart_id"] = "numeric-edge"
        numeric_edge["metrics"]["hold_occupancy"] += 0.000001
        outside_edge = copy.deepcopy(rates)
        outside_edge["chart_id"] = "outside-edge"
        outside_edge["metrics"]["hold_occupancy"] += 0.000002
        missing = copy.deepcopy(rates)
        missing["chart_id"] = "missing"
        missing["metrics"]["max_concurrency"] = None
        hold_only = profile("hold-only")
        hold_only["metrics"]["hold_occupancy"] = 4.4
        held_and_faster = copy.deepcopy(hold_only)
        held_and_faster["chart_id"] = "held-and-faster"
        held_and_faster["metrics"]["peak_onset_rate"] = 4.1
        candidates = [
            rates,
            all_higher,
            numeric_edge,
            outside_edge,
            missing,
            hold_only,
            held_and_faster,
        ]
        for item in [query, *candidates]:
            item["descriptor"] = compact_descriptor(item["descriptor"])
        runner = (
            "global.window={};require(process.argv[1]);let s='';"
            "process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{"
            "const d=JSON.parse(s);console.log(JSON.stringify(d.map(c=>"
            "window.maimaiExploreSimilarity(c.q,c.cs,c.opts))))})"
        )
        cases = [
            {
                "q": query,
                "cs": candidates,
                "opts": {"mode": "next-step", "lower_dimension": dimension},
            }
            for dimension in ("onset_rate", "peak_onset_rate", "hold_occupancy")
        ]
        result = subprocess.run(  # noqa: S603
            [
                shutil.which("node"),
                "-e",
                runner,
                str(
                    Path(__file__).resolve().parents[1]
                    / "src/maimai_intelligence/assets/explore-similarity.js"
                ),
            ],
            input=json.dumps(cases),
            text=True,
            capture_output=True,
            check=True,
        )
        for case, actual in zip(cases, json.loads(result.stdout), strict=True):
            expected = query_profiles(query, candidates, **case["opts"])
            self.assertEqual(
                [row["chart_id"] for row in actual], [row["chart_id"] for row in expected]
            )
            self.assertTrue(all(row["policy_version"] == POLICY_VERSION for row in actual))
