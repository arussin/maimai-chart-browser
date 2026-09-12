"""Offline measurements using authored fixtures repeated for catalog capacity only.

Run with PYTHONPATH=src. The generated catalog is deliberately synthetic and is
not source coverage, an independent-chart corpus, or browser rendering evidence.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import platform
import shutil
import subprocess  # noqa: S404 - explicit local Node process; no shell or network
import sys
import time
from pathlib import Path

from maimai_analyzer import analyze, canonical_bytes, synthetic_charts
from maimai_analyzer.contracts import MAX_INPUT_BYTES
from maimai_analyzer.wire import encode_pack
from maimai_intelligence.chart_intelligence import synthetic_catalog


def summary(samples):
    ordered = sorted(samples)
    return {
        "samples_ms": samples,
        "median_ms": ordered[len(ordered) // 2],
        "p95_ms": ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)],
    }


NODE_MEASURE = r"""
const fs=require('node:fs'),vm=require('node:vm'),os=require('node:os');
const {performance}=require('node:perf_hooks');
const raw=fs.readFileSync(process.argv[1],'utf8');
const similarityPath=process.argv[2];
const context={window:{},TextEncoder};vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[3],'utf8'),context);
const stats=s=>{const a=[...s].sort((a,b)=>a-b);return {
  samples_ms:s,median_ms:a[Math.floor(a.length/2)],p95_ms:a[Math.ceil(a.length*.95)-1]};};
let pack=null;const parse=[],decode=[],initialize=[];
for(let n=0;n<3;n++) {pack=null;global.gc?.();const t=performance.now();
  const parsed=JSON.parse(raw),afterParse=performance.now();parse.push(afterParse-t);
  pack=context.window.maimaiDecodeExplorationPack(parsed);
  decode.push(performance.now()-afterParse);initialize.push(performance.now()-t);}
vm.runInContext(fs.readFileSync(similarityPath,'utf8'),context);
const query=pack.charts.find(c=>c.descriptor?.ngrams&&c.analysis_status==='complete');
const filterSort=[],retrieval=[],filteredRetrieval=[];let matched=0,filteredCount=0;
for(let n=0;n<20;n++) {const t=performance.now();
  const filtered=pack.charts.filter(c=>
    c.availability==='available'&&c.format==='STD'&&c.constant>=9)
    .sort((a,b)=>a.title<b.title?-1:a.title>b.title?1:0);
  filteredCount=filtered.length;filterSort.push(performance.now()-t);}
for(let n=0;n<5;n++) {const t=performance.now();
  matched=context.window.maimaiExploreSimilarity(query,pack.charts,{limit:100}).length;
  retrieval.push(performance.now()-t);}
const filtered=pack.charts.filter(c=>c.availability==='available'&&c.format==='STD'&&c.constant>=9);
for(let n=0;n<5;n++) {const t=performance.now();
  context.window.maimaiExploreSimilarity(query,filtered,{limit:100});
  filteredRetrieval.push(performance.now()-t);}
process.stdout.write(JSON.stringify({node:process.version,v8:process.versions.v8,
  cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,host_memory_bytes:os.totalmem(),
  json_parse:stats(parse),wire_decode:stats(decode),parse_and_decode:stats(initialize),
  filter_and_title_sort:stats(filterSort),filtered_count:filteredCount,
  whole_catalog_retrieval:stats(retrieval),filtered_retrieval:stats(filteredRetrieval),
  returned_matches_capped_at_100:matched,process_memory:process.memoryUsage(),
  caveat:'Node VM executes shipped similarity; excludes DOM, paint and browser interaction.'}));
"""


def repeated_catalog(seed, count):
    """Repeat compact profiles with unique synthetic identities, without deep copies."""
    profiles = [chart for chart in seed["charts"] if "descriptor" in chart]
    header = {key: value for key, value in seed.items() if key not in {"charts", "coverage"}}
    header["catalog_id"] = "benchmark-repeated-authored-profiles"
    header["coverage"] = {
        "catalog_charts": count,
        "summary": f"Capacity test: {len(profiles)} authored profiles repeated "
        f"into {count} records; zero real charts and no independent coverage claim.",
    }
    charts = []
    for index in range(count):
        source = profiles[index % len(profiles)]
        cid = f"synthetic:capacity:{index:05d}:{source['format']}:{source['difficulty']}:r1"
        section_ids = {
            section["section_id"]: f"{cid}:section:{section_index}"
            for section_index, section in enumerate(source.get("sections", []))
        }

        def remap_references(records, section_ids=section_ids):
            if not any("section_id" in record for record in records):
                return records
            return [
                {
                    **record,
                    "section_id": section_ids.get(record["section_id"], record["section_id"]),
                }
                if "section_id" in record
                else record
                for record in records
            ]

        tags = []
        for tag in source.get("tags", []):
            references = tag.get("representative_sections", [])
            remapped = remap_references(references)
            tags.append(
                {**tag, "representative_sections": remapped} if remapped is not references else tag
            )
        charts.append(
            {
                **source,
                "chart_id": cid,
                "song_id": f"synthetic:capacity:{index:05d}",
                "title": f"Repeated authored fixture {index:05d}",
                "tags": tags,
                "occurrences": remap_references(source.get("occurrences", [])),
                "sections": [
                    {**section, "section_id": f"{cid}:section:{section_index}"}
                    for section_index, section in enumerate(source.get("sections", []))
                ],
            }
        )
    return {**header, "charts": charts}


def stream_capacity(pack, path):
    """Write semantic JSON for comparison without building its complete byte string."""
    header = {key: value for key, value in pack.items() if key != "charts"}
    digest = hashlib.sha256()
    with (
        path.open("wb") as raw,
        path.with_suffix(".json.gz").open("wb") as compressed_raw,
        gzip.GzipFile(filename="", fileobj=compressed_raw, mode="wb", mtime=0) as compressed,
    ):

        def write(data):
            digest.update(data)
            raw.write(data)
            compressed.write(data)

        write(json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode()[:-1])
        write(b',"charts":[')
        for index, repeated in enumerate(pack["charts"]):
            if index:
                write(b",")
            write(
                json.dumps(
                    repeated, ensure_ascii=False, separators=(",", ":"), allow_nan=False
                ).encode()
            )
        write(b"]}\n")
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--charts", type=int, default=10_000)
    parser.add_argument(
        "--output-dir", type=Path, default=Path("output/chart-intelligence-benchmark")
    )
    parser.add_argument("--skip-node", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.charts <= 100_000:
        parser.error("--charts must be 1..100000")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    repository = Path(__file__).resolve().parents[1]
    sources = sorted((repository / "src/maimai_analyzer").glob("*.py")) + [
        repository / "src/maimai_analyzer/pattern_registry.seed.json",
        repository / "src/maimai_intelligence/chart_intelligence.py",
        repository / "src/maimai_intelligence/assets/explore-similarity.js",
        repository / "src/maimai_intelligence/assets/explore-wire.js",
        Path(__file__).resolve(),
    ]
    source_hashes = {
        str(path.relative_to(repository)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sources
    }
    fixtures = synthetic_charts()
    samples, hashes = [], []
    for _ in range(5):
        start = time.perf_counter()
        analyzed = [analyze(chart) for chart in fixtures]
        samples.append((time.perf_counter() - start) * 1000)
        hashes.append(hashlib.sha256(canonical_bytes(analyzed)).hexdigest())
    pack, manifest = synthetic_catalog()
    small = canonical_bytes(pack)
    capacity = args.output_dir / "capacity.json"
    capacity_pack = repeated_catalog(pack, args.charts)
    started = time.perf_counter()
    digest = stream_capacity(capacity_pack, capacity)
    raw_bytes, gzip_bytes = capacity.stat().st_size, capacity.with_suffix(".json.gz").stat().st_size
    report = {
        "evidence": "Authored synthetic fixtures; repeated profile capacity measurement only.",
        "measurement_conditions": {
            "p95_method": "Nearest rank: 5 analyzer/retrieval, 3 parse, 20 filter samples.",
            "gzip_level": 9,
            "compression_limitation": "Repeats compress optimistically; no real-corpus projection.",
            "network": "No requests; local inputs and runtimes only.",
            "source_sha256_before_run": source_hashes,
        },
        "python": sys.version,
        "os": platform.platform(),
        "processor": platform.processor(),
        "distinct_authored_charts_analyzed": len(fixtures),
        "real_charts_analyzed": 0,
        "analyzer_batch": summary(samples),
        "deterministic_across_five_batches": len(set(hashes)) == 1,
        "analyzed_profiles_sha256": hashes[0],
        "small_catalog_sha256": manifest["catalog_hash"],
        "small_catalog_bytes": {"raw": len(small), "gzip": len(gzip.compress(small, mtime=0))},
        "capacity": {
            "records": args.charts,
            "distinct_repeated_profiles": len(fixtures),
            "raw_bytes": raw_bytes,
            "gzip_bytes": gzip_bytes,
            "sha256": digest,
            "stream_write_ms": (time.perf_counter() - started) * 1000,
            "raw_target_bytes": 20_000_000,
            "gzip_target_bytes": 5_000_000,
            "meets_raw_target": raw_bytes <= 20_000_000,
            "meets_gzip_target": gzip_bytes <= 5_000_000,
            "cli_read_limit_bytes": MAX_INPUT_BYTES,
            "within_cli_read_limit": raw_bytes <= MAX_INPUT_BYTES,
        },
    }
    wire_path = args.output_dir / "capacity.wire.json"
    started = time.perf_counter()
    try:
        wire = encode_pack(capacity_pack)
        wire_bytes = canonical_bytes(wire)
        wire_gzip = gzip.compress(wire_bytes, mtime=0)
        wire_path.write_bytes(wire_bytes)
        wire_path.with_suffix(".json.gz").write_bytes(wire_gzip)
        report["wire_capacity"] = {
            "status": "encoded",
            "raw_bytes": len(wire_bytes),
            "gzip_bytes": len(wire_gzip),
            "encode_and_write_ms": (time.perf_counter() - started) * 1000,
            "nodes": len(wire["nodes"]),
            "strings": len(wire["strings"]),
            "schemas": len(wire["schemas"]),
            "sha256": hashlib.sha256(wire_bytes).hexdigest(),
            "meets_raw_target": len(wire_bytes) <= 20_000_000,
            "meets_gzip_target": len(wire_gzip) <= 5_000_000,
            "within_cli_read_limit": len(wire_bytes) <= MAX_INPUT_BYTES,
            "tradeoff": "Schemas, strings and identical records share dictionaries. "
            "Logical JSON size is retained; browser nodes share frozen read-only objects, "
            "while Python decoding creates independent mutable containers. "
            "Repeated fixtures benefit strongly; no independent-corpus claim.",
        }
    except ValueError as exc:
        report["wire_capacity"] = {"status": "unavailable", "reason": str(exc)}
    node = shutil.which("node")
    if node and not args.skip_node:
        source = repository / "src/maimai_intelligence/assets/explore-similarity.js"
        decoder = repository / "src/maimai_intelligence/assets/explore-wire.js"

        def measure_node(path):
            measured = subprocess.run(  # noqa: S603 - fixed local executable and explicit arguments
                [
                    node,
                    "--expose-gc",
                    "-e",
                    NODE_MEASURE,
                    str(path.resolve()),
                    str(source),
                    str(decoder),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=180,
            )
            return json.loads(measured.stdout)

        report["node"] = measure_node(capacity)
        if report["wire_capacity"]["status"] == "encoded":
            report["wire_node"] = measure_node(wire_path)
        report["node"]["filter_sort_p95_within_300ms"] = (
            report["node"]["filter_and_title_sort"]["p95_ms"] <= 300
        )
        report["node"]["retrieval_p95_within_1000ms"] = (
            report["node"]["whole_catalog_retrieval"]["p95_ms"] <= 1000
        )
    else:
        report["node"] = {"status": "not measured", "reason": "--skip-node or unavailable runtime"}
    report["source_files_unchanged_during_run"] = all(
        hashlib.sha256(path.read_bytes()).hexdigest()
        == source_hashes[str(path.relative_to(repository))]
        for path in sources
    )
    target = args.output_dir / "metrics.json"
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
