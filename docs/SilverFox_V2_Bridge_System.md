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

- **`order_id` (col D)** — Pipedrive Deal ID, entered in the Run Dealer modal at run time. Required field.
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
One row per dealer (42 rows; 28 active), 23 columns (A–W).

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

**Reference columns (E onward):** intentional. Each column holds a formula pulling the unique values of one SCRAPERDATA column from SF_SYSTEM_MASTER, used to spot new raw values that need normalization rules. The script only reads cols A–C; these reference columns never affect normalization.

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

**Rejection reasons** (shown in CAO summary and logged during runs): `no_stock`, `no_price`, `type`, `status`, `price_low`, `price_high`, `seasoning`.

### Where filtering is applied

**At CAO pre-fill time** (`getCaoVins`): applied to raw SCRAPERDATA rows, then VIN log dedup.

**At run time, step 8.5** (`runDealer`): applied to the ordered VINs array before the ORDERMATCH QUERY is written. If all VINs are filtered, the run aborts with a descriptive error.

**Bypass:** The Run Dealer modal has a "Bypass filtering rules" checkbox. When enabled, step 8.5 is skipped entirely.

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
| U | 21 | PRICE_TAGLINE | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(NOT(ISNUMBER(H2:H)),"",IF(H2:H>=15000,"as low as $300/mo",IF(H2:H>=10000,"Below $15,000","Below $10,000")))))` |

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

VIN log entries are **never written automatically during a run.** The workflow is:

1. Run completes → produced VINs stored in RUN_LOG col V, status = pending
2. User reviews output doc and Pipedrive entry
3. User opens **SilverFox V2 → Update VIN Log...** modal
4. Selects dealer → sees list of pending/committed runs
5. Selects a run → clicks **Commit to VIN Log** → entries appended with `committed_at` timestamp
6. If a run was committed in error → click **Rollback** → entries removed by deal ID + `committed_at` key

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

## Production Workflow — Step by Step

1. **Check TRANSCRIPTION** — paste VINs in col A and confirm they show "Found" in real time before creating an order.
2. **Import/verify scraper data** — SilverFox V2 → Import Scraper Data. Review post-import panel.
3. **Open Run Dealer modal** — SilverFox V2 → Run Dealer...
4. **Select "Running as:"** — choose your name from the dropdown. Your local QR path is resolved automatically. The dropdown remembers your last selection.
5. **Select dealer** from dropdown.
6. **Enter Pipedrive Deal ID** — required field.
7. **Enter VINs** — either paste manually, or click **⟳ Pre-fill from CAO** to automatically pull net-new inventory filtered by `filtering_rules` and deduped against VIN log. Review the CAO summary before proceeding.
8. *(Optional)* **Check "Bypass filtering rules"** if a specific vehicle is being incorrectly filtered.
9. **Click Run Dealer.** Progress bar and step messages update in real time.
10. **After completion:** Click **📁 Open Output Folder** to access the output doc and QR codes. Review the output doc and enter the deal in Pipedrive.
11. **Download QR codes** from Drive to your configured local QR folder (set in USER_PROFILES tab).
12. **Export CSV** from output doc → import into Adobe Illustrator for variable data printing.
13. **Commit to VIN Log** — either click **✓ Add to VIN Log** in the modal immediately, or use SilverFox V2 → Update VIN Log... later to commit the run.

---

## Apps Script — Function Reference

Bound to SF_SYSTEM_MASTER.

### Code.gs — Key Functions

| Function | Signature | Description |
|---|---|---|
| `onOpen` | `()` | Installs SilverFox V2 menu. |
| `promptRunDealer` | `()` | Opens Run Dealer modal (580×600px). |
| `openScraperImport` | `()` | Opens Import Scraper Data modal (620×580px). |
| `openNormManager` | `()` | Opens Normalization Maps modal (740×620px). |
| `openVINLogUpdater` | `()` | Opens VIN Log Updater modal (660×540px). |
| `openRulesEditor` | `()` | Opens Dealer Rules Editor modal (680×660px). |
| `getRulesEditorBootstrap` | `()` | Single round-trip bootstrap for Rules Editor. Returns `{dealers, schemas}` — active dealers and all CSV schema keys from CSV_SCHEMAS tab. |
| `getDealerRulesData` | `(dealerKey)` | Returns `{dealerName, typeRules, filteringRules}` — parsed objects for both rule sets. Safe defaults on parse failure. |
| `saveDealerTypeRules` | `(dealerKey, typeRulesJson)` | Validates JSON and writes to DEALERS col O (TYPE_RULES). |
| `saveDealerFilterRules` | `(dealerKey, filteringRulesJson)` | Validates JSON and writes to DEALERS col W (FILTER_RULES). |
| `pasteVinsAndRun` | `(dealerKey, vins, dealId, runId, bypassFilters, userKey)` | Resolves QR base path for `userKey` from USER_PROFILES, persists selection, writes VINs to ORDERS, calls `runDealer` (passing preloaded config to avoid a redundant SF_DEALER_CONFIG read). Returns result object. |
| `runDealer` | `(dealerKey, dealId, runId, bypassFilters, qrBasePath, preloadedConfig)` | Main entry point. `preloadedConfig` is optional — if provided (from `pasteVinsAndRun`), skips the `getDealerConfig_` call. Returns `{outputFolderUrl, runLogRowIndex, dealerName, producedVinCount}`. |
| `getCaoVins` | `(dealerKey)` | Pulls current inventory, applies filtering_rules, deduplicates against VIN log. Returns `{vins, summary}`. Called by Run Dealer modal. |
| `getDealerFilterRules_` | `(config)` | Parses `filtering_rules` JSON from dealer config row. Returns structured object with safe defaults. |
| `applyFilteringRules_` | `(vehicles, filterRules)` | Filters SCRAPERDATA-format rows. Returns `{passed, rejected}` with per-vehicle rejection reasons. |
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
| `writeRunLog_` | `(config, dealId, ...)` | Appends 23-column row to RUN_LOG. Per-type billing columns (G–N) sourced from BILLING sheet. Also side-writes a 12-column analytics row to ORDER_STATS (isolated try/catch, non-fatal). Returns 1-based row index of new entry. |
| `writeBillingSheet_` | `(outputDoc)` | Builds the BILLING sheet from scratch (five sections). All four vehicle types always get a row (zero if absent). Duplicate detail table at col F row 1. Produced VINs list in col B below the summary. |
| `readBillingTotals_` | `(outputDoc)` | Reads BILLING sheet by label (not cell address) and returns a structured totals object used to populate the RUN_LOG. |
| `getRunsForDealer` | `(dealerKey)` | Returns RUN_LOG rows for a dealer (reading 23 columns), most recent first, with status. |
| `commitRunToVINLog` | `(dealerKey, runRowIndex, dealId, producedVins)` | Appends VINs to SF_VIN_LOGS with `committed_at`, marks RUN_LOG col W as committed. |
| `commitLatestRun` | `(dealerKey, runRowIndex)` | Reads `produced_vins` (col V) and `deal_id` (col D) from RUN_LOG row, calls `commitRunToVINLog`. Used by post-run button. |
| `rollbackRunFromVINLog` | `(dealerKey, runRowIndex, dealId, committedAt)` | Removes VIN log entries by deal ID + committed_at key. Marks RUN_LOG col W as rolled_back. |
| `getCommittedAt` | `(dealerKey, dealId)` | Returns `committed_at` timestamp for a deal ID from VIN log. Used before rollback. |
| `setProgress_` | `(runId, message, percent)` | Writes `{message, percent, done, error}` to ScriptProperties. No-op if runId is falsy. |
| `getRunProgress` | `(runId)` | Returns current progress state. Polled by modal every 1.5 seconds. |
| `clearRunProgress` | `(runId)` | Deletes progress property after run completes. |
| `importScraperData` | `(mappedData)` | Normalizes and writes to master SCRAPERDATA. Returns review stats. |
| `writeImportStats_` | `(ss, timestamp, locationDetail)` | Section 29. Appends one 13-column row per scraper location to IMPORT_STATS after every import. Non-fatal try/catch; skips silently if the sheet is missing. |
| `checkImportHealth_` | `(ss, currentTs, locationDetail)` | Section 29. Reads IMPORT_STATS history (excluding the current import's rows), builds per-location rolling baselines, and returns `[{location, severity, message}]`. Hard errors: total dropped to 0 with prior data; `no_stock`/`no_price` > 20% (`MISSING_FIELD_THRESHOLD`). Baseline warnings (≥ 5 prior rows, `MIN_IMPORTS_FOR_BASELINE`): total/new/po > 40% below rolling average (`DROP_THRESHOLD`); unexpected type appeared. Under-baseline locations return `info` "Building baseline". |
| `refreshDashboard_` | `(ss, importTimestamp, locationDetail)` | Section 30. Rewrites the DASHBOARD tab: timestamp, alphabetical per-location inventory table, TOTALS row, then RUN LOG SUMMARY / MOST RECENT RUN / RUNS BY DEALER sections at dynamic row positions. Clears stale rows; fully dynamic formatting, no merged cells; IFERROR-wrapped formulas. Called at the end of every `importScraperData()`. Non-fatal. |
| `buildNormLookup_` | `(map)` | Converts a norm map array into a lowercase-keyed hash object for O(1) lookups. Called once per map at the start of `normalizeScraperData_()`. |
| `normalizeCell_` | `(value, lookup)` | Normalizes a single cell value against a pre-built lookup object (O(1)). |
| `normalizeScraperData_` | `(rows)` | Builds lookup objects via `buildNormLookup_()`, then runs global + column-specific normalization passes in-place. Fills blanks with `*`. |
| `loadNormalizationMaps_` | `()` | Reads from NORM_MAPS sheet via `getConfigSS_()`. Falls back to hardcoded constant. |
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

**DealerSelector.html** — Run Dealer modal (580×600px). "Running as:" user dropdown (top, required — gates Run button; pre-selects last-used selection per Google account), dealer dropdown, VIN Log status row (appears after a dealer is selected: "Most recent order in log: {id}" populated via `getLatestOrderId`, plus a 📋 Update VIN Log button that opens the VIN Log Updater modal), required Pipedrive Deal ID field, VIN textarea with live count, CAO pre-fill button with filter rejection summary, bypass filters checkbox, progress bar with step messages and elapsed timer, post-run action buttons (Open Output Folder, Add to VIN Log).

**ScraperImport.html** — Import Scraper Data modal (620×580px). CSV upload, two-column matched/missing column mapping preview, row count display, calls `importScraperData()`. Shows post-import review panel (type breakdown, status breakdown, Location × Type table) on success, including a health issues section that renders the `checkImportHealth_()` results — error/warning/info items per scraper location, or a clean all-healthy state.

**NormManager.html** — Normalization Maps modal (740×620px). Stacked layout: add form on top, scrollable entries table below. All five maps support inline edit, delete, ▲▼ reorder.

**VINLogUpdater.html** — VIN Log Updater modal (660×540px). Dealer dropdown, runs table with timestamp/deal ID/VIN count/status badges, Commit and Rollback action buttons. After a dealer is selected, a collapsible **"＋ Manually add VINs to log"** panel appears below the runs table. The panel contains an Order Number input (pre-populated with the most recent order ID from the dealer's VIN log tab via `getLatestOrderId`), a VIN textarea (one VIN or stock number per line, with live count), and a Submit button. On submit, calls `manualCommitToVINLog` — which deduplicates the input list (case-insensitive), appends `ORDER_ID | VIN | committed_at` rows directly to SF_VIN_LOGS, and returns the committed count. Does **not** touch the RUN_LOG.

**RulesEditor.html** — Dealer Rules Editor modal (680×660px). Two-tab layout. Type Rules tab: card list with ▲▼ reorder and remove per rule, add-rule form with match dropdown, live CSV schema dropdown (loaded from CSV_SCHEMAS tab at open time), and UTM input. Filtering Rules tab: `require_stock`/`require_price` toggle switches, `allowed_types` and `exclude_status` pill buttons, min/max price inputs, per-type seasoning table. Each tab saves independently.

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

## Known Issues & Pending Work

### Active Issues
- **Stock→VIN fallback (planned):** No dealer uses `use_stock_not_vin` — VIN is always the primary key. Desired behavior: if an ordered identifier isn't found in the SCRAPERDATA VIN column, check the Stock column and substitute the matching row's VIN. Not yet implemented.
- **`model_trim_split` config key inert:** present in Glendale's `data_transforms` but ignored by `applyDataTransforms_`. Implement or remove.
- **Stale dealer notes:** Hyundai of Jefferson City and Nissan of Jefferson City notes still say "Scraper #N/A — inactive" but both dealers are active with live scraper feeds. Notes-column cleanup.
- **MBCC/Sprinter shared inventory:** Mercedes-Benz of Creve Coeur and Sprinter share a scraper location. Billing must be split into separate outputs. `billing_groups` concept designed but not implemented. Decision pending: Option A (two separate order runs, user splits VINs) vs Option B (one run, two billing outputs).
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
