"""Deterministic public JSON encoding and bounds, without storage or transport."""

import hashlib
import json

MAX_BYTES = 32 * 1024 * 1024


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()
