"""Durable coverage fixtures contain public metadata and authored images only."""

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.artwork_store import migrate_artwork
from maimai_intelligence.catalog_capture import CaptureStore
from maimai_intelligence.coverage import CONFIG, _queue, _retry, prepare_coverage, wiki_jacket
from maimai_intelligence.coverage_types import Failure, FailureKind
from maimai_intelligence.enrichment import classify_titles, validate_enrichment
from maimai_intelligence.provider_reconciliation import REVISION_URL, reconcile
from maimai_intelligence.registry import (
    admit_chart,
    admit_song,
    digest,
    empty,
    read_registry,
    write_registry,
)
from maimai_intelligence.registry_catalog import build_registry_package, project_registry
from maimai_intelligence.snapshots import canonical, read_json
from tests.artwork_fixture import IMAGE
from tests.registry_fixture import admit, official_row


def identity(title="Fixture", artist="Fictional Artist"):
    value = empty()
    sid = admit_song(
        value,
        {"title": title, "artist": artist, "catcode": "maimai"},
        evidence="authored",
        basis="reviewed",
    )
    cid = admit_chart(value, sid, "DX", "MASTER", evidence="authored")
    return value, sid, cid


def provider(title="Fixture", artist="Fictional Artist", *, revision="a" * 40):
    return {
        "revision": revision,
        "songs": [{"id": "S1", "title": title, "artist": artist}],
        "charts": [{"chartID": "C1", "songID": "S1", "difficulty": "DX Master", "level": "14"}],
    }


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def fetcher(self, snapshot, *, official=True):
        def fetch(url, headers):
            if url == REVISION_URL:
                raw = canonical([{"sha": snapshot["revision"]}])
            elif url.endswith("songs-maimaidx.json"):
                raw = canonical(snapshot["songs"])
            elif url.endswith("charts-maimaidx.json"):
                raw = canonical(snapshot["charts"])
            elif "/otoge-db/" in url:
                raw = b"[]"
            elif url == "https://maimai.lxns.net/api/v0/maimai/song/list":
                raw = b'{"songs": []}'
            elif "/Music/" in url:
                if not official:
                    raise OSError("authored source unavailable")
                raw = IMAGE
            elif url == "https://gamerch.com/maimai/":
                raw = b'<a href="/maimai/123">Fixture</a>'
            elif url == "https://gamerch.com/maimai/123":
                raw = (
                    "<table><tr><th>タイトル</th><td>Fixture</td></tr>"
                    "<tr><th>アーティスト</th><td>Fictional Artist</td></tr>"
                    '<tr><td><img src="https://cdn.gamerch.com/fixture/jacket.png"></td></tr></table>'
                ).encode()
            elif url == "https://cdn.gamerch.com/fixture/jacket.png":
                raw = IMAGE
            else:
                raise AssertionError(url)
            return 200, raw, {}

        return fetch

    def test_metadata_only_maps_without_analysis_and_revalidates_assignments(self):
        value, _, cid = identity()
        result, report = reconcile(value, provider())
        self.assertEqual(report["added"], ["C1"])
        mapping = next(iter(result["mappings"].values()))
        self.assertEqual(mapping["acceptance_basis"], "policy_exact")
        projected = project_registry(result, {})
        self.assertEqual(projected["provider_mapping"]["charts"]["C1"]["chart_id"], cid)
        self.assertNotIn("source_hash", projected["catalog"][0])
        self.assertNotIn("demand", projected["catalog"][0])
        again, same = reconcile(result, provider())
        self.assertEqual(again, result)
        self.assertEqual(same["added"], [])
        changed, conflict = reconcile(result, provider(artist="Another artist", revision="b" * 40))
        self.assertEqual(conflict["status"], "conflicting")
        self.assertEqual(changed["mappings"], result["mappings"])

    def test_duplicate_source_variants_and_blank_titles_never_auto_join(self):
        value, sid, cid = identity("\u3000")
        classify_titles(value)
        self.assertEqual(value["songs"][sid]["enrichment"]["title"]["state"], "missing")
        result, report = reconcile(value, provider("\u3000"))
        self.assertEqual(report["added"], [])
        review = {
            "song_id": sid,
            "assertion": digest(value["songs"][sid]["metadata"]),
            "evidence": "reviewed blank source",
        }
        classify_titles(value, [review])
        self.assertEqual(value["songs"][sid]["metadata"]["title"], "\u3000")
        self.assertEqual(value["songs"][sid]["enrichment"]["title"]["state"], "intentional_blank")
        with self.assertRaisesRegex(ValueError, "assertion changed"):
            classify_titles(value, [{**review, "assertion": "0" * 64}])
        scoped = {
            "provider": "kamaitachi",
            "provider_chart_id": "C1",
            "chart_id": cid,
            "expected_source": {
                "title": "\u3000",
                "artist": "Fictional Artist",
                "format": "DX",
                "difficulty": "MASTER",
            },
            "evidence": "review bound to fixture",
        }
        self.assertEqual(reconcile(value, provider("\u3000"), [scoped])[1]["added"], ["C1"])
        value, _, _ = identity()
        snapshot = provider()
        snapshot["charts"].append({**snapshot["charts"][0], "chartID": "C2"})
        self.assertEqual(reconcile(value, snapshot)[1]["added"], [])

    def test_verified_artwork_migration_survives_registry_and_package_roundtrips(self):
        import hashlib

        value, sid, cid = identity()
        sha = hashlib.sha256(IMAGE).hexdigest()
        path = "media/" + sha + ".webp"
        source = self.root / "published"
        (source / "media").mkdir(parents=True)
        (source / path).write_bytes(IMAGE)
        published = {
            "catalog": [{"chart_id": cid, "song_id": sid}],
            "artwork": {
                "version": "public-artwork-1",
                "songs": {sid: {"title": "Fixture", "artist": "Fictional Artist", "path": path}},
                "assets": {path: {"sha256": sha, "bytes": len(IMAGE)}},
                "versions": {},
            },
        }
        cache = self.root / "cache"
        migrate_artwork(value, published, (source,), cache)
        original = deepcopy(value)
        migrate_artwork(value, published, (source,), cache)
        self.assertEqual(value, original)
        write_registry(value, self.root / "registry")
        loaded = read_registry(self.root / "registry")
        first = build_registry_package(loaded, None, self.root / "one", artwork_source=cache)
        second = build_registry_package(
            loaded, self.root / "one", self.root / "two", artwork_source=cache
        )
        self.assertEqual(first["artwork"], second["artwork"])
        self.assertEqual(first["artwork"]["songs"][sid]["path"], path)
        self.assertFalse(
            any(c.get("legacy_identity") or c.get("source_hash") for c in first["catalog"])
        )
        (cache / path).write_bytes(b"broken")
        with self.assertRaisesRegex(ValueError, "integrity"):
            build_registry_package(
                loaded, self.root / "one", self.root / "three", artwork_source=cache
            )

    def test_online_repeat_offline_and_exact_replay_preserve_selections(self):
        value, _ = admit(empty(), [official_row("Fixture", "Fictional Artist")])
        original = deepcopy(value)
        snapshot = provider()
        cache = self.root / "coverage"
        captures = self.root / "sources"
        capture = CaptureStore(captures, fetcher=self.fetcher(snapshot))
        first, audit = prepare_coverage(value, {}, capture, cache, self.root / "one", now=100)
        self.assertTrue(audit["provider"]["added"])
        sid = next(iter(first["songs"]))
        self.assertIn("default", first["songs"][sid]["enrichment"]["artwork"]["selected"])
        from maimai_intelligence.snapshots import atomic_json

        atomic_json(self.root / "one/source-captures.json", capture.receipt())
        atomic_json(cache / "work.json", read_json(self.root / "one/coverage-state.json"))
        with patch(
            "maimai_intelligence.coverage.thumbnail", side_effect=AssertionError("No reconversion")
        ):
            second, _ = prepare_coverage(
                first,
                {},
                CaptureStore(captures, fetcher=self.fetcher(snapshot)),
                cache,
                self.root / "two",
                now=200,
            )
            offline, _ = prepare_coverage(
                first,
                {},
                CaptureStore(captures, offline=True),
                cache,
                self.root / "offline",
                offline=True,
            )
        self.assertEqual(second, first)
        self.assertEqual(offline, first)
        replay = self.root / "one/source-captures.json"
        reproduced, _ = prepare_coverage(
            original,
            {},
            CaptureStore(captures, offline=True, replay=replay),
            cache,
            self.root / "replay",
            offline=True,
            replay=replay,
        )
        self.assertEqual(reproduced, first)
        self.assertEqual(value, original)
        validate_enrichment(reproduced)

    def test_official_failure_uses_identity_verified_wiki_and_retains_during_outage(self):
        value, _ = admit(empty(), [official_row("Fixture", "Fictional Artist")])
        capture = CaptureStore(
            self.root / "sources", fetcher=self.fetcher(provider(), official=False)
        )
        result, audit = prepare_coverage(
            value, {}, capture, self.root / "coverage", self.root / "one", now=100
        )
        selection = next(iter(result["songs"].values()))["enrichment"]["artwork"]["selected"][
            "default"
        ]
        self.assertEqual(selection["asset"]["source"], "https://cdn.gamerch.com/fixture/jacket.png")
        self.assertEqual(audit["counts"], {"partial": 1})
        broken = CaptureStore(
            self.root / "sources", fetcher=lambda *args: (_ for _ in ()).throw(OSError("outage"))
        )
        retained, audit = prepare_coverage(
            result, {}, broken, self.root / "coverage", self.root / "two", now=200
        )
        self.assertEqual(retained["songs"], result["songs"])
        self.assertEqual(audit["provider"]["status"], "failed_refresh")

    def test_wiki_wrong_identity_or_unrelated_image_cannot_select_artwork(self):
        value, sid, _ = identity()
        song = value["songs"][sid]
        for html in (
            '<img src="https://cdn.gamerch.com/banner.png">',
            "<table><tr><th>タイトル</th><td>Another</td></tr>"
            "<tr><th>アーティスト</th><td>Fictional Artist</td></tr>"
            '<tr><td><img src="https://cdn.gamerch.com/jacket.png"></td></tr></table>',
        ):
            with self.assertRaises(ValueError):
                wiki_jacket(html.encode(), "https://gamerch.com/maimai/123", song)

    def test_queue_oldest_reserved_and_evidence_changes_invalidate_negatives(self):
        value = empty()
        for i in range(320):
            admit_song(
                value, {"title": str(i), "artist": "fixture"}, evidence="fixture", basis="reviewed"
            )
        state = {"version": "coverage-work-1", "generation": 0, "jobs": {}, "reviews": {}}
        state, first = _queue(value, state, 100)
        for sid in first[:300]:
            state["jobs"][sid]["evidence"] = state["jobs"][sid]["pending_evidence"]
            state["jobs"][sid]["next_retry"] = 10000
        remaining = set(value["songs"]) - set(first[:300])
        for i in range(400):
            admit_song(
                value,
                {"title": "new" + str(i), "artist": "fixture"},
                evidence="fixture",
                basis="reviewed",
            )
        state, second = _queue(value, state, 101)
        self.assertTrue(remaining <= set(second[: CONFIG["oldest_reserved"]]))
        self.assertEqual(len(second), len(set(second)))
        changed = first[0]
        value["songs"][changed]["metadata"]["title"] = "Changed evidence"
        self.assertIn(changed, _queue(value, state, 102)[1])

    def test_bounded_queue_does_not_consume_unprocessed_artwork_evidence(self):
        value = empty()
        for i in range(350):
            sid = admit_song(
                value, {"title": str(i), "artist": "fixture"}, evidence="fixture", basis="reviewed"
            )
            value["songs"][sid]["enrichment"] = {
                "artwork": {"selected": {"default": {"path": "retained"}}}
            }
        initial = {"version": "coverage-work-1", "generation": 0, "jobs": {}, "reviews": {}}
        state, selected = _queue(value, initial, 100)
        self.assertEqual(len(selected), CONFIG["song_budget"])
        # A fully offline build processes nothing, so its first batch remains pending.
        self.assertEqual(_queue(value, state, 101)[1], selected)
        for sid in selected:
            state["jobs"][sid].update(
                evidence=state["jobs"][sid]["pending_evidence"], status="accepted", attempts=1
            )
        second_state, second = _queue(value, state, 102)
        self.assertEqual(set(second), set(value["songs"]) - set(selected))
        # New evidence for an already attempted song also stays pending until processed.
        for sid in value["songs"]:
            value["songs"][sid]["metadata"]["title"] += " revised"
        revised_state, revised = _queue(value, second_state, 103)
        for sid in revised:
            revised_state["jobs"][sid].update(
                evidence=revised_state["jobs"][sid]["pending_evidence"],
                status="accepted",
                attempts=1,
            )
        self.assertEqual(
            set(_queue(value, revised_state, 104)[1]), set(value["songs"]) - set(revised)
        )

    def test_new_snapshot_resolves_existing_gap_without_rewriting_old_mapping(self):
        value, _, cid = identity()
        first, _ = reconcile(value, provider("Other"))
        second, _ = reconcile(first, provider(revision="b" * 40))
        self.assertEqual(first["mappings"], {})
        self.assertEqual(next(iter(second["mappings"].values()))["subject_id"], cid)
        self.assertEqual(set(first["charts"]), set(second["charts"]))

    def test_retry_after_and_failure_classification_are_not_absence(self):
        self.assertEqual(
            _retry([{"status": 429, "retry_after": "3600"}], 1, 100, []), ("rate_limited", 3700)
        )
        self.assertEqual(_retry([{"status": 404}], 1, 100, [])[0], "not_found")
        self.assertEqual(_retry([], 1, 100, ["schema invalid"])[0], "unavailable")
        self.assertEqual(
            _retry([], 1, 100, [Failure(FailureKind.DEFERRED, "shared page budget reached")]),
            ("deferred", 0),
        )

    def test_shared_page_budget_and_replay_do_not_read_newer_cache_bytes(self):
        captures = self.root / "captures"
        live = CaptureStore(captures, fetcher=lambda *_: (200, b"original", {}))
        for i in range(1, 301):
            live.get("https://gamerch.com/maimai/" + str(i))
        with self.assertRaisesRegex(ValueError, "budget"):
            live.get("https://gamerch.com/maimai/301")
        from maimai_intelligence.snapshots import atomic_json

        receipt = self.root / "receipt.json"
        atomic_json(receipt, live.receipt())
        url = "https://gamerch.com/maimai/1"
        changed = CaptureStore(captures, fetcher=lambda *_: (200, b"newer", {}))
        self.assertEqual(changed.get(url)[0], b"newer")
        replay = CaptureStore(captures, offline=True, replay=receipt)
        self.assertEqual(replay.get(url)[0], b"original")

    def test_scoped_credit_review_reuses_only_explicit_ordinary_chart_slots(self):
        value, sid, cid = identity(artist="Expanded credit")
        expert = admit_chart(value, sid, "DX", "EXPERT", evidence="authored")
        snapshot = provider(artist="Short credit")
        snapshot["charts"].extend(
            [
                {"chartID": "C2", "songID": "S1", "difficulty": "DX Expert"},
                {"chartID": "C3", "songID": "S1", "difficulty": "DX Advanced"},
                {"chartID": "C4", "songID": "S1", "difficulty": "Master"},
            ]
        )
        review = {
            "provider": "kamaitachi",
            "provider_song_id": "S1",
            "song_id": sid,
            "expected_source": {"title": "Fixture", "artist": "Short credit"},
            "canonical_assertion": digest(value["songs"][sid]["metadata"]),
            "evidence": "scoped fixture credit review",
        }
        result, report = reconcile(value, snapshot, [review])
        self.assertEqual(set(report["added"]), {"C1", "C2"})
        self.assertEqual({r["subject_id"] for r in result["mappings"].values()}, {cid, expert})
        changed = deepcopy(snapshot)
        changed["songs"][0]["artist"] = "Changed credit"
        with self.assertRaisesRegex(ValueError, "Stale"):
            reconcile(result, changed, [review])
        self.assertEqual(reconcile(value, snapshot)[1]["added"], [])

    def test_changed_artwork_failure_is_retried_after_deadline_without_losing_old_asset(self):
        from maimai_intelligence.snapshots import atomic_json

        value, _ = admit(empty(), [official_row("Fixture", "Fictional Artist")])
        captures, cache = self.root / "sources", self.root / "coverage"
        first, _ = prepare_coverage(
            value,
            {},
            CaptureStore(captures, fetcher=self.fetcher(provider())),
            cache,
            self.root / "first",
            now=100,
        )
        atomic_json(cache / "work.json", read_json(self.root / "first/coverage-state.json"))
        sid = next(iter(first["songs"]))
        raw_title = next(iter(value["songs"].values()))["metadata"]
        from maimai_intelligence.official_inventory import assertion

        changed, _ = admit(
            first,
            [official_row("Fixture", "Fictional Artist", image_url="changed.png")],
            when="2026-09-18T05:00:00Z",
            decisions={
                assertion(official_row("Fixture", "Fictional Artist")): {
                    "action": "link",
                    "song_id": sid,
                    "evidence": "authored image update",
                }
            },
        )
        # The assertion helper binds title/artist; display metadata itself remains immutable.
        self.assertEqual(changed["songs"][sid]["metadata"], raw_title)
        failed, _ = prepare_coverage(
            changed,
            {},
            CaptureStore(captures, fetcher=self.fetcher(provider(), official=False)),
            cache,
            self.root / "failed",
            now=200,
        )
        self.assertEqual(
            failed["songs"][sid]["enrichment"]["artwork"],
            first["songs"][sid]["enrichment"]["artwork"],
        )
        state = read_json(self.root / "failed/coverage-state.json")
        atomic_json(cache / "work.json", state)
        retry = state["jobs"][sid]["next_retry"]
        self.assertNotIn(sid, _queue(failed, state, retry - 1)[1])
        recovered, _ = prepare_coverage(
            failed,
            {},
            CaptureStore(captures, fetcher=self.fetcher(provider())),
            cache,
            self.root / "recovered",
            now=retry,
        )
        selection = recovered["songs"][sid]["enrichment"]["artwork"]["selected"]["JP"]
        self.assertTrue(selection["asset"]["source"].endswith("changed.png"))

    def test_distinct_published_regional_artwork_survives_migration_and_fresh_cache(self):
        import hashlib
        import io

        from PIL import Image

        value, sid, cid = identity()
        source = self.root / "published"
        (source / "media").mkdir(parents=True)
        art = {"version": "public-artwork-1", "songs": {}, "assets": {}, "versions": {}}
        selections = {}
        for scope, color in (("default", "red"), ("JP", "green"), ("INTL", "blue")):
            stream = io.BytesIO()
            Image.new("RGB", (4, 4), color).save(stream, "WEBP")
            raw = stream.getvalue()
            sha = hashlib.sha256(raw).hexdigest()
            path = "media/" + sha + ".webp"
            (source / path).write_bytes(raw)
            art["assets"][path] = {"sha256": sha, "bytes": len(raw)}
            selections[scope] = {"title": "Fixture", "artist": "Fictional Artist", "path": path}
        art["songs"][sid] = {
            **selections["default"],
            "regions": {r: selections[r] for r in ("JP", "INTL")},
        }
        published = {"catalog": [{"chart_id": cid, "song_id": sid}], "artwork": art}
        cache = self.root / "cache"
        migrate_artwork(value, published, (source,), cache)
        first = build_registry_package(value, None, self.root / "package", artwork_source=cache)
        self.assertEqual(first["artwork"]["songs"][sid], art["songs"][sid])
        next_cache = self.root / "new-cache"
        migrate_artwork(value, first, (self.root / "package",), next_cache)
        second = build_registry_package(
            value, self.root / "package", self.root / "reused", artwork_source=next_cache
        )
        self.assertEqual(second["artwork"]["songs"][sid], first["artwork"]["songs"][sid])
        self.assertEqual(len(second["artwork"]["assets"]), 3)
