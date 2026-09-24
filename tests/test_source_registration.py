"""Explicit supplemental policies are bounded and do not leak between preparations."""

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.catalog_refresh import refresh
from maimai_intelligence.corpus_failures import CorpusInputError, diagnose_failure
from maimai_intelligence.corpus_requests import preparation_request
from maimai_intelligence.corpus_update import prepare_corpus
from maimai_intelligence.metadata_adapters import MetadataAdapter
from maimai_intelligence.metadata_policy import (
    BUILTIN_CONTEXT,
    SOURCE_POLICIES,
    MetadataSourcePolicy,
    PolicyContext,
)
from maimai_intelligence.registry import empty
from maimai_intelligence.source_registration import SourceRegistration, source_context


def normalize(raw, metadata):
    return []


def registration(provider="fixture-source", revision="fixture-v1", priority=50):
    return SourceRegistration(
        MetadataAdapter(
            provider, "https://dp4p6x0xfi5o9.cloudfront.net/maimai/data.json", normalize
        ),
        MetadataSourcePolicy("Fixture source", priority),
        revision,
    )


class SourceRegistrationTests(unittest.TestCase):
    def test_contexts_are_immutable_independent_and_ordered(self):
        one, two = registration(), registration("second-source", priority=60)
        context = source_context((two, one))
        self.assertEqual(context.manifest(), source_context((one, two)).manifest())
        self.assertNotIn(one.adapter.provider, BUILTIN_CONTEXT.policies)
        self.assertEqual(context.binding(one.adapter.provider), one.binding())
        self.assertIsNone(context.binding("unknown"))
        self.assertNotIn(two.adapter.provider, source_context((one,)).policies)
        with self.assertRaises(TypeError):
            SOURCE_POLICIES["fixture-source"] = one.policy
        with self.assertRaises(TypeError):
            context.policies["fixture-source"] = two.policy
        manifest = context.manifest()
        manifest[0]["allowed_claims"].append("mapping")
        self.assertEqual(context.manifest()[0]["allowed_claims"], ["bpm", "chart_constant"])

    def test_invalid_registration_rejected(self):
        one = registration()
        for entries in ((one, one), (registration("otoge-db"),), [one]):
            with self.assertRaises(ValueError):
                source_context(entries)
        for revision in ("", "x" * 129, "private revision with spaces"):
            with self.assertRaises(ValueError):
                registration(revision=revision)
        with self.assertRaises(ValueError):
            replace(one, adapter=replace(one.adapter, url="https://example.invalid/source"))

    def test_official_authority_names_cannot_be_registered(self):
        for provider in ("sega-jp", "sega-intl", "sega-notice"):
            with self.subTest(provider=provider), self.assertRaises(CorpusInputError):
                registration(provider=provider)

    def test_direct_policy_binding_is_validated(self):
        good = registration().binding()
        for changes in (
            {"provider": "sega-jp"},
            {"parser_revision": ""},
            {"url": "https://user@example.invalid/source"},
            {"allowed_claims": ("mapping",)},
            {"policy": None},
        ):
            with self.assertRaises(ValueError):
                replace(good, **changes)
        for priority in (True, -1, 1001, 5.5, "50"):
            with self.assertRaises(ValueError):
                MetadataSourcePolicy("Fixture", priority)
        with self.assertRaises(ValueError):
            PolicyContext((object(),))

    def test_policy_binding_rejects_changed_or_missing_context(self):
        one = registration()
        manifest = source_context((one,)).manifest()
        source_context((one,)).require_manifest(manifest)
        for context in (
            BUILTIN_CONTEXT,
            source_context((registration(priority=51),)),
            source_context((registration(revision="fixture-v2"),)),
        ):
            with self.assertRaisesRegex(ValueError, "context differs"):
                context.require_manifest(manifest)

    def test_duplicate_sources_rejected_before_preparation_io(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            request = preparation_request(
                root / "store", root / "browser", registry=root / "registry"
            )
            one = registration()
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                prepare_corpus(request, sources=(one, one))
            self.assertFalse((root / "store").exists())

    def test_refresh_executes_registrations_in_manifest_order(self):
        calls = []

        def record(provider):
            def normalized(raw, metadata):
                calls.append(provider)
                return []

            return normalized

        first, second = registration("alpha-source"), registration("zeta-source")
        first = replace(first, adapter=replace(first.adapter, normalize=record("alpha-source")))
        second = replace(second, adapter=replace(second.adapter, normalize=record("zeta-source")))
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch("socket.socket", side_effect=AssertionError("Network forbidden")),
        ):
            root = Path(temporary)
            sources = (second, first)
            refresh(
                empty(),
                {},
                root / "cache",
                root / "run",
                metadata_adapters=[],
                sources=sources,
                policy_context=source_context(sources),
                fetcher=lambda url, headers: (200, b"[]", {}),
            )
        self.assertEqual(calls, ["alpha-source", "zeta-source"])

    def test_policy_mismatch_is_an_expected_input_failure(self):
        with self.assertRaises(CorpusInputError) as caught:
            BUILTIN_CONTEXT.require_manifest(source_context((registration(),)).manifest())
        diagnosis = diagnose_failure(caught.exception)
        self.assertEqual((diagnosis.outcome, diagnosis.code), ("blocked", "input_or_integrity"))
