"""Network-free regression checks for bounded, actionable acquisition failures."""

import contextlib
import hashlib
import http.client
import importlib.util
import io
import json
import ssl
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "consumer", Path(__file__).with_name("consume-726.py")
)
consumer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consumer)

EXPECTED = {"bytes": 3, "sha256": hashlib.sha256(b"abc").hexdigest()}
URL = consumer.PUBLIC + "/fixture.json"
SENTINEL = "FICTIONAL_PRIVATE_SENTINEL"


class DownloadTests(unittest.TestCase):
    def attempt(self, *, error=None, stream_error=None, url=URL, status=200, headers=None):
        response = mock.MagicMock(url=url, status=status)
        response.headers = headers or {}
        response.__enter__.return_value = response
        opener = mock.Mock()
        opener.open.side_effect = error
        opener.open.return_value = response
        target = mock.Mock()
        with (
            mock.patch.object(consumer, "regular", return_value=target),
            mock.patch.object(consumer.urllib.request, "build_opener", return_value=opener),
            mock.patch.object(consumer, "stream_checked", side_effect=stream_error) as stream,
        ):
            consumer.download(URL, target, EXPECTED, "pages")
        opener.open.assert_called_once()
        self.assertEqual(opener.open.call_args.kwargs, {"timeout": 30})
        stream.assert_called_once_with(response, target, EXPECTED)

    def assert_failure(self, code, **kwargs):
        with self.assertRaises(consumer.AcquisitionFailure) as caught:
            self.attempt(**kwargs)
        detail = caught.exception.detail
        self.assertEqual(detail["code"], code)
        self.assertEqual(detail["category"], "pages")
        self.assertEqual(detail["expected_sha256"], EXPECTED["sha256"])
        self.assertEqual(detail["expected_bytes"], 3)
        self.assertLessEqual(
            set(detail), {"code", "category", "expected_sha256", "expected_bytes", "http_status"}
        )
        self.assertNotIn(SENTINEL, json.dumps(detail) + str(caught.exception))
        self.assertNotIn("https://", json.dumps(detail))
        return detail

    def test_success_still_streams_and_verifies_exact_bytes(self):
        self.attempt(headers={"Content-Length": "3"})
        self.attempt()

    def test_http_status_is_retained_without_url_body_or_headers(self):
        error = urllib.error.HTTPError(
            "https://invalid.test/?token=" + SENTINEL,
            429,
            SENTINEL,
            {"Set-Cookie": SENTINEL},
            io.BytesIO(SENTINEL.encode()),
        )
        self.assertEqual(self.assert_failure("HTTP_STATUS", error=error)["http_status"], 429)
        self.assertEqual(self.assert_failure("HTTP_STATUS", status=503)["http_status"], 503)

    def test_tls_verification_is_distinct_and_is_never_disabled(self):
        for error in (
            ssl.SSLCertVerificationError(1, SENTINEL),
            urllib.error.URLError(ssl.SSLCertVerificationError(1, SENTINEL)),
        ):
            with self.subTest(kind=type(error).__name__):
                self.assert_failure("TLS_VERIFICATION_FAILED", error=error)
        self.assert_failure("TLS_FAILURE", error=ssl.SSLError(1, SENTINEL))

    def test_timeouts_transport_and_truncation_are_distinct(self):
        for error in (TimeoutError(SENTINEL), urllib.error.URLError(TimeoutError(SENTINEL))):
            self.assert_failure("TIMEOUT", error=error)
        for error in (urllib.error.URLError(SENTINEL), ConnectionResetError(SENTINEL)):
            self.assert_failure("TRANSPORT_FAILURE", error=error)
        self.assert_failure(
            "TRUNCATED_RESPONSE", stream_error=http.client.IncompleteRead(SENTINEL.encode(), 100)
        )

    def test_response_and_integrity_rejections_remain_fail_closed(self):
        self.assert_failure("HTTP_ENCODING_REJECTED", headers={"Content-Encoding": "gzip"})
        self.assert_failure("HTTP_LENGTH_INVALID", headers={"Content-Length": SENTINEL})
        self.assert_failure("INPUT_LENGTH_MISMATCH", headers={"Content-Length": "4"})
        for code in ("INPUT_OVERSIZE", "INPUT_DIGEST_MISMATCH"):
            self.assert_failure(code, stream_error=ValueError(code))
        self.assert_failure("ENDPOINT_DENIED", url="https://invalid.test/?token=" + SENTINEL)

    def test_programming_local_io_and_interrupt_errors_are_not_provider_failures(self):
        for error in (
            TypeError(SENTINEL),
            KeyError(SENTINEL),
            ValueError(SENTINEL),
            FileExistsError(SENTINEL),
            PermissionError(SENTINEL),
            KeyboardInterrupt(),
        ):
            with self.subTest(kind=type(error).__name__), self.assertRaises(type(error)) as caught:
                self.attempt(stream_error=error)
            self.assertIs(caught.exception, error)

    def test_failed_batch_stops_scheduling_and_retains_verified_progress(self):
        progress = {}
        failure = consumer.AcquisitionFailure("TIMEOUT", "pages", EXPECTED)
        with mock.patch.object(consumer, "download", side_effect=failure) as download:
            with self.assertRaises(consumer.AcquisitionFailure):
                consumer.acquire_tasks([(URL, None, EXPECTED, "pages")] * 100, progress)
        self.assertEqual(
            progress,
            {
                "total": 100,
                "scheduled": 4,
                "completed_observed": 0,
                "pages_analytics_blocks_removed": 0,
            },
        )
        self.assertLessEqual(download.call_count, 4)

    def test_completed_batch_reports_only_counts(self):
        progress = {}
        output = io.StringIO()
        with mock.patch.object(consumer, "download"), contextlib.redirect_stdout(output):
            consumer.acquire_tasks([(URL, None, EXPECTED, "pages")] * 501, progress)
        self.assertEqual(
            progress,
            {
                "total": 501,
                "scheduled": 501,
                "completed_observed": 501,
                "pages_analytics_blocks_removed": 0,
            },
        )
        report = json.loads(output.getvalue())
        self.assertEqual(report["completed_observed"], 500)
        self.assertEqual(
            set(report),
            {
                "status",
                "total",
                "scheduled",
                "completed_observed",
                "pages_analytics_blocks_removed",
            },
        )


class HtmlTransportTests(unittest.TestCase):
    def attempt(self, raw, *, url=None, category="pages", length=None):
        url = url or consumer.PUBLIC + "/fixture.html"
        source = io.BytesIO(raw)
        response = mock.MagicMock(url=url, status=200)
        response.read.side_effect = source.read
        response.headers = {} if length is None else {"Content-Length": str(length)}
        response.__enter__.return_value = response
        opener = mock.Mock()
        opener.open.return_value = response
        target, output = mock.Mock(), io.BytesIO()
        target.open.return_value = contextlib.nullcontext(output)
        with (
            mock.patch.object(consumer, "regular", return_value=target),
            mock.patch.object(consumer.urllib.request, "build_opener", return_value=opener),
        ):
            restored = consumer.download(url, target, EXPECTED, category)
        return restored, output.getvalue(), response.read.call_args_list

    def test_exact_public_insertion_restores_original_bytes_with_or_without_length(self):
        insertion = consumer.PAGES_ANALYTICS_INSERTION
        self.assertEqual(len(insertion), 214)
        self.assertEqual(
            hashlib.sha256(insertion).hexdigest(),
            "dd257de9578b13a8454e7e37ce50d0e6f0f5a4d658a4ef61632e76bd6f52ef4a",
        )
        for raw, expected_restore in ((b"abc", False), (b"a" + insertion + b"bc", True)):
            for length in (None, len(raw)):
                with self.subTest(restored=expected_restore, length=length):
                    restored, data, calls = self.attempt(raw, length=length)
                    self.assertIs(restored, expected_restore)
                    self.assertEqual(data, b"abc")
                    self.assertEqual(calls, [mock.call(218)])

    def test_changed_original_bytes_still_fail_the_original_digest(self):
        raw = b"abd" + consumer.PAGES_ANALYTICS_INSERTION
        with self.assertRaises(consumer.AcquisitionFailure) as caught:
            self.attempt(raw)
        self.assertEqual(caught.exception.detail["code"], "INPUT_DIGEST_MISMATCH")

    def test_changed_duplicate_or_extra_insertions_are_not_stripped(self):
        insertion = consumer.PAGES_ANALYTICS_INSERTION
        for raw in (
            b"abc" + insertion.replace(b"c2c3", b"ffff"),
            b"abc" + insertion * 2,
            b"abc" + insertion + b"x",
            b"abc<script>arbitrary</script>",
        ):
            with self.subTest(length=len(raw)), self.assertRaises(consumer.AcquisitionFailure):
                self.attempt(raw)

    def test_other_paths_and_origins_keep_exact_streaming_rules(self):
        for url, category in (
            (URL, "pages"),
            (consumer.RAW + consumer.SOURCE + "/fixture.html", "source"),
        ):
            with self.subTest(category=category), self.assertRaises(consumer.AcquisitionFailure):
                self.attempt(
                    b"abc" + consumer.PAGES_ANALYTICS_INSERTION, url=url, category=category
                )
        with self.assertRaises(consumer.AcquisitionFailure) as caught:
            self.attempt(b"abc", length=4)
        self.assertEqual(caught.exception.detail["code"], "INPUT_LENGTH_MISMATCH")

    def test_batch_counts_only_verified_transport_restorations(self):
        progress = {}
        with mock.patch.object(consumer, "download", return_value=True):
            consumer.acquire_tasks([(URL, None, EXPECTED, "pages")] * 3, progress)
        self.assertEqual(progress["completed_observed"], 3)
        self.assertEqual(progress["pages_analytics_blocks_removed"], 3)


class RetainedReviewTests(unittest.TestCase):
    def source(self):
        retained = (
            Path(__file__).resolve().parents[2] / "config/coverage-reviews.json"
        ).read_bytes()
        return retained.replace(b"\r\n", b"\n")

    def expected(self):
        return {
            "bytes": 904,
            "sha256": "6595688a8e8307748acb82a0802047324b0d9d75aa2c81f59bce8e16f3e166bf",
        }

    def test_exact_git_blob_recovers_the_retained_input_hash_and_policy(self):
        raw = self.source()
        restored = consumer.restore_retained_reviews(raw, self.expected())
        self.assertEqual(len(raw), 879)
        self.assertEqual(restored.count(b"\r\n"), 25)
        self.assertEqual(len(restored), 904)
        self.assertEqual(hashlib.sha256(restored).hexdigest(), self.expected()["sha256"])
        self.assertEqual(json.loads(raw), json.loads(restored))

    def test_changed_source_or_wrong_line_ending_form_is_rejected(self):
        raw = self.source()
        for changed in (raw + b" ", raw.replace(b"titles", b"titlez"), raw.replace(b"\n", b"\r\n")):
            with (
                self.subTest(length=len(changed)),
                self.assertRaisesRegex(ValueError, "REVIEW_SOURCE_CHANGED"),
            ):
                consumer.restore_retained_reviews(changed, self.expected())

    def test_changed_retained_pin_is_rejected(self):
        for expected in (
            {**self.expected(), "bytes": 903},
            {**self.expected(), "sha256": "0" * 64},
        ):
            with (
                self.subTest(expected=expected),
                self.assertRaisesRegex(ValueError, "RETAINED_REVIEWS_CHANGED"),
            ):
                consumer.restore_retained_reviews(self.source(), expected)


if __name__ == "__main__":
    unittest.main()
