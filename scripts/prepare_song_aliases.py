"""Reduce retained public Tachi song metadata into a reproducible search-only asset.

No network, score acquisition, chart mapping or analysis is performed here.
"""

import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path

from maimai_intelligence.snapshots import atomic_json


def identity(value):
    return " ".join(unicodedata.normalize("NFKC", value).lower().split())


def prepare(sources, revision):
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("A pinned Tachi commit is required")
    entries, provenance = {}, []
    for name, path in sources:
        raw = Path(path).read_bytes()
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError("Song metadata exceeds 16 MiB")
        records = json.loads(raw)
        if not isinstance(records, list):
            raise ValueError("Song metadata must be a list")
        for record in records:
            title, artist = record["title"], record["artist"]
            names = record["altTitles"] + record["searchTerms"]
            if not all(isinstance(x, str) and len(x) <= 2000 for x in [title, artist, *names]):
                raise ValueError("Invalid title or alias")
            if not title.strip() or not names:
                continue
            key = (identity(title), identity(artist))
            aliases = entries.setdefault(key, set())
            aliases.update(x.strip() for x in names if x.strip() and identity(x) != key[0])
        provenance.append(
            {
                "url": f"https://github.com/zkldi/Tachi/blob/{revision}/db/seeds/{name}",
                "sha256": hashlib.sha256(raw).hexdigest(),
                "records": len(records),
            }
        )
    return {
        "version": "song-aliases-1",
        "source": "Tachi community song metadata",
        "source_license": "Unlicense (Tachi README: seed data)",
        "revision": revision,
        "sources": provenance,
        "purpose": "Search aliases only; not chart mappings or game availability guarantees.",
        "entries": [[*key, sorted(names)] for key, names in sorted(entries.items()) if names],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dx", type=Path, required=True)
    parser.add_argument("--standard", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    value = prepare(
        [("songs-maimaidx.json", args.dx), ("songs-maimai.json", args.standard)], args.revision
    )
    atomic_json(args.output, value)
    print(f"Prepared aliases for {len(value['entries'])} title/artist pairs")
