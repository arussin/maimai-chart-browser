"""Shared public route model consumed by Python generation and browser composition."""

import json
from importlib.resources import files
from urllib.parse import quote

MODEL = json.loads(
    files("maimai_intelligence.assets").joinpath("public-routes.json").read_text("utf-8")
)
LOCALES = MODEL["locales"]


def route(locale: str, kind: str, slug: str) -> str:
    if (
        locale not in LOCALES
        or kind not in MODEL["kinds"]
        or not slug
        or any(c in slug for c in "/\\?#")
    ):
        raise ValueError("Invalid canonical public route")
    return f"/{locale}/{kind}/{quote(slug, safe='-')}/"
