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
- **Per-file DriveApp calls in loops are the easiest way to accidentally build
  a minutes-long operation.** `createFile`/`setTrashed` cost ~120ms EACH; a few
  hundred files = a perceived hang. Batch via `UrlFetchApp.fetchAll` against
  the Drive REST API with `ScriptApp.getOAuthToken()` (multipart upload for
  creates, `PATCH {trashed:true}` for trashes — see `trashFilesParallel_` /
  `generateQRCodesParallel_`). Related: folders that only ever accumulate
  (the QR folders did, with duplicate filenames) make every later folder
  operation slower — clear at the start of the producing operation.
- **A comparison table inside a narrow, `overflow:hidden` card silently drops
  trailing columns.** The import conflict panel put cards in a 2-col grid
  (wide-canvas rework); each half-width card had `overflow:hidden`, and the
  inner `table-layout:auto` table with a fixed-width first column over-allocated
  width to the middle column and pushed the third ("New") column past the
  clipped edge — so it just wasn't visible, while the DOM still contained it.
  For any side-by-side comparison table use `table-layout: fixed` (+ `width:100%`
  and `word-break`) so every column gets allocated width and content wraps;
  don't rely on a fixed-width card to fit an auto table.
- **Growing a fixed-width sheet schema: append-only + relocate the edge marker.**
  SCRAPERDATA was a hard-coded 21 columns (A–U) with the scraper timestamp parked
  just past it at `W1:X1`. To let new columns be added at runtime: (1) move the
  timestamp OUT to an isolated `META` tab first (a marker adjacent to the data
  area blocks growth and gets clobbered once columns reach it); (2) make the width
  a single dynamic source of truth (`getSchemaColCount_()` reading a `SCHEMA`
  config tab, **cached per execution** — it's on the per-row dedup hot path);
  (3) **only append** (col V+) — never insert/reorder, so every fixed index
  (`NORM_COL`, `FILTER_FIELD_INDEX`, Location=19, URL=20, the `SELECT A:U` QUERY)
  stays valid; (4) keep the *run* path (output template + QUERY) at the base 21 —
  only the *master import* path goes dynamic; a new column is store-only until
  separately wired downstream. Normalize row width right before `setValues` so a
  stale client width can't throw.
- **Formatting calls in loops are ~12× more expensive than block formatting.**
  The DASHBOARD's per-row stripe loop issued ~500 range ops per import; one
  `setBackgroundObjects(matrix)` + column-scoped alignment calls do the same
  work in 7 ops. Build matrices in memory; touch ranges once.
- **`SpreadsheetApp.getUi().alert()` FAILS when invoked via `google.script.run`**
  (no UI context in client-invoked executions). Server functions that need to
  report to a dialog must RETURN a message for the client to render; keep the
  alert only in menu-invoked wrappers (see the `*Core_` / `app*` split).
  `Spreadsheet.toast()` works from any context.
- **SPA-in-a-modal conversion lessons (App shell, June 2026):**
  hidden views (`[hidden]` + show/hide nav) retain full DOM + JS state —
  polling intervals, pending panels, dirty flags all survive navigation, so
  per-view state machines need no rework. But: (1) author `display:flex` on a
  view root DEFEATS the UA `[hidden]` rule — ship
  `.view[hidden]{display:none !important}`; (2) include shared-utils fragments
  BEFORE view fragments — views register guards/inits at parse time;
  (3) height math must measure the view container, never `window.innerHeight`,
  and element queries must be view-scoped (`view.querySelector('.top-bar')` —
  a global query matches other views in the shared DOM); (4) never assign
  `window.onresize` from a fragment (single-owner slot) — use
  `addEventListener`; (5) operations that were implicitly exclusive when each
  modal was its own dialog (import vs run) need explicit mutual exclusion
  (`AppBusy`) once they share one page.
- **The HtmlService SPA parses ALL view fragments into ONE shared global JS
  scope.** Every `<?!= include_('ViewXxx') ?>` fragment's `<script>` is concatenated
  into the same window, so a duplicate **top-level** `function name()` in two
  fragments silently clobbers — last-loaded wins, breaking whichever view defined
  the other one (no error; the function just isn't what that view expects). Defenses:
  (1) **prefix per-view helpers** by view (the codebase uses `ps*` / `tr*` / `pd*`)
  or (2) factor ONE shared implementation and call it from both (e.g. the
  context-parameterized `psRenderRuleCard_`/`psSerializeOneRule_`/`psDeserializeOneRule_`/`psRegisterRuleCtx_`
  reused by ViewRules and ViewPipedriveSettings). **Nested** functions are
  function-scoped and safe — only top-level declarations collide. `App.html` and
  `Classic.html` are separate entry points (never co-loaded), so a name shared
  between those two shells is fine. Caught by a cross-fragment function-name
  collision audit — run one when adding a view.

## External APIs (Pipedrive)

- **Pipedrive v1 deal custom fields are TOP-LEVEL hash keys, not a
  `custom_fields` object.** The `{custom_fields: {...}}` wrapper is a **v2**
  convention; the v1 `/deals` create/update API takes each custom field as a
  top-level key (the 40-char field hash), and a **monetary** field needs both
  `<key>` (the amount) and `<key>_currency`. Passing the v2 nested shape to a v1
  endpoint silently **no-ops** the fields — the call succeeds, the values just
  don't land. (`pdResolveDealFields_` returns a flat `{key:value}` map, incl. the
  `_currency` companion, precisely so it can be passed straight to `pdUpdateDeal_`.)
- **Idempotency for "create" external calls: write the external ID to a durable
  LOCAL record the INSTANT the API returns it, and treat that ID's presence as
  "already created."** The Pipedrive push writes the new Deal ID to RUN_LOG col D
  immediately after creation, then treats a numeric col D as a dup guard — so a
  retry after a mid-push failure can never create a second deal. Track multi-step
  progress (products attached? fields set?) in **ScriptProperties** (cross-execution)
  so a retry resumes instead of repeating completed steps. The local write must
  happen *before* the later, failure-prone steps — not at the end.
- **External-API secrets live in ScriptProperties, never the repo or a config
  sheet** — and are **validated before they're saved** (`setupPipedriveSecrets`
  does a live `GET /users/me` first; nothing persists on failure). A status/echo
  endpoint exposed to the UI must **never return the token** (`getPipedriveStatus`
  returns domain + defaults only).
- **A never-throw fetch wrapper is the same isolation discipline as the non-fatal
  stats/dashboard writes.** `pdFetch_` returns `{ok, status, data, error}` instead
  of throwing, with one bounded 429 backoff, so an API hiccup surfaces as a
  retryable message — it can **never** fail the run it's attached to. Same rule as
  "non-critical writes get their own try/catch": an integration bolted onto a
  production run must isolate every failure mode at the boundary.
- **Pipedrive product variations live behind a SEPARATE endpoint, not in the
  product response.** A product's variations come from `GET /v1/products/{id}/variations`
  — they are *not* embedded in the `/products` list payload — so fetch them
  **lazily, per product**, only for the products that actually pin a `variation_id`
  (`pdListProductVariations_`). A variation carries its own `prices[]`, so resolve
  `item_price` from the variation first (product prices as fallback), and key
  line-item idempotency by **product + variation** (`product_id|variation_id`), not
  product alone — otherwise two variations of one product collapse into a single
  line.

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
- **`getValues()` returns numbers (and Dates) from non-`@` columns.** SCRAPERDATA
  only forces text on VIN/Stock/Price/Date-In-Stock; Year, MSRP, Postal Code etc.
  come back as numbers (`2024`, `6234` for `"06234"`). Comparing sheet data
  against incoming string data needs a tolerant comparator (trim-string equal OR
  both-numeric equal — `cellsEqual_`), or merge-mode imports false-conflict on
  every row. Also: **`google.script.run` cannot serialize Date objects** — any
  sheet rows returned to a modal must be display-stringified first.
- **`PRICE_RAW` (ORDERMATCH col H) is stored as text, not a number.** `ISNUMBER(H2:H)`
  is FALSE for it, so any formula guarding on `ISNUMBER` blanks every row (this is
  exactly how the first `PRICE_TAGLINE` formula failed). Arithmetic (`H2:H+2000` in
  `PRICE_PLUS_2000`) works because `+` coerces text→number, but **comparisons don't
  coerce** — and Sheets sorts any text *above* any number, so `H2:H>=15000` is TRUE
  for every text price. For numeric comparison on a price, convert first:
  `IFERROR(IF(VALUE(H2:H)>=15000, …), "")`.
- **Merged cells break programmatic repositioning** — the DASHBOARD is written
  with zero merged cells for exactly this reason. `setRgbColor()` via
  `SpreadsheetApp.newColor()` handles hex backgrounds without Advanced Services.
- **Volatile full-column formulas in a config sheet can make it unreachable to
  code while the browser stays fine.** SF_DEALER_CONFIG's NORM_MAPS cols E+ held
  live `UNIQUE(SCRAPERDATA!…)` reference formulas. They were cheap for years, but
  once SCRAPERDATA passed ~10k rows (and a large import invalidated them all at
  once), recalculation made *programmatic* access — Apps Script `openById`/`getValues`
  AND the Sheets REST API — fail with `Service Spreadsheets failed` after a ~100s
  timeout, taking down every config-reading modal and `importScraperData`. The
  interactive web UI never blocks on recalc, so it kept opening fine — which is the
  tell that it's a recalc/serving cost, not an outage or a code bug. Fix: replace
  volatile reference formulas with an **on-demand static writer** (`refreshNormReference()`)
  that computes uniques in code and writes plain values — zero standing recalc cost.
  Diagnosis tip: a 503/timeout on ONE spreadsheet via the API while another reads
  fine, plus the browser working, points at that document's serving cost, not your code.

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
- **A rule engine's safe-failure direction follows its polarity — keep the
  vehicle either way.** The original `filtering_rules` `conditions` were *inclusion*
  filters ("keep only if it matches") and so failed **OPEN** — `evaluateCondition_`
  *passed* the vehicle on any misconfig (unknown field/op, empty values, bad number).
  The June 2026 `targeting_rules` rewrite flipped to *exclusion-on-match* ("if it
  matches, ACT") — so the predicate (`conditionMatches_`/`groupMatches_`) now fails
  **SAFE = no-match** (returns false, plus empty group → false). Opposite boolean,
  **same real-world outcome: a non-programmer's typo can never silently empty a
  dealer's inventory.** The lesson is to pick the failure value by what it *does*
  (keep the car), not by a fixed "always return true." Inverting an inclusion config
  to an exclusion one also inverts every op (`not_contains`↔`contains`, `gte`↔`lt`,
  `lte`↔`gt`) — which is why `gt`/`lt` had to be added alongside `gte`/`lte`.
- **Make/Model are RAW (un-normalized) in SCRAPERDATA** (only Type/Trim/Status/
  Price are normalized). For targeting on make/model, prefer `contains` and list
  keyword variants (`F-250` *and* `F250`) — exact-match (`in`) is brittle against
  feed inconsistency. Numeric ops on price must strip `$`/`,` first (prices are text).
- **One field→column map, surfaced to the UI.** The cached, schema-driven
  `getFilterFieldIndex_()` (which replaced the static `FILTER_FIELD_INDEX`) is the
  single source of truth for condition fields; `getRulesEditorBootstrap` returns the
  schema fields + ops + actions so the Rules Editor dropdowns can't drift from the
  engine. Duplicating the list in HTML would be a latent divergence bug.
- **Never clear a sheet before the pipeline that refills it has finished.** The old
  `importScraperData` cleared SCRAPERDATA first, then normalized/wrote — any throw
  mid-pipeline left the sheet empty. Destructive writes belong at the END, after all
  computation succeeds (the two-phase import keeps every mutation below the
  conflict gate for the same reason).
- **CSV uploads from the wild need a BOM strip and a mid-file header guard.** A
  UTF-8 BOM makes the first header read as `\uFEFF` +"VIN" and silently fail
  exact-match mapping; concatenated exports hide header rows mid-data (caught by
  VIN cell == literal "vin"). Strip `^\uFEFF` per file before parsing.
