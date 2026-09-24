"""Finite recovery routes preserve presentation without trusting display identity."""

import hashlib
import json
import unittest
from dataclasses import replace
from urllib.parse import parse_qs, unquote, urlsplit

from maimai_intelligence.browser_bundle import BrowserResourceReference, BrowserResources
from maimai_intelligence.recovery_policy import decide_chart_recovery
from maimai_intelligence.route_recovery import NOTICES, POLICY, prepare_route_recovery
from maimai_intelligence.seo import LOCALES, empty_permalinks, prepare_seo
from maimai_intelligence.serialization import canonical
from tests.test_seo import catalog


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def style_inputs():
    assets = {}

    def reference(raw, extension):
        sha = digest(raw)
        path = f"browser-resources/{sha}.{extension}"
        assets[path] = raw
        return BrowserResourceReference(path, sha, len(raw))

    script = b"export const fixture = true;"
    return BrowserResources(
        BrowserResourceReference("browser/fixture.js", digest(script), len(script)),
        reference(b"{}", "json"),
        reference(b"<main>Fixture</main>", "html"),
        reference(b'{"catalog":true}', "json"),
        reference(b"body{color:black}", "css"),
        reference(b'{"songs":{}}', "json"),
        reference(b".seo-document{display:block}", "css"),
    ), assets


class RecoveryPolicyTests(unittest.TestCase):
    def test_exact_identity_and_version_are_the_only_link_authority(self):
        decisions = decide_chart_recovery(
            ("canonical:日本語/STD:MASTER", "missing"),
            frozenset({"canonical:日本語/STD:MASTER", "same-title-different-id"}),
            "retained version + 日本語",
        )
        self.assertEqual(decisions[0].reason, "exact-baseline-chart")
        self.assertEqual(
            parse_qs(urlsplit(decisions[0].target).query),
            {
                "view": ["catalog"],
                "chart": ["canonical:日本語/STD:MASTER"],
                "version": ["retained version + 日本語"],
            },
        )
        self.assertIsNone(decisions[1].target)
        self.assertEqual(decisions[1].reason, "chart-absent-from-baseline")
        self.assertEqual(decide_chart_recovery((), frozenset(), "retained"), ())

    def test_invalid_or_mutable_identity_inputs_fail(self):
        for ids, baseline, version in (
            (["a"], frozenset(), "v"),
            ((), set(), "v"),
            (("a", "a"), frozenset(), "v"),
            (("",), frozenset(), "v"),
            ((1,), frozenset(), "v"),
            (("a\x7f",), frozenset(), "v"),
            (("a",), frozenset({"a\n"}), "v"),
            (("x" * 1025,), frozenset(), "v"),
            ((), frozenset(), ""),
            ((), frozenset(), None),
        ):
            with (
                self.subTest(ids=ids, baseline=baseline, version=version),
                self.assertRaises(ValueError),
            ):
                decide_chart_recovery(ids, baseline, version)


class RouteRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.catalog = catalog()
        self.prepared = prepare_seo(self.catalog)
        self.resources, self.styles = style_inputs()
        self.baseline = canonical(
            {
                "package": {"status": "research_preview"},
                "catalog": [{"chart_id": row["chart_id"]} for row in self.catalog["catalog"]],
            }
        )
        self.reference = {
            "version": "retained + 日本語",
            "sha256": digest(self.baseline),
            "path": f"catalogs/{digest(self.baseline)}.json",
        }

    def prepare(self, prepared=None, **kwargs):
        defaults = {
            "baseline_reference": self.reference,
            "baseline_catalog": self.baseline,
            "resources": self.resources,
            "resource_assets": self.styles,
            "candidate_inventory_sha256": "a" * 64,
            "baseline_inventory_sha256": "c" * 64,
        }
        return prepare_route_recovery(prepared or self.prepared, **{**defaults, **kwargs})

    def mutate_document(self, old, new):
        prepared = self.prepared
        record = prepared.emitted_routes[0]
        assets = dict(prepared.assets)
        assets[record.filename] = assets[record.filename].replace(old, new)
        records = (
            replace(record, html_sha256=digest(assets[record.filename])),
            *prepared.emitted_routes[1:],
        )
        return replace(prepared, assets=assets, emitted_routes=records)

    def test_emitted_routes_are_exact_and_do_not_include_historical_ledger_entries(self):
        ledger = empty_permalinks()
        ledger["songs"]["absent"] = "historical-song"
        prepared = prepare_seo(self.catalog, previous=ledger)
        self.assertEqual(len(prepared.emitted_routes), 28)
        self.assertEqual({record.locale for record in prepared.emitted_routes}, set(LOCALES))
        for record in prepared.emitted_routes:
            self.assertEqual(record.filename, unquote(record.path[1:]) + "index.html")
            self.assertEqual(record.html_sha256, digest(prepared.assets[record.filename]))
            self.assertNotIn("historical-song", record.path)
            self.assertEqual(len(record.chart_ids), 4 if record.kind == "song" else 0)
        self.assertEqual(
            set(self.prepare(prepared).assets), {r.filename for r in prepared.emitted_routes}
        )

    def test_all_locales_are_finite_static_and_keep_public_presentation(self):
        result = self.prepare()
        self.assertEqual(result, self.prepare())
        self.assertEqual(result.evidence_sha256, digest(result.evidence))
        with self.assertRaises(TypeError):
            result.assets["unexpected"] = b""
        for document in result.documents:
            text = document.content.decode()
            locale = document.path.split("/")[1]
            self.assertIn(NOTICES[locale], text)
            self.assertIn(
                '<meta name="maimai-route-recovery" content="static-v1" data-path="'
                + document.path
                + '">',
                text,
            )
            self.assertIn('name="robots" content="noindex"', text)
            self.assertIn(POLICY.replace("'", "&#x27;"), text)
            self.assertIn('class="seo-document"', text)
            self.assertIn('rel="canonical"', text)
            self.assertEqual(text.count('rel="alternate"'), 5)
            self.assertEqual(text.count('integrity="sha256-'), 2)
            for forbidden in (
                "<script",
                "<input",
                "<label",
                "data-song-binding",
                'browser-resources"',
                "data-open-browser",
                "data-seo-intl",
                "data-seo-jp",
                "lang=",
                "release=",
            ):
                # The HTML lang attribute remains for localization; query lang= does not.
                if forbidden == "lang=":
                    self.assertNotIn("&amp;lang=", text)
                else:
                    self.assertNotIn(forbidden, text)
            if "/songs/" in document.path:
                self.assertEqual(text.count('<tr id="chart-'), 4)
                self.assertIn('data-seo-page="song"', text)
                self.assertIn("version=retained+%2B+%E6%97%A5%E6%9C%AC%E8%AA%9E", text)
            else:
                self.assertIn('data-seo-page="version"', text)
                self.assertEqual(text.count("<li>"), 5)
                self.assertNotIn(" hidden", text)
                self.assertNotIn("?view=catalog", text)
        self.assertTrue(
            any("%E6%97%A5" in d.path and "日本" in d.filename for d in result.documents)
        )

    def test_missing_baseline_charts_remain_public_without_invented_mappings(self):
        absent = self.catalog["catalog"][0]["chart_id"]
        data = json.loads(self.baseline)
        data["catalog"] = [row for row in data["catalog"] if row["chart_id"] != absent]
        raw = canonical(data)
        reference = {
            **self.reference,
            "sha256": digest(raw),
            "path": f"catalogs/{digest(raw)}.json",
        }
        result = self.prepare(baseline_catalog=raw, baseline_reference=reference)
        evidence = json.loads(result.evidence)
        decisions = [d for row in evidence["documents"] for d in row["decisions"]]
        missing = [d for d in decisions if d["chart_id"] == absent]
        self.assertEqual(len(missing), 4)
        self.assertTrue(
            all(
                d["target"] is None and d["reason"] == "chart-absent-from-baseline" for d in missing
            )
        )
        self.assertTrue(
            any(
                b'data-recovery-reason="chart-absent-from-baseline"' in d.content
                for d in result.documents
            )
        )

    def test_candidate_baseline_and_styles_bind_evidence_identity(self):
        original = self.prepare()
        changed = self.prepare(candidate_inventory_sha256="b" * 64)
        self.assertNotEqual(original.evidence_sha256, changed.evidence_sha256)
        self.assertEqual(original.documents, changed.documents)
        changed_baseline = self.prepare(baseline_inventory_sha256="d" * 64)
        self.assertNotEqual(original.evidence_sha256, changed_baseline.evidence_sha256)
        self.assertEqual(original.documents, changed_baseline.documents)
        self.assertEqual(changed_baseline.baseline_inventory_sha256, "d" * 64)
        evidence = json.loads(original.evidence)
        self.assertEqual(evidence["baseline_catalog"], self.reference)
        self.assertEqual(evidence["candidate_inventory_sha256"], "a" * 64)
        self.assertEqual(evidence["baseline_inventory_sha256"], "c" * 64)
        self.assertEqual(len(evidence["styles"]), 2)
        for document, row in zip(original.documents, evidence["documents"], strict=True):
            self.assertEqual(row["original_sha256"], document.original_sha256)
            self.assertEqual(row["sha256"], digest(document.content))
            self.assertEqual(row["bytes"], len(document.content))

    def test_stale_route_source_or_route_set_is_rejected(self):
        record = self.prepared.emitted_routes[0]
        for prepared in (
            replace(self.prepared, assets={**self.prepared.assets, record.filename: b"tampered"}),
            replace(
                self.prepared,
                assets={k: v for k, v in self.prepared.assets.items() if k != record.filename},
            ),
            replace(self.prepared, emitted_routes=self.prepared.emitted_routes[1:]),
            replace(self.prepared, emitted_routes=(record, *self.prepared.emitted_routes)),
            replace(
                self.prepared,
                assets={**self.prepared.assets, "en/songs/unrecorded/index.html": b"extra"},
            ),
            replace(
                self.prepared,
                emitted_routes=(
                    replace(record, path="/jp/songs/wrong/"),
                    *self.prepared.emitted_routes[1:],
                ),
            ),
        ):
            with (
                self.subTest(prepared=prepared.emitted_routes[0].path),
                self.assertRaises(ValueError),
            ):
                self.prepare(prepared)

    def test_invalid_baseline_reference_bytes_and_duplicate_ids_fail(self):
        for overrides in (
            {"baseline_catalog": self.baseline + b" "},
            {"baseline_reference": {**self.reference, "path": "catalogs/wrong.json"}},
            {"baseline_integration": b"{}"},
            {"candidate_inventory_sha256": "not-a-digest"},
            {"candidate_inventory_sha256": None},
            {"baseline_inventory_sha256": "not-a-digest"},
            {"baseline_inventory_sha256": None},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.prepare(**overrides)
        for rows in ([{"chart_id": "same"}, {"chart_id": "same"}], [{"chart_id": 1}], {}):
            raw = canonical({"package": {"status": "research_preview"}, "catalog": rows})
            with self.assertRaises(ValueError):
                self.prepare(
                    baseline_catalog=raw,
                    baseline_reference={
                        **self.reference,
                        "sha256": digest(raw),
                        "path": f"catalogs/{digest(raw)}.json",
                    },
                )

    def test_missing_tampered_or_mutable_css_is_rejected(self):
        for resources, styles in (
            (self.resources, {}),
            (self.resources, {**self.styles, self.resources.styles.path: b"tampered"}),
            (replace(self.resources, seoStyle=None), self.styles),
            (
                replace(
                    self.resources,
                    styles=replace(self.resources.styles, path="challenge-review.css"),
                ),
                self.styles,
            ),
        ):
            with self.subTest(resources=resources), self.assertRaises(ValueError):
                self.prepare(resources=resources, resource_assets=styles)

    def test_scripts_are_removed_even_when_not_the_application_entry(self):
        changed = self.mutate_document(
            b"</head>",
            b'<script type="application/json">{"public":true}</script>'
            b"<script>window.bad=true</script></head>",
        )
        self.assertTrue(all(b"<script" not in d.content for d in self.prepare(changed).documents))

    def test_new_interactions_or_changed_chart_links_need_explicit_review(self):
        for old, new in (
            (b"</main>", b"<button>Unexpected</button></main>"),
            (b'<main id="seo-content"', b'<main onclick="alert(1)" id="seo-content"'),
            (b'<input type="checkbox" data-seo-international>', b'<input type="text">'),
            (b"chart=song%3Afive%3ASTD%3ABASIC", b"chart=unreviewed"),
            (
                b'<tr id="chart-song%3Afive%3ASTD%3AMASTER">',
                b'<tr id="chart-song%3Afive%3ASTD%3ABASIC">',
            ),
            (b"/seo-pages.css", b"https://unreviewed.example/style.css"),
            (b"</head>", b'<meta http-equiv="refresh" content="0;url=/"></head>'),
        ):
            changed = self.mutate_document(old, new)
            self.assertTrue(changed.assets != self.prepared.assets, new)
            with self.subTest(new=new), self.assertRaises(ValueError):
                self.prepare(changed)

    def test_reader_limit_and_duplicate_chart_records_are_enforced(self):
        record = self.prepared.emitted_routes[0]
        with self.assertRaises(ValueError):
            self.prepare(
                replace(
                    self.prepared,
                    assets={**self.prepared.assets, record.filename: b"x" * (2 * 1024 * 1024 + 1)},
                )
            )
        with self.assertRaises(ValueError):
            self.prepare(
                replace(
                    self.prepared,
                    emitted_routes=(
                        replace(record, chart_ids=(*record.chart_ids, record.chart_ids[0])),
                        *self.prepared.emitted_routes[1:],
                    ),
                )
            )


if __name__ == "__main__":
    unittest.main()
