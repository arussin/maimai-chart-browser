"""Lossless JSON wire dictionaries; no chart inference or personal-data boundary.

Objects share key schemas; repeated strings and identical list/object records
have dictionary entries. This is structural encoding, not gzip renamed as raw.
Decode before the consumer's existing public-catalog allowlist validation.
"""

from __future__ import annotations

import json
import math

WIRE_VERSION = "maimai-dictionary-1"
MAX_WIRE_BYTES = 32 * 1024 * 1024
MAX_STRINGS = 1_000_000
MAX_NODES = 1_000_000
MAX_SCHEMAS = 100_000
MAX_ITEMS = 100_000
MAX_DEPTH = 64
MAX_EXPANDED_NODES = 10_000_000
MAX_EXPANDED_BYTES = 256 * 1024 * 1024
FORBIDDEN_KEYS = frozenset({"__proto__", "constructor", "prototype"})
_FIELDS = {"wire_version", "strings", "schemas", "nodes", "root"}


def _bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def encode_pack(pack: dict) -> dict:
    """Encode one JSON object deterministically, preserving null versus absent keys."""
    if not isinstance(pack, dict) or "wire_version" in pack:
        raise ValueError("Encode requires a decoded catalog object")
    strings, schemas, nodes = [], [], []
    string_ids, schema_ids, node_ids = {}, {}, {}
    object_ids = {}

    def string_id(value):
        if value not in string_ids:
            if len(strings) >= MAX_STRINGS:
                raise ValueError("Wire string limit exceeded")
            string_ids[value] = len(strings)
            strings.append(value)
        return string_ids[value]

    def atom(value, depth=0):
        if depth > MAX_DEPTH:
            raise ValueError("Wire nesting limit exceeded")
        if value is None or type(value) is bool:
            return value
        if type(value) in {int, float}:
            if abs(value) > 2**53 - 1 or not math.isfinite(value):
                raise ValueError("Wire numbers must be finite and safe for browser JSON")
            return value
        if isinstance(value, str):
            return [-1, string_id(value)]
        if isinstance(value, (list, dict)) and id(value) in object_ids:
            return object_ids[id(value)]
        if isinstance(value, list):
            if len(value) > MAX_ITEMS:
                raise ValueError("Wire list limit exceeded")
            record = [-1, *(atom(item, depth + 1) for item in value)]
        elif isinstance(value, dict):
            if len(value) > MAX_ITEMS or any(
                not isinstance(key, str) or key in FORBIDDEN_KEYS for key in value
            ):
                raise ValueError("Invalid wire object keys")
            keys = tuple(sorted(value))
            if keys not in schema_ids:
                if len(schemas) >= MAX_SCHEMAS:
                    raise ValueError("Wire schema limit exceeded")
                schema_ids[keys] = len(schemas)
                schemas.append([string_id(key) for key in keys])
            record = [schema_ids[keys], *(atom(value[key], depth + 1) for key in keys)]
        else:
            raise ValueError("Wire input must contain JSON values")
        signature = _bytes(record)
        if signature not in node_ids:
            if len(nodes) >= MAX_NODES:
                raise ValueError("Wire record limit exceeded")
            node_ids[signature] = len(nodes)
            nodes.append(record)
        result = [-2, node_ids[signature]]
        object_ids[id(value)] = result
        return result

    root = atom(pack)
    wire = {
        "wire_version": WIRE_VERSION,
        "strings": strings,
        "schemas": schemas,
        "nodes": nodes,
        "root": root,
    }
    _validate(wire)
    return wire


def _validate(wire):
    if not isinstance(wire, dict) or set(wire) != _FIELDS or wire["wire_version"] != WIRE_VERSION:
        raise ValueError("Unsupported wire format or fields")
    try:
        if len(_bytes(wire)) > MAX_WIRE_BYTES:
            raise ValueError("Wire input exceeds 32 MiB")
    except (TypeError, OverflowError, RecursionError) as exc:
        raise ValueError("Invalid wire JSON") from exc
    strings, schemas, nodes = wire["strings"], wire["schemas"], wire["nodes"]
    for value, maximum in ((strings, MAX_STRINGS), (schemas, MAX_SCHEMAS), (nodes, MAX_NODES)):
        if not isinstance(value, list) or len(value) > maximum:
            raise ValueError("Wire table limit exceeded")
    if any(not isinstance(value, str) for value in strings):
        raise ValueError("Invalid wire string table")
    if len(set(strings)) != len(strings):
        raise ValueError("Duplicate wire string entry")
    string_sizes = [len(_bytes(value)) for value in strings]
    key_schemas = []
    for schema in schemas:
        if (
            not isinstance(schema, list)
            or len(schema) > MAX_ITEMS
            or any(type(index) is not int or not 0 <= index < len(strings) for index in schema)
        ):
            raise ValueError("Invalid wire schema")
        keys = [strings[index] for index in schema]
        if len(set(keys)) != len(keys) or FORBIDDEN_KEYS.intersection(keys):
            raise ValueError("Unsafe or duplicate wire object key")
        key_schemas.append(keys)
    costs = []

    def cost(value, before):
        if value is None or type(value) is bool:
            return (1, 5, 0)
        if type(value) in {int, float}:
            if abs(value) > 2**53 - 1 or not math.isfinite(value):
                raise ValueError("Invalid wire number")
            return (1, len(_bytes(value)), 0)
        if not isinstance(value, list) or len(value) != 2 or any(type(v) is not int for v in value):
            raise ValueError("Invalid wire atom")
        tag, index = value
        if tag == -1 and 0 <= index < len(strings):
            return (1, string_sizes[index], 0)
        if tag == -2 and 0 <= index < before:
            return costs[index]
        raise ValueError("Invalid or forward wire reference")

    for index, record in enumerate(nodes):
        if not isinstance(record, list) or not 1 <= len(record) <= MAX_ITEMS + 1:
            raise ValueError("Invalid wire record")
        schema_id = record[0]
        if type(schema_id) is not int or not -1 <= schema_id < len(schemas):
            raise ValueError("Invalid wire record schema")
        if schema_id >= 0 and len(record) != len(schemas[schema_id]) + 1:
            raise ValueError("Wire schema arity mismatch")
        child_costs = [cost(value, index) for value in record[1:]]
        count = 1 + sum(c[0] for c in child_costs)
        size = 2 + sum(c[1] + 1 for c in child_costs)
        if schema_id >= 0:
            size += sum(string_sizes[key] + 1 for key in schemas[schema_id])
        depth = 1 + max((c[2] for c in child_costs), default=0)
        if count > MAX_EXPANDED_NODES or size > MAX_EXPANDED_BYTES or depth > MAX_DEPTH:
            raise ValueError("Wire expansion budget exceeded")
        costs.append((count, size, depth))
    cost(wire["root"], len(nodes))
    root = wire["root"]
    if not isinstance(root, list) or root[0] != -2 or nodes[root[1]][0] < 0:
        raise ValueError("Wire root must be an object record")
    return key_schemas


def decode_pack(value: dict) -> dict:
    """Decode bounded wire or pass a legacy dict to the next validation boundary.

    Shared records expand to independent containers. The public catalog's strict
    schema remains the consumer's responsibility; this codec permits JSON only.
    The browser decoder instead preserves deeply frozen shared records for
    efficiency. Browser consumers must explicitly clone before making edits.
    """
    if not isinstance(value, dict):
        raise ValueError("Catalog input must be an object")
    if "wire_version" not in value:
        return value
    key_schemas = _validate(value)

    def expand(atom):
        if not isinstance(atom, list):
            return atom
        tag, index = atom
        if tag == -1:
            return value["strings"][index]
        record = value["nodes"][index]
        if record[0] == -1:
            return [expand(child) for child in record[1:]]
        return {
            key: expand(child)
            for key, child in zip(key_schemas[record[0]], record[1:], strict=True)
        }

    return expand(value["root"])
