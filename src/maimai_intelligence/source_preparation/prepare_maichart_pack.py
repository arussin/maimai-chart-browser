"""Hermetic, lossless difficulty extraction from one captured Maichart-Converts pack.

Preserves every raw container and exact body byte range. Metadata never supplies
missing timing or official constants. Utage and ambiguous identities stay in the
audit without being relabeled as regular charts. No other source is consulted.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from maimai_analyzer.contracts import canonical_bytes
from maimai_analyzer.simai_subset import INOTE_DIFFICULTIES
from maimai_intelligence.io import atomic_write_text

from .acquire_maichart_pack import (
    MAX_FILE_BYTES,
    REPOSITORY,
    git_blob_hash,
    selected_entries,
    sha256,
    write_json,
)
from .inputs import SOURCE_KIND, _relative

VERSION = "maichart-container-1"
FIELD = re.compile(rb"(?m)^&([A-Za-z][A-Za-z0-9_]*)=")


def split_container(data):
    """Return field values and exact byte ranges; never join different inote slots."""
    if not isinstance(data, bytes) or len(data) > MAX_FILE_BYTES:
        raise ValueError("Container exceeds the UTF-8 text byte budget")
    data.decode("utf-8-sig")
    bom = 3 if data.startswith(b"\xef\xbb\xbf") else 0
    matches = list(FIELD.finditer(data[bom:]))
    if not matches or len(matches) > 256 or data[bom : bom + matches[0].start()].strip():
        raise ValueError("Container needs bounded line-start metadata fields")
    fields = {}
    for i, match in enumerate(matches):
        name = match[1].decode("ascii")
        if name in fields and name != "fixedoption":
            raise ValueError("Repeated container field: " + name)
        if name.startswith("inote") and re.fullmatch(r"inote_[1-9][0-9]?", name) is None:
            raise ValueError("Unsupported difficulty field: " + name)
        end = bom + matches[i + 1].start() if i + 1 < len(matches) else len(data)
        start = bom + match.end()
        value = data[start:end]
        if name.startswith("inote_"):
            if re.search(rb"(?m)^\s*&", value):
                raise ValueError("Malformed embedded container header")
        elif len(value) > 16_384:
            raise ValueError("Metadata field exceeds the text budget")
        field = {"start": start, "end": end, "value": value.decode("utf-8")}
        if name in fields:
            fields[name].setdefault("repeated_values", []).append(field)
        else:
            fields[name] = field
    if not any(name.startswith("inote_") for name in fields):
        raise ValueError("Container has no explicit inote slots")
    return fields


def _value(fields, name):
    return fields.get(name, {}).get("value", "").strip()


def _verify_file(root, item):
    if item["file"] != "raw/" + item["path"]:
        raise ValueError("Captured file must remain at its declared raw source path")
    path = _relative(root, item["file"])
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("Captured source exceeds byte limit")
    data = path.read_bytes()
    if (
        len(data) != item["bytes"]
        or sha256(data) != item["sha256"]
        or git_blob_hash(data) != item["git_blob_sha"]
    ):
        raise ValueError("Captured source failed byte verification: " + item["path"])
    return data


def prepare(root: Path | str) -> dict[str, Any]:
    root = Path(root).resolve()
    capture_bytes = _relative(root, "capture.json").read_bytes()
    capture = json.loads(capture_bytes)
    if (
        capture.get("schema_version") != "maichart-capture-1"
        or capture.get("repository") != REPOSITORY
        or capture.get("status") != "complete"
        or re.fullmatch(r"[0-9a-f]{40}", capture.get("revision", "")) is None
    ):
        raise ValueError("Preparation requires a complete, explicitly pinned capture")
    tree_bytes = _relative(root, "source-tree.json").read_bytes()
    if sha256(tree_bytes) != capture["tree_sha256"]:
        raise ValueError("Source tree hash changed")
    tree = selected_entries(json.loads(tree_bytes))
    files = capture["files"]
    expected = {(x["path"], x["sha"], x["size"]) for x in tree}
    actual = {(x["path"], x["git_blob_sha"], x["bytes"]) for x in files}
    if expected != actual or len(files) != len(expected):
        raise ValueError("Capture inventory does not exactly match its pinned source tree")
    payloads = {item["path"]: _verify_file(root, item) for item in files}
    index = json.loads(payloads["index.json"])
    if not isinstance(index, dict) or any(
        not re.fullmatch(r"[0-9]+", key) or not isinstance(value, str) or len(value) > 512
        for key, value in index.items()
    ):
        raise ValueError("Invalid source title index")
    index_item = next(x for x in files if x["path"] == "index.json")
    rows, containers, empty_slots, errors = [], [], [], []
    for item in files:
        if not item["path"].endswith("/maidata.txt"):
            continue
        data = payloads[item["path"]]
        folder = item["path"].split("/")[-2]
        id_match = re.match(r"([0-9]+)_", folder)
        source_id = id_match[1] if id_match else "unresolved"
        locator = sha256(item["path"].encode())[:20]
        common = {
            "source_song_id": f"maichart:{source_id}",
            "title": index.get(source_id, folder),
            "source_raw_file": item["file"],
            "source_raw_sha256": item["sha256"],
            "source_index_file": index_item["file"],
            "source_index_sha256": index_item["sha256"],
            "source_url": f"https://github.com/{REPOSITORY}/blob/{capture['revision']}/{item['path']}",
            "source_container_id": source_id,
            "source_path": item["path"],
        }
        try:
            fields = split_container(data)
        except (ValueError, UnicodeError) as error:
            reason = "Container extraction rejected: " + str(error)
            errors.append({"path": item["path"], "reason": reason})
            rows.append(
                {
                    **common,
                    "input_id": f"maichart:{locator}:container",
                    "format": "unresolved",
                    "difficulty": "unresolved",
                    "identity_resolved": False,
                    "acquisition_status": "unavailable",
                    "reason": reason,
                }
            )
            continue
        cabinet = _value(fields, "cabinet")
        format_name = (
            "UTAGE"
            if item["path"].startswith("宴会場/")
            else {
                "SD": "STD",
                "DX": "DX",
            }.get(cabinet, "unresolved")
        )
        identity_ok = (
            source_id in index
            and _value(fields, "shortid") == source_id
            and format_name in {"STD", "DX"}
        )
        containers.append(
            {
                "path": item["path"],
                "sha256": item["sha256"],
                "source_container_id": source_id,
                "format": format_name,
                "fields": fields,
            }
        )
        # Slot presence comes from explicit inote or nonblank level, never six invented charts.
        slots = set(range(1, 7)) | {
            int(name.split("_")[1]) for name in fields if name.startswith("inote_")
        }
        for slot in sorted(slots):
            difficulty = INOTE_DIFFICULTIES[slot - 1] if slot <= 6 else f"SLOT_{slot}"
            field = fields.get(f"inote_{slot}")
            level = _value(fields, f"lv_{slot}")
            if field is None and not level:
                continue
            if field is not None and not field["value"].strip() and not level:
                empty_slots.append({"path": item["path"], "slot": slot})
                continue
            row = {
                **common,
                "input_id": f"maichart:{locator}:inote_{slot}",
                "format": format_name,
                "difficulty": difficulty,
                "slot": slot,
                "identity_resolved": identity_ok,
                "artist": _value(fields, "artist"),
                "source_level": level,
                "source_version": _value(fields, "version"),
                "acquisition_status": "unavailable",
                "reason": "Declared difficulty has no body",
            }
            # Source levels are labels, not independently verified official chart constants.
            if re.fullmatch(r"[0-9]{1,2}(?:\.[0-9])?", level):
                whole, _, decimal = level.partition(".")
                row["level"] = whole + ("+" if decimal and int(decimal) >= 7 else "")
            if field is not None and field["value"].strip():
                body = data[field["start"] : field["end"]]
                body_hash = sha256(body)
                body_file = f"bodies/{body_hash}.simai"
                body_path = _relative(root, body_file)
                if body_path.exists() and body_path.read_bytes() != body:
                    raise ValueError("Existing extracted body changed")
                if not body_path.exists():
                    atomic_write_text(body_path, body.decode("utf-8"))
                row.update(
                    body_file=body_file,
                    body_sha256=body_hash,
                    body_byte_start=field["start"],
                    body_byte_end=field["end"],
                    acquisition_status="available",
                    reason="extracted",
                )
            rows.append(row)

    grouped = defaultdict(list)
    for row in rows:
        grouped[(row["source_container_id"], row["format"], row["difficulty"])].append(row)
    retained, aliases, conflicts = [], [], []
    for group in grouped.values():
        group.sort(key=lambda row: row["source_path"])
        signatures = {
            (r.get("body_sha256"), r.get("source_level"), r.get("artist"), r["identity_resolved"])
            for r in group
        }
        if len(group) > 1 and len(signatures) == 1 and group[0].get("body_sha256"):
            retained.append(group[0])
            aliases.extend({"retained_input_id": group[0]["input_id"], **r} for r in group[1:])
        else:
            if len(group) > 1:
                for row in group:
                    row.update(
                        identity_resolved=False, reason="Conflicting files for source ID/difficulty"
                    )
                conflicts.extend(r["input_id"] for r in group)
            retained.extend(group)
    retained.sort(key=lambda row: row["input_id"])
    charts = b"".join(canonical_bytes(row) for row in retained)
    atomic_write_text(_relative(root, "charts.jsonl"), charts.decode("utf-8"))
    manifest = {
        "schema_version": "simai-corpus-manifest-1",
        "source_kind": SOURCE_KIND,
        "snapshot_id": f"{REPOSITORY}@{capture['revision']}",
        "preparer_version": VERSION,
        "charts_file": "charts.jsonl",
        "charts_sha256": sha256(charts),
        "capture_sha256": sha256(capture_bytes),
        "captured_containers": len(containers) + len(errors),
        "extracted_bodies": sum(r["acquisition_status"] == "available" for r in retained),
        "source_label": "Maichart-Converts dataset trial",
        "source_scope": (
            "Only the pinned pack; no wiki or synthetic chart inputs and no old analysis cache."
        ),
    }
    write_json(_relative(root, "manifest.json"), manifest)
    audit = {
        "version": VERSION,
        "revision": capture["revision"],
        "container_files": len(containers) + len(errors),
        "chart_rows": len(retained),
        "extracted_bodies": manifest["extracted_bodies"],
        "formats": dict(Counter(r["format"] for r in retained)),
        "empty_unadvertised_slots": empty_slots,
        "duplicate_body_aliases": aliases,
        "conflicting_rows": conflicts,
        "container_errors": errors,
        "metadata_policy": (
            "Raw fields retained; wholebpm/first never repair body timing; "
            "levels are unverified labels."
        ),
        "dataset_completeness": (
            "File inventory verified against pinned Git tree; game fidelity unverified."
        ),
    }
    write_json(_relative(root, "preparation-audit.json"), audit)
    write_json(_relative(root, "container-metadata.json"), containers)
    return audit


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    args = parser.parse_args(argv)
    result = prepare(args.source_dir)
    print(
        json.dumps(
            {
                key: result[key]
                for key in ("container_files", "chart_rows", "extracted_bodies", "formats")
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
