"""Capture optional public metadata providers once each; failures never erase accepted fields."""

import argparse
import hashlib
import json
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from maimai_intelligence.mai_notes import NoRedirect
from maimai_intelligence.metadata_waterfall import MAX_BYTES, parse
from maimai_intelligence.snapshots import atomic_json

URLS = {
    "arcade-songs": "https://dp4p6x0xfi5o9.cloudfront.net/maimai/data.json",
    "otoge-db": "https://raw.githubusercontent.com/zvuc/otoge-db/main/maimai/data/music-ex.json",
}


def capture(output):
    root = Path(output)
    if root.exists() and any(root.iterdir()):
        raise ValueError("Use a fresh capture directory")
    root.mkdir(parents=True, exist_ok=True)
    result = {"sources": [], "failures": []}
    for provider, url in URLS.items():
        try:
            request = urllib.request.Request(  # noqa: S310 -- fixed public HTTPS URLs.
                url, headers={"User-Agent": "maimai.party-metadata/1", "Accept": "application/json"}
            )
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=25) as response:
                raw = response.read(MAX_BYTES + 1)
            parse(raw, provider)
        except (OSError, ValueError, KeyError, TypeError) as error:
            result["failures"].append({"provider": provider, "reason": str(error)})
            continue
        name = provider + ".json"
        (root / name).write_bytes(raw)
        meta = provider + "-metadata.json"
        atomic_json(
            root / meta,
            {
                "url": url,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "bytes": len(raw),
                "captured_at": datetime.now(UTC).isoformat(),
            },
        )
        result["sources"].append({"provider": provider, "raw": name, "metadata": meta})
    atomic_json(root / "captures.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(json.dumps(capture(parser.parse_args().output)))


if __name__ == "__main__":
    main()
