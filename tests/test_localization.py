import json
import re
import unittest
from collections import Counter
from copy import deepcopy
from importlib.resources import files
from pathlib import Path
from tempfile import TemporaryDirectory

from maimai_intelligence.localization import localization_script, messages
from maimai_intelligence.multilingual_search import compile_aliases, enrich_registry, kana_spellings
from maimai_intelligence.registry import empty, read_registry
from scripts.check_localization import missing
from scripts.check_localization_review import file_fingerprint, fingerprint, stale_inputs
from tests.registry_fixture import admit, official_row


class LocalizationTests(unittest.TestCase):
    def test_readme_translations_preserve_commands_links_and_section_structure(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "README.md").read_text("utf-8")

        def structure(text):
            return {
                "commands": re.findall(r"```[^\n]*\n(.*?)\n```", text, re.S),
                "code": Counter(re.findall(r"(?<!`)`([^`\n]+)`(?!`)", text)),
                "links": Counter(re.findall(r"\[[^\]]+\]\(([^)\s]+)\)", text)),
                "headings": re.findall(r"^#+(?= )", text, re.M),
            }

        for locale in ("zh-Hans", "ko", "ja"):
            with self.subTest(locale=locale):
                translated = (root / f"README.{locale}.md").read_text("utf-8")
                self.assertEqual(structure(source), structure(translated))

    def test_readme_review_detects_english_edits_translation_edits_and_deleted_files(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            assets = root / "src/maimai_intelligence/assets"
            assets.mkdir(parents=True)
            aliases = assets / "song-pronunciations.json"
            aliases.write_text('{"songs": {}}', encoding="utf-8")
            source, translation = root / "README.md", root / "README.ja.md"
            source.write_text("# Original\n", encoding="utf-8")
            translation.write_text("# 翻訳\n", encoding="utf-8")
            reviewed = {
                p.relative_to(root).as_posix(): file_fingerprint(p)
                for p in (source, translation, aliases)
            }
            source.write_bytes(b"# Original\r\n")
            self.assertEqual(stale_inputs(root, reviewed), [])
            source.write_text("# Changed\n", encoding="utf-8")
            self.assertEqual(stale_inputs(root, reviewed), ["README.md"])
            source.write_text("# Original\n", encoding="utf-8")
            translation.write_text("# 別の翻訳\n", encoding="utf-8")
            self.assertEqual(stale_inputs(root, reviewed), ["README.ja.md"])
            translation.unlink()
            self.assertEqual(stale_inputs(root, reviewed), ["README.ja.md"])

    def test_language_review_detects_changed_copy_and_new_catalogs(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            assets = root / "src/maimai_intelligence/assets"
            (assets / "locales").mkdir(parents=True)
            source = assets / "locales/support.json"
            source.write_text('{"Support": {"ko": "후원"}}', encoding="utf-8")
            aliases = assets / "song-pronunciations.json"
            aliases.write_text('{"songs": {}}', encoding="utf-8")
            reviewed = {
                p.relative_to(root).as_posix(): fingerprint(json.loads(p.read_text("utf-8")))
                for p in (source, aliases)
            }
            self.assertEqual(stale_inputs(root, reviewed), [])
            source.write_text('{"Support": {"ko": "지원"}}', encoding="utf-8")
            new = assets / "locales/new-page.json"
            new.write_text("{}", encoding="utf-8")
            self.assertEqual(
                set(stale_inputs(root, reviewed)),
                {p.relative_to(root).as_posix() for p in (source, new)},
            )

    def test_shipped_copy_has_complete_catalog_and_safe_inline_script(self):
        self.assertEqual(missing(), {})
        catalog = messages()
        for source in (
            "Support maimai.party",
            "Opening secure checkout…",
            "Close support checkout",
            "Find a chart",
            "Skip to comparison",
            "Play demo",
        ):
            self.assertTrue(source in catalog, source)
        script = localization_script()
        self.assertNotIn("__MAIMAI_MESSAGES__", script)
        self.assertNotIn("</script", script.lower())

    def test_phonetics_preserve_voicing_and_compound_kana(self):
        roman, hangul, _, unresolved = kana_spellings("センボンザクラ")
        self.assertEqual((roman, hangul, unresolved), ("senbonzakura", "센본자쿠라", ""))
        self.assertEqual(kana_spellings("そてりあ")[:2], ("soteria", "소테리아"))
        self.assertEqual(kana_spellings("キャット")[:2], ("kyatto", "캿토"))
        self.assertEqual(kana_spellings("ふ・れ・ん・ど")[:2], ("furendo", "후렌도"))
        self.assertEqual(kana_spellings("ン")[:2], ("n", "응"))

    def test_offline_generation_is_deterministic_and_never_mutates_identity(self):
        registry, _ = admit(
            empty(), [official_row("千本桜", "黒うさP", title_kana="センホンサクラ")]
        )
        sid = next(iter(registry["songs"]))
        before = deepcopy(registry)
        overrides = {
            "songs": {
                sid: {
                    "title": "千本桜",
                    "artist": "黒うさP",
                    "reading": "センボンザクラ",
                    "aliases": {"zh-Hans": ["千本樱"], "ko": ["천본앵"]},
                }
            }
        }
        artifact = compile_aliases(registry, overrides=overrides)
        self.assertEqual(artifact, compile_aliases(registry, overrides=overrides))
        self.assertEqual(before, registry)
        names = {row["value"] for row in artifact["songs"][sid]["aliases"]}
        self.assertTrue(
            {"千本樱", "qian ben ying", "센본자쿠라", "천본앵", "senbonzakura"} <= names
        )
        self.assertEqual(artifact["coverage"]["missing_aliases"], 0)
        overrides["songs"][sid]["artist"] = "Different artist"
        with self.assertRaisesRegex(ValueError, "identity needs review"):
            compile_aliases(registry, overrides=overrides)

    def test_unknown_pronunciation_is_reported_and_not_false_hangul_coverage(self):
        registry, _ = admit(empty(), [official_row("XYZZQQ", "Fixture", title_kana="XYZZQQ")])
        artifact = compile_aliases(registry, overrides={"songs": {}})
        self.assertEqual(artifact["coverage"]["missing_aliases"], 1)
        self.assertNotIn("ko", artifact["coverage"]["by_locale"])
        self.assertEqual(artifact["coverage"]["review_queue"][0]["missing"], ["ko", "zh-Hans"])

    def test_kana_title_beats_lossy_sorting_key(self):
        registry, _ = admit(empty(), [official_row("アイドル", "Fixture", title_kana="アイトル")])
        artifact = compile_aliases(registry, overrides={"songs": {}})
        song = next(iter(artifact["songs"].values()))
        self.assertEqual(song["reading_basis"], "kana-title")
        self.assertIn("아이도루", [a["value"] for a in song["aliases"]])
        self.assertNotIn("아이토루", [a["value"] for a in song["aliases"]])

    def test_locale_correction_replaces_bad_generated_spellings(self):
        registry, _ = admit(
            empty(), [official_row("あいたい星人", "Fixture", title_kana="アイタイセイシン")]
        )
        sid = next(iter(registry["songs"]))
        artifact = compile_aliases(
            registry,
            overrides={
                "songs": {
                    sid: {
                        "title": "あいたい星人",
                        "artist": "Fixture",
                        "aliases": {"ko": ["아이타이 세이진"], "zh-Hans": ["想见你的星人"]},
                    }
                }
            },
        )
        aliases = artifact["songs"][sid]["aliases"]
        self.assertEqual([a["value"] for a in aliases if a["locale"] == "ko"], ["아이타이 세이진"])
        self.assertEqual(
            [a["value"] for a in aliases if a["locale"] == "zh-Hans"], ["想见你的星人"]
        )
        self.assertTrue(all("あ" not in a["value"] for a in aliases if a["locale"] == "zh-Latn"))

    def test_partly_unconverted_reading_is_a_coverage_gap(self):
        registry, _ = admit(empty(), [official_row("架空", "Fixture", title_kana="アXYZZQQ")])
        artifact = compile_aliases(registry, overrides={"songs": {}})
        self.assertNotIn("ko", artifact["coverage"]["by_locale"])
        self.assertEqual(artifact["coverage"]["review_queue"][0]["missing"], ["ko"])

    def test_compatibility_kana_cannot_be_labeled_as_chinese(self):
        registry, _ = admit(
            empty(),
            [official_row("㋰責任集合体", "Fixture", title_kana="ムセキニンシュウゴウタイ")],
        )
        artifact = compile_aliases(registry, overrides={"songs": {}})
        song = next(iter(artifact["songs"].values()))
        chinese = [a for a in song["aliases"] if a["locale"] in {"zh-Hans", "zh-Latn"}]
        self.assertTrue(chinese)
        self.assertEqual(song["title"], "㋰責任集合体")
        for alias in chinese:
            self.assertNotRegex(alias["value"], r"[ぁ-ヿ㋐-㋾]")
            self.assertNotEqual(alias["kind"], "generated-script-conversion")

    def test_bundled_aliases_are_current_and_keep_review_status_visible(self):
        registry = read_registry(Path(__file__).resolve().parents[1] / "registry")
        before = deepcopy(registry)
        enriched, artifact = enrich_registry(registry)
        committed = json.loads(
            files("maimai_intelligence.assets")
            .joinpath("song-localizations.json")
            .read_text("utf-8")
        )
        self.assertEqual(artifact, committed)
        self.assertEqual(before, registry)
        self.assertEqual(artifact["coverage"]["missing_aliases"], 0)
        self.assertEqual(artifact["coverage"]["unused_override_ids"], [])
        self.assertTrue(artifact["coverage"]["review_queue"])
        for sid, song in enriched["songs"].items():
            self.assertEqual(song["metadata"], before["songs"][sid]["metadata"])
        self.assertEqual(enriched["observations"], before["observations"])


if __name__ == "__main__":
    unittest.main()
