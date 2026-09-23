"""Installed corpus command family. No command publishes or changes account settings."""

from __future__ import annotations

import argparse
import json
from functools import partial
from pathlib import Path
from typing import Any

from .corpus_attempts import PATH_OPTIONS, resume_options, verify_attempt
from .corpus_update import implementation_hash, prepare_update, verify_candidate
from .corpus_workbench import (
    diff_runs,
    inspect_registry,
    inspect_run,
    write_inspection,
    write_workbench,
)
from .snapshots import read_json
from .source_identity import source_implementation_hash


def add_commands(commands: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    corpus = commands.add_parser(
        "corpus", help="Prepare, explain and verify retained public corpus evidence"
    )
    actions = corpus.add_subparsers(dest="corpus_command", required=True)
    prepare = actions.add_parser(
        "prepare", help="Prepare from retained inputs; acquisition requires --online"
    )
    prepare.add_argument("--store", required=True, type=Path)
    prepare.add_argument("--previous-browser", required=True, type=Path)
    for name in (
        "previous-public",
        "package",
        "registry",
        "artwork-cache",
        "mai-notes-snapshot",
        "reviews",
        "overrides",
    ):
        prepare.add_argument("--" + name, type=Path)
    prepare.add_argument("--revision")
    prepare.add_argument("--online", action="store_true")
    for action in ("resume", "replay"):
        command = actions.add_parser(
            action, help="Create a new attempt from verified predecessor inputs"
        )
        command.add_argument("--from", dest="predecessor", type=Path, required=True)
        command.add_argument(
            "--source-root", type=Path, help="Exact producer checkout for an owner-created attempt"
        )
        command.add_argument(
            "--input",
            action="append",
            default=[],
            metavar="NAME=PATH",
            help="Use a relocated retained input only when its complete inventory is unchanged",
        )
        if action == "resume":
            command.add_argument("--online", action="store_true")
    inspect = actions.add_parser("inspect", help="Explain a local run without changing it")
    subject = inspect.add_mutually_exclusive_group(required=True)
    subject.add_argument("--run", type=Path)
    subject.add_argument(
        "--registry", type=Path, help="Inspect a retained registry without claiming a completed run"
    )
    inspect.add_argument("--identity")
    inspect.add_argument(
        "--workbench", type=Path, help="Write a read-only HTML view outside the run"
    )
    compare = actions.add_parser(
        "diff", help="Compare canonical records and complete artifact inventories"
    )
    compare.add_argument("before", type=Path)
    compare.add_argument("after", type=Path)
    verify = actions.add_parser(
        "verify", help="Verify retained inputs and completed candidate hashes"
    )
    verify.add_argument("--run", type=Path, required=True)
    verify.add_argument(
        "--source-root", type=Path, help="Exact producer checkout for an owner-created attempt"
    )

    verify.add_argument(
        "--input",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="Verify a relocated retained input against the original receipt",
    )


def input_locations(values: list[str]) -> dict[str, Path | str]:
    result: dict[str, Path | str] = {}
    for value in values:
        name, separator, path = value.partition("=")
        name = name.replace("-", "_")
        if name not in PATH_OPTIONS or not separator or not path.strip():
            raise ValueError("Expected a known attempt input NAME=PATH")
        if name in result:
            raise ValueError("Duplicate attempt input location")
        result[name] = Path(path)
    return result


def execute(args: argparse.Namespace) -> None:
    result: dict[str, Any]
    action = args.corpus_command
    source_root = getattr(args, "source_root", None)
    locations = input_locations(getattr(args, "input", []))
    identity = (
        partial(source_implementation_hash, source_root) if source_root else implementation_hash
    )
    if action == "prepare":
        run = prepare_update(
            args.store,
            args.previous_browser,
            previous_public=args.previous_public,
            package=args.package,
            registry=args.registry,
            revision=args.revision,
            artwork_cache=args.artwork_cache,
            mai_notes_snapshot=args.mai_notes_snapshot,
            overrides=args.overrides,
            coverage_reviews=read_json(args.reviews) if args.reviews else {},
            offline=not args.online,
        )
        result = {"status": "prepared", "run": str(run), "published": False}
    elif action in {"resume", "replay"}:
        previous = args.predecessor.resolve()
        if previous.parent.name != "runs":
            raise ValueError("Resume from the original store/runs attempt")
        options = resume_options(
            previous,
            identity(),
            replay=action == "replay",
            online=getattr(args, "online", False),
            input_locations=locations,
        )
        run = prepare_update(previous.parent.parent, implementation=identity, **options)
        result = {
            "status": "prepared",
            "run": str(run),
            "predecessor": previous.name,
            "published": False,
        }
    elif action == "diff":
        result = diff_runs(args.before, args.after)
    elif action == "verify":
        verify_attempt(args.run, identity(), input_locations=locations)
        if (args.run / "ready.json").exists():
            receipt = verify_candidate(args.run, implementation=identity, input_locations=locations)
            result = {
                "status": "verified_candidate",
                "files": len(receipt["files"]),
                "published": False,
            }
        else:
            result = {
                "status": "verified_inputs_only",
                "candidate_complete": False,
                "published": False,
            }
    else:
        result = inspect_run(args.run) if args.run else inspect_registry(args.registry)
        if args.identity:
            matches = [
                record for record in result["canonical"]["records"] if record["id"] == args.identity
            ]
            if not matches:
                raise ValueError("Unknown canonical identity in this run")
            sources = result["canonical"]["sources"]
            result = matches[0]
            for reference in result["origin"].get("references", []):
                reference["assertion"] = sources[reference["source_id"]]
        if args.workbench:
            if args.run:
                output = write_workbench(args.run, args.workbench)
            else:
                if args.workbench.resolve().is_relative_to(args.registry.resolve()):
                    raise ValueError("Write derived workbench outside the retained registry")
                output = write_inspection(
                    inspect_registry(args.registry), args.registry.name, args.workbench
                )
            result = {"workbench": str(output), "read_only": True}
    print(json.dumps(result, ensure_ascii=False, indent=2))
