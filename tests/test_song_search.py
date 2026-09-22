import copy
import json
import unittest
from importlib.resources import files

from maimai_intelligence.song_search import display_readings, song_search_script


class DisplayReadingsTests(unittest.TestCase):
    def test_display_excludes_approximations_and_keeps_alias_identity(self):
        def row(title, reading, kind="kana-title"):
            return {
                "title": title,
                "artist": "Artist",
                "aliases": [{"locale": "en", "kind": kind, "value": reading}],
            }

        songs = {
            "a": row("ソテリア", "soteria"),
            "b": row("漢字", "approximate", "approximate-sort-key"),
            "c": row("Latin", "Latin"),
            "d": row("カナ", "kana漢字"),
        }
        aliases = [
            ["ソテリア", "Other artist", ["Wrong"]],
            ["ソテリア", "Artist", ["Nickname", "Soteria"]],
        ]
        self.assertEqual(display_readings(songs, aliases), [["ソテリア", "Artist", "Soteria"]])

    def test_packaged_script_contains_no_unresolved_markers(self):
        script = song_search_script()
        self.assertNotIn("__MAIMAI_", script)
        self.assertIn("{query,romaji}", script)

    def test_reviewed_aliases_fill_real_reading_gaps_without_translations(self):
        assets = files("maimai_intelligence.assets")
        songs = json.loads(assets.joinpath("song-localizations.json").read_text("utf-8"))["songs"]
        aliases = json.loads(assets.joinpath("song-aliases.json").read_text("utf-8"))["entries"]
        reviewed = json.loads(assets.joinpath("song-display-readings.json").read_text("utf-8"))[
            "entries"
        ]
        before = copy.deepcopy(songs)
        result = {(t, a): r for t, a, r in display_readings(songs, aliases, reviewed)}
        self.assertEqual(result[("馬と鹿", "米津玄師")], "Uma to Shika")
        self.assertEqual(result[("深海少女", "ゆうゆ")], "Shinkai Shoujo")
        self.assertNotIn(("白い雪のプリンセスは", "のぼる↑"), result)
        self.assertEqual(songs, before)
        wrong_artist = copy.deepcopy(reviewed)
        wrong_artist[0]["artist"] = "Different artist"
        with self.assertRaisesRegex(ValueError, "source identity"):
            display_readings(songs, aliases, wrong_artist)
        unsupported = copy.deepcopy(reviewed)
        unsupported[0]["reading"] = "Unreviewed invented reading"
        with self.assertRaisesRegex(ValueError, "source identity"):
            display_readings(songs, aliases, unsupported)
