# ruff: noqa: E501 -- Long lines retain readable review statements.
"""Write an official-reconciliation-1 review that admits the new official songs.

    python -B write_reconciliation_review.py PROPOSALS.json CAPTURE_FOLDER OUTPUT.json

Only identities the tool marked ``needs_review`` with no candidate match are
admitted, each with the official record it was observed in. Anything else that
needs review (a possible match to an existing song) stops the script: that is a
judgement for a person, not for this helper.
"""

import hashlib
import json
import sys
from datetime import UTC, datetime

proposals_path, capture, output = sys.argv[1], sys.argv[2], sys.argv[3]
with open(proposals_path, encoding="utf-8") as stream:
    proposals = json.load(stream)
files = {"JP": "sega-jp.json", "INTL": "sega-intl.json"}
today = datetime.now(UTC).date().isoformat()
review = {
    "schema_version": "official-reconciliation-1",
    "review": today
    + " catalog refresh. Admits official songs first listed since the previous accepted "
    "capture. No merges, no links to existing identities, no transcription acquisition.",
    "song_merges": [],
    "regions": {},
}
for region, name in files.items():
    with open(capture + "\\" + name, "rb") as stream:
        raw = stream.read()
    official = json.loads(raw)
    by_identity = {}
    for entry in official:
        by_identity.setdefault((entry.get("title"), entry.get("artist")), entry)
    decisions = {}
    for item in proposals[region]:
        if item["decision"] == "retained":
            continue
        if (
            item["decision"] != "needs_review"
            or item.get("candidates")
            or item.get("accepted_song_id")
        ):
            raise SystemExit(
                "Needs a person's judgement: " + json.dumps(item["metadata"], ensure_ascii=False)
            )
        meta = item["metadata"]
        record = by_identity.get((meta.get("title"), meta.get("artist")))
        if record is None:
            raise SystemExit(
                "Proposal is not in the official capture: " + json.dumps(meta, ensure_ascii=False)
            )
        decisions[item["key"]] = {
            "action": "admit",
            "evidence": {
                "review": f"New official {region} entry; no existing registry song has this normalized title and artist "
                "(the reconciliation proposal lists no candidate). Admitted as a new song identity.",
                "official_title": meta.get("title"),
                "official_artist": meta.get("artist"),
                "official_version": meta.get("version"),
                "official_release": str(record.get("release", "")),
                "slots": [
                    "{} {} {}".format(slot["format"], slot["difficulty"], slot["level"])
                    for slot in item["slots"]
                ],
                "capture_sha256": hashlib.sha256(raw).hexdigest(),
                "reviewed_on": today,
            },
        }
    review["regions"][region] = {
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "counts": {
            "new_song": len(decisions),
            "retained": sum(1 for item in proposals[region] if item["decision"] == "retained"),
        },
        "decisions": decisions,
    }
with open(output, "x", encoding="utf-8") as stream:
    json.dump(review, stream, ensure_ascii=False, indent=2)
    stream.write("\n")
print(json.dumps({region: body["counts"] for region, body in review["regions"].items()}))
