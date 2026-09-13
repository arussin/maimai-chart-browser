import copy
import json
import unittest
from unittest.mock import patch

from maimai_intelligence.mai_notes import (
    MAX_INDEX_BYTES,
    NoRedirect,
    download_index,
    parse_index,
    prepare_links,
    validate_links,
)
from tests.mai_notes_fixture import encoded, manifest


class MaiNotesTests(unittest.TestCase):
    def setUp(self):
        self.charts = [
            {
                "chart_id": "a",
                "source_hash": "a" * 64,
                "title": "曲 Song",
                "artist": "Artist",
                "format": "STD",
                "difficulty": "MASTER",
            },
            {
                "chart_id": "b",
                "source_hash": "b" * 64,
                "title": "曲 Song",
                "artist": "Artist",
                "format": "STD",
                "difficulty": "RE:MASTER",
            },
            {
                "chart_id": "c",
                "source_hash": "c" * 64,
                "title": "曲 Song",
                "artist": "Artist",
                "format": "DX",
                "difficulty": "MASTER",
            },
        ]

    def test_exact_difficulty_format_and_availability_with_safe_normalization(self):
        data = manifest(self.charts, unavailable={2})
        for song in data["songs"].values():
            song["title"] = "曲　Ｓｏｎｇ "
            song["artist"] = "ARTIST"
        links, audit = prepare_links(self.charts, json.dumps(data).encode())
        self.assertEqual(set(links["charts"]), {"a", "c"})
        self.assertEqual(audit["counts"], {"linked": 2, "unavailable": 1})
        self.assertNotEqual(links["charts"]["a"]["id"], links["charts"]["c"]["id"])
        self.assertNotIn("UNRELATED_SCORE_SENTINEL", json.dumps(links))

    def test_wrong_artist_and_ambiguous_local_identity_stay_blank(self):
        targets = copy.deepcopy(self.charts)
        targets[0]["artist"] = "Another Artist"
        targets[1]["title"] = "Other Song"
        links, _ = prepare_links(self.charts, encoded(targets))
        self.assertEqual(set(links["charts"]), {"c"})
        duplicate = {**self.charts[2], "chart_id": "duplicate"}
        links, audit = prepare_links([*self.charts, duplicate], encoded(self.charts))
        self.assertNotIn("c", links["charts"])
        self.assertEqual(audit["counts"]["ambiguous"], 2)

    def test_malformed_availability_ids_counts_and_redirects_fail_closed(self):
        mutations = [
            lambda m: m["charts"][0].pop("has_chart_data"),
            lambda m: m["charts"][0].update(has_chart_data="true"),
            lambda m: m["charts"][0].update(id="../../escape"),
            lambda m: m["charts"][1].update(id=m["charts"][0]["id"]),
            lambda m: m.update(charts_count=100),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                data = manifest(self.charts)
                mutation(data)
                with self.assertRaises(ValueError):
                    parse_index(json.dumps(data).encode())
        with self.assertRaises(ValueError):
            parse_index(b" " * (MAX_INDEX_BYTES + 1))
        with self.assertRaises(ValueError):
            NoRedirect().redirect_request(None, None, 302, None, None, "https://example.com")
        with patch("urllib.request.build_opener", side_effect=OSError("unavailable")) as opener:
            with self.assertRaises(OSError):
                download_index()
            self.assertEqual(opener.call_count, 1)

    def test_reviewed_exception_is_body_bound_and_cannot_change_difficulty(self):
        target = {**self.charts[0], "artist": "Different credit spelling"}
        raw = encoded([target])
        override = {
            "chart_id": "a",
            "source_hash": "a" * 64,
            "mai_notes_id": manifest([target])["charts"][0]["id"],
            "evidence": "Manually checked the same composer credit on both pages",
        }
        links, _ = prepare_links(self.charts, raw, overrides=[override])
        self.assertEqual(set(links["charts"]), {"a"})
        for change in ({"source_hash": "x" * 64}, {"chart_id": "b"}, {"evidence": ""}):
            with self.assertRaises(ValueError):
                prepare_links(self.charts, raw, overrides=[{**override, **change}])

    def test_public_link_validation_rejects_stale_or_extra_data(self):
        links, _ = prepare_links(self.charts, encoded(self.charts))
        for field, value in (
            ("difficulty", "BASIC"),
            ("source_hash", "0" * 64),
            ("id", "https://wrong.example/"),
            ("player", "private"),
        ):
            changed = copy.deepcopy(links)
            changed["charts"]["a"][field] = value
            with self.assertRaises(ValueError):
                validate_links(changed, self.charts)
