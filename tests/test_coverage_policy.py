"""Coverage lifecycle regressions use authored public identities only."""

import unittest
from copy import deepcopy
from unittest.mock import Mock, patch

from maimai_intelligence.coverage import _queue, prepare_coverage
from maimai_intelligence.provider_reconciliation import reconcile
from tests.test_sustainable_coverage import identity, provider


def empty_work():
    return {"version": "coverage-work-1", "generation": 0, "jobs": {}, "reviews": {}}


class CoverageRegressionTests(unittest.TestCase):
    def test_due_retries_rotate_instead_of_starving_the_second_batch(self):
        value = {
            "songs": {
                f"s{i:04d}": {"metadata": {"title": f"Title {i}", "artist": "Fixture"}}
                for i in range(600)
            }
        }
        state, _ = _queue(value, empty_work(), 0, {})
        for job in state["jobs"].values():
            job.update(
                evidence=job["pending_evidence"],
                status="unresolved",
                reason="unavailable",
                attempts=8,
                next_retry=0,
                checked_at=0,
            )
        state, first = _queue(value, state, 0, {})
        for sid in first:
            state["jobs"][sid].update(checked_at=1, next_retry=86400, attempts=9)
        _, second = _queue(value, state, 86400, {})
        self.assertEqual(len(first), 300)
        self.assertEqual(len(second), 300)
        self.assertFalse(set(first) & set(second))
        self.assertEqual(set(first) | set(second), set(value["songs"]))

    def test_common_stage_blocks_stale_review_instead_of_retaining_usable_refresh(self):
        value, _, cid = identity()
        review = {
            "provider": "kamaitachi",
            "provider_chart_id": "C1",
            "chart_id": cid,
            "expected_source": {
                "title": "Fixture",
                "artist": "Fictional Artist",
                "format": "DX",
                "difficulty": "MASTER",
            },
            "evidence": "explicit authored fixture review",
        }
        value, _ = reconcile(value, provider(), [review])
        original = deepcopy(value)
        changed = provider(artist="Different Artist", revision="b" * 40)
        self.assertEqual(reconcile(value, changed)[1]["status"], "conflicting")
        with (
            patch("maimai_intelligence.coverage.capture_snapshot", return_value=changed),
            patch("maimai_intelligence.coverage.migrate_artwork", return_value=[]),
            patch("maimai_intelligence.coverage._state", return_value=empty_work()),
            patch("maimai_intelligence.coverage._queue", return_value=(empty_work(), [])),
            patch("maimai_intelligence.coverage.atomic_json"),
            self.assertRaisesRegex(ValueError, "[Ss]tale|[Rr]eview"),
        ):
            prepare_coverage(
                value,
                {},
                Mock(cooldowns={}),
                "unused-fixture-cache",
                "unused-fixture-output",
                provider_reviews=[review],
                now=0,
            )
        self.assertEqual(value, original)
