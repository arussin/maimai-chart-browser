"""Build an offline research study and the shared Explore UI from verified local inputs.

This never fetches sources, imports scores, repairs notation, or promotes research
profiles into production. Unsupported bodies remain unavailable catalog entries.
Only source hashes, paraphrases and structured measurements enter the review HTML.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
from collections import Counter
from fractions import Fraction
from importlib import resources
from pathlib import Path
from urllib.parse import urlsplit

from maimai_analyzer import analyze, canonical_bytes, pattern_registry, validate_profile
from maimai_analyzer.catalog import build_evaluation_catalog
from maimai_analyzer.contracts import ChartInputError
from maimai_analyzer.rational import decode_rational
from maimai_analyzer.simai_subset import PARSER_VERSION, parse_simai_subset
from maimai_intelligence.explorer import build_catalog_html, render_catalog
from maimai_intelligence.io import atomic_write_text

try:
    from scripts.evaluate_simai_pilot import audited_paths, count_comparison, note_counts
except ModuleNotFoundError as error:
    if error.name != "scripts":
        raise
    # Direct script invocation places scripts/, rather than its parent, on sys.path.
    from evaluate_simai_pilot import audited_paths, count_comparison, note_counts

MAX_CHARTS = 128
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 128 * 1024 * 1024
SOURCE_KIND = "public_transcription_evaluation"
NOTE_TYPES = ("tap", "hold", "slide", "break")


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _alias(item: dict, *names: str, required: bool = True):
    found = [item[name] for name in names if name in item]
    if not found:
        if required:
            raise ValueError(f"Missing manifest field {names[0]}")
        return None
    if any(value != found[0] for value in found[1:]):
        raise ValueError(f"Conflicting manifest aliases for {names[0]}")
    return found[0]


def _text(value, label: str, limit: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"Invalid {label}")
    return value


def _texts(value, label: str) -> list[str]:
    if not isinstance(value, list) or len(value) > 24:
        raise ValueError(f"Invalid {label} list")
    return [_text(item, label) for item in value]


def _link(value) -> str | None:
    if value is None:
        return None
    parsed = urlsplit(_text(value, "source URL"))
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        raise ValueError("Source links must be explicit public HTTP(S) URLs")
    return value


def _time_us(value) -> int:
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 3600:
        raise ValueError("Rubric times must be finite seconds in the one-hour chart range")
    return round(Fraction(str(value)) * 1_000_000)


def _counts(value) -> dict | None:
    if value is None:
        return None
    if (
        not isinstance(value, dict)
        or not set(NOTE_TYPES) <= set(value)
        or set(value) - {*NOTE_TYPES, "touch"}
        or any(type(number) is not int or not 0 <= number <= 100_000 for number in value.values())
    ):
        raise ValueError("Reference counts require four note categories and optional TOUCH")
    return dict(value)


def structural_observations(raw: dict) -> dict:
    """Measure two-input tap-to-star pairs without relabeling a registry detector."""
    groups = {}
    for event in raw["onsets"]:
        groups.setdefault(event["time_us"], []).append(event)
    ordered = [groups[instant] for instant in sorted(groups)]
    pairs = []
    for left, right in zip(ordered, ordered[1:], strict=False):
        if len(left) != 1 or len(right) != 1:
            continue
        tap, star = left[0], right[0]
        if (
            tap["role"] == "tap"
            and star["role"] == "star_tap"
            and not tap.get("break")
            and not star.get("break")
            and tap["position"] == star["position"]
            and decode_rational(star["beat"]) - decode_rational(tap["beat"]) == Fraction(1, 2)
        ):
            pairs.append(
                {
                    "position": tap["position"],
                    "tap_s": tap["time_us"] / 1e6,
                    "star_s": star["time_us"] / 1e6,
                }
            )
    return {
        "same_position_tap_to_star_eighth_pairs": {
            "count": len(pairs),
            "examples": pairs[:3],
            "beat_gap": [1, 2],
            "definition": (
                "Adjacent monophonic ordinary tap then star head, same button, half-beat gap."
            ),
            "scope": "Structural observation only; not a community tag or three-input repetition.",
        }
    }


def check_rubrics(raw: dict, audit: dict, rubrics: list[dict]) -> list[dict]:
    """Check complete half-open windows, retaining mismatches and ±1us timing tolerance.

    These authored expectations refer to the same transcription, so agreement is
    a structural consistency check, never independent game or qualitative proof.
    """
    if not isinstance(rubrics, list) or len(rubrics) > 5:
        raise ValueError("At most five explicit section rubrics are supported per chart")
    slides = []
    entries = audited_paths(raw, audit)
    if entries is None:
        raise ValueError("Section rubrics require an audit for every parsed path")
    for token, detail, path in entries:
        slides.append(
            {
                "head_position": token["start_position"],
                "end_position": detail["end_position"],
                "shape": detail["path_shape"],
                "head_s": path["wait_start_us"] / 1e6,
                "movement_start_s": path["movement_start_us"] / 1e6,
                "movement_end_s": path["movement_end_us"] / 1e6,
            }
        )
    results = []
    for rubric in rubrics:
        if not isinstance(rubric, dict) or rubric.get("source_scope") != "same_transcription":
            raise ValueError("Section rubric must explicitly declare same_transcription scope")
        start, end = _time_us(rubric["window_start_s"]), _time_us(rubric["window_end_s"])
        if start >= end:
            raise ValueError("Section rubric window must have positive duration")
        expected = rubric.get("expected_onsets")
        if not isinstance(expected, list) or not 1 <= len(expected) <= 500:
            raise ValueError("Rubric requires 1–500 complete expected onset groups")
        observed = [event for event in raw["onsets"] if start <= event["time_us"] < end]
        observed_by_time = {}
        for event in observed:
            observed_by_time.setdefault(event["time_us"], []).append(event)
        checks, instants = [], []
        for group in expected:
            instant = _time_us(group["time_s"])
            if not start <= instant < end or any(abs(instant - other) <= 2 for other in instants):
                raise ValueError("Rubric onset groups must be unique times inside their window")
            instants.append(instant)
            onsets = group["onsets"]
            if (
                not isinstance(onsets, list)
                or not 1 <= len(onsets) <= 8
                or any(
                    not isinstance(event, dict)
                    or type(event.get("position")) is not int
                    or not 1 <= event["position"] <= 8
                    or event.get("role") not in {"tap", "hold_onset", "star_tap"}
                    for event in onsets
                )
            ):
                raise ValueError("Expected onsets require explicit button positions and roles")
            wanted = sorted(
                ((event["position"], event["role"]) for event in onsets),
                key=lambda item: (str(item[0]), item[1]),
            )
            actual = sorted(
                (
                    (event["position"], event["role"])
                    for nearby in (instant - 1, instant, instant + 1)
                    for event in observed_by_time.get(nearby, [])
                ),
                key=lambda item: (str(item[0]), item[1]),
            )
            checks.append(
                {
                    "time_s": group["time_s"],
                    "expected": wanted,
                    "actual": actual,
                    "pass": actual == wanted,
                }
            )
        expected_count = sum(len(group["onsets"]) for group in expected)
        slide_checks = []
        expected_slides = rubric.get("expected_slides")
        window_slides = [slide for slide in slides if start <= _time_us(slide["head_s"]) < end]
        window_slides.sort(key=lambda slide: (slide["head_s"], slide["head_position"]))
        if expected_slides is not None:
            if not isinstance(expected_slides, list) or len(expected_slides) > 100:
                raise ValueError("Rubric slide expectations must be a bounded list")
            expected_heads = []
            for wanted in expected_slides:
                if (
                    not isinstance(wanted, dict)
                    or set(wanted)
                    != {
                        "head_position",
                        "end_position",
                        "shape",
                        "head_s",
                        "movement_start_s",
                        "movement_end_s",
                    }
                    or any(
                        type(wanted[key]) is not int or not 1 <= wanted[key] <= 8
                        for key in ("head_position", "end_position")
                    )
                ):
                    raise ValueError("Expected slide must specify its full shape and timing")
                if wanted["shape"] not in {"-", "^", "<", ">", "p", "q", "s", "z", "V"}:
                    raise ValueError("Unsupported expected slide shape")
                head, launch, stop = [
                    _time_us(wanted[key])
                    for key in ("head_s", "movement_start_s", "movement_end_s")
                ]
                if not start <= head < end or not head <= launch < stop:
                    raise ValueError("Expected slide times are inconsistent with the rubric window")
                if any(
                    position == wanted["head_position"] and abs(head - instant) <= 2
                    for position, instant in expected_heads
                ):
                    raise ValueError("Duplicate expected slide head cannot cover another path")
                expected_heads.append((wanted["head_position"], head))
                candidates = [
                    slide
                    for slide in window_slides
                    if slide["head_position"] == wanted["head_position"]
                    and abs(_time_us(slide["head_s"]) - head) <= 1
                ]
                agrees = len(candidates) == 1 and all(
                    abs(_time_us(candidates[0][key]) - _time_us(wanted[key])) <= 1
                    if key.endswith("_s")
                    else candidates[0][key] == wanted[key]
                    for key in wanted
                )
                slide_checks.append({"expected": wanted, "actual": candidates, "pass": agrees})
        cardinality = len(observed) == expected_count
        slide_cardinality = (
            None if expected_slides is None else len(window_slides) == len(expected_slides)
        )
        measured = {"observed_role_counts": dict(Counter(event["role"] for event in observed))}
        if window_slides:
            first, last = window_slides[0], window_slides[-1]
            first_duration = _time_us(first["movement_end_s"]) - _time_us(first["movement_start_s"])
            last_duration = _time_us(last["movement_end_s"]) - _time_us(last["movement_start_s"])
            final_end = _time_us(last["movement_end_s"])
            final_start = _time_us(last["movement_start_s"])
            measured.update(
                slide_movement_durations_us=[
                    _time_us(slide["movement_end_s"]) - _time_us(slide["movement_start_s"])
                    for slide in window_slides
                ],
                last_movement_duration_over_first=(
                    last_duration / first_duration if first_duration else None
                ),
                last_movement_four_times_first_within_1us=abs(last_duration - 4 * first_duration)
                <= 1,
                final_slide_end_coincident_onsets=[
                    {"position": event["position"], "role": event["role"]}
                    for event in raw["onsets"]
                    if abs(event["time_us"] - final_end) <= 1
                ],
                final_slide_during_movement_onsets=[
                    {
                        "position": event["position"],
                        "role": event["role"],
                        "time_s": event["time_us"] / 1e6,
                    }
                    for event in raw["onsets"]
                    if final_start < event["time_us"] < final_end
                ][:12],
                physical_path_speed="unknown",
            )
        results.append(
            {
                "rubric_id": _text(rubric.get("rubric_id"), "rubric ID", 120),
                "label": _text(rubric.get("label"), "rubric label", 512),
                "source_scope": "same_transcription",
                "support_scope": "structural_consistency_only",
                "window_start_s": rubric["window_start_s"],
                "window_end_s": rubric["window_end_s"],
                "expected_onset_count": expected_count,
                "actual_onset_count": len(observed),
                "onset_cardinality_matches": cardinality,
                "slide_cardinality_matches": slide_cardinality,
                "onset_checks": checks,
                "slide_checks": slide_checks,
                "measured_observations": measured,
                "hold_duration_checks": "not_performed",
                "pass": cardinality
                and slide_cardinality is not False
                and all(check["pass"] for check in checks + slide_checks),
            }
        )
    return results


def report_html(result: dict) -> str:
    """Compact source-linked review; chart browsing uses the shared sealed Explorer."""

    def escape(value):
        return html.escape(str(value), quote=True)

    def number(value):
        return "Unknown" if value is None else f"{value:g}"

    theme = json.loads(
        resources.files("maimai_intelligence.assets")
        .joinpath("chart-theme.json")
        .read_text("utf-8")
    )

    def link(url, label):
        return (
            f'<a href="{escape(url)}">{escape(label)}</a>'
            if url
            else escape(label + " unavailable")
        )

    rows, cards = [], []
    count_types = NOTE_TYPES + (
        ("touch",)
        if any(
            "touch" in (chart["parsed_counts"] or {})
            or "touch" in (chart["reference_counts"] or {})
            for chart in result["charts"]
        )
        else ()
    )
    count_headers = "".join(f"<th>{escape(key.title())}</th>" for key in count_types)
    for chart in result["charts"]:
        color = theme["difficulty_colors"].get(chart["difficulty"].lower(), "#526d78")
        badge = (
            f'<span class="badge" style="background:{color}">{escape(chart["difficulty"])}</span>'
        )
        values = []
        for key in count_types:
            parsed = chart["parsed_counts"].get(key, 0) if chart["parsed_counts"] else None
            reference = chart["reference_counts"].get(key) if chart["reference_counts"] else None
            parsed, reference = number(parsed), number(reference)
            values.append(f"<td>{parsed} / {reference}</td>")
        match = (
            "Agree"
            if chart["counts_match"]
            else "Mismatch"
            if chart["counts_match"] is False
            else "Unknown"
        )
        rows.append(
            f"<tr><th>{escape(chart['title'])}<br>{badge}</th>{''.join(values)}"
            f"<td>{escape(match)}"
            + (
                "<br>" + escape(chart.get("count_comparison", {}).get("reason"))
                if chart.get("count_comparison", {}).get("reason")
                else ""
            )
            + "</td></tr>"
        )
        measured = (
            f"{chart['metrics']['onset_count']} physical input onsets; "
            f"{number(chart['metrics']['onset_rate'])} mean input onsets/s; "
            f"{number(chart['metrics']['hold_occupancy'])} hold occupancy."
            if chart["metrics"]
            else "Measurements unavailable: " + chart["unavailable_reason"]
        )
        expectation_list = "".join(
            f"<li>{escape(item)}</li>" for item in chart["predeclared_expectations"]
        )
        unknown_list = "".join(f"<li>{escape(item)}</li>" for item in chart["unknowns"])
        observations = chart.get("structural_observations")
        pair_note = ""
        if observations:
            pairs = observations["same_position_tap_to_star_eighth_pairs"]
            pair_note = (
                f"<p><strong>{pairs['count']} tap-to-star eighth-note pairs</strong> "
                "at the same button, with no simultaneous inputs. This measured two-input "
                "observation is separate from community tags and longer repetition detectors.</p>"
            )
        rubric_parts = []
        for rubric in chart["rubric_checks"]:
            check_rows = "".join(
                f"<tr><th>{check['time_s']:g}s</th><td>{escape(check['expected'])}</td>"
                f"<td>{escape(check['actual'])}</td>"
                f"<td>{'Agree' if check['pass'] else 'Mismatch'}</td></tr>"
                for check in rubric["onset_checks"]
            )
            slide_details = "".join(
                "<li><strong>"
                + ("Agree" if check["pass"] else "Mismatch")
                + "</strong> · "
                + escape(
                    json.dumps(
                        {"expected": check["expected"], "parsed": check["actual"]},
                        ensure_ascii=False,
                    )
                )
                + "</li>"
                for check in rubric["slide_checks"]
            )
            measured_section = rubric["measured_observations"]
            role_note = ", ".join(
                f"{count} {role.replace('_', ' ')}"
                for role, count in measured_section["observed_role_counts"].items()
            )
            duration_note = ""
            if "slide_movement_durations_us" in measured_section:
                durations = measured_section["slide_movement_durations_us"]
                duration_note = (
                    f"<p>Movement durations: {escape(durations)} microseconds. "
                    "Last / first duration: "
                    f"{number(measured_section['last_movement_duration_over_first'])}. "
                    "Final movement ends with these parsed inputs: "
                    f"{escape(measured_section['final_slide_end_coincident_onsets'])}. "
                    "Physical path speed remains unknown.</p>"
                )
            rubric_parts.append(
                f"<details><summary>{escape(rubric['label'])} · "
                f"{'agrees' if rubric['pass'] else 'mismatch'}</summary>"
                f"<p>Window {rubric['window_start_s']:g}–{rubric['window_end_s']:g}s; "
                f"{rubric['actual_onset_count']} observed / {rubric['expected_onset_count']} "
                "expected inputs. Same-transcription structural check only.</p>"
                f"<p>Parsed roles: {escape(role_note)}. Hold durations were not checked.</p>"
                + duration_note
                + '<div class="table-wrap" role="region" tabindex="0" '
                + 'aria-label="Section comparison"><table><thead><tr><th>Time</th><th>Expected</th>'
                f"<th>Parsed</th><th>Check</th></tr></thead><tbody>{check_rows}</tbody></table></div>"
                f'<ul class="slide-checks">{slide_details}</ul></details>'
            )
        cards.append(
            "<article>" + badge + f"<h2>{escape(chart['title'])}</h2>"
            f'<p class="status">{escape(chart["description_support_status"].replace("_", " "))}</p>'
            f"<p>{escape(chart['description_paraphrase'] or 'No qualitative claim supplied.')}</p>"
            '<p class="muted">Claim scope: '
            f"{escape(chart['description_scope'] or 'unspecified')}</p>"
            f"<p><strong>Measured:</strong> {escape(measured)}</p>"
            + pair_note
            + f"<ul>{expectation_list}</ul>{''.join(rubric_parts)}<ul>{unknown_list}</ul>"
            f'<p class="muted">{link(chart["source_url"], "Transcription source")} · '
            f"{link(chart['metadata_url'], 'Description / count source')}<br>"
            f"Body snapshot <code>{escape(chart['body_sha256'][:12])}</code></p></article>"
        )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy"
 content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Public chart research study</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#f3f8fa;color:#193e49;font:16px/1.6 system-ui}}
main{{max-width:1080px;margin:auto;padding:28px 20px}}header,section,article{{background:white;
padding:24px;border:1px solid #ccdee3;border-radius:14px;margin-bottom:20px;min-width:0}}
header{{border-top:6px solid {theme["flow_colors"][3]}}}h1,h2,p{{margin:0 0 12px}}
h1{{font-size:30px;line-height:1.2}}h2{{font-size:23px}}.badge{{display:inline-block;color:white;
padding:3px 9px;border-radius:6px;font-weight:700;font-size:12px;margin-bottom:9px}}
a{{color:#006f81}}.open{{display:inline-block;padding:10px 18px;border-radius:9px;
background:{theme["flow_colors"][4]};color:white;font-weight:700;text-decoration:none}}
.muted{{font-size:13px;color:#526d78}}.status{{font-weight:700}}.table-wrap{{overflow-x:auto}}
table{{width:100%;border-collapse:collapse;font-size:13px}}td,th{{padding:10px 8px;text-align:left;
border-bottom:1px solid #dfe9ed}}summary{{cursor:pointer;font-weight:650;padding:10px 0}}
li{{margin-bottom:8px}}code,.slide-checks{{overflow-wrap:anywhere}}details{{margin:12px 0}}
@media(max-width:650px){{main{{padding:16px 12px}}header,section,article{{padding:18px 14px}}
h1{{font-size:26px}}th,td{{padding:8px 5px}}}}
</style></head><body><main>
<header><p class="muted">MAIMAI · PUBLIC TRANSCRIPTION RESEARCH</p>
<h1>Check the evidence, then explore the charts</h1>
<p>{result["coverage"]["accepted"]} parsed charts ·
{result["coverage"]["unsupported"]} unavailable ·
{result["coverage"]["rubrics_agree"]}/{result["coverage"]["rubrics_total"]}
section checks agree.</p>
<p>Game-chart fidelity is unverified. This study uses no player data and makes no training,
fatigue, hand-assignment or recommendation claim.</p>
<a class="open" href="explorer.html">Open research Explore</a></header>
<section><h2>Note-count cross-check</h2><p>Parsed / published. Star heads count as tap inputs;
slide paths are separate game note units. Agreement does not verify every position or time.</p>
<div class="table-wrap" role="region" tabindex="0" aria-label="Note count comparison">
<table><thead><tr><th>Chart</th>{count_headers}<th>Check</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div></section>
{"".join(cards)}
<footer class="muted"><a href="results.json">Detailed results and source hashes</a> ·
Same-transcription rubrics support structural consistency only. Qualitative descriptions
remain partially tested or untested; matching selected sections is not full validation.</footer>
</main></body></html>"""


def build_study(manifest_path: Path, output_dir: Path) -> dict:
    """Verify all inputs and prepare all artifacts before atomic per-file publication."""
    manifest_path = Path(manifest_path).resolve()
    root, output = manifest_path.parent, Path(output_dir).resolve()
    if output == root or root.is_relative_to(output):
        raise ValueError("Study output must be separate from its source directory and ancestors")
    loaded: dict[Path, bytes] = {}

    def read(name, digest=None, *, require_hash=True):
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,180}", name):
            raise ValueError("Study inputs must be simple basenames inside the manifest directory")
        path = (root / name).resolve()
        if path.parent != root:
            raise ValueError("Study input alias escapes its source directory")
        if path not in loaded:
            with path.open("rb") as stream:
                data = stream.read(MAX_FILE_BYTES + 1)
            if len(data) > MAX_FILE_BYTES:
                raise ValueError("Study input exceeds its per-file byte limit")
            loaded[path] = data
            if sum(len(value) for value in loaded.values()) > MAX_TOTAL_BYTES:
                raise ValueError("Study exceeds its total source-byte budget")
        data = loaded[path]
        if (require_hash or digest is not None) and (
            not isinstance(digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", digest) is None
            or _sha(data) != digest
        ):
            raise ValueError(f"Source hash mismatch: {name}")
        return data

    manifest_bytes = read(manifest_path.name, require_hash=False)
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or manifest.get("source_kind") != SOURCE_KIND:
        raise ValueError("Manifest must explicitly declare public transcription evaluation")
    charts = manifest.get("charts")
    if not isinstance(charts, list) or not 1 <= len(charts) <= MAX_CHARTS:
        raise ValueError("Study manifest requires 1–128 charts")
    prepared = []
    for item in charts:
        if not isinstance(item, dict):
            raise ValueError("Chart manifest entry must be an object")
        body_file = _alias(item, "body_file", "file")
        body_hash = _alias(item, "body_sha256", "sha256")
        source_file = _alias(item, "source_raw_file", "raw_file")
        source_hash = _alias(item, "source_raw_sha256", "raw_sha256")
        body = read(body_file, body_hash)
        read(source_file, source_hash)
        if "metadata_raw_file" in item or "metadata_raw_sha256" in item:
            read(item["metadata_raw_file"], item["metadata_raw_sha256"])
        slug = _text(item.get("slug"), "chart slug", 80)
        if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) is None:
            raise ValueError("Chart slug must be lowercase ASCII words separated by hyphens")
        difficulty, format_name = item.get("difficulty"), item.get("format")
        if difficulty not in {
            "BASIC",
            "ADVANCED",
            "EXPERT",
            "MASTER",
            "RE:MASTER",
            "UTAGE",
        } or format_name not in {"STD", "DX"}:
            raise ValueError("Exact supported chart difficulty and format are required")
        title = _text(item.get("title"), "chart title", 512)
        counts = _counts(
            _alias(item, "expected_note_counts", "independent_metadata_counts", required=False)
        )
        record = {
            "slug": slug,
            "title": title,
            "difficulty": difficulty,
            "format": format_name,
            "body_sha256": body_hash,
            "source_raw_sha256": source_hash,
            "source_url": _link(item.get("source_url", item.get("url"))),
            "metadata_url": _link(item.get("metadata_url")),
            "reference_counts": counts,
            "reference_count_convention": item.get("reference_count_convention"),
            "description_paraphrase": item.get("description_paraphrase", ""),
            "description_scope": item.get("description_scope", ""),
            "predeclared_expectations": _texts(
                item.get("predeclared_expectations", []), "expectations"
            ),
            "unknowns": _texts(item.get("unknowns", []), "unknowns"),
        }
        for key in ("description_paraphrase", "description_scope"):
            if record[key] != "":
                _text(record[key], key)
        prepared.append((item, body, record))
    results, metadata, profiles, pending = [], [], [], {}
    registry = pattern_registry()
    for item, body, record in prepared:
        revision = "sha256:" + record["body_sha256"]
        cid = (
            f"evaluation:{record['slug']}:{record['format']}:{record['difficulty']}:"
            + record["body_sha256"][:12]
        )
        source = {
            "source_id": "evaluation:" + record["slug"],
            "revision": revision,
            "kind": SOURCE_KIND,
            "byte_hash": record["body_sha256"],
            "identity_status": "reviewed",
        }
        meta = {
            "chart_id": cid,
            "song_id": "evaluation:" + record["slug"],
            "title": record["title"],
            "format": record["format"],
            "difficulty": record["difficulty"],
            "revision": revision,
            "source_id": source["source_id"],
            "source_revision": revision,
            "source_status": "use_unresolved",
            "identity_status": "reviewed",
            **{key: item[key] for key in ("artist", "aliases", "level", "constant") if key in item},
        }
        metadata.append(meta)
        record.update(
            chart_id=cid,
            parser_version=PARSER_VERSION,
            parser_status="unsupported",
            parsed_counts=None,
            counts_match=None,
            count_comparison={
                "comparable": False,
                "matches": None,
                "reason": "Parser output is unavailable.",
            },
            metrics=None,
            rubric_checks=[],
            unavailable_reason=None,
            description_support_status="unavailable_parser",
            structural_observations=None,
        )
        try:
            raw, audit = parse_simai_subset(
                body.decode("utf-8"),
                chart_id=cid,
                song_id=meta["song_id"],
                format=meta["format"],
                difficulty=meta["difficulty"],
                revision=revision,
                source=source,
            )
        except (ChartInputError, UnicodeError) as error:
            record["unavailable_reason"] = str(error)
        else:
            profile = analyze(raw)
            validate_profile(profile)
            if canonical_bytes(analyze(raw)) != canonical_bytes(profile):
                raise ValueError("Repeated chart analysis was not deterministic")
            profiles.append(profile)
            counts = note_counts(raw, audit)
            comparison = count_comparison(
                raw, counts, record["reference_counts"], record["reference_count_convention"]
            )
            checks = check_rubrics(raw, audit, item.get("rubrics", []))
            if any(
                rubric.get("body_sha256", record["body_sha256"]) != record["body_sha256"]
                for rubric in item.get("rubrics", [])
            ):
                raise ValueError("Section rubric refers to a different transcription snapshot")
            support = "not_tested"
            if item.get("description_testable_for_this_variant") is False:
                support = "not_applicable_to_this_variant"
            elif checks:
                support = (
                    "selected_structure_consistent"
                    if all(c["pass"] for c in checks)
                    else "structural_mismatch"
                )
            prefix = (
                f"{record['slug']}-{record['format'].lower()}-"
                f"{record['difficulty'].lower().replace(':', '')}-{record['body_sha256'][:12]}"
            )
            record.update(
                parser_status="accepted",
                parsed_counts=counts,
                counts_match=comparison["matches"],
                count_comparison=comparison,
                metrics=profile["metrics"],
                rubric_checks=checks,
                profile_sha256=_sha(canonical_bytes(profile)),
                normalized_sha256=_sha(canonical_bytes(raw)),
                end_marker_seconds=(
                    audit["end_marker"]["time_us"] / 1e6
                    if audit["end_marker"] is not None
                    else None
                ),
                description_support_status=support,
                structural_observations=structural_observations(raw),
            )
            for suffix, value in (
                ("normalized", raw),
                ("profile", profile),
                ("parse-audit", audit),
            ):
                name = prefix + "." + suffix + ".json"
                if name in pending:
                    raise ValueError("Duplicate exact chart artifact identity")
                pending[name] = canonical_bytes(value).decode("utf-8")
                record[suffix.replace("-", "_") + "_file"] = name
        results.append(record)
    pack, catalog_manifest = build_evaluation_catalog(
        metadata,
        profiles,
        registry,
        catalog_id="public-transcription-study:" + _sha(manifest_bytes)[:12],
    )
    if len(catalog_manifest["profiles"]) != len(profiles):
        raise ValueError("Analyzed profiles were unexpectedly withheld by the research catalog")
    reasons = {record["chart_id"]: record["unavailable_reason"] for record in results}
    for chart in pack["charts"]:
        if reasons[chart["chart_id"]]:
            chart["coverage"]["summary"] = "Unsupported notation: " + reasons[chart["chart_id"]]
    catalog_manifest["catalog_hash"] = _sha(canonical_bytes(pack))
    result = {
        "evaluation_only": True,
        "source_kind": SOURCE_KIND,
        "manifest_sha256": _sha(manifest_bytes),
        "parser_version": PARSER_VERSION,
        "charts": sorted(results, key=lambda record: record["chart_id"]),
        "coverage": {
            "accepted": len(profiles),
            "unsupported": len(results) - len(profiles),
            "rubrics_total": sum(len(record["rubric_checks"]) for record in results),
            "rubrics_agree": sum(
                check["pass"] for record in results for check in record["rubric_checks"]
            ),
            "game_identity": "unverified",
            "qualitative_claim_validation": "not_established",
        },
    }
    pending.update(
        {
            "results.json": canonical_bytes(result).decode("utf-8"),
            "research-catalog.json": canonical_bytes(pack).decode("utf-8"),
            "research-catalog.manifest.json": canonical_bytes(catalog_manifest).decode("utf-8"),
            "index.html": report_html(result),
            "explorer.html": build_catalog_html(pack),
        }
    )
    if sum(len(value.encode("utf-8")) for value in pending.values()) > MAX_OUTPUT_BYTES:
        raise ValueError("Study exceeds its prepared output budget")
    resolved = [(output / name).resolve() for name in pending]
    if len(set(resolved)) != len(resolved) or any(
        path.parent != output or path in loaded or path.is_dir() for path in resolved
    ):
        raise ValueError("Study output aliases an input or escapes its output directory")
    # All hashes, source boundaries, measurements and rendered documents passed
    # before any destination is created. Each replacement is atomic, not a batch transaction.
    for name in sorted(pending):
        if name == "explorer.html":
            render_catalog(pack, output / name)
        else:
            atomic_write_text(output / name, pending[name])
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    result = build_study(args.manifest, args.output_dir)
    print(
        json.dumps(
            {"coverage": result["coverage"], "explorer": str(args.output_dir / "explorer.html")}
        )
    )
    mismatches = any(
        chart["counts_match"] is False or any(not check["pass"] for check in chart["rubric_checks"])
        for chart in result["charts"]
    )
    return 1 if mismatches else 0


if __name__ == "__main__":
    raise SystemExit(main())
