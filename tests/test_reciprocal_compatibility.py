"""A source revision claim must reject both staged changes and untracked executable inputs."""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_report_compatibility import check


class ReciprocalCompatibilityTests(unittest.TestCase):
    def test_untracked_code_cannot_claim_committed_acceptance(self):
        git = shutil.which("git")
        if not git:
            self.skipTest("Git is required for exact counterpart acceptance")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry = root / "registry"
            report = root / "report"

            def run(source, *args):
                return subprocess.check_output(  # noqa: S603 -- fixed Git in synthetic repositories
                    [git, "-C", str(source), *args], stderr=subprocess.STDOUT
                )

            for source in (registry, report):
                source.mkdir()
                run(source, "init", "--quiet")
                (source / "README.md").write_text("Synthetic public repository")
                run(source, "add", "README.md")
                run(
                    source,
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--quiet",
                    "-m",
                    "Fixture",
                )
            revision = run(registry, "rev-parse", "HEAD").decode().strip()
            (report / "config").mkdir()
            (report / "config/compatibility.json").write_text(
                json.dumps(
                    {
                        "schema_version": "maimai-reciprocal-compatibility-1",
                        "registry": {
                            "repository": "arussin/maimai-chart-browser",
                            "revision": revision,
                        },
                    }
                )
            )
            run(report, "add", "config/compatibility.json")
            run(
                report,
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "Pin",
            )
            (report / "untracked-code.py").write_text('raise RuntimeError("must not execute")')
            with self.assertRaisesRegex(ValueError, "committed source"):
                check(registry, report, candidate="report", output=root / "proof")
            self.assertFalse((root / "proof").exists())
            run(report, "add", "untracked-code.py")
            with self.assertRaisesRegex(ValueError, "committed source"):
                check(registry, report, candidate="report", output=root / "proof")
