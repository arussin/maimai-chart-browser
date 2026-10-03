import hashlib
import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from maimai_intelligence.publication_capacity import read_capacity_review, stage_capacity_review


def capacity_fixture(directory, *, verified_at=None):
    """Fictional owner evidence for local tests; never claims a real entitlement."""
    directory = Path(directory)
    directory.mkdir(exist_ok=True)
    evidence = {}
    for purpose in ("entitlement", "cost", "upload_method"):
        raw = json.dumps({"fictional": True, "purpose": purpose}).encode()
        name = purpose + ".json"
        (directory / name).write_bytes(raw)
        evidence[purpose] = {"path": name, "sha256": hashlib.sha256(raw).hexdigest()}
    value = {
        "schema_version": "pages-capacity-review-1",
        "profile": "pages-paid-100000",
        "account_id": "a" * 32,
        "project": "fictional-preview",
        "plan": "pro",
        "verified_at": (verified_at or datetime.now(UTC)).isoformat(),
        "billing": {"amount": 25, "currency": "USD", "interval": "month"},
        "upload_method": "wrangler-direct-upload-v4",
        "evidence": evidence,
    }
    path = directory / "review.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


class PublicationCapacityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path, self.digest = capacity_fixture(self.root)

    def test_staging_binds_evidence_and_excludes_unrelated_private_files(self):
        (self.root / "unrelated.json").write_text("private")
        expected = read_capacity_review(self.path, self.digest)
        staged = self.root / "staged"
        self.assertEqual(stage_capacity_review(self.path, self.digest, staged), expected)
        self.assertEqual(len(list(staged.iterdir())), 4)
        self.assertFalse((staged / "unrelated.json").exists())
        (staged / "cost.json").write_text("changed")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            read_capacity_review(staged / "review.json", self.digest)

    def test_hash_staleness_and_missing_evidence_reject_capacity(self):
        with self.assertRaisesRegex(ValueError, "hash or size"):
            read_capacity_review(self.path, "0" * 64)
        checked = datetime.fromisoformat(json.loads(self.path.read_bytes())["verified_at"])
        for instant in (checked - timedelta(seconds=1), checked + timedelta(hours=25)):
            with (
                self.subTest(instant=instant),
                self.assertRaisesRegex(ValueError, "stale or.*future"),
            ):
                read_capacity_review(self.path, self.digest, now=instant)
        (self.root / "entitlement.json").unlink()
        with self.assertRaises(FileNotFoundError):
            read_capacity_review(self.path, self.digest)

    def test_rejected_inputs_cannot_opt_into_a_paid_profile(self):
        original = json.loads(self.path.read_bytes())
        mutations = [
            {"plan": []},
            {"profile": "unlimited"},
            {"account_id": "unknown"},
            {"project": "../production"},
            {"upload_method": "dashboard"},
            {"billing": {"amount": float("inf"), "currency": "USD", "interval": "month"}},
            {"billing": {"amount": 25, "currency": "USD", "interval": []}},
            {"extra": True},
            {"evidence": {}},
        ]
        for mutation in mutations:
            raw = json.dumps({**original, **mutation}).encode()
            self.path.write_bytes(raw)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                read_capacity_review(self.path, hashlib.sha256(raw).hexdigest())
        raw = (
            json.dumps(original).replace('"plan": "pro"', '"plan": "free", "plan": "pro"').encode()
        )
        self.path.write_bytes(raw)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            read_capacity_review(self.path, hashlib.sha256(raw).hexdigest())
