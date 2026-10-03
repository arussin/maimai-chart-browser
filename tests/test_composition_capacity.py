"""Fictional capacity approvals in temporary directories, never owner authority."""

import json
import tempfile
import unittest
from dataclasses import FrozenInstanceError, asdict, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence import release_assembly as assembly
from maimai_intelligence.capacity_policy import DEFAULT_FILES, PAID_FILES, CapacityAuthority
from maimai_intelligence.publication_capacity import ReviewedCapacity, read_capacity_review
from maimai_intelligence.release_composition import MAX_FILE_BYTES, ArtifactInventory, InventoryFile
from maimai_intelligence.release_transition import Fingerprint
from tests import test_release_assembly as assembly_fixture
from tests import test_release_composition as composition_fixture
from tests.test_publication_capacity import capacity_fixture


class CompositionCapacityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="fictional-composition-capacity-")
        self.addCleanup(temporary.cleanup)
        self.now = datetime.now(UTC)
        self.path, self.digest = capacity_fixture(Path(temporary.name), verified_at=self.now)
        self.capacity = read_capacity_review(self.path, self.digest, now=self.now)
        self.fixture = composition_fixture.ReleaseCompositionTests()
        self.fixture.setUp()

    def plan(self, **options):
        return self.fixture.plan(
            capacity=options.pop("capacity", self.capacity),
            capacity_checked_at=options.pop("capacity_checked_at", self.now),
            **options,
        )

    def assembly_fixture(self):
        fixture = assembly_fixture.ReleaseAssemblyTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.plan = assembly.plan_release_composition(
            fixture.old_inventory,
            fixture.new_inventory,
            target="candidate",
            ownership=fixture.plan.files,
            baseline_runtime=fixture.old_runtime,
            candidate_runtime=fixture.new_runtime,
            capacity=self.capacity,
            capacity_checked_at=self.now,
        )
        return fixture

    def test_paid_review_can_reach_the_complete_composition_boundary(self):
        plan = self.plan()
        self.assertEqual(plan.max_files, PAID_FILES)
        self.assertEqual(plan.capacity.receipt(), self.capacity.receipt())
        self.assertIs(type(plan.capacity), CapacityAuthority)
        self.assertIsNot(plan.capacity, self.capacity)
        self.assertEqual(plan, self.plan(capacity_checked_at=self.now + timedelta(seconds=1)))
        with self.assertRaises(FrozenInstanceError):
            plan.capacity.project = "another-project"

    def test_complete_assembly_binds_the_exact_review_and_rechecks_inputs(self):
        fixture = self.assembly_fixture()
        fixture.run_assembly(capacity=self.capacity)
        receipt = json.loads(fixture.receipt.read_bytes())
        self.assertEqual(receipt["capacity"], self.capacity.receipt())
        self.assertEqual(receipt["plan"]["capacity"]["review_sha256"], self.digest)
        self.assertEqual(receipt["plan"]["max_files"], PAID_FILES)
        fixture.assert_inputs_unchanged()

    def test_default_stays_20000_and_numeric_limits_cannot_select_paid_capacity(self):
        self.assertEqual(self.fixture.plan().max_files, DEFAULT_FILES)
        for limit in (DEFAULT_FILES + 1, PAID_FILES):
            with self.subTest(limit=limit), self.assertRaisesRegex(ValueError, "reviewed Pages"):
                self.fixture.plan(max_files=limit)
        with self.assertRaisesRegex(ValueError, "reviewed Pages"):
            self.plan(max_files=PAID_FILES + 1)
        self.assertEqual(self.plan(max_files=5).max_files, 5)
        with self.assertRaisesRegex(ValueError, "file capacity"):
            self.plan(max_files=4)
        with self.assertRaisesRegex(ValueError, "Asset capacity"):
            self.plan(max_file_bytes=MAX_FILE_BYTES + 1)

    def test_only_fresh_reviewed_profile_accepts_an_inventory_above_default(self):
        extra = tuple(
            InventoryFile(f"retained/{index}.txt", Fingerprint(0, "a" * 64))
            for index in range(DEFAULT_FILES - 4)
        )
        old = ArtifactInventory(self.fixture.old.files + extra)
        options = {"baseline": old, "ownership": self.fixture.choices(old=old)}
        with self.assertRaisesRegex(ValueError, "file capacity"):
            self.fixture.plan(**options)
        self.assertEqual(self.plan(**options).file_count, DEFAULT_FILES + 1)
        oversized = ArtifactInventory(
            old.files + (InventoryFile("oversized.bin", Fingerprint(MAX_FILE_BYTES + 1, "b" * 64)),)
        )
        with self.assertRaisesRegex(ValueError, "per-file capacity"):
            self.plan(baseline=oversized, ownership=self.fixture.choices(old=oversized))

    def test_planning_requires_paired_authority_and_explicit_current_time(self):
        for capacity, instant in (
            ({}, self.now),
            (self.capacity, None),
            (None, self.now),
            (self.capacity, self.now.replace(tzinfo=None)),
            (self.capacity, "not a clock"),
            (self.capacity, self.now - timedelta(microseconds=1)),
            (self.capacity, self.now + timedelta(hours=24, microseconds=1)),
        ):
            with self.subTest(capacity=capacity, instant=instant), self.assertRaises(ValueError):
                self.plan(capacity=capacity, capacity_checked_at=instant)
        self.plan(capacity_checked_at=self.now + timedelta(hours=24))
        for timestamp in ("bad", self.now.replace(tzinfo=None).isoformat()):
            with self.subTest(timestamp=timestamp), self.assertRaises(ValueError):
                self.plan(capacity=replace(self.capacity, verified_at=timestamp))

    def test_assembly_rejects_missing_different_or_unverified_authority_before_writes(self):
        fixture = self.assembly_fixture()
        for authority in (
            None,
            replace(self.capacity, review_sha256="b" * 64),
            replace(self.capacity, project="other-fictional-project"),
            replace(self.capacity, account_id="b" * 32),
            replace(self.capacity, billing=(1, "EUR", "year")),
            replace(self.capacity, evidence=(("cost", "b" * 64), *self.capacity.evidence[1:])),
            CapacityAuthority(**asdict(self.capacity)),
            {},
        ):
            with self.subTest(authority=authority), self.assertRaises(ValueError):
                fixture.run_assembly(capacity=authority)
            self.assertFalse(fixture.output.exists())
            self.assertFalse(fixture.receipt.exists())
        fixture.assert_inputs_unchanged()

    def test_assembly_rechecks_staleness_after_planning_before_writes(self):
        fixture = self.assembly_fixture()
        with patch.object(assembly, "datetime") as clock:
            clock.now.return_value = self.now + timedelta(hours=25)
            with self.assertRaisesRegex(ValueError, "stale"):
                fixture.run_assembly(capacity=self.capacity)
        self.assertFalse(fixture.output.exists())
        self.assertFalse(fixture.receipt.exists())
        fixture.assert_inputs_unchanged()

    def test_expiry_after_inventory_validation_stops_before_writes(self):
        fixture = self.assembly_fixture()
        with (
            patch.object(ReviewedCapacity, "require_current", side_effect=ValueError("stale")),
            self.assertRaisesRegex(ValueError, "stale"),
        ):
            fixture.run_assembly(capacity=self.capacity)
        self.assertFalse(fixture.output.exists())
        self.assertFalse(fixture.receipt.exists())
        fixture.assert_inputs_unchanged()

    def test_expiry_during_assembly_never_writes_completion(self):
        fixture = self.assembly_fixture()
        with (
            patch.object(
                ReviewedCapacity, "require_current", side_effect=[None, ValueError("stale")]
            ),
            self.assertRaisesRegex(ValueError, "stale"),
        ):
            fixture.run_assembly(capacity=self.capacity)
        self.assertEqual(len(assembly_fixture.records(fixture.output)), fixture.plan.file_count)
        self.assertFalse(fixture.receipt.exists())
        fixture.assert_inputs_unchanged()

    def test_authority_validates_closed_immutable_values(self):
        for values in (
            {"account_id": "unknown"},
            {"project": "../production"},
            {"plan": []},
            {"verified_at": None},
            {"review_sha256": "missing"},
            {"billing": []},
            {"billing": (1, "USD")},
            {"billing": (True, "USD", "month")},
            {"billing": (-1, "USD", "month")},
            {"billing": (float("nan"), "USD", "month")},
            {"billing": (1, "usd", "month")},
            {"billing": (1, "USD", [])},
            {"evidence": []},
            {"evidence": ()},
            {"evidence": (("cost", "a" * 64),) * 3},
            {"evidence": (("cost", "invalid"), *self.capacity.evidence[1:])},
            {"evidence": (["cost", "a" * 64], *self.capacity.evidence[1:])},
        ):
            with self.subTest(values=values), self.assertRaises(ValueError):
                replace(self.capacity, **values)
