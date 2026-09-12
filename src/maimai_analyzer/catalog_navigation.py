"""Display-only folders from the pinned pack; never report identities or availability."""

from __future__ import annotations

import re
from collections import Counter

VERSION = "challenge-navigation-1"
GENRES = (
    ("POPSアニメ", "POPS & ANIME"),
    ("niconicoボーカロイド", "niconico & VOCALOID"),
    ("東方Project", "Touhou Project"),
    ("ゲームバラエティ", "GAME & VARIETY"),
    ("maimai", "maimai"),
    ("オンゲキCHUNITHM", "ONGEKI & CHUNITHM"),
)
# Explicit series order, not alphabetical order or an inferred release date.
VERSIONS = (
    "maimai",
    "maimai PLUS",
    "maimai GreeN",
    "maimai GreeN PLUS",
    "maimai ORANGE",
    "maimai ORANGE PLUS",
    "maimai PiNK",
    "maimai PiNK PLUS",
    "maimai MURASAKi",
    "maimai MURASAKi PLUS",
    "maimai MiLK",
    "maimai MiLK PLUS",
    "maimai FiNALE",
    "maimai DX",
    "maimai DX PLUS",
    "maimai DX Splash",
    "maimai DX Splash PLUS",
    "maimai DX UNiVERSE",
    "maimai DX UNiVERSE PLUS",
    "maimai DX FESTiVAL",
    "maimai DX FESTiVAL PLUS",
    "maimai DX BUDDiES",
    "maimai DX BUDDiES PLUS",
    "maimai DX PRiSM",
    "maimai DX PRiSM PLUS",
    "maimai DX CiRCLE",
    "maimai DX CiRCLE PLUS",
)


def source_bpm(text):
    """Read the container's displayed tempo, not slide-duration tempo overrides.

    Missing, duplicate and malformed metadata stays unknown. This is the source
    song BPM, not a claim that every passage uses a constant tempo.
    """
    values = re.findall(r"^&wholebpm=([^\r\n]*)", text, re.M)
    if len(values) != 1 or not re.fullmatch(r"[0-9]{1,4}(?:\.[0-9]{1,6})?", values[0].strip()):
        return None
    value = float(values[0])
    return value if 1 <= value <= 2000 else None


def source_constant(value):
    """Retain an explicit decimal from the source, without deriving one from a label."""
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,2}(?:\.[0-9])?", value):
        return None
    number = float(value)
    return number if 0 < number <= 15 else None


def build_navigation(catalog, rows, *, bpm_by_source=None):
    """Join verified source-inventory rows by exact input and body, never title.

    Callers verify the package/source inventory hashes before calling this. The
    returned metadata is independent of demand profiles, scores and benchmark IDs.
    Unknown source folders and versions remain explicit and browseable.
    """
    source = {r["input_id"]: r for r in rows}
    if len(source) != len(rows):
        raise ValueError("Duplicate navigation source identity")
    charts = {}
    for chart in catalog:
        row = source.get(chart.get("input_id"))
        if (
            row is None
            or chart["chart_id"] in charts
            or chart["source_hash"] != row.get("body_sha256")
            or any(chart.get(k) != row.get(k) for k in ("format", "difficulty"))
            or chart.get("source_container_id") != row.get("source_container_id")
            or chart.get("format") not in {"STD", "DX"}
            or not row.get("identity_resolved")
        ):
            raise ValueError("Navigation requires an exact ordinary source-chart mapping")
        path = row.get("source_path", "")
        folder = path.split("/")[0]
        genre = folder if folder in dict(GENRES) else "unknown"
        charts[chart["chart_id"]] = {
            "genre": genre,
            "version": row.get("source_version") or "unknown",
            "source_path": path,
            "source_hash": chart["source_hash"],
            "bpm": (bpm_by_source or {}).get(row.get("source_raw_sha256")),
            "chart_constant": source_constant(row.get("source_level")),
        }
    present = {c["version"] for c in charts.values()}
    ordered = [v for v in reversed(VERSIONS) if v in present]
    ordered += sorted(present - set(VERSIONS) - {"unknown"})
    if "unknown" in present:
        ordered.append("unknown")
    return {
        "version": VERSION,
        "genres": [{"id": key, "label": label} for key, label in GENRES],
        "versions": ordered,
        "charts": charts,
        "coverage": {
            "charts": len(charts),
            "genres": dict(sorted(Counter(c["genre"] for c in charts.values()).items())),
            "versions": dict(sorted(Counter(c["version"] for c in charts.values()).items())),
        },
        "basis": (
            "Pinned pack genre folders and container version/wholebpm fields; display metadata only"
        ),
        "constant_basis": (
            "Decimal lv fields from the pinned source pack, joined by exact source chart and body. "
            "Values reflect that source revision; not independently verified current game "
            "constants or qualified personal rating inputs."
        ),
    }
