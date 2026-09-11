"""Lossless wire values, expansion bounds and shipped JavaScript parity."""

import copy
import json
import shutil
import subprocess  # noqa: S404 - local Node with explicit args, no shell/network
import unittest
from pathlib import Path

from maimai_analyzer.wire import WIRE_VERSION, decode_pack, encode_pack
from maimai_intelligence.chart_intelligence import synthetic_catalog
from scripts.benchmark_chart_intelligence import repeated_catalog


def malformed_cases():
    base = {
        "wire_version": WIRE_VERSION,
        "strings": ["key"],
        "schemas": [[0]],
        "nodes": [[0, None]],
        "root": [-2, 0],
    }
    cases = []
    for changes in (
        {"wire_version": "future"},
        {"extra": 1},
        {"root": [-2, -1]},
        {"root": [-2, 3]},
        {"nodes": [[0, [-2, 0]]]},
        {"nodes": [[0, [-1, 1]]]},
        {"nodes": [[0]]},
        {"nodes": [[0, [False, 0]]]},
        {"strings": ["__proto__"]},
        {"strings": ["constructor"]},
        {"schemas": [[0, 0]]},
    ):
        cases.append({**copy.deepcopy(base), **changes})
    bomb = copy.deepcopy(base)
    bomb["nodes"] = [[-1, 0]]
    for index in range(26):
        bomb["nodes"].append([-1, [-2, index], [-2, index]])
    bomb["nodes"].append([0, [-2, 26]])
    bomb["root"] = [-2, 27]
    cases.append(bomb)
    deep = copy.deepcopy(base)
    deep["nodes"] = [[-1]]
    for index in range(65):
        deep["nodes"].append([-1, [-2, index]])
    deep["nodes"].append([0, [-2, 65]])
    deep["root"] = [-2, 66]
    cases.append(deep)
    cases.append({**copy.deepcopy(base), "schemas": [[0] * 100_001]})
    cases.append({**copy.deepcopy(base), "nodes": [[-1] + [0] * 100_001]})
    return cases


class ChartWireTests(unittest.TestCase):
    def test_repeated_benchmark_identity_keeps_internal_section_references(self):
        source = {
            "charts": [
                {
                    "chart_id": "synthetic-source",
                    "song_id": "synthetic-source",
                    "format": "STD",
                    "difficulty": "EXPERT",
                    "descriptor": {},
                    "sections": [{"section_id": "source-section"}],
                    "occurrences": [{"section_id": "source-section"}],
                    "tags": [{"representative_sections": [{"section_id": "source-section"}]}],
                }
            ]
        }
        repeated = repeated_catalog(source, 2)
        for chart in repeated["charts"]:
            expected = chart["sections"][0]["section_id"]
            self.assertEqual(chart["occurrences"][0]["section_id"], expected)
            self.assertEqual(chart["tags"][0]["representative_sections"][0]["section_id"], expected)
        self.assertNotEqual(repeated["charts"][0]["sections"], repeated["charts"][1]["sections"])

    def test_roundtrip_preserves_numbers_null_absence_lists_unicode_and_sharing(self):
        repeated = {
            "string": "譜面 </script> &",
            "null": None,
            "number": -1.25,
            "boolean": False,
            "ambiguous_list": [-1, 0],
        }
        pack = {"charts": [repeated, repeated, {}, {"null": None}], "empty": [], "zero": 0}
        wire = encode_pack(pack)
        result = decode_pack(wire)
        self.assertEqual(result, pack)
        self.assertNotIn("null", result["charts"][2])
        result["charts"][0]["null"] = "changed"
        self.assertIsNone(result["charts"][1]["null"])
        self.assertEqual(wire, encode_pack(dict(reversed(list(pack.items())))))
        self.assertIs(decode_pack(pack), pack)

    def test_current_catalog_exact_roundtrip(self):
        pack, _ = synthetic_catalog()
        self.assertEqual(decode_pack(encode_pack(pack)), pack)

    def test_invalid_schema_references_pollution_and_expansion_are_rejected(self):
        for index, case in enumerate(malformed_cases()):
            with self.subTest(case=index), self.assertRaises(ValueError):
                decode_pack(case)
        for value in (float("nan"), float("inf"), 2**53, 1e25, 10**400):
            with self.subTest(value=value), self.assertRaises(ValueError):
                encode_pack({"number": value})
        with self.assertRaises(ValueError):
            encode_pack({"prototype": None})

    @unittest.skipUnless(shutil.which("node"), "Node runtime required for decoder parity")
    def test_shipped_browser_decoder_matches_python_and_rejects_same_bad_inputs(self):
        pack, _ = synthetic_catalog()
        wire = encode_pack(pack)
        shared_value = {"nested": {"value": 1}, "array": [None, 2]}
        shared_wire = encode_pack({"charts": [shared_value, shared_value]})
        script = r"""
'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const context={window:{},TextEncoder};vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),context);
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const decode=context.window.maimaiDecodeExplorationPack;
const shared=decode(input.shared),seen=new Set();
function deeplyFrozen(value) {
  if(value===null||typeof value!=='object'||seen.has(value)) return true;
  seen.add(value);return Object.isFrozen(value)&&Object.values(value).every(deeplyFrozen);
}
function rejectsMutation(action) {try {action();return false;}catch{return true;}}
process.stdout.write(JSON.stringify({decoded:decode(input.valid),
  rejected:input.invalid.map(value=>{try {decode(value);return false;}catch{return true;}}),
  sharedIdentity:shared.charts[0]===shared.charts[1],deeplyFrozen:deeplyFrozen(shared),
  mutationRejected:[
    rejectsMutation(()=>{shared.charts=[];}),
    rejectsMutation(()=>{shared.charts[0].nested.value=3;}),
    rejectsMutation(()=>{delete shared.charts[0].nested.value;}),
    rejectsMutation(()=>{shared.charts[0].array.push(3);})],
  sharedStillOriginal:shared.charts[1].nested.value===1,
  polluted:Object.prototype.polluted===true}));
"""
        asset = (
            Path(__file__).resolve().parents[1] / "src/maimai_intelligence/assets/explore-wire.js"
        )
        completed = subprocess.run(  # noqa: S603 - explicit local decoder input
            [shutil.which("node"), "-e", script, str(asset)],
            input=json.dumps(
                {"valid": wire, "shared": shared_wire, "invalid": malformed_cases()},
                ensure_ascii=False,
            ),
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
            timeout=20,
        )
        result = json.loads(completed.stdout)
        self.assertEqual(result["decoded"], pack)
        self.assertTrue(all(result["rejected"]))
        self.assertTrue(result["sharedIdentity"])
        self.assertTrue(result["deeplyFrozen"])
        self.assertTrue(all(result["mutationRejected"]))
        self.assertTrue(result["sharedStillOriginal"])
        self.assertFalse(result["polluted"])


if __name__ == "__main__":
    unittest.main()
