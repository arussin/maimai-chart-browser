import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


class DistributionTests(unittest.TestCase):
    def test_wheel_runs_without_report_package_or_source_checkout(self):
        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location(
            "isolated_backend", root / "build_backend/maimai_build_backend.py"
        )
        backend = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backend)
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            try:
                os.chdir(root)
                wheel = backend.build_wheel(directory)
                source = backend.build_sdist(directory)
                self.assertTrue((destination / source).is_file())
            finally:
                os.chdir(previous)
            installed = destination / "installed"
            with zipfile.ZipFile(destination / wheel) as archive:
                self.assertFalse(
                    any(name.startswith("maimai_report/") for name in archive.namelist())
                )
                archive.extractall(installed)
            code = """
import sys, pathlib, importlib.abc
sys.path.insert(0,sys.argv[1])
class BlockReport(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,*args):
  if fullname.startswith("maimai_report"): raise RuntimeError("Report dependency forbidden")
sys.meta_path.insert(0,BlockReport())
from maimai_intelligence.cli import main
from maimai_intelligence.bundles import export_report_bundle
assert main(["demo","--output",sys.argv[2]])==0
assert pathlib.Path(sys.argv[2],"index.html").is_file()
"""
            result = subprocess.run(  # noqa: S603
                [sys.executable, "-I", "-c", code, str(installed), str(destination / "site")],
                cwd=directory,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = json.loads((destination / "site/manifest.json").read_text())
            self.assertEqual(manifest["schema_version"], "1.0.0")
