"""Fresh-process source registration acceptance; execution uses only an isolated wheel."""


# ruff: noqa: E402 -- establish isolated wheel boundary before product imports.

import importlib.abc
import json
import platform
import sys
from pathlib import Path

installed, root = map(Path, sys.argv[1:3])
mode = sys.argv[3]
sys.path.insert(0, str(installed))
platform.uname()


def audit(event, args):
    if (event.startswith("socket.") and event != "socket.gethostname") or event in {
        "subprocess.Popen",
        "os.system",
    }:
        raise AssertionError("External execution and network forbidden")


class PackageOnly(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, *args):
        if fullname.split(".")[0] in {"scripts", "tests", "maimai_report"}:
            raise AssertionError("Source checkout and report imports forbidden")


sys.addaudithook(audit)
sys.meta_path.insert(0, PackageOnly())
from maimai_intelligence.corpus_attempts import reassess_options, resume_options
from maimai_intelligence.corpus_requests import preparation_request
from maimai_intelligence.corpus_update import prepare_corpus, verify_candidate
from maimai_intelligence.corpus_workbench import inspect_run
from maimai_intelligence.metadata_adapters import MetadataAdapter
from maimai_intelligence.metadata_policy import BUILTIN_CONTEXT, MetadataSourcePolicy
from maimai_intelligence.registry import read_registry
from maimai_intelligence.source_identity import implementation_hash
from maimai_intelligence.source_registration import SourceRegistration, source_context

assert Path(sys.modules[prepare_corpus.__module__].__file__).is_relative_to(installed)
inputs = root / "registry"
url = "https://dp4p6x0xfi5o9.cloudfront.net/maimai/data.json"


def normalize(raw, metadata):
    return json.loads(raw)


registration = SourceRegistration(
    MetadataAdapter("fictional-source", url, normalize),
    MetadataSourcePolicy("Fictional fixture only", 50),
    "fixture-v1",
)
sources = (registration,)
context = source_context(sources)
pointer = inputs / "registered-run.json"

if mode == "prepare":
    accepted = read_registry(inputs / "registry")
    sid = next(
        sid for sid, song in accepted["songs"].items() if song["metadata"]["title"] == "ソテリア"
    )
    rows = [
        {
            "title": accepted["songs"][sid]["metadata"]["title"],
            "artist": accepted["songs"][sid]["metadata"]["artist"],
            "format": chart["format"],
            "difficulty": chart["difficulty"],
            "region": "JP",
            "bpm": 123.0,
            "chart_constant": 13.5,
        }
        for chart in accepted["charts"].values()
        if chart["song_id"] == sid
    ]
    accepted_row_count = len(rows)
    for row in rows:
        row.update(
            song_id="fabricated identity",
            provider_id="fabricated mapping",
            membership=["fictional-region"],
            redirect="fabricated redirect",
        )
    rows.append({**rows[0], "title": "Unknown fictional identity"})
    raw = json.dumps(rows).encode()

    def fetch(location, headers):
        if location == url:
            return 200, raw, {}
        raise OSError("Fictional provider unavailable")

    request = preparation_request(
        inputs / "registered-store",
        inputs / "browser",
        package=inputs / "package",
        registry=inputs / "registry",
        offline=False,
    )
    run = prepare_corpus(request, sources=sources, source_fetcher=fetch)
    result = read_registry(run / "registry", policy_context=context)
    assert result["songs"].keys() == accepted["songs"].keys()
    assert result["charts"].keys() == accepted["charts"].keys()
    assert result["mappings"] == accepted["mappings"]
    claims = [
        row
        for row in result["observations"].values()
        if result["sources"][row["snapshot_id"]]["provider"] == "fictional-source"
    ]
    assert len(claims) == accepted_row_count * 2
    assert all(
        result["observations"][key] == entry for key, entry in accepted["observations"].items()
    )
    assert all(result["sources"][key] == entry for key, entry in accepted["sources"].items())
    assert not (run.parent.parent / "latest.json").exists()
    assert not list(run.parent.parent.rglob("publication.json"))
    assert all(row["field"] in {"bpm", "chart_constant"} for row in claims)
    pointer.write_text(json.dumps({"run": str(run), "claims": len(claims)}))
    print(json.dumps({"registered_claims": len(claims), "publication_untouched": True}))
elif mode == "replay":
    previous = json.loads(pointer.read_text())
    run = Path(previous["run"])
    receipt = verify_candidate(run, policy_context=context)
    inspect_run(run, policy_context=context)
    original = read_registry(run / "registry", policy_context=context)
    for candidate in (
        BUILTIN_CONTEXT,
        source_context(
            (
                SourceRegistration(
                    registration.adapter,
                    MetadataSourcePolicy("Fictional fixture only", 51),
                    "fixture-v1",
                ),
            )
        ),
        source_context(
            (SourceRegistration(registration.adapter, registration.policy, "fixture-v2"),)
        ),
    ):
        try:
            resume_options(run, implementation_hash(), replay=True, policy_context=candidate)
        except ValueError:
            pass
        else:
            raise AssertionError("Missing or changed registration was accepted")
    try:
        reassess_options(
            run,
            policy_context=source_context(
                (SourceRegistration(registration.adapter, registration.policy, "fixture-v2"),)
            ),
        )
    except ValueError as error:
        assert "prepare a fresh attempt" in str(error)
    else:
        raise AssertionError("Changed supplemental reassessment bypassed its original authority")
    try:
        read_registry(run / "registry")
    except ValueError:
        pass
    else:
        raise AssertionError("Custom policy accepted without explicit context")
    options = resume_options(run, implementation_hash(), replay=True, policy_context=context)
    request = preparation_request(run.parent.parent, **options)
    replay = prepare_corpus(request, sources=sources)
    assert verify_candidate(replay, policy_context=context)["files"] == receipt["files"]
    assert read_registry(replay / "registry", policy_context=context) == original
    assert not (run.parent.parent / "latest.json").exists()
    assert not list(run.parent.parent.rglob("publication.json"))
    assert "fictional-source" not in BUILTIN_CONTEXT.policies
    print(
        json.dumps(
            {
                "fresh_process_replay_equal": True,
                "missing_changed_context_rejected": True,
                "registered_claims": previous["claims"],
                "global_policy_unchanged": True,
            }
        )
    )
else:
    raise AssertionError("Unknown fixture operation")
