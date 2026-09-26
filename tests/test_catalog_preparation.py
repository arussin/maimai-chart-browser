"""Structured catalog preparation preserves published JSON independently of HTML."""

import hashlib
import json
import re
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.catalog_preparation import prepare_catalog
from maimai_intelligence.challenge_review import render_prepared_review, render_review
from maimai_intelligence.snapshots import canonical
from tests.lab_fixture import write_package


def fixture_arguments(root, *, grouped=False, constants=False):
    source = write_package(root, grouped=grouped, constants=constants)
    names = (
        "package.json",
        "catalog.json",
        "review.json",
        "snippets.json",
        "benchmark.json",
        "navigation.json",
        "analysis.json",
    )
    return [json.loads((source / name).read_bytes()) for name in names]


class CatalogPreparationTests(unittest.TestCase):
    def test_original_publication_and_pattern_bytes_are_unchanged(self):
        expected = json.loads(Path("tests/fixtures/catalog-preparation-baseline.json").read_text())
        for key, hashes in expected.items():
            grouped, constants = (value == "1" for value in key.split(":"))
            with self.subTest(case=key), tempfile.TemporaryDirectory() as folder:
                args = fixture_arguments(folder, grouped=grouped, constants=constants)
                prepared = prepare_catalog(*args)
                self.assertEqual(
                    hashlib.sha256(canonical(prepared.data)).hexdigest(), hashes["data"]
                )
                self.assertEqual(
                    hashlib.sha256(canonical(prepared.patterns)).hexdigest(), hashes["patterns"]
                )

    def test_prepared_data_is_detached_from_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            args = fixture_arguments(folder)
            original = deepcopy(args)
            prepared = prepare_catalog(*args)
            self.assertEqual(args, original)
            args[1][0]["title"] = "changed caller data"
            self.assertNotEqual(prepared.data["catalog"][0]["title"], args[1][0]["title"])

    def test_renderer_and_legacy_facade_use_identical_prepared_model(self):
        with tempfile.TemporaryDirectory() as folder:
            args = fixture_arguments(folder)
            prepared = prepare_catalog(*args)
            expected = render_review(*args)
            with patch(
                "maimai_intelligence.challenge_review.prepare_catalog",
                side_effect=AssertionError("Rendering must not prepare the model again"),
            ):
                actual = render_prepared_review(prepared)
            self.assertEqual(actual, expected)
            embedded = re.search(
                r'<script id="challenge-data" type="application/json">(.*?)</script>', actual, re.S
            )
            self.assertEqual(json.loads(embedded[1]), prepared.data)

    def test_script_like_catalog_text_remains_escaped(self):
        prepared = prepare_catalog(
            {"source": {}},
            [{"title": "</script><img src=x>"}],
            [],
            {},
            {"benchmark_hash": "a" * 64},
        )
        self.assertNotIn("</script><img", render_prepared_review(prepared))
