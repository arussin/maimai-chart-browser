"""Offline evaluation of explicit, locally captured public-transcription inputs.

No acquisition, account data, production catalog or recommendation generation.
Raw source text is deliberately not bundled with this script or copied to HTML.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import sys
from importlib.resources import files
from pathlib import Path

from maimai_analyzer import analyze, canonical_bytes, pattern_registry, validate_profile
from maimai_analyzer.simai_subset import parse_simai_subset
from maimai_intelligence.transcription_counts import COUNT_CONVENTION as COUNT_CONVENTION
from maimai_intelligence.transcription_counts import audited_paths as audited_paths
from maimai_intelligence.transcription_counts import count_comparison as count_comparison
from maimai_intelligence.transcription_counts import note_counts as note_counts


def bounded_file(root: Path, name: str, limit: int = 2_000_000) -> bytes:
    if not isinstance(name, str) or Path(name).name != name:
        raise ValueError("Evaluation inputs must be named files beside the manifest")
    path = (root / name).resolve()
    if path.parent != root.resolve():
        raise ValueError("Evaluation input escapes its explicit source directory")
    with path.open("rb") as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise ValueError("Evaluation input exceeds its byte budget")
    return value


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def check_rubric(raw: dict, rubric: dict) -> list[dict]:
    result = []
    for expected in rubric["first_chorus_onsets"]:
        instant = round(expected["time_s"] * 1_000_000)
        actual = sorted(
            ((e["position"], e["role"]) for e in raw["onsets"] if e["time_us"] == instant),
            key=lambda item: (str(item[0]), item[1]),
        )
        wanted = sorted(
            ((e["position"], e["role"]) for e in expected["onsets"]),
            key=lambda item: (str(item[0]), item[1]),
        )
        result.append(
            {
                "time_s": expected["time_s"],
                "expected": wanted,
                "actual": actual,
                "pass": actual == wanted,
            }
        )
    return result


def check_slide_rubric(raw: dict, audit: dict, rubric: dict) -> list[dict]:
    parsed = []
    entries = audited_paths(raw, audit)
    if entries is None:
        return [
            {
                "expected": expected,
                "actual": [],
                "pass": False,
                "evidence_error": "Slide rubric requires a consistent audit for every path",
            }
            for expected in rubric["first_chorus_slides"]
        ]
    for token, detail, path in entries:
        parsed.append(
            {
                "head_position": token["start_position"],
                "end_position": detail["end_position"],
                "shape": detail["path_shape"],
                "head_s": path["wait_start_us"] / 1e6,
                "movement_start_s": path["movement_start_us"] / 1e6,
                "movement_end_s": path["movement_end_us"] / 1e6,
            }
        )
    return [
        {
            "expected": expected,
            "actual": [
                p
                for p in parsed
                if p["head_s"] == expected["head_s"]
                and p["head_position"] == expected["head_position"]
            ],
            "pass": parsed.count(expected) == 1,
        }
        for expected in rubric["first_chorus_slides"]
    ]


def report_html(result: dict) -> str:
    """Render escaped measurements through the local, self-contained pilot template."""
    from string import Template

    def esc(value):
        return html.escape(str(value), quote=True)

    def number(value, suffix=""):
        if value is None:
            return "Unknown"
        return esc(f"{value:g}{suffix}")

    def status(passed):
        state = "unknown" if passed is None else "agrees" if passed else "mismatch"
        label = "Unknown" if passed is None else "Agrees" if passed else "Mismatch"
        return f'<span class="status {state}">{label}</span>'

    def table(headers, rows):
        headings = "".join(f'<th scope="col">{esc(h)}</th>' for h in headers)
        return (
            f'<div class="table-wrap"><table><thead><tr>{headings}</tr></thead>'
            f"<tbody>{''.join(rows)}</tbody></table></div>"
        )

    def row(label, cells):
        values = "".join(f"<td>{value}</td>" for value in cells)
        return f'<tr><th scope="row">{esc(label)}</th>{values}</tr>'

    charts = result["charts"]
    theme = json.loads(
        files("maimai_intelligence.assets").joinpath("chart-theme.json").read_text("utf-8")
    )
    names = {p["pattern_id"]: p["display_name"] for p in pattern_registry()["entries"]}

    def flow(chart):
        pieces, rows = [], []
        for index, segment in enumerate(chart["flow_segments"], 1):
            mean, peak = segment["density"]["mean"], segment["density"]["peak"]
            interval = f"{segment['start_us'] / 1e6:.2f}–{segment['end_us'] / 1e6:.2f}s"
            label = f"{interval}: mean {mean}, peak {peak} input onsets/s"
            color = (
                theme["flow_unknown"]
                if mean is None
                else theme["flow_colors"][sum(mean >= n for n in (2, 4, 6, 8))]
            )
            pieces.append(f'<span title="{esc(label)}" style="background:{color}"></span>')
            rows.append(row(f"{index} · {interval}", [number(mean), number(peak)]))
        measurements = table(["Notation interval", "Mean", "Peak"], rows)
        return (
            '<div class="flow" role="img" '
            'aria-label="Input-onset density in 24 segments, using the shared scale below">'
            + "".join(pieces)
            + '</div><p class="muted">Input onsets / second · shared scale</p>'
            + '<details class="flow-detail"><summary>Inspect flow measurements</summary>'
            + measurements
            + "</details>"
        )

    cards = []
    for chart in charts:
        difficulty = chart["difficulty"]
        counts = chart["parsed_counts"].values()
        total = None if any(value is None for value in counts) else sum(counts)
        reason = chart.get("count_comparison", {}).get("reason")
        cards.append(
            '<article class="chart-card">'
            f'<p class="difficulty {esc(difficulty.lower())}">{esc(difficulty)} · STD</p>'
            f"<h2>{esc(result['title'])}</h2>"
            f'<p class="total">{number(total)}'
            "<span>chart notes</span></p>"
            f"<p>{esc(chart['metrics']['onset_count'])} physical input onsets · "
            f"{number(chart['end_marker_seconds'], 's')} notation timeline</p>"
            f'{flow(chart)}<p class="count-status">{status(chart["counts_match"])} '
            "Published note-count comparison</p>"
            + (f'<p class="muted">{esc(reason)}</p>' if reason else "")
            + f'<p class="muted">Snapshot <code>{esc(chart["body_sha256"][:12])}</code>'
            " · evaluation only</p></article>"
        )
    headings = [chart["difficulty"].title() for chart in charts]
    count_table = table(
        ["Note type", *headings],
        [
            row(
                key.title(),
                [
                    f"{number(c['parsed_counts'].get(key, 0))} / "
                    f"{number((c['reference_counts'] or {}).get(key))}"
                    for c in charts
                ],
            )
            for key in ("tap", "hold", "slide", "break")
            + (
                ("touch",)
                if any(
                    "touch" in c["parsed_counts"] or "touch" in (c["reference_counts"] or {})
                    for c in charts
                )
                else ()
            )
        ],
    )
    metric_table = table(
        ["Measurement", *headings],
        [
            row(label, [number(c["metrics"].get(key)) for c in charts])
            for key, label in (
                ("onset_rate", "Mean input onsets / second"),
                ("peak_onset_rate", "Peak input onsets / second (1s window)"),
                ("hold_occupancy", "Fraction of observed span with a hold"),
                ("slide_movement_occupancy", "Fraction with slide movement"),
            )
        ],
    )
    tag_ids = sorted({t["pattern_id"] for c in charts for t in c["positive_tags"]})
    tag_table = table(
        ["Project pattern / trait", *[h + " occurrences" for h in headings]],
        [
            row(
                names.get(pattern_id, pattern_id),
                [
                    esc(
                        next(
                            (
                                t["occurrence_count"]
                                for t in c["positive_tags"]
                                if t["pattern_id"] == pattern_id
                            ),
                            "—",
                        )
                    )
                    for c in charts
                ],
            )
            for pattern_id in tag_ids
        ],
    )
    rubric = result["section_checks"]
    slides = result["section_slide_checks"]

    def onsets(items):
        return esc(", ".join(f"{position}: {role.replace('_', ' ')}" for position, role in items))

    onset_table = table(
        ["Notation time", "Expected button : role", "Parsed button : role", "Result"],
        [
            row(
                f"{check['time_s']:.2f}s",
                [onsets(check["expected"]), onsets(check["actual"]), status(check["pass"])],
            )
            for check in rubric
        ],
    )
    slide_cards = []
    for index, check in enumerate(slides, 1):
        expected = check["expected"]
        actual = check.get("actual", [])
        if isinstance(actual, dict):
            actual = [actual]
        candidates = actual if isinstance(actual, list) else []
        candidate = candidates[0] if len(candidates) == 1 else None

        def slide_value(value, key):
            if value is None:
                return "No unique parsed match"
            if key == "path":
                return esc(f"Button {value['head_position']} → {value['end_position']}")
            if key == "shape":
                return f"<code>{esc(value[key])}</code>"
            return number(value.get(key), "s")

        rows = [
            row(label, [slide_value(expected, key), slide_value(candidate, key)])
            for key, label in (
                ("path", "Path endpoints"),
                ("shape", "Shape notation"),
                ("head_s", "Head input"),
                ("movement_start_s", "Movement starts"),
                ("movement_end_s", "Movement ends"),
            )
        ]
        candidate_note = (
            f'<p class="muted">{len(candidates)} parsed candidates at this head input.</p>'
            if len(candidates) != 1
            else ""
        )
        slide_cards.append(
            '<article class="slide-card">'
            f"<h3>Slide {index} {status(check['pass'])}</h3>"
            + table(["Check", "Expected", "Parsed"], rows)
            + candidate_note
            + "</article>"
        )
    template_path = Path(__file__).parent / "templates" / "real_chart_pilot.html"
    return Template(template_path.read_text(encoding="utf-8")).substitute(
        title=esc(result["title"]),
        cards="".join(cards),
        count_table=count_table,
        metric_table=metric_table,
        tag_table=tag_table,
        onset_table=onset_table,
        slide_cards="".join(slide_cards),
        onset_passed=sum(check["pass"] for check in rubric),
        onset_total=len(rubric),
        slide_passed=sum(check["pass"] for check in slides),
        slide_total=len(slides),
        expert_color=theme["difficulty_colors"]["expert"],
        master_color=theme["difficulty_colors"]["master"],
        flow_legend="".join(
            f'<span style="--color:{color}">{label}</span>'
            for color, label in zip(
                theme["flow_colors"], ("Below 2", "2–4", "4–6", "6–8", "8 or more"), strict=True
            )
        ),
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    root = args.manifest.resolve().parent
    manifest = json.loads(bounded_file(root, args.manifest.name))
    if (
        manifest.get("source_kind") != "public_transcription_evaluation"
        or len(manifest["charts"]) != 2
    ):
        raise ValueError("This pilot requires two explicit public evaluation transcriptions")
    rubric = json.loads(bounded_file(root, "master-first-chorus-rubric.json"))
    if sha(bounded_file(root, manifest["raw_file"])) != manifest["raw_sha256"]:
        raise ValueError("Captured source hash mismatch")
    output = args.output_dir.resolve()
    if output == root or root.is_relative_to(output):
        raise ValueError("Use a separate output subdirectory; never overwrite acquisition inputs")
    pending = {}
    result = {
        "title": manifest["title"],
        "source_kind": manifest["source_kind"],
        "charts": [],
        "section_checks": [],
        "section_slide_checks": [],
    }
    for item in manifest["charts"]:
        data = bounded_file(root, item["file"])
        if sha(data) != item["sha256"]:
            raise ValueError("Transcription hash mismatch")
        difficulty = item["difficulty"]
        if difficulty not in {"EXPERT", "MASTER"}:
            raise ValueError("This paired pilot requires Expert and Master")
        source = {
            "source_id": "public-evaluation:simai-wiki:336",
            "revision": "sha256:" + item["sha256"],
            "kind": manifest["source_kind"],
            "byte_hash": sha(data),
            "identity_status": "reviewed",
            "parser_version": "pending",
            "normalizer_version": "1.0.0",
        }
        raw, audit = parse_simai_subset(
            data.decode("utf-8"),
            chart_id=f"evaluation:umiyuri:STD:{difficulty}:{item['sha256'][:12]}",
            song_id="evaluation:umiyuri",
            format="STD",
            difficulty=difficulty,
            revision=source["revision"],
            source=source,
        )
        profile = analyze(raw)
        validate_profile(profile)
        if canonical_bytes(analyze(raw)) != canonical_bytes(profile):
            raise ValueError("Repeated analysis was not deterministic")
        counts = note_counts(raw, audit)
        comparison = count_comparison(
            raw, counts, item["independent_metadata_counts"], item.get("reference_count_convention")
        )
        result["charts"].append(
            {
                "difficulty": difficulty,
                "body_sha256": sha(data),
                "source_url": item["url"],
                "parsed_counts": counts,
                "reference_counts": item["independent_metadata_counts"],
                "counts_match": comparison["matches"],
                "count_comparison": comparison,
                "metrics": profile["metrics"],
                "end_marker_seconds": (
                    audit["end_marker"]["time_us"] / 1e6
                    if audit["end_marker"] is not None
                    else None
                ),
                "coverage": profile["coverage"],
                "positive_tags": [t for t in profile["tags"] if t["status"] == "detected"],
                "flow_segments": profile["flow"]["segments"],
                "profile_sha256": sha(canonical_bytes(profile)),
                "limitations": profile["limitations"],
            }
        )
        if difficulty == "MASTER":
            if sha(data) != rubric["source_sha256"]:
                raise ValueError("Section rubric belongs to a different source revision")
            result["section_checks"] = check_rubric(raw, rubric)
            result["section_slide_checks"] = check_slide_rubric(raw, audit, rubric)
        pending[difficulty.lower() + ".normalized.json"] = canonical_bytes(raw)
        pending[difficulty.lower() + ".profile.json"] = canonical_bytes(profile)
        pending[difficulty.lower() + ".parse-audit.json"] = canonical_bytes(audit)
    if {c["difficulty"] for c in result["charts"]} != {"EXPERT", "MASTER"}:
        raise ValueError("Both exact difficulties must be supplied")
    result["charts"].sort(key=lambda c: c["difficulty"])
    pending["results.json"] = canonical_bytes(result)
    pending["index.html"] = report_html(result).encode("utf-8")
    output.mkdir(parents=True, exist_ok=True)
    for name in pending:
        destination = output / name
        if destination.resolve().parent != output:
            raise ValueError("Output alias escapes the evaluation directory")
    for name, data in pending.items():
        (output / name).write_bytes(data)
    print(
        json.dumps(
            {
                "charts": [
                    {
                        "difficulty": c["difficulty"],
                        "counts": c["parsed_counts"],
                        "counts_match": c["counts_match"],
                    }
                    for c in result["charts"]
                ],
                "section_checks": len(result["section_checks"]),
                "section_checks_passed": sum(c["pass"] for c in result["section_checks"]),
                "report": str(output / "index.html"),
            },
            ensure_ascii=False,
        )
    )
    return (
        0
        if (
            all(c["counts_match"] for c in result["charts"])
            and all(c["pass"] for c in result["section_checks"] + result["section_slide_checks"])
        )
        else 1
    )


if __name__ == "__main__":
    sys.exit(main())
