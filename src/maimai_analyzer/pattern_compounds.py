"""Scoped compound forms; community naming is separate from review qualification."""

from .phased_pairs import phased_pairs_normalized

DEFINITIONS = {
    "pattern.umiyuri": (
        [
            "timing",
            "beat_grid",
            "positions",
            "authored_simultaneity",
            "slide_movement",
            "slide_wait",
            "slide_groups",
        ],
        "Scoped recurring-pair form: at least four one-beat star/tap pairs at two "
        "positions, alternating which position is the star, with exactly one "
        "intervening tap at each half beat. The previous slide launches at the next "
        "pair within two microseconds of timing rounding. Each star links one path; "
        "extra intervening inputs break the form. Rotation, reflection and path "
        "shapes are unrestricted; omitted taps and changing pair positions are "
        "outside this version. This is an experimental form of the named family, "
        "not a complete or independently reviewed community classifier.",
    ),
}


def detect_compounds(chart):
    result = {"pattern.umiyuri": []}
    if not set(DEFINITIONS["pattern.umiyuri"][0]) <= set(chart["capabilities"]):
        return result
    by_head = {s["head_id"]: s for s in chart["slides"] if s["head_id"]}
    for match in phased_pairs_normalized(chart, strict=True)["occurrences"]:
        paths = [by_head[e] for e in match["event_ids"] if e in by_head]
        result["pattern.umiyuri"].append(
            (
                match["start_us"],
                match["end_us"],
                match["event_ids"],
                [s["path_id"] for s in paths],
                {
                    "pair_count": match["pair_count"],
                    "form": "alternating-pairs-with-intervening-taps-v1",
                    "family_coverage": "scoped_form",
                    "community_review": "not_independently_reviewed",
                    "onset_count": len(match["event_ids"]),
                },
            )
        )
    return result
