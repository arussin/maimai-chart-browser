"""Relocated actual corpus preparation with immutable evidence and no warm indexes."""

import contextlib
import io
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.corpus_attempts import bind_attempt, reassess_options, resume_options
from maimai_intelligence.corpus_update import prepare_update, verify_candidate
from maimai_intelligence.coverage import producer_identity
from maimai_intelligence.coverage_types import IntegrityError
from maimai_intelligence.lab import build_lab
from maimai_intelligence.official_inventory import assertion
from maimai_intelligence.registry import empty, write_registry
from maimai_intelligence.registry_catalog import build_registry_package
from maimai_intelligence.snapshots import read_json
from tests import test_sustainable_coverage as fixtures
from tests.registry_fixture import admit, official_row


class RegistryRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = self.root / "original"
        self.original.mkdir()
        row = official_row("Fixture", "Fictional Artist")
        value, _ = admit(empty(), [row])
        sid = next(iter(value["songs"]))
        value, _ = admit(
            value,
            [row],
            region="INTL",
            decisions={
                assertion(row): {"action": "link", "song_id": sid, "evidence": "fictional review"}
            },
        )
        self.inputs = self.original / "inputs"
        write_registry(value, self.inputs / "registry")
        build_registry_package(value, None, self.inputs / "package")
        build_lab(self.inputs / "package", self.inputs / "browser", catalog_version="fictional")
        fixture_fetch = fixtures.CoverageTests().fetcher(fixtures.provider())

        def fetch(url, headers):
            if url.startswith(("https://mai-notes.com/", "https://dp4p6x0xfi5o9")):
                raise OSError("fictional unavailable metadata")
            return fixture_fetch(url, headers)

        self.network = patch("socket.socket", side_effect=AssertionError("Network forbidden"))
        self.network.start()
        self.addCleanup(self.network.stop)
        with contextlib.redirect_stdout(io.StringIO()):
            self.first = prepare_update(
                self.original / "store",
                self.inputs / "browser",
                registry=self.inputs / "registry",
                package=self.inputs / "package",
                source_fetcher=fetch,
                implementation=lambda: "old-code",
            )
        self.expected = verify_candidate(self.first, implementation=lambda: "old-code")["files"]
        self.original_attempt = (self.first / "attempt.json").read_bytes()

    def restore(self):
        restored = self.root / "restored"
        shutil.copytree(self.inputs, restored / "inputs")
        old_store = self.original / "store"
        store = restored / "store"
        run = store / "runs" / self.first.name
        run.mkdir(parents=True)
        # Keep run receipts only. Public/browser/package/registry output trees are derived.
        for path in self.first.glob("*.json"):
            shutil.copyfile(path, run / path.name)
        for name in ("waterfall/sources/blobs", "coverage/checkpoints", "coverage/media"):
            shutil.copytree(old_store / "cache" / name, store / "cache" / name)
        # Deliberately omit URLs, conversions, analysis cache, queue pointer and old outputs.
        for name in ("waterfall/sources/urls", "coverage/conversions", "waterfall/transcriptions"):
            self.assertFalse((store / "cache" / name).exists())
        shutil.rmtree(self.original)
        self.assertFalse(self.original.exists())
        locations = {
            "previous_browser": restored / "inputs/browser",
            "package": restored / "inputs/package",
            "registry": restored / "inputs/registry",
        }
        return store, run, locations

    def test_strict_replay_from_restored_evidence_matches_without_original_or_warm_cache(self):
        store, old, locations = self.restore()
        with contextlib.redirect_stdout(io.StringIO()):
            new = prepare_update(
                store,
                implementation=lambda: "old-code",
                **resume_options(old, "old-code", replay=True, input_locations=locations),
            )
        self.assertEqual(
            self.expected, verify_candidate(new, implementation=lambda: "old-code")["files"]
        )
        self.assertEqual((old / "attempt.json").read_bytes(), self.original_attempt)
        self.assertFalse((store / "latest.json").exists())
        self.assertFalse((store / "cache/coverage/checkpoint.json").exists())

    def test_changed_code_reassessment_recomputes_artwork_and_preserves_producer_lineage(self):
        store, old, locations = self.restore()
        with self.assertRaisesRegex(ValueError, "policy changed"):
            resume_options(old, "new-code", replay=True, input_locations=locations)
        original_producer = producer_identity()
        changed = {**original_producer, "policy_sha256": "f" * 64}
        from maimai_intelligence.artwork_store import thumbnail

        with (
            patch("maimai_intelligence.coverage.producer_identity", return_value=changed),
            patch("maimai_intelligence.artwork_store.thumbnail", wraps=thumbnail) as convert,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            new = prepare_update(
                store,
                implementation=lambda: "new-code",
                **reassess_options(old, input_locations=locations),
            )
        self.assertGreater(convert.call_count, 0)
        self.assertEqual(
            self.expected, verify_candidate(new, implementation=lambda: "new-code")["files"]
        )
        inputs = read_json(new / "coverage-inputs.json")
        self.assertEqual(inputs["producer"], changed)
        self.assertIsNotNone(inputs["reassessment_of"])
        self.assertEqual(read_json(old / "coverage-inputs.json")["producer"], original_producer)
        self.assertEqual((old / "attempt.json").read_bytes(), self.original_attempt)
        # Resume the reassessment using its own producer, never the old producer's code.
        with (
            patch("maimai_intelligence.coverage.producer_identity", return_value=changed),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            resumed = prepare_update(
                store, implementation=lambda: "new-code", **resume_options(new, "new-code")
            )
        self.assertEqual(
            verify_candidate(new, implementation=lambda: "new-code")["files"],
            verify_candidate(resumed, implementation=lambda: "new-code")["files"],
        )

    def test_missing_or_tampered_immutable_evidence_blocks_before_preparation(self):
        store, old, locations = self.restore()
        source = next((store / "cache/waterfall/sources/blobs").iterdir())
        asset = next((store / "cache/coverage/media").iterdir())
        for path in (source, asset):
            raw = path.read_bytes()
            for replacement in (None, b"tampered"):
                if replacement is None:
                    path.unlink()
                else:
                    path.write_bytes(replacement)
                with self.subTest(path=path.name, missing=replacement is None):
                    with self.assertRaises((ValueError, OSError, IntegrityError)):
                        reassess_options(old, input_locations=locations)
                path.write_bytes(raw)
        self.assertEqual(len(list((store / "runs").iterdir())), 1)

    def test_failed_render_keeps_restored_checkpoint_and_does_not_publish(self):
        store, old, locations = self.restore()
        checkpoint = read_json(old / "coverage-checkpoint.json")["checkpoint"]
        complete = store / "cache/coverage/checkpoints" / checkpoint / "complete.json"
        before = complete.read_bytes()
        with (
            patch(
                "maimai_intelligence.corpus_update._render_artifacts",
                side_effect=OSError("fixture render"),
            ),
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(OSError, "fixture render"),
        ):
            prepare_update(
                store,
                implementation=lambda: "new-code",
                **reassess_options(old, input_locations=locations),
            )
        self.assertEqual(complete.read_bytes(), before)
        self.assertFalse((store / "latest.json").exists())
        failed = next(path for path in (store / "runs").iterdir() if path != old)
        self.assertFalse((failed / "ready.json").exists())
        self.assertTrue((failed / "coverage-checkpoint.json").is_file())
        with contextlib.redirect_stdout(io.StringIO()):
            recovered = prepare_update(
                store, implementation=lambda: "new-code", **resume_options(failed, "new-code")
            )
        self.assertEqual(
            self.expected, verify_candidate(recovered, implementation=lambda: "new-code")["files"]
        )

    def test_changed_producer_cannot_reuse_warm_artwork_conversion(self):
        old = self.first
        producer = producer_identity()
        changed = {**producer, "policy_sha256": "e" * 64}
        from maimai_intelligence.artwork_store import thumbnail

        with (
            patch("maimai_intelligence.coverage.producer_identity", return_value=changed),
            patch("maimai_intelligence.artwork_store.thumbnail", wraps=thumbnail) as convert,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            new = prepare_update(
                self.original / "store", implementation=lambda: "new-code", **reassess_options(old)
            )
        self.assertGreater(convert.call_count, 0)
        self.assertEqual(
            self.expected, verify_candidate(new, implementation=lambda: "new-code")["files"]
        )
        self.assertTrue((new / "coverage-checkpoint.json").exists())

    def test_preparation_rejects_changed_capture_selection_after_options_are_verified(self):
        for operation in ("replay", "reassess"):
            options = (
                reassess_options(self.first)
                if operation == "reassess"
                else resume_options(self.first, "old-code", replay=True)
            )
            options["replay_sources"] = self.root / "unbound/source-captures.json"
            with self.assertRaisesRegex(ValueError, "verified predecessor offline"):
                bind_attempt(
                    self.first.parent / "20260924T000000Z-ffffffff",
                    options,
                    "old-code",
                    options["predecessor"],
                )
