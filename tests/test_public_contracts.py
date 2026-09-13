"""Cross-language public matching and player-format acceptance tests."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

from maimai_analyzer.challenge import profile_chart
from maimai_analyzer.fixtures import synthetic_charts
from maimai_intelligence import player_data
from maimai_intelligence.provider_mapping import build_mapping
from maimai_intelligence.public_matching import ComparisonIndex
from maimai_intelligence.research_overview import chart_overview, overview_package


class PublicContracts(unittest.TestCase):
    def test_player_data_decoding_merge_and_offer_match_browser(self):
        import base64
        from copy import deepcopy

        node = shutil.which("node")
        if not node:
            self.skipTest("Node is required for player-format parity")
        player = {
            "provider": "kamaitachi",
            "game": "maimaidx",
            "username": "fixture",
            "displayName": "Synthetic 日本語 💙",
            "key": "kamaitachi:maimaidx:fixture",
        }
        older = player_data.empty(player)
        chart = {k: "" for k in player_data.CHART_FIELDS}
        chart.update(
            chartID="synthetic-chart",
            songID="synthetic-song",
            format="DX",
            difficulty="MASTER",
            title="Synthetic 日本語 💙",
            constant=130,
            inGameID=None,
        )
        older["charts"][chart["chartID"]] = chart
        record = {k: None for k in player_data.RECORD_FIELDS}
        record.update(
            chartID=chart["chartID"],
            achievement=980000,
            constant=130,
            grade="S+",
            lamp="CLEAR",
            sync="",
            displayVersion="PRiSM",
        )
        rid = player_data.digest(record)
        older["records"][rid] = record
        older["plays"]["source-play"] = rid
        snap = {
            "capturedAt": 1000,
            "phase": "after",
            "complete": True,
            "versions": ["PRiSM"],
            "pbs": {chart["chartID"]: rid},
        }
        sid = player_data.digest(snap)
        older["snapshots"][sid] = snap
        capture = {
            "capturedAt": 1000,
            "sourceKind": "session",
            "sourceID": "source-session",
            "sessionID": "source-session",
            "historyCoverage": "retained-window",
            "playIDs": ["source-play"],
            "snapshotIDs": [sid],
        }
        older["captures"][player_data.digest(capture)] = capture
        player_data.seal(older)
        newer = deepcopy(older)
        newer["snapshots"] = {}
        newer["captures"] = {}
        snap = {**snap, "capturedAt": 2000}
        newer["snapshots"][player_data.digest(snap)] = snap
        player_data.seal(newer)
        script = """
const fs=require('fs'),vm=require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1],'utf8'));
(async()=>{const core=maimaiPlayerData,inputs=JSON.parse(fs.readFileSync(0,'utf8'));
const data=await Promise.all(inputs.map(x=>core.decode(Buffer.from(x,'base64'))));
const merged=await core.merge(data[1],data[0]);await core.validate(merged);
const legacy=core.offer(merged);delete legacy.profile;core.validateOffer(legacy);
let rejected=false;
try{core.validateOffer({...legacy,profile:{rating:-1,sessionCount:0}})}catch{rejected=true;}
if(!rejected)throw new Error('Invalid profile metadata was accepted');
process.stdout.write(JSON.stringify({merged,offer:core.offer(merged)}));
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        result = subprocess.run(  # noqa: S603 -- authored synthetic data and fixed local script
            [
                node,
                "-e",
                script,
                str(
                    Path(__file__).parents[1] / "src/maimai_intelligence/assets/player-data-core.js"
                ),
            ],
            input=json.dumps(
                [base64.b64encode(player_data.encode(d)).decode() for d in [older, newer]]
            ),
            text=True,
            capture_output=True,
            check=True,
            timeout=20,
        )
        merged = player_data.merge(newer, older)
        packed = player_data.encode(merged)
        self.assertEqual(packed[4:8], b"\0\0\0\0")
        self.assertEqual(packed[9], 255, "Exports must not depend on the host OS")
        self.assertEqual(player_data.decode(packed), merged)
        self.assertEqual(
            json.loads(result.stdout), {"merged": merged, "offer": player_data.offer(merged)}
        )

    def test_pattern_and_measurement_ranking_match_browser(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is required for parity")
        raw = synthetic_charts()
        profiles = [profile_chart(c) for c in raw]
        analysis = overview_package({c["chart_id"]: chart_overview(c) for c in raw})
        script = """
const fs=require('fs'),vm=require('vm'),path=require('path');global.window=global;
const data=JSON.parse(fs.readFileSync(0,'utf8'));global.maimaiResearchCatalog=data;
global.document={getElementById:()=>({textContent:'[]'})};
for(const name of ['challenge-matching.js','chart-overview.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1],name),'utf8'));
}
const idx=maimaiChallengeMatching.createIndex(data.catalog);
const results=data.catalog.map(c=>[idx.similar(c.chart_id),
  idx.similar(c.chart_id,{patternCompare:maimaiChartOverview.compare})]);
process.stdout.write(JSON.stringify(results));
"""
        assets = Path(__file__).parents[1] / "src/maimai_intelligence/assets"
        for pattern_data in (analysis, {}):
            index = ComparisonIndex(profiles, pattern_data)
            result = subprocess.run(  # noqa: S603 -- fixed program and authored fixture JSON
                [node, "-e", script, str(assets)],
                input=json.dumps({"catalog": profiles, "analysis": pattern_data}),
                text=True,
                capture_output=True,
                check=True,
                timeout=20,
            )
            expected = [
                [index.similar(c["chart_id"], patterns=False), index.similar(c["chart_id"])]
                for c in profiles
            ]
            # JSON serialization normalizes non-significant float representation.
            self.assertEqual(json.loads(result.stdout), expected)

    def test_mapping_never_guesses_ambiguous_variant(self):
        c = {
            "chart_id": "public-a",
            "source_hash": "a" * 64,
            "title": "A song",
            "artist": "An artist",
            "format": "DX",
            "difficulty": "MASTER",
        }
        source = {
            "chartID": "provider-a",
            "legacyChartID": "old-a",
            "songID": "song",
            "difficulty": "DX MASTER",
            "levelNum": 13,
            "versions": ["prism"],
        }
        songs = [{"id": "song", "title": "A song", "artist": "An artist"}]
        mapping = build_mapping([c], [source], songs)
        self.assertEqual(mapping["charts"]["old-a"]["aliasOf"], "provider-a")
        other = {**c, "chart_id": "public-b"}
        ambiguous = build_mapping([c, other], [source], songs)
        self.assertFalse(ambiguous["charts"])
        self.assertEqual(ambiguous["unmatched"][0]["reason"], "ambiguous")
        reviewed = build_mapping(
            [c, other],
            [source],
            songs,
            overrides={
                "provider-a": {
                    "chart_id": "public-b",
                    "source_hash": "a" * 64,
                    "reason": "Authored fixture identity",
                }
            },
        )
        self.assertEqual(reviewed["charts"]["provider-a"]["chart_id"], "public-b")
