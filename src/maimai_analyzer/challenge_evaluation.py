"""Explicit review judgments, uncertainty and held-out adoption gates."""

from __future__ import annotations

from collections import Counter, defaultdict

from .challenge_similarity import POLICY

JUDGMENTS = {"Useful", "Partly", "Not useful", "Uncertain"}


def evaluate_review(benchmark, review, supplied):
    if (
        supplied.get("version") != "challenge-judgments-1"
        or supplied.get("benchmark_hash") != benchmark["benchmark_hash"]
        or supplied.get("policy") != POLICY
    ):
        raise ValueError("Judgments belong to a different benchmark or policy")
    allowed = {(item["query_id"], m["chart_id"]) for item in review for m in item["candidates"]}
    partitions = {q["chart_id"]: q["partition"] for q in benchmark["queries"]}
    by_query = defaultdict(dict)
    for row in supplied.get("judgments", []):
        pair = (row["query_id"], row["candidate_id"])
        if pair not in allowed or row.get("judgment") not in JUDGMENTS:
            raise ValueError("Unknown review pair or judgment")
        if row["candidate_id"] in by_query[row["query_id"]]:
            raise ValueError("Duplicate judgment")
        by_query[row["query_id"]][row["candidate_id"]] = row["judgment"]
    totals = Counter()
    completed = Counter()
    successful = Counter()
    for qid, judgments in by_query.items():
        totals.update(judgments.values())
        if len(judgments) == 5 and "Uncertain" not in judgments.values():
            partition = partitions[qid]
            completed[partition] += 1
            successful[partition] += sum(value == "Useful" for value in judgments.values()) >= 3
    expected = sum(q["partition"] == "held_out" for q in benchmark["queries"])
    enough = (
        benchmark.get("complete") is True and expected > 0 and completed["held_out"] == expected
    )
    rate = successful["held_out"] / completed["held_out"] if completed["held_out"] else None
    return {
        "policy": POLICY,
        "judgment_counts": dict(totals),
        "fully_judged_queries": dict(completed),
        "successful_queries": dict(successful),
        "held_out_success_fraction": rate,
        "held_out_target_met": enough and rate >= 0.8,
        "baseline_comparison": "pending matched baseline judgments",
        "production_adoption": False,
        "reason": "Promotion also requires judged baselines and source/pattern gates.",
    }
