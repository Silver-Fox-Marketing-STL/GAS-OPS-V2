# SilverFox Marketing — Vehicle Graphic Production System V2
### Bridge System Documentation | Last Updated: June 2026

---

## System Status & Context

**Role:** Bridge System — Near Production (Final Bug-Hunt Testing)
**Platform:** Google Sheets + Google Apps Script (config-driven)
**As of:** June 2026
**Development branch:** `main` — `feature/health-monitoring` was merged June 2026; `main` is the single deployed branch

V2 is in final bug-hunt testing ahead of production launch. It replaces V1's ~42 per-dealer functions and ~42 separate template spreadsheets with a single universal script, a single universal template, and a config-driven architecture. V2 runs on Google Sheets — no server or Python dependency required.

**System Hierarchy:**
- **V1** — Legacy. Documented in `SilverFox_V1_Production_System.md`. Superseded by V2.
- **V2 (this document)** — Near-production bridge system in final bug-hunt testing.
- **V3** — Long-term Python-based replacement. Documented in `SilverFox_V3_Flask_System.md`. Development paused until V2 is fully stable.

---

## Changelog

| Date | Version | Change Summary |
|---|---|---|
| June 12, 2026 | 2.10 | **Post-run finalization — deferred deal IDs + abandonable runs.** Pipedrive deals are only created once an order is known to exist, so deal IDs can no longer be demanded before the run. (1) **Deal ID fields optional at run time for all dealers** (primary + split) — they only pre-fill the finalization cards; Run gates on user + dealer + VINs. `pasteVinsAndRun` required-throws removed. (2) **RUN_LOG/ORDER_STATS written only at finalization:** `runDealer` step 17 now returns self-contained **`pendingRuns`** entries (two for a split run with group units) instead of writing rows; new **`finalizeRun(dealerKey, entry, dealId)`** writes one row per finalized entry via the unchanged `writeRunLog_`. **Invariants:** no RUN_LOG row ever has a blank deal ID (`test` marks test runs); the VIN log is never written implicitly (explicit commit only). (3) **Finalization cards in the Run Dealer modal** — per-entry label/counts, deal ID input (pre-filled), Finalize/Abandon buttons, independent per card (e.g. abandon a 0-match primary, finalize the Sprinter half); "Add to VIN Log" enables once ≥1 card is finalized (0-VIN rows excluded from commit). Discard guards (confirm) on dealer change / new run / Cancel; dialog X-close not interceptable — an X-closed run is simply never logged. (4) **`abandonRun(dealerKey, outputDocId)`**: abandoning the last live card (nothing finalized) deletes the run's artifacts after a warning — output doc + dealer `<prefix>_QR_Code_N.PNG` files moved to **Drive trash** (30-day recovery); partial abandon of a split run keeps the shared doc/QRs. (5) **Fix:** pre-run deal-ID input listeners no longer clear post-run state on every keystroke. Behavior changes: editor-direct `runDealer` returns `pendingRuns` without logging; zero-match runs are abandonable with zero residue. |
| June 12, 2026 | 2.9 | **Billing split for shared-feed dual accounts (MBCC / Sprinter).** One run, one CSV — two billing sheets and two Pipedrive deals. (1) New optional **`billing_split`** key in `filtering_rules` (col W): `{group_name, deal_label, field, op, values}` — fields `model/make/trim/type` (ORDERMATCH vehicle keys), ops `contains`/`in` (case-insensitive, OR across values). Parsed by `getBillingSplit_` — **fail-safe**: absent/malformed → identical to today. MBCC: `field: "model", values: ["Sprinter", "Metris"]`. (2) **Billing writer refactor:** the five-section layout extracted into `renderBillingSheet_(sheet, …)`; `writeBillingSheet_(outputDoc, billingSplit)` partitions matched vehicles (`isInBillingGroup_`) and renders **BILLING** (primary account; also carries not-found identifiers) + **BILLING_<group>** (created via `insertSheet` — template untouched). Sheet sums = old single-sheet totals. `readBillingTotals_(outputDoc, sheetName?)`. (3) **Two RUN_LOG rows per split run** — each with its own deal ID, per-account totals, produced VINs; notes col U = `SPLIT:PRIMARY`/`SPLIT:<group>`; same output_doc_id/dealer_key. Zero group units → second row skipped (note `split: 0 <group> units`). ORDER_STATS gets one row per account. Commit/rollback per account works unchanged (single VIN log tab; group VINs carry the group deal ID). (4) **Run Dealer modal:** second required deal ID field shown only for split dealers (`getActiveDealersForUI` returns `splitDealLabel`); `pasteVinsAndRun`/`runDealer` gain trailing `splitDealId`; post-run "Add to VIN Log" commits both rows via new `commitRunRows` (skips already-committed — retry-safe). VIN Log Updater shows `SPLIT:*` badges (`getRunsForDealer` returns `note`). (5) **Fix:** Rules Editor `collectFilteringRules()` rebuilt the JSON from managed keys only and silently dropped passthrough keys (e.g. `billing_split`) on save — now stashes and re-merges unmanaged keys. Caveat: RUN_LOG row-count queries see a split run as two rows (filter on `notes`). Split applies even under "Bypass filtering rules" (billing-time classification, not a filter). |
| June 11, 2026 | 2.8 | **Multi-file import with Replace/Merge modes + VIN conflict resolution + modal layout rework.** (1) **`importScraperData` rewritten as a two-phase protocol** — `importScraperData(mappedData, mode, resolutions, fileNames, token)`. Phase 1 normalizes, dedupes by VIN, and (if same-VIN-different-data conflicts exist) returns them with **zero mutation**; phase 2 re-sends the payload + per-VIN resolutions (`'*'` bulk fallback), verified against an optimistic-concurrency token under a `LockService` lock. All mutations now sit below the conflict gate — fixes the latent hazard where the old importer cleared SCRAPERDATA *before* processing. New helpers: `dedupeScraperRows_` (incumbent vs newest challenger; identical rows dropped silently), `cellsEqual_`/`rowsEqual_`/`diffCols_` (tolerant compare — `getValues()` returns numbers for non-`@` cols), `groupRowsByLocation_` (rows grouped by Location on every write, preserving `getDealerScraperData_`'s contiguity invariant), `readExistingScraperRows_`, `computeImportToken_`, `applyConflictResolutions_`. Stats/health/dashboard computed on the **final** dataset in both modes. (2) **ScraperImport modal**: Replace/Merge mode selector, multi-file input with per-file header mapping + preview cards (all-or-nothing gate; VIN column required per file), UTF-8 BOM strip (fixes silent VIN-unmatch), mid-file header guard, conflict-resolution panel (side-by-side diff of differing fields, per-VIN radios, bulk buttons), mode-aware review with Import Summary badges. (3) **All five modals resized to a uniform 1400×900** (`MODAL_WIDTH`/`MODAL_HEIGHT`) **with layouts reworked for the wide canvas**: Run Dealer → two columns with full-height VIN workspace; VIN Log Updater → scrolling runs table + actions sidebar; Rules Editor → tabs replaced by side-by-side Type/Filtering panels; ScraperImport → two-column form + 2-up conflict grid; NormManager unchanged (already JS-sized). (4) **Fix:** "View Run Log" menu item did nothing (`openRunLog` activated a sheet via a separate `openById()` handle); now uses `getActiveSpreadsheet()`. (5) **Capacity & Log Growth Plan** section added (limits, growth math, ~25k-row triggers, `archiveOldLogs()` design; SF_VIN_LOGS never archived). |
| June 10, 2026 | 2.7 | **Targeting rules + Dean Team Brentwood + NORM_MAPS performance fix.** (1) **`feature/health-monitoring` merged to `main`** — `main` is now the single deployed branch. (2) **New dealer: `DEAN_TEAM_BRENTWOOD`** — 43rd dealer row, ORDERS col **AQ** (ORDERS widened 42→43 cols), used-only (`require_stock`/`require_price` true), Pipedrive, CAO. System now has **43 configured dealers, 29 active**. (3) **New field code `PRICE_TAGLINE`** at ORDERMATCH col **21 (U)** — price-tier tagline (`≥15000`→"as low as $300/mo", `10000–14999`→"Below $15,000", `<10000`→"Below $10,000"); formula coerces text price via `IFERROR(IF(VALUE(H2:H)>=…),"")` (PRICE_RAW is text). Plus new **`SCP_TAGLINE`** schema (SCP + PRICE_TAGLINE). (4) **Generalized targeting rules in `filtering_rules`** — two new optional keys: **`conditions`** (array of `{field, op, values, applies_to?}`; ops `in/not_in/contains/not_contains/gte/lte`; new `FILTER_FIELD_INDEX` map + `evaluateCondition_` helper, **fail-open** on misconfig; applied in CAO + run, Bypass overrides) and **`cao_exclude_types`** (manual-only types, CAO-phase only). `applyFilteringRules_` gains a `phase` param; `getCaoVins` tallies reasons dynamically; `getRulesEditorBootstrap` returns field/op metadata; RulesEditor adds a Targeting Conditions table + Exclude-from-CAO pills; DealerSelector renders `cond:*`/`cao_excluded` reasons. Pundmann Ford configured to exclude F-250. (5) **NORM_MAPS cols E+ live `UNIQUE()` formulas removed** — at 10k+ SCRAPERDATA rows they made programmatic access to SF_DEALER_CONFIG time out (~100s `Service Spreadsheets failed`), breaking config-reading modals + imports while the browser UI stayed fine. Replaced with on-demand **`refreshNormReference()`** (menu: **Refresh Norm/Field Reference**) writing static sorted distinct values (Type/Make/Model/Trim/Status/Body Style/Fuel Type) to cols E+. (6) **Trim cleanup** — full analysis + validated auto-cleanup design captured as a deferred section (see Trim Normalization & Cleanup); implementation pending. |
| June 10, 2026 | 2.6 | **Mazda of Columbia added + live-system documentation audit.** (1) **New dealer: `MAZDA_OF_COLUMBIA`** — 42nd dealer row in DEALERS. ORDERS col AP, used-only (`allowed_types: ["PO","CPO"]`), Pipedrive deal IDs, SCP schema, `scraper_location_name` = "Mazda of Columbia", VIN log tab created. System now has **42 configured dealers, 28 active**. (2) **`PRICE_PLUS_2000` is live** — active in the GLENDALE_COMBINED schema, mapped at ORDERMATCH col 20 (T), formula: `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(H2:H="*","*","$"&TEXT(H2:H+2000,"#,##0"))))`. The Glendale price+$2,000 requirement is complete. (3) **CSV_SCHEMAS documentation corrected to live state** — SCP/SCP_NEW/SC layouts updated; new `SCWSB` schema (Dave Sinclair windshield-only) documented. (4) **Doc audit corrections:** Serra Honda seasoning is PO 7 days (not New); Bommarito Cadillac and CDJR of Columbia each have a third `CPO` type rule; TRANSCRIPTION gained an optional DEALER_FILTER column; template LOG tab is 2 columns; ORDERMATCH col N template header is `TYPESTOCK` (the `QRSTOCK` field code maps to it); NORM_MAPS columns E+ documented as an intentional unique-values reference area; completed housekeeping items (VIN log tab rename, Sheet1 deletion) removed from pending lists. |
| June 2026 | 2.5 | **Health monitoring + live dashboard + billing/modal additions.** (1) **Import Health Monitoring (Code.gs Section 29):** New `IMPORT_STATS` tab in SF_SYSTEM_MASTER — `writeImportStats_()` appends one row per scraper location (13 cols A–M: `timestamp, scraper_location, total, new, po, cpo, cpo_el, other_types, onlot, offlot, other_status, no_price, no_stock`) after every `importScraperData()` call. `checkImportHealth_()` reads IMPORT_STATS history, computes per-location rolling averages, and returns issue objects (`{location, severity, message}`, severity `error`/`warning`/`info`). Hard errors regardless of history: total dropped to 0 for a location with prior data; `no_stock` or `no_price` > 20% of total (`MISSING_FIELD_THRESHOLD = 0.20`). Baseline warnings (require ≥ `MIN_IMPORTS_FOR_BASELINE = 5` prior rows): total/new/po dropped > 40% below rolling average (`DROP_THRESHOLD = 0.40`); a type appearing that was always 0 before. Locations under the baseline minimum return `info` "Building baseline" instead of warnings. Issues are rendered in a new health section of the ScraperImport review panel. (2) **ORDER_STATS side-write:** `writeRunLog_()` now also appends a clean analytics row to a new `ORDER_STATS` tab (12 cols A–L: `timestamp, dealer_key, dealer_name, order_id, vins_ordered, vins_matched, vins_produced, match_rate, new, po, cpo, cpo_el`). Both stats writes are isolated in try/catch — failure never breaks an import or run. (3) **DASHBOARD auto-refresh (Code.gs Section 30):** New `DASHBOARD` tab in SF_SYSTEM_MASTER, rewritten automatically by `refreshDashboard_()` at the end of every `importScraperData()` call. Contains an alphabetical per-location inventory snapshot (10 cols), a TOTALS row, then three formula-driven sections at dynamic row positions below the table: RUN LOG SUMMARY, MOST RECENT RUN, and RUNS BY DEALER (QUERY over RUN_LOG A:W grouped by dealer). All formulas IFERROR-wrapped. Two follow-up fixes landed same day: the Run Log sections are rewritten at their correct dynamic position as the location count changes, and all formatting is applied fully dynamically with no merged cells (stale rows beyond the current location count are cleared). Non-fatal — a dashboard failure never breaks an import. (4) **Produced VINs list in BILLING:** `writeBillingSheet_()` gains a fifth section — a `── PRODUCED VINS (N) ──` header in column B below the Total Duplicates row, followed by one VIN per row listing every matched/produced vehicle (from ORDERMATCH col E, VIN-log dupes included). Lands at B20 on a clean run. (5) **VIN Log status row in Run Dealer modal:** after a dealer is selected, a status strip appears below the dealer dropdown showing "Most recent order in log: {id}" (populated via `getLatestOrderId`) with a 📋 Update VIN Log button that opens the VIN Log Updater modal. (6) **`getRunsForDealer` updated to the 23-column RUN_LOG** — reads cols A–W and sources `produced_vins` from col V and `vin_log_status` from col W (was reading only 19 columns against the pre-expansion schema). |
| June 2026 | 2.4 | **Performance optimizations added.** (1) `getConfigSS_()` cache: a module-level `_configSS_` variable holds the SF_DEALER_CONFIG Spreadsheet object for the lifetime of one script execution. All 13 calls that previously called `SpreadsheetApp.openById(CONFIG_SHEET_ID)` independently now share a single network round trip per run. (2) `buildNormLookup_()` helper: pre-builds a lowercase-keyed hash map from each norm map array once at the start of `normalizeScraperData_()`. `normalizeCell_()` now accepts a lookup object (O(1)) instead of an array (O(n) linear scan per cell). On a 300-row import with 21 columns this eliminates thousands of redundant array scans. (3) `calcRecalcDelay_()` helper: replaces the fixed `Utilities.sleep(3000)` after ORDERMATCH formula write and `Utilities.sleep(2000)` after LINKBUILDER formula write with a row-count-scaled delay. Formula: `max(minMs, min(maxMs, rowCount * msPerRow))`. ORDERMATCH: 40ms/row, 1000ms floor, 3500ms ceiling — a 10-VIN order waits ~1s instead of 3s. LINKBUILDER: 30ms/row, 700ms floor, 2000ms ceiling. (4) `applyDataTransforms_()` read/write consolidated: model (col 6) and trim (col 7) are now read in a single `getRange(2, MODEL_COL, lastRow-1, 2)` call and written back in a single `setValues()` call, replacing two separate read calls and two separate write calls. |
| June 2026 | 2.3 | **Three targeted fixes.** (1) **`PRICE_FMT` formula updated:** Cell P2 of ORDERMATCH in SF_UNIVERSAL_TEMPLATE changed from `=ARRAYFORMULA(IF(ISBLANK(A2:A),"","$"&TEXT(H2:H,"#,##0")))` to `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",TEXT(H2:H,"#,##0")))`. Prices now output as `28,995` instead of `$28,995` — required because Adobe Illustrator variable libraries cannot have two variables mapped to the same field code even across different columns, and the dollar sign was causing type conflicts. (2) **`dedupFieldCodeHeaders_()` function added:** When a CSV schema references the same field code more than once (e.g. `YEARMODELSTOCK` appears twice in `GLENDALE_COMBINED` for a two-graphic template), the second occurrence is now written to the CSV header as `YEARMODELSTOCK2`, the third as `YEARMODELSTOCK3`, etc. This allows Illustrator to link each graphic's variables independently without field code collisions. Data rows are unaffected — both columns still pull from the same `FIELD_TO_COL` mapping. The schema in SF_DEALER_CONFIG does not need to change. (3) **GitHub/clasp sync restored:** The local repository was ahead of GitHub with undeployed changes. Full codebase reconciliation performed — Apps Script is now the canonical source of truth and GitHub is in sync. |
| May 2026 | 2.2 | **Multi-user QR base path implemented.** `QR_LOCAL_BASE_PATH` global constant removed. New `USER_PROFILES` tab added to `SF_DEALER_CONFIG` (columns: `user_key`, `display_name`, `qr_local_base_path`). "Running as:" dropdown added to top of Run Dealer modal — required field, gates the Run button alongside dealer + deal ID + VINs. Last-used selection persisted per Google account via `PropertiesService.getUserProperties()`. New functions in `Code.gs` Section 28: `getUserProfiles()`, `getUserProfilesForModal()` (single round-trip bootstrap returning profiles list + last-used key), `getQRBasePathForUser_()` (internal lookup), `getLastSelectedUser()`, `saveLastSelectedUser()`. `pasteVinsAndRun()` gains a `userKey` 6th parameter; path is resolved and validated before the run starts. `runDealer()` gains a `qrBasePath` 5th parameter threaded down to `writeQRPaths_()`, which now accepts `basePath` as a 4th parameter instead of using the global. `pasteVinsAndRun()` also passes the already-resolved `config` row to `runDealer()` as a 6th `preloadedConfig` parameter to avoid re-opening SF_DEALER_CONFIG. Adding a new user requires only a new row in `USER_PROFILES` — no code changes. |
| May 2026 | 2.1 | **Dealer Rules Editor modal added** (`RulesEditor.html`, 680×660px). GUI-based editor for `type_rules` (col O) and `filtering_rules` (col W) per dealer. Two-tab layout — Type Rules tab: card-based rule list with ▲▼ reorder, remove, and add-rule form (match dropdown, CSV schema dropdown loaded live from CSV_SCHEMAS tab, UTM input). Catch-all `*` rules auto-insert before any existing catch-all on add. Filtering Rules tab: toggle switches for `require_stock`/`require_price`, colored pill buttons for `allowed_types` and `exclude_status`, min/max price inputs, seasoning table with add/remove rows. Each tab has its own independent Save button. New server functions: `openRulesEditor`, `getRulesEditorBootstrap` (single round-trip: returns active dealers + live CSV schema keys), `getDealerRulesData`, `saveDealerTypeRules`, `saveDealerFilterRules`. Menu item added: **SilverFox V2 → Edit Dealer Rules...**. **Import Scraper Data converted from sidebar to modal** (`ScraperImport.html`, 620×580px). Same logic throughout — column mapping, CSV parser, `importScraperData` call, post-import review panel all unchanged. Layout updated to modal flex-column pattern (pinned header, scrollable body, fixed footer with status + Import button). Column preview redesigned from monospace scroll box into a two-column ✓ Matched / ✗ Missing grid. Row counts use `toLocaleString()`. |
| May 2026 | 2.0 | Major workflow overhaul. (1) **VIN log architecture redesigned:** SF_VIN_LOGS tabs gain a third column `committed_at` (timestamp). RUN_LOG gains two new columns: `produced_vins` (col V, CSV string of all VINs produced in the run) and `vin_log_status` (col W: blank = pending, `committed`, `rolled_back`). VIN log entries are no longer written automatically — the user commits a run explicitly via the new VIN Log Updater modal. (2) **Run Dealer converted from sidebar to modal** (580×600px). Added required Pipedrive Deal ID field. (3) **VIN Log Updater modal added.** (4) **CAO automation implemented.** (5) **filtering_rules system implemented.** (6) **Performance fix for large SCRAPERDATA.** (7) **Real-time progress bar.** (8) **Post-run action buttons.** (9) **Pipedrive Deal ID stored in RUN_LOG.** (10) **Produced VINs stored in RUN_LOG col V.** (11) **TRANSCRIPTION sheet converted to live ARRAYFORMULA.** (12) **ORDERS column mapping corrected.** (13) **`getDealerScraperData_` bug fix.** (14) **`require_price` filtering rule added.** |
| May 2026 | 1.4 | Multiple bug fixes from live testing. Stock number type bug fixed. `buildCSVSheet_` read range extended to 100 columns. TYPEVIN and YEARMODELSTOCK field codes added. ORDERMATCH QRSTOCK formula updated for CPO-EL/CPO/New/PO. NormManager converted from sidebar to modal. |
| May 2026 | 1.3 | Scraper data normalization system added. NORM_MAPS tab, Manage Normalization Maps modal, post-import review panel. |
| May 2026 | 1.2 | Order Types section added. |
| May 11, 2026 | 1.1 | Full audit of core spreadsheets. Multiple corrections to ORDERMATCH layout, LINKBUILDER, LOG, ORDERS column mapping, VIN log structure, RUN_LOG. |
| [date] | 1.0 | Initial V2 documentation. |

---

## Overview

This document describes the complete architecture and workflow of the SilverFox V2 vehicle graphic production system. The system produces vehicle window banner graphics (Shortcuts and Shortcut Packs) for automotive dealership clients by processing inventory data, generating QR codes, and producing CSV files for Adobe Illustrator variable data printing.

**Key improvement over V1:** The old system had ~42 near-identical per-dealer Apps Script functions and ~42 separate template spreadsheets. V2 replaces all of that with a single universal script, a single universal template, and a config-driven architecture where all dealer-specific settings live in one spreadsheet.

---

## System Architecture — Document Map

All V2 files live inside the **SilverFox V2 — Redesigned Production System** folder in Google Drive (inside Claude Sandbox).

### Core Spreadsheets

| File | ID | Purpose |
|---|---|---|
| `SF_SYSTEM_MASTER` | `1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes` | Central hub. Scraped inventory data, order inputs, run history. Script bound here. |
| `SF_DEALER_CONFIG` | `1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8` | Single source of truth for all dealer configuration. One row per dealer. Contains NORM_MAPS tab. |
| `SF_UNIVERSAL_TEMPLATE` | `14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc` | Single output template (replaces ~42 per-dealer templates). Copied at runtime per order. |
| `SF_VIN_LOGS` | `12Xf6dyZXWXp4JwbytGo6lRUShwuGeN0yS3zhbco4-Lk` | Master VIN log. One tab per dealer (named by `dealer_key`). Three-column structure. |

### Per-Dealer Output Folders

Located inside the main output folder (`1iRDDlqgQPn9R67AEIUJcF8JmyiOyn8DI`). One folder per dealer, each containing a `QR Codes/` subfolder and output docs.

### Local Workstation

QR code PNGs are downloaded from the dealer's Google Drive QR folder to the user's local machine. The download path is configured per user in the `USER_PROFILES` tab of `SF_DEALER_CONFIG` and selected at order time via the "Running as:" dropdown in the Run Dealer modal. Adobe Illustrator resolves `@QR` image variables from this path.

---

## SF_SYSTEM_MASTER — Tab Structure

### SCRAPERDATA
Master raw inventory feed. All scraped vehicle data across all dealers.

**Columns A–U (21 columns):**
`VIN | Stock | Type | Year | Make | Model | Trim | Ext Color | Status | Price | Body Style | Fuel Type | MSRP | Date In Stock | Street Address | Locality | Postal Code | Region | Country | Location | Vehicle URL`

- `Location` (col T, index 19) contains the dealer name — used as the filter key when pulling dealer-specific inventory
- Scraper timestamp lives in **W1:X1** — outside the 21-column data area to avoid column conflicts
- Timestamp backup mirrored in HELPERS A1:B1; restored by `onEdit` trigger if cleared
- All data is normalized at import time — see Scraper Data Normalization section
- Blank cells replaced with `*` for Illustrator compatibility
- Rows are **grouped by Location on every write** (first-seen order) — `getDealerScraperData_`'s two-pass read assumes each location's rows are contiguous, and merge-mode imports would otherwise scatter them
- VIN (col A) and Stock (col B) stored as plain text (`@` format) to prevent QUERY mixed-type issues

### ORDERS
One column per dealer (A through AQ, 43 dealers). VINs written here by the Run Dealer modal starting at row 2.

**Current column mapping (corrected May 2026):**
A: Joe Machens Nissan | B: CDJR of Columbia | C: Joe Machens Hyundai | D: Kia of Columbia | E: Auffenberg Hyundai | F: Honda of Frontenac | G: Porsche St. Louis | H: Pappas Toyota | I: Twin City Toyota | J: Bommarito Cadillac | K: Serra Honda | L: SoCo DCJR | M: Glendale CDJR | N: Dave Sinclair Lincoln | O: Suntrup Kia South | P: Rusty Drewing Chevrolet Buick GMC | Q: Pundmann Ford | R: BMW of Columbia | S: Tom Stehouwer Auto Sales | T: Rusty Drewing Cadillac | U: Joe Machens Toyota | V: Land Rover Rancho Mirage | W: Audi Rancho Mirage | X: indiGO Auto Group | Y: Jaguar Rancho Mirage | Z: Suntrup Hyundai South | AA: Volvo Cars West County | AB: Thoroughbred Ford | AC: Dave Sinclair Lincoln St. Peters | AD: Suntrup Buick GMC | AE: Columbia Honda | AF: Suntrup Ford Westport | AG: HW Kia of West County | AH: Frank Leta Honda | AI: BMW of West St. Louis | AJ: Suntrup Ford Kirkwood | AK: Mercedes-Benz of Creve Coeur | AL: AutoLoanPRO | AM: Nissan of Jefferson City | AN: Hyundai of Jefferson City | AO: Honda of Jefferson City | AP: Mazda of Columbia | AQ: Dean Team Brentwood

### TRANSCRIPTION
`VIN_TO_CHECK` (col A) and `STATUS` (col B). Col B contains a live ARRAYFORMULA that checks each VIN in col A against SCRAPERDATA col A in real time — paste a VIN and it instantly returns "Found" or "Not Found" without running any script. Used to verify VINs before creating an order. Cols D–E hold an optional `DEALER_FILTER` input — leave blank to check against all dealers.

**Formula in B2:**
```
=ARRAYFORMULA(IF(A2:A="","",IF(COUNTIF(SCRAPERDATA!A:A,A2:A),"Found","Not Found")))
```

### HELPERS
Backup of SCRAPERDATA timestamp at A1:B1. Restored by `onEdit` trigger if SCRAPERDATA W1:X1 is accidentally cleared.

### RUN_LOG
Appended automatically after every dealer run. **23 columns (A–W):**

`run_timestamp | dealer_key | dealer_name | order_id | total_ordered | total_matched | total_new | total_po | total_cpo | total_cpo_el | new_dupes | po_dupes | cpo_dupes | cpo_el_dupes | total_dupes | total_produced | qr_codes_generated | output_doc_id | run_duration_sec | errors | notes | produced_vins | vin_log_status`

- **`order_id` (col D)** — Pipedrive Deal ID, entered (or confirmed) on the post-run **finalization card**. **Never blank** — a row cannot be finalized without one; `test` marks test runs. *(v2.10: RUN_LOG rows are written only at finalization, never during the run; abandoned runs never appear here.)*
- **`total_new` through `total_cpo_el` (cols G–J)** — Per-type gross counts (New, PO, CPO, CPO-EL) read from the BILLING sheet after the run.
- **`new_dupes` through `cpo_el_dupes` (cols K–N)** — Per-type duplicate counts from the BILLING sheet.
- **`total_dupes` (col O)** — Sum of all duplicate counts.
- **`total_produced` (col P)** — Total matched vehicles (equals `total_matched`).
- **`produced_vins` (col V)** — CSV string of all VINs produced in this run, read from ORDERMATCH col E. Used by the VIN Log Updater commit flow.
- **`vin_log_status` (col W)** — Lifecycle status. Blank = pending, `committed` = VINs written to SF_VIN_LOGS, `rolled_back` = VINs were committed then removed.

> **Note:** The RUN_LOG was expanded from 19 → 23 columns in May 2026. The prior schema had lumped `total_used` (col H) and `used_dupes` (col J) as combined New+PO counts. The current schema has individual columns for all four vehicle types. Any historical rows written before the expansion will have blank values in the new columns. `produced_vins` moved from col R → col V and `vin_log_status` from col S → col W at the same time.

### IMPORT_STATS *(added June 2026)*
Per-location import history, appended by `writeImportStats_()` after every `importScraperData()` call — one row per scraper location per import. **13 columns (A–M):**

`timestamp | scraper_location | total | new | po | cpo | cpo_el | other_types | onlot | offlot | other_status | no_price | no_stock`

- Serves as the rolling baseline for `checkImportHealth_()` (see Code.gs Section 29)
- Write is wrapped in try/catch — a failure here never breaks an import
- If the sheet is missing, the write is skipped with a log entry (no error)

### ORDER_STATS *(added June 2026)*
Clean per-run analytics, appended by `writeRunLog_()` as a side-write alongside the main RUN_LOG row. **12 columns (A–L):**

`timestamp | dealer_key | dealer_name | order_id | vins_ordered | vins_matched | vins_produced | match_rate | new | po | cpo | cpo_el`

- `match_rate` = `vins_matched / vins_ordered` (0 when nothing ordered)
- Designed as a flat analytics table — no formulas, no formatting — so it ports directly to a Postgres table in V3
- Write is isolated in its own try/catch — failure is non-fatal and never breaks a run

### DASHBOARD *(added June 2026)*
Live operations dashboard, rewritten automatically by `refreshDashboard_()` at the end of every scraper import (Code.gs Section 30). Layout:

- **Row 1** — title banner; **Row 2** — last import timestamp; **Row 4** — INVENTORY SNAPSHOT header; **Row 5** — column headers
- **Rows 6+** — one row per scraper location, sorted alphabetically (10 columns: location, new, po, cpo, cpo_el, other, total, onlot, offlot, spare)
- **TOTALS row** immediately after the last location row
- Below the table, at **dynamic row positions** (recomputed from the current location count): **RUN LOG SUMMARY** (6 formula columns), **MOST RECENT RUN** (7 formula columns), and **RUNS BY DEALER** (9-column QUERY over `RUN_LOG!A:W` grouped by dealer, sorted by run count)
- All dashboard formulas are IFERROR-wrapped; stale rows beyond the current location count are cleared on every refresh
- All formatting is applied programmatically and dynamically — **no merged cells** (merged cells broke repositioning when the location count changed)
- Constants: `DASHBOARD_LOCATION_START_ROW = 6`, `DASHBOARD_MAX_LOCATIONS = 60`
- Non-fatal: a dashboard failure never breaks an import

---

## SF_DEALER_CONFIG — Tab Structure

### DEALERS Tab
One row per dealer (43 rows; 29 active), 23 columns (A–W).

#### Active Columns

| Col | Field | Description |
|---|---|---|
| A | `dealer_key` | Unique all-caps identifier (e.g. `AUFFENBERG_HYUNDAI`). Must match SF_VIN_LOGS tab name. |
| B | `dealer_name` | Human-readable name shown in modal dropdown. |
| C | `orders_col` | Column letter in SF_SYSTEM_MASTER ORDERS tab. |
| D | `qr_folder_id` | Drive folder ID where QR PNGs are saved. |
| E | `output_folder_id` | Per-dealer output folder override. Leave blank to use global constant. |
| F | `use_stock_not_vin` | TRUE if ORDERMATCH QUERY should match on Stock instead of VIN. **Currently FALSE for every dealer — VIN is always the primary key.** Planned replacement: a stock→VIN fallback (if an ordered identifier isn't found in the VIN column, look it up in the Stock column and substitute the corresponding VIN). Not yet implemented. |
| G | `linkbuilder_col` | Which LINKBUILDER column URLs are read from. `B` for most dealers, `C` for BMW of Columbia. |
| H | `utm_base_url_override` | Replaces vehicle URL entirely for QR link building. Used by Serra Honda (AutoFi format). |
| I | `data_transforms` | JSON find/replace rules applied to SCRAPERDATA after pasting. See Data Transforms section. |
| J | `scraper_location_name` | Exact value in SCRAPERDATA Location column (col T) used to filter rows for this dealer. |
| K | `qr_local_prefix` | Filename prefix for QR PNGs (e.g. `Pappas_Toyota` → `Pappas_Toyota_QR_Code_1.PNG`). |
| L | `active` | TRUE = dealer appears in modal dropdown and can be run. |
| M | `notes` | Internal notes. |
| N | `pipedrive_prefix` | `PIPEDRIVE` if dealer uses Pipedrive deal IDs as order numbers. |
| O | `type_rules` | **Primary output config.** JSON array of per-type rules. See Type Rules section. |
| W | `filtering_rules` | **CAO and run-time filter config.** JSON object. See Filtering Rules section. |

**Note on column indices (CFG object):** The CFG constant in Code.gs uses 0-based column indices. Key values: `KEY:0, NAME:1, ORDERS_COL:2, QR_FOLDER_ID:3, OUTPUT_FOLDER:4, USE_STOCK:5, LINKBUILDER_COL:6, UTM_BASE_URL:7, TRANSFORMS:8, SCRAPER_LOCATION:9, QR_PREFIX:10, ACTIVE:11, NOTES:12, PIPEDRIVE_PREFIX:13, TYPE_RULES:14, FILTER_RULES:22`

Columns P–V are deprecated/unused remnants from earlier iterations. Safe to ignore.

### USER_PROFILES Tab
Per-user configuration for the "Running as:" selector in the Run Dealer modal. **Edit directly in the sheet — one row per person who runs orders.**

| Col | Field | Description |
|---|---|---|
| A | `user_key` | Short unique identifier (e.g. `nick`). Must be lowercase, no spaces. |
| B | `display_name` | Name shown in the "Running as:" dropdown (e.g. `Nick`). |
| C | `qr_local_base_path` | Full local path to the QR folder on that user's machine. Windows: `C:\Users\Name\Documents\QRS\`. Mac: `/Users/name/Desktop/QR/`. Trailing separator is added automatically if omitted. |

**To add a new user:** append a row. No code changes or script redeployment required.

### NORM_MAPS Tab
Live source of truth for all scraper data normalization rules. **Managed via SilverFox V2 → Manage Normalization Maps — do not edit directly.**

**Structure:** Three columns — `map` | `input` | `output`

**Maps:** `global` (all columns), `type` (col C), `status` (col I), `price` (col J), `trim` (col G)

**Reference columns (E onward):** a **static, on-demand** reference area — one column each of sorted unique SCRAPERDATA values for `Type, Make, Model, Trim, Status, Body Style, Fuel Type` (header shows the distinct count), plus a "Refreshed: …" timestamp. Regenerated by `refreshNormReference()` (menu: **Refresh Norm/Field Reference**), which scans SCRAPERDATA once and writes plain values — zero ongoing recalc cost. Use it to spot new raw values needing normalization rules **and** to see the exact raw values available when authoring `filtering_rules` targeting conditions. The script only reads cols A–C; E+ is inert scratch space and never affects normalization. *(These were live `UNIQUE()` formulas until June 10, 2026 — at 10k+ SCRAPERDATA rows their recalculation made programmatic access to SF_DEALER_CONFIG time out, so they were replaced with this on-demand writer. Do not reintroduce volatile full-column formulas here.)*

**Normalized output values:**
- Type: `New`, `PO`, `CPO` (CPO-EL passes through unchanged — MBCC only)
- Status: `ONLOT`, `OFFLOT`

**Matching:** Case-insensitive exact match on full trimmed cell value. Rules evaluated top-to-bottom, first match wins. For Type map, more specific strings must appear above broader ones (`Certified Used` before `Certified`).

**Fallback:** Code.gs contains hardcoded `NORMALIZATION_MAPS` constant as read-only fallback if the tab is missing. Never the live source.

---

## Type Rules System

`type_rules` (col O in DEALERS) controls per-type output configuration. JSON array, rules evaluated in order, first match wins.

```json
[
  { "match": "TypeValue", "csv_schema": "SCHEMA_KEY", "utm": "utm_medium_value" },
  { "match": "*",         "csv_schema": "SCHEMA_KEY", "utm": "utm_medium_value" }
]
```

- `match` — case-insensitive substring search against normalized Type column. `"*"` is catch-all.
- `csv_schema` — references a row in CSV_SCHEMAS tab.
- `utm` — `utm_medium` value appended to VDP URLs for QR generation.

**Critical:** Match values must use post-normalization type strings: `New`, `PO`, `CPO`, `CPO-EL`. Never use raw scraper values like `Used`, `Certified`, etc.

### Multi-rule dealer configurations

**Auffenberg Hyundai:** `[{"match":"PO","csv_schema":"SCP","utm":"VDP_ShortCut"}]`

**Bommarito Cadillac:** `[{"match":"New","csv_schema":"SCP_NEW","utm":"VDP_ShortCut_New"},{"match":"PO","csv_schema":"SCP","utm":"VDP_ShortCut_Used"},{"match":"CPO","csv_schema":"SCP","utm":"VDP_ShortCut_Used"}]`

**CDJR of Columbia:** `[{"match":"New","csv_schema":"SC","utm":"VDP_ShortCut"},{"match":"PO","csv_schema":"SCP","utm":"VDP_ShortCut"},{"match":"CPO","csv_schema":"SCP","utm":"VDP_ShortCut"}]`

**Mercedes-Benz of Creve Coeur:** `[{"match":"CPO-EL","csv_schema":"SC","utm":"VDP_ShortCut"},{"match":"CPO","csv_schema":"SC","utm":"VDP_ShortCut"},{"match":"PO","csv_schema":"SCP","utm":"VDP_ShortCut"}]` *(CPO-EL must precede CPO — "CPO" is a substring of "CPO-EL")*

**Serra Honda:** `[{"match":"New","csv_schema":"SC","utm":"VDP_ShortCut"},{"match":"PO","csv_schema":"SCP","utm":"VDP_ShortCut"}]`

**CSV output naming:** Single-rule → sheet named `CSV`. Multi-rule → one sheet per rule named `CSV_NEW`, `CSV_PO`, `CSV_CPO`, etc.

---

## Filtering Rules System

`filtering_rules` (col W in DEALERS) controls which vehicles are included in CAO pre-fills and all order runs. JSON object stored per dealer.

**Full schema:**
```json
{
  "allowed_types":  ["New", "PO", "CPO"],   // omit = all types pass
  "exclude_status": ["OFFLOT"],             // omit = no status exclusions
  "require_stock":  true,                   // omit = stock not required
  "require_price":  false,                  // omit = price not required
  "min_price":      0,                      // omit = no floor
  "max_price":      999999,                 // omit = no ceiling
  "seasoning": [
    { "type": "New", "days": 7 },
    { "type": "PO",  "days": 0 }
  ]
}
```

**Rules are dealer-wide except `seasoning`, which is per type.** All fields are optional — omitting a key applies no restriction for that dimension.

**`require_stock`:** Rejects vehicles where the stock column value is blank or `*`.

**`require_price`:** Rejects vehicles where price is blank, `*`, `callforprice`, or non-positive. Currently enabled only for Glendale CDJR.

**`seasoning`:** Filters on SCRAPERDATA col N (Date In Stock). A vehicle passes if `today - dateInStock >= required days`. Vehicles with unparseable dates pass through.

**Rejection reasons** (shown in CAO summary and logged during runs): `no_stock`, `no_price`, `type`, `status`, `price_low`, `price_high`, `seasoning`, plus `cao_excluded` and one `cond:<field>` per targeting condition (e.g. `cond:make`). The CAO summary renders these dynamically.

### Targeting conditions & CAO exclusions *(added June 2026)*

Two optional keys extend the flat rules above with granular, field-based targeting — fully configurable in the **Edit Dealer Rules** modal (Filtering tab), no code per dealer.

**`conditions`** — an array of generic field criteria, evaluated after all the flat rules (first rejection still wins). Each:
```json
{ "field": "make", "op": "contains", "values": ["Cadillac"], "applies_to": ["New"] }
```
- `field` — one of `type, year, make, model, trim, ext_color, status, price, body_style, fuel_type, msrp` (mapped to SCRAPERDATA indices by `FILTER_FIELD_INDEX` in Code.gs — the single source of truth, surfaced to the UI via `getRulesEditorBootstrap`).
- `op` — `in`, `not_in`, `contains`, `not_contains` (string, case-insensitive), or `gte`, `lte` (numeric; price-safe — strips `$`/`,` before compare, since prices are stored as text).
- `values` — array. `contains`/`not_contains` match **any** value (OR).
- `applies_to` — optional array of types; the condition is only evaluated for those types (others skip = pass). Omit = all types.
- **Fail-open:** unknown field/op, empty values, or an unparseable number → the condition passes (a config typo can never silently empty a dealer's inventory).
- **Applied in both phases** (CAO + run time). The "Bypass filtering rules" checkbox is the per-run override.

**`cao_exclude_types`** — array of types removed from CAO auto-fill **only**. They still print when entered manually (no bypass needed). This is the "manual-only type" mechanism. Keep the type in `allowed_types` so manual runs aren't blocked by the legacy gate.

**Example dealers:**
- *Bommarito Cadillac* — all used; New only if Cadillac: `{"conditions":[{"field":"make","op":"contains","values":["Cadillac"],"applies_to":["New"]}]}`
- *Pundmann Ford* — exclude commercial + F-250: `{"conditions":[{"field":"model","op":"not_contains","values":["F-250","F250"]},{"field":"body_style","op":"not_contains","values":["commercial"]}]}`
- *Dave Sinclair St. Peters* — CAO only used ≥ $35k, New manual-only: `{"cao_exclude_types":["New"],"conditions":[{"field":"price","op":"gte","values":[35000],"applies_to":["PO","CPO","CPO-EL"]}]}`

### Billing split *(added June 2026 — branch `feature/billing-split`, pending deploy)*

**`billing_split`** — optional object for dealers whose single scraper feed serves **two billing accounts** (MBCC cars vs Sprinter/Metris vans). One run, one CSV (one Illustrator setup); billing separated per account.

```json
"billing_split": {
  "group_name": "SPRINTER",
  "deal_label": "Sprinter Deal ID",
  "field": "model",
  "op": "contains",
  "values": ["Sprinter", "Metris"]
}
```

- `field` — `model`, `make`, `trim`, or `type`. These are **ORDERMATCH vehicle keys** (the split classifies matched vehicles at billing time), deliberately *not* `FILTER_FIELD_INDEX`.
- `op` — `contains` or `in`; case-insensitive; matches **any** value (OR).
- `deal_label` — label for the optional second deal ID field in the Run Dealer modal and the group's finalization card (defaults to `<group_name> Deal ID`).
- **Fail-safe:** absent or malformed → the run behaves exactly as a normal single-billing run (`getBillingSplit_` returns null).
- **Not a filter.** The split is billing-time classification only — it never removes vehicles, and it applies even when "Bypass filtering rules" is checked.

**Effects when active and the run contains group vehicles:** the output doc gets **BILLING** (primary account — group units excluded; carries the not-found list) plus **BILLING_<group_name>** (created on demand; identical five-section layout); the post-run panel shows **two finalization cards** (one per account, each requiring its own deal ID to finalize — see v2.10), producing up to **two RUN_LOG rows** (notes col U = `SPLIT:PRIMARY` / `SPLIT:<group>`; same output_doc_id) plus matching ORDER_STATS rows. Either card can instead be abandoned. Commit/rollback in the VIN Log Updater works per account against the dealer's **single** VIN log tab — group VINs are logged under the group's deal ID; duplicate detection is identifier-based and unaffected. Zero group units in a run → BILLING_<group> is still written (zeroed) but there is no group card (note: `split: 0 <group> units` on the primary entry). Sheet-side QUERYs that count RUN_LOG rows see a fully-finalized split run as two rows — filter on `notes` if exact run counts matter.

### Source split — dual-site dealers *(added June 2026 — branch `feature/frank-leta-dual-site`, pending deploy)*

**`source_split`** — optional object for a dealer whose single Location spans **two websites** (Frank Leta's main site + the AutoLoanPro subprime site, which is a superset). One run, **one billing sheet, one Pipedrive deal**, but **two CSV outputs** split by URL domain. The inverse of `billing_split` (which splits billing and keeps one CSV).

```json
"source_split": { "group_name": "AUTOLOANPRO", "url_contains": "autoloanpro" }
```

- `url_contains` — substring matched (case-insensitive) against the Vehicle URL to identify the **secondary-site** listing.
- `group_name` — suffix for the secondary CSV sheet (`CSV` → `CSV_AUTOLOANPRO`) and the dedup scope label.
- **Fail-safe:** absent/malformed → `getSourceSplit_` returns null and the run is a normal single-CSV run.

**Two effects:**
1. **Run (`buildCSVSheet_`):** matched cars whose URL contains the marker go to **`CSV_<group>`**; the rest to the normal **`CSV`** (per type rule; same schema/UTM). Both sheets always written (secondary may be empty). QR per-row already points at each car's own URL. **The deal and RUN_LOG are unchanged — one of each** (no `billing_split` here). The single **BILLING** sheet gains a **"BY SOURCE (QTY PER SKU)"** section: per source (`Main Site`, `<group>`) × type counts plus per-source totals (`renderBillingSheet_` gains a `sourceSplit` param), so the correct quantity per SKU can be entered in the one Pipedrive deal. Labels are source-prefixed (`Main Site — PO`) so they never collide with the trimmed type labels `readBillingTotals_` reads for the RUN_LOG.
2. **Import (`dedupeScraperRows_`, via `getSourceSplitLocations_`):** the "main first, then secondary" waterfall is resolved at import — when the same VIN appears with a main-site URL and a marker URL **within a Location that has `source_split` configured**, the **main** listing is kept automatically (no conflict prompt), regardless of import order or whether the feeds arrive together or as separate re-run merges. **Scoped strictly by Location**, so no other dealer's dedup is touched. Net SCRAPERDATA: one row per VIN — main URL for cars on both sites, AutoLoanPro URL only for subprime-only cars.

**Activation:** add `source_split` to Frank Leta's `filtering_rules` (col W) alongside the existing keys. Inert until present (and until marker URLs exist in the data — e.g. a manually-imported AutoLoanPro feed).

### Where filtering is applied

**At CAO pre-fill time** (`getCaoVins`, phase `cao`): applied to raw SCRAPERDATA rows, then VIN log dedup. Both `conditions` and `cao_exclude_types` are active.

**At run time, step 8.5** (`runDealer`, phase `run`): applied to the ordered VINs array before the ORDERMATCH QUERY is written. `conditions` are active; `cao_exclude_types` is **not** (so manual-only types print). If all VINs are filtered, the run aborts with a descriptive error.

**Bypass:** The Run Dealer modal has a "Bypass filtering rules" checkbox. When enabled, step 8.5 is skipped entirely — the per-run override for manual orders.

### Current filtering_rules by dealer category

Nearly all active dealers have `require_stock: true` and `exclude_status: ["OFFLOT"]` as baseline rules. Exceptions: SoCo DCJR has no `allowed_types` restriction (all types pass); BMW of West St. Louis omits `exclude_status`.

| Category | `allowed_types` | `require_price` |
|---|---|---|
| Used-only dealers (incl. Mazda of Columbia) | `["PO","CPO"]` | false |
| New-only dealers | `["New"]` | false |
| New + Used dealers | `["New","PO","CPO"]` | false |
| Mercedes-Benz of Creve Coeur | `["PO","CPO","CPO-EL"]` | false |
| Glendale CDJR | `["PO","CPO"]` | **true** |
| Serra Honda | `["New","PO","CPO"]` + **7-day PO seasoning** (`New: 0, PO: 7, CPO: 0`) | false |
| Inactive legacy dealers | minimal `{"require_price":false}` (no restrictions) | — |

---

## CSV Schemas

Defined in the `CSV_SCHEMAS` tab of SF_DEALER_CONFIG.

| Schema Key | Description | Columns |
|---|---|---|
| `SCP` | Shortcut Pack — full 10-col output (most dealers) | `NEWYEARMAKE, MODEL, TRIM, YEARMODELSTOCK, TYPEVIN, @QR, YEARMODELSTOCK, TYPEVIN, @QR2, MISC` |
| `SCP_NEW` | Shortcut Pack for New vehicles — currently identical to SCP (consolidation candidate) | `NEWYEARMAKE, MODEL, TRIM, YEARMODELSTOCK, TYPEVIN, @QR, YEARMODELSTOCK, TYPEVIN, @QR2, MISC` |
| `SC` | Shortcut only — minimal 3-col output | `YEARMODELSTOCK, TYPEVIN, @QR` |
| `SCWSB` | Shortcut Windshield without the Shortcut (Dave Sinclair Lincoln) | `NEWYEARMAKE, MODEL, TRIM, YEARMODELSTOCK, TYPEVIN, @QR, MISC` |
| `GLENDALE_COMBINED` | Glendale CDJR — YEARMODEL + TRIM + price+$2,000, two graphics | `YEARMODEL, TRIM, PRICE_PLUS_2000, YEARMODELSTOCK, TYPEVIN, @QR, YEARMODELSTOCK, TYPEVIN, @QR2, MISC` |
| `SCP_TAGLINE` | Dean Team Brentwood — SCP layout + price-tier tagline appended | `NEWYEARMAKE, MODEL, TRIM, YEARMODELSTOCK, TYPEVIN, @QR, YEARMODELSTOCK, TYPEVIN, @QR2, MISC, PRICE_TAGLINE` |

Column headers in the output CSV must match Illustrator template variable names exactly. `@`-prefixed codes are image path variables.

**Duplicate field codes in schemas:** When a schema references the same field code more than once (e.g. `YEARMODELSTOCK` twice in `GLENDALE_COMBINED` for a two-graphic template), the CSV header row automatically suffixes duplicates: first occurrence is unchanged, second becomes `YEARMODELSTOCK2`, third becomes `YEARMODELSTOCK3`, etc. This is handled by `dedupFieldCodeHeaders_()` at write time — the schema itself does not need to use the suffixed names.

---

## Field Codes & FIELD_TO_COL Mapping

The `FIELD_TO_COL` constant in Code.gs maps field code names to 1-based ORDERMATCH column numbers. **The script never reads ORDERMATCH column headers at runtime.** The FIELD_CODES tab in SF_DEALER_CONFIG is documentation only.

### Current FIELD_TO_COL mapping

| Field Code | ORDERMATCH Col | Value Produced |
|---|---|---|
| `YEAR` | 1 | Year only |
| `MAKE` | 2 | Make, uppercased |
| `MODEL` | 3 | Model, uppercased |
| `TRIM` | 4 | Trim, uppercased |
| `VIN` | 5 | Full VIN |
| `STOCK` | 6 | Stock number |
| `TYPE` | 7 | Normalized type |
| `PRICE_RAW` | 8 | Raw numeric price |
| `@QR` | 10 | Local QR PNG file path |
| `@QR2` | 10 | Same as @QR (two-frame templates) |
| `YEARMAKE` | 11 | `"2024 HONDA"` |
| `YEARMODEL` / `QRYEARMODEL` | 12 | `"2024 CR-V"` |
| `MAKE_MODEL_COMBINED` | 13 | `"HONDA CR-V"` |
| `QRSTOCK` | 14 | `"USED - 262617A"`, `"CPO - 261070L"`, etc. |
| `MISC` | 15 | `"2024 CR-V - 1HGCV... - 262617A"` |
| `PRICE_FMT` | 16 | `"28,995"` (no dollar sign — plain `#,##0` format) |
| `NEWYEARMAKE` | 17 | `"NEW 2024 HONDA"` for new, `"2024 HONDA"` for others |
| `TYPEVIN` | 18 | `"USED - 7FARW2H90NE035008"` |
| `YEARMODELSTOCK` | 19 | `"2024 CR-V - 262617A"` |
| `PRICE_PLUS_2000` | 20 | `"$30,995"` — price + $2,000 (**live**; used by GLENDALE_COMBINED) |
| `PRICE_TAGLINE` | 21 | Price-tier tagline (**live**; used by SCP_TAGLINE): `≥15000` → `"as low as $300/mo"`, `10000–14999` → `"Below $15,000"`, `<10000` → `"Below $10,000"`, non-numeric → blank |

`buildCSVSheet_` reads 100 columns from ORDERMATCH — new field codes can be added through column CV without changing the read range.

---

## SF_UNIVERSAL_TEMPLATE — Tab Structure

Copied at runtime for each dealer order. The copy becomes the output document.

### ORDERMATCH — Full Column Layout

| Col | Index | Header | Source |
|---|---|---|---|
| A | 1 | YEAR | QUERY spill |
| B | 2 | MAKE | QUERY spill |
| C | 3 | MODEL | QUERY spill |
| D | 4 | TRIM | QUERY spill |
| E | 5 | VIN | QUERY spill |
| F | 6 | STOCK | QUERY spill |
| G | 7 | TYPE | QUERY spill — normalized: `New`, `PO`, `CPO` |
| H | 8 | PRICE_RAW | QUERY spill |
| I | 9 | URL | QUERY spill |
| J | 10 | QR_PATH | Script-written after QR generation |
| K | 11 | YEARMAKE | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",UPPER(A2:A&" "&B2:B)))` |
| L | 12 | YEARMODEL | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",UPPER(A2:A&" "&C2:C)))` |
| M | 13 | MAKE_MODEL_COMBINED | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",UPPER(B2:B&" "&C2:C)))` |
| N | 14 | TYPESTOCK *(the `QRSTOCK` field code maps here)* | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(ISNUMBER(SEARCH("CPO-EL",G2:G)),"CPO-EL - ",IF(ISNUMBER(SEARCH("CPO",G2:G)),"CPO - ",IF(ISNUMBER(SEARCH("New",G2:G)),"NEW - ","USED - ")))&UPPER(F2:F)))` |
| O | 15 | MISC | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",A2:A&" "&C2:C&" - "&E2:E&" - "&F2:F))` |
| P | 16 | PRICE_FMT | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",TEXT(H2:H,"#,##0")))` *(no dollar sign — updated June 2026)* |
| Q | 17 | NEWYEARMAKE | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(ISNUMBER(SEARCH("New",G2:G)),"NEW "&UPPER(A2:A&" "&B2:B),UPPER(A2:A&" "&B2:B))))` |
| R | 18 | TYPEVIN | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(ISNUMBER(SEARCH("CPO-EL",G2:G)),"CPO-EL - ",IF(ISNUMBER(SEARCH("CPO",G2:G)),"CPO - ",IF(ISNUMBER(SEARCH("New",G2:G)),"NEW - ","USED - ")))&UPPER(E2:E)))` |
| S | 19 | YEARMODELSTOCK | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",UPPER(A2:A&" "&C2:C&" - "&F2:F)))` |
| T | 20 | PRICE_PLUS_2000 | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(H2:H="*","*","$"&TEXT(H2:H+2000,"#,##0"))))` |
| U | 21 | PRICE_TAGLINE | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IFERROR(IF(VALUE(H2:H)>=15000,"as low as $300/mo",IF(VALUE(H2:H)>=10000,"Below $15,000","Below $10,000")),"")))` *(PRICE_RAW is stored as text — `VALUE()` coerces before comparison; `IFERROR` blanks non-numeric prices)* |

**Cols A–I are the QUERY spill zone.** Nothing should be written there in the template. Col J is the first script-written column. Cols K onward are ARRAYFORMULAs that auto-expand with QUERY output.

### Other Tabs

**ORDER** — VINs/stock numbers for current order. Col A from row 2. Header: `STOCK_OR_VIN`.

**SCRAPERDATA** — Full dealer inventory (21 cols A–U). Written by script.

**LINKBUILDER** — Col A: source URL, Col B: UTM-tagged URL, Col C: alt URL (BMW of Columbia).

**CSV / CSV_NEW / CSV_PO / etc.** — Final export sheets built from ORDERMATCH using `type_rules` and schema. Headers are auto-suffixed when a schema contains duplicate field codes (`YEARMODELSTOCK`, `YEARMODELSTOCK2`, etc.).

**LOG** — Dealer's VIN log history copied from SF_VIN_LOGS at run time. **Two columns only**: `ORDER_ID | VIN_OR_STOCK` — `copyVINLogToOutput_` copies cols A–B; `committed_at` stays in SF_VIN_LOGS.

**BILLING** — Written by script after each run. Five sections: Order Summary, By Type (gross), Duplicates by Type, Duplicate Detail table, and Produced VINs list. The Produced VINs section is a `── PRODUCED VINS (N) ──` header in column B below the Total Duplicates row, followed by one VIN per row — every matched/produced vehicle from ORDERMATCH col E, VIN-log dupes included (header lands at B20 on a clean run). All four canonical vehicle types (New, PO, CPO, CPO-EL) always appear as fixed rows even when count is 0 — layout is consistent across all runs. Duplicate detail table is written to the right starting at column F, row 1 (not below the summary) to keep the summary block fixed-width.

**_CONFIG_CACHE** — Written by script at runtime. Records dealer config used for debugging.

---

## SF_VIN_LOGS — Structure

One tab per dealer, named exactly by `dealer_key`. **Three-column structure:**

| Col | Header | Description |
|---|---|---|
| A | `ORDER_ID` | Pipedrive Deal ID |
| B | `VIN` | Vehicle VIN (or stock number for stock-based dealers) |
| C | `committed_at` | Timestamp written at commit time (format: `yyyy-MM-dd HH:mm:ss`) |

The `committed_at` column enables rollback by providing an unambiguous key (deal ID + committed timestamp) that survives multiple commit/rollback cycles.

### VIN Log Lifecycle

VIN log entries are **never written automatically — not by a run, and not by finalizing one.** The workflow is:

1. Run completes → results shown as finalization card(s) in the modal (nothing logged yet)
2. User reviews results, creates the Pipedrive deal(s), and **finalizes** each card with its deal ID → RUN_LOG row written with produced VINs in col V, status = pending (or **abandons** the card — never logged)
3. Commit either via **✓ Add to VIN Log** in the modal (commits all finalized entries), or later via **SilverFox V2 → Update VIN Log...**
4. In the Updater: select dealer → see pending/committed runs → **Commit to VIN Log** → entries appended with `committed_at` timestamp
5. If a run was committed in error → click **Rollback** → entries removed by deal ID + `committed_at` key

### Legacy Tabs
Prefixed `_`: `_WEBER`, `_BOMM_WCPO`, `_MINI_ST_LOUIS`, `_SPIRIT_LEXUS` — not referenced by script. (`JOE_MACHENS_CDJR` → `CDJR_OF_COLUMBIA` rename and blank `Sheet1` deletion: both complete.)

---

## Order Types

The system is designed for four order types. Currently the Run Dealer modal accepts a plain VIN list (manually entered or CAO pre-filled). The two-stream order types (Maintenance, Hybrid) are designed and documented but not yet implemented in the modal.

| Order Type | CAO Stream | Manual Stream | VIN Log on Manual | Type Override |
|---|---|---|---|---|
| **CAO** | ✓ Normal | — | — | — |
| **LIST** | — | ✓ All valid VINs | Flag only | Optional |
| **Maintenance** | ✓ Normal | ✓ All valid VINs | Flag only | — |
| **Hybrid** | ✓ Normal | ✓ All valid VINs | Flag only | Optional |

**Core principle:** VIN log is never a gate for manually entered VINs. A manually entered VIN always means a graphic is needed. VIN log is checked on manual streams only to flag duplicates in billing.

---

## Scraper Data Normalization

Runs automatically in `importScraperData()` before writing to SCRAPERDATA. Also runs in `pasteScraperData_()` when copying to the output doc.

**Three passes in order:**
1. Global pass — all columns (`&amp;` → `&`, `undefined` → `*`, `N/A` → `*`)
2. Column-specific pass — Type (col C), Trim (col G), Status (col I), Price (col J)
3. Blank fill — empty cells → `*`

**Performance note:** `normalizeScraperData_()` builds a hash map (`buildNormLookup_()`) from each norm map array once before iterating rows. Lookups are O(1) per cell rather than O(n) linear scans.

**Managing rules:** Use **SilverFox V2 → Manage Normalization Maps** modal. Changes write directly to NORM_MAPS sheet — no save step.

**Post-import review panel:** Shows total count, type breakdown (unexpected values flagged red), status breakdown, Location × Type table.

---

## Trim Normalization & Cleanup — Analysis & Deferred Design *(June 2026)*

**Status:** Analysis complete; **implementation deferred** by request. This section is the complete spec to implement later — no further investigation needed.

### The problem
Vehicle **Trim** strings from the scraper are often too long or carry extraneous labels (bed lengths, wheelbase measurements, body-style words, encoding artifacts), so they overflow the Illustrator print template and require manual editing before a graphic can be produced. Goal: auto-clean trims to minimize that manual work.

### How trim is processed today
- Normalization is **exact full-string match only**. `normalizeScraperData_()` applies a global exact-match lookup then a per-column exact-match lookup; `normalizeCell_(value, lookup)` returns the mapped value or the original. Trim is **column index 6** (`NORM_COL.TRIM`). There is **no substring/regex/token-stripping** in this path.
- Cleaning a trim today therefore requires **one hand-authored exact rule per raw string** in the NORM_MAPS `trim` map (e.g. `"4WD Crew Cab 143.5\" SLE" → "Crew Cab SLE"`). ~120 such rules exist.
- There **are 1,319 distinct raw trim values** across active inventory — so exact rules do not scale. Snapshot the current distinct values anytime via **Refresh Norm/Field Reference** (`refreshNormReference()`) → NORM_MAPS **col H**.
- A separate, **per-dealer** literal substring `remove` exists in `applyDataTransforms_()` (Glendale only), but it runs on the *output doc* (1-based `TRIM_COL = 7`), single-occurrence `String.replace(s,'')`, and is not global.
- Downstream: trim → ORDERMATCH col D (`TRIM`, uppercased) → CSV schemas (e.g. SCP col_3). Blank trims become `*`.

### Analysis — what can be removed

**Safe to auto-strip globally** (structural junk, universally unwanted on a graphic):

| Category | Examples in the data | Notes |
|---|---|---|
| Encoding artifacts | `&quot;`→`"`, `%2F`→`/`, mojibake `â` | Decode **first**, before measurement matching. Do *not* blanket-strip a bare `â` (locale-fragile) — target the specific mojibake sequences. |
| Bed / box length | `5.5' Box`, `5'7" Box`, `6'4 BOX`, `8' Box`, `5' Bed`, `64 Box`, `57 Box` | Very common on trucks. |
| Wheelbase / cab / inch dims | `143.5"`, `147"`, `128.3"`, `193" WB 108" CA`, `60' CA`, `159' WB` | |
| National-spec marker | `(Natl)` | |
| Brand/legal symbols | `®`, `™` (`Platinum®`, `C 300 4MATIC®`, `PRO-4X®`) | |
| Body-style words (narrow set) | `4dr`, `2dr`, `5dr`, `Sdn`, `Sedan`, `Wgn` | Anchor with `\b`. **Drop `HB`** from the auto set (high false-positive risk). |
| BMW noise | `Sports Activity Vehicle` / `Sports Activity` | |

**Context-dependent — do NOT blanket-strip** (often the meaningful differentiator; leave to exact-map rules or keep):

| Category | Examples | Why keep |
|---|---|---|
| Drivetrain | `AWD`, `FWD`, `4WD`, `4x4`, `quattro`, `xDrive`, `4MOTION` | Meaningful; existing rules keep these. |
| Engine specs | `3.6L V6`, `2.5 Turbo`, `EcoBoost`, `5.7L V8` | Sometimes the trim essence (Mazda "2.5 Turbo", Audi "45 TFSI"). |
| Spelled door counts | `4-DOOR RUBICON`, `2-DOOR SPORT` | Door count is part of Jeep Wrangler / Bronco trims — do **not** remove the spelled `4-DOOR`/`2-DOOR`. |
| Coupe/convertible body words | `Coupe`, `Convertible`, `Cabriolet`, `Fastback`, `Hardtop` | Meaningful (e.g. Porsche `Carrera GTS Cabriolet`, BMW `430i Convertible`). |
| Package/option codes | `w/1LT`, `w/2LT`, `w/1FL`, `(2FL)`, `w/Knapheide…` | Mixed; per-string. |
| Abbreviations | `Premium`→`Prem`, `Package`→`Pkg`, `w/Technology`→`w/Tech` | Replacement, not removal; per-string. |
| Truck descriptors | `GVWR`, `Med Rf`/`Roof`, `CARGO VAN`, `9070 GVWR` | Per-string exact rules. |
| Pure-noise singletons | `+`, `.`, `WB`, `2` | Map to `*`. But `S`/`L`/`M`/`T` are real trims — never auto-blank. |

### Approach options (decision pending)
- **A — Full auto-cleanup now:** implement the complete regex cleanup pass (all safe categories) + exact-map adds, behind a feature flag + dry-run. Most reduction; one round.
- **B — Phased (recommended):** ship the zero-false-positive fixes first (decode `&quot;`/`%2F`, strip `(Natl)`, `®`/`™`), validate via dry-run, then enable the measurement/bed-length/body-word stripping in a second round. Safest path to the same end state.
- **C — Exact-match rules only:** no code change; just keep adding raw→clean rules to the `trim` map. Zero behavior surprise, but does not scale to 1,300+ values.

### Recommended design (validated; for when implemented)
Add a **global `cleanTrim_(str)` regex pass** applied to the trim column inside `normalizeScraperData_()`, **after** the exact-match `trim` map (so existing exact rules fire first on the raw full string; `cleanTrim_` only cleans the unmapped long tail and is harmless/idempotent on already-clean values). Integration seam:

```
val = normalizeCell_(rows[r][c], globalLookup);
if (colLookups[c]) val = normalizeCell_(val, colLookups[c]);
if (c === NORM_COL.TRIM) val = cleanTrim_(val);   // <-- new
rows[r][c] = (val === '') ? '*' : val;
```

**Ordered patterns** (case-insensitive, ES5-safe — no lookbehind): (1) decode artifacts → (2) bed/box → (3) wheelbase/inch/`WB`/`CA` dims → (4) `(Natl)` → (5) `®`/`™` → (6) narrow body words (anchored `\b`, no `HB`) → (7) `Sports Activity [Vehicle]` → (8) collapse whitespace + trim edge punctuation. **Decode (1) must precede measurement matching (2,3).**

**Required guards (non-negotiable):**
- **Never-empty:** if cleaning yields `""`, return the **original** pre-clean string (not `*`).
- **Never-bare-residue:** if the result is just a measurement or a lone body word (e.g. `"4D Sedan"`→`"4D"`, `"2dr Cpe"`→`"Cpe"`), revert to original.
- Anchor every body word with `\b`; drop `HB` from the auto set; do not bare-strip `â`.

**Where patterns live:** a **hardcoded `TRIM_CLEANUP_PATTERNS` constant** in `Code.gs` (near `NORMALIZATION_MAPS`). Do **not** put live regex in a NORM_MAPS sheet — unvalidated regex with global blast radius is exactly the failure mode to avoid. The exact-match `trim` map stays the config-driven, user-editable override layer.

**Rollout safety (this changes trim for ALL ~28 dealers at once):**
- **Feature flag** `ENABLE_TRIM_CLEANUP` (default **off**) gating the `cleanTrim_` call — ship dark, validate, flip on, instant rollback without a code push.
- **Dry-run harness** `dryRunCleanTrim_()` (read-only): run every current distinct trim (NORM_MAPS col H) through `cleanTrim_` in memory and write a `raw | cleaned | changed?` diff to a scratch sheet. Eyeball every changed row — hunt for results that shrank to ≤2 chars, equal a measurement, or lost a meaningful body word (Coupe/Convertible/4-DOOR/2-DOOR). Report the changed-count as a greediness sanity gate.

**Do not double-process:** `cleanTrim_` belongs only in `normalizeScraperData_()` (index 6). The Glendale `applyDataTransforms_` `remove` (output doc, col 7) is a separate stage — confirm its rules don't conflict once the global pass is on.

### Proposed exact-match `trim` rules to add (residuals the regex won't handle)
`PROMASTER 1500 TRADESMAN CARGO VAN LOW ROOF 118' W → PROMASTER 1500 TRADESMAN` · `T-250 148" Med Rf 9070 GVWR RWD → T-250` · `2500 Standard Roof V6 144" 4WD → 2500 4WD` · `Work Truck w/Knapheide Bed Conversion → Work Truck` · `4dr Sdn LT w/1LT → LT` · `XtraCab V6 Manual 4WD → XtraCab 4WD` · `SEL w/Two-Tone Roof → SEL` · `2.5 Turbo Premium Plus Package AWD → Premium Plus AWD` · `Premium Plus 45 TFSI quattro → Premium Plus quattro` · `4dr Wgn 3.5L AWD EcoBoost → AWD EcoBoost` · `85TH ANNIVERSARY EDITION 4X4 → 85TH ANNIVERSARY 4X4` · noise singletons `+`, `.`, `WB`, `2` → `*` (never auto-blank `S`/`L`/`M`/`T`). *(Authored via Manage Normalization Maps; extend as the col-H reference surfaces more.)*

### Code anchors (for the implementer)
`Code.gs`: `NORM_COL`/constants ~69; `normalizeCell_` ~791 and `normalizeScraperData_` ~797 (integration seam); `applyDataTransforms_` ~897 (double-process check); `refreshNormReference()` ~1706 / `loadNormalizationMaps_` ~1682 (reference snapshot + exact-map adds + dry-run source).

---

## Production Workflow — Step by Step

1. **Check TRANSCRIPTION** — paste VINs in col A and confirm they show "Found" in real time before creating an order.
2. **Import/verify scraper data** — SilverFox V2 → Import Scraper Data. Review post-import panel.
3. **Open Run Dealer modal** — SilverFox V2 → Run Dealer...
4. **Select "Running as:"** — choose your name from the dropdown. Your local QR path is resolved automatically. The dropdown remembers your last selection.
5. **Select dealer** from dropdown.
6. *(Optional)* **Enter Pipedrive Deal ID(s)** — pre-fills the finalization step shown after the run. You can also create the deal after seeing the results.
7. **Enter VINs** — either paste manually, or click **⟳ Pre-fill from CAO** to automatically pull net-new inventory filtered by `filtering_rules` and deduped against VIN log. Review the CAO summary before proceeding.
8. *(Optional)* **Check "Bypass filtering rules"** if a specific vehicle is being incorrectly filtered.
9. **Click Run Dealer.** Progress bar and step messages update in real time. Nothing is logged yet.
10. **Finalize or abandon each result card.** After completion, one finalization card appears per billing account (one for normal dealers; two for a split run with group units). Review the results, create the Pipedrive deal(s) if the order is real, enter each deal ID, and click **Finalize** — this writes the RUN_LOG/ORDER_STATS row (deal ID required; type `test` for test runs). Or click **Abandon**: the entry is never logged, and if nothing in the run was finalized, the output doc and QR codes are moved to Drive trash (warning popup explains this).
11. **Open Output Folder** to access the output doc and QR codes. Review the output doc and the Pipedrive entry.
12. **Download QR codes** from Drive to your configured local QR folder (set in USER_PROFILES tab).
13. **Export CSV** from output doc → import into Adobe Illustrator for variable data printing.
14. **Commit to VIN Log** — either click **✓ Add to VIN Log** in the modal (enabled once at least one card is finalized; commits all finalized entries), or use SilverFox V2 → Update VIN Log... later. The VIN log is **never** written automatically — finalizing a run does not commit it.

---

## Apps Script — Function Reference

Bound to SF_SYSTEM_MASTER.

### Code.gs — Key Functions

| Function | Signature | Description |
|---|---|---|
| `onOpen` | `()` | Installs the menu: **🚀 Open SilverFox** (`openApp`) + "Classic menu (deprecated)" submenu with the per-view items. |
| `openApp` | `()` | Opens the SilverFox App — `App.html` evaluated as an HtmlService template (1400×900; `MODAL_WIDTH`/`MODAL_HEIGHT`); views stitched in via `include_()`. |
| `include_` | `(name)` | Template include helper — returns a fragment file's raw content for `<?!= include_('ViewXxx') ?>` scriptlets. |
| `openViewStandalone_` | `(fragmentName, title)` | Serves one converted view fragment inside `Classic.html` as a standalone dialog — powers the Classic fallback menu with zero duplication. |
| `getAppBootstrap` | `()` | Single round-trip App bootstrap: `{dealers, users}` (active dealers incl. `splitDealLabel` + user profiles/lastUser). Prefetched once per App session into the shared client-side `AppData` latch (SharedUtils) — Run Order and VIN Logs populate from it instead of firing separate executions. |
| `getAppHomeStatus` | `()` | Home status strip: `{lastImportDate, lastImportTime}` from SCRAPERDATA W1:X1 display values. *(Superseded on Home by `getDashboardView`, which carries the same timestamp; retained for the Classic standalone path.)* |
| `getDashboardView` | `()` | Returns the DASHBOARD tab as `{rows}` — a 2D array of display strings (serializable, no Date objects). Rendered by the Home view; reflects `refreshDashboard_`'s inventory table plus the live formula-driven Run Log Summary / Most Recent Run / Runs By Dealer sections, so Home shows current run numbers without a re-import. |
| `getTranscriptionVins` | `()` | Returns `{vins, count, lastImport}` — the deduped, upper/trim-normalized set of all SCRAPERDATA col-A VINs plus the last-import timestamp. The Transcription view loads it once into a client-side `{VIN:1}` index and checks typed VINs against it instantly (the in-app equivalent of the TRANSCRIPTION sheet's Found/Not-Found ARRAYFORMULA). |
| `appEraseAllQRFolders` / `appCleanUpOutputDocs` / `appRefreshNormReference` / `appOpenRunLog` | `()` | App wrappers returning `{message}` for in-app toasts (`ui.alert` fails when invoked via `google.script.run`); the classic menu functions keep their alerts and share the `*Core_` implementations. |
| `promptRunDealer` | `()` | Classic fallback: opens the ViewRun fragment standalone via `openViewStandalone_`. |
| `openScraperImport` | `()` | Classic fallback: opens the ViewImport fragment standalone. |
| `openNormManager` | `()` | Classic fallback: opens the ViewNorm fragment standalone. |
| `openVINLogUpdater` | `()` | Classic fallback: opens the ViewVinLog fragment standalone. |
| `openRulesEditor` | `()` | Classic fallback: opens the ViewRules fragment standalone. |
| `getRulesEditorBootstrap` | `()` | Single round-trip bootstrap for Rules Editor. Returns `{dealers, schemas}` — active dealers and all CSV schema keys from CSV_SCHEMAS tab. |
| `getDealerRulesData` | `(dealerKey)` | Returns `{dealerName, typeRules, filteringRules}` — parsed objects for both rule sets. Safe defaults on parse failure. |
| `saveDealerTypeRules` | `(dealerKey, typeRulesJson)` | Validates JSON and writes to DEALERS col O (TYPE_RULES). |
| `saveDealerFilterRules` | `(dealerKey, filteringRulesJson)` | Validates JSON and writes to DEALERS col W (FILTER_RULES). |
| `pasteVinsAndRun` | `(dealerKey, vins, dealId, runId, bypassFilters, userKey, splitDealId)` | Resolves QR base path for `userKey` from USER_PROFILES, persists selection, writes VINs to ORDERS, calls `runDealer` (passing preloaded config to avoid a redundant SF_DEALER_CONFIG read). Both deal IDs are **optional** — they only pre-fill the finalization cards. Returns result object. |
| `runDealer` | `(dealerKey, dealId, runId, bypassFilters, qrBasePath, preloadedConfig, splitDealId)` | Main entry point. Produces the output doc / QR codes / CSV / billing sheet(s) but **writes no log rows** — returns `{outputFolderUrl, pendingRuns, dealerName, producedVinCount}` where `pendingRuns` holds one self-contained prospective log entry per billing account, finalized or abandoned in the modal. |
| `finalizeRun` | `(dealerKey, entry, dealId)` | Writes the RUN_LOG (+ ORDER_STATS) row for one finalized pending-run entry via `writeRunLog_`. Throws on blank deal ID (**invariant: no RUN_LOG row without a deal ID**; `test` marks test runs). Never touches the VIN log. Returns `{rowIndex, vinCount}`. |
| `abandonRun` | `(dealerKey, outputDocId)` | Full-abandonment cleanup: moves the output doc and the dealer's `<prefix>_QR_Code_N.PNG` files to Drive trash (30-day recovery). Called only when no card of the run was finalized and none remain pending. Returns `{trashedDoc, trashedQrs}`. |
| `getBillingSplit_` | `(config)` | Parses/validates the optional `billing_split` key from `filtering_rules` (col W). Returns `{groupName, dealLabel, field, op, values}` or **null** on absence/misconfig (fail-safe — run behaves as unsplit). |
| `isInBillingGroup_` | `(vehicle, split)` | Tests one parsed ORDERMATCH vehicle object against a billing split (case-insensitive `contains`/`in`, OR across values). |
| `getCaoVins` | `(dealerKey)` | Pulls current inventory, applies filtering_rules, deduplicates against VIN log. Returns `{vins, summary}`. Called by Run Dealer modal. |
| `getDealerFilterRules_` | `(config)` | Parses `filtering_rules` JSON from dealer config row. Returns structured object with safe defaults (incl. `conditions`, `caoExcludeTypes`). |
| `applyFilteringRules_` | `(vehicles, filterRules, phase)` | Filters SCRAPERDATA-format rows. `phase` ('cao'/'run', default 'run') gates `cao_exclude_types` (CAO only); `conditions` apply in both. Returns `{passed, rejected}` with per-vehicle rejection reasons (incl. `cond:<field>`, `cao_excluded`). |
| `evaluateCondition_` | `(row, condition)` | Evaluates one targeting condition (`{field, op, values}`) against a SCRAPERDATA row via `FILTER_FIELD_INDEX`. Returns `{pass, reason}`. Fails OPEN on unknown field/op, empty values, or unparseable number. |
| `getConfigSS_` | `()` | Returns the SF_DEALER_CONFIG Spreadsheet object, opening it only on the first call per script execution. All config reads use this instead of direct `openById` calls. |
| `getDealerConfig_` | `(dealerKey)` | Reads dealer row from SF_DEALER_CONFIG DEALERS tab via `getConfigSS_()`. |
| `getTypeRules_` | `(config)` | Parses `type_rules` JSON. Falls back to SCP default if absent. |
| `matchRule_` | `(vehicleType, rules)` | Returns first matching type rule for a vehicle type string. |
| `buildUtmFormula_` | `(linkRef, typeRef, rules)` | Generates nested IF formula for multi-rule UTM in LINKBUILDER. |
| `getCsvSchema_` | `(schemaKey)` | Reads field code array from CSV_SCHEMAS tab via `getConfigSS_()`. |
| `getOrderVINs_` | `(colLetter)` | Reads VINs from ORDERS sheet. Uses `getActiveSpreadsheet()`. |
| `getDealerScraperData_` | `(locationName)` | Two-pass read: col T only first, then contiguous range of matching rows. Avoids 120k+ cell reads. |
| `writeOrderMatchFormula_` | `(outputDoc, vins, useStock)` | Writes QUERY formula to ORDERMATCH A2. |
| `buildLinks_` | `(outputDoc, config, typeRules)` | Captures ORDERMATCH row count, writes LINKBUILDER formulas, waits via `calcRecalcDelay_`, reads resulting URLs. |
| `calcRecalcDelay_` | `(rowCount, msPerRow, minMs, maxMs)` | Returns scaled sleep duration in ms. Used after ORDERMATCH and LINKBUILDER formula writes to replace fixed sleeps. |
| `generateQRCodesParallel_` | `(links, qrFolder, qrPrefix)` | Parallel QR generation via `UrlFetchApp.fetchAll()`. One batch call regardless of count. |
| `writeQRPaths_` | `(outputDoc, qrPrefix, count, basePath)` | Writes local QR file paths to ORDERMATCH col J using the per-user `basePath`. |
| `buildCSVSheet_` | `(outputDoc, typeRules)` | Builds CSV output sheet(s) from ORDERMATCH. Calls `dedupFieldCodeHeaders_()` to auto-suffix duplicate field code names in the header row. |
| `dedupFieldCodeHeaders_` | `(fieldCodes)` | Takes a field code array and returns a header-safe version where duplicate codes are suffixed: first occurrence unchanged, subsequent occurrences get `2`, `3`, etc. Data rows are unaffected. |
| `copyVINLogToOutput_` | `(outputDoc, dealerKey)` | Copies dealer's SF_VIN_LOGS tab into output doc LOG sheet. |
| `writeRunLog_` | `(config, dealId, ..., note)` | Appends 23-column row to RUN_LOG. Per-type billing columns (G–N) sourced from the billing totals object. Optional `note` lands in col U (`SPLIT:PRIMARY` / `SPLIT:<group>` markers). Also side-writes a 12-column analytics row to ORDER_STATS (isolated try/catch, non-fatal). Returns 1-based row index of new entry. **Called only by `finalizeRun`** — once per finalized card, never during the run itself. |
| `writeBillingSheet_` | `(outputDoc, billingSplit)` | Reads ORDER/ORDERMATCH/LOG, partitions matched vehicles when `billingSplit` is active, and renders BILLING (+ BILLING_<group>, created on demand) via `renderBillingSheet_`. Returns `{primary: {matchedCount, producedVins}, group: …\|null}` or null if sheets missing. |
| `renderBillingSheet_` | `(sheet, omRows, totalOrdered, notFoundList, logMap)` | Renders one billing sheet from scratch (five sections). All four vehicle types always get a row (zero if absent). Duplicate detail table at col F row 1. Produced VINs list in col B below the summary. Layout matches `readBillingTotals_`'s label map. |
| `readBillingTotals_` | `(outputDoc, sheetName?)` | Reads a billing sheet by label (not cell address) and returns a structured totals object used to populate the RUN_LOG. `sheetName` defaults to `BILLING`; pass `BILLING_<group>` for a split sheet. |
| `getRunsForDealer` | `(dealerKey)` | Returns RUN_LOG rows for a dealer (reading 23 columns), most recent first, with status and `note` (col U — surfaces the `SPLIT:*` badge in the VIN Log Updater). |
| `commitRunToVINLog` | `(dealerKey, runRowIndex, dealId, producedVins)` | Appends VINs to SF_VIN_LOGS with `committed_at`, marks RUN_LOG col W as committed. |
| `commitLatestRun` | `(dealerKey, runRowIndex)` | Reads `produced_vins` (col V) and `deal_id` (col D) from RUN_LOG row, calls `commitRunToVINLog`. |
| `commitRunRows` | `(dealerKey, rowIndexes)` | Commits multiple RUN_LOG rows (post-run button — both rows of a billing-split run). Skips rows already `committed`, so retry after a partial failure is safe. Returns `{committed, skippedCommitted}`. |
| `rollbackRunFromVINLog` | `(dealerKey, runRowIndex, dealId, committedAt)` | Removes VIN log entries by deal ID + committed_at key. Marks RUN_LOG col W as rolled_back. |
| `getCommittedAt` | `(dealerKey, dealId)` | Returns `committed_at` timestamp for a deal ID from VIN log. Used before rollback. |
| `setProgress_` | `(runId, message, percent)` | Writes `{message, percent, done, error}` to ScriptProperties. No-op if runId is falsy. |
| `getRunProgress` | `(runId)` | Returns current progress state. Polled by modal every 1.5 seconds. |
| `clearRunProgress` | `(runId)` | Deletes progress property after run completes. |
| `importScraperData` | `(mappedData, mode, resolutions, fileNames, token)` | Two-phase import. Normalizes incoming rows, builds the working set (`mode`: `'replace'` default = clear-and-write; `'merge'` = combine with existing SCRAPERDATA), runs the VIN dedup engine. Conflicts found + no `resolutions` → returns `{needsResolution, conflicts, token, …}` with **zero mutation**; otherwise (or on the phase-2 call with `resolutions` `{VIN:'existing'\|'new'}` + `'*'` bulk fallback, verified against `token`) groups rows by Location and writes under a `LockService` script lock. Stats/health/dashboard computed on the **final** dataset. Returns review stats + `{mode, duplicatesRemoved, conflictsResolved, blankVinCount, fileCount}`. |
| `dedupeScraperRows_` | `(baseRows, newRows, fileNames)` | VIN-keyed dedup/conflict engine. Order: existing rows → files in selection order. First-seen row per VIN = incumbent; identical later rows (tolerant compare) dropped silently; differing rows become/replace the "challenger" (latest distinct wins, `variantCount` tracked) → 2-way conflict. Blank/`*` VINs pass through unkeyed. |
| `cellsEqual_` / `rowsEqual_` / `diffCols_` | `(a, b)` | Tolerant comparison: trim-string equal, else both-numeric equal (`getValues()` returns numbers for non-`@` columns like Year/MSRP while incoming rows are strings — naive compare would false-conflict every merged row). |
| `applyConflictResolutions_` | `(d, resolutions)` | Applies per-VIN choices; `'new'` substitutes the challenger in the incumbent's position; `resolutions['*']` is the bulk fallback for VINs without an explicit choice. |
| `groupRowsByLocation_` | `(rows)` | Buckets rows by exact Location string (col T) in first-seen order and concatenates — restores the contiguity invariant `getDealerScraperData_` relies on. |
| `readExistingScraperRows_` / `computeImportToken_` | `(sheet)` | Merge-mode base read (A2:U) and the optimistic-concurrency token (`lastRow \| W1 X1 timestamp`) verified between the two phases. |
| `writeImportStats_` | `(ss, timestamp, locationDetail)` | Section 29. Appends one 13-column row per scraper location to IMPORT_STATS after every import. Non-fatal try/catch; skips silently if the sheet is missing. |
| `checkImportHealth_` | `(ss, currentTs, locationDetail)` | Section 29. Reads IMPORT_STATS history (excluding the current import's rows), builds per-location rolling baselines, and returns `[{location, severity, message}]`. Hard errors: total dropped to 0 with prior data; `no_stock`/`no_price` > 20% (`MISSING_FIELD_THRESHOLD`). Baseline warnings (≥ 5 prior rows, `MIN_IMPORTS_FOR_BASELINE`): total/new/po > 40% below rolling average (`DROP_THRESHOLD`); unexpected type appeared. Under-baseline locations return `info` "Building baseline". |
| `refreshDashboard_` | `(ss, importTimestamp, locationDetail)` | Section 30. Rewrites the DASHBOARD tab: timestamp, alphabetical per-location inventory table, TOTALS row, then RUN LOG SUMMARY / MOST RECENT RUN / RUNS BY DEALER sections at dynamic row positions. Clears stale rows; fully dynamic formatting, no merged cells; IFERROR-wrapped formulas. Called at the end of every `importScraperData()`. Non-fatal. |
| `buildNormLookup_` | `(map)` | Converts a norm map array into a lowercase-keyed hash object for O(1) lookups. Called once per map at the start of `normalizeScraperData_()`. |
| `normalizeCell_` | `(value, lookup)` | Normalizes a single cell value against a pre-built lookup object (O(1)). |
| `normalizeScraperData_` | `(rows)` | Builds lookup objects via `buildNormLookup_()`, then runs global + column-specific normalization passes in-place. Fills blanks with `*`. |
| `loadNormalizationMaps_` | `()` | Reads from NORM_MAPS sheet via `getConfigSS_()`. Falls back to hardcoded constant. |
| `refreshNormReference` | `()` | Menu action. Scans SCRAPERDATA once and writes a static sorted distinct-values reference (Type/Make/Model/Trim/Status/Body Style/Fuel Type) to NORM_MAPS cols E+, with per-column counts and a timestamp. On-demand replacement for the removed live `UNIQUE()` reference formulas — zero recalc cost. |
| `getNormEntries` | `(mapName)` | Returns entries for a normalization map with sheet row numbers. |
| `addNormEntry` | `(mapName, rawVal, normVal)` | Inserts new normalization entry after last entry for that map. |
| `updateNormEntry` | `(sheetRow, newInput, newOutput)` | Updates normalization entry in-place. |
| `deleteNormEntry` | `(sheetRow)` | Deletes normalization entry. |
| `moveNormEntry` | `(sheetRow, direction)` | Swaps normalization entry with neighbor ('up'/'down'). |
| `fillScraperDateTime` | `()` | Updates scraper timestamp in W1:X1 and HELPERS A1:B1. |
| `eraseAllQRFolders` | `()` | Clears QR PNG folders for all active dealers. Uses `getConfigSS_()`. |
| `cleanUpOutputDocs` | `(daysOld)` | Trashes output docs older than N days (default 30). |
| `auditConfigPlaceholders` | `()` | Flags active dealers missing required config values including `filtering_rules`. Uses `getConfigSS_()`. |
| `addCommittedAtHeaders` | `()` | One-time setup: adds `committed_at` header to col C of all SF_VIN_LOGS dealer tabs. |
| `getUserProfiles` | `()` | Returns all rows from USER_PROFILES tab as `[{key, name}]`. Uses `getConfigSS_()`. |
| `getUserProfilesForModal` | `()` | Single round-trip bootstrap for Run Dealer modal: returns `{profiles, lastUser}`. |
| `getQRBasePathForUser_` | `(userKey)` | Internal. Looks up `qr_local_base_path` for a user key from USER_PROFILES via `getConfigSS_()`. Validates path exists and normalizes trailing separator. |
| `getLastSelectedUser` | `()` | Returns last-used `user_key` from `PropertiesService.getUserProperties()`. Empty string if none. |
| `saveLastSelectedUser` | `(userKey)` | Persists `user_key` to UserProperties for the current Google account. |
| `getLatestOrderId` | `(dealerKey)` | Reads the dealer's SF_VIN_LOGS tab bottom-up and returns the most recent non-blank `ORDER_ID` from col A. Returns `{latestOrderId: string\|null}`. Used by VINLogUpdater manual entry panel to pre-populate the Order Number field. |
| `manualCommitToVINLog` | `(dealerKey, orderId, vins[])` | Directly appends VINs to a dealer's SF_VIN_LOGS tab without going through the RUN_LOG. Deduplicates input (case-insensitive). Writes `ORDER_ID \| VIN \| committed_at` rows. Returns `{committed: number}`. Used by the VINLogUpdater manual entry panel for LIST orders and other manually-entered runs with no corresponding run record. |

### Key Constants

```javascript
MASTER_SHEET_ID   = '1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes'
CONFIG_SHEET_ID   = '1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8'
TEMPLATE_ID       = '14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc'
VIN_LOGS_ID       = '12Xf6dyZXWXp4JwbytGo6lRUShwuGeN0yS3zhbco4-Lk'
OUTPUT_FOLDER_ID  = '1iRDDlqgQPn9R67AEIUJcF8JmyiOyn8DI'
USER_PROFILES_TAB = 'USER_PROFILES'   // tab in SF_DEALER_CONFIG; per-user QR base paths
NORM_MAPS_TAB     = 'NORM_MAPS'
NORM_COL          = { TYPE: 2, TRIM: 6, STATUS: 8, PRICE: 9 }  // 0-indexed SCRAPERDATA cols

// Module-level cache — not a declared constant, but functionally global within a run:
// var _configSS_ = null;  // holds SF_DEALER_CONFIG Spreadsheet object; reset per execution
```

### HTML Files

> **The SilverFox App (June 2026, `feature/app-shell`).** The five standalone modals were converted into **view fragments** inside a single-modal SPA. The menu has one primary item — **🚀 Open SilverFox** (`openApp`) — opening `App.html` (1400×900): a persistent left **sidebar** (Home, Run Order, Import Data, VIN Logs, Transcription, Dealer Rules, Normalization, Utilities, Close), a header with the section title, and a content area where views are stitched in via `<?!= include_('ViewXxx') ?>` (HtmlService templating). Navigation is instant client-side show/hide (`navTo`) — **hidden views retain full DOM + JS state** (live progress polling, pending finalization cards, dirty flags all survive switching views). Views lazy-initialize on first visit via the `VIEW_INITS` registry (`VIEW_SHOWN` re-runs per visit, e.g. table sizing). Supporting files: `ViewHome.html` (workflow launcher cards + a **live Dashboard render** of the DASHBOARD sheet via `getDashboardView`, reloaded on every Home visit through `VIEW_SHOWN` + a Refresh button, with the last-import status strip derived from the dashboard's timestamp row), `ViewUtilities.html` (the five maintenance buttons — Update Timestamp, Refresh Norm Reference, View Run Log, Clear QR Folders, Clean Up Output Docs — moved off Home onto their own 🔧 Utilities sidebar page; in-app toasts via the `runUtility`/`confirmUtility` helpers), `ViewTranscription.html` (🔍 Transcription — paste/type VINs and get instant Found/Not-Found against the current inventory via `getTranscriptionVins`, a client-side `{VIN:1}` index checked per keystroke; the in-app mirror of the TRANSCRIPTION sheet's ARRAYFORMULA), `SharedUtils.html` (shared `escHtml`, `toast`, `AppGuards` close-guards, `AppBusy` mutual-exclusion flags — included **before** the fragments so parse-time registrations work), and `Classic.html` + `openViewStandalone_` (serves any single fragment standalone — powers the **"Classic menu (deprecated)"** submenu fallback during validation with zero code duplication; remove at sign-off). New invariants: `.view[hidden]{display:none !important}` (author display rules would defeat `[hidden]`); imports and runs are mutually exclusive via `AppBusy`; exits run all registered guards through `exitApp()`.
>
> File renames: `DealerSelector.html`→`ViewRun.html`, `ScraperImport.html`→`ViewImport.html`, `VINLogUpdater.html`→`ViewVinLog.html`, `RulesEditor.html`→`ViewRules.html`, `NormManager.html`→`ViewNorm.html`. The per-view descriptions below still apply (CSS is scoped per view; the formerly-colliding `status`/`dealerSelect`/`vinCount` ids and `setStatus`/`updateVinCount` helpers are view-prefixed). In the App, ViewRun's "Update VIN Log" button jumps to the VIN Logs view with the dealer preselected — pending finalization cards survive the jump.

**ViewRun.html** *(formerly DealerSelector.html)* — Run Order view (was the Run Dealer modal). "Running as:" user dropdown (top, required — gates Run button; pre-selects last-used selection per Google account), dealer dropdown, VIN Log status row (appears after a dealer is selected: "Most recent order in log: {id}" populated via `getLatestOrderId`, plus a 📋 Update VIN Log button that opens the VIN Log Updater modal), **optional** Pipedrive Deal ID field (+ optional second deal ID field for billing-split dealers — both only pre-fill the finalization cards), VIN textarea with live count, CAO pre-fill button with filter rejection summary, bypass filters checkbox, progress bar with step messages and elapsed timer. **Post-run finalization panel (v2.10):** one card per prospective RUN_LOG entry (label, unit/ordered counts, deal ID input, Finalize/Abandon buttons, per-card status). Finalize calls `finalizeRun` (deal ID required; `test` for test runs); Abandon is per-card — abandoning the last live card with nothing finalized warns and calls `abandonRun` (output doc + QR PNGs → Drive trash). "✓ Add to VIN Log" enables once ≥1 card is finalized and commits all finalized, uncommitted, non-zero-VIN rows via `commitRunRows`. Confirm-dialog guards protect un-finalized results on dealer change, new run, and Cancel/Close (the dialog X cannot be intercepted — an X-closed run is never logged).

**ViewImport.html** *(formerly ScraperImport.html)* — Import Data view. **Multi-file import with two modes** (June 2026): a segmented mode selector chooses **Main Import (Replace)** (clears SCRAPERDATA, imports the selected file(s)) or **Merge with Existing** (combines the selected file(s) with the current data). The file input accepts multiple CSVs; each file is parsed independently with its own header mapping (files may have different column orders/sets), rendered as a per-file card (name, row count, matched/missing/ignored columns); a file without a VIN column is rejected and blocks the import (all-or-nothing). A UTF-8 BOM is stripped per file, and stray header rows hiding mid-file (VIN cell = literal "VIN") are dropped. Calls `importScraperData(rows, mode, resolutions, fileNames, token)` — when the server detects VIN conflicts (same VIN, differing data) it returns them without writing, and a **conflict resolution panel** appears: per-VIN side-by-side diff cards (only differing fields shown, sources labeled by filename or "Existing data"; cards are full-width with a `table-layout: fixed` Field/Existing/New table so both occurrences always render — a 2-col grid from the 1400×900 rework had clipped the New column, fixed June 2026), per-VIN keep-existing/keep-new radios, bulk "Keep All Existing"/"Keep All New" buttons (the `'*'` fallback choice covers conflicts beyond the rendered cap of 200), Cancel (safe — nothing written) and Apply & Import. Identical duplicate VINs are removed silently. The review panel shows mode-aware totals plus an Import Summary badge row (files, mode, duplicates removed, conflicts resolved, rows without VIN), the type/status breakdowns, Location × Type table, and the `checkImportHealth_()` health section.

**ViewNorm.html** *(formerly NormManager.html)* — Normalization view. Stacked layout: add form on top, scrollable entries table below. All five maps support inline edit, delete, ▲▼ reorder.

**ViewVinLog.html** *(formerly VINLogUpdater.html)* — VIN Logs view. Dealer dropdown, runs table with timestamp/deal ID/VIN count/status badges, Commit and Rollback action buttons. After a dealer is selected, a collapsible **"＋ Manually add VINs to log"** panel appears below the runs table. The panel contains an Order Number input (pre-populated with the most recent order ID from the dealer's VIN log tab via `getLatestOrderId`), a VIN textarea (one VIN or stock number per line, with live count), and a Submit button. On submit, calls `manualCommitToVINLog` — which deduplicates the input list (case-insensitive), appends `ORDER_ID | VIN | committed_at` rows directly to SF_VIN_LOGS, and returns the committed count. Does **not** touch the RUN_LOG.

**ViewRules.html** *(formerly RulesEditor.html)* — Dealer Rules view. Two-tab layout. Type Rules tab: card list with ▲▼ reorder and remove per rule, add-rule form with match dropdown, live CSV schema dropdown (loaded from CSV_SCHEMAS tab at open time), and UTM input. Filtering Rules tab: `require_stock`/`require_price` toggle switches, `allowed_types` and `exclude_status` pill buttons, min/max price inputs, per-type seasoning table. Each tab saves independently.

### Script Files to Delete
- `VINLogMigration.gs` — one-time VIN log migration, complete
- `FolderSetup.gs` — one-time folder creation, complete

---

## Data Transforms

Dealer-specific find/replace rules in `data_transforms` column (I), applied to SCRAPERDATA in the output doc after pasting. Currently used by **Glendale CDJR** only (Wrangler Unlimited, Grand Cherokee L, Wagoneer L, Grand Wagoneer L model/trim splits + BOX trim removals). Distinct from normalization (global, at import time).

> **Known issue:** Glendale's JSON also contains a `"model_trim_split": true` key that `applyDataTransforms_` does not read — only the `replacements` array is processed. The key is currently inert; either implement it or remove it from the config.

Model and trim are now read and written in a single API call each (2-column range), reducing the number of `getRange`/`setValues` calls from 4 to 2 per transform run.

```json
{
  "replacements": [
    { "col": "model", "find": "Wrangler Unlimited", "model_replace": "Wrangler", "trim_prepend": "Unlimited" },
    { "col": "trim", "remove": ["5'7 BOX", "6'4 BOX"] }
  ]
}
```

---

## Adding a New Dealer

1. Create dealer folder + QR subfolder in the output folder; note both IDs
2. Add row to SF_DEALER_CONFIG DEALERS tab with all active columns filled
3. Set `type_rules` using post-normalization type values (`New`, `PO`, `CPO`)
4. Set `filtering_rules` JSON — use `allowed_types`, `exclude_status: ["OFFLOT"]`, `require_stock: true` as a minimum baseline
5. Create tab in SF_VIN_LOGS named exactly by `dealer_key` with headers `ORDER_ID | VIN | committed_at`
6. Set `active` to TRUE
7. Reload SF_SYSTEM_MASTER — dealer appears in modal immediately

## Adding a New CSV Schema

1. Add row to CSV_SCHEMAS tab with unique `schema_key`
2. Fill `col_1` through `col_N` with valid field codes
3. If the same field code appears multiple times (multi-graphic template), just list it as many times as needed — the header row will auto-suffix duplicates at write time
4. Reference schema key in dealer's `type_rules`

## Adding a New Field Code

1. Add ARRAYFORMULA column to ORDERMATCH in SF_UNIVERSAL_TEMPLATE; note 1-based column number
2. Add entry to `FIELD_TO_COL` in Code.gs
3. Add row to FIELD_CODES tab in SF_DEALER_CONFIG (documentation only)
4. Add field code to a schema in CSV_SCHEMAS
5. Reference schema in dealer's `type_rules`

## Adding or Updating Normalization Rules

Use **SilverFox V2 → Manage Normalization Maps**. Never edit Code.gs for routine rule changes.

## Editing Type Rules or Filtering Rules

Use **SilverFox V2 → Edit Dealer Rules...**. Select a dealer from the dropdown — rules load immediately. Type Rules tab manages `type_rules` (col O); Filtering Rules tab manages `filtering_rules` (col W). Each tab saves independently. CSV schema options are loaded live from the CSV_SCHEMAS tab — no hardcoded values.

---

## Capacity & Log Growth Plan *(written June 2026, while logs were <1k rows)*

At production pace the log tabs grow without bound. This section records the limits, the growth math, the thresholds to watch, and the archive design to build **when — and only when — a threshold is hit**. Nothing needs to be built before then.

### The two limits

**Hard limit:** Google Sheets caps a spreadsheet at **10 million cells** (sum of all tabs; empty-but-allocated grid cells count). Each core file (SF_SYSTEM_MASTER, SF_DEALER_CONFIG, SF_UNIVERSAL_TEMPLATE, SF_VIN_LOGS) has its own 10M budget. The log tabs all live in **SF_SYSTEM_MASTER**, so it is the document to watch.

**Practical limit (hits first):** several functions read *entire* log tabs and scale linearly with their size:
- `checkImportHealth_` reads **all of IMPORT_STATS** on every import
- DASHBOARD's RUNS BY DEALER is a **QUERY over RUN_LOG A:W**, recalculated on refresh
- `getRunsForDealer` reads the full RUN_LOG and filters in memory

The NORM_MAPS `UNIQUE()` incident (June 2026) is the canonical example of this failure pattern: cheap for years, then a size threshold turns programmatic access into ~100s timeouts. Expect sluggishness in the **~25k–50k rows-per-tab range — roughly 2–3 years** at production volume.

### Growth math (assumes ~300 orders/week, imports most days)

| Tab | Growth driver | ≈ Cells/year |
|---|---|---|
| RUN_LOG (23 cols) | 1 row per run (~15,600/yr) | ~360k |
| ORDER_STATS (12 cols) | 1 row per run | ~190k |
| IMPORT_STATS (13 cols) | ~43 locations × every import (incl. merges) | ~290k |
| SCRAPERDATA | snapshot — replaced per import, does not accumulate | ~220k standing |

Total ≈ **850k cells/year** vs a 10M ceiling → hard limit is ~8–10 years out; the practical limit arrives first. **IMPORT_STATS is the fastest-growing tab** (merge imports append a row for *every* location) — first to watch if merge imports become frequent.

### Triggers to act

Build the archiver when **any** of these occur:
1. Any log tab exceeds **~25,000 rows**.
2. Imports or DASHBOARD refresh become noticeably slow.
3. SF_SYSTEM_MASTER total cell count passes ~5M (check File → Settings or count rows×cols per tab).

### Archive design (build at trigger time; ~half-day job)

Menu-driven `archiveOldLogs()`:
- Moves rows **older than 12 months** from RUN_LOG, IMPORT_STATS, and ORDER_STATS into a separate **`SF_LOG_ARCHIVE`** spreadsheet (per-year tabs, e.g. `RUN_LOG_2026`).
- **No live function needs to reference the archive** — every runtime consumer only needs recent data: health baselines are rolling averages over recent IMPORT_STATS; commit/rollback only touches recent runs; the DASHBOARD summarizes current state.
- One semantic change: all-time counts (e.g. RUNS BY DEALER) become **trailing-12-months**. Lifetime totals live in the archive workbook (or the archiver writes a small carry-forward summary row).
- Non-fatal/isolated like the stats writes: an archive failure must never break an import or run.

### Explicitly out of scope for archiving

- **SF_VIN_LOGS — never archive.** It is the CAO dedup source of truth ("have we ever printed this VIN"), grows slowly (3 narrow columns per dealer tab), and has decades of headroom in its own document.
- **SCRAPERDATA** — a snapshot, self-limiting.

### Structural endgame

V3's PostgreSQL migration eliminates this problem class entirely — IMPORT_STATS and ORDER_STATS were deliberately designed as flat, formula-free tables so they port 1:1 to `import_stats` / `order_stats` database tables.

---

## Known Issues & Pending Work

### Active Issues
- **Trim cleanup (analyzed; deferred):** Trim strings overflow the print template and need manual editing. Full analysis + a validated auto-cleanup design (global `cleanTrim_` regex pass behind a feature flag + dry-run, plus residual exact-match rules) is captured in **Trim Normalization & Cleanup — Analysis & Deferred Design** above. Decision on approach (A full / B phased / C exact-only) pending.
- **Stock→VIN fallback (planned):** No dealer uses `use_stock_not_vin` — VIN is always the primary key. Desired behavior: if an ordered identifier isn't found in the SCRAPERDATA VIN column, check the Stock column and substitute the matching row's VIN. Not yet implemented.
- **`model_trim_split` config key inert:** present in Glendale's `data_transforms` but ignored by `applyDataTransforms_`. Implement or remove.
- **Stale dealer notes:** Hyundai of Jefferson City and Nissan of Jefferson City notes still say "Scraper #N/A — inactive" but both dealers are active with live scraper feeds. Notes-column cleanup.
- **MBCC/Sprinter shared inventory — resolved (v2.9/v2.10, June 12 2026):** Option B (one run, two billing outputs) deployed and configured. MBCC's `filtering_rules` carries the `billing_split` key (`field: "model", op: "contains", values: ["Sprinter", "Metris"]`); split runs produce BILLING + BILLING_SPRINTER and two finalization cards with independent deal IDs. Live-test verification per the v2.9/v2.10 changelog entries is the remaining step.
- **Auffenberg Hybrid order:** Run Dealer modal doesn't support two-stream (CAO + manual) orders or type override on manual stream. Needs modal additions when Maintenance/Hybrid order types are implemented.
- **Maintenance and Hybrid order types:** Designed and documented but not yet in the Run Dealer modal.
- **`scraper_location_name` mismatches:** BMW of West St. Louis, Serra Honda O'Fallon, and Joe Machens CDJR (now CDJR of Columbia) were identified as potential mismatches. CDJR of Columbia confirmed: `scraper_location_name` is "Joe Machens Chrysler Dodge Jeep Ram" (legacy scraper feed name). System functions correctly — this is a pending cleanup item only.

### Housekeeping
- Fix `#ERROR!` cells in README tabs of SF_SYSTEM_MASTER and SF_DEALER_CONFIG (cosmetic)
- Delete `VINLogMigration.gs` and `FolderSetup.gs` from Apps Script
- Fix legacy field names in `_CONFIG_CACHE` row 1 (cosmetic)
- Resolve remaining `scraper_location_name` mismatches for BMW of West St. Louis and Serra Honda O'Fallon
- Delete `test-write-access.txt` from the GitHub repo root (leftover MCP write test — remove locally with `git rm` and push)

---

## Spreadsheet ID Quick Reference

| Name | ID |
|---|---|
| SF_SYSTEM_MASTER | `1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes` |
| SF_DEALER_CONFIG | `1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8` |
| SF_UNIVERSAL_TEMPLATE | `14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc` |
| SF_VIN_LOGS | `12Xf6dyZXWXp4JwbytGo6lRUShwuGeN0yS3zhbco4-Lk` |
| Global Output Folder | `1iRDDlqgQPn9R67AEIUJcF8JmyiOyn8DI` |
| V2 Project Folder | `1fL4btBpCVao9gxp2P-RnxiuAi4OXj38_` |
