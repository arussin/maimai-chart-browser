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
        kwargs.setdefault("offline", True)
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

    def test_refresh_preserves_retained_public_maishift_capability(self):
        enabled_browser = self.root / "enabled-browser"
        build_lab(self.package, enabled_browser, catalog_version="old", player_maishift=True)
        preceding = self.root / "preceding-public"
        update.build_public_release(enabled_browser, preceding)
        run = self.prepare(previous_public=preceding)
        receipt = update.verify_candidate(run)
        self.assertEqual(receipt["browser_features"], {"maishift": True})
        self.assertEqual(
            read_json(run / "public/browser-config.json")["features"], {"maishift": True}
        )
        disabled = self.prepare(previous_public=preceding, player_maishift=False)
        self.assertEqual(update.verify_candidate(disabled)["browser_features"], {"maishift": False})

    def test_retained_legacy_capability_is_parsed_without_execution(self):
        root = self.root / "legacy-capabilities"
        root.mkdir()
        path = root / "player-import-config.js"
        for enabled in (True, False):
            path.write_text(
                "globalThis.maimaiPlayerFeatures ||= Object.freeze({maishift:"
                + str(enabled).lower()
                + "});",
                encoding="utf-8",
            )
            self.assertEqual(update.retained_browser_features(root), {"maishift": enabled})
        path.write_text("arbitraryCode();", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Unknown retained"):
            update.retained_browser_features(root)

    def test_paid_capacity_is_private_bound_and_target_specific(self):
        from tests.test_publication_capacity import capacity_fixture

        path, digest = capacity_fixture(self.root / "capacity-input")
        run = self.prepare(capacity_review=path, capacity_sha256=digest)
        receipt = update.verify_candidate(run)
        self.assertEqual(receipt["release"]["capacity"]["review_sha256"], digest)
        self.assertFalse(any("capacity" in name for name in receipt["files"]))
        self.calls, self.actor, self.deployed = [], "arussin", False
        with self.assertRaisesRegex(ValueError, "different publication target"):
            update.publish_update(run, runner=self.runner)
        self.assertFalse(self.deployed)
        self.assertFalse((run / "publish-attempt.json").exists())
        (run / "capacity/cost.json").write_text("changed")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            update.verify_candidate(run)
        with self.assertRaisesRegex(ValueError, "required together"):
            self.prepare(capacity_review=path)

    def test_prepare_retains_preceding_public_references_and_binds_inputs(self):
        preceding = self.root / "preceding-public"
        update.build_public_release(self.browser, preceding)
        before = read_json(preceding / "manifest.json")
        run = self.prepare(previous_public=preceding)
        receipt = update.verify_candidate(run)
        self.assertTrue(receipt["previous_public"]["historical_references_verified"])
        self.assertEqual(
            receipt["previous_public"]["inputs"], update.previous_public_identity(preceding)
        )
        after = read_json(run / "public/manifest.json")
        for old in before["releases"]:
            current = next(row for row in after["releases"] if row["version"] == old["version"])
            for key in ("startup", "startup_shared"):
                if key in old:
                    self.assertEqual(current[key], old[key])
                    path = old[key]["path"]
                    self.assertEqual(
                        (preceding / path).read_bytes(), (run / "public" / path).read_bytes()
                    )
        self.assertEqual(
            read_json(preceding / "permalinks.json"), read_json(run / "public/permalinks.json")
        )
        atomic_json(run / "previous-public.json", {"version": "changed"})
        with self.assertRaisesRegex(ValueError, "preceding public inputs changed"):
            update.verify_candidate(run)

    def test_source_replay_rejects_different_preceding_public_inputs(self):
        preceding = self.root / "preceding-public"
        update.build_public_release(self.browser, preceding)
        prior = self.root / "prior-replay"
        atomic_json(prior / "source-captures.json", {})
        atomic_json(prior / "previous-public.json", update.previous_public_identity(preceding))
        with self.assertRaisesRegex(ValueError, "preceding public inputs differ"):
            self.prepare(
                registry=self.root / "unused-registry",
                replay_sources=prior / "source-captures.json",
            )

    def test_verified_pointer_supplies_public_history_and_rejects_unbound_candidate(self):
        retained, unbound = self.prepare(), self.prepare()
        publication = {"run": retained.name}
        atomic_json(retained / "publication.json", publication)
        atomic_json(self.store / "latest.json", publication)
        with self.assertRaisesRegex(ValueError, "does not bind the preceding publication"):
            update.verify_candidate(unbound)
        other_public = self.root / "other-public"
        update.build_public_release(self.browser, other_public)
        with self.assertRaisesRegex(ValueError, "does not bind the current preceding publication"):
            self.prepare(previous_public=other_public)
        failed = [
            path
            for path in (self.store / "runs").iterdir()
            if read_json(path / "state.json")["status"] == "failed"
        ]
        self.assertTrue(failed)
        self.assertTrue(all(not (path / "ready.json").exists() for path in failed))
        bound = self.prepare()
        self.assertEqual(
            update.verify_candidate(bound)["previous_public"]["inputs"],
            update.previous_public_identity(retained / "public"),
        )
        (self.store / "latest.json").unlink()
        with self.assertRaisesRegex(ValueError, "supply --previous-public"):
            self.prepare()

    def test_publish_rejects_unbound_live_historical_manifest(self):
        run = self.prepare()
        preceding = self.root / "preceding-public"
        update.build_public_release(self.browser, preceding)
        self.calls, self.actor, self.deployed = [], "arussin", False
        with self.assertRaisesRegex(ValueError, "live preceding publication"):
            update.publish_update(
                run,
                runner=self.runner,
                fetch_manifest=lambda _: (preceding / "manifest.json").read_bytes(),
            )
        self.assertFalse(self.deployed)
        self.assertFalse((run / "publish-attempt.json").exists())

    def test_cli_passes_explicit_preceding_public_input(self):
        with patch.object(
            update, "prepare_update", return_value=self.root / "candidate"
        ) as prepare:
            update.main(
                [
                    "prepare",
                    "--store",
                    str(self.store),
                    "--previous-browser",
                    str(self.browser),
                    "--previous-public",
                    str(self.root / "public"),
                    "--package",
                    str(self.package),
                ]
            )
        self.assertEqual(prepare.call_args.kwargs["previous_public"], self.root / "public")

    def test_readiness_rejects_changed_dependency_pins_and_build_policy(self):
        implementation_root = self.root / "implementation"
        inputs = [
            "requirements-dev.txt",
            "requirements-localization.txt",
            "pyproject.toml",
            "web/package-lock.json",
            "web/build.mjs",
            "web/generated-assets.json",
            "usage-worker/wrangler.jsonc",
            "usage-worker/worker.ts",
            "usage-worker/migrations/0001.sql",
            "config/coverage-reviews.json",
        ]
        for name in inputs:
            path = implementation_root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("accepted input")
        original_hash = update.implementation_hash
        with patch.object(
            update,
            "verified_source_implementation_hash",
            lambda _: original_hash(implementation_root),
        ):
            run = self.prepare()
            update.verify_candidate(run)
            for name in inputs:
                path = implementation_root / name
                path.write_text("changed pin or policy")
                with (
                    self.subTest(changed=name),
                    self.assertRaisesRegex(ValueError, "Candidate changed"),
                ):
                    update.verify_candidate(run)
                path.write_text("accepted input")
            update.verify_candidate(run)

    def test_download_failure_and_interrupted_write_leave_latest_intact(self):
        retained = self.prepare()
        publication = {"run": retained.name}
        atomic_json(retained / "publication.json", publication)
        atomic_json(self.store / "latest.json", publication)
        with self.assertRaisesRegex(ValueError, "explicit registry"):
            update.prepare_update(
                self.store,
                self.browser,
                package=self.package,
                fetcher=lambda: (_ for _ in ()).throw(OSError("denied")),
            )
        with patch.object(
            update.corpus_update, "build_public_release", side_effect=OSError("interrupted")
        ):
            with self.assertRaises(OSError):
                self.prepare()
        self.assertEqual(read_json(self.store / "latest.json"), publication)
        for run in (self.store / "runs").iterdir():
            if run.resolve() == retained.resolve():
                continue
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
                "maimai_intelligence.source_preparation.build_challenge_package.profile_chart",
                side_effect=AssertionError("cache miss"),
            ):
                update.source_package(second, self.store, REVISION, self.root / "art", offline=True)
            self.assertEqual(read_json(second / "profiles/work.json")["work"]["cache_hits"], 1)
        with self.assertRaisesRegex(ValueError, "SOURCE_LOCK"):
            update.source_package(self.root / "wrong", self.store, "0" * 40, self.root / "art")
