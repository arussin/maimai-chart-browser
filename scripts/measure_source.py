"""Measure committed source separately from generated assets, tests and dependency locks.

Counts are physical text lines, not semantic SLOC. Python complexity is a static
branch count (1 + decisions), reported separately from bundle graph evidence.
Optional locked Node tools measure authored JavaScript/TypeScript independently.
No repository, environment or deployment is modified.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import io
import json
import re
import subprocess
import tarfile
from collections import Counter, defaultdict
from pathlib import Path

CODE = {".py", ".js", ".mjs", ".cjs", ".ts", ".css", ".html", ".sql", ".ps1"}
TEXT = CODE | {
    ".json",
    ".jsonc",
    ".jsonl",
    ".md",
    ".txt",
    ".toml",
    ".yml",
    ".yaml",
    ".lock",
    ".svg",
}


def committed_files(repository, revision, git):
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Measurement requires an exact commit SHA")
    raw = subprocess.run(  # noqa: S603 -- fixed read-only git archive with an exact SHA
        [git, "-C", str(repository), "archive", "--format=tar", revision],
        check=True,
        capture_output=True,
    ).stdout
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        return {
            entry.name: archive.extractfile(entry).read() for entry in archive if entry.isfile()
        }


def generated_paths(files):
    paths = set()
    for name in ("web/generated-assets.json", "src/maimai_intelligence/assets/browser-assets.json"):
        if name not in files:
            continue
        manifest = json.loads(files[name])
        paths.add(name)
        paths.update(
            "src/maimai_intelligence/assets/" + path for path in manifest.get("assets", {})
        )
    return paths


def category(name, generated):
    path = Path(name)
    if "_party" in path.parts or "_contract_tool" in path.parts:
        return "vendored_code_and_provenance"
    if name in generated or name.endswith("worker-configuration.d.ts"):
        return "generated_code"
    if path.name.endswith(".lock") or path.name == "package-lock.json":
        return "dependency_locks"
    if "tests" in path.parts or "test" in path.parts:
        return "tests"
    if path.suffix in CODE:
        return "authored_code"
    if path.suffix == ".md":
        return "documentation"
    return "data_and_other"


def complexity(node):
    score = 1

    def visit(item):
        nonlocal score
        if item is not node and isinstance(
            item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)
        ):
            return
        if isinstance(
            item,
            (
                ast.If,
                ast.IfExp,
                ast.For,
                ast.AsyncFor,
                ast.While,
                ast.ExceptHandler,
                ast.comprehension,
            ),
        ):
            score += 1
        elif isinstance(item, ast.BoolOp):
            score += len(item.values) - 1
        elif isinstance(item, ast.Match):
            score += max(0, len(item.cases) - 1)
        for child in ast.iter_child_nodes(item):
            visit(child)

    visit(node)
    return score


def strongly_connected(graph):
    index, low, stack, active, groups = {}, {}, [], set(), []

    def visit(node):
        index[node] = low[node] = len(index)
        stack.append(node)
        active.add(node)
        for edge in sorted(graph[node]):
            if edge not in index:
                visit(edge)
                low[node] = min(low[node], low[edge])
            elif edge in active:
                low[node] = min(low[node], index[edge])
        if low[node] == index[node]:
            group = []
            while True:
                item = stack.pop()
                active.remove(item)
                group.append(item)
                if item == node:
                    break
            if len(group) > 1 or node in graph[node]:
                groups.append(sorted(group))

    for node in sorted(graph):
        if node not in index:
            visit(node)
    return sorted(groups)


def python_metrics(files):
    modules, functions, bodies = {}, [], defaultdict(list)
    for name, raw in files.items():
        if "_party" in Path(name).parts or "_contract_tool" in Path(name).parts:
            continue
        if not name.endswith(".py") or not name.startswith(("src/", "scripts/", "build_backend/")):
            continue
        module = name.removeprefix("src/").removesuffix(".py").replace("/", ".")
        package = (
            module.removesuffix(".__init__")
            if module.endswith(".__init__")
            else module.rpartition(".")[0]
        )
        module = module.removesuffix(".__init__")
        tree = ast.parse(raw, filename=name)
        modules[module] = (tree, package)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                record = {
                    "path": name,
                    "line": node.lineno,
                    "name": node.name,
                    "complexity": complexity(node),
                    "lines": node.end_lineno - node.lineno + 1,
                }
                functions.append(record)
                if len(node.body) >= 5:
                    digest = hashlib.sha256(
                        ast.dump(ast.Module(body=node.body, type_ignores=[])).encode()
                    ).hexdigest()
                    bodies[digest].append({k: record[k] for k in ("path", "line", "name")})
    graphs = {
        kind: {module: set() for module in modules} for kind in ("all_imports", "eager_imports")
    }
    for module, (tree, package) in modules.items():

        def visit(node, eager=True, *, module=module, package=package):
            if isinstance(node, ast.Import):
                candidates = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                prefix = (
                    package.split(".")[: len(package.split(".")) - node.level + 1]
                    if node.level
                    else []
                )
                if node.module:
                    prefix.extend(node.module.split("."))
                parent = ".".join(prefix)
                candidates = [parent, *(parent + "." + alias.name for alias in node.names)]
            else:
                candidates = []
            for target in candidates:
                if target in modules and target != module:
                    graphs["all_imports"][module].add(target)
                    if eager:
                        graphs["eager_imports"][module].add(target)
            deferred = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
            for child in ast.iter_child_nodes(node):
                visit(child, eager and not deferred)

        visit(tree)
    ordered = sorted(row["complexity"] for row in functions)
    return {
        "function_count": len(functions),
        "complexity": {
            "mean": sum(ordered) / max(1, len(ordered)),
            "p95": ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))] if ordered else 0,
            "maximum": max(ordered, default=0),
        },
        "largest_functions": sorted(
            functions, key=lambda row: (-row["complexity"], row["path"], row["line"])
        )[:30],
        "identical_function_bodies_at_least_5_statements": [
            rows for rows in bodies.values() if len(rows) > 1
        ],
        "import_edges": {
            module: sorted(edges) for module, edges in sorted(graphs["all_imports"].items())
        },
        "import_cycles": {kind: strongly_connected(graph) for kind, graph in graphs.items()},
        "import_cycle_method": (
            "AST local-module edges; all includes deferred imports; eager excludes "
            "function/lambda bodies. Conditional imports remain potential edges."
        ),
    }


def web_metrics(files, *, web_runtime=None, node="node"):
    """Select authored inputs before asking the optional pinned parser to inspect data."""
    generated = generated_paths(files)
    sources = {
        name: raw
        for name, raw in sorted(files.items())
        if Path(name).suffix in {".js", ".mjs", ".cjs", ".ts"}
        and category(name, generated) == "authored_code"
    }
    source_hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in sources.items()}
    selection = {
        "source_files": source_hashes,
        "source_sha256": hashlib.sha256(
            json.dumps(source_hashes, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        "excluded_categories": ["generated_code", "tests", "vendored_code_and_provenance"],
    }
    if web_runtime is None:
        return {
            **selection,
            "status": "unavailable",
            "reason": "Pass --web-runtime for an acquired, locked registry web toolchain",
        }
    helper = Path(__file__).with_name("measure_web_source.mjs")
    result = subprocess.run(  # noqa: S603 -- trusted helper; source is JSON data on stdin
        [node, str(helper), str(Path(web_runtime).resolve(strict=True))],
        input=json.dumps(
            {
                "files": [
                    {"path": name, "source": raw.decode("utf-8-sig")}
                    for name, raw in sources.items()
                ]
            }
        ),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return {
        **json.loads(result.stdout),
        **selection,
        "helper_sha256": hashlib.sha256(helper.read_bytes()).hexdigest(),
    }


def measure(files, *, web_runtime=None, node="node"):
    generated = generated_paths(files)
    categories = defaultdict(Counter)
    for name, raw in files.items():
        bucket = categories[category(name, generated)]
        bucket["files"] += 1
        bucket["bytes"] += len(raw)
        if Path(name).suffix in TEXT or Path(name).name.startswith("."):
            try:
                lines = raw.decode("utf-8-sig").splitlines()
            except UnicodeDecodeError:
                continue
            bucket["physical_lines"] += len(lines)
            bucket["nonblank_lines"] += sum(bool(line.strip()) for line in lines)
    return {
        "categories": {name: dict(counts) for name, counts in sorted(categories.items())},
        "python": python_metrics(files),
        "web": web_metrics(files, web_runtime=web_runtime, node=node),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--git", default="git")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--web-runtime", type=Path, help="Prepared registry web directory with locked node_modules"
    )
    parser.add_argument(
        "--node", default="node", help="Explicit Node executable for optional web analysis"
    )
    args = parser.parse_args()
    result = {
        "schema_version": "maimai-source-metrics-1",
        "repository": str(args.repository.resolve()),
        "method": __doc__,
    }
    for key in ("baseline", "candidate"):
        revision = getattr(args, key)
        result[key] = {
            "commit": revision,
            **measure(
                committed_files(args.repository, revision, args.git),
                web_runtime=args.web_runtime,
                node=args.node,
            ),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {"receipt": str(args.output), "baseline": args.baseline, "candidate": args.candidate}
        )
    )


if __name__ == "__main__":
    main()
