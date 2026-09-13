"""Play identity must come from source evidence, not similar-looking scores."""

import json
import shutil
import subprocess
import unittest
from copy import deepcopy
from pathlib import Path

from maimai_intelligence import player_data as core

LEGACY = "legacy:" + "a" * 64


def fixture():
    data = core.empty(
        {
            "provider": "kamaitachi",
            "game": "maimaidx",
            "username": "fixture",
            "displayName": "Fixture",
            "key": "kamaitachi:maimaidx:fixture",
        }
    )
    chart = {k: "" for k in core.CHART_FIELDS}
    chart.update(
        chartID="chart",
        songID="song",
        format="DX",
        difficulty="EXPERT",
        constant=100,
        inGameID=None,
    )
    data["charts"]["chart"] = chart
    record = {k: None for k in core.RECORD_FIELDS}
    record.update(
        chartID="chart",
        achievement=970000,
        timeAchieved=1000,
        grade="S",
        rate=194,
        constant=100,
        lamp="CLEAR",
        sync="",
        displayVersion="old",
        maxCombo=120,
    )
    for pid, row in [("source-play", record), (LEGACY, {**record, "maxCombo": None})]:
        ref = core.digest(row)
        data["records"][ref] = row
        data["plays"][pid] = ref
    for when in [2000, 3000, 4000]:
        snap = {
            "capturedAt": when,
            "phase": "after",
            "complete": True,
            "versions": ["new"],
            "pbs": {"chart": core.digest(record)},
        }
        data["snapshots"][core.digest(snap)] = snap
    capture = {
        "capturedAt": 4000,
        "sourceKind": "sync",
        "sourceID": "fixture",
        "sessionID": "",
        "historyCoverage": "retained-window",
        "playIDs": list(data["plays"]),
        "snapshotIDs": list(data["snapshots"]),
    }
    data["captures"][core.digest(capture)] = capture
    return core.seal(data)


def reseal(data):
    data["captures"] = {core.digest(c): c for c in data["captures"].values()}
    return core.seal(data)


class ReconciliationTests(unittest.TestCase):
    def test_summary_copy_resolves_without_changing_pbs_or_source_observations(self):
        old = fixture()
        original = deepcopy(old)
        new = core.reconcile(old)
        self.assertEqual(list(new["plays"]), ["source-play"])
        self.assertEqual(new["records"], old["records"])
        self.assertEqual(new["snapshots"], old["snapshots"])
        self.assertEqual(core.current(new), core.current(old))
        self.assertEqual(old, original)
        self.assertEqual(core.reconcile(new), new)
        self.assertEqual(core.merge(old, new, old), new)
        self.assertEqual(core.merge(new, old), new)
        self.assertEqual(core.decode(core.encode(new)), new)

    def test_equal_scores_with_distinct_source_ids_and_ambiguous_summaries_survive(self):
        for second in ["another-source-play", "legacy:" + "b" * 64]:
            data = fixture()
            data["plays"][second] = data["plays"]["source-play"]
            next(iter(data["captures"].values()))["playIDs"].append(second)
            data = reseal(data)
            self.assertEqual(core.reconcile(data), data)

    def test_matching_across_unrelated_captures_is_not_enough(self):
        data = fixture()
        capture = next(iter(data["captures"].values()))
        other = {**deepcopy(capture), "capturedAt": 5000, "playIDs": [LEGACY]}
        capture["playIDs"] = ["source-play"]
        data["captures"][core.digest(other)] = other
        data = reseal(data)
        self.assertEqual(core.reconcile(data), data)

    def test_conflicting_known_fields_and_missing_play_times_are_not_guessed(self):
        for change in [{"maxCombo": 99}, {"timeAchieved": None}, {"timeAchieved": 0}]:
            data = fixture()
            row = {**data["records"][data["plays"][LEGACY]], **change}
            data["records"][core.digest(row)] = row
            data["plays"][LEGACY] = core.digest(row)
            data = reseal(data)
            self.assertEqual(core.reconcile(data), data)

    def test_browser_reconciliation_matches_python_and_snapshots_never_become_plays(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is required for browser parity")
        assets = Path(__file__).parents[1] / "src/maimai_intelligence/assets/player-data-core.js"
        script = """
const fs=require('fs'),vm=require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1],'utf8'));
(async()=>{const c=maimaiPlayerData,old=JSON.parse(fs.readFileSync(0,'utf8'));
const next=await c.reconcile(await c.validate(old));await c.validate(next);
const again=await c.merge(next,old),history=c.chartHistory(next,['chart']);
const noPlays={...next,plays:{}};
process.stdout.write(JSON.stringify({next,again,history,empty:c.chartHistory(noPlays,['chart'])}));
})().catch(e=>{console.error(e);process.exit(1)});
"""
        data = fixture()
        result = json.loads(
            subprocess.run(  # noqa: S603 -- fixed local code and fictional input
                [node, "-e", script, str(assets)],
                input=json.dumps(data),
                text=True,
                capture_output=True,
                check=True,
                timeout=20,
            ).stdout
        )
        expected = core.reconcile(data)
        self.assertEqual(result["next"], expected)
        self.assertEqual(result["again"], expected)
        self.assertEqual(len(result["history"]["plays"]), 1)
        self.assertEqual(result["history"]["plays"][0]["time"], 1000)
        self.assertEqual(len(result["history"]["changes"]), 1)
        self.assertEqual(result["history"]["changes"][0]["time"], 2000)
        self.assertEqual(result["empty"]["plays"], [])
        self.assertEqual(len(result["empty"]["changes"]), 1)

    def test_browser_preserves_ambiguous_plays_and_only_groups_unchanged_pbs(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is required for browser parity")
        cases = []
        for second in ["another-source-play", "legacy:" + "b" * 64]:
            data = fixture()
            data["plays"][second] = data["plays"]["source-play"]
            next(iter(data["captures"].values()))["playIDs"].append(second)
            cases.append(reseal(data))
        data = fixture()
        original = data["records"][data["plays"]["source-play"]]
        improved = {**original, "achievement": 990000, "grade": "SS", "rate": 210}
        data["records"][core.digest(improved)] = improved
        snapshots = list(data["snapshots"].values())
        snapshots[-1]["pbs"]["chart"] = core.digest(improved)
        data["snapshots"] = {core.digest(s): s for s in snapshots}
        next(iter(data["captures"].values()))["snapshotIDs"] = list(data["snapshots"])
        cases.append(reseal(data))
        assets = Path(__file__).parents[1] / "src/maimai_intelligence/assets/player-data-core.js"
        script = """
const fs=require('fs'),vm=require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1],'utf8'));
(async()=>{const c=maimaiPlayerData,inputs=JSON.parse(fs.readFileSync(0,'utf8')),results=[];
for(const d of inputs){const next=await c.reconcile(await c.validate(d));
results.push({next,history:c.chartHistory(next,['chart'])});}
process.stdout.write(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1)});
"""
        results = json.loads(
            subprocess.run(  # noqa: S603 -- fixed local code and fictional input
                [node, "-e", script, str(assets)],
                input=json.dumps(cases),
                text=True,
                capture_output=True,
                check=True,
                timeout=20,
            ).stdout
        )
        for data, result in zip(cases, results, strict=True):
            self.assertEqual(result["next"], core.reconcile(data))
        self.assertEqual(len(results[0]["history"]["plays"]), 3)
        self.assertEqual(len(results[1]["history"]["plays"]), 3)
        self.assertEqual([r["time"] for r in results[2]["history"]["changes"]], [4000, 2000])
        self.assertEqual(len(results[2]["history"]["plays"]), 1)
