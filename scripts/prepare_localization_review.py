"""Export a review snapshot without changing translations, aliases or review status."""

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from maimai_intelligence.localization import messages

ASSETS = Path(__file__).resolve().parents[1] / "src/maimai_intelligence/assets"
FEATURES = {
    "support": "Support and payment returns",
    "messages": "Navigation and catalog controls",
    "errors": "Errors and recovery",
    "privacy": "Privacy and analytics",
    "share": "Site sharing",
    "patterns": "Pattern names and controls",
    "pattern-aliases": "Pattern aliases and diagrams",
    "lessons": "Pattern lessons",
    "analysis": "Chart analysis and comparison",
    "player": "Player data",
    "player-sources": "Player import sources",
    "player-maishift": "Maishift public profiles",
    "composed": "Combined labels and sorting",
    "remaining": "Other controls",
    "about": "About and credits",
    "maishift-pilot": "Opt-in Maishift pilot",
}


def fingerprint(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def review_snapshot():
    catalog = messages()  # Validate locale coverage and placeholders first.
    ui = []
    for feature, label in FEATURES.items():
        path = ASSETS / "locales" / f"{feature}.json"
        for english, translations in json.loads(path.read_text("utf-8"))["messages"].items():
            ui.append(
                {
                    "review_id": "ui:" + fingerprint(english)[:20],
                    "feature": label,
                    "source_file": "locales/" + path.name,
                    "english": english,
                    "translations": {k: translations[k] for k in ("ko", "zh-Hans", "ja")},
                    "placeholders": sorted(set(re.findall(r"\{\d+\}", english))),
                    "source_sha256": fingerprint(translations),
                }
            )
    if len(ui) != len(catalog) or len({r["english"] for r in ui}) != len(catalog):
        raise ValueError("Review export needs a feature label for every translation catalog")

    artifact = json.loads((ASSETS / "song-localizations.json").read_text("utf-8"))
    overrides = json.loads((ASSETS / "song-pronunciations.json").read_text("utf-8"))
    aliases = []
    for queued in artifact["coverage"]["review_queue"]:
        sid = queued["song_id"]
        song = artifact["songs"][sid]
        by_locale = {
            locale: [a["value"] for a in song["aliases"] if a["locale"] == locale]
            for locale in ("ko", "zh-Hans", "zh-Latn", "ja", "en")
        }
        reasons = []
        if queued["missing"]:
            reasons.append("Missing search language: " + ", ".join(queued["missing"]))
        if queued["unresolved"]:
            reasons.append("Unresolved words: " + ", ".join(queued["unresolved"]))
        if any(re.search(r"[\u3400-\u9fffぁ-ヿ]", s) for s in by_locale["ko"]):
            reasons.append("A Korean alias retains Japanese or Han characters")
        if any(re.search(r"[A-Za-z]", s) for s in by_locale["ko"]):
            reasons.append("A Korean alias retains Latin letters")
        priority = "First" if reasons else "Next"
        if song["reading_basis"] == "approximate-sort-key":
            reasons.append("Reading comes from a sort key; verify voicing and pronunciation")
        reasons.append(
            "Machine-assisted draft; confirm terms that players actually search"
            if queued["review_status"] == "machine-assisted-draft"
            else "Confirm pronunciation and terms that players actually search"
        )
        aliases.append(
            {
                "song_id": sid,
                "title": song["title"],
                "artist": song["artist"],
                "priority": priority,
                "reason": "; ".join(reasons),
                "aliases": by_locale,
                "reading_basis": song["reading_basis"],
                "reading": overrides["songs"].get(sid, {}).get("reading", ""),
                "source_status": queued["review_status"],
                "provenance": song["aliases"],
                "source_sha256": fingerprint(song),
            }
        )
    aliases.sort(key=lambda r: (r["priority"] != "First", r["title"].casefold(), r["song_id"]))
    payload = {
        "schema_version": "localization-review-1",
        "ui": ui,
        "aliases": aliases,
        "counts": {
            "ui_phrases": len(ui),
            "support_phrases": sum(r["source_file"] == "locales/support.json" for r in ui),
            "catalog_songs": len(artifact["songs"]),
            "queued_songs": len(aliases),
            "priority": dict(Counter(r["priority"] for r in aliases)),
        },
    }
    payload["snapshot_sha256"] = fingerprint(payload)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    snapshot = review_snapshot()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite returned reviewer work or a previous source snapshot.
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(snapshot, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps(snapshot["counts"]))


if __name__ == "__main__":
    main()
