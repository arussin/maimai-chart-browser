"""Audit a prepared community-pattern package against its accepted baseline."""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from maimai_analyzer.pattern_community import DEFINITIONS
from maimai_intelligence.overview_codec import expand_tags
from maimai_intelligence.research_package import read_package


def audit(baseline, candidate):
    _, before_files = read_package(baseline)
    _, after_files = read_package(candidate)
    reencoded = []
    for name, raw in before_files.items():
        if name != "analysis.json" and after_files.get(name) != raw:
            if name not in after_files or json.loads(after_files[name]) != json.loads(raw):
                raise ValueError(f"Retained public input changed: {name}")
            reencoded.append(name)
    before, after = [json.loads(files["analysis.json"]) for files in (before_files, after_files)]
    if before["charts"].keys() != after["charts"].keys():
        raise ValueError("Exact chart membership changed")
    counts = {p: Counter() for p in DEFINITIONS}
    changed = Counter()
    retained_results = 0
    for cid, record in after["charts"].items():
        previous = before["charts"][cid]
        for key in ("source_hash", "span", "basis", "segments"):
            if previous[key] != record[key]:
                raise ValueError(f"Existing chart identity or Flow changed: {cid} / {key}")
        rows = [
            dict(
                zip(
                    value["patterns"],
                    expand_tags(row, len(value["patterns"]), value.get("evidence_pool")),
                    strict=True,
                )
            )
            for value, row in ((before, previous), (after, record))
        ]
        for pattern, old in rows[0].items():
            new = rows[1][pattern]
            if old[1:] != new[1:]:
                changed[pattern] += 1
            retained_results += old[2] or 0
        for pattern in counts:
            row = rows[1][pattern]
            counts[pattern][row[1]] += 1
            counts[pattern]["occurrences"] += row[2] or 0
    if changed.keys() - {"trait.isolated_pattern_sections"}:
        raise ValueError(f"An original recognition result changed: {dict(changed)}")
    return {
        "version": "community-pattern-audit-1",
        "baseline_package_sha256": hashlib.sha256(
            (Path(baseline) / "package.json").read_bytes()
        ).hexdigest(),
        "candidate_package_sha256": hashlib.sha256(
            (Path(candidate) / "package.json").read_bytes()
        ).hexdigest(),
        "charts": len(after["charts"]),
        "detector_version": after["detector_version"],
        "patterns_and_traits": len(after["patterns"]),
        "retained_public_values_unchanged": sorted(before_files.keys() - {"analysis.json"}),
        "json_encoding_only_changes": reencoded,
        "flow_unchanged": True,
        "baseline_occurrences": retained_results,
        "changed_baseline_tags": dict(changed),
        "change_note": "Isolated sections can now name added target patterns.",
        "new_patterns": {p: dict(c) for p, c in counts.items()},
        "qualification": "Experimental discovery; not independent precision or recall.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline")
    parser.add_argument("candidate")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.baseline, args.candidate)
    args.output.write_text(json.dumps(report, indent=2) + "\n", "utf-8")
    print(json.dumps(report))
