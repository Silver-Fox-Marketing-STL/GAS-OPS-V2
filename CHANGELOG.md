# Changelog

All notable changes to GAS-OPS-V2 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Entries are grouped under **Added**, **Changed**, **Fixed**, and **Removed**.
Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).

---

## [Unreleased]

### Performance — `feature/app-shell` efficiency sweep
- **Parallel QR uploads** — `generateQRCodesParallel_` now uploads all PNGs via parallel multipart requests to the Drive REST API (`UrlFetchApp.fetchAll`, 50/batch, per-file DriveApp fallback on errors) instead of one sequential `createFile` per PNG. Expected 6–24s → ~1–3s per run.
- **QR folder hygiene + batch Drive operations (the "minutes/hangs" fix).** Dealer QR folders accumulated every run's PNGs forever (duplicate filenames included); `abandonRun` then iterated the entire folder with one sequential `setTrashed()` per file (~120ms each — 60+ seconds at a few hundred files). Now: (1) the dealer's QR folder is **auto-cleared at run start** (old PNGs → Drive trash, 30-day recovery) so folders only ever hold the current run; (2) new `trashFilesParallel_` batch-trashes via the Drive REST API with `UrlFetchApp.fetchAll` (100/batch) — `clearQRFolder_` and abandons complete in ~1–2s regardless of file count; (3) `generateQRCodesParallel_` returns the created **file IDs**, carried on `pendingRuns` entries, so `abandonRun(dealerKey, outputDocId, qrFileIds)` trashes exactly this run's files by ID (legacy name-scan kept as fallback).
- **Spreadsheet-handle caches**: `getMasterSS_()` / `getVinLogsSS_()` mirror the existing `getConfigSS_()` single-open-per-execution pattern; all 14 scattered `openById(MASTER_SHEET_ID/VIN_LOGS_ID)` call sites routed through them (saves ~0.4–1s on executions touching these docs more than once; `getActiveSpreadsheet()` sites intentionally untouched per LEARNINGS).

### Added — `feature/app-shell` (in progress)
- **Run Order view migrated (commit 7) — all five views now live in the App.** `DealerSelector.html` → `ViewRun.html` fragment (incl. the new split-deal + post-run finalization flow): scoped CSS, run-prefixed ids/helpers, lazy `initRunView`. **Cross-view jump:** "Update VIN Log" now switches to the VIN Logs view with the dealer preselected — pending finalization cards **survive** the jump (hidden views keep their state; the old dialog swap destroyed it). Run-side `AppBusy`: a run blocks imports and vice-versa; close guards cover live runs and un-finalized cards; Cancel/Close routes through the shared guarded `exitApp()`. Classic "Run Dealer..." serves the same fragment.
- **Dealer Rules view migrated (commit 6)** — `RulesEditor.html` → `ViewRules.html` fragment: CSS scoped under `#view-rules` (root gets `position:relative` so the loading overlay covers only this view), `status`/`dealerSelect` → `rulesStatus`/`rulesDealerSelect`, `setStatus`→`setRulesStatus`, shared `escHtml`, lazy `initRulesView` (bootstrap), and a close guard for unsaved `typeDirty`/`filterDirty` edits. Classic "Edit Dealer Rules..." serves the same fragment.
- **VIN Logs view migrated (commit 5)** — `VINLogUpdater.html` → `ViewVinLog.html` fragment: CSS scoped under `#view-vinlog`, `status`/`dealerSelect`/`vinCount` → `vinlogStatus`/`vinlogDealerSelect`/`vinlogVinCount`, `setStatus`/`updateVinCount` → `setVinlogStatus`/`updateVinlogVinCount`, lazy `initVinlogView` (dealer load + listeners), Close → guarded `exitApp()`. New `vinlogPreselectDealer(key)` for the upcoming Run→VIN Logs cross-view jump (stashes the key if dealers are still loading). Classic "Update VIN Log..." serves the same fragment.
- **Import view migrated (commit 4)** — `ScraperImport.html` → `ViewImport.html` fragment: CSS scoped under `#view-import`, `status`→`importStatus`, `setStatus`→`setImportStatus`, local `escHtml` removed (SharedUtils copy), panel heights `100vh`→`100%`. New **AppBusy interlock**: importing is blocked while a dealer run is active and vice-versa (an import rewrites SCRAPERDATA mid-run — impossible when modals were exclusive); the import stays "busy" through conflict resolution until Apply/Cancel. Close guard registered (in-flight/conflict-pending import warns on exit). SharedUtils include moved to the TOP of both shells (fragments register guards at parse time). Classic "Import Scraper Data..." serves the same fragment.
- **Normalization view migrated (commit 3)** — `NormManager.html` → `ViewNorm.html` fragment (pattern-setter for the remaining views): CSS scoped under `#view-norm`, `status`→`normStatus`, `setStatus`→`setNormStatus`, `sizeTable`→`sizeNormTable` rewritten to measure the view container with view-scoped queries (window-based sizing is wrong inside the shell; global `.top-bar` queries would hit other views), `addEventListener('resize')` instead of claiming `window.onresize`, lazy `initNormView` via the view registries, Close → guarded `exitApp()`. Classic "Manage Normalization Maps..." now serves the same fragment via `openViewStandalone_`. Sidebar item enabled.
- **Home utilities live (commit 2)** — the five utility actions run from the Home page with in-app toast feedback and double-click protection; destructive ones (Clear QR Folders, Clean Up Old Output Docs) confirm first. Core/wrapper split in Code.gs because `ui.alert()` fails when invoked via `google.script.run`: `eraseAllQRFoldersCore_`/`appEraseAllQRFolders`, `cleanUpOutputDocsCore_`/`appCleanUpOutputDocs`, `refreshNormReferenceCore_`/`appRefreshNormReference` (menu wrappers keep their alerts); `fillScraperDateTime` returns `{message}` (refreshes the Home status strip); new `appOpenRunLog` activates the RUN_LOG tab behind the modal.
- **SilverFox App shell (commit 1)** — single-modal SPA foundation: new `App.html` (left sidebar nav + header + content area, Gmail-style), `ViewHome.html` (workflow launcher cards + utilities placeholder + last-import status strip via new `getAppHomeStatus()`), `SharedUtils.html` (shared `escHtml`, `toast`, `AppGuards`, `AppBusy`, view registries), `Classic.html` (standalone single-view wrapper for the fallback menu). Code.gs: `include_()` template helper (first HtmlService templating use), `openApp()`, `openViewStandalone_()`. Menu rewritten: **🚀 Open SilverFox** + "Classic menu (deprecated)" submenu with all 10 existing items (fallback during validation). The five modal views migrate into the App one commit at a time; un-migrated sidebar items are dimmed "coming soon".

### Known issues
- `CDJR_OF_COLUMBIA` `scraper_location_name` intentionally remains `"Joe Machens Chrysler Dodge Jeep Ram"` to match the live scraper feed; update when the feed reflects the new dealer name
- Dave Sinclair Lincoln: used cars have no price in the scraper feed, so a "used ≥ $35k" targeting rule cannot function until used prices are scraped

### Planned
- **Log capacity plan (documented; build at trigger)** — "Capacity & Log Growth Plan" section added to the Bridge doc: hard limit 10M cells/spreadsheet, practical limit (full-tab readers: `checkImportHealth_`, DASHBOARD QUERY, `getRunsForDealer`) at ~25k–50k rows ≈ 2–3 years at production pace. Trigger: any log tab > ~25k rows or visible slowdown → build menu-driven `archiveOldLogs()` (rows older than 12 months → `SF_LOG_ARCHIVE`, per-year tabs; no live function references the archive; never archive SF_VIN_LOGS).
- **Trim cleanup (analyzed; deferred)** — docs-only for now: full analysis + a validated auto-cleanup design (global `cleanTrim_` regex pass behind an `ENABLE_TRIM_CLEANUP` flag + `dryRunCleanTrim_` preview, plus residual exact-match rules) written into the Bridge doc ("Trim Normalization & Cleanup — Analysis & Deferred Design"). Approach decision (A full / B phased / C exact-only) pending.
- Pipedrive post-run API integration (architecture designed; `pushToPipedrive_()` to be isolated in its own try/catch; config expansion at columns P–V requires updating hardcoded `CFG.FILTER_RULES` index)
- Unresolved order configurations: Auffenberg Hybrid (Courtesy Loaners NEW→USED)
- Trim cleanup approach decision (A full / B phased / C exact-only) — see Bridge doc deferred-design section
- Architecture hardening: IFERROR-wrapped ORDERMATCH formulas, self-describing field-to-column map, resumable runs (6-minute Apps Script ceiling), regression harness, scheduled config audits, extended per-run caching

---

## [2026-06-12] — v2.10: Post-run finalization (deferred deal IDs + abandonable runs)

### Changed
- **RUN_LOG and ORDER_STATS are now written only at a post-run finalization step — never during the run.** `runDealer` step 17 builds self-contained `pendingRuns` entries (one per prospective log row; two for a billing-split run with group units) and returns them to the modal instead of writing rows. New `finalizeRun(dealerKey, entry, dealId)` writes one RUN_LOG (+ ORDER_STATS) row per finalized entry via the unchanged `writeRunLog_`.
  - **Invariant: no RUN_LOG row is ever written with a blank deal ID.** Finalizing requires one; enter `test` for test runs.
  - **Invariant: the VIN log is never written implicitly.** Finalizing only logs the run; the VIN log is touched solely by the explicit "✓ Add to VIN Log" button or the VIN Log Updater.
  - Motivating case: Pipedrive deals are only created once an order is known to exist — a zero-match CAO run (or the Sprinter half of an MBCC run with no vans) no longer demands a deal ID that would have to be cancelled.
- **Deal ID fields are now optional at run time for all dealers** (primary and split). They remain on the pre-run form purely to pre-fill the finalization cards; the Run button is gated on user + dealer + VINs only. Server-side required-throws removed from `pasteVinsAndRun`.
- **Post-run panel reworked into finalization cards** (DealerSelector.html): one card per prospective entry showing label + unit counts, a deal ID input (pre-filled when entered up-front), and **Finalize** / **Abandon** buttons. Cards act independently — e.g. abandon a 0-match primary and finalize the Sprinter half. "✓ Add to VIN Log" enables only once ≥1 card is finalized (0-VIN finalized rows are excluded from commit). Discard guards (confirm dialogs) protect un-finalized results on dealer change, on starting a new run, and on the Cancel/Close button. The dialog's X-close cannot be intercepted (GAS limitation) — an X-closed run is simply never logged; recovery is re-running or the VIN Log Updater's manual-entry panel.

### Added
- **`abandonRun(dealerKey, outputDocId)`** — when abandonment leaves no live cards (nothing finalized, nothing pending), the run's artifacts are deleted after a warning popup: the output doc and the dealer's `<prefix>_QR_Code_N.PNG` files are moved to **Drive trash** (recoverable 30 days, not a hard delete). A partially-abandoned split run (sibling card finalized or pending) keeps the shared doc/QRs and the abandon is bookkeeping-only — a distinct popup explains the difference.

### Fixed
- Typing in the pre-run deal ID fields after a run no longer clears the post-run state (the old input listeners called `hidePostRunActions()` on every keystroke, which would have silently discarded pending finalization cards).

### Behavior changes (documented)
- Running `runDealer` directly from the Apps Script editor no longer writes RUN_LOG — it returns `pendingRuns` without logging.
- An abandoned run leaves no trace in RUN_LOG/ORDER_STATS; a run discarded by closing the modal leaves its output doc in Drive (aged out by `cleanUpOutputDocs`).

---

## [2026-06-12] — v2.9: Billing split for shared-feed dual accounts (MBCC/Sprinter)

### Added
- **Billing split for shared-feed dual accounts (MBCC / Sprinter of Creve Coeur).** One run, one CSV (one Illustrator setup) — but billing separated per account. New optional `billing_split` key in `filtering_rules` (col W), no per-dealer code:
  ```json
  "billing_split": { "group_name": "SPRINTER", "deal_label": "Sprinter Deal ID",
                     "field": "model", "op": "contains", "values": ["Sprinter", "Metris"] }
  ```
  - `getBillingSplit_(config)` parses/validates (fields `model/make/trim/type` — ORDERMATCH vehicle keys, intentionally not `FILTER_FIELD_INDEX`; ops `contains`/`in`, case-insensitive, any-value OR). **Fail-safe:** absent or malformed → run behaves exactly as today.
  - `writeBillingSheet_(outputDoc, billingSplit)` partitions matched vehicles via `isInBillingGroup_`; the five-section layout is extracted into `renderBillingSheet_(sheet, …)` and rendered twice: **BILLING** (primary account, excludes group units; also carries the not-found list, which can't be classified) and **BILLING_<group>** (created on demand with `insertSheet` — the universal template is intentionally untouched). Sums across both sheets equal the old single-sheet totals. `readBillingTotals_` gains an optional `sheetName` param.
  - **Two Pipedrive deal IDs per run:** Run Dealer modal shows a second required deal ID field (label from `deal_label`) only for split dealers (`getActiveDealersForUI` now returns `splitDealLabel`); `pasteVinsAndRun`/`runDealer` gain a trailing `splitDealId` param with server-side validation.
  - **Two RUN_LOG rows per split run** (same `output_doc_id`/dealer_key; notes col U = `SPLIT:PRIMARY` / `SPLIT:<group>`): each row carries its own deal ID, per-account totals, and produced VINs, so VIN Log Updater commit/rollback works per account **unchanged** (rollback keys on deal ID + committed_at). Zero group units → second row skipped (note `split: 0 <group> units` instead). ORDER_STATS likewise gets one clean row per account. Caveat: sheet-side QUERYs counting RUN_LOG rows see a split run as two rows — filter on `notes` if needed.
  - VIN log: single dealer tab as before — group VINs commit under the group's deal ID; dedup/duplicate-flagging is identifier-based and unaffected.
  - Post-run "✓ Add to VIN Log" commits both rows via new `commitRunRows(dealerKey, rowIndexes)` (skips already-committed rows, so retry after a partial failure is safe). VIN Log Updater shows a `SPLIT:*` badge per row (`getRunsForDealer` now returns `note`).
  - Split applies even with "Bypass filtering rules" — it's billing-time classification, not a filter.

### Fixed
- **Rules Editor silently dropped unknown `filtering_rules` keys on save.** `collectFilteringRules()` rebuilt the JSON from UI-managed keys only, so any passthrough key (now: `billing_split`) was erased by the next Filtering save. The editor now stashes unmanaged keys on load and re-merges them on save.

### Config
- MBCC (`MERCEDES_CREVE_COEUR`, DEALERS row 25): `billing_split` added to `filtering_rules` (`field: model, op: contains, values: ["Sprinter", "Metris"]`); notes column updated. Resolves the long-standing "MBCC/Sprinter shared inventory" item — Option B (one run, two billing outputs).

> The "second deal ID **required** at run time" behavior described above was superseded the same day by v2.10 (deal IDs optional pre-run; entered at finalization).

---

## [2026-06-11] — v2.8: Multi-file import + modal layout rework

### Added
- **Multi-file import with Replace/Merge modes** (`ScraperImport.html` + `importScraperData` rewrite):
  - **Main Import (Replace)** — select 1+ CSVs, merged into one dataset, clears SCRAPERDATA (previous behavior, now multi-file). **Merge with Existing** — combines the selected file(s) with the current SCRAPERDATA contents.
  - **VIN dedup/conflict engine** (`dedupeScraperRows_`, server-side, post-normalization): same VIN + identical data kept once silently; differing data → 2-way conflict (incumbent vs newest challenger) resolved per-VIN in a new conflict panel (side-by-side diff of only the differing fields, sources labeled by filename, bulk Keep-All buttons via the `resolutions['*']` fallback). Tolerant comparator `cellsEqual_` (trim-string or both-numeric) prevents false conflicts from `getValues()` numeric coercion.
  - **Two-phase protocol**: phase 1 detects conflicts and returns them with **zero mutation**; phase 2 re-sends the payload + resolutions, verified against an optimistic-concurrency token under a `LockService` script lock. All mutations moved below the gate — fixes the latent hazard where the old importer cleared SCRAPERDATA *before* processing (a mid-pipeline error left the sheet empty).
  - Per-file header mapping (files may differ in column order/set), per-file preview cards, all-or-nothing validity gate (a file without a VIN column blocks the import), **UTF-8 BOM strip** per file (fixes a latent silent VIN-unmatch bug), and a **mid-file header guard** (drops stray "VIN" header rows from concatenated exports).
  - Final dataset **grouped by Location** before writing (preserves `getDealerScraperData_`'s contiguity invariant in both modes); stats/health/dashboard computed on the final dataset so IMPORT_STATS baselines stay sane in merge mode. Review panel gains mode-aware totals + Import Summary badges (files, mode, duplicates removed, conflicts resolved, rows without VIN).

### Changed
- **All five modals resized to a uniform 1400×900** (`MODAL_WIDTH`/`MODAL_HEIGHT` constants): Run Dealer, Import Scraper Data, Normalization Maps, VIN Log Updater, Dealer Rules Editor. The browser viewport is the effective cap; verify on the smallest screen used to run orders.

### Fixed
- **"View Run Log" menu item did nothing.** `openRunLog()` called `.activate()` on a sheet obtained via `openById()` — activation only moves the UI on the active-spreadsheet instance. Switched to `getActiveSpreadsheet()`; the menu item now jumps to the RUN_LOG tab as intended.

---

## [2026-06-10] — v2.7: Targeting rules + Dean Team Brentwood + NORM_MAPS performance fix

### Added
- **`refreshNormReference()` + "Refresh Norm/Field Reference" menu item** — on-demand, static replacement for the NORM_MAPS cols E+ reference. Scans SCRAPERDATA once and writes sorted distinct values per column (Type/Make/Model/Trim/Status/Body Style/Fuel Type) with counts + a timestamp; zero ongoing recalc cost. Doubles as the lookup for exact raw values when authoring targeting conditions.
- **Generalized targeting rules in `filtering_rules`** — two new optional keys, fully configurable in the Edit Dealer Rules modal (Filtering tab), no per-dealer code:
  - **`conditions`** — array of generic field criteria `{field, op, values, applies_to?}`. `field` ∈ type/year/make/model/trim/ext_color/status/price/body_style/fuel_type/msrp (mapped by new `FILTER_FIELD_INDEX` constant); `op` ∈ in/not_in/contains/not_contains (string, case-insensitive) or gte/lte (numeric, price-safe — strips `$`/`,`); `applies_to` scopes a condition to specific types. New helper `evaluateCondition_` is **fail-open** on misconfiguration (unknown field/op, empty values, NaN) so a typo can never empty a dealer. Applied in **both** CAO and run phases (Bypass checkbox overrides).
  - **`cao_exclude_types`** — types skipped during CAO auto-fill only; still print when entered manually ("manual-only type"). Applied in the CAO phase only.
  - `applyFilteringRules_` gains a `phase` param ('cao'/'run'); `getDealerFilterRules_` parses both keys (default `[]`); `getCaoVins` tallies rejection reasons dynamically; `getRulesEditorBootstrap` returns field/op metadata so the UI dropdowns derive from the engine's single source of truth. `RulesEditor.html` adds a Targeting Conditions table + "Exclude from CAO Auto-Fill" pills; `DealerSelector.html` CAO summary renders the new `cond:*` / `cao_excluded` reasons. Fully backward compatible — dealers without the keys are unchanged.
- **New dealer: Dean Team Brentwood** (`DEAN_TEAM_BRENTWOOD`) — 43rd dealer row in DEALERS. ORDERS col AQ (the ORDERS sheet was widened from 42 to 43 columns), used-only (`allowed_types: ["PO","CPO"]`, `require_stock`/`require_price` true), Pipedrive deal IDs, `scraper_location_name` = "Dean Team Brentwood", CAO order entry, VIN log tab created. Drive output + QR folders created under the global OUTPUT folder.
- **New field code `PRICE_TAGLINE`** — mapped at ORDERMATCH col 21 (U). ARRAYFORMULA renders a price-tier tagline from `PRICE_RAW` (col H): `≥ $15,000` → "as low as $300/mo"; `$10,000–$14,999` → "Below $15,000"; `< $10,000` → "Below $10,000"; non-numeric → blank. Added to `FIELD_TO_COL`.

### Changed
- **Removed the live `UNIQUE()` reference formulas from NORM_MAPS cols E+** (SF_DEALER_CONFIG). At 10k+ SCRAPERDATA rows, recalculating these volatile full-column formulas made programmatic access to SF_DEALER_CONFIG time out (~100s `Service Spreadsheets failed`), breaking every config-reading modal (Run Dealer, Rules Editor, Norm Manager) and `importScraperData`, while the browser UI stayed fine. Replaced with the on-demand `refreshNormReference()` writer (see Added). Docs/invariants updated accordingly.

### Fixed
- **`PRICE_TAGLINE` returned blank for every row.** `PRICE_RAW` (ORDERMATCH col H) is stored as text, so the original `ISNUMBER(H2:H)` guard was always FALSE. Reworked the formula to coerce with `VALUE()` inside `IFERROR` (`IFERROR(IF(VALUE(H2:H)>=15000,…),"")`). A plain text-vs-number comparison was avoided because Sheets sorts any text above any number, which would bucket every text price into the top tier. Fixed in the SF_UNIVERSAL_TEMPLATE ORDERMATCH U2 cell (no code change).
- **New CSV schema `SCP_TAGLINE`** — the SCP layout plus `PRICE_TAGLINE` appended as col_11. Used by Dean Team Brentwood; leaves the shared `SCP` schema untouched.

---

## [2026-06-09] — V2 pre-release backfill

Consolidated record of recent V2 development completed prior to changelog adoption. V2 is in final bug-hunt testing ahead of production launch.

### Added
- **Multi-user QR path system**: `USER_PROFILES` tab in SF_DEALER_CONFIG, "Running as:" dropdown in the Run Dealer modal, per-user QR path resolution via `PropertiesService`
- **Produced VINs list** in BILLING sheet column B below the order summary (`── PRODUCED VINS (N) ──` header format)
- **VIN Log status strip** in the Run Dealer modal (`DealerSelector.html`): shows latest order ID and `committed_at` timestamp with a "📋 Update VIN Log" button
- **Dealer Rules Editor modal** (`RulesEditor.html`): GUI editing of per-dealer `type_rules` and `filtering_rules` without touching raw JSON
- **Duplicate detail table** in BILLING sheet at column F row 2

### Changed
- **RUN_LOG expanded from 19 to 23 columns (A–W)**: lumped totals replaced with per-type columns — `total_po`, `total_cpo`, `total_cpo_el`, `po_dupes`, `cpo_dupes`, `cpo_el_dupes`
- **CSV output consolidated by schema**: `buildCSVSheet_` groups dealers by `csv_schema`, producing one sheet per unique schema (`CSV` for a single schema, `CSV_[SCHEMA_KEY]` when multiple)
- **BILLING sheet**: all vehicle types (New, PO, CPO, CPO-EL) now always present as fixed rows, including at zero count; duplicate detection checks both VIN and Stock

### Fixed
- BILLING sheet type column references corrected

### Removed
- `QR_LOCAL_BASE_PATH` global constant (superseded by per-user path resolution)

---

*Maintenance convention: every feature/fix commit should update the `[Unreleased]` section in the same commit. On production release, `[Unreleased]` entries roll into a new dated version section.*
