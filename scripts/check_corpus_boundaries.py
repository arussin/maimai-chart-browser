"""Strict extracted boundaries and per-module branch coverage gates (offline)."""

import json
import os
import subprocess
import sys
from pathlib import Path


def main():
    output = Path(os.environ.get("MAIMAI_REGISTRY_OUTPUT", "output")) / "corpus-checks"
    output.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, "COVERAGE_FILE": str(output / ".coverage")}
    modules = (
        "corpus_policy",
        "corpus_explain",
        "metadata_selection",
        "metadata_policy",
        "song_catalog",
        "catalog_document",
    )
    commands = [
        ["mypy", "--cache-dir", str(output / "mypy")],
        [
            "coverage",
            "run",
            "--branch",
            "--source=" + ",".join("maimai_intelligence." + name for name in modules),
            "-m",
            "unittest",
            "tests.test_corpus_policy",
            "tests.test_song_catalog",
            "tests.test_seo",
            "tests.test_catalog_document",
            "tests.test_catalog_handoff",
        ],
        ["coverage", "json", "-o", str(output / "branches.json")],
    ]
    for command in commands:
        subprocess.run([sys.executable, "-m", *command], env=environment, check=True)  # noqa: S603 -- fixed local checks.
    results = json.loads((output / "branches.json").read_text("utf-8"))["files"]
    for name in modules:
        rows = [v for k, v in results.items() if Path(k).stem == name]
        if len(rows) != 1:
            raise ValueError("Expected exactly one coverage result for " + name)
        summary = rows[0]["summary"]
        if (
            not summary["num_branches"]
            or summary["covered_branches"] / summary["num_branches"] < 0.95
        ):
            raise ValueError("Pure decision branch coverage below 95%: " + name)
        print(
            name
            + ": "
            + str(summary["covered_branches"])
            + "/"
            + str(summary["num_branches"])
            + " branches covered"
        )


if __name__ == "__main__":
    main()
