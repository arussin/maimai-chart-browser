# Isolated Maichart-Converts trial

This is the active local dataset trial requested on September 10, 2026. It uses
only [Neskol/Maichart-Converts](https://github.com/Neskol/Maichart-Converts/tree/e164add85213bab150e1487d5eb15ccb631aedb9)
at commit `e164add85213bab150e1487d5eb15ccb631aedb9`. The entire pinned pack is
included, including older, removed and later-version entries; this is not a
PRiSM PLUS-only or International availability filter.

## Isolation and preservation

The previous local `output/` contents (148 top-level entries) were moved,
without deleting them, into:

`output/quarantine/20260910-before-maichart-converts/`

`QUARANTINE-MANIFEST.json` records the original locations and completed moves.
This includes the wiki captures, earlier corpus results, study outputs, caches
and generated UI evidence. Tracked authored fixtures, implementation code and
historical documentation remain intact. Personal account data and installation
repositories were not accessed or changed.

The new source is `output/maichart-converts/`; the new analysis is
`output/maichart-converts-results/`. Commands take these explicit directories;
they do not scan sibling output or quarantine directories. A fresh output cache
is used for the first full run. Synthetic development checks live separately in
`output/synthetic-checks/` and are not part of the evaluated dataset.

To restore an earlier artifact, consult the quarantine journal and move that
exact item back only if its original destination is absent. Do not overwrite the
new trial or delete the quarantine as part of restoration.

## Reproduce the trial

Run from the repository root with the contributor Python environment and `src`
on `PYTHONPATH` (or the package installed for development):

```console
python -m scripts.acquire_maichart_pack --revision e164add85213bab150e1487d5eb15ccb631aedb9 --output-dir output/maichart-converts
python -m scripts.prepare_maichart_pack output/maichart-converts
python -m scripts.analyze_simai_corpus output/maichart-converts/manifest.json --output-dir output/maichart-converts-results --no-resume
```

Only the first command uses the network. It selects `maidata.txt`, `index.json`
and collection manifests from the pinned, untruncated Git tree, with at most four
requests in flight. It rejects redirects, stops on failed requests, bounds sizes,
and verifies each file's Git blob identity before saving it. No audio, jackets,
videos, release archives, cabinet files or account endpoints are requested.
`--offline` rechecks the saved capture without requests. A different commit needs
a different source directory. Corrupt existing bytes cause an explicit failure.

Preparation and analysis are hermetic. Full raw files remain unchanged, with
SHA-256 records. Each difficulty body is an exact byte slice of its container,
with retained start/end offsets and body hashes. The adapter never concatenates
different difficulties, inserts clock defaults, repairs notation, or applies
`wholebpm`, `first` or `fixedoption` metadata to the note stream. Raw metadata and
repeated event options remain in the local audit. Nonblank unsupported slots are
retained as explicit unsupported identities rather than dropped.

Ordinary format and identity require agreement between the source index,
directory ID and `shortid`/`cabinet` metadata. These are source identities, not
verified official game mappings. Utage remains separate even when its underlying
cabinet field says SD/DX. Source level values become display labels; they are not
promoted to official chart constants or used to recalculate rating contribution.

Duplicate ID/difficulty entries with identical body bytes, level, artist and
identity status become recorded aliases. Conflicting entries remain unresolved;
neither is silently selected. Titles are not used to merge identities.

## Captured inventory

- 1,806 raw chart containers and 37 index/collection files, all Git-hash verified.
- 15,452,503 total captured bytes; 15,320,605 are chart container text.
- 7,088 retained audit rows, with 7,087 nonempty extracted bodies.
- 6,959 ordinary difficulty rows: 2,944 Standard and 4,015 DX.
- 128 Utage slots retained outside ordinary-chart analysis.
- Eight duplicate difficulty bodies recorded as aliases; no conflicting duplicate
  bodies were found. The duplicate container IDs are 521 and 11478.
- One container, `429_Wonderland Wars オープニング`, contains metadata but no
  `inote` bodies. It remains an explicit unavailable entry.

`capture.json`, `preparation-audit.json`, `container-metadata.json`, `charts.jsonl`
and `manifest.json` retain the acquisition and extraction evidence. The completed
run's `summary.json`, `work-audit.json`, `results.jsonl`, `neighbor-audit.json` and
`index.html` record analysis and browser coverage. File presence, nonempty body,
supported identity, parser acceptance and useful analysis are different counts.

## Product boundary

The subsequent [Challenge Intelligence implementation](CHALLENGE_INTELLIGENCE.md)
adopts this pinned source as a preparation dependency and builds a separately
versioned animated similarity review. The counts below retain the original
0.3.2 trial; new profiles and the 0.3.3 reader are evaluated separately.

This pack is an explicit local research evaluation, not a bundled production
source. No raw source or generated research pack is committed or published.
Successful parsing does not establish native-game fidelity, geometry, source
completeness, independently labeled pattern accuracy or practice effectiveness.
Community-named patterns, including Umiyuri, remain disabled and unvalidated.
Existing report rating calculations, history originals and verified-correction
fallback behavior are unchanged. Research packs remain excluded from private
score reports and Targets until that separate integration is supported.

## Completed run and validation

The full cold run completed in **831.625 seconds** with zero old-cache hits.
Input manifest SHA-256:
`d067113ccf60c6cb97618828464d0d713a5f6f1060e9addf9e03918c5164927c`.

| Outcome | Count |
| --- | ---: |
| Ordinary charts analyzed | **6,958 / 6,959 (99.99%)** |
| Standard analyzed | 2,944 / 2,944 |
| DX analyzed | 4,014 / 4,015 |
| Ordinary parser compatibility gap | 1 |
| Utage slots outside the supported identity contract | 128 |
| Container without chart bodies | 1 |
| Source-verification, analyzer or publication failures | 0 |

The ordinary rejection is **World's end BLACKBOX, DX Master**: shared slide
branches with unequal waits are outside the current parser's supported grammar.
It is classified as a parser compatibility gap, not a claim of malformed source.
Diagnostic classification version 2 changes that label only. The local
`diagnostic-refresh.json` proves that every other outcome field is unchanged;
source, cache, profile and catalog bytes are retained.

All 6,958 accepted profiles publish into **199 bounded research browser chunks**.
Nine experimental project primitives emit detections. The other 27 registry
entries remain unknown, including every disabled community seed. Eight sampled
structural queries each scan 6,957 candidates; two queries find qualifying matches
and six find none at the unchanged threshold. This is a remaining similarity
calibration/relevance gap, not a demonstration of useful coaching.

An independent audit rehashes all 1,843 captured files, reconciles every nonempty
source slot (7,095 including the eight aliases), verifies all 7,088 input/outcome
identities, rehashes all 6,958 profiles and 199 catalogs, and confirms zero old-cache
hits. Evidence is saved as `maichart-converts-results/independent-audit.json`.

Validation also includes **534 Python tests** (nine Windows symlink-availability
skips), Ruff lint/format checks, offline doctor and the sealed synthetic report.
The actual new-data report passes **80 browser checks** across Chromium at
1440/390/320 pixels and mobile WebKit at 390 pixels: audited counts, search,
failure details, pattern selection, Flow, focus restoration, layout, script
errors, external requests and automated accessibility checks. Local browser
evidence is in `output/maichart-browser-qa/`.
