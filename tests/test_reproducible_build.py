"""Acceptance failures must be observable, including missing sdist inputs and network attempts."""

import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path, PurePosixPath

from scripts.verify_reproducible_build import extract_sdist, run_build, verify

BACKEND = """import gzip,io,tarfile,zipfile
from pathlib import Path, PurePosixPath
FILES=['requirements-dev.lock','payload.txt','build_backend/maimai_build_backend.py']
def build_wheel(output):
    target=Path(output);target.mkdir(exist_ok=True)
    with zipfile.ZipFile(target/'fixture.whl','w') as archive:
        archive.writestr(zipfile.ZipInfo('fixture/data.txt',(2020,1,1,0,0,0)),Path('payload.txt').read_bytes())
    return 'fixture.whl'
def build_sdist(output):
    target=Path(output);target.mkdir(exist_ok=True)
    with (target/'fixture.tar.gz').open('wb') as stream:
        with gzip.GzipFile(filename='',mode='wb',fileobj=stream,mtime=0) as compressed:
            with tarfile.open(fileobj=compressed,mode='w') as archive:
                for name in FILES:
                    raw=Path(name).read_bytes();info=tarfile.TarInfo('fixture/'+name);info.size=len(raw);info.mtime=0
                    archive.addfile(info,io.BytesIO(raw))
    return 'fixture.tar.gz'
"""


class ReproducibleBuildTests(unittest.TestCase):
    def test_two_independent_builds_and_source_archive_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "build_backend").mkdir()
            (source / "build_backend/maimai_build_backend.py").write_text(BACKEND)
            (source / "payload.txt").write_bytes(b"fictional byte identity\n")
            (source / "requirements-dev.lock").write_text("# no third-party build dependencies\n")
            before = (source / "payload.txt").read_bytes()
            result = verify(source, root / "proof")
            self.assertTrue(result["passed"])
            self.assertTrue(all(result["checks"].values()))
            self.assertEqual(result["runtime"]["implementation"], "CPython")
            self.assertEqual((source / "payload.txt").read_bytes(), before)
            self.assertFalse((source / "artifacts").exists())
            with self.assertRaisesRegex(ValueError, "external"):
                verify(source, source / "output")

    def test_registry_generated_check_is_required_for_overall_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "build_backend").mkdir()
            (source / "build_backend/maimai_build_backend.py").write_text(BACKEND)
            (source / "payload.txt").write_text("Synthetic")
            (source / "requirements-dev.lock").write_text("# fixture")
            (source / "web").mkdir()
            (source / "web/package-lock.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "Reproducibility mismatch"):
                verify(source, root / "proof")
            receipt = json.loads((root / "proof/receipt.json").read_text())
            self.assertTrue(receipt["archive_checks_passed"])
            self.assertFalse(receipt["generated_verification_complete"])
            self.assertFalse(receipt["passed"])
            self.assertEqual(receipt["status"], "incomplete")

    def test_missing_sdist_input_and_even_caught_network_attempt_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "build_backend").mkdir()
            backend = source / "build_backend/maimai_build_backend.py"
            backend.write_text(BACKEND.replace("'payload.txt',", ""))
            (source / "payload.txt").write_text("synthetic")
            (source / "requirements-dev.lock").write_text("# fixture")
            with self.assertRaisesRegex(ValueError, "Build failed"):
                verify(source, root / "missing")
            backend.write_text(
                "def build_wheel(output):\n    import socket\n"
                "    try: socket.create_connection(('example.invalid',443))\n"
                "    except PermissionError: pass\n    return 'ignored.whl'\n"
            )
            with self.assertRaisesRegex(ValueError, "attempted network"):
                run_build(source, "wheel")

    def test_archive_traversal_and_links_are_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, link in (("../escape.txt", False), ("fixture/link", True)):
                archive = root / "bad.tar.gz"
                with tarfile.open(archive, "w:gz") as stream:
                    entry = tarfile.TarInfo(name)
                    if link:
                        entry.type = tarfile.SYMTYPE
                        entry.linkname = "../../escape"
                    else:
                        entry.size = 1
                    stream.addfile(entry, None if link else io.BytesIO(b"x"))
                with self.assertRaisesRegex(ValueError, "Unsafe"):
                    extract_sdist(archive, root / "unpacked")
                self.assertFalse((root / "escape.txt").exists())

    def test_canonical_command_has_no_network_and_read_only_source_mounts(self):
        from scripts.run_canonical_reproduction import container_command

        args = container_command(
            "/usr/bin/docker",
            PurePosixPath("/source"),
            PurePosixPath("/toolkit"),
            PurePosixPath("/output"),
            PurePosixPath("/node"),
            PurePosixPath("/cache"),
            "python@sha256:" + "a" * 64,
            web=True,
        )
        self.assertIn("--network=none", args)
        self.assertIn("/source:/input:ro", args)
        self.assertIn("/toolkit:/toolkit:ro", args)
        self.assertIn("/node:/node:ro", args)
        self.assertEqual(args[-2:], ["--npm-cache", "/npm-cache"])
