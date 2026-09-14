# Report integration

The public [maimai Session Report](https://github.com/arussin/maimai-session-report)
product and this chart browser remain independently installable.

## Current integration

Session Report ships Open in Party links and reusable player files. Use its
[Party integration guide](https://github.com/arussin/maimai-session-report/blob/main/docs/MAIMAI_PARTY.md)
and [player-file guide](https://github.com/arussin/maimai-session-report/blob/main/docs/PLAYER_FILE.md)
for the supported report interface. The browser's [player-data contract](PLAYER_DATA.md)
describes validation, matching, merging and local personal mode.

The report vendors the small public interfaces it needs; generating reports does
not require installing the full chart-browser engine. Importing a player file
reads and merges it in the browser; no score account or upload service is created.
The report guide describes the explicit handoff and its validation.

## Separate prepared-card draft

[Session Report draft PR #2](https://github.com/arussin/maimai-session-report/pull/2)
proposes optional prepared recommendation cards. Its
[original integration design](https://github.com/arussin/maimai-session-report/blob/9218148366f465ade5b373cc4bcecd6135016011/docs/BROWSER_INTEGRATION.md)
documents the proposed adapter and arguments.

The draft's `maimai_report.browser.export_browser_bundle`,
`recommendation_bundle` and `browser_url` interfaces are not part of current
Session Report main. Review any remaining value against the shipped Party
integration before porting the draft; do not merge the stale branch wholesale.
