"""Render the bundled localized import READMEs, without remote help requests."""

import html
import re
from importlib.resources import files


def build_player_help(root):
    assets = files("maimai_intelligence.assets")
    languages = {"en": "English", "zh-Hans": "简体中文", "ko": "한국어", "ja": "日本語"}
    navigation = " · ".join(
        f'<a href="player-import-help.{locale}.html" lang="{locale}">{name}</a>'
        for locale, name in languages.items()
    )
    for locale in languages:
        suffix = "" if locale == "en" else "." + locale
        source = assets.joinpath(f"import-help/README{suffix}.md").read_text("utf-8")
        blocks = []
        for block in source.strip().split("\n\n"):
            if re.fullmatch(r'<a id="(?:session-report|maishift)"></a>', block):
                blocks.append(block)
                continue
            tag = "h1" if block.startswith("# ") else "h2" if block.startswith("## ") else "p"
            content = block.lstrip("# ") if tag != "p" else block
            blocks.append(f"<{tag}>{html.escape(content)}</{tag}>")
        title = html.escape(source.splitlines()[0].removeprefix("# "))
        document = (
            f'<!doctype html><html lang="{locale}"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="referrer" content="no-referrer">'
            '<meta name="robots" content="noindex,nofollow">'
            f"<title>{title} · maimai.party</title>"
            '<link rel="stylesheet" href="player-import-help.css">'
            "</head><body><main>"
            f"<nav>{navigation}</nav>{''.join(blocks)}</main></body></html>"
        )
        (root / f"player-import-help.{locale}.html").write_text(document, encoding="utf-8")
    (root / "player-import-help.css").write_bytes(
        assets.joinpath("player-import-help.css").read_text("utf-8").encode("utf-8")
    )
    (root / "maishift-favicon.ico").write_bytes(
        assets.joinpath("maishift-favicon.ico").read_bytes()
    )
