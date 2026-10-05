import hashlib
import json
import tempfile
import unittest
from html.parser import HTMLParser
from importlib.resources import files
from pathlib import Path

from maimai_intelligence.lab import build_lab
from maimai_intelligence.public_release import (
    _preserve_web_analytics,
    build_public_release,
    plan_public_release,
)
from tests.lab_fixture import write_package

CF_ORIGIN = "https://static.cloudflareinsights.com"
GA_SCRIPT = "https://www.googletagmanager.com/gtag/js"


class PagePolicy(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.policies = []
        self.scripts = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("http-equiv", "").lower() == "content-security-policy":
            policy = {}
            for directive in attrs["content"].split(";"):
                parts = directive.split()
                if parts:
                    policy[parts[0]] = parts[1:]
            self.policies.append(policy)
        if tag == "script" and attrs.get("src"):
            self.scripts.append(attrs["src"])


class CloudflareAnalyticsTests(unittest.TestCase):
    def assert_replacement_policy(self, html, *, report_sources=False):
        page = PagePolicy(html)
        self.assertEqual(len(page.policies), 1)
        policy = page.policies[0]
        self.assertEqual(
            policy["script-src"],
            [
                "'self'",
                GA_SCRIPT,
                "https://js.stripe.com",
                "https://*.js.stripe.com",
                "https://checkout.stripe.com",
            ],
        )
        self.assertEqual(
            policy["connect-src"],
            [
                "'self'",
                *(["https:"] if report_sources else []),
                "https://www.google-analytics.com",
                "https://region1.google-analytics.com",
                "https://api.stripe.com",
                "https://checkout.stripe.com",
                "https://link.com",
                "https://*.link.com",
            ],
        )
        self.assertNotIn(CF_ORIGIN, policy["script-src"])
        self.assertEqual(policy["default-src"], ["'none'"])
        self.assertEqual(policy["object-src"], ["'none'"])
        self.assertEqual(policy["base-uri"], ["'none'"])
        # Permissions alone must not add a tracker to a local/preview build.
        self.assertFalse(any("cloudflareinsights.com" in src for src in page.scripts))
        self.assertFalse(any("googletagmanager.com" in src for src in page.scripts))
        self.assertFalse(any("stripe.com" in src for src in page.scripts))
        self.assertIn('name="referrer" content="no-referrer"', html)

    def test_default_template_blocks_beacon_without_changing_ga_or_checkout(self):
        html = files("maimai_intelligence.assets").joinpath("index.html").read_text("utf-8")
        self.assert_replacement_policy(html)

    def test_generated_lab_and_public_release_preserve_ga_and_redirect_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "package")
            preview = root / "preview"
            build_lab(source, preview, catalog_version="fixture-v1")
            self.assert_replacement_policy(
                (preview / "index.html").read_text("utf-8"), report_sources=True
            )
            published = root / "public"
            build_public_release(preview, published)
            self.assert_replacement_policy(
                (published / "index.html").read_text("utf-8"), report_sources=True
            )
            # The hosted application uses the verified module closure, with no
            # standalone analytics script inserted by either builder.
            graph = json.loads((preview / "browser-assets.json").read_text("utf-8"))
            entry = graph["entries"]["hosted"]
            for path, reference in graph["assets"].items():
                original = (preview / path).read_bytes()
                self.assertEqual(hashlib.sha256(original).hexdigest(), reference["sha256"])
                self.assertEqual(len(original), reference["bytes"])
                self.assertEqual((published / path).read_bytes(), original)
            for directory in (preview, published):
                scripts = PagePolicy((directory / "index.html").read_text("utf-8")).scripts
                self.assertTrue(any(src.split("?")[0].lstrip("/") == entry for src in scripts))
                self.assertFalse(any(src.split("?")[0].endswith("analytics.js") for src in scripts))
            redirect = PagePolicy((published / "lab/index.html").read_text("utf-8"))
            self.assertEqual(redirect.policies[0]["script-src"], ["'self'"])
            self.assertEqual(redirect.scripts, ["/lab-redirect.js"])
            checkout_return = PagePolicy((published / "support-return.html").read_text("utf-8"))
            self.assertEqual(checkout_return.policies[0]["script-src"], ["'self'"])
            self.assertEqual(checkout_return.policies[0]["connect-src"], ["'self'"])
            expected_scripts = []
            for logical in (
                "localization.js",
                "support-config.js",
                "support-client.js",
                "support-return.js",
            ):
                original = (published / logical).read_bytes()
                immutable = f"browser-resources/{hashlib.sha256(original).hexdigest()}.js"
                self.assertEqual((published / immutable).read_bytes(), original)
                expected_scripts.append(immutable)
            self.assertEqual(checkout_return.scripts, expected_scripts)
            self.assertNotIn("support-worker", str(list(published.rglob("*"))))
            self.assertIn(
                "Referrer-Policy: no-referrer", (published / "_headers").read_text("utf-8")
            )

    def test_explicit_public_option_preserves_native_beacon_and_private_boundaries(self):
        from maimai_intelligence.seo import build_seo
        from tests.test_seo import catalog

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            preview = root / "preview"
            build_lab(write_package(root / "package"), preview, catalog_version="fixture-v1")
            default = plan_public_release(preview)
            production = plan_public_release(preview, preserve_web_analytics=True)
            names = set(default.assets) & set(production.assets)
            renamed = set(default.assets) ^ set(production.assets)
            self.assertTrue(renamed)
            self.assertTrue(
                all(
                    name.startswith("browser-resources/") and name.endswith(".txt")
                    for name in renamed
                )
            )
            changed = {name for name in names if default.assets[name] != production.assets[name]}
            self.assertTrue({"index.html", "browser-shell.html"} <= changed)
            self.assertTrue(
                all(
                    name
                    in {
                        "index.html",
                        "browser-shell.html",
                        "browser-resources.json",
                        "browser-config.json",
                    }
                    or name.endswith("/index.html")
                    for name in changed
                )
            )
            for name in ("index.html", "browser-shell.html"):
                before = PagePolicy(default.assets[name].decode()).policies[0]
                after = PagePolicy(production.assets[name].decode()).policies[0]
                self.assertEqual(after["script-src"], before["script-src"] + [CF_ORIGIN])
                self.assertEqual(
                    after["connect-src"],
                    before["connect-src"] + ["https://cloudflareinsights.com/cdn-cgi/rum"],
                )
                for directive in set(before) - {"script-src", "connect-src"}:
                    self.assertEqual(after[directive], before[directive])
                self.assertEqual(
                    PagePolicy(production.assets[name].decode()).scripts,
                    PagePolicy(default.assets[name].decode()).scripts,
                )
                self.assertEqual(
                    _preserve_web_analytics(production.assets[name]), production.assets[name]
                )
            for name in ("support.html", "support-return.html", "lab/index.html", "_headers"):
                self.assertEqual(production.assets[name], default.assets[name])
            policy = PagePolicy(production.assets["index.html"].decode()).policies[0]
            csp = "; ".join(key + " " + " ".join(values) for key, values in policy.items())
            pages, _, _ = build_seo(catalog(), browser_csp=csp)
            for locale in ("en", "ja", "ko", "zh-hans", "id"):
                for kind in ("songs", "versions"):
                    documents = [
                        raw
                        for name, raw in pages.items()
                        if name.startswith(f"{locale}/{kind}/") and name.endswith("/index.html")
                    ]
                    self.assertTrue(documents)
                    for raw in documents:
                        self.assertEqual(PagePolicy(raw.decode()).policies[0], policy)
            with self.assertRaisesRegex(ValueError, "must be explicit"):
                plan_public_release(preview, preserve_web_analytics="true")
            (preview / "staging-build.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "staging browser"):
                plan_public_release(preview, preserve_web_analytics=True)
            self.assertEqual(
                plan_public_release(preview).assets["index.html"], default.assets["index.html"]
            )
