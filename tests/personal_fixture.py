"""Entirely authored public catalog and private score fixtures."""

from maimai_intelligence.bundles import catalog_reference, prepare_player_bundle
from maimai_intelligence.chart_intelligence import synthetic_catalog
from maimai_intelligence.snapshots import normalize_snapshot


def fixture():
    pack, _ = synthetic_catalog()
    cutoff = 1_779_988_200_000
    charts = [c for c in pack["charts"] if c.get("availability") == "available"]
    pbs = {"pbs": [], "charts": [], "songs": []}
    attempts = []
    for chart in charts[:3]:
        cid = chart["chart_id"]
        pbs["charts"].append({"chartID": cid, "data": {"displayVersion": "Synthetic release"}})
        pbs["pbs"].append(
            {
                "chartID": cid,
                "timeAchieved": cutoff - 10000,
                "scoreData": {"percent": 95.0, "lamp": "CLEAR"},
                "calculatedData": {"rate": 180},
            }
        )
        attempts.append(
            {
                "chartID": cid,
                "scoreID": f"attempt:{cid}",
                "timeAchieved": cutoff - 1000,
                "scoreData": {"percent": 94.0, "lamp": "CLEAR"},
                "calculatedData": {"rate": 170},
            }
        )
    snapshot = normalize_snapshot(
        pbs,
        {"scores": attempts},
        cutoff_ms=cutoff,
        source={
            "provider": "kamaitachi",
            "username": "fictional-private-player",
            "game": "maimaidx",
        },
    )
    mapping = {
        "schema_version": "1.0.0",
        "provider": "kamaitachi",
        "verification": "reviewed",
        "source_ids": ["authored-test-only"],
        "catalog": catalog_reference(pack, "synthetic-v1"),
        "charts": {c["chart_id"]: c["chart_id"] for c in charts},
    }
    settings = {
        "complete": True,
        "policy": {
            "policy_id": "authored-test",
            "release": "Synthetic release",
            "region": "Synthetic",
            "current_versions": ["Synthetic release"],
            "coefficient_bands": [["0", "20"], ["97", "21"], ["100", "22"], ["100.5", "23"]],
            "ap_bonus": 0,
            "source_ids": ["authored-not-game-coefficients"],
            "verification": "synthetic",
        },
    }
    bundle = prepare_player_bundle(
        pack, snapshot, mapping, catalog_version="synthetic-v1", settings=settings
    )
    return pack, snapshot, mapping, settings, bundle
