"""Verified packaged browser graph and data-only configuration, shared by both renderers."""

from __future__ import annotations

import hashlib
import json
import re
from importlib.resources import files
from pathlib import Path, PurePosixPath

from .localization import localization_data
from .snapshots import canonical
from .song_search import song_search_data


def browser_configuration(*, player_pilot=False, player_maishift=False):
    assets = files("maimai_intelligence.assets")
    return {
        **localization_data(),
        "search": song_search_data(),
        "theme": json.loads(assets.joinpath("chart-theme.json").read_text("utf-8")),
        "lessons": json.loads(assets.joinpath("pattern-lessons.json").read_text("utf-8")),
        "features": {"maishift": bool(player_maishift or player_pilot)},
        "support": json.loads(assets.joinpath("support-config.json").read_text("utf-8")),
        "pilot": bool(player_pilot),
    }


def read_browser_assets(read):
    """Validate one generated dependency graph using a bounded byte reader."""
    raw = read("browser-assets.json", 256 * 1024)
    manifest = json.loads(raw)
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"version", "tool", "entries", "assets", "replaces"}
        or manifest["version"] != 1
        or not isinstance(manifest["tool"], str)
        or not isinstance(manifest["entries"], dict)
        or set(manifest["entries"]) != {"hosted", "offline"}
        or not isinstance(manifest["assets"], dict)
        or not 2 <= len(manifest["assets"]) <= 128
        or not isinstance(manifest["replaces"], list)
        or not all(isinstance(name, str) for name in manifest["replaces"])
        or len(set(manifest["replaces"])) != len(manifest["replaces"])
        or not all(
            isinstance(name, str) and name in manifest["assets"]
            for name in manifest["entries"].values()
        )
    ):
        raise ValueError("Invalid generated browser dependency manifest")
    assets = {}
    for name, record in manifest["assets"].items():
        if (
            not re.fullmatch(r"browser/[A-Za-z0-9][A-Za-z0-9._-]*\.js", name)
            or not isinstance(record, dict)
            or set(record) != {"sha256", "bytes"}
            or not isinstance(record["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", record["sha256"])
            or type(record["bytes"]) is not int
            or not 0 < record["bytes"] <= 2 * 1024 * 1024
        ):
            raise ValueError("Invalid generated browser asset reference")
        body = read(name, 2 * 1024 * 1024)
        if len(body) != record["bytes"] or hashlib.sha256(body).hexdigest() != record["sha256"]:
            raise ValueError("Generated browser asset integrity mismatch")
        assets[name] = body
    assets["browser-assets.json"] = raw
    return manifest, assets


def browser_assets():
    assets = files("maimai_intelligence.assets")

    def read(name, limit):
        with assets.joinpath(*PurePosixPath(name).parts).open("rb") as stream:
            raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("Packaged browser asset exceeds its size limit")
        return raw

    return read_browser_assets(read)


def offline_script():
    manifest, assets = browser_assets()
    return assets[manifest["entries"]["offline"]].decode("utf-8")


def write_browser_assets(output, *, player_pilot=False, player_maishift=False):
    manifest, assets = browser_assets()
    root = Path(output)
    for name, data in assets.items():
        target = root.joinpath(*PurePosixPath(name).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (root / "browser-config.json").write_bytes(
        canonical(browser_configuration(player_pilot=player_pilot, player_maishift=player_maishift))
    )
    return manifest
