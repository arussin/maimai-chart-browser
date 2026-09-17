"""Synthetic inventory cases; real song names below supply metadata only."""

import json

from maimai_intelligence.official_inventory import URLS, apply_snapshot, assertion, snapshot
from maimai_intelligence.registry import bootstrap, empty
from maimai_intelligence.research_package import read_package
from maimai_intelligence.snapshots import canonical
from tests.lab_fixture import write_package


def official_row(title="ソテリア", artist="Rafutsuri feat.桜あおい", **extra):
    return {
        "title": title,
        "artist": artist,
        "title_kana": "そてりあ" if title == "ソテリア" else title,
        "catcode": "maimai",
        "version": "26500",
        "image_url": "fixture.png",
        "dx_lev_bas": "4",
        "dx_lev_adv": "8",
        "dx_lev_exp": "12",
        "dx_lev_mas": "14",
        **extra,
    }


def admit(value, rows, region="JP", when="2026-09-17T05:00:00Z", decisions=None):
    raw = canonical(rows)
    source = snapshot(raw, region, {"url": URLS[region], "captured_at": when})
    review = (
        decisions
        if decisions is not None
        else {
            assertion(r): {"action": "admit", "evidence": "Authored metadata fixture"}
            for r in rows
            if not r.get("lev_utage")
        }
    )
    return apply_snapshot(
        value, raw, source, review, count_review="Authored fixture, complete controlled count"
    ), source


def fixture(root):
    package = write_package(root / "legacy-package", constants=True)
    _, retained = read_package(package)
    data = {
        "catalog": json.loads(retained["catalog.json"]),
        "navigation": json.loads(retained["navigation.json"]),
        "analysis": json.loads(retained["analysis.json"]),
        "snippets": json.loads(retained["snippets.json"]),
    }
    value = bootstrap(
        empty(),
        data,
        "legacy-fixture",
        source_inventory=json.loads(retained["source-inventory.json"]),
    )
    value, _ = admit(
        value,
        [
            official_row(),
            official_row("ANiMA", "xi", version="26503"),
            official_row("Link", "Artist One"),
            official_row("Link", "Artist Two"),
        ],
    )
    sid = next(sid for sid, s in value["songs"].items() if s["metadata"]["title"] == "ソテリア")
    value, _ = admit(
        value,
        [official_row(dx_lev_adv="7", version="26005")],
        region="INTL",
        decisions={
            assertion(official_row()): {
                "action": "link",
                "song_id": sid,
                "evidence": "Authored regional fixture",
            }
        },
    )
    return value, data, package
