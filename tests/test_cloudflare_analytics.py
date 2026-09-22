import tempfile
import unittest
from html.parser import HTMLParser
from importlib.resources import files
from pathlib import Path

from maimai_intelligence.lab import build_lab
from maimai_intelligence.public_release import build_public_release
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
    def assert_native_policy(self, html, *, report_sources=False):
        page = PagePolicy(html)
        self.assertEqual(len(page.policies), 1)
        policy = page.policies[0]
        self.assertEqual(
            policy["script-src"],
            [
                "'self'",
                GA_SCRIPT,
                CF_ORIGIN,
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
                "https://cloudflareinsights.com/cdn-cgi/rum",
                "https://api.stripe.com",
                "https://checkout.stripe.com",
                "https://link.com",
                "https://*.link.com",
            ],
        )
        self.assertEqual(policy["default-src"], ["'none'"])
        self.assertEqual(policy["object-src"], ["'none'"])
        self.assertEqual(policy["base-uri"], ["'none'"])
        # Permissions alone must not add a tracker to a local/preview build.
        self.assertFalse(any("cloudflareinsights.com" in src for src in page.scripts))
        self.assertFalse(any("googletagmanager.com" in src for src in page.scripts))
        self.assertFalse(any("stripe.com" in src for src in page.scripts))
        self.assertIn('name="referrer" content="no-referrer"', html)

    def test_site_template_permits_only_native_collection_without_installing_a_tag(self):
        html = files("maimai_intelligence.assets").joinpath("index.html").read_text("utf-8")
        self.assert_native_policy(html)

    def test_generated_lab_and_public_release_preserve_ga_and_redirect_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "package")
            preview = root / "preview"
            build_lab(source, preview, catalog_version="fixture-v1")
            self.assert_native_policy(
                (preview / "index.html").read_text("utf-8"), report_sources=True
            )
            published = root / "public"
            build_public_release(preview, published)
            self.assert_native_policy(
                (published / "index.html").read_text("utf-8"), report_sources=True
            )
            # Asset builds normalize platform newlines; compare complete source text.
            original = (
                files("maimai_intelligence.assets").joinpath("analytics.js").read_text("utf-8")
            )
            self.assertEqual((preview / "analytics.js").read_text("utf-8"), original)
            self.assertEqual((published / "analytics.js").read_text("utf-8"), original)
            redirect = PagePolicy((published / "lab/index.html").read_text("utf-8"))
            self.assertEqual(redirect.policies[0]["script-src"], ["'self'"])
            self.assertEqual(redirect.scripts, ["/lab-redirect.js"])
            checkout_return = PagePolicy((published / "support-return.html").read_text("utf-8"))
            self.assertEqual(checkout_return.policies[0]["script-src"], ["'self'"])
            self.assertEqual(checkout_return.policies[0]["connect-src"], ["'self'"])
            self.assertEqual(
                checkout_return.scripts,
                ["localization.js", "support-config.js", "support-client.js", "support-return.js"],
            )
            self.assertNotIn("support-worker", str(list(published.rglob("*"))))
            self.assertIn(
                "Referrer-Policy: no-referrer", (published / "_headers").read_text("utf-8")
            )
