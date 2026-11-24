"""Offline small-input acceptance checks; no Git, hosting, or live-check substitutes."""

import argparse
import copy
import gzip
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import prepare_interface_release as tool
from scripts import release_driver as driver

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


class InvitationAndObservation(unittest.TestCase):
    def test_invitation_only_and_exact_receipt(self):
        old = {"messages": {"x": "old"}, "support": {"invitation": "old", "enabled": True}}
        new = {"messages": {"x": "new"}, "support": {"invitation": "新 text", "enabled": True}}
        with self.assertRaisesRegex(ValueError, "--allow-invitation-change"):
            tool.configuration_changes(old, new)
        self.assertEqual(
            tool.configuration_changes(old, new, allow_invitation_change=True),
            {"old": "old", "new": "新 text"},
        )
        self.assertEqual(new["support"]["invitation"], "新 text")
        for key in ("enabled", "origin", "publishableKey", "project", "title", "thanks"):
            changed = copy.deepcopy(new)
            changed["support"][key] = "different"
            with self.assertRaisesRegex(ValueError, "configuration change"):
                tool.configuration_changes(old, changed, allow_invitation_change=True)
        with self.assertRaisesRegex(ValueError, "configuration change"):
            tool.configuration_changes(old, {**new, "features": {}}, allow_invitation_change=True)

    def test_invitation_cannot_be_added_removed_or_nontext(self):
        for value in (None, 1, {}, False):
            with self.assertRaises(ValueError):
                tool.configuration_changes(
                    {"support": {"invitation": "old"}},
                    {"support": {"invitation": value}},
                    allow_invitation_change=True,
                )
        self.assertIsNone(tool.configuration_changes({"messages": "old"}, {"messages": "new"}))

    def test_saved_manifest_is_bound_and_never_uses_network(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "manifest.json"
            path.write_bytes(b"manifest")
            with patch.object(tool, "live_manifest", side_effect=AssertionError("network")):
                args = argparse.Namespace(observed_manifest=path)
                with self.assertRaisesRegex(ValueError, "live_manifest_sha256"):
                    tool.observed_manifest(args, {})
                self.assertEqual(
                    tool.observed_manifest(args, {"live_manifest_sha256": tool.sha(b"manifest")}),
                    b"manifest",
                )


class DriverGates(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.release = self.root / "release"
        self.base = self.root / "base"
        self.node, self.wrangler = self.root / "node.exe", self.root / "wrangler.js"
        self.node.write_bytes(b"not executable")
        self.wrangler.write_bytes(b"never executed")
        self.spec = {
            "kind": "interface",
            "source": str(Path(__file__).resolve().parents[1]),
            "expected_commit": "a" * 40,
            "base_commit": "b" * 40,
            "base_release": str(self.base),
            "base_deployment": "00000000-0000-0000-0000-000000000001",
            "release": str(self.release),
            "hosting_check": str(self.root / "hosting.json"),
            "observed_manifest": str(self.root / "observed.json"),
            "node": str(self.node),
            "wrangler": str(self.wrangler),
            "wrangler_sha256": tool.sha(b"never executed"),
            "preview_branch": "review-test",
        }
        tool.save(self.root / "hosting.json", {})
        tool.save(self.root / "observed.json", {})
        self.make_release(self.base, b"old")
        self.pre_id = "11111111-1111-4111-8111-111111111111"
        self.prod_id = "22222222-2222-4222-8222-222222222222"

    def make_release(self, root, html):
        (root / "public").mkdir(parents=True)
        (root / "planner-input").mkdir()
        (root / "public/index.html").write_bytes(html)
        tool.save(root / "public/manifest.json", {"default": "fictional"})
        rows = tool.inventory(root / "public")
        raw = tool.encoded(rows)
        (root / "inventory.json.gz").write_bytes(gzip.compress(raw, mtime=0))
        tool.save(root / "preparation.json", {"inventory_sha256": tool.sha(raw)})

    def prepare(self, kind="interface"):
        spec = dict(self.spec, kind=kind)
        if kind == "catalog":
            del spec["base_commit"]
            run = self.root / "run"
            run.mkdir()
            for name in ("browser", "package", "registry"):
                (run / name).mkdir()
                (run / name / "data.json").write_text("{}")
            for name in ("ready.json", "state.json", "attempt.json"):
                tool.save(run / name, {})
            (run / "public").mkdir()
            (run / "public/omit.txt").write_text("not another public copy")
            spec.update(run=str(run), export_artwork_source=str(self.base / "public"))
        tool.save(self.root / "spec.json", spec)
        selected = tool if kind == "interface" else driver.data
        with patch.object(
            selected,
            "prepare",
            side_effect=lambda args: self.make_release(Path(args.release), b"new"),
        ) as prepare:
            with patch.object(sys, "stdout", io.StringIO()):
                driver.prepare(self.root / "spec.json")
            prepare.assert_called_once()
        return tool.read(self.release / "driver.json")

    def checks(self, name, **extra):
        path = self.root / name
        sha = driver.digest(self.release / "public/manifest.json")
        tool.save(
            path,
            {
                "passed": True,
                "checks": {"browser": "checked"},
                "manifest_sha256": sha,
                "live_manifest_sha256": sha,
                **extra,
            },
        )
        return path

    def preview(self):
        driver.record(
            self.release,
            "preview",
            self.pre_id,
            self.checks("preview-checks.json"),
            "2026-11-23T01:00:00Z",
            "owner",
        )

    def approve(self, **extra):
        state = tool.read(self.release / "driver.json")
        path = self.root / "approval.json"
        tool.save(
            path,
            {
                "approved_by": "Adam",
                "approved": True,
                "evidence": "fictional test approval",
                "approved_at": "2026-11-23T02:00:00Z",
                "preparation_sha256": state["preparation_sha256"],
                "preview_deployment": self.pre_id,
                **extra,
            },
        )
        with patch.object(sys, "stdout", io.StringIO()):
            driver.command(self.release, "production", path)

    def production(self):
        driver.record(
            self.release,
            "production",
            self.prod_id,
            self.checks("production-checks.json"),
            "2026-11-23T03:00:00Z",
            "owner",
        )

    def test_complete_catalog_flow_and_real_small_archive(self):
        self.prepare("catalog")
        self.assertEqual(driver.status(self.release)["next_gate"], "preview upload and checks")
        with patch.object(driver.subprocess, "run", side_effect=AssertionError("no execution")):
            with patch.object(sys, "stdout", io.StringIO()) as output:
                driver.command(self.release, "preview")
                self.assertIn("'review-test'", output.getvalue())
                self.assertIn("'--commit-hash' '" + "a" * 40, output.getvalue())
            self.preview()
            self.assertEqual(driver.status(self.release)["next_gate"], "Adam's production approval")
            self.approve()
            self.assertEqual(
                driver.status(self.release)["next_gate"], "production upload and checks"
            )
            self.production()
        self.assertEqual(driver.status(self.release)["next_gate"], "retain")
        with patch.object(sys, "stdout", io.StringIO()):
            driver.retain(self.release, self.root / "archive.zip", self.root)
        self.assertIn("update production record", driver.status(self.release)["next_gate"])
        import zipfile

        with zipfile.ZipFile(self.root / "archive.zip") as archive:
            self.assertIn("run/browser/data.json", archive.namelist())
            self.assertIn("run/ready.json", archive.namelist())
            self.assertNotIn("run/public/omit.txt", archive.namelist())

    def test_no_production_before_preview_and_approval(self):
        self.prepare()
        with self.assertRaises((ValueError, FileNotFoundError)):
            driver.command(self.release, "production")
        self.preview()
        with self.assertRaisesRegex(ValueError, "approval"):
            driver.command(self.release, "production")
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.production()
        with self.assertRaisesRegex(ValueError, "Approval must name"):
            self.approve(preview_deployment=self.prod_id)

    def test_failed_checks_and_changed_artifact_block(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, "did not pass"):
            driver.record(
                self.release,
                "preview",
                self.pre_id,
                self.checks("bad.json", passed=False),
                "2026-11-23T01:00:00Z",
                "owner",
            )
        self.assertFalse((self.release / "preview-upload.json").exists())
        (self.release / "public/index.html").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Artifact bytes changed"):
            driver.command(self.release, "preview")

    def test_uploader_drift_duplicate_record_and_archive_guard(self):
        self.prepare()
        self.wrangler.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Wrangler changed"):
            driver.command(self.release, "preview")
        self.wrangler.write_bytes(b"never executed")
        self.preview()
        with self.assertRaises(FileExistsError):
            driver.record(
                self.release,
                "preview",
                self.pre_id,
                self.root / "preview-checks.json",
                "2026-11-23T01:00:00Z",
                "owner",
            )
        self.approve()
        self.production()
        with self.assertRaisesRegex(ValueError, "outside retained inputs"):
            driver.retain(self.release, self.release / "bad.zip", self.root)

    def test_inputs_refuse_main_unknown_fields_and_narrow_optins(self):
        for fields in (
            {"preview_branch": "main"},
            {"unexpected": True},
            {"allow_invitation_change": "yes"},
            {"expected_commit": "a" * 7},
        ):
            with self.assertRaises(ValueError):
                driver.validate_spec({**self.spec, **fields})

    def test_summary_rejects_loss_and_immutable_changes(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, "disappear"):
            driver.summarize(self.base, self.release, {"lost": {}}, {})
        with self.assertRaisesRegex(ValueError, "Immutable"):
            driver.summarize(
                self.base,
                self.release,
                {"browser/x.js": {"sha256": "old"}},
                {"browser/x.js": {"sha256": "new"}},
            )


if __name__ == "__main__":
    unittest.main(verbosity=2, testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
