"""Sealed, account-free challenge comparison and blind review artifact."""

from __future__ import annotations

import json
from importlib.resources import files


def render_review(package, catalog, review, snippets, benchmark, navigation=None):
    data = {
        "package": package,
        "catalog": catalog,
        "review": review,
        "snippets": snippets,
        "benchmark_hash": benchmark["benchmark_hash"],
        "navigation": navigation or {"charts": {}, "genres": [], "versions": []},
    }
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    encoded = encoded.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    assets = files("maimai_intelligence").joinpath("assets")
    css = assets.joinpath("challenge-review.css").read_text(encoding="utf-8")
    js = assets.joinpath("challenge-review.js").read_text(encoding="utf-8")
    return (
        """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>maimai · Challenge lab</title><style>"""
        + css
        + """</style></head><body>
<header><span class="eyebrow">CHART INTELLIGENCE · RESEARCH PREVIEW</span>
<h1>Find your next challenge<span class="spark">✦</span></h1>
<p>Browse every chart in the pack and try similar-challenge recommendations.</p>
<div class="preview-status" aria-label="What is ready">
<div><strong id="loaded-count"></strong><span>ordinary charts loaded</span></div>
<div><strong id="sample-count"></strong><span>recommendation examples</span></div>
<div><strong>Patterns: experimental</strong><span>No validated named-pattern labels yet</span></div>
</div>
<nav aria-label="Views"><button id="catalog-tab" aria-pressed="true">Full song catalog</button>
<button id="compare-tab" aria-pressed="false">Recommendation samples</button></nav></header>
<main><section id="compare" hidden>
<h2>Try a similar challenge</h2>
<p id="sample-intro"></p><div class="toolbar">
<label>Starting chart <select id="query"></select></label></div>
<div id="query-card"></div><div id="matches"></div>
<details class="feedback"><summary>Optional: help evaluate the matches</summary>
<p>Choose a judgment only if you want to. These stay in this page until you save them.</p>
<div class="toolbar"><label class="check">
<input type="checkbox" id="feedback"> Enable feedback</label>
<label class="check"><input type="checkbox" id="blind" disabled>
Hide ranking order and reasons</label>
<button id="download" disabled>Save judgments</button></div>
<p id="review-status" role="status"></p></details></section>
<section id="catalog"><h2>Full song catalog</h2>
<div class="toolbar catalog-tools">
<label>Find a song <input id="search" type="search" placeholder="Search all songs"></label>
<div class="format-switch" role="group" aria-label="Chart format">
<button id="format-all" aria-pressed="true">All</button>
<button id="format-STD" aria-pressed="false">STD</button>
<button id="format-DX" aria-pressed="false">DX</button></div></div>
<div class="folder-modes" role="group" aria-label="Browse by">
<button id="browse-genre" aria-pressed="true">Genre</button>
<button id="sort-level" aria-pressed="false">Level</button>
<button id="browse-version" aria-pressed="false">Version</button>
<button id="sort-title" aria-pressed="false">All songs</button></div>
<div id="folder-navigation" class="folder-navigation">
<button id="folder-prev" aria-label="Previous category">‹</button>
<div id="folders" class="folder-rail" role="group" aria-label="Categories"></div>
<button id="folder-next" aria-label="Next category">›</button></div>
<h3 id="folder-heading"></h3>
<p id="catalog-count" role="status"></p><div id="songs"></div>
<button id="more">Show more songs</button></section>
<section class="sources"><h2>About this preview</h2><p id="coverage"></p>
<p>Songs are grouped by source title and artist. Source levels are shown; official constants
are separate. This pack is not a filter for a particular region or release.</p>
<p>Genre and version folders follow the pinned pack's metadata. Versions describe source
containers, not independently verified chart-addition dates. Songs within a folder use title
order; the cabinet's recommended order is not reproduced. Utage stays excluded.</p>
<p>Matches are experimental. Pattern accuracy and match relevance await independent review.
Animation uses chart time, without audio. Straight and center-V slides are schematic;
unsupported paths are labeled and never drawn as substitute curves.</p>
<details><summary>Sources and attribution</summary><p id="credit"></p><p id="notice"></p>
<p>Maichart-Converts · Neskol/Maichart-Converts on GitHub</p>
<p>Category vocabulary: <a href="https://maimai.sega.com/song/">SEGA song categories</a> ·
<a href="https://info-maimai.sega.jp/5802/">SEGA category and sort settings</a></p>
<code id="revision"></code></details></section></main>
<script id="challenge-data" type="application/json">"""
        + encoded
        + """</script><script>"""
        + js
        + """</script></body></html>"""
    )
