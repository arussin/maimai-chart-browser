# Contributing to maimai.party

Suggestions and pull requests for the browser, analyzer, pattern definitions and
recommendation logic are welcome. The standalone source includes authored test
fixtures so you can develop without personal results or the production corpus.
See [README](README.md) for installation and [the release plan](docs/PUBLIC_RELEASE.md)
for the planned public rollout. The repository is still private during preparation.

## Suggest a pattern or correct a detection

Describe the expected behavior and what the current result gets wrong. Include
the catalog version, song, format, difficulty, pattern ID and relevant timestamps
when available. A stable browser link is useful. Explain a convincing example
and a similar passage that should not match. Link to supporting explanations or
public videos without submitting personal score files or copied full charts.

For code changes, state the recognition rule, required capabilities, timing
tolerances and supported variants. Add focused positive and negative fixtures,
including boundaries and missing input coverage. Keep development examples
separate from held-out evaluation. Record uncertain interpretations instead of
claiming independent review from a test you authored.

## Develop and validate

```sh
python -m pip install .
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests
python -m ruff check .
python -m ruff format --check .
```

For browser changes, use the synthetic preview and the browser checks documented
in README. Keep each pull request focused on one behavior and explain the checks
that support it. Preserve analyzer and rating parity unless a deliberate change
is documented and evaluated. Preserve the distinction between unsupported data,
partial coverage, non-detection, and independently reviewed labels.

## Official corpus updates

arussin alone publishes official corpus versions. A contribution can change the
logic, but merging it does not trigger a corpus acquisition or replace the live
catalog. The owner evaluates and publishes a separate versioned data release.
You may run the public tools locally with data you are entitled to use; that does
not grant access to the official writer or change the official site's data.

Never commit credentials, personal captures, raw downloaded corpus, generated
research packages, or unlicensed artwork/music. Retain source attribution and
qualifications. See [data boundaries](THIRD_PARTY_NOTICES.md).
