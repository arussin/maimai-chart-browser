import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.measure_source import measure, python_metrics, web_metrics


class SourceMetricsTests(unittest.TestCase):
    def test_generated_vendor_and_test_lines_are_not_reported_as_authored(self):
        files = {
            "web/generated-assets.json": json.dumps({"assets": {"compiled.js": {}}}).encode(),
            "src/maimai_intelligence/assets/compiled.js": b"compiled();\n",
            "web/src/application.ts": b"export const value = 1;\n\n",
            "src/maimai_report/_party/contract.py": b"def vendor(): return 1\n",
            "tests/test_sample.py": b"assert True\n",
            "requirements-dev.lock": b"# pinned\n",
        }
        counts = measure(files)["categories"]
        self.assertEqual(counts["authored_code"]["physical_lines"], 2)
        self.assertEqual(counts["authored_code"]["nonblank_lines"], 1)
        self.assertEqual(counts["generated_code"]["files"], 2)
        self.assertEqual(counts["tests"]["physical_lines"], 1)
        self.assertEqual(counts["vendored_code_and_provenance"]["physical_lines"], 1)
        self.assertEqual(counts["dependency_locks"]["physical_lines"], 1)

    def test_deferred_imports_and_nested_function_complexity_are_distinct(self):
        result = python_metrics(
            {
                "src/pkg/a.py": (
                    b"from . import b\ndef outer():\n    def inner():\n"
                    b"        if True: pass\n        if True: pass\n    if True: pass\n"
                ),
                "src/pkg/b.py": b"def delayed():\n    from . import a\n",
            }
        )
        self.assertEqual(result["import_cycles"]["eager_imports"], [])
        self.assertEqual(result["import_cycles"]["all_imports"], [["pkg.a", "pkg.b"]])
        scores = {row["name"]: row["complexity"] for row in result["largest_functions"]}
        self.assertEqual(scores, {"outer": 2, "inner": 3, "delayed": 1})


class WebMetricSelectionTests(unittest.TestCase):
    def test_unavailable_is_explicit_and_generated_input_is_excluded_before_parsing(self):
        result = web_metrics(
            {
                "web/generated-assets.json": json.dumps({"assets": {"bundle.js": {}}}).encode(),
                "src/maimai_intelligence/assets/bundle.js": b"not valid source",
                "tests/helper.js": b"also not source",
                "src/report/_party/vendor.js": b"vendor",
                "web/source.js": b"function retained() {}",
            }
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertNotIn("function_count", result)
        self.assertEqual(list(result["source_files"]), ["web/source.js"])


WEB_RUNTIME = os.environ.get("MAIMAI_METRICS_WEB_RUNTIME")
NODE = shutil.which("node")


@unittest.skipUnless(
    WEB_RUNTIME and NODE,
    "Optional web metrics require explicit locked MAIMAI_METRICS_WEB_RUNTIME and Node",
)
class WebSourceMetricsTests(unittest.TestCase):
    def test_branch_count_source_locations_and_nested_function_independence(self):
        result = web_metrics(
            {
                "web/example.js": b"""function outer(flag) {
  function inner(value) { if (value && value.ready) return 1; return value ? 2 : 3; }
  if (flag) return inner(flag);
  return 0;
}
function decisions(rows, fallback=0) {
  let value=fallback;
  for (const row of rows) { if (row && row.live) value++; }
  try { while(value>3) value--; } catch(error) { value=0; }
  switch(value) { case 1: break; case 2: break; default: break; }
  return rows?.[0] ?? value;
}
""",
                "web/typed.ts": b"""interface Input { ready: boolean }
// Original source coordinates survive type erasure.
export function typed(value: Input | null): number {
  return value ? 1 : 0;
}
""",
            },
            web_runtime=WEB_RUNTIME,
            node=NODE,
        )
        scores = {row["name"]: row for row in result["largest_functions"]}
        self.assertEqual(
            {key: row["complexity"] for key, row in scores.items()},
            {
                "outer": 2,
                "inner": 4,
                "decisions": 11,
                "typed": 2,
            },
        )
        self.assertEqual(scores["typed"]["line"], 3)
        self.assertEqual(scores["typed"]["lines"], 3)
        self.assertEqual(result["languages"]["javascript"]["function_count"], 3)
        self.assertEqual(result["languages"]["typescript"]["function_count"], 1)
        self.assertEqual(result["complexity"], {"mean": 4.75, "p95": 11, "maximum": 11})
        self.assertEqual(result["runtime"]["packages"], {"acorn": "8.15.0", "esbuild": "0.28.2"})

    def test_duplicate_bodies_ignore_formatting_types_and_function_name_but_keep_values(self):
        result = web_metrics(
            {
                "web/a.js": (
                    b"function first(a) {const x=1; const y=2; "
                    b"const z=3; const t=4; return a+x+y+z+t;}"
                ),
                "web/b.ts": (
                    b"function second(a: number): number {\nconst x = 1;\n"
                    b"const y = 2;\nconst z = 3;\nconst t = 4;\n"
                    b"return a + x + y + z + t;\n}"
                ),
                "web/c.js": (
                    b"function different(a) {const x=1; const y=2; "
                    b"const z=5; const t=4; return a+x+y+z+t;}"
                ),
                "web/d.js": b"function short(a) {const x=1; const y=2; const z=3; return a+x+y+z;}",
                "web/e.js": (
                    b"function alsoShort(a) {const x=1; const y=2; const z=3; return a+x+y+z;}"
                ),
            },
            web_runtime=WEB_RUNTIME,
            node=NODE,
        )
        groups = result["identical_function_bodies_at_least_5_statements"]
        self.assertEqual(
            [[row["name"] for row in group] for group in groups], [["first", "second"]]
        )
        self.assertEqual(result["function_count"], 5)

    def test_installed_parser_must_match_the_exact_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text("{}")
            (root / "package-lock.json").write_text(
                json.dumps(
                    {
                        "packages": {
                            "": {"devDependencies": {"acorn": "8.15.0", "esbuild": "0.28.2"}},
                            "node_modules/acorn": {"version": "8.15.0"},
                        }
                    }
                )
            )
            package = root / "node_modules/acorn"
            package.mkdir(parents=True)
            (package / "package.json").write_text('{"version":"0.0.0"}')
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                web_metrics(
                    {"web/source.js": b"function example() {}"}, web_runtime=root, node=NODE
                )
            self.assertIn("differs from the exact lock", caught.exception.stderr)
