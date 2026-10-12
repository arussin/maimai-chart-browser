"""Render the bundled localized import READMEs, without remote help requests."""

import html
import re
from importlib.resources import files
from urllib.parse import urlsplit

_ANCHORS = {"direct-connections", "session-report", "maishift", "kamaitachi", "diving-fish"}


def _inline_text(source):
    escaped = html.escape(source)
    escaped = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", escaped)
    return re.sub(r"\*\*([^*\n]+)\*\*", r"<strong>\1</strong>", escaped)


def _inline(source):
    """Render the bundled prose's small Markdown subset; never allow raw HTML."""
    output = []
    end = 0
    for match in re.finditer(r"\[([^\]\n]+)\]\((https://[^\s<>]+)\)", source):
        output.append(_inline_text(source[end : match.start()]))
        label, destination = match.groups()
        try:
            url = urlsplit(destination)
            safe = (
                url.scheme == "https"
                and bool(url.hostname)
                and not url.username
                and not url.password
            )
        except ValueError:
            safe = False
        if safe:
            output.append(
                f'<a href="{html.escape(destination, quote=True)}" target="_blank" '
                f'rel="noopener noreferrer">{_inline_text(label)}</a>'
            )
        else:
            output.append(_inline_text(match.group()))
        end = match.end()
    output.append(_inline_text(source[end:]))
    return "".join(output)


def _render_markdown(source):
    blocks = []
    for block in source.strip().split("\n\n"):
        anchor = re.fullmatch(r'<a id="([a-z-]+)"></a>', block)
        if anchor and anchor.group(1) in _ANCHORS:
            blocks.append(block)
            continue
        if all(re.match(r"\d+\. ", line) for line in block.splitlines()):
            items = "".join(
                f"<li>{_inline(line.split('. ', 1)[1])}</li>" for line in block.splitlines()
            )
            blocks.append(f"<ol>{items}</ol>")
            continue
        tag = "h1" if block.startswith("# ") else "h2" if block.startswith("## ") else "p"
        content = block.lstrip("# ") if tag != "p" else block
        blocks.append(f"<{tag}>{_inline(content)}</{tag}>")
    return "".join(blocks)


def build_player_help(root):
    assets = files("maimai_intelligence.assets")
    languages = {
        "en": "English",
        "zh-Hans": "简体中文",
        "ko": "한국어",
        "ja": "日本語",
        "id": "Bahasa Indonesia",
    }
    navigation = " · ".join(
        f'<a href="player-import-help.{locale}.html" lang="{locale}">{name}</a>'
        for locale, name in languages.items()
    )
    for locale in languages:
        suffix = "" if locale == "en" else "." + locale
        source = assets.joinpath(f"import-help/README{suffix}.md").read_text("utf-8")
        title = html.escape(source.splitlines()[0].removeprefix("# "))
        document = (
            f'<!doctype html><html lang="{locale}"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="referrer" content="no-referrer">'
            '<meta name="robots" content="noindex,nofollow">'
            f"<title>{title} · maimai.party</title>"
            '<link rel="stylesheet" href="player-import-help.css">'
            "</head><body><main>"
            f"<nav>{navigation}</nav>{_render_markdown(source)}</main></body></html>"
        )
        (root / f"player-import-help.{locale}.html").write_text(document, encoding="utf-8")
    (root / "player-import-help.css").write_bytes(
        assets.joinpath("player-import-help.css").read_text("utf-8").encode("utf-8")
    )
    (root / "maishift-favicon.ico").write_bytes(
        assets.joinpath("maishift-favicon.ico").read_bytes()
    )
