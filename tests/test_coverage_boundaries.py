"""Coverage policy and persistence boundaries use authored, non-player fixtures."""

import ast
import json
import ssl
import tempfile
import unittest
import urllib.error
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.catalog_capture import CaptureStore, classify_failure
from maimai_intelligence.coverage import prepare_coverage
from maimai_intelligence.coverage_policy import ArtworkCandidate, artwork_identity, choose_candidate
from maimai_intelligence.coverage_queue import complete_job, empty_work, plan_batch
from maimai_intelligence.coverage_sources import OTOGE_BASE, ArtworkSources
from maimai_intelligence.coverage_store import (
    RECEIPTS,
    checkpoint_work,
    commit_checkpoint,
    restore_checkpoint,
)
from maimai_intelligence.coverage_types import (
    CaptureError,
    Failure,
    FailureKind,
    IntegrityError,
    ReviewError,
)
from maimai_intelligence.registry import digest
from maimai_intelligence.snapshots import atomic_json, read_json
from tests import test_sustainable_coverage as fixtures
from tests.test_sustainable_coverage import identity, provider


class CoverageBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_all_1694_due_jobs_progress_despite_daily_retries_and_new_arrivals(self):
        evidence = {f"s{i:04}": "old" for i in range(1694)}
        state, _ = plan_batch(evidence, {}, empty_work(), 0)
        for job in state["jobs"].values():
            job.update(evidence="old", status="unresolved", attempts=12, next_retry=0)
        seen = set()
        for day in range(17):
            evidence.update({f"new{day}-{i}": "new" for i in range(400)})
            state, batch = plan_batch(evidence, {}, state, day * 86400)
            self.assertLessEqual(len(batch), 300)
            self.assertEqual(len(batch), len(set(batch)))
            seen.update(batch)
            for sid in batch:
                complete_job(
                    state,
                    sid,
                    status="unresolved",
                    failures=[Failure(FailureKind.TRANSPORT, "outage")],
                    now=day * 86400,
                )
        self.assertTrue({f"s{i:04}" for i in range(1694)} <= seen)

    def test_budget_deferral_does_not_acknowledge_evidence_or_advance_retry_age(self):
        state, batch = plan_batch({"a": "new", "b": "new"}, {}, empty_work(), 0)
        prior = deepcopy(state["jobs"]["a"])
        complete_job(
            state,
            "a",
            status="deferred",
            failures=[Failure(FailureKind.DEFERRED, "budget")],
            now=0,
            performed=False,
        )
        self.assertNotIn("evidence", state["jobs"]["a"])
        self.assertEqual(state["jobs"]["a"]["queue_order"], prior["queue_order"])
        self.assertEqual(state["jobs"]["a"]["attempts"], 0)
        self.assertEqual(plan_batch({"a": "new", "b": "new"}, {}, state, 1)[1], batch)

    def test_verified_tls_failure_cools_only_affected_host_and_replays_exactly(self):
        cert = ssl.SSLCertVerificationError(1, "authored TLS failure")
        cert.verify_code, cert.verify_message = 20, "unable to get local issuer certificate"
        failure = classify_failure(urllib.error.URLError(cert))
        self.assertEqual((failure.kind, failure.verify_code), (FailureKind.TLS, 20))
        calls = []

        def fetch(url, headers):
            calls.append(url)
            if "maimaidx.jp" in url:
                raise urllib.error.URLError(cert)
            return 200, b"public", {}

        store = CaptureStore(self.root, fetcher=fetch, now=100)
        jp = "https://maimaidx.jp/maimai-mobile/img/Music/a.png"
        with self.assertRaises(CaptureError):
            store.get(jp)
        with self.assertRaises(CaptureError) as held:
            store.get(jp.replace("a.png", "b.png"))
        self.assertEqual(held.exception.failure.kind, FailureKind.SOURCE_COOLDOWN)
        self.assertEqual(store.get(jp.replace("maimaidx.jp", "maimaidx-eng.com"))[0], b"public")
        self.assertEqual(len(calls), 2)
        atomic_json(self.root / "receipt.json", store.receipt())
        replay = CaptureStore(
            self.root,
            offline=True,
            replay=self.root / "receipt.json",
            fetcher=lambda *_: self.fail("replay network"),
        )
        with self.assertRaises(CaptureError) as error:
            replay.get(jp)
        self.assertEqual(error.exception.failure, failure)

    def test_retained_capture_corruption_is_a_blocker_not_a_refresh_outage(self):
        url = OTOGE_BASE + "data/music-ex.json"
        store = CaptureStore(self.root, fetcher=lambda *_: (200, b"[]", {}))
        _, reference = store.get(url)
        (self.root / "blobs" / reference["sha256"]).write_bytes(b"broken")
        with self.assertRaises(IntegrityError):
            CaptureStore(self.root, fetcher=lambda *_: self.fail("must verify before fetch")).get(
                url
            )

    def test_artwork_exact_policy_and_review_never_authorize_a_score_mapping(self):
        value, sid, _ = identity()
        metadata = value["songs"][sid]["metadata"]
        row = {"title": metadata["title"], "artist": metadata["artist"], "id": "fixture.png"}
        candidate = ArtworkCandidate(
            "otoge-db", "otoge-db:fixture", OTOGE_BASE + "jacket/fixture.png", digest(row), row, {}
        )
        counts = {artwork_identity(metadata): 1}
        self.assertEqual(choose_candidate(sid, metadata, counts, [candidate]), candidate)
        self.assertIsNone(
            choose_candidate(sid, metadata, {artwork_identity(metadata): 2}, [candidate])
        )
        self.assertIsNone(choose_candidate(sid, {"title": "", "artist": "A"}, counts, [candidate]))
        review = {
            "purpose": "artwork",
            "song_id": sid,
            "canonical_assertion": digest(metadata),
            "provider": candidate.provider,
            "source_id": candidate.source_id,
            "source_assertion": candidate.assertion,
            "evidence": "authored exact source review",
        }
        self.assertEqual(choose_candidate(sid, metadata, {}, [candidate], [review]), candidate)
        with self.assertRaises(ReviewError):
            choose_candidate(sid, {**metadata, "artist": "changed"}, counts, [candidate], [review])
        self.assertEqual(value["mappings"], {})

    def test_malformed_artwork_catalog_is_not_an_empty_success(self):
        value, _, _ = identity()
        capture = CaptureStore(self.root, fetcher=lambda *_: (200, b"[]", {}))
        sources = ArtworkSources(capture, value["songs"], providers=("lxns",))
        sources._rows("lxns")
        self.assertEqual(sources.failures["lxns"].kind, FailureKind.SCHEMA)

    def test_unrelated_source_changes_do_not_invalidate_other_song_work(self):
        value, sid, _ = identity()
        rows = [
            {"id": 1, "title": "Fixture", "artist": "Fictional Artist"},
            {"id": 2, "title": "Other", "artist": "Other Artist"},
        ]

        def evidence():
            capture = CaptureStore(
                self.root, fetcher=lambda *_: (200, json.dumps({"songs": rows}).encode(), {})
            )
            sources = ArtworkSources(capture, value["songs"], providers=("lxns",))
            return sources.evidence(sid, value["songs"][sid])

        first = evidence()
        rows[1]["title"] = "Unrelated changed title"
        self.assertEqual(first, evidence())
        rows[0]["artist"] = "Changed credit"
        self.assertNotEqual(first, evidence())

    def test_stale_local_artwork_review_is_blocked_even_during_source_outage(self):
        value, sid, _ = identity()
        review = {
            "purpose": "artwork",
            "song_id": sid,
            "provider": "lxns",
            "canonical_assertion": "0" * 64,
            "evidence": "stale fixture",
        }
        source = ArtworkSources(
            CaptureStore(self.root, fetcher=lambda *_: (_ for _ in ()).throw(OSError("outage"))),
            value["songs"],
            providers=("lxns",),
            reviews=[review],
        )
        with self.assertRaisesRegex(ReviewError, "Stale"):
            source.validate_reviews(value["songs"])

    def test_domain_modules_do_not_import_io_adapters(self):
        root = Path(__file__).parents[1] / "src/maimai_intelligence"
        forbidden = {
            "pathlib",
            "urllib",
            "socket",
            "catalog_capture",
            "artwork_store",
            "coverage_store",
            "coverage_sources",
        }
        for name in ("coverage_policy.py", "coverage_queue.py", "provider_reconciliation.py"):
            tree = ast.parse((root / name).read_text("utf-8"))
            imports = {
                node.module.split(".")[0]
                for node in ast.walk(tree)
                if isinstance(node, ast.ImportFrom) and node.module
            }
            imports.update(
                alias.name.split(".")[0]
                for node in ast.walk(tree)
                if isinstance(node, ast.Import)
                for alias in node.names
            )
            self.assertFalse(imports & forbidden, (name, imports & forbidden))

    def _batch(self):
        value, _, _ = identity()
        fixture = fixtures.CoverageTests()
        capture = CaptureStore(self.root / "captures", fetcher=fixture.fetcher(provider()))
        run, cache = self.root / "run", self.root / "coverage"
        result, _ = prepare_coverage(value, {}, capture, cache, run, now=100)
        atomic_json(run / "source-captures.json", capture.receipt())
        return value, result, run, cache

    def test_changed_producer_requires_explicit_reassessment_and_new_policy_identity(self):
        from maimai_intelligence.coverage import CONFIG
        from maimai_intelligence.coverage_store import policy_identity

        value, result, run, cache = self._batch()
        original = read_json(run / "coverage-inputs.json")["producer"]
        changed = {**original, "policy_sha256": "f" * 64}
        old_policy = policy_identity(CONFIG, {})
        with patch("maimai_intelligence.coverage_store.producer_identity", return_value=changed):
            self.assertNotEqual(policy_identity(CONFIG, {}), old_policy)
        receipt = run / "source-captures.json"
        with patch("maimai_intelligence.coverage.producer_identity", return_value=changed):
            with self.assertRaisesRegex(ValueError, "producer or policy differs"):
                prepare_coverage(
                    value,
                    {},
                    CaptureStore(self.root / "captures", offline=True, replay=receipt),
                    cache,
                    self.root / "strict",
                    offline=True,
                    replay=receipt,
                )
            reassessed, _ = prepare_coverage(
                value,
                {},
                CaptureStore(self.root / "captures", offline=True, replay=receipt),
                cache,
                self.root / "reassessed",
                offline=True,
                replay=receipt,
                reassess_policy=True,
            )
        self.assertEqual(result, reassessed)
        inputs = read_json(self.root / "reassessed/coverage-inputs.json")
        self.assertEqual(inputs["reassessment_of"], digest(read_json(run / "coverage-inputs.json")))
        self.assertEqual(inputs["producer"], changed)

    def test_completed_checkpoint_survives_publication_failure_and_process_restart(self):
        value, result, run, cache = self._batch()
        receipt = commit_checkpoint(cache, value, result, run, "policy")
        # No publication files or pointer are involved in checkpoint recovery.
        self.assertFalse((run / "ready.json").exists())
        restored, identifier = restore_checkpoint(cache, value, "policy")
        self.assertEqual(restored, result)
        self.assertEqual(identifier, receipt["checkpoint"])
        self.assertEqual(checkpoint_work(cache, identifier), read_json(run / "coverage-state.json"))
        changed = deepcopy(value)
        sid = next(iter(changed["songs"]))
        changed["songs"][sid]["metadata"]["artist"] = "new assertion"
        self.assertNotIn(
            "enrichment", restore_checkpoint(cache, changed, "policy")[0]["songs"][sid]
        )
        # Policy changes retain verified artwork, never old provider acceptance.
        policy_changed, parent = restore_checkpoint(cache, value, "next-policy")
        self.assertEqual(policy_changed["mappings"], value["mappings"])
        self.assertEqual(parent, identifier)
        commit_checkpoint(cache, value, result, run, "next-policy", predecessor=parent)

    def test_aggregate_checkpoint_still_enforces_each_registry_table_limit(self):
        from maimai_intelligence.coverage_store import read_registry_document
        from maimai_intelligence.serialization import canonical

        value, _, _ = identity(title="Authored large title " * 30)
        path = self.root / "aggregate.json"
        path.write_bytes(canonical(value))
        with (
            patch("maimai_intelligence.coverage_store.MAX_BYTES", 256),
            self.assertRaisesRegex(ValueError, "table exceeds"),
        ):
            read_registry_document(path)

    def test_staged_corruption_never_gets_a_completion_record(self):
        value, result, run, cache = self._batch()
        from maimai_intelligence import coverage_store

        original = coverage_store._validate_staged

        def corrupt(root, path, manifest):
            (path / "result.json").write_bytes(b"corrupt staged bytes")
            return original(root, path, manifest)

        with (
            patch.object(coverage_store, "_validate_staged", side_effect=corrupt),
            self.assertRaisesRegex(ValueError, "integrity"),
        ):
            commit_checkpoint(cache, value, result, run, "policy")
        self.assertFalse((cache / "checkpoint.json").exists())
        self.assertFalse(any((cache / "checkpoints").glob("*/complete.json")))

    def test_semantic_registry_digest_is_verified_even_if_file_hashes_match(self):
        value, result, run, cache = self._batch()
        receipt = commit_checkpoint(cache, value, result, run, "policy")
        from maimai_intelligence.coverage_store import _validate_staged

        path = cache / "checkpoints" / receipt["checkpoint"]
        manifest = read_json(path / "complete.json")
        manifest["result_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "semantic registry identity"):
            _validate_staged(cache, path, manifest)

    def test_interruption_before_checkpoint_pointer_is_idempotent_and_tampering_blocks(self):
        value, result, run, cache = self._batch()
        from maimai_intelligence import coverage_store

        original = coverage_store.atomic_json

        def interrupted(path, payload):
            if Path(path).name == "checkpoint.json":
                raise OSError("authored interruption after completion")
            return original(path, payload)

        with (
            patch.object(coverage_store, "atomic_json", side_effect=interrupted),
            self.assertRaises(OSError),
        ):
            commit_checkpoint(cache, value, result, run, "policy")
        self.assertFalse((cache / "checkpoint.json").exists())
        restored, identifier = restore_checkpoint(cache, value, "policy")
        self.assertEqual(restored, result)
        self.assertEqual(read_json(cache / "checkpoint.json")["checkpoint"], identifier)
        receipt = commit_checkpoint(cache, value, result, run, "policy")
        checkpoint = cache / "checkpoints" / receipt["checkpoint"]
        (checkpoint / RECEIPTS[0]).write_text("tampered")
        with self.assertRaisesRegex(ValueError, "integrity"):
            restore_checkpoint(cache, value, "policy")
