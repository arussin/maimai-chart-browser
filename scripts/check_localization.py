"""Fail on missing static or generated UI copy; English is the canonical key."""

import argparse
import json
import re
from html.parser import HTMLParser
from importlib.resources import files

from maimai_analyzer.patterns import pattern_registry
from maimai_intelligence.localization import messages

TEMPLATES = (
    "challenge-review.html",
    "settings-menu.html",
    "analytics-controls.html",
    "creator-support.html",
    "support-footer.html",
    "support.html",
    "support-return.html",
)


class CopyParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.values = set()
        self.skip = None

    def handle_starttag(self, tag, attributes):
        if tag in {"script", "style"}:
            self.skip = tag
        for key, value in attributes:
            if key in {"aria-label", "aria-valuetext", "title", "placeholder", "alt"}:
                self.add(value)

    def handle_endtag(self, tag):
        if tag == self.skip:
            self.skip = None

    def add(self, value):
        value = value.strip()
        if value and re.search(r"[A-Za-z]", value) and not value.startswith("__"):
            self.values.add(value)

    def handle_data(self, value):
        if not self.skip:
            self.add(value)


def inventory():
    assets = files("maimai_intelligence.assets")
    result = {}
    for name in TEMPLATES:
        parser = CopyParser()
        parser.feed(assets.joinpath(name).read_text("utf-8"))
        for value in parser.values:
            result.setdefault(value, []).append(name)
    for entry in pattern_registry()["entries"]:
        result.setdefault(entry["display_name"], []).append(entry["pattern_id"])
        # The visible alias line is authored data, separate from the ID.
        aliases = " · ".join(a if isinstance(a, str) else a["text"] for a in entry["aliases"])
        if aliases:
            result.setdefault(aliases, []).append(entry["pattern_id"] + ":aliases")
    book = json.loads(assets.joinpath("pattern-lessons.json").read_text("utf-8"))
    for pid, lesson in book["lessons"].items():
        for key in ("summary", "watch"):
            result.setdefault(lesson[key], []).append(pid + ":" + key)
        model = lesson["example"]
        for text in [
            model["unit"],
            *model.get("slide_labels", []),
            *(band[2] for band in model["bands"]),
            *(series["label"] for series in model.get("series", [])),
        ]:
            result.setdefault(text, []).append(pid + ":illustration")
    return result


def missing():
    known = set(messages())
    for path in files("maimai_intelligence.assets").joinpath("locales").iterdir():
        if path.name.endswith(".json"):
            known.update(json.loads(path.read_text("utf-8")).get("invariants", {}))
    return {key: locations for key, locations in sorted(inventory().items()) if key not in known}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--missing", action="store_true")
    args = parser.parse_args()
    pending = missing()
    if args.missing:
        print(json.dumps(pending, ensure_ascii=False, indent=2))
    elif pending:
        raise SystemExit("Unlocalized UI text:\n" + "\n".join(pending))
    else:
        print(f"Validated {len(messages())} messages in zh-Hans, ko and ja")


if __name__ == "__main__":
    main()
