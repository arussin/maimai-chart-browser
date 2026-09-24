"""Final resource bytes remain bound to each document through deployment changes."""

import hashlib
import json
import re
import unittest
from copy import deepcopy

from maimai_intelligence.browser_bundle import seal_browser_resources, validate_browser_resources
from maimai_intelligence.serialization import canonical


def source_assets():
    script = b"export const fictional = true;"
    paths = ("browser/browser-entry-FIXTURE.js", "browser/browser-offline-FIXTURE.js")
    entries = {
        name: {"sha256": hashlib.sha256(script).hexdigest(), "bytes": len(script)} for name in paths
    }
    graph = {
        "version": 1,
        "tool": "fixture",
        "entries": dict(zip(("hosted", "offline"), paths, strict=True)),
        "assets": entries,
        "replaces": [],
    }
    header = b'<html><head><link rel="stylesheet" href="challenge-review.css?v=old"></head><body>'
    return {
        **{name: script for name in paths},
        "browser-assets.json": canonical(graph),
        "browser-config.json": b'{"features":{"maishift":true}}',
        "browser-shell.html": header
        + b"<template data-browser-shell><main>Fixture</main></template></body></html>",
        "challenge-review.css": b".fixture{display:block}",
        "seo-pages.css": b".song{display:grid}",
        "localization.js": b"window.fictionalLocalization=true;",
        "support-config.js": b"window.fictionalSupport=false;",
        "support-client.js": b"window.fictionalClient=true;",
        "support-stripe.js": b"window.fictionalStripe=true;",
        "support.html": (
            b'<html><script defer src="localization.js"></script>'
            b'<script defer src="support-config.js"></script>'
            b'<script defer src="support-client.js"></script>'
            b'<script defer src="support-stripe.js"></script></html>'
        ),
        "index.html": header + b'<main>Fixture</main><script type="module" data-maimai-browser '
        b'src="browser/browser-entry-FIXTURE.js"></script></body></html>',
        "en/songs/fixture/index.html": (
            b'<html><head><link rel="stylesheet" href="/seo-pages.css">'
            b'<link rel="stylesheet" href="/challenge-review.css">'
            b'<script type="module" data-maimai-browser src="/browser/browser-entry.js">'
            b'</script></head><body><main data-seo-page="song">Fixture</main></body></html>'
        ),
        "permalinks.json": b'{"songs":{"fixture":"fixture"}}',
    }


class BrowserResourceTests(unittest.TestCase):
    def setUp(self):
        self.assets = source_assets()
        self.manifest = {"schema_version": "1.3.0", "default": "fictional", "releases": []}

    def test_sealing_is_deterministic_and_preserves_logical_compatibility_inputs(self):
        original = deepcopy(self.assets)
        sealed = seal_browser_resources(self.assets, self.manifest)
        self.assertEqual(self.assets, original)
        self.assertEqual(sealed, seal_browser_resources(original, self.manifest))
        resources = validate_browser_resources(json.loads(sealed["browser-resources.json"]))
        for name in (
            "browser-config.json",
            "challenge-review.css",
            "localization.js",
            "support-config.js",
            "support-client.js",
            "support-stripe.js",
        ):
            self.assertEqual(sealed[name], original[name])
        for name, reference in resources.record().items():
            if name != "version" and reference is not None:
                raw = sealed[reference["path"]]
                self.assertEqual(hashlib.sha256(raw).hexdigest(), reference["sha256"])
                self.assertEqual(len(raw), reference["bytes"])
        self.assertEqual(json.loads(sealed[resources.catalog.path]), self.manifest)
        self.assertEqual(sealed, seal_browser_resources(sealed, self.manifest))

    def test_final_metadata_manifest_and_routes_bind_after_all_transformations(self):
        first = seal_browser_resources(self.assets, self.manifest)
        original = validate_browser_resources(json.loads(first["browser-resources.json"]))
        first["browser-shell.html"] = first["browser-shell.html"].replace(
            b"<head>", b'<head><meta name="description" content="Final public metadata">'
        )
        first["permalinks.json"] = b'{"songs":{"fixture":"final-route"}}'
        final_manifest = {**self.manifest, "default": "final"}
        second = seal_browser_resources(first, final_manifest)
        current = validate_browser_resources(json.loads(second["browser-resources.json"]))
        self.assertNotEqual(current.shell, original.shell)
        self.assertNotEqual(current.catalog, original.catalog)
        self.assertNotEqual(current.permalinks, original.permalinks)
        for name in ("index.html", "en/songs/fixture/index.html"):
            html = second[name].decode()
            payload = re.search(
                r'<script type="application/json" id="browser-resources">([^<]+)</script>', html
            )[1]
            self.assertEqual(json.loads(payload), current.record())
            self.assertEqual(html.count("data-maimai-browser"), 1)
        self.assertNotIn(b'id="browser-resources"', second[current.shell.path])
        self.assertNotIn(b"data-maimai-browser", second[current.shell.path])

    def test_support_scripts_and_page_styles_use_immutable_paths_with_unchanged_bytes(self):
        sealed = seal_browser_resources(self.assets, self.manifest)
        for name in (
            "index.html",
            "browser-shell.html",
            "support.html",
            "en/songs/fixture/index.html",
        ):
            html = sealed[name].decode()
            for target in re.findall(r'(?:src|href)="(/?browser-resources/[^"?]+)"', html):
                path = target.removeprefix("/")
                raw = sealed[path]
                self.assertEqual(
                    path.split("/", 1)[1].split(".", 1)[0], hashlib.sha256(raw).hexdigest()
                )
            self.assertNotRegex(
                html, r'(?:src|href)="/?(?:localization|support-(?:config|client|stripe))\.js'
            )
            self.assertNotRegex(html, r'href="/?(?:seo-pages|challenge-review)\.css')

    def test_invalid_descriptors_and_immutable_conflicts_fail_closed(self):
        sealed = seal_browser_resources(self.assets, self.manifest)
        good = json.loads(sealed["browser-resources.json"])
        for changed in (
            {**good, "version": True},
            {**good, "private": "unexpected"},
            {**good, "shell": None},
        ):
            with self.assertRaises(ValueError):
                validate_browser_resources(changed)
        for changes in (
            {"path": "../private.json"},
            {"sha256": "x"},
            {"bytes": True},
            {"bytes": 0},
            {"bytes": 5 * 1024 * 1024},
        ):
            changed = {**good, "configuration": {**good["configuration"], **changes}}
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_browser_resources(changed)
        bad = {**sealed, good["configuration"]["path"]: b"tampered"}
        with self.assertRaisesRegex(ValueError, "Immutable browser resource"):
            seal_browser_resources(bad, self.manifest)

    def test_shell_activation_and_duplicate_descriptors_are_rejected(self):
        bad = {**self.assets, "browser-shell.html": self.assets["index.html"]}
        with self.assertRaisesRegex(ValueError, "must not activate"):
            seal_browser_resources(bad, self.manifest)
        bad = {**self.assets, "index.html": self.assets["index.html"] * 2}
        with self.assertRaisesRegex(ValueError, "one maintained browser entry"):
            seal_browser_resources(bad, self.manifest)

    def test_legacy_builds_without_module_graph_remain_unchanged(self):
        legacy = {"index.html": b"legacy browser", "manifest.json": b"{}"}
        self.assertEqual(seal_browser_resources(legacy, {}), legacy)


if __name__ == "__main__":
    unittest.main()
