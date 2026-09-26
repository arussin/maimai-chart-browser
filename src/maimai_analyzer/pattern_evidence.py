"""Evidence classification and stable entry points for the phased-pair grammar."""

from .phased_pairs import CANDIDATE as CANDIDATE
from .phased_pairs import VERSION as VERSION
from .phased_pairs import phased_pairs as phased_pairs
from .phased_pairs import phased_pairs_normalized as phased_pairs_normalized


def registry_evidence():
    from .patterns import pattern_registry

    entries = []
    for original in pattern_registry()["entries"]:
        entry = dict(original)
        entry["evidence_kind"] = (
            "chart_trait"
            if entry["id"].startswith("trait.")
            else "scoped_compound"
            if entry["id"] == "pattern.umiyuri"
            else "structural_primitive"
            if entry["automatic_tagging_enabled"]
            else "compound_candidate"
        )
        entry["production_visible"] = False
        entry["promotion_status"] = "independent_real_passage_evaluation_pending"
        entry["default_prominence"] = (
            "background" if entry["id"] == "pattern.simultaneous_group" else "unknown"
        )
        entries.append(entry)
    return {
        "version": VERSION,
        "entries": entries,
        "promotion_gate": {
            "positive_passages": 20,
            "hard_negative_passages": 20,
            "held_out_precision": 0.9,
            "held_out_recall": 0.8,
        },
        "technique_policy": "Explanatory annotations only; no inferred compulsory hands",
    }
