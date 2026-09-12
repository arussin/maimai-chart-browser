"""Public chart browsing, pattern reference and experimental passage comparisons."""

from __future__ import annotations

import json
from importlib.resources import files

from maimai_analyzer.patterns import pattern_registry


def _encoded(value):
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )


def review_scripts():
    assets = files("maimai_intelligence.assets")
    theme = assets.joinpath("chart-theme.json").read_text("utf-8")
    return "\n".join(
        assets.joinpath(name).read_text("utf-8").replace("__MAIMAI_CHART_THEME__", theme)
        for name in ("chart-visuals.js", "pattern-library.js", "challenge-review.js")
    )


def render_review(package, catalog, review, snippets, benchmark, navigation=None):
    data = {
        "package": package,
        "catalog": catalog,
        "review": review,
        "snippets": snippets,
        "benchmark_hash": benchmark["benchmark_hash"],
        "navigation": navigation or {"charts": {}, "genres": [], "versions": []},
    }
    # Showing a public reference definition never assigns it to a catalog chart.
    patterns = [
        {
            key: entry[key]
            for key in (
                "pattern_id",
                "display_name",
                "family",
                "kind",
                "aliases",
                "definition",
                "name_origin",
                "definition_status",
                "counterexamples_and_limits",
                "source_ids",
            )
        }
        for entry in pattern_registry()["entries"]
    ]
    assets = files("maimai_intelligence.assets")
    css = "\n".join(
        assets.joinpath(name).read_text("utf-8")
        for name in ("challenge-review.css", "chart-visuals.css")
    )
    html = assets.joinpath("challenge-review.html").read_text("utf-8")
    return (
        html.replace("__CSS__", css)
        .replace("__PATTERNS__", _encoded(patterns))
        .replace("__DATA__", _encoded(data))
        .replace("__JS__", review_scripts())
    )
