"""Authored offline corpus inputs: resume, failure accounting and bounded retrieval."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from maimai_intelligence.explorer import validate_exploration_pack
from scripts import analyze_simai_corpus as corpus

BODY = "(120){8}1,2,1,2,1,2,1,2,E"


def sha(value):
    return hashlib.sha256(value).hexdigest()


def save_manifest(root, rows):
    data = b"".join(corpus.canonical_bytes(row) for row in rows)
    (root / "charts.jsonl").write_bytes(data)
    manifest = root / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": "simai-corpus-manifest-1",
                "source_kind": corpus.SOURCE_KIND,
                "snapshot_id": "authored-offline-test",
                "charts_file": "charts.jsonl",
                "charts_sha256": sha(data),
            }
        ),
        encoding="utf-8",
    )
    return manifest


def fixture(root, bodies=None):
    root = Path(root)
    (root / "bodies").mkdir()
    (root / "pages").mkdir()
    raw = b"<html>Independently authored local source snapshot</html>"
    (root / "pages/source.html").write_bytes(raw)
    rows = []
    for index, body in enumerate(bodies or [BODY]):
        name = f"bodies/authored-{index}.simai"
        data = body.encode()
        (root / name).write_bytes(data)
        rows.append(
            {
                "input_id": f"authored-{index:04d}",
                "title": f"Authored chart {index}",
                "source_song_id": f"authored-song-{index}",
                "format": "STD",
                "difficulty": "EXPERT",
                "identity_resolved": True,
                "acquisition_status": "available",
                "body_file": name,
                "body_sha256": sha(data),
                "source_raw_file": "pages/source.html",
                "source_raw_sha256": sha(raw),
            }
        )
    return save_manifest(root, rows), rows


def read_lines(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


class SimaiCorpusTests(unittest.TestCase):
    def test_each_parser_helper_changes_the_cache_policy_when_its_bytes_change(self):
        baseline = corpus._policy()
        package = corpus.resources.files("maimai_analyzer")
        for changed_name in ("simai_notation.py", "simai_timing.py", "rational.py"):
            original = package.joinpath(changed_name).read_bytes()
            changed_bytes = original + b"\n# Authored cache invalidation probe\n"

            def joinpath(name, changed_name=changed_name, changed_bytes=changed_bytes):
                if name == changed_name:
                    return SimpleNamespace(read_bytes=lambda: changed_bytes)
                return package.joinpath(name)

            with (
                self.subTest(module=changed_name),
                patch.object(
                    corpus.resources, "files", return_value=SimpleNamespace(joinpath=joinpath)
                ),
            ):
                changed = corpus._policy()
            self.assertEqual(baseline["implementation_hashes"][changed_name], sha(original))
            self.assertEqual(changed["implementation_hashes"][changed_name], sha(changed_bytes))
            self.assertNotEqual(corpus.content_hash(changed), corpus.content_hash(baseline))
            self.assertEqual(
                [
                    name
                    for name in baseline["implementation_hashes"]
                    if baseline["implementation_hashes"][name]
                    != changed["implementation_hashes"][name]
                ],
                [changed_name],
            )

    def test_easy_identity_survives_analysis_and_research_catalog_without_remapping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root)
            rows[0]["difficulty"] = "EASY"
            save_manifest(root, rows)
            output = root / "results"
            result = corpus.process_corpus(manifest, output)
            self.assertEqual(result["analyzed"], 1)
            self.assertEqual(result["failure_categories"], {})
            self.assertEqual(result["difficulty_coverage"]["STD / EASY"]["analyzed"], 1)
            row = read_lines(output / "results.jsonl")[0]
            self.assertEqual(row["difficulty"], "EASY")
            catalog = output / result["catalog_shards"][0]["catalog_file"]
            chart = json.loads(catalog.read_text(encoding="utf-8"))["charts"][0]
            self.assertEqual(chart["difficulty"], "EASY")
            self.assertEqual(chart["chart_id"], row["chart_id"])

    def test_offline_end_to_end_keeps_every_failure_and_research_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root, [BODY, "(120){8}Z9,E", BODY, BODY])
            rows[2]["identity_resolved"] = False
            rows[2]["format"] = "unresolved"
            rows[3]["acquisition_status"] = "unavailable"
            rows[3]["reason"] = "Advertised slot has no body"
            save_manifest(root, rows)
            before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
            output = root / "results"
            with patch("socket.socket", side_effect=AssertionError("No network")):
                result = corpus.process_corpus(manifest, output, shard_size=2)
            self.assertEqual(result["rows"], 4)
            self.assertEqual(result["analyzed"], 1)
            self.assertEqual(
                result["failure_categories"],
                {
                    "acquisition_unavailable": 1,
                    "unsupported_identity": 1,
                    "unsupported_note_or_slide_syntax": 1,
                },
            )
            self.assertEqual(result["difficulty_coverage"]["unresolved / EXPERT"]["rows"], 1)
            self.assertEqual(len(read_lines(output / "results.jsonl")), 4)
            self.assertEqual(len(result["catalog_shards"]), 2)
            for shard in result["catalog_shards"]:
                pack = json.loads((output / shard["catalog_file"]).read_text())
                self.assertTrue(validate_exploration_pack(pack)["evaluation_only"])
            for path, data in before.items():
                self.assertEqual(path.read_bytes(), data)

    def test_warm_cache_skips_parser_and_analyzer_and_preserves_aggregate_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, _ = fixture(root, [BODY, "(120){8}Z9,E"])
            output = root / "results"
            corpus.process_corpus(manifest, output)
            names = [
                "summary.json",
                "results.jsonl",
                "descriptor-index.jsonl",
                "neighbor-audit.json",
            ]
            cold = {name: (output / name).read_bytes() for name in names}
            with (
                patch.object(
                    corpus, "parse_simai_subset", side_effect=AssertionError("Parser ran")
                ),
                patch.object(corpus, "analyze", side_effect=AssertionError("Analyzer ran")),
            ):
                corpus.process_corpus(manifest, output)
            for name, data in cold.items():
                self.assertEqual((output / name).read_bytes(), data)
            work = json.loads((output / "work-audit.json").read_text())["work"]
            self.assertEqual(work["cache_hits"], 2)
            self.assertEqual(work.get("parser_calls", 0), 0)
            self.assertEqual(work.get("analyzer_calls", 0), 0)

    def test_corrupt_cache_recomputes_one_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, _ = fixture(root, [BODY, BODY])
            output = root / "results"
            corpus.process_corpus(manifest, output)
            record = read_lines(output / "results.jsonl")[0]
            (output / record["cache_file"]).write_text("{}")
            with patch.object(corpus, "analyze", wraps=corpus.analyze) as analyzer:
                corpus.process_corpus(manifest, output)
            self.assertEqual(analyzer.call_count, 1)
            work = json.loads((output / "work-audit.json").read_text())["work"]
            self.assertEqual(work["invalid_cache_entries"], 1)
            self.assertEqual(work["cache_hits"], 1)

    def test_poisoned_negative_cache_is_rejected_before_aggregate_counting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, _ = fixture(root, ["(120){8}Z9,E"])
            output = root / "results"
            corpus.process_corpus(manifest, output)
            record = read_lines(output / "results.jsonl")[0]
            cache = output / record["cache_file"]
            value = json.loads(cache.read_text())
            value["outcome"]["category"] = {"poisoned": True}
            value["outcome_hash"] = corpus.content_hash(value["outcome"])
            cache.write_bytes(corpus.canonical_bytes(value))
            with patch.object(
                corpus, "parse_simai_subset", wraps=corpus.parse_simai_subset
            ) as parser:
                result = corpus.process_corpus(manifest, output)
            self.assertEqual(parser.call_count, 1)
            self.assertEqual(result["failure_categories"], {"unsupported_note_or_slide_syntax": 1})

    def test_interrupted_rerun_keeps_completed_index_and_shards_and_marks_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root, [BODY] * 3)
            output = root / "results"
            result = corpus.process_corpus(manifest, output, shard_size=1)
            before = {output / "index.html": (output / "index.html").read_bytes()}
            for shard in result["catalog_shards"]:
                path = output / shard["html_file"]
                before[path] = path.read_bytes()
            rows[0]["difficulty"] = "MASTER"
            save_manifest(root, rows)
            original = corpus._process

            def interrupt(row, *args):
                if row["input_id"] == rows[2]["input_id"]:
                    raise RuntimeError("Authored interrupted run")
                return original(row, *args)

            with patch.object(corpus, "_process", side_effect=interrupt):
                with self.assertRaisesRegex(RuntimeError, "interrupted"):
                    corpus.process_corpus(manifest, output, shard_size=1)
            for path, data in before.items():
                self.assertEqual(path.read_bytes(), data)
            self.assertEqual(
                json.loads((output / "run-state.json").read_text())["status"], "in_progress"
            )

    def test_source_hash_rechecked_before_warm_cache_then_restoration_reuses(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root)
            output = root / "results"
            corpus.process_corpus(manifest, output)
            path = root / rows[0]["body_file"]
            path.write_text(BODY + "garbage")
            result = corpus.process_corpus(manifest, output)
            self.assertEqual(result["failure_categories"], {"source_hash_mismatch": 1})
            path.write_text(BODY)
            with patch.object(corpus, "analyze", side_effect=AssertionError("Analyzer ran")):
                self.assertEqual(corpus.process_corpus(manifest, output)["analyzed"], 1)

    def test_changed_identity_reanalyzes_only_changed_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root, [BODY, BODY])
            output = root / "results"
            corpus.process_corpus(manifest, output)
            rows[0]["difficulty"] = "MASTER"
            save_manifest(root, rows)
            with patch.object(corpus, "analyze", wraps=corpus.analyze) as analyzer:
                corpus.process_corpus(manifest, output)
            self.assertEqual(analyzer.call_count, 1)

    def test_manifest_integrity_and_duplicate_ids_fail_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root, [BODY, BODY])
            output = root / "results"
            (root / "charts.jsonl").write_bytes(b"{}\n")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                corpus.process_corpus(manifest, output)
            self.assertFalse(output.exists())
            rows[1]["input_id"] = rows[0]["input_id"]
            save_manifest(root, rows)
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                corpus.process_corpus(manifest, output)
            self.assertFalse(output.exists())

    def test_confined_inputs_and_output_aliases_leave_sources_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root)
            body = root / rows[0]["body_file"]
            before = body.read_bytes()
            with self.assertRaisesRegex(ValueError, "contain any"):
                corpus.process_corpus(manifest, root / "bodies")
            self.assertEqual(body.read_bytes(), before)
            rows[0]["body_file"] = "../outside.simai"
            save_manifest(root, rows)
            result = corpus.process_corpus(manifest, root / "results")
            self.assertEqual(result["failure_categories"], {"invalid_source_path": 1})

    def test_corpus_above_study_limit_is_sharded_with_all_rows_accounted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [
                {
                    "input_id": f"slot-{i:04d}",
                    "title": "Advertised only",
                    "format": "STD",
                    "difficulty": "UTAGE",
                    "identity_resolved": False,
                    "acquisition_status": "unavailable",
                }
                for i in range(129)
            ]
            manifest = save_manifest(root, rows)
            result = corpus.process_corpus(manifest, root / "results", shard_size=64)
            self.assertEqual(result["rows"], 129)
            self.assertEqual([s["charts"] for s in result["catalog_shards"]], [64, 64, 1])
            self.assertEqual(result["analyzed"], 0)

    def test_sampled_queries_scan_all_other_candidates_without_all_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root, [BODY] * 4)
            rows[1]["difficulty"] = "MASTER"
            save_manifest(root, rows)
            output = root / "results"
            corpus.process_corpus(manifest, output, sample_queries=2, shard_size=1)
            audit = json.loads((output / "neighbor-audit.json").read_text())
            self.assertEqual(len(audit["queries"]), 2)
            self.assertEqual(set(audit["sampled_strata"]), {"STD / EXPERT", "STD / MASTER"})
            for query in audit["queries"]:
                self.assertEqual(query["candidates"], 3)
                self.assertEqual(query["qualifying_matches"], 3)
                self.assertTrue(all(m["same_body_hash"] for m in query["nearest_diagnostics"]))
                self.assertTrue(all(m["distance"] == 0 for m in query["nearest_diagnostics"]))

    def test_malformed_hashes_are_per_input_failures_with_bounded_output_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root, [BODY] * 3)
            rows[0]["body_sha256"] = "x" * 5000
            rows[1]["body_sha256"] = {"wrong": "type"}
            rows[2]["body_sha256"] = float("nan")
            # Malformed untrusted JSON is accepted only into failure accounting.
            data = "".join(json.dumps(row) + "\n" for row in rows).encode()
            (root / "charts.jsonl").write_bytes(data)
            wrapper = json.loads(manifest.read_text())
            wrapper["charts_sha256"] = sha(data)
            manifest.write_text(json.dumps(wrapper))
            output = root / "results"
            result = corpus.process_corpus(manifest, output)
            self.assertEqual(result["failure_categories"], {"missing_source_hash": 3})
            for row in read_lines(output / "results.jsonl"):
                self.assertIsNone(row["body_sha256"])
                self.assertEqual(row["revision"], "unavailable")

    def test_partial_capture_metadata_is_separate_and_prominent_without_affecting_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, _ = fixture(root)
            wrapper = json.loads(manifest.read_text())
            wrapper.update(
                distinct_linked_pages=5,
                captured_pages=2,
                extracted_bodies=1,
                capture_stopped_reason="Paused capture <authored>",
            )
            manifest.write_text(json.dumps(wrapper))
            output = root / "results"
            result = corpus.process_corpus(manifest, output)
            capture = result["source_capture"]
            self.assertTrue(capture["partial"])
            self.assertEqual(capture["snapshot_id"], "authored-offline-test")
            self.assertEqual(capture["capture_stopped_reason"], "Paused capture <authored>")
            self.assertEqual(result["failure_categories"], {})
            document = (output / "index.html").read_text(encoding="utf-8")
            self.assertIn("Partial source capture", document)
            self.assertIn("2 of 5 linked source pages", document)
            self.assertIn("Paused capture &lt;authored&gt;", document)
            self.assertLess(
                document.index("Partial source capture"), document.index("advertised manifest rows")
            )
            wrapper.update(captured_pages=5, capture_stopped_reason=None)
            manifest.write_text(json.dumps(wrapper))
            with patch.object(corpus, "analyze", side_effect=AssertionError("Analyzer ran")):
                complete = corpus.process_corpus(manifest, output)
            self.assertFalse(complete["source_capture"]["partial"])
            self.assertNotIn("Partial source capture", (output / "index.html").read_text())

    def test_capture_metadata_preserves_unknown_and_rejects_invalid_counts_before_writes(self):
        unknown = corpus._source_capture({}, 1)
        self.assertIsNone(unknown["captured_pages"])
        self.assertIsNone(unknown["partial"])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, _ = fixture(root)
            base = json.loads(manifest.read_text())
            bad_values = [
                {"captured_pages": True},
                {"captured_pages": -1},
                {"distinct_linked_pages": corpus.MAX_ROWS + 1},
                {"captured_pages": 2, "distinct_linked_pages": 1},
                {"extracted_bodies": 2},
                {"capture_stopped_reason": "x" * 513},
            ]
            for value in bad_values:
                with self.subTest(value=value):
                    manifest.write_text(json.dumps(base | value))
                    output = root / "results"
                    with self.assertRaisesRegex(ValueError, "Source capture"):
                        corpus.process_corpus(manifest, output)
                    self.assertFalse(output.exists())

    def test_identity_reason_describes_unsupported_identity_not_successful_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, rows = fixture(root)
            rows[0].update(format="unresolved", reason="extracted")
            save_manifest(root, rows)
            output = root / "results"
            corpus.process_corpus(manifest, output)
            row = read_lines(output / "results.jsonl")[0]
            self.assertEqual(row["category"], "unsupported_identity")
            self.assertIn("unresolved / EXPERT", row["reason"])
            self.assertNotEqual(row["reason"], "extracted")

    def test_malformed_note_and_literal_tail_remain_unsupported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, _ = fixture(root, ["(120){8}Z9,E", "(120){8}1,E\nAuthored prose"])
            output = root / "results"
            corpus.process_corpus(manifest, output)
            rows = read_lines(output / "results.jsonl")
            self.assertEqual(rows[0]["category"], "unsupported_note_or_slide_syntax")
            self.assertEqual(rows[1]["category"], "unsupported_note_or_slide_syntax")
            self.assertTrue(all(row["status"] == "unsupported" for row in rows))

    def test_warm_cached_resource_failure_labels_refresh_without_parser(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, _ = fixture(root, ["(120){#3601}1,E"])
            output = root / "results"
            corpus.process_corpus(manifest, output)
            row = read_lines(output / "results.jsonl")[0]
            self.assertEqual(row["category"], "normalized_resource_limit")
            cache = output / row["cache_file"]
            value = json.loads(cache.read_text())
            value["outcome"]["category"] = "unsupported_note_or_slide_syntax"
            value["outcome_hash"] = corpus.content_hash(value["outcome"])
            cache.write_bytes(corpus.canonical_bytes(value))
            with (
                patch.object(
                    corpus, "parse_simai_subset", side_effect=AssertionError("Parser ran")
                ),
                patch.object(corpus, "analyze", side_effect=AssertionError("Analyzer ran")),
            ):
                result = corpus.process_corpus(manifest, output)
                corpus.process_corpus(manifest, output)
            self.assertEqual(result["failure_categories"], {"normalized_resource_limit": 1})
            updated = json.loads(cache.read_text())
            self.assertEqual(updated["outcome"]["category"], "normalized_resource_limit")
            self.assertEqual(updated["outcome_hash"], corpus.content_hash(updated["outcome"]))
            self.assertEqual(result["failure_classification_version"], 2)


if __name__ == "__main__":
    unittest.main()
