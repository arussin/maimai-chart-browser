"""Authored research-package fixture; no corpus or account access."""

import hashlib
from pathlib import Path

from maimai_analyzer.catalog_navigation import build_navigation
from maimai_analyzer.challenge import profile_chart, snippet
from maimai_analyzer.challenge_similarity import POLICY, query_challenges, reference_scale
from maimai_analyzer.dataset import SOURCE_LOCK, review_benchmark
from maimai_analyzer.fixtures import synthetic_charts
from maimai_intelligence.research_overview import chart_overview, overview_package
from maimai_intelligence.snapshots import atomic_json, canonical


def write_package(directory, *, grouped=False, constants=False):
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    raw = synthetic_charts()
    profiles = [profile_chart(chart) for chart in raw]
    rows, bpms = [], {}
    for index, profile in enumerate(profiles):
        if index == 5:
            profile["difficulty"] = "RE:MASTER"
        profile.update(
            title=f"Fictional study {index}",
            artist="Authored fixture",
            level=str(10 + index // 3),
            input_id=f"synthetic:{index}",
            source_container_id=str(index),
        )
        container = 3 if grouped and index == 5 else index
        if grouped and index == 5:
            profile.update(title="Fictional study 3", source_container_id="3")
        source_hash = str(container) * 64
        bpms[source_hash] = [120, 120, 180, 160, 160, None][container]
        rows.append(
            {
                "input_id": profile["input_id"],
                "source_container_id": str(container),
                "source_raw_sha256": source_hash,
                "body_sha256": profile["source_hash"],
                "format": profile["format"],
                "difficulty": profile["difficulty"],
                "identity_resolved": True,
                "source_level": ["10.5", "10.4", "9.9", "11.0", None, "11.6"][index]
                if constants
                else profile["level"],
                "source_path": ("POPSアニメ" if index % 2 else "maimai")
                + f"/{container}/maidata.txt",
                "source_version": "maimai DX PRiSM PLUS" if index % 2 else "maimai DX",
            }
        )
    matches = query_challenges(profiles[0], profiles, reference_scale(profiles))
    values = {
        "catalog.json": profiles,
        "review.json": [{"query_id": profiles[0]["chart_id"], "candidates": matches}],
        "snippets.json": {
            c["chart_id"]: {w["window_id"]: snippet(c, w) for w in p["windows"]}
            for c, p in zip(raw, profiles, strict=True)
        },
        "benchmark.json": review_benchmark(profiles, 4),
        "navigation.json": build_navigation(profiles, rows, bpm_by_source=bpms),
        "source-inventory.json": rows,
        "analysis.json": overview_package({c["chart_id"]: chart_overview(c) for c in raw}),
    }
    records = []
    for name, value in values.items():
        data = canonical(value)
        (root / name).write_bytes(data)
        records.append(
            {"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        )
    atomic_json(
        root / "package.json",
        {
            "source": SOURCE_LOCK,
            "retrieval_policy": POLICY,
            "status": "research_preview",
            "files": records,
            "fixture": "Authored synthetic charts only",
        },
    )
    return root
