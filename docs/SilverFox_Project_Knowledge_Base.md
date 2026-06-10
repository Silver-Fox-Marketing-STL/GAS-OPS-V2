# SilverFox Marketing — Project Knowledge Base
### Compressed Reference | Last verified against live system: June 10, 2026

This document distills all critical decisions, architecture, bugs, and context from the full project history. It is the primary memory document for continuing development.

---

## System Hierarchy

| System | Status | Platform |
|---|---|---|
| **V1** | Active production | Google Sheets + Apps Script (~42 per-dealer functions) |
| **V2** | Near production (final bug-hunt) | Google Sheets + Apps Script (config-driven, universal) |
| **V3** | Long-term, paused | Python Flask + PostgreSQL |

V2 is the only system being actively developed. V3 development is paused until V2 is stable.

---

## V2 Core Files

| File | Spreadsheet ID |
|---|---|
| SF_SYSTEM_MASTER (script bound here) | `1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes` |
| SF_DEALER_CONFIG | `1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8` |
| SF_UNIVERSAL_TEMPLATE | `14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc` |
| SF_VIN_LOGS | `12Xf6dyZXWXp4JwbytGo6lRUShwuGeN0yS3zhbco4-Lk` |
| Global Output Folder | `1iRDDlqgQPn9R67AEIUJcF8JmyiOyn8DI` |
| V2 Project Folder | `1fL4btBpCVao9gxp2P-RnxiuAi4OXj38_` |

Code files live in GitHub: `Silver-Fox-Marketing-STL/GAS-OPS-V2` (branch `main`; `feature/health-monitoring` merged June 2026).

---

## Critical Architecture Decisions

### Normalization
- **Post-normalization type values are `New`, `PO`, `CPO`** — never `Used`, `Certified`, etc.
- **CPO-EL is NOT normalized** — MBCC's scraper sends `CPO-EL` raw and it passes through unchanged. It must always be checked before `CPO` in any SEARCH/IF chain because "CPO" is a substring of "CPO-EL".
- **NORM_MAPS sheet is the live source of truth.** The hardcoded `NORMALIZATION_MAPS` constant in Code.gs is fallback only. The initialize function was deliberately removed to prevent accidental overwrite.
- **Normalization runs twice:** once in `importScraperData()` on the master SCRAPERDATA, and once in `pasteScraperData_()` when copying to the output doc.

### Stock Number Type Bug (fixed)
- **Root cause:** New vehicle stock numbers (e.g. `262677`) are purely numeric → Sheets auto-converts to number type. Used/CPO stocks (e.g. `262617A`) stay as strings. QUERY sees mixed types and silently drops string values.
- **Fix:** Both `importScraperData()` and `pasteScraperData_()` explicitly convert VIN (index 0) and Stock (index 1) to `String()` AND set `@` number format before AND after `setValues()`.

### Field Code System
- **`FIELD_TO_COL` in Code.gs is the only thing that matters at runtime.** The FIELD_CODES tab and ORDERMATCH headers are documentation only.
- **`buildCSVSheet_` reads 100 columns** from ORDERMATCH. Adding new columns up to col CV requires no changes.
- **Current FIELD_TO_COL:** YEAR:1, MAKE:2, MODEL:3, TRIM:4, VIN:5, STOCK:6, TYPE:7, PRICE_RAW:8, @QR:10, @QR2:10, YEARMAKE:11, YEARMODEL/QRYEARMODEL:12, MAKE_MODEL_COMBINED:13, QRSTOCK:14, MISC:15, PRICE_FMT:16, NEWYEARMAKE:17, TYPEVIN:18, YEARMODELSTOCK:19, PRICE_PLUS_2000:20

### type_rules
- Must use post-normalization values in `match` fields: `New`, `PO`, `CPO`, `CPO-EL`
- Rules evaluated top-to-bottom, first match wins
- `"*"` is catch-all, must be last
- Multi-rule dealers get one CSV sheet per rule (CSV_NEW, CSV_PO, CSV_CPO, etc.)
- Single-rule dealers get one sheet named CSV

### filtering_rules
- Lives in DEALERS tab col W (`FILTER_RULES: 22` in CFG object, 0-indexed)
- Applied at CAO pre-fill time AND at run-time step 8.5 in `runDealer`
- Run-time filtering works by building a VIN→scraperRow lookup from `scraperData` (already loaded), then running each ordered VIN through `applyFilteringRules_`. Filtered VINs are dropped from the array before the ORDERMATCH QUERY is written.
- Bypass checkbox in Run Dealer modal skips run-time filtering entirely
- Every dealer has an explicit JSON entry — no implicit defaults anywhere in the sheet
- Baseline for nearly all active dealers: `require_stock: true`, `exclude_status: ["OFFLOT"]`. Exceptions: SoCo DCJR has no `allowed_types`; BMW of West St. Louis omits `exclude_status`
- `require_price: true` currently only for Glendale CDJR

### VIN Log Architecture (redesigned May 2026)
- SF_VIN_LOGS tabs now have three columns: `ORDER_ID | VIN | committed_at`
- VINs are never written automatically during a run
- Produced VINs are stored in RUN_LOG col V (`produced_vins`) as a CSV string after each run
- RUN_LOG col W (`vin_log_status`) tracks lifecycle: blank = pending, `committed`, `rolled_back`
- Commit: appends VINs to SF_VIN_LOGS with a `committed_at` timestamp, marks RUN_LOG row
- Rollback key: deal ID + `committed_at` timestamp (unambiguous across multiple commit/rollback cycles)
- Managed via VIN Log Updater modal or the post-run "Add to VIN Log" button in Run Dealer modal
- **Manual entry path:** VINLogUpdater modal includes a collapsible manual entry panel (shown after dealer selection). Calls `getLatestOrderId(dealerKey)` on panel open to pre-populate the Order Number field (reads VIN log col A bottom-up — reflects manually-committed entries immediately). `manualCommitToVINLog(dealerKey, orderId, vins)` deduplicates and appends directly to SF_VIN_LOGS with a `committed_at` timestamp. No RUN_LOG row is created or modified. Intended for LIST orders and any manually-entered VINs with no corresponding run record.

### Run Dealer Modal (converted from sidebar May 2026)
- Modal at 580×600px (was sidebar at 300px fixed)
- **"Running as:" user dropdown** at the top — required field. Populated from `USER_PROFILES` tab in SF_DEALER_CONFIG. The last-used selection is persisted per Google account via `PropertiesService.getUserProperties()` and auto-selected on the next open. Run button is gated on a user being selected.
- Required Pipedrive Deal ID field — runs cannot be submitted without it
- **VIN Log status row (added June 2026):** appears after a dealer is selected — "Most recent order in log: {id}" via `getLatestOrderId`, plus a 📋 Update VIN Log button that opens the VIN Log Updater modal
- CAO pre-fill button: calls `getCaoVins(dealerKey)`, populates textarea, shows filter summary
- Bypass filters checkbox: amber when checked, skips step 8.5 in `runDealer`
- Real-time progress: polls `getRunProgress(runId)` every 1.5s via ScriptProperties
- Post-run actions: Open Output Folder button + Add to VIN Log button appear on success

### User Profiles & Per-User QR Base Path (added May 2026)
- **`USER_PROFILES` tab in SF_DEALER_CONFIG** — 3 columns: `user_key | display_name | qr_local_base_path`. One row per person who runs orders. Adding a new user requires only a new row — no code changes.
- `getQRBasePathForUser_(userKey)` reads the tab at run time and returns the path for the selected user. Ensures the path ends with the correct separator (backslash or forward slash, detected from the string).
- `getLastSelectedUser()` / `saveLastSelectedUser(userKey)` — persist and retrieve the last-used selection using `PropertiesService.getUserProperties()` (per-Google-account scope, so each user sees their own last selection).
- `getUserProfilesForModal()` — single round-trip bootstrap: returns both the profiles list and the last-used key for the modal to populate and pre-select the dropdown in one call.
- The `QR_LOCAL_BASE_PATH` global constant has been **removed**. `writeQRPaths_()` now takes `basePath` as a parameter threaded from `pasteVinsAndRun()` → `runDealer()` → `writeQRPaths_()`.
- If `userKey` is empty when `pasteVinsAndRun` is called, the run aborts immediately with a clear error before any work begins.

### Performance: getDealerScraperData_ (optimized May 2026)
- **Old:** `getRange(1, 1, lastRow, 21)` — read entire sheet (~120k+ cells on 5,000+ row dataset) → sidebar timeout
- **New (two-pass):** Read col T only first (single column, fast). Find first and last matching row index. Do one contiguous `getRange` on just that span. Final `.filter()` handles any non-contiguous edge cases.
- This is used in both `getCaoVins` (CAO pre-fill) and `runDealer` (order runs)

### ORDERS Sheet / getDealerScraperData_ Consistency
- `pasteVinsAndRun` uses `getActiveSpreadsheet()` to write VINs
- `getOrderVINs_` uses `getActiveSpreadsheet()` to read them back
- `SpreadsheetApp.flush()` called after write in `pasteVinsAndRun` before `runDealer` executes
- Using `openById` for MASTER_SHEET_ID in `getOrderVINs_` caused cross-instance cache inconsistency ("No VINs found" errors) — fixed by switching to `getActiveSpreadsheet()`

### Progress Tracking via ScriptProperties
- `runDealer` writes `{message, percent, done, error}` to ScriptProperties key `run_progress_{runId}` at each step
- Modal polls `getRunProgress(runId)` every 1.5 seconds while the server function is executing
- Works because PropertiesService writes from one GAS execution are immediately visible to concurrent executions
- All `setProgress_` calls are no-ops when `runId` is null — direct script editor calls are unaffected
- `clearRunProgress(runId)` called by modal after receiving `done: true`

### NormManager UI
- Modal dialog, not sidebar. Sidebars hard-capped at 300px by Google.
- Table scroll requires JS height calculation (`sizeTable()`) — GAS iframe CSS flex height propagation is broken.
- All five maps support ▲▼ reordering. Changes write directly to NORM_MAPS sheet — no save step.

### ScraperImport (converted from sidebar to modal, May 2026)
- Now a modal at 620×580px. Was a sidebar at 340px.
- Same logic throughout: CSV parser, column mapping, `importScraperData()` call, post-import review panel all unchanged.
- Layout updated to modal flex-column pattern: pinned header, scrollable body, fixed footer with status bar + Import button.
- Column mapping preview redesigned from a monospace scroll box to a two-column ✓ Matched / ✗ Missing grid.
- `openScraperImport()` in Code.gs: replaced `showSidebar()` with `showModalDialog()`, dropped `.setTitle()`, updated dimensions.

### Health Monitoring & Live Dashboard (added June 2026, branch `feature/health-monitoring`)
- **`IMPORT_STATS` tab** (SF_SYSTEM_MASTER, 13 cols A–M): `timestamp | scraper_location | total | new | po | cpo | cpo_el | other_types | onlot | offlot | other_status | no_price | no_stock`. One row per location per import, appended by `writeImportStats_()` (Section 29).
- **`checkImportHealth_()`** builds per-location rolling baselines from IMPORT_STATS and returns `[{location, severity, message}]`. Hard errors: total → 0 with prior data; `no_stock`/`no_price` > 20% (`MISSING_FIELD_THRESHOLD = 0.20`). Baseline warnings (need ≥ 5 prior rows, `MIN_IMPORTS_FOR_BASELINE`): total/new/po > 40% below average (`DROP_THRESHOLD = 0.40`); unexpected type. Under baseline → `info` "Building baseline". Rendered in ScraperImport review panel health section.
- **`ORDER_STATS` tab** (12 cols A–L): `timestamp | dealer_key | dealer_name | order_id | vins_ordered | vins_matched | vins_produced | match_rate | new | po | cpo | cpo_el`. Side-written by `writeRunLog_()` in its own try/catch (non-fatal). Flat analytics table — ports directly to Postgres in V3.
- **`DASHBOARD` tab** rewritten by `refreshDashboard_()` (Section 30) at the end of every `importScraperData()`: alphabetical per-location inventory snapshot (10 cols, rows 6+), TOTALS row, then RUN LOG SUMMARY / MOST RECENT RUN / RUNS BY DEALER sections at **dynamic row positions** below the table. RUNS BY DEALER = QUERY over `RUN_LOG!A:W` grouped by dealer. All formulas IFERROR-wrapped; stale rows cleared; **no merged cells** (merged cells broke section repositioning); constants `DASHBOARD_LOCATION_START_ROW = 6`, `DASHBOARD_MAX_LOCATIONS = 60`. Non-fatal.
- **BILLING fifth section:** `── PRODUCED VINS (N) ──` header in col B below Total Duplicates, one VIN per row (ORDERMATCH col E, dupes included; B20 on a clean run).
- **`getRunsForDealer` fixed** to read the full 23-column RUN_LOG (V = produced_vins, W = vin_log_status); previously read only 19 columns.

### Dealer Rules Editor (added May 2026)
- Modal at 680×660px. Menu item: **SilverFox V2 → Edit Dealer Rules...**
- Two independent tabs — each has its own Save button. Switching tabs does not discard unsaved changes.
- **Type Rules tab:** Displays `type_rules` (col O) as ordered cards with match badge, CSV schema, and UTM. ▲▼ reorder buttons (first-match-wins). Remove per rule. Add-rule form: match dropdown (`New`, `PO`, `CPO`, `CPO-EL`, `*`), CSV schema dropdown loaded live from CSV_SCHEMAS tab at open time (no hardcoding), UTM text input. Adding a non-catch-all rule auto-inserts before any existing `*` rule to preserve order safety.
- **Filtering Rules tab:** GUI for `filtering_rules` (col W). Toggle switches for `require_stock`/`require_price`. Colored pill buttons for `allowed_types` (green=New, orange=PO, purple=CPO, blue=CPO-EL) and `exclude_status`. Min/max price number inputs. Per-type seasoning table with add/remove rows.
- **`getRulesEditorBootstrap()`** — single round-trip on modal open. Returns active dealers list AND all CSV schema keys from CSV_SCHEMAS tab. Schema keys are never hardcoded.
- **`getDealerRulesData(dealerKey)`** — returns `{dealerName, typeRules, filteringRules}` as parsed objects. Safe defaults on JSON parse failure (empty array / empty object).
- **`saveDealerTypeRules(key, json)`** — validates JSON, writes to DEALERS col O (CFG.TYPE_RULES + 1).
- **`saveDealerFilterRules(key, json)`** — validates JSON, writes to DEALERS col W (CFG.FILTER_RULES + 1).
- Both save functions scan DEALERS rows by `dealer_key` to find the right row — safe even if row order changes.

### TRANSCRIPTION Sheet (updated May 2026)
- No longer uses Apps Script function. `runTranscriptionCheck()` removed.
- Col B now has live ARRAYFORMULA: `=ARRAYFORMULA(IF(A2:A="","",IF(COUNTIF(SCRAPERDATA!A:A,A2:A),"Found","Not Found")))`
- Updates in real time as VINs are typed — no button press needed

---

## ORDERMATCH Column Layout (Current)

| Col | Index | Header | Source |
|---|---|---|---|
| A–I | 1–9 | YEAR/MAKE/MODEL/TRIM/VIN/STOCK/TYPE/PRICE_RAW/URL | QUERY spill zone — never write to template |
| J | 10 | QR_PATH | Script-written |
| K | 11 | YEARMAKE | ARRAYFORMULA |
| L | 12 | YEARMODEL | ARRAYFORMULA |
| M | 13 | MAKE_MODEL_COMBINED | ARRAYFORMULA |
| N | 14 | TYPESTOCK *(QRSTOCK field code maps here)* | ARRAYFORMULA — CPO-EL/CPO/New/PO type prefix + stock |
| O | 15 | MISC | ARRAYFORMULA |
| P | 16 | PRICE_FMT | ARRAYFORMULA |
| Q | 17 | NEWYEARMAKE | ARRAYFORMULA |
| R | 18 | TYPEVIN | ARRAYFORMULA — type prefix + VIN |
| S | 19 | YEARMODELSTOCK | ARRAYFORMULA — YEAR MODEL - STOCK |
| T | 20 | PRICE_PLUS_2000 | ARRAYFORMULA — `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(H2:H="*","*","$"&TEXT(H2:H+2000,"#,##0"))))` (live; GLENDALE_COMBINED) |

**TYPESTOCK formula (N2):**
```
=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(ISNUMBER(SEARCH("CPO-EL",G2:G)),"CPO-EL - ",IF(ISNUMBER(SEARCH("CPO",G2:G)),"CPO - ",IF(ISNUMBER(SEARCH("New",G2:G)),"NEW - ","USED - ")))&UPPER(F2:F)))
```

---

## RUN_LOG Column Layout (Current — 23 columns, A–W)

| Col | Header | Description |
|---|---|---|
| A | `run_timestamp` | Run start time |
| B | `dealer_key` | DEALER_KEY |
| C | `dealer_name` | Human-readable name |
| D | `order_id` | Pipedrive Deal ID (required, entered in modal) |
| E | `total_ordered` | VINs submitted |
| F | `total_matched` | VINs matched in scraper |
| G–J | `total_new` / `total_po` / `total_cpo` / `total_cpo_el` | Per-type gross counts from BILLING |
| K–N | `new_dupes` / `po_dupes` / `cpo_dupes` / `cpo_el_dupes` | Per-type duplicate counts from BILLING |
| O | `total_dupes` | Sum of duplicates |
| P | `total_produced` | Total produced (= matched) |
| Q | `qr_codes_generated` | (currently blank) |
| R | `output_doc_id` | Drive ID of output doc |
| S | `run_duration_sec` | Seconds |
| T | `errors` | Error messages if any |
| U | `notes` | Manual notes |
| V | `produced_vins` | CSV string of all produced VINs (from ORDERMATCH col E) |
| W | `vin_log_status` | blank / `committed` / `rolled_back` |

> Expanded 19 → 23 columns May 2026. Pre-expansion rows have blanks/#VALUE! in new columns — historical artifact only.

---

## Dealer Config State (Key Dealers)

### type_rules (all using post-normalization values)

| Dealer | type_rules summary |
|---|---|
| Auffenberg Hyundai | PO → SCP |
| Bommarito Cadillac | New → SCP_NEW, PO → SCP, CPO → SCP |
| CDJR of Columbia | New → SC, PO → SCP, CPO → SCP |
| Mercedes-Benz of Creve Coeur | CPO-EL → SC, CPO → SC, PO → SCP |
| Serra Honda | New → SC, PO → SCP (+ 7-day **PO** seasoning in filtering_rules) |
| Glendale CDJR | * → GLENDALE_COMBINED |
| Dave Sinclair Lincoln | * → SCWSB (windshield-only schema) |
| Mazda of Columbia | * → SCP (used-only via filtering_rules; Pipedrive IDs) |
| Most others | * → SCP (catch-all) |

### scraper_location_name notes
- Serra Honda: `Serra Honda O'Fallon` (not "Serra Honda")
- Bommarito Cadillac: location column reads "Bommarito St. Peters"

### filtering_rules notable entries
- Nearly all active dealers: `require_stock: true`, `exclude_status: ["OFFLOT"]` (exceptions: SoCo DCJR no `allowed_types`; BMW West STL no `exclude_status`)
- Serra Honda: `seasoning: [{"type":"New","days":0},{"type":"PO","days":7},{"type":"CPO","days":0}]` — **PO is seasoned, not New**
- Glendale CDJR: `require_price: true` (only dealer with this enabled)
- MBCC: `allowed_types: ["PO","CPO","CPO-EL"]`
- Inactive legacy dealers: `{}` (empty JSON, no restrictions)

### ORDERS column mapping
A–AP, 42 dealers. Mazda of Columbia added at AP (June 2026). B1 = "CDJR of Columbia".

### Dealer counts (verified June 10, 2026)
42 configured rows in DEALERS; **28 active** (`active=TRUE`); 14 inactive (mostly "Scraper #N/A").

---

## Known Bugs & Pending Work (Priority Order)

### Active Design Issues
1. **Maintenance and Hybrid order types** — Two-stream (CAO + manual) modal UI not built. Core merge logic is documented and designed. The CAO automation infrastructure is now in place; the modal additions are the remaining work.
2. **Auffenberg Hybrid config** — Needs two-stream modal support and `type_override: "used"` on manual stream (Courtesy Loaners listed as New in scraper, must print/bill as Used).
3. **MBCC/Sprinter shared inventory** — Two dealers share one scraper location. Need separate billing outputs. Option A (two separate order runs, user splits VINs) vs Option B (one run, two billing outputs). Decision pending.
4. **Stock→VIN fallback** — No dealer uses `use_stock_not_vin`; VIN is always the primary key. Planned: if an ordered identifier isn't in the VIN column, look it up in the Stock column and substitute the matching VIN. Not yet implemented.
5. **`model_trim_split` config key inert** — present in Glendale's `data_transforms` JSON but ignored by `applyDataTransforms_` (only `replacements` is read). Implement or remove.
6. **Stale dealer notes** — Hyundai/Nissan of Jefferson City notes say "Scraper #N/A — inactive" but both are active with live feeds.

### Housekeeping
- Fix `#ERROR!` cells in README tabs (cosmetic)
- Delete `VINLogMigration.gs` and `FolderSetup.gs`
- Fix legacy field names in `_CONFIG_CACHE` row 1 (cosmetic)
- Run `addCommittedAtHeaders()` once if not already done (adds `committed_at` to all SF_VIN_LOGS tabs)
- Delete `test-write-access.txt` from the GitHub repo root (`git rm` locally and push)

---

## V2 Development Priority Order (Updated)

1. ✅ **CAO automation** — implemented. `getCaoVins`, filtering_rules, pre-fill button.
2. ✅ **filtering_rules per dealer** — implemented. Col W in DEALERS. Applied at pre-fill and run time.
3. ✅ **Run Dealer modal** — implemented. Replaced sidebar. Deal ID required. Progress bar. Post-run actions.
4. ✅ **VIN log commit/rollback** — implemented. VIN Log Updater modal. RUN_LOG produced_vins + status.
5. ✅ **Dealer Rules Editor modal** — implemented. GUI editor for type_rules and filtering_rules. Live schema loading. Independent save per tab.
6. ✅ **ScraperImport modal conversion** — implemented. Replaced sidebar. Two-column column mapping preview.
7. ✅ **Multi-user QR base path** — implemented. USER_PROFILES tab in SF_DEALER_CONFIG. "Running as:" dropdown in Run Dealer modal. Per-user path resolved at run time; last selection persisted per Google account.
8. ✅ **Health monitoring + dashboard** — implemented (June 2026). IMPORT_STATS/ORDER_STATS logging, `checkImportHealth_` anomaly detection, DASHBOARD auto-refresh on every import.
9. **Maintenance/Hybrid order types** — next priority. Two-stream modal UI, merge logic, bucket review.
10. **MBCC/Sprinter billing split** — requires design decision first.
11. ✅ **Glendale price+$2,000** — implemented. `PRICE_PLUS_2000` field code live at ORDERMATCH col 20 (T), used by GLENDALE_COMBINED schema.
12. **Stock→VIN fallback lookup** — planned (see Active Design Issues #4).

---

## V2 → V3 Feature Port List (for when V3 resumes)

Features now built in V2 that will need porting to V3:
- CAO automation with filtering_rules
- filtering_rules engine (allowed_types, exclude_status, require_stock, require_price, seasoning, min/max price)
- GUI-based rules editor for type_rules and filtering_rules (live schema loading from config tab)
- VIN log commit/rollback with produced_vins in run log
- Real-time progress tracking (WebSocket in V3 vs ScriptProperties in V2)
- Bypass filters option
- Two-pass SCRAPERDATA read optimization
- Run Dealer modal feature set (deal ID, post-run buttons)
- **Per-user QR base path** — V2 uses USER_PROFILES tab + "Running as:" modal selector. V3 design already calls for a `qr_base_path` field on the user profile model — this V2 implementation validates that design and the UI pattern.
- Skip VIN logging toggle
- NEW→USED type bypass (Hybrid manual stream)
- Two-phase review modal with bucket breakdown
- CSV VIN upload
- Detailed order summary
- **Import health monitoring + run analytics** — IMPORT_STATS and ORDER_STATS are deliberately flat, formula-free tables that map 1:1 to Postgres tables (`import_stats`, `order_stats`); `checkImportHealth_` thresholds (`MIN_IMPORTS_FOR_BASELINE`, `DROP_THRESHOLD`, `MISSING_FIELD_THRESHOLD`) become config values
- **Live operations dashboard** — V2's DASHBOARD (inventory snapshot + run summaries) becomes a React dashboard view backed by the analytics tables

---

## Key Technical Gotchas

1. **GAS modal iframes ignore CSS flex height** — use JS to calculate and set explicit pixel height for scrollable containers. `min-height: 0` does not work.

2. **QUERY mixed-type column bug** — if a column contains both numeric and string values, QUERY silently drops the minority type. Always force `@` number format + explicit `String()` conversion on VIN and Stock before any `setValues()`.

3. **QUERY spill zone** — ORDERMATCH cols A–I are populated by the QUERY formula spill. Nothing should be written to these columns in the template.

4. **type_rules match is substring search** — `SEARCH("CPO", "CPO-EL")` returns a match. Always check more specific strings first (CPO-EL before CPO).

5. **Google Sheets `getValues()` returns booleans as JS booleans** — `TRUE`/`FALSE` cells come back as `true`/`false`, not strings. Use `isTrue_(val)` helper.

6. **`@` format must be set before AND after `setValues()`** — Sheets may re-interpret cell types at write time. Belt-and-suspenders required for reliable plain text storage.

7. **Apps Script 6-minute execution limit** — parallel QR generation via `UrlFetchApp.fetchAll()` is critical. 50-vehicle order: ~3–5 seconds vs. 100+ seconds with sequential `sleep(2000)`.

8. **`openById` vs `getActiveSpreadsheet()` consistency** — functions that write and immediately read back from SF_SYSTEM_MASTER must use `getActiveSpreadsheet()` for both operations, not mix the two. Cross-instance cache can cause reads to miss recently written data even with `flush()`.

9. **PropertiesService concurrency** — ScriptProperties writes from one GAS execution are visible to other concurrent executions bound to the same script. This enables the progress polling pattern (modal polls while `runDealer` runs).

10. **`google.script.run` silent failure** — calling a non-existent or private (underscore-suffixed) function via `google.script.run` fails silently — no error, no success, the spinner just hangs forever. Always verify function names are public and match exactly.

11. **Large SCRAPERDATA reads** — at 5,000+ rows, reading the full 21-column sheet (~120k cells) via `getRange(1, 1, lastRow, 21)` reliably times out in sidebar/modal calls. Always use the two-pass approach: read col T only to find row range, then read matching span only.

---

## V3 Development Path Decision (Unresolved)

Option A: Continue with Flask (existing codebase, faster to production)
Option B: Pivot to FastAPI + React (cleaner architecture, better for config management UI)

Decision should be made before Phase 3 config management UI work. Both options share the same PostgreSQL schema and business logic (`correct_order_processing.py`).

---

## Dealer Account Catalog — Key Facts

Full catalog in `SilverFox_Dealer_Account_Catalog.md`. Critical nuances:

- **Auffenberg Hyundai** — Hybrid order type. CAO for used vehicles. Manual stream for Courtesy Loaners (listed as New in scraper, must print/bill as Used). Type override = "used" on manual stream. Not yet implemented in modal.
- **BMW of West St. Louis** — LIST only, always manual VIN entry.
- **Bommarito Cadillac** — Location column reads "Bommarito St. Peters". New + Used. LIST.
- **BMW of Columbia** — reads LINKBUILDER col C instead of B. CAO.
- **Serra Honda** — AutoFi QR URL format (`utm_base_url_override`). New → SC, PO → SCP. 7-day seasoning on **PO** (New and CPO: 0 days). `scraper_location_name` = `Serra Honda O'Fallon`.
- **MBCC** — Used→SCP, CPO→SC, CPO-EL→SC. Shares scraper location with Sprinter of Creve Coeur. Billing split unresolved.
- **Glendale CDJR** — `require_price: true`. `data_transforms` for Jeep model/trim splits (Wrangler Unlimited, Grand Cherokee L, Wagoneer L, Grand Wagoneer L). Price+$2,000 **live** via PRICE_PLUS_2000 in GLENDALE_COMBINED. `allowed_types: ["PO","CPO"]`.
- **Dave Sinclair Lincoln** — unique template: SC windshield banner only, no Shortcut. Price column blank (site doesn't display pricing).
- **CDJR of Columbia** — VIN log tab renamed to `CDJR_OF_COLUMBIA` ✓. `scraper_location_name` remains "Joe Machens Chrysler Dodge Jeep Ram" (matches live scraper feed — do not change until the scraper is updated).
- **Mazda of Columbia** — added June 2026 (42nd dealer). ORDERS col AP. Used-only. Pipedrive deal IDs. * → SCP.
