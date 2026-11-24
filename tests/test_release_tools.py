"""Offline small-input acceptance checks; no Git, hosting, or live-check substitutes."""

import sys
import tempfile
import unittest
from pathlib import Path

from scripts import prepare_interface_release as tool

NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'


def sitemap(rows):
    return (
        "<urlset "
        + NS
        + ">"
        + "".join(
            "<url><loc>https://maimai.party/"
            + path
            + "</loc>"
            + ("<lastmod>" + date + "</lastmod>" if date else "")
            + "</url>"
            for path, date in rows
        )
        + "</urlset>"
    ).encode()


class Acceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def record(self, assets):
        for name, raw in assets.items():
            target = self.base / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        return {name: tool.fingerprint(raw) for name, raw in assets.items()}

    def check(self, pending, prior, headers=False, date=None):
        return tool.metadata_changes(
            pending, prior, self.base, allow_headers_change=headers, release_date=date
        )

    def test_noop_needs_no_optins(self):
        old = {"_headers": b"/*\n  X-Test: old\n", "sitemap.xml": sitemap([("", None)])}
        receipt = self.check(old, self.record(old))
        self.assertEqual(receipt["headers_diff"], "")
        self.assertEqual(receipt["sitemaps"]["sitemap.xml"]["no_date"], 1)

    def test_header_permission_and_exact_diff(self):
        prior = self.record({"_headers": b"old\n"})
        with self.assertRaisesRegex(ValueError, "--allow-headers-change"):
            self.check({"_headers": b"new\n"}, prior, date="2026-11-22")
        self.assertEqual(
            self.check({"_headers": b"new\n"}, prior, headers=True)["headers_diff"],
            "--- previous/_headers\n+++ candidate/_headers\n@@ -1 +1 @@\n-old\n+new\n",
        )

    def test_sitemap_requires_date_even_with_header_permission(self):
        old = {"sitemap.xml": sitemap([("", None)])}
        prior = self.record(old)
        for pending in (
            {"sitemap.xml": sitemap([("new.html", None)])},
            {"sitemap-extra.xml": sitemap([("", None)])},
        ):
            with self.assertRaisesRegex(ValueError, "--release-date"):
                self.check(pending, prior, headers=True)

    def test_invalid_dates(self):
        for date in ("2026-02-30", "20261122", "2026-1-22", ""):
            with self.assertRaises(ValueError):
                self.check({}, {}, date=date)

    def test_immutable_guards_survive_both_optins(self):
        for name in (
            *tool.PRESERVED,
            "catalog-parts/x.json",
            "media/x.webp",
            "browser/chunk-ABCDEFGH.js",
            "browser-resources/x.html",
        ):
            prior = self.record({name: b"old"})
            with self.assertRaisesRegex(ValueError, "Immutable bytes"):
                self.check({name: b"new"}, prior, headers=True, date="2026-11-22")

    def test_seed_carry_forward_changes_and_idempotence(self):
        old = {
            "index.html": b"<html>home</html>",
            "same.html": b"<html>same</html>",
            "changed.html": b"<html>old</html>",
            "sitemap.xml": sitemap(
                [("", None), ("same.html", "2026-11-20"), ("changed.html", "2026-11-20")]
            ),
        }
        prior = self.record(old)
        pending = {**old, "changed.html": b"<html>new</html>"}
        tool.finalize_sitemap_dates(pending, {}, self.base, "2026-11-22")
        once = dict(pending)
        tool.finalize_sitemap_dates(pending, {}, self.base, "2026-11-22")
        self.assertEqual(pending, once)
        counts = self.check(pending, prior, date="2026-11-22")["sitemaps"]["sitemap.xml"]
        self.assertEqual(
            (counts["kept_date"], counts["release_date"], counts["no_date"]), (1, 2, 0)
        )

    def test_omitted_date_preserves_old_and_leaves_changed_undated(self):
        old = {
            "index.html": b"home",
            "changed.html": b"old",
            "sitemap.xml": sitemap([("", "2026-11-20"), ("changed.html", "2026-11-20")]),
        }
        self.record(old)
        pending = {**old, "changed.html": b"new"}
        tool.finalize_sitemap_dates(pending, {}, self.base, None)
        self.assertEqual(
            pending["sitemap.xml"], sitemap([("", "2026-11-20"), ("changed.html", None)])
        )

    def test_index_counts_are_not_url_counts(self):
        child = sitemap([("", None)])
        index = (
            "<sitemapindex " + NS + "><sitemap><loc>https://maimai.party/sitemap-main.xml"
            "</loc></sitemap></sitemapindex>"
        ).encode()
        old = {"index.html": b"home", "sitemap-main.xml": child, "sitemap.xml": index}
        prior = self.record(old)
        pending = dict(old)
        tool.finalize_sitemap_dates(pending, {}, self.base, "2026-11-22")
        receipt = self.check(pending, prior, date="2026-11-22")["sitemaps"]
        self.assertEqual(receipt["sitemap.xml"]["entry_kind"], "sitemap")
        self.assertEqual(receipt["sitemap.xml"]["release_date"], 1)
        self.assertEqual(receipt["sitemap-main.xml"]["entry_kind"], "url")

    def test_removed_url_and_index_maximum(self):
        child = sitemap([("", "2026-11-20"), ("gone.html", "2026-11-20")])
        index = (
            "<sitemapindex " + NS + "><sitemap><loc>https://maimai.party/sitemap-main.xml"
            "</loc><lastmod>2026-11-20</lastmod></sitemap></sitemapindex>"
        ).encode()
        old = {
            "index.html": b"home",
            "gone.html": b"gone",
            "sitemap-main.xml": child,
            "sitemap.xml": index,
        }
        prior = self.record(old)
        pending = {**old, "sitemap-main.xml": sitemap([("", None)])}
        tool.finalize_sitemap_dates(pending, {}, self.base, "2026-11-22")
        receipt = self.check(pending, prior, date="2026-11-22")["sitemaps"]
        self.assertEqual(receipt["sitemap-main.xml"]["removed_entries"], 1)
        self.assertEqual(receipt["sitemap-main.xml"]["kept_date"], 1)
        self.assertEqual(receipt["sitemap.xml"]["release_date"], 1)

    def test_final_shell_is_compared_and_catalogs_not_published(self):
        old = {"index.html": b"final shell", "sitemap.xml": sitemap([("", "2026-11-20")])}
        self.record(old)
        pending = dict(old)
        tool.finalize_sitemap_dates(
            pending,
            {"index.html": b"intermediate shell", "song-catalog/test.json": b"data"},
            self.base,
            "2026-11-22",
        )
        self.assertEqual(pending, old)

    def test_reject_surprising_url_date(self):
        with self.assertRaisesRegex(ValueError, "Unexpected new sitemap URL date"):
            self.check({"sitemap.xml": sitemap([("", "2026-11-21")])}, {}, date="2026-11-22")

    def test_classification(self):
        names = [
            "_headers",
            "sitemap.xml",
            "index.html",
            "en/songs/x/index.html",
            "browser-resources/abc.html",
            "favicon.ico",
            "og-image.png",
        ]
        groups = tool.files_by_kind(names)
        self.assertEqual(groups["brand_assets"], ["favicon.ico", "og-image.png"])
        self.assertEqual(sum(map(len, groups.values())), len(names))

    def test_repeat_inputs_produce_identical_metadata_bytes(self):
        old = {"index.html": b"home", "_headers": b"old\n", "sitemap.xml": sitemap([("", None)])}
        prior = self.record(old)
        results = []
        for _ in range(2):
            pending = {**old, "_headers": b"new\n"}
            tool.finalize_sitemap_dates(pending, {}, self.base, "2026-11-22")
            receipt = self.check(pending, prior, headers=True, date="2026-11-22")
            results.append((pending, tool.encoded(receipt)))
        self.assertEqual(results[0], results[1])


if __name__ == "__main__":
    unittest.main(verbosity=2, testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
