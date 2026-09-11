"""Authored single-header containers; no public chart text or inferred timing."""

import hashlib
import unittest

from maimai_analyzer.simai_subset import PARSER_VERSION, SimaiSubsetError
from scripts.analyze_simai_corpus import _parse_evidence
from tests.test_simai_subset import parse


class SimaiContainerTests(unittest.TestCase):
    def test_each_documented_slot_requires_its_explicit_difficulty(self):
        difficulties = ("EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER")
        for slot, difficulty in enumerate(difficulties, 1):
            body = f"&inote_{slot}=(120){{4}}1,E"
            with self.subTest(slot=slot):
                raw, audit = parse(body, difficulty=difficulty)
                self.assertEqual(raw["difficulty"], difficulty)
                self.assertEqual(audit["container_header"]["slot"], slot)
                self.assertEqual(audit["container_header"]["difficulty"], difficulty)
                self.assertEqual(audit["container_header"]["source_text"], f"&inote_{slot}=")
                self.assertEqual(raw["onsets"][0]["time_us"], 0)
            for wrong in difficulties:
                if wrong != difficulty:
                    with self.subTest(slot=slot, wrong=wrong), self.assertRaises(SimaiSubsetError):
                        parse(body, difficulty=wrong)

    def test_container_preserves_events_and_the_full_original_hash(self):
        payload = "(120){8}1/2h[4:1],3-7[8:1]*^5[8:1],E"
        body = "&inote_5=" + payload
        expected, _ = parse(payload, difficulty="MASTER")
        actual, audit = parse(body, difficulty="MASTER")
        for key in ("onsets", "holds", "slides", "bpm_segments"):
            self.assertEqual(actual[key], expected[key])
        self.assertEqual(audit["body_sha256"], hashlib.sha256(body.encode()).hexdigest())
        self.assertNotEqual(audit["body_sha256"], hashlib.sha256(payload.encode()).hexdigest())
        self.assertEqual(actual["source"]["parser_version"], PARSER_VERSION)
        self.assertIn("single_inote_wrapper", audit["dialect_aliases"])
        self.assertIsNone(actual["track_duration_us"])
        self.assertIsNone(actual["audio_offset_us"])
        self.assertFalse(audit["path_geometry_validated"])

    def test_exact_source_ranges_include_leading_ideographic_whitespace(self):
        body = " \n\u3000&inote_5=\r\n(120){4}1,|| note comment\n2,E"
        _, audit = parse(body, difficulty="MASTER")
        header = audit["container_header"]
        self.assertEqual(header["source_start"], 3)
        self.assertEqual(header["source_end"], 12)
        self.assertEqual(header["source_text"], "&inote_5=")
        self.assertIn("ideographic_space", audit["dialect_aliases"])
        for item in (
            [header]
            + audit["commands"]
            + audit["tokens"]
            + audit["comments"]
            + [audit["end_marker"]]
        ):
            self.assertEqual(body[item["source_start"] : item["source_end"]], item["source_text"])
        self.assertEqual(audit["tokens"][0]["source_start"], body.index("1,"))
        self.assertEqual(audit["body_sha256"], hashlib.sha256(body.encode()).hexdigest())

    def test_error_positions_refer_to_original_container_text(self):
        body = "\u3000&inote_5=\n(120){4}1,9,E"
        with self.assertRaisesRegex(SimaiSubsetError, f"source character {body.index('9')}$"):
            parse(body, difficulty="MASTER")
        mismatch = " \n&inote_4=(120){4}1,E"
        with self.assertRaisesRegex(SimaiSubsetError, "source character 2$"):
            parse(mismatch, difficulty="MASTER")

    def test_header_text_inside_a_comment_is_only_a_comment(self):
        for body in (
            "|| &inote_5= is comment text\n(120){4}1,E",
            "&inote_5=(120){4}1,|| &inote_4= and &title= stay comments\nE",
        ):
            with self.subTest(body=body):
                raw, audit = parse(body, difficulty="MASTER")
                self.assertEqual(len(raw["onsets"]), 1)
                self.assertEqual(len(audit["comments"]), 1)
        _, unwrapped = parse("|| &inote_5=\n(120){4}1,E", difficulty="MASTER")
        self.assertNotIn("container_header", unwrapped)
        self.assertNotIn("single_inote_wrapper", unwrapped["dialect_aliases"])

    def test_extra_embedded_or_malformed_headers_never_discard_notation(self):
        for body in (
            "&title=Example\n&inote_5=(120){4}1,E",
            "&inote_5=(120){4}1,E\n&title=Example",
            "&inote_5=&inote_5=(120){4}1,E",
            "&inote_5=(120){4}1,E\n&inote_5=(120){4}2,E",
            "(120){4}1,\n&inote_5=(120){4}2,E",
            "&inote_5=(120){4}1&inote_5=2,E",
            "|| leading comment\n&inote_5=(120){4}1,E",
            "&inote_7=(120){4}1,E",
            "&inote_05=(120){4}1,E",
            "&inote_5 =(120){4}1,E",
            "&inote_ 5=(120){4}1,E",
            "&INOTE_5=(120){4}1,E",
        ):
            with self.subTest(body=body), self.assertRaises(SimaiSubsetError):
                parse(body, difficulty="MASTER")

    def test_no_timing_defaults_or_missing_body_are_supplied(self):
        for payload in ("", "1,E", "(120)1,E", "{4}1,E", "(120){4}1"):
            with self.subTest(payload=payload), self.assertRaises(SimaiSubsetError):
                parse("&inote_5=" + payload, difficulty="MASTER")

    def test_unhashable_or_unknown_difficulty_rejects_without_type_error(self):
        for difficulty in ([], {}, None, "master", "ORIGINAL"):
            with self.subTest(difficulty=difficulty), self.assertRaises(SimaiSubsetError):
                parse("&inote_5=(120){4}1,E", difficulty=difficulty)

    def test_compact_corpus_evidence_retains_wrapper_acceptance(self):
        _, audit = parse("&inote_5=(120){4}1,E", difficulty="MASTER")
        evidence = _parse_evidence(audit)
        self.assertEqual(evidence["body_aliases"]["single_inote_wrapper"], 1)
        self.assertEqual(evidence["framing"]["source_completeness"], "unknown")


if __name__ == "__main__":
    unittest.main()
