"""Unrelated catalog edits cannot invalidate reusable song content."""

import copy
import json
import unittest

from maimai_intelligence.seo import build_seo
from tests.test_seo import catalog


def song_assets(data):
    assets, _, _ = build_seo(data)
    return {
        json.loads(raw)["song_id"]: (path, raw)
        for path, raw in assets.items()
        if path.startswith("song-catalog/")
    }


class SongContentTests(unittest.TestCase):
    def test_unrelated_title_correction_changes_only_its_song_content(self):
        original = catalog()
        changed = copy.deepcopy(original)
        for chart in changed["catalog"]:
            if chart["song_id"] == "song:two":
                chart["title"] = "Corrected public title"
        before, after = song_assets(original), song_assets(changed)
        self.assertEqual(set(before), set(after))
        self.assertEqual([sid for sid in before if before[sid] != after[sid]], ["song:two"])

    def test_unrelated_genre_release_and_artwork_do_not_change_other_song_content(self):
        original = catalog()
        original["navigation"].update(
            genres=[{"id": "maimai", "label": "maimai"}], versions=["Japan release"]
        )
        original["artwork"] = {
            "version": "public-artwork-1",
            "songs": {},
            "versions": {"Japan release": "jp"},
            "assets": {"jp": {"fixture": 1}},
        }
        changed = copy.deepcopy(original)
        changed["navigation"]["genres"].append({"id": "unrelated", "label": "New genre"})
        changed["navigation"]["versions"].append("New release")
        changed["artwork"]["versions"]["New release"] = "new"
        changed["artwork"]["assets"]["new"] = {"fixture": 2}
        for chart in changed["catalog"]:
            if chart["song_id"] == "song:two":
                changed["navigation"]["charts"][chart["chart_id"]].update(
                    genre="unrelated", version="New release"
                )
        before, after = song_assets(original), song_assets(changed)
        self.assertEqual([sid for sid in before if before[sid] != after[sid]], ["song:two"])


if __name__ == "__main__":
    unittest.main()
