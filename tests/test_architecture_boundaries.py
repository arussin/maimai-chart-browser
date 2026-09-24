"""Dependency direction is an executable release requirement, including lazy imports."""

import ast
import unittest
from pathlib import Path

from scripts.measure_source import python_metrics

ROOT = Path(__file__).resolve().parents[1]
PURE = {
    "maimai_analyzer.chart_input",
    "maimai_analyzer.rational",
    *(
        "maimai_intelligence." + name
        for name in (
            "catalog_loading",
            "song_catalog",
            "corpus_policy",
            "corpus_explain",
            "catalog_schema",
            "coverage_policy",
            "coverage_queue",
            "coverage_types",
            "enrichment",
            "identity_policy",
            "metadata_policy",
            "metadata_selection",
            "metadata_claims",
            "refresh_policy",
            "release_transition",
            "release_composition",
            "recovery_policy",
            "official_contract",
            "serialization",
        )
    ),
}
FORBIDDEN = {
    "pathlib",
    "os",
    "socket",
    "urllib",
    "requests",
    "http",
    "tempfile",
    "subprocess",
    "time",
}


class ArchitectureBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = {
            path.relative_to(ROOT).as_posix(): path.read_bytes()
            for folder in ("src", "scripts", "build_backend")
            for path in (ROOT / folder).rglob("*.py")
        }
        cls.metrics = python_metrics(cls.files)

    def test_no_python_import_cycles_including_deferred_imports(self):
        self.assertEqual(self.metrics["import_cycles"]["all_imports"], [])

    def test_pure_domain_dependencies_cannot_reach_transport_storage_or_clocks(self):
        graph = self.metrics["import_edges"]
        visited, pending = set(), list(PURE)
        while pending:
            module = pending.pop()
            if module in visited:
                continue
            visited.add(module)
            self.assertIn(module, graph)
            pending.extend(graph[module])
            path = "src/" + module.replace(".", "/") + ".py"
            self.assertIn(path, self.files)
            tree = ast.parse(self.files[path])
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and not node.level:
                    imports = [node.module or ""]
                else:
                    imports = []
                for name in imports:
                    # URL encoding/parsing is pure; urllib.request remains forbidden.
                    if name != "urllib.parse":
                        self.assertNotIn(name.split(".")[0], FORBIDDEN, (module, name))
                    self.assertNotEqual(name, "importlib.resources", module)
                if isinstance(node, ast.Call):
                    if isinstance(node.func, ast.Name):
                        self.assertNotIn(
                            node.func.id, {"open", "__import__", "eval", "exec"}, module
                        )
                    elif isinstance(node.func, ast.Attribute):
                        self.assertNotIn(
                            node.func.attr,
                            {
                                "now",
                                "utcnow",
                                "read_bytes",
                                "read_text",
                                "write_bytes",
                                "write_text",
                            },
                            module,
                        )

    def test_installed_preparation_never_imports_owner_scripts(self):
        for module, imports in self.metrics["import_edges"].items():
            if module.startswith(("maimai_intelligence", "maimai_analyzer")):
                self.assertFalse(
                    any(name == "scripts" or name.startswith("scripts.") for name in imports),
                    module,
                )
