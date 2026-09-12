# Decimal chart constants

The Charts page's **Constant** column replaces the old Level column. It shows
one decimal place, sorts numerically in either direction, and participates in
the existing ordered sort priorities. Selecting another difficulty updates the
constant and repositions the row when needed. Unknown values remain last in both
directions and display as an em dash; a displayed level is never used to invent
a constant. The difficulty picker and level-range filter retain the source level
labels.

The current catalog has a retained decimal for all 6,959 analyzed charts. These
are the original `lv_N` values in
[Neskol/Maichart-Converts at the pinned revision](https://github.com/Neskol/Maichart-Converts/tree/e164add85213bab150e1487d5eb15ccb631aedb9),
already preserved as `source_level` in the package's verified source inventory.
The earlier importer reduced these values to level labels for browsing.

Constants attach through the exact input ID, difficulty, format, source
container and chart-body hash. They live in navigation display metadata as
`chart_constant`, alongside their source hash; they are not added to canonical
rating inputs or treated as reviewed provider mappings. They describe the
retained source revision, not a guarantee of current constants in every game
version or region. Tooltips and About explain that qualification.

## Preparing a release

For a retained package, restore its decimal metadata without reacquiring or
reanalyzing the corpus:

```text
python -m scripts.prepare_chart_constants output/challenge-patterns-v2 output/challenge-constants-v1
maimai-chart lab --package output/challenge-constants-v1 --output output/site/lab --catalog-version research-9fed7bd21e1f
maimai-chart public-release --source output/site/lab --output output/public-release-next
```

Preparation is offline and requires a fresh destination. It verifies every
declared input, preserves analysis, recommendations and source inventory bytes,
and writes the new package manifest last. New corpus builds also retain the
explicit decimals when building navigation. The enriched catalog gets a new
version; historical versions keep their original bytes and links. Historical
catalogs without decimal metadata show an unknown constant.

The progressive browsing index includes navigation, so sorting does not fetch
chart detail files or any external service. Synthetic tests cover decimal order,
missing values, difficulty changes, multi-sort, source identity mismatch,
corruption, interrupted writes and preservation of existing analysis.
