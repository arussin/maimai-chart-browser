"""Exact claim compatibility and immutable normalized-input boundaries."""

import ast
import hashlib
import inspect
import unittest
from copy import deepcopy
from dataclasses import FrozenInstanceError, replace
from unittest.mock import patch

from maimai_intelligence import metadata_claims
from maimai_intelligence.coverage_types import SnapshotError
from maimai_intelligence.metadata_adapters import MetadataAdapter, normalize_rows, normalize_source
from maimai_intelligence.metadata_claims import (
    CanonicalChartIdentity,
    MetadataSourceEvidence,
    NormalizedMetadataRow,
    NormalizedMetadataSource,
    decide_metadata_claims,
)
from maimai_intelligence.metadata_policy import MetadataSourcePolicy
from maimai_intelligence.metadata_waterfall import propose
from maimai_intelligence.registry import digest, empty
from tests.registry_fixture import admit, official_row
from tests.test_metadata_waterfall import capture

IDENTITY = ("fictionaltitle", "fictionalartist", "DX", "MASTER")
CHART = CanonicalChartIdentity("chart:authored-fixture", IDENTITY)
POLICY = MetadataSourcePolicy("Fictional evidence", 50)
EVIDENCE = MetadataSourceEvidence(
    provider="fictional",
    label=POLICY.label,
    sha256="a" * 64,
    bytes=20,
    url="https://example.invalid/fixture",
    captured_at="2026-09-24T00:00:00Z",
    parser="fictional-v1",
    revision=None,
    acquisition="public_metadata_capture",
)
ROW = NormalizedMetadataRow(IDENTITY, 123, 13.5, "JP", "Fictional release")
SOURCE = NormalizedMetadataSource(EVIDENCE, POLICY, (ROW,))


def external_row(**changes):
    return {
        "title": "Fictional title",
        "artist": "Fictional artist",
        "format": "DX",
        "difficulty": "MASTER",
        "bpm": 123,
        "chart_constant": 13.5,
        "region": "JP",
        **changes,
    }


class MetadataClaimTests(unittest.TestCase):
    def test_exact_public_claim_records_and_ids_preserved(self):
        decision = decide_metadata_claims((CHART,), (SOURCE,))
        self.assertEqual(decision.ambiguous, ())
        for claim, field, value in zip(
            decision.claims, ("bpm", "chart_constant"), (123, 13.5), strict=True
        ):
            expected = {
                "subject_id": CHART.chart_id,
                "snapshot_id": "fictional:" + "a" * 64,
                "field": field,
                "value": value,
                "region": "JP" if field == "chart_constant" else None,
                "release": "Fictional release" if field == "chart_constant" else None,
                "observed_at": "2026-09-24T00:00:00Z",
                "priority": 50,
                "source_url": "https://example.invalid/fixture",
                "evidence": (
                    "Unique normalized title, artist, format and difficulty; explicit numeric field"
                ),
                "policy": "metadata-waterfall-1",
            }
            expected["observation_id"] = "metadata:" + digest(expected)
            self.assertEqual(claim.record(), expected)
        self.assertIs(type(decision.claims[0].record()["value"]), int)

    def test_unique_both_ways_and_missing_matches_do_not_guess(self):
        duplicate_chart = replace(CHART, chart_id="chart:other-variant")
        unrelated = replace(ROW, identity=("unrelated", *IDENTITY[1:]))
        cases = (
            ((CHART,), (ROW, ROW), ((CHART.chart_id,),)),
            ((CHART, duplicate_chart), (ROW,), ((CHART.chart_id, duplicate_chart.chart_id),)),
            ((CHART, duplicate_chart), (unrelated,), ()),
            ((CHART,), (unrelated,), ()),
            ((CHART,), (), ()),
            ((), (ROW,), ()),
        )
        for charts, rows, ambiguous in cases:
            with self.subTest(charts=charts, rows=rows):
                decision = decide_metadata_claims(charts, (replace(SOURCE, rows=rows),))
                self.assertEqual(decision.claims, ())
                self.assertEqual(tuple(item.chart_ids for item in decision.ambiguous), ambiguous)
                self.assertEqual(
                    [item.record() for item in decision.ambiguous],
                    [{"provider": "fictional", "chart_ids": list(ids)} for ids in ambiguous],
                )
        self.assertEqual(decide_metadata_claims((CHART,), ()).claims, ())

    def test_missing_metric_is_independent_and_capture_order_is_stable(self):
        first = replace(SOURCE, rows=(replace(ROW, bpm=None),))
        second = replace(
            SOURCE,
            evidence=replace(EVIDENCE, provider="other", sha256="b" * 64),
            rows=(replace(ROW, chart_constant=None),),
        )
        decision = decide_metadata_claims((CHART,), (first, second))
        self.assertEqual([item.field for item in decision.claims], ["chart_constant", "bpm"])
        self.assertEqual(
            [item.snapshot_id for item in decision.claims],
            [first.evidence.snapshot_id, second.evidence.snapshot_id],
        )
        neither = replace(SOURCE, rows=(replace(ROW, bpm=None, chart_constant=None),))
        self.assertEqual(decide_metadata_claims((CHART,), (neither,)).claims, ())

    def test_evidence_and_regional_scope_preserved_without_runtime_io(self):
        row = replace(
            ROW,
            source_url="https://example.invalid/exact-page",
            evidence="Reviewed exact table",
            source_url_present=True,
        )
        with (
            patch("socket.socket", side_effect=AssertionError("Network forbidden")),
            patch("builtins.open", side_effect=AssertionError("File access forbidden")),
            patch(
                "maimai_intelligence.catalog_identity.key",
                side_effect=AssertionError("Identity rules belong in normalization"),
            ),
        ):
            decision = decide_metadata_claims((CHART,), (replace(SOURCE, rows=(row,)),))
            records = [claim.record() for claim in decision.claims]
        self.assertEqual({item["source_url"] for item in records}, {row.source_url})
        self.assertEqual({item["evidence"] for item in records}, {row.evidence})
        self.assertIsNone(records[0]["region"])
        self.assertEqual(records[1]["region"], "JP")
        tree = ast.parse(inspect.getsource(metadata_claims))
        self.assertEqual(
            {
                node.module
                for node in ast.walk(tree)
                if isinstance(node, ast.ImportFrom) and node.level
            },
            {"metadata_policy", "serialization"},
        )

    def test_normalized_inputs_and_returned_decisions_are_immutable(self):
        rows = [external_row()]
        evidence = EVIDENCE.record()
        normalized = normalize_source(evidence, POLICY, rows)
        rows[0]["bpm"] = 999
        evidence["url"] = "https://example.invalid/changed"
        self.assertEqual(normalized.rows[0].bpm, 123)
        self.assertEqual(normalized.evidence, EVIDENCE)
        self.assertEqual(normalized.evidence.record(), EVIDENCE.record())
        with self.assertRaises(FrozenInstanceError):
            normalized.rows[0].bpm = 100
        decision = decide_metadata_claims((CHART,), (SOURCE,))
        with self.assertRaises(FrozenInstanceError):
            decision.claims = ()
        record = decision.claims[0].record()
        record["value"] = 999
        self.assertEqual(decision.claims[0].record()["value"], 123)

    def test_adapter_row_validation_and_nonfinite_metrics(self):
        for rows in ({}, (external_row(),), [None], [external_row()] * 20001):
            with self.subTest(rows_type=type(rows)), self.assertRaises(SnapshotError):
                normalize_rows(rows)
        for changes in (
            {"title": None},
            {"artist": "x" * 2001},
            {"format": []},
            {"difficulty": "UTAGE"},
            {"region": []},
            {"release": {}},
            {"source_url": 1},
            {"wiki_url": []},
            {"evidence": ["untrusted"]},
        ):
            with self.subTest(changes=changes), self.assertRaises(SnapshotError):
                normalize_rows([external_row(**changes)])
        self.assertEqual(normalize_rows([]), ())
        for value in (None, "", True, False, "NaN", "Infinity", 0, -1, 2001, [], {}):
            row = normalize_rows([external_row(bpm=value, chart_constant=value)])[0]
            self.assertIsNone(row.bpm)
            self.assertIsNone(row.chart_constant)
        row = normalize_rows([external_row(bpm="123", chart_constant="13.5")])[0]
        self.assertEqual((row.bpm, row.chart_constant), ("123", "13.5"))

    def test_omitted_and_explicit_source_urls_keep_historical_record_identity(self):
        for changes, expected in (
            ({}, EVIDENCE.url),
            ({"source_url": None}, None),
            ({"source_url": ""}, ""),
            ({"source_url": "https://example.invalid/exact"}, "https://example.invalid/exact"),
        ):
            row = normalize_rows([external_row(**changes)])[0]
            decision = decide_metadata_claims((CHART,), (replace(SOURCE, rows=(row,)),))
            self.assertEqual(
                {claim.record()["source_url"] for claim in decision.claims}, {expected}
            )

    def test_unknown_identity_and_mapping_claims_do_not_acquire_authority(self):
        row = normalize_rows(
            [
                external_row(
                    song_id="forged",
                    chart_id="forged",
                    mappings={"accepted": True},
                    regional_membership=["INTL"],
                    analysis={"demand": 1},
                )
            ]
        )[0]
        decision = decide_metadata_claims((CHART,), (replace(SOURCE, rows=(row,)),))
        self.assertEqual({claim.subject_id for claim in decision.claims}, {CHART.chart_id})
        self.assertEqual({claim.field for claim in decision.claims}, {"bpm", "chart_constant"})

    def test_wrapper_rejects_bad_adapter_rows_but_preserves_programming_errors(self):
        value, _ = admit(empty(), [official_row("Fictional title", "Fictional artist")])
        raw = b"fictional public fixture"
        metadata = {
            "url": EVIDENCE.url,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "captured_at": EVIDENCE.captured_at,
        }
        captures = [("fictional", raw, metadata)]
        policies = {"fictional": POLICY}
        before = deepcopy(value)
        for row in (external_row(title=None), "not a row"):
            adapter = MetadataAdapter("fictional", EVIDENCE.url, lambda *_args, row=row: [row])
            result = propose(value, captures, adapters={"fictional": adapter}, policies=policies)
            self.assertEqual((result["claims"], result["sources"]), ([], {}))
            self.assertEqual(len(result["failures"]), 1)
        self.assertEqual(value, before)
        for kind in (TypeError, KeyError, RuntimeError):

            def broken(*_args, kind=kind):
                raise kind("Programming failure")

            adapter = MetadataAdapter("fictional", EVIDENCE.url, broken)
            with self.assertRaises(kind):
                propose(value, captures, adapters={"fictional": adapter}, policies=policies)

    def test_builtin_proposal_serialization_and_bound_ids_are_unchanged(self):
        value, _ = admit(empty(), [official_row()])
        result = propose(value, [capture()])
        self.assertEqual(
            set(result),
            {"schema_version", "registry_sha256", "sources", "claims", "failures", "ambiguous"},
        )
        self.assertEqual(result["schema_version"], "metadata-waterfall-1")
        self.assertEqual(result["registry_sha256"], digest(value))
        self.assertEqual((result["failures"], result["ambiguous"]), ([], []))
        for claim in result["claims"]:
            content = {key: item for key, item in claim.items() if key != "observation_id"}
            self.assertEqual(claim["observation_id"], "metadata:" + digest(content))
            self.assertIs(type(claim["value"]), float)


if __name__ == "__main__":
    unittest.main()
