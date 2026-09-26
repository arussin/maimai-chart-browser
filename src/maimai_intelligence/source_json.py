"""Decode retained provider JSON with explicit input failures, not parser catch-alls."""

import json
from typing import Any

from .coverage_types import SnapshotError


def _integer(value: str) -> int:
    try:
        return int(value)
    except ValueError as error:
        raise SnapshotError("Source JSON integer exceeds the supported limit") from error


def decode_source_json(raw: bytes) -> Any:
    try:
        return json.loads(raw, parse_int=_integer)
    except (json.JSONDecodeError, UnicodeDecodeError, RecursionError) as error:
        raise SnapshotError("Malformed or excessively nested source JSON") from error
