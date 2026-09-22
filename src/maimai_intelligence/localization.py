"""Compile the canonical, offline UI catalog. English source remains unchanged."""

import base64
import json
import re
from importlib.resources import files

LOCALES = ("zh-Hans", "ko", "ja")


def messages():
    combined = {}
    for path in sorted(
        files("maimai_intelligence.assets").joinpath("locales").iterdir(), key=lambda p: p.name
    ):
        if path.name.endswith(".json"):
            catalog = json.loads(path.read_text("utf-8"))
            for source, value in catalog.get("messages", {}).items():
                if source in combined:
                    raise ValueError(f"Duplicate translation source: {source}")
                combined[source] = value
    for source, translations in combined.items():
        if not source.strip() or set(translations) - {"$translate"} != set(LOCALES):
            raise ValueError(f"Incomplete translations: {source}")
        fields = sorted(re.findall(r"\{\d+\}", source))
        for locale, value in translations.items():
            if locale == "$translate":
                if any("{" + str(n) + "}" not in fields for n in value):
                    raise ValueError(f"Unknown translated parameter: {source}")
                continue
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Empty {locale} translation: {source}")
            if sorted(re.findall(r"\{\d+\}", value)) != fields:
                raise ValueError(f"Translation placeholders differ: {source} ({locale})")
    return combined


def localization_script(*, sources=None):
    assets = files("maimai_intelligence.assets")
    flags = {
        locale: "data:image/png;base64,"
        + base64.b64encode(assets.joinpath(f"flag-{country}.png").read_bytes()).decode("ascii")
        for locale, country in {"en": "us", "zh-Hans": "cn", "ko": "kr", "ja": "jp"}.items()
    }
    catalog = messages()
    if sources is not None:
        catalog = {source: catalog[source] for source in sorted(sources)}
    encoded = json.dumps(catalog, ensure_ascii=False, separators=(",", ":"))
    encoded = encoded.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    return (
        files("maimai_intelligence.assets")
        .joinpath("localization.js")
        .read_text("utf-8")
        .replace("__MAIMAI_MESSAGES__", encoded)
        .replace("__MAIMAI_FLAGS__", json.dumps(flags, separators=(",", ":")))
    )
