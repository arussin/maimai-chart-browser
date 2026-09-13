"""Add cached public jackets and pinned version logos to a separate research package."""

import argparse
import hashlib
import io
import json
import shutil
import urllib.parse
import urllib.request
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from maimai_analyzer.dataset import SOURCE_LOCK
from maimai_intelligence.artwork import CATALOGUE_URL, JACKET_BASE, VERSION, match_jackets
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts.build_challenge_package import write

LOGO_REPO = "Matsuk1/JiETNG-maimai-dx-bot"
LOGO_REVISION = "f6eb5ebc6e1f3200b9769060a34325b2ea4e1eb7"
LOGO_BASE = f"https://raw.githubusercontent.com/{LOGO_REPO}/{LOGO_REVISION}/assets/versions/"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise ValueError("Unexpected public artwork redirect")


def download(url):
    allowed = url == CATALOGUE_URL or any(
        url.startswith(base) and "/" not in url.removeprefix(base)
        for base in (JACKET_BASE, LOGO_BASE)
    )
    if not allowed:
        raise ValueError("Unexpected public artwork origin")
    request = urllib.request.Request(url, headers={"User-Agent": "maimai-chart-artwork/1"})  # noqa: S310
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=12) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("Public artwork exceeds download limit")
    return raw


def thumbnail(raw, logo=False):
    from PIL import Image

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"} or image.width * image.height > 16000000:
                raise ValueError("Unsupported public artwork")
            image.thumbnail((160, 88) if logo else (128, 128), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.convert("RGBA" if logo else "RGB").save(output, "WEBP", quality=85, method=4)
            return output.getvalue()


def logo_filename(version):
    if version in {"maimai", "maimai PLUS"}:
        return version.lower().replace(" ", "_") + ".png"
    name = version.removeprefix("maimai ").removeprefix("DX ")
    if name in {"DX", "PLUS"}:
        name = "maimaiでらっくす" + ("_plus" if version.endswith("PLUS") else "")
    return name.lower().replace(" ", "_") + ".png"


def prepare(package_directory, output, cache, *, offline=False, refresh_metadata=False):
    source, output, cache = [Path(p).resolve() for p in (package_directory, output, cache)]
    if output == source or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Artwork output must be separate from the existing package")
    package = read_json(source / "package.json")
    if package.get("source") != SOURCE_LOCK or package.get("status") != "research_preview":
        raise ValueError("Expected the pinned nonpersonal research package")
    for entry in package["files"]:
        path = (source / entry["path"]).resolve()
        if path.parent != source:
            raise ValueError("Expected public package file")
        raw = path.read_bytes()
        if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Research input integrity mismatch")
    charts = json.loads((source / "catalog.json").read_text("utf-8"))
    navigation = read_json(source / "navigation.json")
    cache.mkdir(parents=True, exist_ok=True)

    def cached(url):
        path = cache / (hashlib.sha256(url.encode()).hexdigest() + ".source")
        if path.exists() and not (refresh_metadata and not offline and url == CATALOGUE_URL):
            return path.read_bytes()
        if offline:
            raise ValueError("Public artwork missing from offline cache")
        raw = download(url)
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(raw)
        temporary.replace(path)
        return raw

    catalogue_raw = cached(CATALOGUE_URL)
    matches = match_jackets(charts, json.loads(catalogue_raw))
    jobs = {JACKET_BASE + r["filename"]: False for r in matches.values()}
    logos = {
        version: LOGO_BASE + urllib.parse.quote(logo_filename(version))
        for version in navigation["versions"]
    }
    jobs.update({url: True for url in logos.values()})

    def image(job):
        url, logo = job
        try:
            raw = cached(url)
            converted = thumbnail(raw, logo)
            sha = hashlib.sha256(converted).hexdigest()
            path = "media/" + sha + ".webp"
            return (
                url,
                path,
                converted,
                {
                    "sha256": sha,
                    "bytes": len(converted),
                    "source": url,
                    "source_sha256": hashlib.sha256(raw).hexdigest(),
                },
            )
        except (OSError, ValueError, Warning):
            return url, None, None, None

    result = {
        "version": VERSION,
        "songs": {},
        "versions": {},
        "assets": {},
        "qualification": (
            "Display-only exact title and artist matches; not chart identity evidence."
        ),
        "catalogue_source": CATALOGUE_URL,
        "catalogue_sha256": hashlib.sha256(catalogue_raw).hexdigest(),
        "logo_source": {"repository": LOGO_REPO, "revision": LOGO_REVISION},
        "credit": "Jackets and maimai logos belong to SEGA and their respective rights holders. "
        "Version logos retained from Matsuk1/JiETNG-maimai-dx-bot.",
    }
    output.mkdir(parents=True, exist_ok=True)
    images = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for index, (url, path, raw, record) in enumerate(pool.map(image, jobs.items()), 1):
            if path:
                destination = output / path
                destination.parent.mkdir(exist_ok=True)
                if destination.exists():
                    if destination.read_bytes() != raw:
                        raise ValueError("Immutable public artwork differs")
                else:
                    temporary = destination.with_suffix(".tmp")
                    temporary.write_bytes(raw)
                    temporary.replace(destination)
                result["assets"][path] = record
                images[url] = path
            if index % 100 == 0:
                print(json.dumps({"artwork_prepared": index, "total": len(jobs)}), flush=True)
    for song_id, match in matches.items():
        path = images.get(JACKET_BASE + match["filename"])
        if path:
            result["songs"][song_id] = {k: match[k] for k in ("title", "artist")} | {"path": path}
    result["versions"] = {v: images[url] for v, url in logos.items() if url in images}
    result["coverage"] = {
        "song_entries": len({c["song_id"] for c in charts}),
        "matched": len(matches),
        "jackets": len(result["songs"]),
        "version_logos": len(result["versions"]),
        "missing_downloads": len(jobs) - len(images),
    }
    entries = [r for r in package["files"] if r["path"] != "artwork.json"]
    for entry in entries:
        shutil.copyfile(source / entry["path"], output / entry["path"])
    entries.append(write(output, "artwork.json", result))
    atomic_json(output / "package.json", {**package, "files": entries, "artwork_version": VERSION})
    return result["coverage"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package")
    parser.add_argument("output")
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare(args.package, args.output, args.cache, offline=args.offline)))
