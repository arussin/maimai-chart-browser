"""Authored future-song contracts for the automatic public-source waterfall."""

import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.catalog_capture import CaptureStore
from maimai_intelligence.catalog_refresh import METADATA_URLS, refresh
from maimai_intelligence.catalog_sources import WIKI, mai_catalog, wiki_catalog
from maimai_intelligence.lab import build_lab
from maimai_intelligence.overview_codec import compact_overview
from maimai_intelligence.registry import read_registry, write_registry
from maimai_intelligence.registry_catalog import build_registry_package, project_registry
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts.update_catalog import prepare_update, refresh_latest, verify_candidate
from tests.mai_notes_fixture import manifest
from tests.registry_fixture import admit, fixture, official_row

BODY = b"(120){4}1,2,3,4,E"
COUNTS = {"tap": 4, "hold": 0, "slide": 0, "touch": 0, "break": 0}


def wiki(title="Future Song", artist="Future Artist", constants=(2.1, 6.3, 10.4, 13.2)):
    metadata = (
        f"<table><tr><th>タイトル</th><td>{title}</td></tr>"
        f"<tr><th>アーティスト</th><td>{artist}</td></tr>"
        "<tr><th>BPM</th><td>120</td></tr></table>"
    )
    table = (
        "<h4>でらっくす譜面</h4><table><tr><th>Lv</th><th>定数</th><th>総数</th>"
        "<th>TAP</th><th>HOLD</th><th>SLIDE</th><th>TOUCH</th><th>BREAK</th></tr>"
    )
    for level, constant, color in zip(
        (2, 6, 10, 13), constants, ("#98fb98", "#ffa500", "#fa8080", "#ee82ee"), strict=True
    ):
        table += (
            f'<tr><td style="background-color:{color}">{level}</td>'
            f"<td>{constant}</td><td>4</td><td>4</td>"
            "<td>0</td><td>0</td><td>0</td><td>0</td></tr>"
        )
    return (
        metadata
        + table
        + "</table><p>定数調査:Future Release</p><a href='https://w.atwiki.jp/simai/pages/1234.html'>simai</a>"
    ).encode()


class CaptureTests(unittest.TestCase):
    def test_conditional_fetch_replay_and_integrity(self):
        with tempfile.TemporaryDirectory() as tmp:
            url = METADATA_URLS["mai-notes"]
            calls = []

            def fetch(url, headers):
                calls.append(headers)
                return (304, b"", {}) if headers else (200, b"fixture", {"ETag": "one"})

            first = CaptureStore(tmp, fetcher=fetch)
            self.assertEqual(first.get(url), first.get(url))
            receipt = Path(tmp) / "receipt.json"
            atomic_json(receipt, first.receipt())
            second = CaptureStore(tmp, fetcher=fetch)
            self.assertEqual(first.get(url), second.get(url))
            self.assertEqual(calls, [{}, {"If-None-Match": "one"}])
            with patch("socket.socket", side_effect=AssertionError("Offline")):
                replay = CaptureStore(tmp, offline=True, replay=receipt)
                self.assertEqual(replay.get(url), first.get(url))
            (Path(tmp) / "blobs" / hashlib.sha256(b"fixture").hexdigest()).write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "integrity"):
                CaptureStore(tmp, offline=True).get(url)
            with self.assertRaisesRegex(ValueError, "allowlist"):
                first.get("https://example.com/arbitrary")


class WaterfallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.value, self.legacy, self.package = fixture(self.root)
        self.value, _ = admit(self.value, [official_row("Future Song", "Future Artist")])
        projection = project_registry(self.value, self.legacy)
        self.future = [c for c in projection["catalog"] if c["title"] == "Future Song"]
        self.manifest = manifest(self.future)
        for song in self.manifest["songs"].values():
            song.update(bpm=120, gamerch_id=1234, simai_id=1234)
        for index, chart in enumerate(self.manifest["charts"]):
            chart.update(
                internal_level=(2.1, 6.3, 10.4, 13.2)[index],
                taps=4,
                hold=0,
                slide=0,
                touch=0,
                breaks=0,
            )
        self.cache = self.root / "cache"
        self.calls = []

    def fetch(self, url, headers):
        self.calls.append(url)
        if url == METADATA_URLS["mai-notes"]:
            return 200, json.dumps(self.manifest).encode(), {}
        if url == WIKI + "1234":
            return 200, wiki(), {}
        if url.startswith("https://mai-notes.com/data/charts/"):
            return 200, BODY, {}
        raise OSError("fixture source unavailable")

    def test_complete_future_song_analysis_persists_and_replays(self):
        value, additions, audit = refresh(
            self.value, self.legacy, self.cache, self.root / "run", fetcher=self.fetch
        )
        self.assertEqual(audit["counts"]["analyzed"], 4)
        self.assertEqual(len(self.calls), len(set(self.calls)))
        data = build_registry_package(
            value, self.package, self.root / "new-package", additions=additions
        )
        self.assertEqual(
            len(data["catalog"]), len(project_registry(self.value, self.legacy)["catalog"])
        )
        for chart in data["catalog"]:
            if chart["title"] == "Future Song":
                self.assertEqual(chart["capabilities"]["flow"], "available")
                self.assertEqual(chart["capabilities"]["patterns"], "available")
                self.assertEqual(chart["capabilities"]["similarity"], "available")
                self.assertEqual(data["navigation"]["charts"][chart["chart_id"]]["bpm"], 120)
        with patch(
            "maimai_intelligence.catalog_transcriptions.profile_chart",
            side_effect=AssertionError("cache miss"),
        ):
            replay_value, replay_additions, _ = refresh(
                self.value,
                self.legacy,
                self.cache,
                self.root / "replay",
                offline=True,
                replay=self.root / "run/source-captures.json",
            )
        replay_data = build_registry_package(
            replay_value, self.package, self.root / "replay-package", additions=replay_additions
        )
        self.assertEqual(data, replay_data)
        next_value, next_additions, next_audit = refresh(
            value, data, self.cache, self.root / "next", fetcher=self.fetch
        )
        self.assertEqual(next_additions["profiles"], [])
        self.assertEqual(next_audit["counts"]["retained_unchanged"], 4)
        self.assertEqual(value, next_value)
        again = build_registry_package(
            next_value, self.root / "new-package", self.root / "next-package", published=data
        )
        self.assertEqual(data, again)
        self.assertNotIn("UNRELATED_SCORE_SENTINEL", json.dumps(data))
        self.assertEqual(read_registry(self.root / "run/registry"), value)
        original = project_registry(self.value, self.legacy)
        for chart in original["catalog"]:
            if "demand" in chart:
                retained = next(c for c in data["catalog"] if c["chart_id"] == chart["chart_id"])
                self.assertEqual(chart["demand"], retained["demand"])
                self.assertEqual(
                    compact_overview(original["analysis"])["charts"][chart["chart_id"]],
                    data["analysis"]["charts"][chart["chart_id"]],
                )

    def test_count_mismatch_tries_wiki_and_retains_unknown_on_failure(self):
        for chart in self.manifest["charts"]:
            chart["taps"] = 999
        value, additions, audit = refresh(
            self.value, self.legacy, self.cache, self.root / "run", fetcher=self.fetch
        )
        self.assertEqual(additions["profiles"], [])
        statuses = [
            r
            for r in audit["transcriptions"]
            if r["chart_id"] in {c["chart_id"] for c in self.future}
        ]
        self.assertTrue(all(r["status"] == "unavailable_or_unsupported" for r in statuses))
        self.assertTrue(all("note-count mismatch" in r["attempts"][0]["reason"] for r in statuses))
        self.assertIn("https://w.atwiki.jp/simai/pages/1234.html", self.calls)
        self.assertTrue(
            all(not value["charts"][c["chart_id"]].get("transcription") for c in self.future)
        )

    def test_wiki_missing_values_and_ambiguous_identity(self):
        for chart in self.manifest["charts"]:
            chart["internal_level"] = None
            chart["has_chart_data"] = False
        value, _, audit = refresh(
            self.value, self.legacy, self.cache, self.root / "run", fetcher=self.fetch
        )
        data = project_registry(value, self.legacy)
        self.assertEqual(audit["metadata"]["observations_added"], 12)
        constants = {
            c["difficulty"]: data["navigation"]["charts"][c["chart_id"]]["chart_constant"]
            for c in self.future
        }
        self.assertEqual(set(constants.values()), {2.1, 6.3, 10.4, 13.2})
        raw = wiki().replace(b"<td>4</td><td>4</td>", b"<td>5</td><td>4</td>")
        with self.assertRaisesRegex(ValueError, "total"):
            wiki_catalog(raw, WIKI + "1234")
        self.manifest["charts"].append(deepcopy(self.manifest["charts"][0]))
        self.manifest["charts"][-1]["id"] = "00000000-0000-0000-0000-000000009999"
        self.manifest["charts_count"] += 1
        value, _, audit = refresh(
            self.value, self.legacy, self.root / "amb-cache", self.root / "amb", fetcher=self.fetch
        )
        self.assertTrue(audit["metadata"]["ambiguous"])

    def test_wiki_historical_easy_and_scores_do_not_shift_difficulty(self):
        raw = wiki().decode().replace("でらっくす譜面", "通常譜面").replace("<th>TOUCH</th>", "")
        raw = raw.replace("<th>BREAK</th>", "<th>BREAK</th><th>スコア</th>")
        raw = raw.replace(
            "<td>0</td><td>0</td><td>0</td><td>0</td></tr>",
            "<td>0</td><td>0</td><td>0</td><td>SSS</td><td>SSS+</td></tr>",
        )
        easy = '<tr><td style="background-color:#00ced1">1</td><td>-</td><td>4</td>'
        easy += "<td>4</td><td>0</td><td>0</td><td>0</td><td>SSS</td><td>SSS+</td></tr>"
        raw = raw.replace("</table><p>", easy + "</table><p>")
        rows, _ = wiki_catalog(raw.encode(), WIKI + "1234")
        self.assertEqual([r["difficulty"] for r in rows], ["BASIC", "ADVANCED", "EXPERT", "MASTER"])
        self.assertEqual(rows[0]["chart_constant"], 2.1)
        self.assertEqual(rows[0]["note_counts"], COUNTS)
        with self.assertRaisesRegex(ValueError, "difficulty marker"):
            wiki_catalog(wiki().replace(b"#98fb98", b"#123456"), WIKI + "1234")

    def test_real_prepare_uses_waterfall_and_binds_next_registry(self):
        registry = self.root / "registry"
        write_registry(self.value, registry)
        browser = self.root / "browser"
        initial = self.root / "initial"
        build_registry_package(self.value, self.package, initial)
        build_lab(initial, browser, catalog_version="before")
        run = prepare_update(
            self.root / "updates",
            browser,
            package=initial,
            registry=registry,
            source_fetcher=self.fetch,
        )
        receipt = verify_candidate(run)
        self.assertEqual(read_json(run / "source-audit.json")["counts"]["analyzed"], 4)
        self.assertIn("registry_files", receipt)
        self.assertEqual(read_json(run / "changes.json")["removed"], [])
        self.assertEqual(len(read_json(run / "changes.json")["changed"]), 4)
        self.assertFalse(any("source-captures" in p or "/charts/" in p for p in receipt["files"]))
        self.assertNotIn(
            "UNRELATED_SCORE_SENTINEL",
            "".join(
                (run / "public" / p).read_text("utf-8")
                for p in receipt["files"]
                if p.endswith(".json")
            ),
        )
        publication = {"run": run.name}
        atomic_json(run / "publication.json", publication)
        atomic_json(run.parent.parent / "latest.json", publication)
        with patch("scripts.update_catalog.prepare_update", return_value="prepared") as prepare:
            self.assertEqual(refresh_latest(run.parent.parent), "prepared")
            self.assertEqual(prepare.call_args.kwargs["registry"], run / "registry")
        (run / "registry/extra.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "Candidate changed"):
            verify_candidate(run)
        with self.assertRaisesRegex(ValueError, "Published registry changed"):
            refresh_latest(run.parent.parent)

    def test_changed_source_or_outage_retains_accepted_analysis(self):
        value, additions, _ = refresh(
            self.value, self.legacy, self.cache, self.root / "first", fetcher=self.fetch
        )
        data = build_registry_package(
            value, self.package, self.root / "prepared", additions=additions
        )

        def changed(url, headers):
            status, raw, response = self.fetch(url, headers)
            return status, raw + b" " if url.endswith(".txt") else raw, response

        held, additions, audit = refresh(
            value, data, self.cache, self.root / "changed", fetcher=changed
        )
        self.assertEqual(audit["counts"]["changed_source_review"], 4)
        self.assertEqual(held, value)
        self.assertEqual(additions["profiles"], [])

        for entry in self.manifest["charts"]:
            entry["has_chart_data"] = False
        held, _, audit = refresh(
            value, data, self.cache, self.root / "unplayable", fetcher=self.fetch
        )
        self.assertTrue(
            all(
                not m["available"]
                for m in held["mappings"].values()
                if m["provider"] == "mai-notes"
            )
        )
        self.assertEqual(
            len([r for r in audit["links"] if r["status"] == "availability_changed"]), 4
        )

        def outage(url, headers):
            raise OSError("fixture outage")

        held, additions, audit = refresh(
            value, data, self.cache, self.root / "outage", fetcher=outage
        )
        self.assertEqual(value, held)
        self.assertEqual(additions["profiles"], [])
        self.assertTrue(audit["failures"])

    def test_valid_simai_fallback_and_refreshed_wiki_values(self):
        for chart in self.manifest["charts"]:
            chart["internal_level"] = None
            chart["has_chart_data"] = False

        def fetch(url, headers):
            if url == "https://w.atwiki.jp/simai/pages/1234.html":
                body = "<h2>でらっくす譜面</h2>" + "".join(
                    f"<h3>{difficulty}</h3><pre>{BODY.decode()}</pre>"
                    for difficulty in ("BASIC", "ADVANCED", "EXPERT", "MASTER")
                )
                return 200, ('<div id="wikibody">' + body + "</div>").encode(), {}
            return self.fetch(url, headers)

        value, additions, audit = refresh(
            self.value, self.legacy, self.cache, self.root / "wiki", fetcher=fetch
        )
        self.assertEqual(audit["counts"].get("analyzed"), 4)
        self.assertTrue(
            all(s["provider"] == "simai-wiki-transcription" for s in additions["sources"].values())
        )
        data = build_registry_package(
            value, self.package, self.root / "wiki-package", additions=additions
        )

        def revised(url, headers):
            if url == WIKI + "1234":
                return 200, wiki(constants=(2.2, 6.4, 10.5, 13.3)), {}
            return fetch(url, headers)

        newer, _, _ = refresh(value, data, self.cache, self.root / "wiki-next", fetcher=revised)
        nav = project_registry(newer, data)["navigation"]["charts"]
        self.assertEqual(
            {nav[c["chart_id"]]["chart_constant"] for c in self.future}, {2.2, 6.4, 10.5, 13.3}
        )

    def test_malformed_feed_is_a_reported_failure_not_empty_fresh_data(self):
        def malformed(url, headers):
            if url == METADATA_URLS["mai-notes"]:
                return 200, b"[]", {}
            return self.fetch(url, headers)

        value, additions, audit = refresh(
            self.value, self.legacy, self.cache, self.root / "malformed", fetcher=malformed
        )
        self.assertEqual(value, self.value)
        self.assertFalse(additions["profiles"])
        self.assertTrue(any("Malformed mai-notes" in f["reason"] for f in audit["failures"]))

    def test_adapter_drops_unrelated_fields(self):
        targets, _ = mai_catalog(json.dumps(self.manifest).encode())
        self.assertNotIn("UNRELATED_SCORE_SENTINEL", json.dumps(targets))

    def test_html_response_is_not_treated_as_chart_notation(self):
        def html(url, headers):
            if url.endswith(".txt"):
                return 200, b"<!DOCTYPE html><html>Site shell</html>", {}
            return self.fetch(url, headers)

        _, additions, audit = refresh(
            self.value, self.legacy, self.cache, self.root / "html", fetcher=html
        )
        self.assertEqual(additions["profiles"], [])
        self.assertTrue(
            any(
                "returned HTML" in at["reason"]
                for r in audit["transcriptions"]
                for at in r["attempts"]
            )
        )
