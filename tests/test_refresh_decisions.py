"""Behavioral contracts for refresh stage extraction using authored public sources."""

import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

from maimai_intelligence.catalog_refresh import METADATA_URLS, refresh
from maimai_intelligence.catalog_sources import WIKI
from maimai_intelligence.catalog_transcriptions import profile_chart
from maimai_intelligence.coverage_types import IntegrityError, SnapshotError
from maimai_intelligence.metadata_adapters import MetadataAdapter, builtin_adapter
from maimai_intelligence.metadata_waterfall import accept, propose
from maimai_intelligence.registry import digest, empty, write_registry
from maimai_intelligence.registry_catalog import project_registry
from tests.mai_notes_fixture import manifest
from tests.registry_fixture import admit, official_row
from tests.test_catalog_waterfall import BODY, wiki


class RefreshDecisionContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        network = patch("socket.socket", side_effect=AssertionError("Network forbidden"))
        network.start()
        self.addCleanup(network.stop)
        self.row = official_row("Future Song", "Future Artist")
        self.value, _ = admit(empty(), [self.row])
        self.published = {"catalog": [], "snippets": {"retained": "authored sentinel"}}
        self.charts = project_registry(self.value, self.published)["catalog"]
        self.feed = manifest(self.charts)
        for song in self.feed["songs"].values():
            song.update(bpm=120, gamerch_id=1234)
        for chart in self.feed["charts"]:
            chart.update(taps=4, hold=0, slide=0, touch=0, breaks=0)
        self.calls = []
        self.cache = self.root / "cache"

    def fetch(self, url, headers):
        self.calls.append(url)
        if url == METADATA_URLS["mai-notes"]:
            return 200, json.dumps(self.feed).encode(), {}
        if url == WIKI + "1234":
            return 200, wiki(), {}
        if url.startswith("https://mai-notes.com/data/charts/"):
            return 200, BODY, {}
        raise OSError("Authored unavailable provider")

    def run_refresh(self, output="run", **kwargs):
        return refresh(
            kwargs.pop("value", self.value),
            self.published,
            self.cache,
            self.root / output,
            fetcher=kwargs.pop("fetcher", self.fetch),
            **kwargs,
        )

    def accepted_before_failure(self):
        write_registry(self.value, self.root / "run" / "registry")
        (self.root / "run" / "owner-note.txt").write_text("Retained accepted candidate")
        return deepcopy(self.value), deepcopy(self.published), self.output_bytes()

    def output_bytes(self):
        return {
            path.relative_to(self.root / "run").as_posix(): path.read_bytes()
            for path in (self.root / "run").rglob("*")
            if path.is_file()
        }

    def assert_accepted_unchanged(self, before):
        value, published, output = before
        self.assertEqual(self.value, value)
        self.assertEqual(self.published, published)
        self.assertEqual(self.output_bytes(), output)

    def arcade(self):
        return json.dumps(
            {
                "songs": [
                    {
                        "title": self.row["title"],
                        "artist": self.row["artist"],
                        "bpm": 150,
                        "sheets": [{"type": "dx", "difficulty": "master", "internalLevel": "14.2"}],
                    }
                ]
            }
        ).encode()

    def test_late_capture_integrity_failure_preserves_accepted_inputs_and_candidate(self):
        before = self.accepted_before_failure()

        def interrupted(url, headers):
            if url == WIKI + "1234":
                raise IntegrityError("Authored late capture corruption")
            return self.fetch(url, headers)

        with self.assertRaisesRegex(IntegrityError, "late capture corruption"):
            self.run_refresh(fetcher=interrupted)
        self.assertIn(METADATA_URLS["mai-notes"], self.calls)
        self.assert_accepted_unchanged(before)

    def test_late_adapter_programming_failure_is_fatal_and_preserves_candidate(self):
        before = self.accepted_before_failure()
        normalized = []
        first = builtin_adapter("arcade-songs", METADATA_URLS["arcade-songs"])

        def normalize_first(raw, metadata):
            rows = first.normalize(raw, metadata)
            normalized.extend(rows)
            return rows

        def broken_adapter(raw, metadata):
            raise TypeError("Authored adapter programming defect")

        adapters = [
            MetadataAdapter(first.provider, first.url, normalize_first),
            MetadataAdapter("otoge-db", METADATA_URLS["otoge-db"], broken_adapter),
        ]
        with self.assertRaisesRegex(TypeError, "adapter programming defect"):
            self.run_refresh(
                metadata_adapters=adapters,
                fetcher=lambda *_: (200, self.arcade(), {}),
            )
        self.assertEqual(len(normalized), 1)
        self.assert_accepted_unchanged(before)

    def test_rejected_optional_metadata_keeps_other_claims_without_mutating_inputs(self):
        before = deepcopy(self.value), deepcopy(self.published)

        def rejected(raw, metadata):
            raise SnapshotError("Authored rejected provider schema")

        def fetch(url, headers):
            if url in {METADATA_URLS["arcade-songs"], METADATA_URLS["otoge-db"]}:
                return 200, self.arcade(), {}
            raise OSError("Authored absent Wiki")

        value, _, audit = self.run_refresh(
            fetcher=fetch,
            metadata_adapters=[
                builtin_adapter("arcade-songs", METADATA_URLS["arcade-songs"]),
                MetadataAdapter("otoge-db", METADATA_URLS["otoge-db"], rejected),
            ],
        )
        master = next(chart for chart in self.charts if chart["difficulty"] == "MASTER")
        nav = project_registry(value, self.published)["navigation"]["charts"][master["chart_id"]]
        self.assertEqual((nav["bpm"], nav["chart_constant"]), (150, 14.2))
        self.assertIn(
            {"provider": "otoge-db", "reason": "Authored rejected provider schema"},
            audit["failures"],
        )
        self.assertEqual((self.value, self.published), before)

    def test_late_analysis_failure_never_publishes_partial_transcriptions(self):
        before = self.accepted_before_failure()
        qualified = []

        def interrupted(chart):
            if qualified:
                raise RuntimeError("Authored later analysis defect")
            result = profile_chart(chart)
            qualified.append(result)
            return result

        with (
            patch("maimai_intelligence.catalog_transcriptions.profile_chart", interrupted),
            self.assertRaisesRegex(RuntimeError, "later analysis defect"),
        ):
            self.run_refresh()
        self.assertEqual(len(qualified), 1)
        self.assertEqual(len(list((self.cache / "analysis").glob("*.json"))), 1)
        self.assert_accepted_unchanged(before)

    def test_metadata_priority_is_independent_of_acquisition_order(self):
        def fetch(url, headers):
            if url == METADATA_URLS["arcade-songs"]:
                return 200, self.arcade(), {}
            if url == METADATA_URLS["otoge-db"]:
                return (
                    200,
                    json.dumps([{**self.row, "bpm": 160, "dx_lev_mas_i": 14.8}]).encode(),
                    {},
                )
            raise OSError("Authored absent Wiki")

        master = next(chart for chart in self.charts if chart["difficulty"] == "MASTER")
        for providers in (("arcade-songs", "otoge-db"), ("otoge-db", "arcade-songs")):
            with self.subTest(providers=providers):
                value, _, _ = self.run_refresh(
                    output=providers[0],
                    fetcher=fetch,
                    metadata_adapters=[
                        builtin_adapter(name, METADATA_URLS[name]) for name in providers
                    ],
                )
                nav = project_registry(value, self.published)["navigation"]["charts"][
                    master["chart_id"]
                ]
                self.assertEqual((nav["bpm"], nav["chart_constant"]), (150, 14.2))
                self.assertEqual(
                    nav["metric_sources"]["chart_constant"]["provider"], "Arcade Songs"
                )
                self.assertEqual(
                    {item["value"] for item in nav["metadata_alternatives"]["chart_constant"]},
                    {14.2, 14.8},
                )

    def test_wiki_refresh_checks_linked_then_retained_then_discovered_pages(self):
        self.value, _ = admit(self.value, [official_row("Discovery Song", "Discovery Artist")])
        raw = wiki()
        proposal = propose(
            self.value,
            [
                (
                    "gamerch-wiki",
                    raw,
                    {
                        "url": WIKI + "7777",
                        "bytes": len(raw),
                        "sha256": hashlib.sha256(raw).hexdigest(),
                        "captured_at": "2026-09-17T12:00:00Z",
                    },
                )
            ],
        )
        self.value = accept(
            self.value,
            proposal,
            {
                "proposal_sha256": digest(proposal),
                "evidence": "Authored retained Wiki evidence",
                "accept": [claim["observation_id"] for claim in proposal["claims"]],
            },
        )
        for chart in self.feed["charts"]:
            chart["has_chart_data"] = False
        pages = {
            WIKI: (
                '<a href="/maimai/3000">maimai</a><a href="/maimai/2000">POPS&アニメ</a>'
            ).encode(),
            WIKI + "2000": b'<a href="/maimai/4000">Discovery Song</a>',
            WIKI + "3000": b'<a href="/maimai/4000">Discovery Song</a>',
            WIKI + "7777": raw,
            WIKI + "4000": wiki("Discovery Song", "Discovery Artist"),
        }

        def fetch(url, headers):
            if url in pages:
                self.calls.append(url)
                return 200, pages[url], {}
            return self.fetch(url, headers)

        self.run_refresh(fetcher=fetch)
        self.assertEqual(
            [url for url in self.calls if url.startswith(WIKI)],
            [WIKI + "1234", WIKI + "7777", WIKI, WIKI + "2000", WIKI + "3000", WIKI + "4000"],
        )

    def test_missing_retained_target_does_not_reassign_identical_replacement(self):
        accepted, _, _ = self.run_refresh(output="first")
        before = deepcopy(accepted)
        prior = next(
            mapping
            for mapping in accepted["mappings"].values()
            if mapping["provider"] == "mai-notes"
        )
        removed = next(
            chart for chart in self.feed["charts"] if chart["id"] == prior["provider_id"]
        )
        replacement = {**removed, "id": str(UUID(int=9000))}
        self.feed["charts"] = [
            replacement if chart is removed else chart for chart in self.feed["charts"]
        ]
        held, additions, audit = self.run_refresh(value=accepted, output="missing")
        retained = [
            mapping
            for mapping in held["mappings"].values()
            if mapping["provider"] == "mai-notes" and mapping["subject_id"] == prior["subject_id"]
        ]
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0]["provider_id"], prior["provider_id"])
        self.assertEqual(retained[0]["state"], "accepted")
        self.assertFalse(retained[0]["available"])
        self.assertIn(
            {"chart_id": prior["subject_id"], "status": "provider_entry_missing"}, audit["links"]
        )
        self.assertEqual(
            held["charts"][prior["subject_id"]], accepted["charts"][prior["subject_id"]]
        )
        self.assertEqual(additions["profiles"], [])
        self.assertEqual(accepted, before)

    def test_contradictory_retained_identity_holds_mapping_and_prior_analysis(self):
        accepted, _, _ = self.run_refresh(output="first")
        before = deepcopy(accepted)
        prior = next(
            mapping
            for mapping in accepted["mappings"].values()
            if mapping["provider"] == "mai-notes"
        )
        target = next(chart for chart in self.feed["charts"] if chart["id"] == prior["provider_id"])
        self.feed["songs"][target["song_id"]]["artist"] = "Contradictory Artist"
        held, additions, audit = self.run_refresh(value=accepted, output="contradiction")
        retained = next(
            mapping
            for mapping in held["mappings"].values()
            if mapping["provider"] == "mai-notes" and mapping["subject_id"] == prior["subject_id"]
        )
        self.assertEqual(retained["provider_id"], prior["provider_id"])
        self.assertEqual(retained["state"], "accepted")
        self.assertFalse(retained["available"])
        self.assertIn(
            {"chart_id": prior["subject_id"], "status": "changed_identity_review"}, audit["links"]
        )
        self.assertEqual(
            held["charts"][prior["subject_id"]], accepted["charts"][prior["subject_id"]]
        )
        self.assertEqual(additions["profiles"], [])
        self.assertEqual(accepted, before)


if __name__ == "__main__":
    unittest.main()
