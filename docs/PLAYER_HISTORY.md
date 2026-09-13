# Imported play history

Player files retain three different kinds of evidence: source plays, best-score
snapshots, and the captures that observed them. A capture is not proof of a play
or of membership in a particular session. Recent-score windows may overlap.

The main chart history lists actual plays using their original `timeAchieved`.
Saved PB changes are separate, use explicitly labeled saved dates, and group
consecutive snapshots with unchanged visible results. A saved PB can exist without
any retained play for the chart.

Older reports can contain both a source score and a compact summary without its
score ID. The importer reconciles such a summary only when exactly one source
play in the same capture matches its chart, known positive play timestamp,
achievement, and every other known summary field. Missing optional fields may
match richer source data. Two source IDs are never merged, even with identical
timestamps and scores. Multiple matching summaries or sources remain unresolved;
matching records found only in unrelated captures are insufficient evidence.

Reconciliation preserves all original record and PB snapshot objects. It removes
only the redundant summary play reference, replaces it with the source play in
derived capture membership, and reseals content hashes. Original archive captures
are untouched. Repeated old/new imports converge on the same dataset, and saved
browser profiles are reconciled on restore. Wire payloads are still validated
before reconciliation, so older report handoffs remain compatible.

Python and browser implementations have matching regression tests for ambiguous
repeats, conflicting optional data, absent dates, unrelated captures, repeated
imports, unchanged PBs, and saved-profile restoration. Public tests use fictional
records only.
