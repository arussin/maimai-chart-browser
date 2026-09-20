"""Detect localization changes made after the recorded language review.

This checks freshness, not fluency. Updating a fingerprint is not a review.
"""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def fingerprint(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def file_fingerprint(path):
    text = path.read_text("utf-8")
    # README text is newline-normalized by read_text for Windows/Linux parity.
    return fingerprint(json.loads(text) if path.suffix == ".json" else text)


def stale_inputs(root, reviewed):
    stale = []
    current = set(root.glob("src/maimai_intelligence/assets/locales/*.json"))
    current.add(root / "src/maimai_intelligence/assets/song-pronunciations.json")
    current.update(root.glob("README*.md"))
    expected = {root / name for name in reviewed}
    for path in sorted(current | expected):
        name = path.relative_to(root).as_posix()
        if not path.is_file() or name not in reviewed:
            stale.append(name)
        elif file_fingerprint(path) != reviewed[name]:
            stale.append(name)
    return stale


def main():
    record = json.loads((ROOT / "docs/localization-review/ai-review.json").read_text("utf-8"))
    stale = stale_inputs(ROOT, record["inputs"])
    if stale:
        raise SystemExit(
            "Language review is stale for:\n"
            + "\n".join(stale)
            + "\nReview changed copy/aliases using docs/LOCALIZATION_REVIEW.md, "
            "then record the actual review and fingerprints."
        )
    print("Language review fingerprints match; review method and scope remain in the record.")


if __name__ == "__main__":
    main()
