"""Conservative shared identities for metadata, reference counts and discovery."""

import json
import re
from functools import lru_cache
from importlib.resources import files
from typing import Any

from .identity_policy import label as label
from .identity_policy import normalized


@lru_cache(maxsize=1)
def rules():
    return json.loads(
        files("maimai_intelligence").joinpath("catalog_identity_aliases.json").read_text("utf-8")
    )


def discovery_labels(row: dict[str, Any]) -> set[str]:
    title = normalized(row["title"])
    # Discovery hints only: the fetched page must still prove the full identity.
    hints = {title, *row.get("aliases", [])}
    hints.add(re.sub(r"\s*[（(\[].*?[）)\]]$", "", title))
    return {label(hint) for hint in hints if hint}


def identity(row):
    result = dict(row)
    url = row.get("source_url") or row.get("wiki_url")
    for rule in rules():
        if (
            url == rule["source_url"]
            and row.get("format") == rule["format"]
            and all(
                label(row.get(field, "")) == label(rule["source"][field])
                for field in ("title", "artist")
            )
        ):
            result.update(rule["catalog"])
            break
    return result


def key(row: dict[str, Any]) -> tuple[str, str, str, str]:
    row = identity(row)
    return (
        label(row["title"]),
        label(row["artist"]).replace("|", "/"),
        row["format"],
        row["difficulty"],
    )
