"""An authored teal square; no game artwork in fixtures."""

import base64
import hashlib
import json

from maimai_intelligence.artwork import VERSION
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts.build_challenge_package import write

IMAGE = base64.b64decode(
    "UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoEAAQAAUAmJaACdLoAA5gA/vAb3+SR6uY6D/6MP/ww//DD+8IAAA=="
)


def add_artwork(root):
    root = root.resolve()
    charts = json.loads((root / "catalog.json").read_text("utf-8"))
    for index, chart in enumerate(charts):
        chart["song_id"] = f"artwork-fixture-song-{index}"
    sha = hashlib.sha256(IMAGE).hexdigest()
    path = f"media/{sha}.webp"
    (root / "media").mkdir(exist_ok=True)
    (root / path).write_bytes(IMAGE)
    item = charts[0]
    art = {
        "version": VERSION,
        "assets": {path: {"bytes": len(IMAGE), "sha256": sha, "source": "authored-fixture"}},
        "songs": {
            item["song_id"]: {"title": item["title"], "artist": item["artist"], "path": path}
        },
        "versions": {"maimai DX PRiSM PLUS": path},
    }
    package = read_json(root / "package.json")
    package["files"] = [r for r in package["files"] if r["path"] != "catalog.json"]
    package["files"].append(write(root, "catalog.json", charts))
    package["files"].append(write(root, "artwork.json", art))
    atomic_json(root / "package.json", package)
    return art
