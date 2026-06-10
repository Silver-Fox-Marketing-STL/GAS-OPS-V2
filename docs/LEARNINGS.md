# LEARNINGS — hard-won gotchas (GAS, Sheets, Git, MCP)

Accumulated from V2 development. Check here before debugging "impossible" behavior.

## Google Apps Script

- **6-minute execution limit.** Anything per-vehicle and network-bound must be
  batched: QR generation uses `UrlFetchApp.fetchAll()` (one parallel batch —
  ~3–5s for 50 vehicles vs 100s+ sequential).
- **`google.script.run` fails silently** on non-existent or underscore-suffixed
  (private) function names — no error, the spinner just hangs. Verify names exactly.
- **Modal iframes ignore CSS flex height.** `height: 100%` / `min-height: 0`
  don't propagate; calculate explicit pixel heights in JS (see `sizeTable()` in
  NormManager). Sidebars are hard-capped at 300px — use modals.
- **PropertiesService is cross-execution.** ScriptProperties writes from one
  running execution are visible to concurrent ones — this is what makes the
  progress-bar polling pattern work (`run_progress_{runId}`, polled every 1.5s).
- **`openById` vs `getActiveSpreadsheet()` cache inconsistency.** Writing with
  one handle and immediately reading with the other can miss data even after
  `flush()` ("No VINs found"). Use the same accessor for write+read pairs, and
  the module-level `getConfigSS_()` cache for SF_DEALER_CONFIG (one `openById`
  per execution instead of 13).
- **Fixed sleeps waste time.** After writing QUERY/ARRAYFORMULA, wait with
  `calcRecalcDelay_(rows, msPerRow, min, max)` instead of `Utilities.sleep(3000)`.
- **Large reads time out.** 5,000+ row SCRAPERDATA: never `getRange` the full
  21-column sheet from a modal call. Two-pass: read the Location column only,
  find the matching row span, read just that span.

## Google Sheets behavior

- **QUERY silently drops mixed-type minority values.** Purely numeric stock
  numbers get auto-converted to numbers; alphanumeric ones stay strings; QUERY
  then drops one side. Fix: `String()` conversion + `@` number format set
  **before and after** `setValues()` on VIN and Stock.
- **QUERY `MATCHES` doesn't reliably honor `(?i)`** — use explicit-case patterns.
- **Substring traps in type matching.** `SEARCH("CPO", "CPO-EL")` matches.
  Order checks CPO-EL → CPO → New → fallback, in formulas and in `type_rules`.
- **`getValues()` returns real booleans** for TRUE/FALSE cells — compare with
  the `isTrue_()` helper, not string equality.
- **Merged cells break programmatic repositioning** — the DASHBOARD is written
  with zero merged cells for exactly this reason. `setRgbColor()` via
  `SpreadsheetApp.newColor()` handles hex backgrounds without Advanced Services.

## Git / GitHub (incl. GitHub MCP)

- `create_or_update_file` needs an explicit `branch` and a **fresh SHA** fetched
  immediately before the write — stale SHAs fail; omitted branch fails silently.
- `Code.gs` (~124KB) exceeds the MCP push limit — handle it via local `git push`
  or hand the file over for a local commit. `push_files` is unreliable for large
  single files; prefer `create_or_update_file` per file.
- Verify pushes by comparing blob SHAs, not by re-reading content. Pushing
  identical content to two branches yields matching blob SHAs (no merge conflicts).
- Always pull fresh from GitHub before editing — local copies and project-knowledge
  copies of `Code.gs` go stale fast.

## Sheets MCP

- `get_sheet_data` can return empty for QUERY spill ranges (read-timing);
  verify QUERY output another way before concluding it's broken.
- API quota is 60 reads/min/user — batch with `get_multiple_sheet_data` /
  `get_multiple_spreadsheet_summary`, and back off on 429s.
- `batch_update` quirks: `unmergeCells` must precede any `repeatCell` in the same
  request array; column deletions must run right-to-left (highest index first);
  `deleteDimension` is 0-indexed and needs the numeric `sheetId`, not the name.
- `update_cells` rejects values starting with `=` — use `--- SECTION ---`
  delimiters in documentation cells, never `=== SECTION ===`.
- `find_in_spreadsheet` with an exact string is the fast way to locate a known
  bad value in a large sheet.

## System design lessons

- Hardcoded column indices are fragile: the RUN_LOG 19→23 expansion silently
  broke `getRunsForDealer` until its read width was updated. When widening any
  sheet schema, grep for every read of that sheet in the same change.
- Config keys the code doesn't read are landmines (`model_trim_split` sat inert
  in Glendale's `data_transforms`) — when adding config, wire it up or don't add it.
- Explicit JSON config per dealer beats implicit defaults — every dealer's
  `type_rules`/`filtering_rules` is fully written out, so a blank cell is a bug,
  not a default.
- Non-critical writes (stats, dashboard) get their own try/catch so they can
  never fail a production run; the same isolation rule applies to the planned
  Pipedrive push.
