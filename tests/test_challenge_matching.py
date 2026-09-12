import json
import shutil
import subprocess
import unittest
from pathlib import Path

from maimai_analyzer.challenge import profile_chart
from maimai_analyzer.challenge_similarity import query_demands, reference_scale
from maimai_analyzer.fixtures import synthetic_charts


class PublicComparisonTests(unittest.TestCase):
    def test_public_summary_matching_has_python_javascript_parity(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is not available")
        profiles = [profile_chart(chart) for chart in synthetic_charts()]
        for p in profiles:
            p.pop("windows")
        scale = reference_scale(profiles)
        cases = []
        for profile in profiles:
            for eligible in (None, [p["chart_id"] for p in profiles[::2]], []):
                cases.append(
                    {
                        "id": profile["chart_id"],
                        "eligible": eligible,
                        "expected": query_demands(profile, profiles, scale, eligible_ids=eligible),
                    }
                )
        original = json.dumps(profiles, sort_keys=True)
        script = """
const fs=require('node:fs'),vm=require('node:vm');
vm.runInThisContext(fs.readFileSync(process.argv[1],'utf8'));
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const index=globalThis.maimaiChallengeMatching.createIndex(input.profiles);
process.stdout.write(JSON.stringify(input.cases.map(c=>index.similar(c.id,{eligibleIds:c.eligible}))));
"""
        result = subprocess.run(  # noqa: S603 - fixed Node program and authored JSON fixtures.
            [
                node,
                "-e",
                script,
                str(
                    Path(__file__).parents[1]
                    / "src/maimai_intelligence/assets/challenge-matching.js"
                ),
            ],
            input=json.dumps({"profiles": profiles, "cases": cases}),
            text=True,
            capture_output=True,
            check=True,
            timeout=20,
        )
        self.assertEqual(json.loads(result.stdout), [case["expected"] for case in cases])
        self.assertEqual(json.dumps(profiles, sort_keys=True), original)

    def test_query_excludes_self_and_song_variants_and_obeys_filters(self):
        profiles = [profile_chart(chart) for chart in synthetic_charts()]
        scale = reference_scale(profiles)
        query = profiles[0]
        matches = query_demands(query, profiles, scale)
        by_id = {p["chart_id"]: p for p in profiles}
        self.assertNotIn(query["chart_id"], [m["chart_id"] for m in matches])
        self.assertTrue(all(by_id[m["chart_id"]]["song_id"] != query["song_id"] for m in matches))
        self.assertEqual(query_demands(query, profiles, scale, eligible_ids=[]), [])
        for limit in (0, 101, True):
            with self.assertRaises(ValueError):
                query_demands(query, profiles, scale, limit=limit)
