# Optional report integration

The report library remains independently installable. Its adapter accepts the
prepared JSON contract without importing this package. The optional engine is
needed only when calculating/exporting a new bundle inside the report process.
While this repository is private, authorized installations use a reviewed wheel
or commit pin; public/default report installs must not add a private dependency.

```python
from maimai_report.browser import export_browser_bundle
from maimai_report.render import build_html

bundle = export_browser_bundle(
    report,
    retained_after_pbs,
    reviewed_mapping,
    catalog,
    catalog_version="reviewed-release",
    attempts=retained_attempts,
    settings=recommendation_settings,
)
html = build_html(
    report,
    recommendation_bundle=bundle,
    browser_url="https://your-chart-browser.example/",
)
```

Alternatively load an existing bundle and pass it directly to `build_html` or
`render_report`; this works without the engine installed. Browser links are
optional. They contain public catalog/chart identities, never player identifiers
or tokens. Opening a link is explicit user navigation and does not upload scores.

Only compact, validated card fields are embedded. The complete catalog and
personal overlay are not copied into a dashboard. Recommendations cannot postdate
the report cutoff, and their own prepared date stays visible. Empty shortlists
leave the original Targets view in place; successful shortlists retain original
session suggestions in an expandable section.

This is an additive integration for new builds. No historical report regeneration,
live Worker change, archive migration, score import or automatic publication is
part of the repository separation. The installed private report core should adopt
the adapter through its own reviewed release after this milestone.
