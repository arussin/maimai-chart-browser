# Report integration

[maimai Session Report](https://github.com/arussin/maimai-session-report)
connects session reports to maimai.party through **Open in Party** links and
reusable player files. Generating a report does not require installing the
chart-browser engine.

## Use your report with maimai.party

Open in Party links lead from a report to song details and similar charts.
You can accept the report's offer to transfer your player data, or import an
exported player file in maimai.party. The browser validates and merges the
data locally; no score account or upload service is created.

See Session Report's
[player-file guide](https://github.com/arussin/maimai-session-report/blob/main/docs/PLAYER_FILE.md)
for the import walkthrough and its
[Party integration guide](https://github.com/arussin/maimai-session-report/blob/main/docs/MAIMAI_PARTY.md)
for export commands, hosted installations and recovery.

## For developers

The browser's [player-data contract](PLAYER_DATA.md) describes the file format,
validation, chart matching, merging and local personal mode.
