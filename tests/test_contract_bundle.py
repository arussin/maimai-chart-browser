"""The exported source claim must come from immutable Git objects, not a working tree."""

import base64
import hashlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from maimai_intelligence.contract_bundle import FILES, canonical, export_bundle


class ContractBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name)
        self.git = shutil.which("git")
        if not self.git:
            self.skipTest("Git is required for exact-commit export")
        self.run_git("init", "--quiet")
        for name, relative in FILES.items():
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(("committed " + name + "\n").encode())
        self.run_git("add", ".")
        self.run_git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Synthetic contract",
        )
        self.revision = self.run_git("rev-parse", "HEAD").decode().strip()

    def run_git(self, *arguments):
        return subprocess.run(  # noqa: S603 -- isolated synthetic repository, fixed Git executable
            [self.git, "-C", str(self.source), *arguments], check=True, capture_output=True
        ).stdout

    def test_export_is_deterministic_and_ignores_dirty_untracked_files(self):
        before = canonical(export_bundle(self.source, self.revision))
        for relative in FILES.values():
            (self.source / relative).write_text("unreviewed local changes", encoding="utf-8")
        (self.source / "private-input.json").write_text("never exported", encoding="utf-8")
        after = canonical(export_bundle(self.source, self.revision))
        self.assertEqual(before, after)
        bundle = export_bundle(self.source, self.revision)
        self.assertEqual(set(bundle["files"]), set(FILES))
        for name, entry in bundle["files"].items():
            raw = base64.b64decode(entry["content_base64"], validate=True)
            self.assertEqual(raw, ("committed " + name + "\n").encode())
            self.assertEqual(entry["bytes"], len(raw))
            self.assertEqual(entry["sha256"], hashlib.sha256(raw).hexdigest())

    def test_missing_or_ambiguous_revision_is_rejected(self):
        for revision in ("HEAD", self.revision[:12], "-" * 40, "0" * 40):
            with self.subTest(revision=revision), self.assertRaises(ValueError):
                export_bundle(self.source, revision)

    def test_missing_allowlisted_blob_fails_without_using_worktree_fallback(self):
        self.run_git("rm", "--quiet", "LICENSE")
        self.run_git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Incomplete synthetic contract",
        )
        revision = self.run_git("rev-parse", "HEAD").decode().strip()
        (self.source / "LICENSE").write_text("local fallback must not be used")
        with self.assertRaises(ValueError):
            export_bundle(self.source, revision)
