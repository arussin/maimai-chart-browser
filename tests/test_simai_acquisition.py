"""Collector boundaries use authored HTML, temporary files and fake HTTP only."""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import types
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stdout
from email.message import Message
from pathlib import Path
from unittest.mock import Mock, patch


class FakeResponse:
    def __init__(self, data: bytes, url: str):
        self.body = io.BytesIO(data)
        self.url = url
        self.status = 200
        self.headers = Message()
        self.headers["Content-Type"] = "text/html; charset=utf-8"
        self.read_limits = []

    def read(self, limit):
        self.read_limits.append(limit)
        return self.body.read(limit)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class SimaiAcquisitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "scripts" / "acquire_simai_corpus.py"
        spec = importlib.util.spec_from_file_location("authored_acquisition_test", path)
        if spec is None or spec.loader is None:
            raise AssertionError("Could not load the explicit local collector")
        cls.collector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.collector)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.output = self.directory / "capture"
        self.output.mkdir()
        self.opener = Mock()
        self.opener.open.side_effect = AssertionError("Unexpected network attempt")
        opener_patch = patch.object(
            self.collector.urllib.request, "build_opener", return_value=self.opener
        )
        opener_patch.start()
        self.addCleanup(opener_patch.stop)
        sleep_patch = patch.object(self.collector.time, "sleep")
        sleep_patch.start()
        self.addCleanup(sleep_patch.stop)
        self.page_url = self.collector.ORIGIN + "/simai/pages/123.html"
        self.page_relative = "pages/123.html"
        self.html = b'<div id="wikibody"><h2>Authored fixture</h2></div>'

    def cache(self, url=None, relative=None, data=None, **changes):
        url = self.page_url if url is None else url
        relative = self.page_relative if relative is None else relative
        data = self.html if data is None else data
        path = self.output / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        metadata = {
            "url": url,
            "final_url": url,
            "file": relative,
            "retrieved_at_utc": "2026-01-01T00:00:00+00:00",
            "http_status": 200,
            "encoding": "utf-8",
            "bytes": len(data),
            "sha256": self.collector.digest(data),
            **changes,
        }
        path.with_suffix(path.suffix + ".capture.json").write_text(
            json.dumps(metadata), encoding="utf-8"
        )
        return path, metadata

    def capture_fixture(self, pages=(123, 124)):
        for page in (32, 808):
            self.cache(
                self.collector.ORIGIN + f"/simai/pages/{page}.html",
                f"indexes/{page}.html",
            )
        self.cache(
            self.collector.ORIGIN + "/robots.txt",
            "indexes/robots.txt",
            b"User-agent: *\nAllow: /\n",
        )
        self.cache()
        helper = types.ModuleType("scripts.simai_collection")
        helper.discover_indexes = Mock(
            return_value={
                "page_ids": list(pages),
                "inventory_rows": [
                    {"input_id": f"authored-{page}", "source_page_id": page} for page in pages
                ],
            }
        )
        helper.extract_chart = Mock(return_value={"body": "(120){4}1,2,E"})
        return helper

    def test_offline_uses_only_hash_verified_cache_and_never_opens_http(self):
        self.cache()
        fetcher = self.collector.Fetcher(self.output, offline=True)
        data, metadata = fetcher.fetch(self.page_url, self.page_relative)
        self.assertEqual(data, self.html)
        self.assertEqual(metadata["sha256"], self.collector.digest(self.html))
        self.assertEqual((fetcher.requests, fetcher.cache_hits), (0, 1))
        self.assertEqual(fetcher.total_bytes, len(self.html))
        with self.assertRaises(ValueError):
            fetcher.fetch(self.collector.ORIGIN + "/simai/pages/124.html", "pages/124.html")
        self.opener.open.assert_not_called()

    def test_corrupt_cache_hash_cannot_trigger_network_repair(self):
        path, _ = self.cache()
        path.write_bytes(b"Different authored bytes")
        for offline in (True, False):
            with self.subTest(offline=offline), self.assertRaises(ValueError):
                self.collector.Fetcher(self.output, offline=offline).fetch(
                    self.page_url, self.page_relative
                )
        self.opener.open.assert_not_called()

    def test_cached_metadata_cannot_redirect_extraction_or_misstate_source(self):
        for changes in (
            {"file": "../outside.html"},
            {"url": self.collector.ORIGIN + "/simai/pages/124.html"},
            {"final_url": "https://example.invalid/account"},
            {"bytes": 0},
            {"http_status": 403},
        ):
            with self.subTest(changes=changes):
                self.cache(**changes)
                with self.assertRaises(ValueError):
                    self.collector.Fetcher(self.output, offline=True).fetch(
                        self.page_url, self.page_relative
                    )
        self.opener.open.assert_not_called()

    def test_cache_sidecar_must_be_a_bounded_object(self):
        path, metadata = self.cache()
        sidecar = path.with_suffix(path.suffix + ".capture.json")
        for content in ("[]", '"authored string"', " " * (1024 * 1024) + json.dumps(metadata)):
            with self.subTest(size=len(content)):
                sidecar.write_text(content, encoding="utf-8")
                with self.assertRaises(ValueError):
                    self.collector.Fetcher(self.output, offline=True).fetch(
                        self.page_url, self.page_relative
                    )
        self.opener.open.assert_not_called()

    def test_only_numeric_page_and_robots_routes_are_requested(self):
        for suffix in (
            "/simai/edit/123.html",
            "/simai/pages/login.html",
            "/simai/pages/../123.html",
            "/simai/pages/123.html?account=1",
            "/simai/pages/123.html#history",
            "/simai/pages/000123.html",
            "/other/pages/123.html",
        ):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                self.collector.Fetcher(self.output).fetch(
                    self.collector.ORIGIN + suffix, self.page_relative
                )
        for url in ("http://w.atwiki.jp/simai/pages/123.html", "https://example.invalid/"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.collector.Fetcher(self.output).fetch(url, self.page_relative)
        self.opener.open.assert_not_called()

    def test_output_traversal_is_rejected_before_network(self):
        for relative in ("../outside.html", str(self.directory / "outside.html"), "."):
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                self.collector.Fetcher(self.output).fetch(self.page_url, relative)
        self.opener.open.assert_not_called()
        self.assertFalse((self.directory / "outside.html").exists())

    def test_redirects_cannot_change_origin_or_enter_nonchart_routes(self):
        handler = self.collector.PageRedirects()
        # Authored fixed URL; passed only to the redirect handler, never opened.
        request = urllib.request.Request(self.page_url)  # noqa: S310
        for destination in (
            "http://w.atwiki.jp/simai/pages/124.html",
            "https://example.invalid/simai/pages/124.html",
            self.collector.ORIGIN + "/simai/pages/login.html",
            self.collector.ORIGIN + "/simai/pages/124.html?edit=1",
            self.collector.ORIGIN + "/simai/pages/124.html#history",
        ):
            with (
                self.subTest(destination=destination),
                self.assertRaises(self.collector.CaptureStopped),
            ):
                handler.redirect_request(request, None, 302, "Found", {}, destination)

    def test_delay_is_finite_and_bounded(self):
        for delay in (float("nan"), float("inf"), -1.0, 60.1):
            with self.subTest(delay=delay), self.assertRaises(ValueError):
                self.collector.Fetcher(self.output, delay)
        self.assertEqual(self.collector.Fetcher(self.output, 0).delay, 1.0)

    def test_single_bounded_response_is_hashed_before_caching(self):
        response = FakeResponse(self.html, self.page_url)
        self.opener.open.side_effect = None
        self.opener.open.return_value = response
        fetcher = self.collector.Fetcher(self.output)
        data, metadata = fetcher.fetch(self.page_url, self.page_relative)
        self.assertEqual(data, self.html)
        self.assertEqual(response.read_limits, [self.collector.MAX_RESPONSE_BYTES + 1])
        self.assertEqual(metadata["bytes"], len(self.html))
        self.assertEqual(metadata["sha256"], self.collector.digest(self.html))
        self.assertEqual((self.output / self.page_relative).read_bytes(), self.html)
        self.assertEqual(fetcher.requests, 1)
        self.assertEqual(self.opener.open.call_args.kwargs, {"timeout": 30})

    def test_response_budget_rejects_without_persisting_partial_content(self):
        self.opener.open.side_effect = None
        self.opener.open.return_value = FakeResponse(b"12345", self.page_url)
        with patch.object(self.collector, "MAX_RESPONSE_BYTES", 4), self.assertRaises(ValueError):
            self.collector.Fetcher(self.output).fetch(self.page_url, self.page_relative)
        self.assertFalse((self.output / self.page_relative).exists())
        self.assertFalse((self.output / (self.page_relative + ".capture.json")).exists())

    def test_total_capture_budget_is_enforced_before_response_commit(self):
        self.opener.open.side_effect = None
        self.opener.open.return_value = FakeResponse(b"12345", self.page_url)
        with (
            patch.object(self.collector, "MAX_CAPTURE_BYTES", 4),
            self.assertRaises(self.collector.CaptureStopped),
        ):
            self.collector.Fetcher(self.output).fetch(self.page_url, self.page_relative)
        self.assertFalse((self.output / self.page_relative).exists())
        self.assertFalse((self.output / (self.page_relative + ".capture.json")).exists())

    def test_denial_or_throttling_stops_without_retry_or_cache(self):
        for code in (401, 403, 429):
            self.opener.open.reset_mock()
            self.opener.open.side_effect = urllib.error.HTTPError(
                self.page_url, code, "Authored denial", {"Retry-After": "120"}, None
            )
            with self.subTest(code=code), self.assertRaises(self.collector.CaptureStopped):
                self.collector.Fetcher(self.output).fetch(self.page_url, self.page_relative)
            self.opener.open.assert_called_once()
            self.assertFalse((self.output / self.page_relative).exists())

    def test_robots_rejection_never_opens_a_page(self):
        fetcher = self.collector.Fetcher(self.output)
        fetcher.robot = Mock()
        fetcher.robot.can_fetch.return_value = False
        with self.assertRaises(self.collector.CaptureStopped):
            fetcher.fetch(self.page_url, self.page_relative)
        self.opener.open.assert_not_called()

    def test_sidecar_symlink_cannot_escape_capture_root(self):
        path, metadata = self.cache()
        sidecar = path.with_suffix(path.suffix + ".capture.json")
        sidecar.unlink()
        outside = self.directory / "authored-outside.json"
        outside.write_text(json.dumps(metadata), encoding="utf-8")
        try:
            sidecar.symlink_to(outside)
        except OSError:
            self.skipTest("Symlink creation is unavailable in this environment")
        with self.assertRaises(ValueError):
            self.collector.Fetcher(self.output, offline=True).fetch(
                self.page_url, self.page_relative
            )

    def test_pending_symlink_cannot_overwrite_outside_content(self):
        path = self.output / self.page_relative
        path.parent.mkdir()
        outside = self.directory / "authored-outside.txt"
        outside.write_bytes(b"unchanged authored sentinel")
        try:
            path.with_suffix(path.suffix + ".pending").symlink_to(outside)
        except OSError:
            self.skipTest("Symlink creation is unavailable in this environment")
        self.opener.open.side_effect = None
        self.opener.open.return_value = FakeResponse(self.html, self.page_url)
        with self.assertRaises(ValueError):
            self.collector.Fetcher(self.output).fetch(self.page_url, self.page_relative)
        self.assertEqual(outside.read_bytes(), b"unchanged authored sentinel")

    def test_offline_inventory_accounts_for_cache_misses_without_network(self):
        helper = self.capture_fixture()
        with (
            patch.dict("sys.modules", {"scripts.simai_collection": helper}),
            redirect_stdout(io.StringIO()),
        ):
            manifest = self.collector.acquire(self.output, offline=True)
        self.assertEqual(manifest["distinct_linked_pages"], 2)
        self.assertEqual(manifest["captured_pages"], 1)
        self.assertEqual(manifest["extracted_bodies"], 1)
        self.assertIsNone(manifest["capture_stopped_reason"])
        states = json.loads((self.output / "capture-pages.json").read_text(encoding="utf-8"))
        self.assertEqual(states["124"]["status"], "not_captured")
        rows = [
            json.loads(line)
            for line in (self.output / "charts.jsonl").read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual([row["acquisition_status"] for row in rows], ["available", "unavailable"])
        self.assertEqual(rows[1]["reason"], "offline cache miss")
        self.assertEqual(
            manifest["charts_sha256"],
            self.collector.digest((self.output / "charts.jsonl").read_bytes()),
        )
        self.opener.open.assert_not_called()

    def test_denial_finishes_a_truthful_partial_manifest_and_journals_unrequested_pages(self):
        helper = self.capture_fixture((123, 124, 125))
        self.opener.open.side_effect = urllib.error.HTTPError(
            self.collector.ORIGIN + "/simai/pages/124.html",
            429,
            "Authored throttling",
            {"Retry-After": "120"},
            None,
        )
        progress = io.StringIO()
        with (
            patch.dict("sys.modules", {"scripts.simai_collection": helper}),
            redirect_stdout(progress),
        ):
            manifest = self.collector.acquire(self.output)
        self.opener.open.assert_called_once()
        self.assertEqual(
            self.opener.open.call_args.args[0].full_url,
            self.collector.ORIGIN + "/simai/pages/124.html",
        )
        self.assertEqual((manifest["captured_pages"], manifest["extracted_bodies"]), (1, 1))
        self.assertIn("429", manifest["capture_stopped_reason"])
        journal = [
            json.loads(line)
            for line in (self.output / "capture-progress.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        self.assertEqual([event["page"] for event in journal], [123, 124, 125])
        self.assertEqual(
            [event["status"] for event in journal], ["captured", "stopped", "not_requested"]
        )
        state = json.loads((self.output / "capture-state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["status"], "partial")
        self.assertEqual(json.loads(progress.getvalue().splitlines()[-1])["captured_pages"], 1)

    def test_interruption_marks_current_state_without_claiming_old_manifest_is_current(self):
        helper = self.capture_fixture()
        previous_manifest = b'{"authored_prior_run":true}'
        (self.output / "manifest.json").write_bytes(previous_manifest)
        (self.output / "capture-state.json").write_text('{"status":"complete"}', encoding="utf-8")
        self.opener.open.side_effect = KeyboardInterrupt()
        with (
            patch.dict("sys.modules", {"scripts.simai_collection": helper}),
            redirect_stdout(io.StringIO()),
        ):
            result = self.collector.main(["--output-dir", str(self.output)])
        self.assertEqual(result, 1)
        state = json.loads((self.output / "capture-state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["status"], "interrupted")
        self.assertEqual((self.output / "manifest.json").read_bytes(), previous_manifest)
        self.opener.open.assert_called_once()

    def test_rejected_extraction_is_unavailable_and_never_creates_a_body(self):
        helper = self.capture_fixture((123,))
        helper.extract_chart.side_effect = ValueError("Authored ambiguous chart section")
        with (
            patch.dict("sys.modules", {"scripts.simai_collection": helper}),
            redirect_stdout(io.StringIO()),
        ):
            manifest = self.collector.acquire(self.output, offline=True)
        self.assertEqual((manifest["captured_pages"], manifest["extracted_bodies"]), (1, 0))
        row = json.loads((self.output / "charts.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(row["acquisition_status"], "unavailable")
        self.assertIn("extraction_rejected", row["reason"])
        self.assertNotIn("body_file", row)
        self.assertEqual(list((self.output / "bodies").iterdir()), [])
        self.opener.open.assert_not_called()

    def test_page_budget_and_excessive_robots_delay_do_not_request_charts(self):
        helper = self.capture_fixture(tuple(range(1, 4098)))
        with (
            patch.dict("sys.modules", {"scripts.simai_collection": helper}),
            redirect_stdout(io.StringIO()),
            self.assertRaises(ValueError),
        ):
            self.collector.acquire(self.output, offline=True)
        self.cache(
            self.collector.ORIGIN + "/robots.txt",
            "indexes/robots.txt",
            b"User-agent: *\nAllow: /\nCrawl-delay: 61\n",
        )
        with (
            patch.dict("sys.modules", {"scripts.simai_collection": helper}),
            self.assertRaises(self.collector.CaptureStopped),
        ):
            self.collector.acquire(self.output, offline=True)
        self.opener.open.assert_not_called()

    def test_generated_body_and_journal_symlinks_cannot_escape_output(self):
        for relative in ("bodies", "capture-progress.jsonl", "charts.jsonl"):
            with self.subTest(relative=relative):
                self.output = self.directory / relative.replace(".", "-")
                self.output.mkdir()
                helper = self.capture_fixture((123,))
                outside = self.directory / ("outside-" + relative.replace(".", "-"))
                if relative == "bodies":
                    outside.mkdir()
                else:
                    outside.write_bytes(b"unchanged authored sentinel")
                try:
                    (self.output / relative).symlink_to(
                        outside, target_is_directory=relative == "bodies"
                    )
                except OSError:
                    self.skipTest("Symlink creation is unavailable in this environment")
                with (
                    patch.dict("sys.modules", {"scripts.simai_collection": helper}),
                    redirect_stdout(io.StringIO()),
                    self.assertRaises(ValueError),
                ):
                    self.collector.acquire(self.output, offline=True)
                if relative == "bodies":
                    self.assertEqual(list(outside.iterdir()), [])
                else:
                    self.assertEqual(outside.read_bytes(), b"unchanged authored sentinel")


if __name__ == "__main__":
    unittest.main()
