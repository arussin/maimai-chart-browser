"""Browser decoder parity in a DOM-free VM; no browser, account or network."""

import json
import shutil
import subprocess
import tempfile
import unittest
from importlib.resources import files
from pathlib import Path

from maimai_analyzer.challenge import profile_chart
from maimai_analyzer.fixtures import synthetic_charts
from maimai_analyzer.patterns import pattern_registry
from maimai_intelligence.overview_codec import compact_overview
from maimai_intelligence.research_overview import chart_overview, overview_package

NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js is optional outside the browser CI job")
class OverviewJavaScriptTests(unittest.TestCase):
    def test_compact_browser_decoder_matches_uncompressed_analyzer_states(self):
        raw = synthetic_charts()
        expanded = overview_package({c["chart_id"]: chart_overview(c) for c in raw})
        payload = {
            "data": {
                "catalog": [profile_chart(c) for c in raw],
                "analysis": compact_overview(expanded),
            },
            "definitions": pattern_registry()["entries"],
            "expected": {cid: sorted(c["tags"]) for cid, c in expanded["charts"].items()},
        }
        script = """
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const scope={window:{},document:{getElementById(id){
  return {textContent:JSON.stringify(id==='challenge-data'?p.data:p.definitions)};
}}};
vm.runInNewContext(fs.readFileSync(process.argv[2],'utf8'),scope);
const api=scope.window.maimaiChartOverview,patterns=p.data.analysis.patterns;
for(const chart of p.data.catalog){
  const rows=api.tags(chart).map(t=>[patterns.indexOf(t.id),t.status,t.count,
    t.prevalence,t.coverage,t.truncated,t.spans,t.evidence]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)),p.expected[chart.chart_id]);
  assert.equal(api.get({...chart,source_hash:'wrong'}),null);
}
console.log('All browser tag states and evidence match the uncompressed analyzer');
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "payload.json").write_text(json.dumps(payload), encoding="utf-8")
            (root / "decoder.js").write_text(
                files("maimai_intelligence.assets")
                .joinpath("chart-overview.js")
                .read_text("utf-8"),
                encoding="utf-8",
            )
            result = subprocess.run(  # noqa: S603
                [NODE, "-e", script, str(root / "payload.json"), str(root / "decoder.js")],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
