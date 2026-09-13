"""Refresh only public chart/song metadata at an explicit Tachi commit."""

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path
from urllib.request import urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--ref", required=True)
args = parser.parse_args()
if not re.fullmatch(r"[a-f0-9]{40}", args.ref):
    parser.error("--ref must be a full public source commit")
result, sources = {}, {}
for kind in ("charts", "songs"):
    url = f"https://raw.githubusercontent.com/zkldi/Tachi/{args.ref}/db/seeds/{kind}-maimaidx.json"
    with urlopen(url, timeout=30) as response:  # noqa: S310 -- fixed public HTTPS origin
        raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("Public metadata exceeds limit")
    rows = json.loads(raw)
    if not isinstance(rows, list):
        raise ValueError("Expected public metadata collection")
    fields = (
        ("chartID", "songID", "difficulty", "level", "levelNum", "versions")
        if kind == "charts"
        else ("id", "title", "artist")
    )
    if kind == "charts":
        rows = [{**row, "chartID": row.get("chartID", row.get("id"))} for row in rows]
    result[kind] = [
        {
            **{k: row[k] for k in fields},
            **(
                {
                    "data": {"displayVersion": row.get("data", {}).get("displayVersion", "")},
                    "legacyChartID": row.get("legacyChartID"),
                }
                if kind == "charts"
                else {}
            ),
        }
        for row in rows
    ]
    sources[kind] = {"url": url, "sha256": hashlib.sha256(raw).hexdigest(), "count": len(rows)}
root = Path(__file__).resolve().parents[1] / "src/maimai_intelligence/assets"
packed = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
(root / "provider-registry.json.gz").write_bytes(gzip.compress(packed, mtime=0))
(root / "provider-registry-source.json").write_text(
    json.dumps(
        {
            "provider": "kamaitachi",
            "game": "maimaidx",
            "ref": args.ref,
            "sources": sources,
            "registry_sha256": hashlib.sha256(packed).hexdigest(),
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
print(f"Retained public metadata: {len(result['charts'])} charts, {len(result['songs'])} songs")
