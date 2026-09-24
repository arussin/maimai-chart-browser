"""Execute fictional corpus lifecycles solely from an unpacked pure-Python wheel.

The parent prepares fixtures. This isolated child may not import tests, owner
scripts or the report package, start subprocesses, or contact a network.
"""

import contextlib
import importlib.abc
import io
import json
import platform
import sys
from pathlib import Path

installed, root = map(Path, sys.argv[1:3])
sys.path.insert(0, str(installed))
attempts = []


def audit(event, args):
    if (event.startswith("socket.") and event != "socket.gethostname") or event in {
        "subprocess.Popen",
        "os.system",
    }:
        attempts.append(event)
        raise AssertionError("External execution and network forbidden")


class PackageOnly(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, *args):
        if fullname.split(".")[0] in {"scripts", "tests", "maimai_report"}:
            raise AssertionError("Source checkout and report imports forbidden")


# Windows CPython may call its native version command while identifying the host.
# Finish harness runtime discovery before prohibiting product subprocesses.
platform.uname()
sys.addaudithook(audit)
sys.meta_path.insert(0, PackageOnly())
from maimai_intelligence import corpus_update  # noqa: E402 -- isolation before imports.
from maimai_intelligence.cli import main  # noqa: E402 -- isolation before imports.

assert Path(corpus_update.__file__).resolve().is_relative_to(installed.resolve())


def compatibility_path_forbidden(*args, **kwargs):
    raise AssertionError("Installed CLI must enter the typed preparation service directly")


corpus_update.prepare_update = compatibility_path_forbidden


def command(*args, expected=0):
    output, errors = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
        status = main(["corpus", *map(str, args)])
    assert status == expected, (args, status, errors.getvalue())
    return json.loads(output.getvalue()) if expected == 0 else errors.getvalue()


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


results = []
for name in ("legacy", "registry"):
    inputs = root / name
    store = inputs / "store"
    arguments = [
        "prepare",
        "--store",
        store,
        "--previous-browser",
        inputs / "browser",
        "--package",
        inputs / "package",
    ]
    arguments += (
        ["--registry", inputs / "registry"]
        if name == "registry"
        else ["--mai-notes-snapshot", inputs / "links.json"]
    )
    first = Path(command(*arguments)["run"])
    receipt = read(first / "ready.json")
    assert command("verify", "--run", first)["status"] == "verified_candidate"
    second = Path(command("resume", "--from", first)["run"])
    assert receipt["files"] == read(second / "ready.json")["files"]
    assert command("diff", first, second)["public_files"] == {
        "added": [],
        "removed": [],
        "changed": [],
    }
    if name == "registry":
        assert "No retained capture" in command("replay", "--from", first, expected=1)
        captured = Path(read(inputs / "captured-run.json")["run"])
        replay = Path(command("replay", "--from", captured)["run"])
        assert read(captured / "ready.json")["files"] == read(replay / "ready.json")["files"]
    command("inspect", "--run", second, "--workbench", inputs / "workbench.html")
    assert "connect-src 'none'" in (inputs / "workbench.html").read_text(encoding="utf-8")
    events = [json.loads(line) for line in (first / "diagnostics.jsonl").read_text().splitlines()]
    stages = [event["stage"] for event in events if event["outcome"] == "complete"]
    assert all(event["outcome"] in {"started", "complete"} for event in events)
    if name == "registry":
        assert stages == [
            "inputs",
            "source_capture",
            "claims",
            "enrichment",
            "projection",
            "render",
            "review",
            "receipt",
        ]

    # Failure is exercised in the installed command, then recovered in a new attempt.
    before = set((store / "runs").iterdir())
    render = corpus_update.build_public_release

    def interrupted(*args, **kwargs):
        raise OSError("fixture interruption")

    corpus_update.build_public_release = interrupted
    try:
        command(*arguments, expected=1)
    finally:
        corpus_update.build_public_release = render
    (failed,) = set((store / "runs").iterdir()) - before
    assert not (failed / "ready.json").exists()
    assert command("verify", "--run", failed)["status"] == "verified_inputs_only"
    recovered = Path(command("resume", "--from", failed)["run"])
    assert receipt["files"] == read(recovered / "ready.json")["files"]
    assert not (store / "latest.json").exists()
    assert not list(store.rglob("publication.json"))
    assert not (store / "writer.lock").exists()
    mismatched = inputs / "unrelated-checkout"
    mismatched.mkdir()
    assert "does not match the executing package" in command(
        "verify", "--run", first, "--source-root", mismatched, expected=1
    )
    (first / "public/index.html").write_text("tampered")
    assert "Candidate changed" in command("verify", "--run", first, expected=1)
    results.append(
        {
            "source": name,
            "captured_replay_equal": name == "registry",
            "uncaptured_replay_rejected": name == "registry",
            "public_files": len(receipt["files"]),
            "stages": stages,
            "resume_equal": True,
            "recovery_equal": True,
            "tampering_rejected": True,
            "mismatched_producer_rejected": True,
            "publication_untouched": True,
        }
    )
assert not attempts, attempts
print(json.dumps({"cases": results, "forbidden_attempts": attempts, "runtime": sys.version}))
