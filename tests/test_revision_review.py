"""False provenance and shared-process reproduction must not become acceptance evidence."""

import io
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.prepare_revision_review import committed_source, inventory, run, run_build


def archive_bytes(files):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for name, raw in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(raw)
            archive.addfile(member, io.BytesIO(raw))
    return stream.getvalue()


class RevisionReviewTests(unittest.TestCase):
    def test_exact_git_bytes_and_ignored_untracked_inputs_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "source.py").write_bytes(b"value = 1\n")
            raw = archive_bytes({"source.py": b"value = 1\n"})

            def git(source, *args):
                return {"rev-parse": b"a" * 40, "ls-files": b"", "diff": b"", "archive": raw}[
                    args[0]
                ]

            with patch("scripts.prepare_revision_review.git_bytes", side_effect=git):
                result = committed_source(root)
                self.assertEqual(result["commit"], "a" * 40)
                (root / "source.py").write_bytes(b"value = 1\r\n")
                with self.assertRaisesRegex(ValueError, "Source bytes differ"):
                    committed_source(root)
            with patch(
                "scripts.prepare_revision_review.git_bytes",
                side_effect=[b"a" * 40, b"ignored.py\0"],
            ):
                with self.assertRaisesRegex(ValueError, "untracked"):
                    committed_source(root)

    def test_each_build_has_a_fresh_process_and_honors_fixed_hash_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            modules = {
                "src/maimai_intelligence/__init__.py": "",
                "src/maimai_intelligence/lab.py": (
                    "def build_lab(*args, **kwargs):\n"
                    '    assert kwargs.get("player_maishift") is True\n'
                ),
                "scripts/__init__.py": "",
                "scripts/update_catalog.py": "def retain_history(*args): pass\n",
                "src/maimai_intelligence/public_release.py": """import json,os,sys
from types import MappingProxyType
class Plan:
    assets={}
    summary=MappingProxyType({"fixture":True,"nested":MappingProxyType({"values":(1,2)})})
    def write_review_to(self, output):
        assert not sys.flags.hash_randomization
        assert 'PYTHONPATH' not in os.environ
        output.mkdir(parents=True)
        (output/'seed.json').write_text(json.dumps(hash('fixed-seed-probe')))
def plan_public_release(*args, **kwargs): return Plan()
""",
            }
            for name, text in modules.items():
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            inputs = root / "inputs"
            inputs.mkdir()
            with patch.dict(
                os.environ, {"PYTHONPATH": "must-not-be-used", "PYTHONHASHSEED": "random"}
            ):
                first = run_build(
                    source, inputs, inputs, inputs, root / "first", "fixture", player_maishift=True
                )
                second = run_build(
                    source, inputs, inputs, inputs, root / "second", "fixture", player_maishift=True
                )
            self.assertNotEqual(first["process_id"], second["process_id"])
            self.assertEqual(first["files"], second["files"])
            self.assertEqual(first["summary"]["nested"], {"values": [1, 2]})
            self.assertEqual(first["build_options"], {"player_maishift": True})
            self.assertEqual(second["build_options"], first["build_options"])
            self.assertEqual(first["runtime"], second["runtime"])
            self.assertEqual(first["runtime"]["hash_randomization"], 0)
            module = source / "src/maimai_intelligence/public_release.py"
            module.write_text(
                "import socket\ntry: socket.create_connection(('example.invalid',443))\n"
                "except PermissionError: pass\n" + module.read_text()
            )
            with self.assertRaisesRegex(ValueError, "build failed"):
                run_build(
                    source,
                    inputs,
                    inputs,
                    inputs,
                    root / "caught-network",
                    "fixture",
                    player_maishift=True,
                )
            self.assertIn("attempted network", (root / "caught-network/build.log").read_text())

    def test_mutating_input_after_first_build_never_writes_acceptance_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            roots = [root / name for name in ("package", "retained", "previous")]
            for folder in roots:
                folder.mkdir()
                (folder / "manifest.json").write_text("original")

            def mutate(*args, **kwargs):
                (roots[0] / "manifest.json").write_text("changed")
                return {
                    "files": {},
                    "elapsed_seconds": 0,
                    "build_options": {"player_maishift": False},
                }

            with (
                patch(
                    "scripts.prepare_revision_review.committed_source",
                    return_value={"commit": "a" * 40},
                ),
                patch("scripts.prepare_revision_review.run_build", side_effect=mutate),
            ):
                with self.assertRaisesRegex(ValueError, "input changed"):
                    run(*roots, root / "output", "fixture", source=source)
            self.assertFalse((root / "output/receipt.json").exists())
            self.assertIn("manifest.json", inventory(roots[0]))


if __name__ == "__main__":
    unittest.main()
