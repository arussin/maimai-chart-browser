"""The exported source claim must come from immutable Git objects, not a working tree."""

import base64
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from maimai_intelligence.contract_bundle import (
    FILES,
    canonical,
    export_bundle,
    load_bundle,
    validate_bundle,
)


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

    def test_closed_envelope_validation_and_reviewed_hash(self):
        bundle = export_bundle(self.source, self.revision)
        raw = canonical(bundle)
        archive = self.source / "bundle.json"
        archive.write_bytes(raw)
        self.assertEqual(
            load_bundle(archive, self.revision, hashlib.sha256(raw).hexdigest()), bundle
        )
        self.assertEqual(set(validate_bundle(bundle, self.revision)), set(FILES))
        mutations = [
            lambda b: b.update(extra="rejected"),
            lambda b: b.update(api_version=True),
            lambda b: b.update(upstream_revision="f" * 40),
            lambda b: b["files"].update(unknown=b["files"]["LICENSE"]),
            lambda b: b["files"]["LICENSE"].update(source_path="../private"),
            lambda b: b["files"]["LICENSE"].update(bytes=True),
            lambda b: b["files"]["LICENSE"].update(content_base64="!bad!"),
            lambda b: b["files"]["LICENSE"].update(sha256="0" * 64),
        ]
        for mutate in mutations:
            broken = deepcopy(bundle)
            mutate(broken)
            with self.assertRaises(ValueError):
                validate_bundle(broken, self.revision)
        with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
            load_bundle(archive, self.revision, "0" * 64)
        duplicate = b'{"schema_version":"ignored",' + raw[1:]
        archive.write_bytes(duplicate)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            load_bundle(archive, self.revision, hashlib.sha256(duplicate).hexdigest())
        with self.assertRaises(ValueError):
            canonical({"invalid": float("nan")})
        self.assertEqual(json.loads(raw)["upstream_revision"], self.revision)
