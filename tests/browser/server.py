"""Quiet, bounded localhost fixture server for concurrent browser checks."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    request_queue_size = 64


Server(
    ("127.0.0.1", 8766),
    partial(Handler, directory=str(Path(__file__).resolve().parents[2] / "output/browser-tests")),
).serve_forever()
