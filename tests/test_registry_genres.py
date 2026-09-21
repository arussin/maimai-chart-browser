"""Source and immutable-browser genre compatibility share explicit regression vectors."""

import json
import tempfile
import unicodedata
import unittest
from copy import deepcopy
from pathlib import Path

from maimai_intelligence.official_inventory import assertion
from maimai_intelligence.registry import empty, read_registry
from maimai_intelligence.registry_catalog import (
    GENRE_ALIASES,
    GENRES,
    build_registry_package,
    genre_id,
    project_registry,
    validate_catalog,
)
from tests.registry_fixture import admit, fixture, official_row

VECTORS = json.loads((Path(__file__).parent / "fixtures/genre-aliases.json").read_text("utf-8"))


class RegistryGenreTests(unittest.TestCase):
    def test_explicit_aliases_and_legacy_ids(self):
        covered = set()
        for vector in VECTORS:
            for raw in vector["aliases"]:
                with self.subTest(raw=raw):
                    self.assertEqual(genre_id(raw), vector["id"])
                    self.assertEqual(genre_id("sega:" + raw), vector["id"])
                    covered.add(unicodedata.normalize("NFKC", raw).strip())
        self.assertEqual(covered, set(GENRE_ALIASES))
        for raw in [
            "Future＆Category™",
            "sega:Future category",
            "pops&anime",
            "POPS & ANIME 2",
            "",
            None,
        ]:
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, "requires genre review"):
                genre_id(raw)

    def test_accepted_official_observations_are_covered(self):
        registry = read_registry(Path(__file__).resolve().parents[1] / "registry")
        for observation in registry["observations"].values():
            if (
                observation["snapshot_id"].startswith("sega-")
                and observation["field"] == "metadata"
            ):
                self.assertIn(genre_id(observation["value"]["catcode"]), GENRES)
        data = project_registry(registry, {})
        self.assertEqual({g["id"] for g in data["navigation"]["genres"]}, set(GENRES))

    def test_rebuild_resolves_both_regions_and_prunes_dead_legacy_genres(self):
        value = empty()
        rows = [
            official_row(f"Genre fixture {index}", "Fixture artist", catcode=raw)
            for index, raw in enumerate(raw for vector in VECTORS for raw in vector["aliases"])
        ]
        value, _ = admit(value, rows)
        songs = {song["metadata"]["title"]: sid for sid, song in value["songs"].items()}
        value, _ = admit(
            value,
            rows,
            region="INTL",
            decisions={
                assertion(row): {
                    "action": "link",
                    "song_id": songs[row["title"]],
                    "evidence": "Authored cross-region genre fixture",
                }
                for row in rows
            },
        )
        legacy = {
            "navigation": {
                "genres": [
                    {"id": "sega:" + raw, "label": raw}
                    for vector in VECTORS
                    for raw in vector["aliases"]
                ]
            }
        }
        data = project_registry(value, legacy)
        genres = {item["id"]: item["label"] for item in data["navigation"]["genres"]}
        self.assertEqual(len(genres), len(data["navigation"]["genres"]))
        self.assertEqual(genres, {v["id"]: v["label"] for v in VECTORS})
        for chart in data["catalog"]:
            self.assertIn(data["navigation"]["charts"][chart["chart_id"]]["genre"], genres)
            for region in chart["regional"].values():
                self.assertIn(region["genre"], genres)

    def test_legacy_chart_genres_are_remapped_and_unused_known_genres_pruned(self):
        with tempfile.TemporaryDirectory() as temporary:
            value, legacy, _ = fixture(Path(temporary))
            ids = ["sega:POPS&ANIME", "sega:niconico＆VOCALOID™"]
            legacy["navigation"]["genres"] = [
                {"id": ids[0], "label": "Obsolete POPS"},
                {"id": ids[1], "label": "Obsolete VOCALOID"},
                {"id": "東方Project", "label": "Touhou Project"},
            ]
            for chart, raw in zip(legacy["catalog"], ids, strict=False):
                legacy["navigation"]["charts"][chart["chart_id"]]["genre"] = raw
            data = project_registry(value, legacy)
            genres = {g["id"]: g["label"] for g in data["navigation"]["genres"]}
            self.assertEqual(genres["POPSアニメ"], "POPS & ANIME")
            self.assertEqual(genres["niconicoボーカロイド"], "niconico & VOCALOID™")
            self.assertNotIn("東方Project", genres)
            self.assertNotIn(ids[0], genres)
            self.assertNotIn(ids[1], genres)

    def test_unknown_official_category_stops_package_before_output(self):
        for region in ("JP", "INTL"):
            with self.subTest(region=region), tempfile.TemporaryDirectory() as temporary:
                value, _ = admit(
                    empty(),
                    [official_row("Unknown fixture", "Artist", catcode="Future category")],
                    region=region,
                )
                output = Path(temporary) / "package"
                with self.assertRaisesRegex(
                    ValueError, f"Future category.*{region} metadata for song"
                ):
                    build_registry_package(value, None, output)
                self.assertFalse(output.exists())

    def test_unrecognized_categories_in_legacy_and_prebuilt_data_require_review(self):
        value, _ = admit(empty(), [official_row("Genre fixture", "Artist")])
        with self.assertRaisesRegex(ValueError, "legacy navigation.genres"):
            project_registry(value, {"navigation": {"genres": [{"id": "sega:Future category"}]}})
        original = project_registry(value, {})
        cid = original["catalog"][0]["chart_id"]
        paths = [
            ("navigation", "genres", 0, "id"),
            ("navigation", "charts", cid, "genre"),
            ("catalog", 0, "regional", "JP", "genre"),
            ("catalog", 0, "regional", "JP", "metadata", "catcode"),
        ]
        for path in paths:
            with self.subTest(path=path):
                data = deepcopy(original)
                target = data
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = "sega:Future category"
                before = deepcopy(data)
                with self.assertRaisesRegex(ValueError, "Future category.*requires genre review"):
                    validate_catalog(data)
                self.assertEqual(data, before)
