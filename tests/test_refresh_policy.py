"""Pure link-policy invariants and the single refresh application boundary."""

import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.catalog_refresh import METADATA_URLS, refresh
from maimai_intelligence.catalog_sources import WIKI, mai_catalog
from maimai_intelligence.catalog_transcriptions import profile_chart
from maimai_intelligence.refresh_candidates import (
    RefreshPlan,
    apply_refresh,
    discovery_projection,
    plan_links,
    plan_metadata,
)
from maimai_intelligence.refresh_policy import (
    AcceptedLink,
    LinkChange,
    LinkChart,
    LinkDecisions,
    LinkOutcome,
    LinkTarget,
    decide_links,
)
from maimai_intelligence.registry import digest, empty, new_id
from maimai_intelligence.registry_catalog import project_registry
from tests.mai_notes_fixture import manifest
from tests.registry_fixture import admit, official_row
from tests.test_catalog_waterfall import BODY, wiki

IDENTITY = ("fictional song", "fictional artist", "DX", "MASTER")


class LinkPolicyTests(unittest.TestCase):
    def setUp(self):
        self.chart = LinkChart("chart:one", IDENTITY, "Fictional Artist", "DX", "MASTER", None)
        self.target = LinkTarget("provider:one", IDENTITY, "Fictional Artist", "DX", "MASTER", True)
        self.prior = AcceptedLink("mapping:one", "provider:one", True)

    def decide(self, *, chart=None, targets=None, captured=True):
        return decide_links(
            (chart or self.chart,),
            (self.target,) if targets is None else targets,
            captured=captured,
        )

    def test_empty_inventory_and_unmatched_identity_make_no_claims(self):
        self.assertEqual(decide_links((), (), captured=True), LinkDecisions((), (), ()))
        self.assertEqual(self.decide(targets=()), LinkDecisions((), (), ()))
        other = replace(self.target, identity=("another song", *IDENTITY[1:]))
        self.assertEqual(self.decide(targets=(other,)), LinkDecisions((), (), ()))

    def test_unique_available_identity_proposes_one_source_bound_mapping(self):
        self.assertEqual(
            self.decide(),
            LinkDecisions(
                (("chart:one", "provider:one"),),
                (LinkChange("chart:one", "provider:one", None, True, True),),
                (LinkOutcome("chart:one", "added"),),
            ),
        )

    def test_unique_unavailable_identity_can_supply_metadata_without_accepting_a_mapping(self):
        result = self.decide(targets=(replace(self.target, available=False),))
        self.assertEqual(result.matches, (("chart:one", "provider:one"),))
        self.assertEqual(result.changes, ())
        self.assertEqual(result.outcomes, ())

    def test_duplicate_source_or_canonical_identities_require_review(self):
        duplicate_target = replace(self.target, provider_id="provider:two")
        result = self.decide(targets=(self.target, duplicate_target))
        self.assertEqual(result.matches, ())
        self.assertEqual(result.changes, ())
        self.assertEqual(result.outcomes, (LinkOutcome("chart:one", "ambiguous"),))
        result = decide_links(
            (self.chart, replace(self.chart, chart_id="chart:two")), (self.target,), captured=True
        )
        self.assertEqual(result.matches, ())
        self.assertEqual(result.changes, ())
        self.assertEqual(
            result.outcomes,
            (LinkOutcome("chart:one", "ambiguous"), LinkOutcome("chart:two", "ambiguous")),
        )

    def test_absent_capture_preserves_prior_availability(self):
        chart = replace(self.chart, prior=self.prior)
        self.assertEqual(
            self.decide(chart=chart, targets=(), captured=False), LinkDecisions((), (), ())
        )

    def test_missing_retained_id_is_suspended_without_rematching(self):
        replacement = replace(self.target, provider_id="provider:replacement")
        result = self.decide(chart=replace(self.chart, prior=self.prior), targets=(replacement,))
        self.assertEqual(result.matches, ())
        self.assertEqual(
            result.changes, (LinkChange("chart:one", "provider:one", "mapping:one", False, False),)
        )
        self.assertEqual(result.outcomes, (LinkOutcome("chart:one", "provider_entry_missing"),))

    def test_prior_identity_wins_over_new_duplicate_candidates(self):
        duplicate = replace(self.target, provider_id="provider:two")
        result = self.decide(
            chart=replace(self.chart, prior=self.prior), targets=(duplicate, self.target)
        )
        self.assertEqual(result.matches, (("chart:one", "provider:one"),))
        self.assertEqual(result.changes, ())
        self.assertEqual(result.outcomes, ())

    def test_availability_changes_bind_the_new_capture_in_both_directions(self):
        for old, new in ((True, False), (False, True)):
            with self.subTest(old=old, new=new):
                result = self.decide(
                    chart=replace(self.chart, prior=replace(self.prior, available=old)),
                    targets=(replace(self.target, available=new),),
                )
                self.assertEqual(result.matches, (("chart:one", "provider:one"),))
                self.assertEqual(
                    result.changes,
                    (LinkChange("chart:one", "provider:one", "mapping:one", new, True),),
                )
                self.assertEqual(
                    result.outcomes, (LinkOutcome("chart:one", "availability_changed"),)
                )

    def test_changed_title_artist_format_or_difficulty_cannot_authorize_rematching(self):
        contradictions = (
            replace(self.target, identity=("changed song", *IDENTITY[1:])),
            replace(
                self.target,
                identity=(IDENTITY[0], "changed artist", *IDENTITY[2:]),
                artist="Changed Artist",
            ),
            replace(self.target, identity=(*IDENTITY[:2], "STD", IDENTITY[3]), format="STD"),
            replace(self.target, identity=(*IDENTITY[:3], "EXPERT"), difficulty="EXPERT"),
        )
        replacement = replace(self.target, provider_id="provider:replacement")
        for target in contradictions:
            with self.subTest(target=target):
                result = self.decide(
                    chart=replace(self.chart, prior=self.prior), targets=(target, replacement)
                )
                self.assertEqual(result.matches, ())
                self.assertEqual(
                    result.changes,
                    (LinkChange("chart:one", "provider:one", "mapping:one", False, False),),
                )
                self.assertEqual(
                    result.outcomes, (LinkOutcome("chart:one", "changed_identity_review"),)
                )

    def test_reviewed_artist_credit_requires_both_unchanged_assertions(self):
        target = replace(
            self.target,
            identity=(IDENTITY[0], "credited artist", *IDENTITY[2:]),
            artist="Credited Artist",
        )
        prior = replace(
            self.prior, provider_artist="Credited Artist", official_artist="Fictional Artist"
        )
        result = self.decide(chart=replace(self.chart, prior=prior), targets=(target,))
        self.assertEqual(result.matches, (("chart:one", "provider:one"),))
        self.assertEqual(result.outcomes, ())
        for changed in (
            replace(prior, provider_artist="Stale Credit"),
            replace(prior, official_artist="Stale Credit"),
        ):
            with self.subTest(prior=changed):
                result = self.decide(chart=replace(self.chart, prior=changed), targets=(target,))
                self.assertEqual(result.matches, ())
                self.assertEqual(
                    result.outcomes, (LinkOutcome("chart:one", "changed_identity_review"),)
                )

    def test_normalized_artist_match_does_not_need_a_manual_credit(self):
        target = replace(self.target, artist="fictional  artist")
        result = self.decide(chart=replace(self.chart, prior=self.prior), targets=(target,))
        self.assertEqual(result.matches, (("chart:one", "provider:one"),))
        self.assertEqual(result.changes, ())


class RefreshApplicationTests(unittest.TestCase):
    def setUp(self):
        self.value, _ = admit(empty(), [official_row("Future Song", "Future Artist")])
        self.projection = project_registry(self.value, {})
        self.own = {chart["chart_id"]: chart for chart in self.projection["catalog"]}
        self.feed = manifest(list(self.own.values()))

    def plan(self, value=None, feed=None):
        value = self.value if value is None else value
        raw = json.dumps(self.feed if feed is None else feed).encode()
        metadata = {
            "url": METADATA_URLS["mai-notes"],
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "captured_at": "2026-09-24T12:00:00Z",
        }
        targets, generated = mai_catalog(raw)
        return RefreshPlan(
            digest(value), (), plan_links(value, self.own, targets, metadata, generated), ()
        )

    def test_discovery_projection_preserves_metrics_from_redirected_chart_observations(self):
        raw = wiki()
        metadata = {
            "url": WIKI + "1234",
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "captured_at": "2026-09-24T12:00:00Z",
        }
        decision = plan_metadata(self.value, self.projection, [("gamerch-wiki", raw, metadata)])
        plan = RefreshPlan(
            digest(self.value), (decision,), plan_links(self.value, self.own, {}, None, None), ()
        )
        accepted = apply_refresh(self.value, plan)
        old_id = next(iter(self.own))
        canonical_id = new_id("chart")
        accepted["charts"][canonical_id] = {**accepted["charts"][old_id], "chart_id": canonical_id}
        accepted["charts"][old_id]["redirect"] = canonical_id
        projected = project_registry(accepted, {})
        expected = projected["navigation"]["charts"][canonical_id]
        self.assertEqual(expected["bpm"], 120)
        self.assertIn("chart_constant", expected["metric_sources"])
        before = deepcopy(accepted), deepcopy(projected)
        discovery = discovery_projection(projected, accepted, ())
        self.assertEqual(discovery["navigation"]["charts"][canonical_id], expected)
        self.assertEqual((accepted, projected), before)

    def test_apply_copies_inputs_and_accepts_each_source_bound_mapping_once(self):
        before = deepcopy(self.value)
        plan = self.plan()
        before_plan = deepcopy(plan)
        result = apply_refresh(self.value, plan)
        mappings = [row for row in result["mappings"].values() if row["provider"] == "mai-notes"]
        self.assertEqual(len(mappings), 4)
        snapshot = "mai-notes-index:" + plan.links.metadata["sha256"]
        self.assertTrue(all(row["snapshot_id"] == snapshot for row in mappings))
        self.assertTrue(all(row["available"] for row in mappings))
        self.assertEqual(self.value, before)
        self.assertEqual(plan, before_plan)
        result["sources"][snapshot]["url"] = "https://fictional.invalid/changed"
        self.assertEqual(plan, before_plan)

    def test_changed_or_already_applied_base_is_rejected_without_mutation(self):
        plan = self.plan()
        accepted = apply_refresh(self.value, plan)
        changed = deepcopy(self.value)
        next(iter(changed["songs"].values()))["metadata"]["aliases"] = ["Authored new alias"]
        for base in (accepted, changed):
            before = deepcopy(base)
            with (
                self.subTest(base=digest(base)),
                self.assertRaisesRegex(ValueError, "unchanged accepted base"),
            ):
                apply_refresh(base, plan)
            self.assertEqual(base, before)

    def test_later_application_failure_leaves_input_and_plan_untouched(self):
        plan = self.plan()
        broken = replace(
            plan,
            links=replace(
                plan.links,
                decisions=replace(
                    plan.links.decisions,
                    changes=(
                        plan.links.decisions.changes[0],
                        LinkChange(
                            next(iter(self.own)), "missing", "missing-mapping", False, False
                        ),
                    ),
                ),
            ),
        )
        before = deepcopy(self.value), deepcopy(broken)
        with self.assertRaises(KeyError):
            apply_refresh(self.value, broken)
        self.assertEqual((self.value, broken), before)

    def test_outage_preserves_all_accepted_sources_and_mapping_availability(self):
        accepted = apply_refresh(self.value, self.plan())
        plan = RefreshPlan(digest(accepted), (), plan_links(accepted, self.own, {}, None, None), ())
        self.assertEqual(apply_refresh(accepted, plan), accepted)

    def test_availability_capture_changes_without_replacing_original_evidence(self):
        accepted = apply_refresh(self.value, self.plan())
        before = deepcopy(accepted)
        unavailable = deepcopy(self.feed)
        for chart in unavailable["charts"]:
            chart["has_chart_data"] = False
        plan = self.plan(accepted, unavailable)
        held = apply_refresh(accepted, plan)
        snapshot = "mai-notes-index:" + plan.links.metadata["sha256"]
        self.assertNotIn(snapshot, accepted["sources"])
        for mid, mapping in accepted["mappings"].items():
            expected = (
                {**mapping, "available": False, "availability_snapshot_id": snapshot}
                if mapping["provider"] == "mai-notes"
                else mapping
            )
            self.assertEqual(held["mappings"][mid], expected)
        for sid, source in accepted["sources"].items():
            self.assertEqual(held["sources"][sid], source)
        self.assertEqual(accepted, before)

    def test_contradictory_retained_assertion_keeps_mapping_identity_and_original_source(self):
        accepted = apply_refresh(self.value, self.plan())
        before = deepcopy(accepted)
        changed = deepcopy(self.feed)
        for song in changed["songs"].values():
            song["artist"] = "Unrelated Artist"
        plan = self.plan(accepted, changed)
        self.assertEqual(plan.links.matches, {})
        held = apply_refresh(accepted, plan)
        for mid, mapping in accepted["mappings"].items():
            expected = (
                {**mapping, "available": False} if mapping["provider"] == "mai-notes" else mapping
            )
            self.assertEqual(held["mappings"][mid], expected)
        for sid, source in accepted["sources"].items():
            self.assertEqual(held["sources"][sid], source)
        self.assertEqual(accepted, before)


class RefreshApplicationOrderingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        network = patch("socket.socket", side_effect=AssertionError("Network forbidden"))
        network.start()
        self.addCleanup(network.stop)
        self.value, _ = admit(empty(), [official_row("Future Song", "Future Artist")])
        self.feed = manifest(project_registry(self.value, {})["catalog"])
        for song in self.feed["songs"].values():
            song.update(bpm=120, gamerch_id=1234)
        for chart in self.feed["charts"]:
            chart.update(taps=4, hold=0, slide=0, touch=0, breaks=0)
        self.events = []
        self.abort_after_first = False

    def fetch(self, url, headers):
        self.events.append(("capture", url))
        if url == METADATA_URLS["mai-notes"]:
            return 200, json.dumps(self.feed).encode(), {}
        if url == WIKI + "1234":
            return 200, wiki(), {}
        if url.startswith("https://mai-notes.com/data/charts/"):
            if self.abort_after_first and any(kind == "analysis" for kind, _ in self.events):
                raise RuntimeError("Authored late acquisition defect")
            return 200, BODY, {}
        raise OSError("Authored unavailable provider")

    def analyze(self, chart):
        result = profile_chart(chart)
        self.events.append(("analysis", result["chart_id"]))
        return result

    def apply(self, value, plan, **kwargs):
        self.events.append(("apply", plan.base_sha256))
        return apply_refresh(value, plan, **kwargs)

    def run_refresh(self):
        with (
            patch("maimai_intelligence.catalog_transcriptions.profile_chart", self.analyze),
            patch("maimai_intelligence.catalog_refresh.apply_refresh", self.apply),
        ):
            return refresh(
                self.value, {}, self.root / "cache", self.root / "run", fetcher=self.fetch
            )

    def test_real_refresh_applies_once_after_all_captures_and_qualified_analyses(self):
        before = deepcopy(self.value)
        value, additions, audit = self.run_refresh()
        self.assertEqual(audit["counts"]["analyzed"], 4)
        self.assertEqual(len(additions["profiles"]), 4)
        self.assertEqual(len([event for event in self.events if event[0] == "analysis"]), 4)
        self.assertEqual(len([event for event in self.events if event[0] == "apply"]), 1)
        self.assertEqual(self.events[-1], ("apply", digest(before)))
        self.assertEqual(self.value, before)
        self.assertTrue(all(chart.get("transcription") for chart in value["charts"].values()))

    def test_same_body_captures_share_coherent_first_source_provenance(self):
        value, additions, audit = self.run_refresh()
        self.assertEqual(audit["counts"]["analyzed"], 4)
        self.assertEqual(len(additions["sources"]), 1)
        self.assertEqual(
            additions["sources"],
            {snapshot: value["sources"][snapshot] for snapshot in additions["sources"]},
        )
        first_url = next(
            url
            for kind, url in self.events
            if kind == "capture" and url.startswith("https://mai-notes.com/data/charts/")
        )
        self.assertEqual(next(iter(additions["sources"].values()))["url"], first_url)

    def test_fatal_late_acquisition_produces_no_candidate_application(self):
        self.abort_after_first = True
        before = deepcopy(self.value)
        with self.assertRaisesRegex(RuntimeError, "late acquisition defect"):
            self.run_refresh()
        self.assertEqual(len([event for event in self.events if event[0] == "analysis"]), 1)
        self.assertEqual([event for event in self.events if event[0] == "apply"], [])
        self.assertEqual(self.value, before)
        self.assertFalse((self.root / "run" / "registry").exists())


if __name__ == "__main__":
    unittest.main()
