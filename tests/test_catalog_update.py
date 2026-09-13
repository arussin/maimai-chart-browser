import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_analyzer.dataset import SOURCE_LOCK
from maimai_intelligence.lab import build_lab
from maimai_intelligence.research_package import extend_package
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts import update_catalog as update
from tests.lab_fixture import write_package
from tests.mai_notes_fixture import encoded


class CatalogUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = write_package(self.root / "package", grouped=True, constants=True)
        self.charts = json.loads((self.package / "catalog.json").read_bytes())
        self.browser = self.root / "browser"
        build_lab(self.package, self.browser, catalog_version="old")
        self.snapshot = self.root / "mai-notes.json"
        self.snapshot.write_bytes(encoded(self.charts, unavailable={1}))
        self.store = self.root / "updates"

    def prepare(self, **kwargs):
        return update.prepare_update(
            self.store,
            self.browser,
            package=self.package,
            mai_notes_snapshot=self.snapshot,
            **kwargs,
        )

    def test_complete_repeated_candidates_preserve_history_and_do_not_publish(self):
        original = update.file_inventory(self.browser)
        with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
            first, second = self.prepare(offline=True), self.prepare(offline=True)
        a, b = update.verify_candidate(first), update.verify_candidate(second)
        self.assertNotEqual(first, second)
        self.assertEqual(a["catalog_version"], b["catalog_version"])
        self.assertEqual(a["files"], b["files"])
        self.assertFalse((self.store / "latest.json").exists())
        self.assertEqual(update.file_inventory(self.browser), original)
        self.assertEqual(len(read_json(first / "public/manifest.json")["releases"]), 2)
        self.assertEqual(read_json(first / "changes.json")["changed"], [])
        self.assertFalse(any("mai-notes.json" in p for p in a["files"]))
        self.assertNotIn(
            "UNRELATED_SCORE_SENTINEL",
            "".join(
                (first / "public" / p).read_text("utf-8") for p in a["files"] if p.endswith(".json")
            ),
        )
        (first / "public/index.html").write_text("tampered", "utf-8")
        with self.assertRaisesRegex(ValueError, "Candidate changed"):
            update.verify_candidate(first)

    def test_download_failure_and_interrupted_write_leave_latest_intact(self):
        self.store.mkdir()
        atomic_json(self.store / "latest.json", {"run": "accepted"})
        with self.assertRaises(OSError):
            update.prepare_update(
                self.store,
                self.browser,
                package=self.package,
                fetcher=lambda: (_ for _ in ()).throw(OSError("denied")),
            )
        with patch.object(update, "build_public_release", side_effect=OSError("interrupted")):
            with self.assertRaises(OSError):
                self.prepare()
        self.assertEqual(read_json(self.store / "latest.json"), {"run": "accepted"})
        for run in (self.store / "runs").iterdir():
            self.assertFalse((run / "ready.json").exists())
            self.assertEqual(read_json(run / "state.json")["status"], "failed")
        self.assertFalse((self.store / "writer.lock").exists())
        with update.writer_lock(self.store):
            with self.assertRaisesRegex(ValueError, "running or was interrupted"):
                self.prepare()

    def runner(self, args, **kwargs):
        self.calls.append(args)
        joined = " ".join(args)
        if "api user" in joined:
            return self.actor
        if "branch --show-current" in joined:
            return "main"
        if "status --porcelain" in joined:
            return ""
        if "rev-parse HEAD" in joined or "/branches/main" in joined:
            return "f" * 40
        if "project list" in joined:
            return json.dumps([{"Project Name": "maimai-party", "Git Provider": "No"}])
        if "pages deploy" in joined:
            self.deployed = True
            return "Deployment complete https://123abc.maimai-party.pages.dev"
        raise AssertionError(args)

    def test_publish_guards_owner_and_verifies_before_advancing_latest(self):
        run = self.prepare()
        self.calls, self.actor, self.deployed = [], "contributor", False
        with self.assertRaisesRegex(ValueError, "Only arussin"):
            update.publish_update(run, runner=self.runner)
        self.assertFalse(self.deployed)
        self.actor = "arussin"

        def fetch(url):
            return (
                (run / "public/manifest.json").read_bytes()
                if self.deployed
                else b'{"default":"old"}'
            )

        result = update.publish_update(run, runner=self.runner, fetch_manifest=fetch)
        self.assertEqual(read_json(self.store / "latest.json"), result)
        self.assertEqual(result["deployment"], "https://123abc.maimai-party.pages.dev")
        update.publish_update(run, runner=self.runner, fetch_manifest=fetch)
        self.assertEqual(sum("deploy" in call for call in self.calls), 1)

    def test_stale_base_and_uncertain_upload_never_advance_latest_or_auto_retry(self):
        run = self.prepare()
        self.calls, self.actor, self.deployed = [], "arussin", False
        with self.assertRaisesRegex(ValueError, "live catalog changed"):
            update.publish_update(
                run, runner=self.runner, fetch_manifest=lambda _: b'{"default":"new"}'
            )
        self.assertFalse(self.deployed)
        with self.assertRaisesRegex(ValueError, "verification is incomplete"):
            update.publish_update(
                run, runner=self.runner, fetch_manifest=lambda _: b'{"default":"old"}'
            )
        self.assertTrue(self.deployed)
        self.assertFalse((self.store / "latest.json").exists())
        with self.assertRaisesRegex(ValueError, "upload was attempted"):
            update.publish_update(run, runner=self.runner)

    def test_source_pipeline_uses_reviewed_pin_and_reuses_analysis_cache(self):
        from tests.test_maichart_pack import REVISION, fixture

        source = self.store / "sources" / REVISION
        source.mkdir(parents=True)
        fixture(source)

        def artwork(package, output, cache, **kwargs):
            return extend_package(package, output, {})

        with (
            patch.dict(SOURCE_LOCK, {"revision": REVISION}),
            patch("scripts.prepare_public_artwork.prepare", side_effect=artwork),
            patch("socket.socket", side_effect=AssertionError("Network forbidden")),
        ):
            first = self.root / "first"
            first.mkdir()
            update.source_package(first, self.store, REVISION, self.root / "art", offline=True)
            second = self.root / "second"
            second.mkdir()
            with patch(
                "scripts.build_challenge_package.profile_chart",
                side_effect=AssertionError("cache miss"),
            ):
                update.source_package(second, self.store, REVISION, self.root / "art", offline=True)
            self.assertEqual(read_json(second / "profiles/work.json")["work"]["cache_hits"], 1)
        with self.assertRaisesRegex(ValueError, "SOURCE_LOCK"):
            update.source_package(self.root / "wrong", self.store, "0" * 40, self.root / "art")
