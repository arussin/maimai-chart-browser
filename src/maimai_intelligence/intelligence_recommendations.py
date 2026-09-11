"""Opt-in consumers of catalog structure and an explicitly scoped private overlay."""

from __future__ import annotations

from maimai_analyzer.similarity import query_profiles
from maimai_analyzer.wire import decode_pack

from .recommendations.rating import PersonalBest, RatingChart, RatingPolicy, rating_opportunities
from .recommendations.scoring import (
    SCORING_VERSION,
    PracticeGoal,
    attempt_reachability,
    rescore_relevance,
    retained_attempts,
    score_practice_candidate,
)
from .recommendations.selection import select_shortlist, structural_card


def prepare_recommendations(
    pack,
    overlay,
    after_payload,
    mapping,
    *,
    policy=None,
    complete=False,
    practice_pattern=None,
    practice_goal=None,
    quotas=(2, 2, 1),
):
    if "wire_version" in pack:
        pack = decode_pack(pack)
    if "evaluation_only" in pack or any(
        chart.get("source_kind") == "public_transcription_evaluation"
        or chart.get("coverage", {}).get("game_identity") == "unverified"
        or any(
            occurrence.get("evidence", {}).get("source_kind") == "public_transcription_evaluation"
            for occurrence in chart.get("occurrences", [])
        )
        for chart in pack.get("charts", [])
    ):
        raise ValueError("Evaluation catalogs cannot supply private recommendations")
    if len(quotas) != 3 or any(type(v) is not int or not 0 <= v <= 20 for v in quotas):
        raise ValueError("shortlist quotas must be three integers in 0..20")
    charts = sorted(pack["charts"], key=lambda chart: chart["chart_id"])
    by_id = {c["chart_id"]: c for c in charts}
    recorded = {entry["chart_id"] for entry in overlay["entries"]}
    cutoff = overlay["coverage"]["cutoff_ms"]
    if practice_goal is not None and not isinstance(practice_goal, PracticeGoal):
        practice_goal = PracticeGoal.from_mapping(practice_goal)
    if practice_goal is not None and practice_pattern not in (None, practice_goal.pattern_id):
        raise ValueError("Practice pattern conflicts with the explicit practice goal")
    goal = practice_goal or (PracticeGoal(practice_pattern) if practice_pattern else None)
    practice_pattern = goal.pattern_id if goal else None
    if goal and any(item.chart_id not in by_id for item in goal.prerequisites):
        raise ValueError("Prerequisite chart ID is absent from the supplied exact catalog")
    histories, seen_attempts = {}, {}
    for entry in overlay["entries"]:
        cid = entry["chart_id"]
        if cid in histories:
            raise ValueError("Duplicate player overlay chart ID")
        records = retained_attempts(entry.get("attempts", []), as_of=cutoff)
        for record in records:
            aid = record["attempt_id"]
            if aid in seen_attempts and seen_attempts[aid] != cid:
                raise ValueError("Attempt ID is assigned to multiple exact charts")
            seen_attempts[aid] = cid
        histories[cid] = records
    diagnostics, rating_cards, practice, discovery = [], [], [], []
    practice_by_chart, practice_order = {}, {}
    practice_match_count = 0
    if policy is not None:
        rules = RatingPolicy.from_mapping(policy)
        body = after_payload.get("body", after_payload)
        scoped_charts = {}
        for chart in charts:
            cid, release = chart["chart_id"], chart.get("release")
            if chart.get("region") != rules.region:
                diagnostics.append(f"rating_region_mismatch_or_unknown:{cid}")
            elif (
                not isinstance(release, str)
                or not release.strip()
                or release.casefold() == "unknown"
            ):
                diagnostics.append(f"rating_release_unknown:{cid}")
            else:
                scoped_charts[cid] = chart
        retained_versions = {}
        for chart in body.get("charts", []):
            version = chart.get("data", {}).get("displayVersion")
            if version is not None:
                retained_versions.setdefault(chart.get("chartID"), set()).add(version)
        pbs = []
        for pb in body["pbs"]:
            cid = mapping.get(pb.get("chartID"))
            if cid not in scoped_charts:
                complete = False
                diagnostics.append(f"rating_pb_scope_unresolved:{cid or 'unmapped'}")
                continue
            versions = retained_versions.get(pb.get("chartID"))
            if versions is not None and versions != {scoped_charts[cid]["release"]}:
                complete = False
                diagnostics.append(f"rating_retained_release_mismatch:{cid}")
                continue
            pbs.append(
                PersonalBest(
                    cid,
                    pb["scoreData"]["percent"],
                    pb["scoreData"].get("lamp", "CLEAR"),
                    pb["calculatedData"]["rate"],
                    pb.get("timeAchieved"),
                )
            )
        rating_charts = [
            RatingChart(
                c["chart_id"],
                c["song_id"],
                c.get("release", "unknown"),
                c.get("constant"),
                c.get("availability", "unknown"),
            )
            for c in scoped_charts.values()
        ]
        rating = rating_opportunities(pbs, rating_charts, rules, complete=complete, as_of=cutoff)
        rating_cards = rating["opportunities"]
        for card in rating_cards:
            card["reachability"] = attempt_reachability(
                histories.get(card["chart_id"], []),
                card["target_achievement"],
                card["target_lamp"],
                as_of=cutoff,
            )
        diagnostics.extend(rating["diagnostics"])
        diagnostics.append(
            f"Conditional rating policy: {rules.policy_id} / {rules.release} / "
            f"{rules.region}; evidence {rules.verification}."
        )
    else:
        diagnostics.append(
            "Exact rating opportunities need an explicit reviewed release/region policy "
            "and complete mapped PB snapshot. Legacy Targets remain available."
        )
    eligible = {c["chart_id"] for c in charts if c.get("availability") == "available"}
    # A recorded chart is an exploration anchor, not a diagnosed player weakness.
    for cid in sorted(recorded):
        query = by_id.get(cid)
        if query is None:
            continue
        for role, mode, pattern in (
            ("practice", "easier", practice_pattern),
            ("discovery", "discovery", None),
        ):
            if not quotas[1 if role == "practice" else 2]:
                continue
            if role == "practice" and not pattern:
                continue
            # Score all adequate practice candidates, not a prefix of nearest
            # neighbors. The similarity API limits results per query to 100.
            batches = (
                [charts[i : i + 100] for i in range(0, len(charts), 100)]
                if role == "practice"
                else [charts]
            )
            matches = []
            for batch in batches:
                matches.extend(
                    query_profiles(
                        query,
                        batch,
                        mode=mode,
                        pattern_id=pattern,
                        eligible_ids=eligible,
                        recorded_ids=recorded,
                        limit=100 if role == "practice" else 20,
                    )
                )
            for match in matches:
                target = by_id[match["chart_id"]]
                if role == "practice":
                    practice_match_count += 1
                    order = (match["distance"], cid)
                    if (
                        target["chart_id"] in practice_order
                        and practice_order[target["chart_id"]] <= order
                    ):
                        continue
                differences = [
                    {
                        "feature": k,
                        **v,
                        "direction": "lower"
                        if v["delta"] < 0
                        else "higher"
                        if v["delta"] > 0
                        else "same",
                    }
                    for k, v in match["differences"].items()
                ]
                card = structural_card(
                    {
                        "chart_id": target["chart_id"],
                        "song_id": target["song_id"],
                        "supported": True,
                        "occurrences": target.get("occurrences", []),
                        "differences": differences,
                        "flow": target.get("flow"),
                        "limitations": match["explanation"],
                        "local_demand_relation": match.get("local_demand_relation"),
                    },
                    pattern_id=pattern,
                    role=role,
                    query_chart_id=cid,
                )
                if card:
                    card["context_patterns"] = sorted(
                        {
                            tag["pattern_id"]
                            for tag in target.get("tags", [])
                            if tag.get("status") in {"detected", "reviewed-present"}
                        }
                    )
                    if role == "practice":
                        prior = practice_by_chart.get(target["chart_id"])
                        card["practice_score"] = (
                            rescore_relevance(prior["practice_score"], match)
                            if prior
                            else score_practice_candidate(
                                target,
                                match,
                                goal,
                                histories=histories,
                                as_of=cutoff,
                            )
                        )
                        if card["practice_score"] is None:
                            continue
                        card["reachability"] = attempt_reachability(
                            histories.get(card["chart_id"], []),
                            goal.target_achievement,
                            goal.target_lamp,
                            as_of=cutoff,
                        )
                        windows = len(card["supporting_occurrences"])
                        card["objective"] = (
                            f"Compare the {windows} supplied supporting occurrence windows "
                            "and try their authored timing at the measured lower mean "
                            "onset rate within these selected runs."
                        )
                        if goal.target_achievement is not None:
                            card["target_achievement"] = float(goal.target_achievement)
                            card["target_lamp"] = goal.target_lamp
                            card["objective"] += (
                                " Selected performance objective: "
                                f"{float(goal.target_achievement):.4f}%"
                                f" with {goal.target_lamp} or better."
                            )
                        isolation = next(
                            term["value"]
                            for term in card["practice_score"]["terms"]
                            if term["name"] == "isolation"
                        )
                        if isolation is None:
                            card["intended_role"] = (
                                "pattern candidate; surrounding isolation unknown"
                            )
                        elif isolation < 0.25:
                            card["intended_role"] = (
                                "pattern amid interference; uncertain transfer test"
                            )
                        card["evidence_limitations"].append(
                            "Practice score weights are provisional preferences; "
                            "missing terms retain uncertainty bounds."
                        )
                        card["local_demand_relation"] = match.get("local_demand_relation")
                        practice_by_chart[target["chart_id"]] = card
                        practice_order[target["chart_id"]] = order
                    else:
                        discovery.append(card)
    practice = list(practice_by_chart.values())
    result = select_shortlist(rating_cards, practice, discovery, quotas=quotas)
    result["practice_scoring"] = {
        "policy_id": SCORING_VERSION,
        "goal": goal.metadata() if goal else None,
        "candidate_match_count": practice_match_count,
        "unique_candidate_count": len({card["chart_id"] for card in practice}),
        "calibration": "Unvalidated engineering preferences; synthetic tests only.",
    }
    result["diagnostics"] = diagnostics + result["diagnostics"]
    result["diagnostics"].append(
        "Individual rating gains compete for pool slots; do not add them. "
        "Reachability and learning benefit are unverified."
    )
    if not practice_pattern:
        result["diagnostics"].append(
            "Select a pattern explicitly to request a simpler practice setting."
        )
    return result
