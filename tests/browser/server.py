"""Quiet, bounded localhost fixture server for concurrent browser checks."""

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    # Windows MIME registration differs across machines. Match the pilot's
    # explicit types rather than relying on registry entries for these assets.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".webp": "image/webp"}

    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    request_queue_size = 64


Server(
    ("127.0.0.1", int(os.environ.get("MAIMAI_TEST_PORT", "8766"))),
    partial(
        Handler,
        directory=str(
            Path(
                os.environ.get(
                    "MAIMAI_BROWSER_OUTPUT",
                    str(Path(__file__).resolve().parents[2] / "output/browser-tests"),
                )
            ).resolve()
        ),
    ),
).serve_forever()
