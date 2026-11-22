"""Offline regressions for owner policy and historical release-input receipts."""

import contextlib
import io
import json
import shutil
import unittest
from copy import deepcopy
from unittest.mock import Mock, patch

from maimai_intelligence import corpus_update as corpus
from maimai_intelligence.corpus_attempts import (
    reassess_options,
    resume_options,
    verify_retained_inputs,
)
from maimai_intelligence.corpus_failures import CorpusInputError
from maimai_intelligence.serialization import digest
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts import update_catalog as owner
from tests import test_catalog_update


class PipelineFollowupTests(unittest.TestCase):
    setUp = test_catalog_update.CatalogUpdateTests.setUp
    prepare = test_catalog_update.CatalogUpdateTests.prepare

    def generic(self, **options):
        return corpus.prepare_update(
            self.store,
            self.browser,
            package=self.package,
            mai_notes_snapshot=self.snapshot,
            offline=True,
            implementation=lambda: owner.implementation_hash(),
            **options,
        )

    def historical(self, run, *, before_artwork=True):
        attempt = read_json(run / "attempt.json")
        attempt["body"]["values"].pop("release_date")
        if before_artwork:
            attempt["body"]["values"].pop("preserve_web_analytics")
            (run / "release-inputs.json").unlink()
        else:
            release = read_json(run / "release-inputs.json")
            release.pop("release_date")
            atomic_json(run / "release-inputs.json", release)
        attempt["sha256"] = digest(attempt["body"])
        atomic_json(run / "attempt.json", attempt)
        ready = read_json(run / "ready.json")
        ready["attempt_sha256"] = attempt["sha256"]
        if before_artwork:
            ready.pop("release_inputs")
        else:
            ready["release_inputs"].pop("release_date")
        ready["release"].pop("release_date", None)
        atomic_json(run / "ready.json", ready)
        return run

    def test_owner_refuses_missing_policy_before_any_external_command(self):
        for options in (
            {},
            {"preserve_web_analytics": True},
            {"export_artwork_source": self.export_source},
        ):
            with self.subTest(options=options):
                run = self.generic(**options)
                runner = Mock(side_effect=AssertionError("External command forbidden"))
                with self.assertRaisesRegex(ValueError, "Owner.*requires"):
                    owner.verify_candidate(run)
                with self.assertRaisesRegex(ValueError, "Owner.*requires"):
                    owner.publish_update(run, runner=runner)
                runner.assert_not_called()

    def test_old_legacy_verify_resume_reassess_and_owner_refusal(self):
        run = self.historical(self.generic())
        identity = read_json(run / "ready.json")["implementation_hash"]
        corpus.verify_candidate(run, implementation=lambda: identity)
        for options in (resume_options(run, identity), reassess_options(run)):
            continued = corpus.prepare_update(
                self.store, **options, implementation=lambda: identity
            )
            corpus.verify_candidate(continued, implementation=lambda: identity)
            with self.assertRaisesRegex(ValueError, "Owner.*requires"):
                owner.verify_candidate(continued)

    def registry_run(self, **options):
        from maimai_intelligence.lab import build_lab
        from maimai_intelligence.registry import write_registry
        from maimai_intelligence.registry_catalog import build_registry_package
        from tests.test_catalog_waterfall import WaterfallTests

        captured = WaterfallTests()
        captured.setUp()
        self.addCleanup(captured.doCleanups)
        value, package = captured.value, captured.package
        registry = self.root / "accepted"
        write_registry(value, registry)
        initial = self.root / "registry-package"
        build_registry_package(value, package, initial)
        browser = self.root / "registry-browser"
        build_lab(initial, browser, catalog_version="old")
        return corpus.prepare_update(
            self.store,
            browser,
            registry=registry,
            package=initial,
            offline=False,
            source_fetcher=captured.fetch,
            implementation=lambda: owner.implementation_hash(),
            **options,
        )

    def test_old_registry_replay_reassess_and_reassessment_resume(self):
        run = self.historical(self.registry_run())
        identity = read_json(run / "ready.json")["implementation_hash"]
        corpus.verify_candidate(run, implementation=lambda: identity)
        with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
            for operation in ("resume", "replay", "reassess"):
                with self.subTest(operation=operation):
                    options = (
                        reassess_options(run)
                        if operation == "reassess"
                        else resume_options(run, identity, replay=operation == "replay")
                    )
                    continued = corpus.prepare_update(
                        self.store, **options, implementation=lambda: identity
                    )
                    corpus.verify_candidate(continued, implementation=lambda: identity)
                    with self.assertRaisesRegex(ValueError, "Owner.*requires"):
                        owner.verify_candidate(continued)
                    if operation == "reassess":
                        corpus.prepare_update(
                            self.store,
                            **resume_options(continued, identity),
                            implementation=lambda: identity,
                        )
        options = resume_options(run, identity, replay=True)
        options.pop("predecessor")
        with self.assertRaisesRegex(ValueError, "public release inputs differ"):
            owner.prepare_update(self.store, **options, export_artwork_source=self.export_source)

    def test_pre_date_receipt_replay_and_explicit_date_change(self):
        run = self.historical(
            self.registry_run(
                preserve_web_analytics=True, export_artwork_source=self.export_source
            ),
            before_artwork=False,
        )
        identity = read_json(run / "ready.json")["implementation_hash"]
        owner.verify_candidate(run)
        options = resume_options(run, identity, replay=True)
        continued = corpus.prepare_update(self.store, **options, implementation=lambda: identity)
        owner.verify_candidate(continued)
        options.pop("predecessor")
        with self.assertRaisesRegex(ValueError, "public release inputs differ"):
            corpus.prepare_update(
                self.store, **options, release_date="2026-11-23", implementation=lambda: identity
            )

    def test_missing_release_receipt_is_deliberate_refusal(self):
        run = self.prepare()
        (run / "release-inputs.json").unlink()
        with self.assertRaisesRegex(ValueError, "public release inputs changed"):
            owner.verify_candidate(run)

    def test_retained_export_uses_recorded_manifest_and_relocates(self):
        run = self.prepare()
        moved = self.root / "moved"
        shutil.move(self.export_source, moved)
        locations = {"export_artwork_source": moved}
        changed = deepcopy(self.export_manifest)
        changed["assets"] = {}
        changed["jackets"] = {}
        with patch(
            "maimai_intelligence.export_artwork.read_export_artwork_manifest", return_value=changed
        ):
            verify_retained_inputs(run, input_locations=locations)
            options = reassess_options(run, input_locations=locations)
            with self.assertRaisesRegex(ValueError, "artwork.*prepare"):
                corpus.prepare_update(
                    self.store, **options, implementation=lambda: owner.implementation_hash()
                )
        identity = read_json(run / "ready.json")["implementation_hash"]
        from maimai_intelligence.cli import main

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(
                main(
                    [
                        "corpus",
                        "verify",
                        "--run",
                        str(run),
                        "--source-root",
                        str(owner.REPO_ROOT),
                        "--input",
                        f"export-artwork-source={moved}",
                    ]
                ),
                0,
            )
            self.assertEqual(
                main(
                    [
                        "corpus",
                        "resume",
                        "--from",
                        str(run),
                        "--source-root",
                        str(owner.REPO_ROOT),
                        "--input",
                        f"export-artwork-source={moved}",
                    ]
                ),
                0,
            )
        options = resume_options(run, identity, input_locations=locations)
        continued = corpus.prepare_update(self.store, **options, implementation=lambda: identity)
        owner.verify_candidate(continued)
        (moved / self.export_path).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "integrity"):
            verify_retained_inputs(run, input_locations=locations)

    def test_partial_corrupt_and_non_directory_artwork_fail_before_copy_or_capture(self):
        registry = self.root / "preflight-registry"
        registry.mkdir()
        (registry / "sentinel.json").write_text("{}")
        for mode in ("partial", "corrupt", "file", "directory"):
            with self.subTest(mode=mode):
                source = self.root / mode
                manifest = deepcopy(self.export_manifest)
                if mode == "file":
                    source.write_bytes(b"not a directory")
                else:
                    shutil.copytree(self.export_source, source)
                    target = source / self.export_path
                    if mode == "partial":
                        extra = "media/" + "a" * 64 + ".webp"
                        manifest["assets"][extra] = {
                            **manifest["assets"][self.export_path],
                            "sha256": "a" * 64,
                        }
                    elif mode == "corrupt":
                        target.write_bytes(b"corrupt")
                    else:
                        target.unlink()
                        target.mkdir()
                with (
                    patch(
                        "maimai_intelligence.export_artwork.read_export_artwork_manifest",
                        return_value=manifest,
                    ),
                    patch.object(corpus, "retain_history") as copy,
                    patch.object(corpus, "_prepare_package") as package,
                    patch.object(corpus, "capture_claims") as capture,
                ):
                    with self.assertRaises(CorpusInputError):
                        self.prepare(export_artwork_source=source, registry=registry, offline=False)
                    copy.assert_not_called()
                    package.assert_not_called()
                    capture.assert_not_called()
                run = max((self.store / "runs").iterdir(), key=lambda p: p.stat().st_mtime_ns)
                rows = [
                    json.loads(line)
                    for line in (run / "diagnostics.jsonl").read_text().splitlines()
                ]
                self.assertTrue(any(row.get("code") == "input_or_integrity" for row in rows))

    def test_owner_fallback_resolves_publication_only_inside_writer_lock(self):
        run = self.prepare()
        atomic_json(run / "publication.json", {"run": run.name})
        atomic_json(self.store / "latest.json", {"run": run.name})
        locked = False
        calls = []
        original_lock, original_public = corpus.writer_lock, corpus.published_public

        @contextlib.contextmanager
        def lock(store):
            nonlocal locked
            with original_lock(store):
                locked = True
                try:
                    yield
                finally:
                    locked = False

        def published(store):
            self.assertTrue(locked, "Publication resolved outside writer lock")
            calls.append(store)
            return original_public(store)

        with (
            patch.object(corpus, "writer_lock", lock),
            patch.object(corpus, "published_public", published),
            patch.object(owner, "published_public", published),
        ):
            self.prepare(export_artwork_source=None)
        self.assertEqual(len(calls), 1)

    def test_post_render_tampering_is_rejected(self):
        render = corpus._render_artifacts
        for location in ("source", "public"):
            with self.subTest(location=location):
                (self.export_source / self.export_path).write_bytes(self.export_raw)

                def tamper(run, *args, location=location, **kwargs):
                    result = render(run, *args, **kwargs)
                    target = self.export_source if location == "source" else run / "public"
                    (target / self.export_path).write_bytes(b"changed during render")
                    return result

                with patch.object(corpus, "_render_artifacts", tamper):
                    with self.assertRaisesRegex(CorpusInputError, "Export artwork.*preparation"):
                        self.prepare()
        self.assertFalse(list((self.store / "runs").glob("*/ready.json")))

    def test_owner_registry_refresh_and_cli_flags(self):
        run = self.registry_run(
            preserve_web_analytics=True,
            export_artwork_source=self.export_source,
            release_date="2026-11-22",
        )
        atomic_json(run / "publication.json", {"run": run.name})
        atomic_json(self.store / "latest.json", {"run": run.name})
        with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
            refreshed = owner.refresh_latest(self.store, offline=True, release_date="2026-11-23")
        self.assertEqual(
            owner.verify_candidate(refreshed)["release_inputs"]["release_date"], "2026-11-23"
        )
        import argparse

        from maimai_intelligence import corpus_cli

        parser = argparse.ArgumentParser()
        corpus_cli.add_commands(parser.add_subparsers())
        args = parser.parse_args(
            [
                "corpus",
                "prepare",
                "--store",
                str(self.root / "cli-store"),
                "--previous-browser",
                str(self.browser),
                "--package",
                str(self.package),
                "--mai-notes-snapshot",
                str(self.snapshot),
                "--export-artwork-source",
                str(self.export_source),
                "--preserve-web-analytics",
                "--release-date",
                "2026-11-22",
            ]
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            corpus_cli.execute(args)
        from pathlib import Path

        receipt = corpus.verify_candidate(Path(json.loads(output.getvalue())["run"]))
        self.assertTrue(receipt["release_inputs"]["preserve_web_analytics"])
        self.assertEqual(receipt["release_inputs"]["release_date"], "2026-11-22")

    def test_release_date_render_receipt_must_match_bound_input(self):
        run = self.prepare(release_date="2026-11-22")
        ready = read_json(run / "ready.json")
        ready["release"]["release_date"] = "2026-11-23"
        atomic_json(run / "ready.json", ready)
        with self.assertRaisesRegex(ValueError, "release date"):
            owner.verify_candidate(run)
