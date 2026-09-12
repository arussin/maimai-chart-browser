"""Synthetic browser capacity fixture: repeated authored profiles, never corpus data."""

import copy
import hashlib
import json
import shutil
from pathlib import Path

from maimai_intelligence.overview_codec import compact_overview


def build_capacity_fixture(root: Path, count: int = 7000):
    source, target = root / "lab", root / "capacity"
    manifest = json.loads((source / "manifest.json").read_text("utf-8"))
    entry = next(r for r in manifest["releases"] if r["version"] == manifest["default"])
    data = json.loads((source / entry["path"]).read_text("utf-8"))
    seeds = data["catalog"]
    records = data["analysis"]["charts"]
    navigation = data["navigation"]["charts"]
    charts, expanded, nav = [], {}, {}
    for index in range(count):
        seed = seeds[index % len(seeds)]
        cid, family = f"synthetic:capacity:{index}", f"synthetic:capacity-song:{index // 4}"
        chart = {
            **seed,
            "chart_id": cid,
            "song_id": family,
            "song_family": family,
            "source_container_id": family,
            "title": f"Capacity study {index // 4:04d}",
            "difficulty": ["BASIC", "ADVANCED", "EXPERT", "MASTER"][index % 4],
            "format": "STD",
            "windows": [],
        }
        charts.append(chart)
        expanded[cid] = copy.deepcopy(records[seed["chart_id"]])
        nav[cid] = {**navigation[seed["chart_id"]], "source_path": family}
    data.update(catalog=charts, review=[], snippets={})
    data["navigation"]["charts"] = nav
    data["analysis"]["charts"] = expanded
    data["analysis"] = compact_overview(data["analysis"])
    data["package"]["fixture"] = "7,000 repeated authored profiles; capacity only"
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()
    target.mkdir(parents=True, exist_ok=True)
    for name in [
        "index.html",
        "lab-loader.js",
        "challenge-review.js",
        "challenge-review.css",
        "analytics.js",
    ]:
        shutil.copyfile(source / name, target / name)
    (target / "catalogs").mkdir(exist_ok=True)
    path = f"catalogs/{digest}.json"
    (target / path).write_bytes(raw)
    (target / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0.0",
                "default": "capacity-v1",
                "releases": [{"version": "capacity-v1", "sha256": digest, "path": path}],
            }
        ),
        "utf-8",
    )
    return {"charts": count, "bytes": len(raw)}
