"""Explicit download, prepare and static-site commands."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .bundles import prepare_player_bundle
from .chart_intelligence import read_catalog_pack, synthetic_catalog
from .site import build_site
from .snapshots import KamaitachiDownloader, atomic_json, download_snapshot, read_json


def main(argv=None):
    parser = argparse.ArgumentParser(description="maimai chart browser and offline personal views")
    commands = parser.add_subparsers(dest="command", required=True)
    download = commands.add_parser(
        "download", help="Read existing Kamaitachi scores into a snapshot store"
    )
    download.add_argument("username")
    download.add_argument(
        "--game", required=True, help="Exact Kamaitachi game identifier, e.g. maimaidx"
    )
    download.add_argument("--store", required=True, type=Path)
    prepare = commands.add_parser(
        "prepare", help="Calculate a personal bundle from a retained snapshot"
    )
    prepare.add_argument("--snapshot", required=True, type=Path)
    for command in (download, prepare):
        command.add_argument("--catalog", type=Path, required=command is prepare)
        command.add_argument("--catalog-version", required=command is prepare)
        command.add_argument("--mapping", type=Path, required=command is prepare)
        command.add_argument("--settings", type=Path)
        command.add_argument("--output", type=Path, required=command is prepare)
    site = commands.add_parser("site", help="Build a static browser from a reviewed public catalog")
    site.add_argument("--catalog", required=True, type=Path)
    site.add_argument("--catalog-version", required=True)
    site.add_argument("--output", required=True, type=Path)
    site.add_argument("--lab-package", type=Path)
    demo = commands.add_parser("demo", help="Build an explicitly fictional catalog preview")
    demo.add_argument("--output", required=True, type=Path)
    demo.add_argument("--lab-package", type=Path)
    lab = commands.add_parser(
        "lab", help="Build the preserved Challenge Lab from a pinned research package"
    )
    lab.add_argument("--package", required=True, type=Path)
    lab.add_argument("--output", required=True, type=Path)
    lab.add_argument("--catalog-version", required=True)
    release = commands.add_parser(
        "public-release", help="Prepare an allowlisted static release without publishing"
    )
    release.add_argument("--source", required=True, type=Path)
    release.add_argument("--output", required=True, type=Path)
    release.add_argument(
        "--previous-public",
        type=Path,
        help="Preceding immutable public release; retain its referenced URLs and permalink ledger",
    )
    release.add_argument(
        "--permalinks", type=Path, help="Preceding accepted release permalink ledger"
    )
    release.add_argument(
        "--song-redirects", type=Path, help="Reviewed registry song identity redirects"
    )
    args = parser.parse_args(argv)
    try:
        if args.command == "public-release":
            from .public_release import build_public_release

            result = build_public_release(
                args.source,
                args.output,
                permalinks=args.permalinks,
                song_redirects=args.song_redirects,
                previous_public=args.previous_public,
            )
            print(f"Prepared {result['catalogs']} catalogs in {result['files']} public files")
        elif args.command == "lab":
            from .lab import build_lab

            build_lab(args.package, args.output, catalog_version=args.catalog_version)
        elif args.command == "demo":
            build_site(
                synthetic_catalog()[0],
                args.output,
                catalog_version="synthetic-v1",
                lab_package=args.lab_package,
            )
        elif args.command == "site":
            build_site(
                read_catalog_pack(args.catalog),
                args.output,
                catalog_version=args.catalog_version,
                lab_package=args.lab_package,
            )
        else:
            prepare_requested = args.command == "prepare" or any(
                (args.catalog, args.mapping, args.output, args.catalog_version, args.settings)
            )
            if prepare_requested and not all(
                (args.catalog, args.mapping, args.output, args.catalog_version)
            ):
                raise ValueError(
                    "Bundle preparation requires --catalog, --catalog-version, "
                    "--mapping and --output"
                )
            if args.command == "download":
                snapshot = download_snapshot(
                    args.store,
                    args.username,
                    args.game,
                    downloader=KamaitachiDownloader(os.environ.get("KAMAITACHI_API_TOKEN")),
                )
                print("Snapshot saved: " + snapshot["snapshot_id"])
            else:
                snapshot = read_json(args.snapshot)
            if prepare_requested:
                from .chart_intelligence import ensure_separate_preparation_paths

                inputs = tuple(
                    p
                    for p in (
                        args.catalog,
                        args.mapping,
                        args.settings,
                        getattr(args, "snapshot", None),
                    )
                    if p
                )
                ensure_separate_preparation_paths(inputs, (args.output,))
                if args.command == "prepare":
                    snapshot_path = args.snapshot.resolve()
                    if snapshot_path.parent.parent.name == "captures":
                        store_root = snapshot_path.parent.parent.parent
                        if args.output.resolve().is_relative_to(store_root):
                            raise ValueError(
                                "Write derived personal files outside the immutable snapshot store"
                            )
                if args.command == "download" and args.output.resolve().is_relative_to(
                    args.store.resolve()
                ):
                    raise ValueError(
                        "Write derived personal files outside the immutable snapshot store"
                    )
                bundle = prepare_player_bundle(
                    read_catalog_pack(args.catalog),
                    snapshot,
                    read_json(args.mapping),
                    catalog_version=args.catalog_version,
                    settings=read_json(args.settings) if args.settings else None,
                )
                atomic_json(args.output, bundle)
                print("Personal file prepared")
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(f"Could not complete: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
