"""Authored containers only: isolated acquisition, byte provenance and difficulty identity."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import acquire_maichart_pack as acquire
from scripts import analyze_simai_corpus as corpus
from scripts import prepare_maichart_pack as prepare

REVISION = "a" * 40
BODY = "(120){4}1,2,1,2,E"


def container(source_id="41", body=BODY, extra="", cabinet="SD"):
    return (
        f"&title=Fictional Lantern[SD]\n&artist=Authored Test Composer\n"
        f"&shortid={source_id}\n&cabinet={cabinet}\n&wholebpm=120\n&first=-2.5\n"
        f"&version=Authored Version\n&lv_1=\n&lv_4=12.8\n&inote_4=\n{body}\n{extra}"
    ).encode()


def fixture(root, inputs=None):
    inputs = inputs or {"maimai/41_FICTIONAL/maidata.txt": container()}
    files = {"index.json": b'{"41":"Fictional Lantern","100041":"Fictional Event"}', **inputs}
    tree = {
        "sha": "b" * 40,
        "truncated": False,
        "tree": [
            {
                "path": path,
                "type": "blob",
                "mode": "100644",
                "sha": acquire.git_blob_hash(data),
                "size": len(data),
            }
            for path, data in files.items()
        ],
    }

    def fetch(url):
        if "/git/trees/" in url:
            return json.dumps(tree).encode()
        from urllib.parse import unquote

        return files[unquote(url.split(REVISION + "/", 1)[1])]

    with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
        acquire.capture(root, REVISION, fetcher=fetch, workers=1)
    return tree, files


def rows(root):
    return [json.loads(line) for line in (root / "charts.jsonl").read_bytes().splitlines()]


class ContainerBoundaryTests(unittest.TestCase):
    def test_bom_crlf_unicode_and_each_body_have_exact_original_byte_ranges(self):
        data = b"\xef\xbb\xbf" + container(extra="&lv_5=13.0\n&inote_5=(180){8}3,4,E\n")
        data = data.replace(b"Fictional Lantern", "Fictional 星".encode()).replace(b"\n", b"\r\n")
        fields = prepare.split_container(data)
        for field in fields.values():
            self.assertEqual(data[field["start"] : field["end"]], field["value"].encode())
        self.assertEqual(fields["inote_4"]["value"], "\r\n" + BODY + "\r\n")
        self.assertEqual(fields["inote_5"]["value"], "(180){8}3,4,E\r\n")

    def test_repeated_identity_or_body_headers_reject_instead_of_overwriting(self):
        for extra in ("&shortid=41\n", "&inote_4=(120){4}8,E\n", "&inote_04=1,E\n"):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                prepare.split_container(container(extra=extra))

    def test_repeated_event_options_are_preserved_and_not_applied(self):
        fields = prepare.split_container(
            container(extra="&fixedoption=Mirror:Normal\n&fixedoption=TrackSkip:Off\n")
        )
        self.assertEqual(fields["fixedoption"]["value"], "Mirror:Normal\n")
        self.assertEqual(fields["fixedoption"]["repeated_values"][0]["value"], "TrackSkip:Off\n")

    def test_unsupported_slots_remain_separate_and_malformed_headers_fail(self):
        fields = prepare.split_container(container(extra="&inote_7=(120){4}8,E\n"))
        self.assertNotIn("8,E", fields["inote_4"]["value"])
        self.assertIn("inote_7", fields)
        for body in ("bad prefix\n&inote_4=1,E", "&inote_4=(120){4}1,\n &title=Hidden\nE"):
            with self.subTest(body=body), self.assertRaises(ValueError):
                prepare.split_container(body.encode())


class CaptureTests(unittest.TestCase):
    def test_offline_replay_verifies_every_file_without_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture(root)
            original = (root / "capture.json").read_bytes()
            with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
                acquire.capture(root, REVISION, offline=True)
            self.assertEqual((root / "capture.json").read_bytes(), original)

    def test_corrupt_cache_is_not_redownloaded_or_silently_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture(root)
            path = root / "raw/maimai/41_FICTIONAL/maidata.txt"
            path.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "pinned Git blob"):
                acquire.capture(root, REVISION, offline=True)
            self.assertEqual(path.read_bytes(), b"tampered")
            self.assertEqual(
                json.loads((root / "capture.json").read_bytes())["status"], "interrupted"
            )

    def test_revision_changes_and_truncated_unsafe_or_duplicate_trees_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tree, _ = fixture(root)
            with self.assertRaisesRegex(ValueError, "another source revision"):
                acquire.capture(root, "c" * 40, offline=True)
            for mutate in (
                lambda t: t.update(truncated=True),
                lambda t: t["tree"][0].update(path="../outside/maidata.txt"),
                lambda t: t["tree"][0].update(mode="120000"),
                lambda t: t["tree"].append(t["tree"][0]),
            ):
                changed = copy.deepcopy(tree)
                mutate(changed)
                with self.assertRaises(ValueError):
                    acquire.selected_entries(changed)

    def test_only_text_inventory_is_selected(self):
        with tempfile.TemporaryDirectory() as temporary:
            tree, _ = fixture(Path(temporary))
            tree["tree"].extend({"path": x} for x in ("music.ogg", "cover.png", "source.zip"))
            self.assertEqual(len(acquire.selected_entries(tree)), 2)


class PackPreparationTests(unittest.TestCase):
    def test_pure_pack_end_to_end_never_reads_quarantine_or_repairs_timing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            data = container(extra="&lv_5=13.0\n&inote_5=1,2,E\n")
            fixture(root, {"maimai/41_FICTIONAL/maidata.txt": data})
            unrelated = root / "quarantine/old.simai"
            unrelated.parent.mkdir()
            unrelated.write_text("(999){4}8,E")
            with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
                audit = prepare.prepare(root)
                result = corpus.process_corpus(root / "manifest.json", Path(temporary) / "results")
            self.assertEqual(audit["chart_rows"], 2)
            self.assertEqual(result["analyzed"], 1)
            self.assertEqual(result["statuses"]["unsupported"], 1)
            for row in rows(root):
                body = (root / row["body_file"]).read_bytes()
                self.assertEqual(body, data[row["body_byte_start"] : row["body_byte_end"]])
                self.assertNotIn("constant", row)
            self.assertEqual(rows(root)[0]["level"], "12+")
            page = (Path(temporary) / "results/index.html").read_text(encoding="utf-8")
            self.assertIn("Maichart-Converts dataset trial", page)
            self.assertIn("1 chart containers captured", page)
            self.assertNotIn("linked source pages", page)
            self.assertEqual(unrelated.read_text(), "(999){4}8,E")

    def test_identical_duplicate_bodies_alias_but_conflicting_bodies_are_unresolved(self):
        for second, expected, aliases, conflicts in ((BODY, 1, 1, 0), ("(120){4}8,E", 2, 0, 2)):
            with self.subTest(second=second), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                fixture(
                    root,
                    {
                        "maimai/41_ONE/maidata.txt": container(),
                        "maimai/41_TWO/maidata.txt": container(body=second),
                    },
                )
                audit = prepare.prepare(root)
                self.assertEqual(audit["chart_rows"], expected)
                self.assertEqual(len(audit["duplicate_body_aliases"]), aliases)
                self.assertEqual(len(audit["conflicting_rows"]), conflicts)
                if conflicts:
                    self.assertTrue(all(not r["identity_resolved"] for r in rows(root)))

    def test_utage_unknown_slots_and_bad_shortid_never_become_regular_analyzed_charts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            fixture(
                root,
                {
                    "宴会場/100041_EVENT/maidata.txt": container(
                        "100041", extra="&inote_7=(120){4}8,E\n"
                    ),
                    "maimai/41_BAD_ID/maidata.txt": container("42"),
                },
            )
            audit = prepare.prepare(root)
            self.assertEqual(audit["formats"], {"UTAGE": 2, "STD": 1})
            result = corpus.process_corpus(root / "manifest.json", Path(temporary) / "results")
            self.assertEqual(result["analyzed"], 0)
            self.assertEqual(result["failure_categories"], {"unsupported_identity": 3})

    def test_declared_missing_body_is_reported_but_blank_absent_slot_is_not_invented(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture(
                root,
                {
                    "maimai/41_FICTIONAL/maidata.txt": container(
                        extra="&lv_5=13.0\n&inote_5=\n&inote_1=\n"
                    )
                },
            )
            audit = prepare.prepare(root)
            self.assertEqual(audit["chart_rows"], 2)
            self.assertEqual(audit["extracted_bodies"], 1)
            self.assertEqual(len(audit["empty_unadvertised_slots"]), 1)

    def test_tampering_and_redirecting_a_raw_locator_outside_raw_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture(root)
            manifest = json.loads((root / "capture.json").read_bytes())
            manifest["files"][0]["file"] = "quarantine/old.json"
            acquire.write_json(root / "capture.json", manifest)
            with self.assertRaisesRegex(ValueError, "raw source path"):
                prepare.prepare(root)

    def test_preparation_is_byte_deterministic_and_preserves_raw_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture(root)
            original = {p: p.read_bytes() for p in (root / "raw").rglob("*") if p.is_file()}
            prepare.prepare(root)
            names = (
                "manifest.json",
                "charts.jsonl",
                "preparation-audit.json",
                "container-metadata.json",
            )
            first = {name: (root / name).read_bytes() for name in names}
            prepare.prepare(root)
            for name in names:
                self.assertEqual(first[name], (root / name).read_bytes())
            for path, data in original.items():
                self.assertEqual(path.read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
