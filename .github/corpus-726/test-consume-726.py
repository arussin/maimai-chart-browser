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
        self.assertEqual(progress, {"total": 100, "scheduled": 4, "completed_observed": 0})
        self.assertLessEqual(download.call_count, 4)

    def test_completed_batch_reports_only_counts(self):
        progress = {}
        output = io.StringIO()
        with mock.patch.object(consumer, "download"), contextlib.redirect_stdout(output):
            consumer.acquire_tasks([(URL, None, EXPECTED, "pages")] * 501, progress)
        self.assertEqual(progress, {"total": 501, "scheduled": 501, "completed_observed": 501})
        report = json.loads(output.getvalue())
        self.assertEqual(report["completed_observed"], 500)
        self.assertEqual(set(report), {"status", "total", "scheduled", "completed_observed"})


if __name__ == "__main__":
    unittest.main()
