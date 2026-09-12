import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence import snapshots
from tests.personal_fixture import fixture


class DownloaderTests(unittest.TestCase):
    def setUp(self):
        _, sample, _, _, _ = fixture()
        self.pbs = {"success": True, "body": sample["pbs"]}
        self.recent = {"success": True, "body": {"scores": sample["attempts"]}}
        self.cutoff = sample["cutoff_ms"]

    def client(self, pbs=None, recent=None):
        outer = self

        class Client:
            def read_scores(self, username, game):
                return copy.deepcopy((pbs or outer.pbs, recent or outer.recent))

        return Client()

    def test_http_surface_is_two_reads_with_no_import(self):
        calls = []

        def opener(request, timeout):
            calls.append(request)
            return io.BytesIO(json.dumps(self.pbs if len(calls) == 1 else self.recent).encode())

        client = snapshots.KamaitachiDownloader("secret-fixture-token", opener=opener)
        client.read_scores("person / name", "maimaidx")
        self.assertEqual([r.method for r in calls], ["GET", "GET"])
        self.assertTrue(calls[0].full_url.endswith("person%20%2F%20name/games/maimaidx/pbs/all"))
        self.assertTrue(calls[1].full_url.endswith("/scores/recent"))
        self.assertFalse(any("X-user-intent" in r.headers for r in calls))

    def test_failed_read_never_creates_store(self):
        class Broken:
            def read_scores(self, *args):
                raise ValueError("download failed")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "store"
            with self.assertRaises(ValueError):
                snapshots.download_snapshot(root, "fictional", "maimaidx", downloader=Broken())
            self.assertFalse(root.exists())

    def test_repeat_is_idempotent_and_history_accumulates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            a = snapshots.download_snapshot(
                root, "fictional", "maimaidx", downloader=self.client(), cutoff_ms=self.cutoff
            )
            original = {
                p.relative_to(root): p.read_bytes() for p in (root / "captures").rglob("*.json")
            }
            b = snapshots.download_snapshot(
                root, "fictional", "maimaidx", downloader=self.client(), cutoff_ms=self.cutoff
            )
            self.assertEqual(a, b)
            self.assertEqual(len(snapshots.read_json(root / "manifest.json")["captures"]), 1)
            recent = copy.deepcopy(self.recent)
            recent["body"]["scores"] = [
                {
                    **recent["body"]["scores"][0],
                    "scoreID": "new-attempt",
                    "timeAchieved": self.cutoff + 1,
                }
            ]
            c = snapshots.download_snapshot(
                root,
                "fictional",
                "maimaidx",
                downloader=self.client(recent=recent),
                cutoff_ms=self.cutoff + 2,
            )
            self.assertEqual(len(c["attempts"]), len(a["attempts"]) + 1)
            self.assertFalse(c["coverage"]["history_complete"])
            for path, content in original.items():
                self.assertEqual((root / path).read_bytes(), content)

    def test_interrupted_manifest_write_preserves_latest_and_retry_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshots.download_snapshot(
                root, "fictional", "maimaidx", downloader=self.client(), cutoff_ms=self.cutoff
            )
            before = (root / "manifest.json").read_bytes()
            atomic = snapshots.atomic_json

            def fail(path, value):
                if Path(path).name == "manifest.json":
                    raise OSError("simulated interruption")
                return atomic(path, value)

            with (
                patch.object(snapshots, "atomic_json", side_effect=fail),
                self.assertRaises(OSError),
            ):
                snapshots.download_snapshot(
                    root,
                    "fictional",
                    "maimaidx",
                    downloader=self.client(),
                    cutoff_ms=self.cutoff + 1,
                )
            self.assertEqual((root / "manifest.json").read_bytes(), before)
            result = snapshots.download_snapshot(
                root, "fictional", "maimaidx", downloader=self.client(), cutoff_ms=self.cutoff + 1
            )
            self.assertEqual(
                snapshots.read_json(root / "manifest.json")["latest"], result["snapshot_id"]
            )

    def test_conflicting_attempt_and_wrong_account_preserve_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshots.download_snapshot(
                root, "fictional", "maimaidx", downloader=self.client(), cutoff_ms=self.cutoff
            )
            before = (root / "manifest.json").read_bytes()
            changed = copy.deepcopy(self.recent)
            changed["body"]["scores"][0]["scoreData"]["percent"] = 1
            with self.assertRaises(ValueError):
                snapshots.download_snapshot(
                    root,
                    "fictional",
                    "maimaidx",
                    downloader=self.client(recent=changed),
                    cutoff_ms=self.cutoff + 1,
                )
            with self.assertRaises(ValueError):
                snapshots.download_snapshot(
                    root, "other", "maimaidx", downloader=self.client(), cutoff_ms=self.cutoff + 1
                )
            self.assertEqual((root / "manifest.json").read_bytes(), before)

    def test_lock_refuses_concurrent_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".capture-lock").touch()
            with self.assertRaisesRegex(ValueError, "locked"):
                snapshots.download_snapshot(
                    root, "fictional", "maimaidx", downloader=self.client(), cutoff_ms=self.cutoff
                )
