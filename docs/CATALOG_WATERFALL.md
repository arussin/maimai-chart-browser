# Sustainable catalog source waterfall

The owner update pipeline runs this policy on every online registry preparation.
`python -m scripts.update_catalog refresh --store output/registry-updates`
continues from the last verified publication and retains its accepted registry.
Use `prepare` with explicit inputs for the initial migration or a reviewed source
change. Publication remains a separate owner action after checks and review.

## Metadata

Existing primary analysis metadata is preserved. Missing BPM and constants are
matched independently against Arcade Songs, OTOGE DB and the public mai-notes
manifest. A listing's displayed level is never converted into a decimal constant.
Unique full title, artist, format and difficulty are required. Shared matching
normalizes whitespace, Unicode quote styles and equivalent artist separators
without dropping edition qualifiers;
ambiguous variants are recorded for review. Existing reviewed artist exceptions
apply only while both exact provider and official credits still match.
`src/maimai_intelligence/catalog_identity_aliases.json` holds page-scoped reviewed
credit exceptions shared by metadata and reference-count matching. They bind the
source URL, format and both complete identity assertions; they contain no numeric
backfills. Unmatched page identities are retained in the source audit.

For remaining gaps, the updater follows mai-notes' Gamerch song-page ID, or
searches the Wiki's category indexes by exact title when no provider match exists. Discovery also follows direct homepage song links
and the release-index menu, and uses title aliases as lookup hints only. Each
fetched page must still prove its full identity.
The fetched page must independently confirm artist, format and explicit difficulty
markers, including historical EASY rows and modern ordinary variants. Its
explicit constant column supplies all four/five ordinary difficulties, including
BASIC and ADVANCED. A bounded page budget defers excess work into the audit.

Values remain source- and scope-aware. Reviewed page claims, Wiki, Arcade Songs,
OTOGE DB and mai-notes are the precedence order within a regional scope. Japan
values precede International and unscoped values by default; the International
checkbox changes value preference without filtering the inventory. A provider's
song introduction version is not presented as a constant-investigation version.
Every accepted observation records its source and timestamp; conflicting values
remain reviewable. Repeated unchanged observations are deduplicated.

## Transcriptions and analysis

Retain accepted primary corpus analysis. For an unanalyzed chart, try a public
mai-notes chart body, then its linked Simai community Wiki page. A registration
alone is insufficient. Each candidate needs an exact accepted identity, complete
reference counts, supported notation and matching tap/hold/slide/touch/break
counts under the engine's exclusive-category convention. The existing engine
then computes demand, Flow and patterns; no measurements are inferred from
metadata. If a body starts with a subdivision and omits an initial BPM, the
adapter can supply the finite BPM from the same identity-checked reference row.
It records the original body hash, BPM and reference capture; the prepared input
hash binds the added timing context, including on subsequent refreshes. Explicit
body tempo wins. Malformed note modifiers and missing slide shapes are not
repaired by guessing. Conflicting complete reference counts stop automatic
qualification and appear separately in the audit.

The public integration asset includes genuine profiles under its
existing contract, so Session Report consumers retain compatible identities.

The registry records the selected source, full-container and body hashes, exact
input identity and validation evidence. Supplemental sources are also explicit
in the package descriptor; they are not attributed to the pinned Neskol corpus.
The public catalog remains experimental. Count agreement is not verification of
judgment timing, chart authorship or exact gameplay fidelity.

Previously accepted supplemental analysis is retained on an outage. Changed
body, container context or reference counts are held for review instead of silently
replacing it. Missing, malformed and unsupported sources produce explicit outcomes
in `source-audit.json`; they do not erase inventory or create fabricated analysis.

## Reproducibility and failures

`STORE/cache/waterfall/sources` retains content-addressed captures with verified
checksums. Each URL is requested at most once per run with a bounded response,
identified user agent, timeout and no redirects. Conditional requests reuse
verified bytes; unchanged bytes preserve their original capture time. Analysis
cache keys bind input/body/container identity and parser/analyzer implementation.

Each run saves `source-captures.json`, `source-audit.json`, and `registry/` outside
public assets. Replay the same starting registry/package/browser with:

```text
python -m scripts.update_catalog prepare --store STORE --previous-browser BASE/browser --package BASE/package --registry BASE/registry --offline --replay-sources RUN/source-captures.json
```

Replay uses only the receipt's source hashes and retained cache, never newer
captures. `--offline` without `--replay-sources` packages the accepted registry
without refreshing sources. Provider failures retain existing good data and are
reported. Invalid final packages fail preparation; `latest.json` advances only
after verified publication. Ready receipts bind both public files and the next
registry so tampering prevents publication.

Raw provider pages, chart text, score fields and player names never enter public
assets. About and THIRD_PARTY_NOTICES credit every participating source and its
actual role. Source captures and analysis are reproducible local build inputs;
no browser background requests to the providers are added.

## Identity and artwork

The same preparation stage reconciles immutable public Kamaitachi metadata and
maintains durable title/artwork enrichment. See [sustainable coverage](SUSTAINABLE_COVERAGE.md)
for matching, regional migration, the shared Wiki budget, retries and exact replay.
