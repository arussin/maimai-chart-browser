import copy
import json
import shutil
import subprocess
import unittest
from importlib.resources import files
from unittest.mock import patch

from maimai_intelligence.song_search import (
    _search_sources,
    display_readings,
    song_presentation_data,
    song_search_script,
)


class DisplayReadingsTests(unittest.TestCase):
    def test_public_names_require_separate_identity_and_evidence_review(self):
        sources = _search_sources()
        sid = "song:2d9de697-55ca-472c-80f7-e9fed7c35cef"
        names = song_presentation_data()
        self.assertEqual(names[sid]["alternate_names"], ["BOGE"])
        self.assertEqual(names[sid]["reading"], "")
        self.assertEqual(
            names["song:9000aa45-25a5-4847-a6c3-5ee152121826"]["reading"], "Umiyuri Kaiteitan"
        )
        self.assertEqual(names["song:39407427-33d2-4c6e-9155-d742d7a3fd6a"]["reading"], "")
        for key, value in (
            ("artist", "Wrong artist"),
            ("song_id", "wrong-id"),
            ("kind", "translation"),
            ("review_status", "ai-reviewed"),
            ("value", "unreviewed nickname"),
            ("sources", []),
            ("locales", ["ko"]),
        ):
            changed = copy.deepcopy(sources)
            changed[2]["alternate_names"][0][key] = value
            with (
                self.subTest(key=key),
                patch("maimai_intelligence.song_search._search_sources", return_value=changed),
            ):
                with self.assertRaisesRegex(ValueError, "source identity"):
                    song_presentation_data()

    def test_public_name_review_does_not_modify_browser_search_payload(self):
        before = song_search_script()
        sources = _search_sources()
        sources[2].pop("alternate_names")
        with patch("maimai_intelligence.song_search._search_sources", return_value=sources):
            self.assertEqual(song_search_script(), before)

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
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is required for the generated adapter contract")
        program = """
const vm=require('vm'),fs=require('fs');
vm.runInThisContext(fs.readFileSync(0,'utf8'));
const chart={title:'ソテリア',artist:'Aran'};
if(typeof maimaiSongSearch.romaji!=='function'||!maimaiSongSearch.query('ソテリア')(chart)
 ||maimaiSongSearch.query('unrelated sentinel')(chart))process.exitCode=1;
"""
        subprocess.run(  # noqa: S603 -- generated local adapter and authored synthetic input
            [node, "-e", program], input=script, text=True, check=True, timeout=20
        )

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
