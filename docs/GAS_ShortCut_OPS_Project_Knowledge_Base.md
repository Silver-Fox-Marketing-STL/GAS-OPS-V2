# SilverFox Marketing — GAS ShortCut OPS Project Knowledge Base
### Compressed Reference | Last verified against live system: June 25, 2026

This document distills all critical decisions, architecture, bugs, and context from the full project history. It is the primary memory document for continuing development.

> **Deploy status is tracked by `clasp push`, not by branch.** "Live" = pushed to the bound Apps Script project (deploy = the separate `clasp push` step, not a git merge to `main`). The system formerly versioned **SilverFox V2 (1.0–2.13)** is now released as **GAS ShortCut OPS 1.0** (June 25, 2026), with `main` as the deployed production baseline. The **Pipedrive integration** (Code.gs Section 31, v2.12), the **Lot Sherpa theming**/dark-mode redesign, the **Dealer Rules "Discard Changes"** button, the **tabbed Dealer Rules editor + newest-first Transcription**, and the **import-health fixes** are all on `main` and deployed. See **Deploy State Snapshot** below.

---

## System Hierarchy

| System | Status | Platform |
|---|---|---|
| **Legacy V1** | Legacy predecessor — superseded | Google Sheets + Apps Script (~42 per-dealer functions) |
| **GAS ShortCut OPS 1.0** | **Production (released June 25, 2026)** | Google Sheets + Apps Script (config-driven, universal; the **SilverFox App** single-modal SPA) |
| **V3 (future)** | Long-term, paused | **FastAPI + React + PostgreSQL** (decision made — see V3 Direction) |

GAS ShortCut OPS 1.0 (formerly SilverFox V2, 1.0–2.13) is the deployed production system, superseding legacy V1. V3 development is paused until later; when it resumes it is a **greenfield FastAPI + React build with the GAS ShortCut OPS config model as the canonical spec** — *not* an extension of the old Flask prototype (see **V3 Direction (Decided)** at the bottom).

---

## Deploy State Snapshot (June 25, 2026)

**Live (deployed to the bound Apps Script via `clasp push`, on `main`):**
- Universal script + template; config-driven dealers; master VIN log; parallel QR generation
- The **SilverFox App** single-modal SPA (`App.html` + `View*.html` fragments) — replaced the five standalone modals
- Multi-file import + Replace/Merge + VIN conflict engine (v2.8)
- Billing split — `billing_split` (v2.9); MBCC/Sprinter resolved
- Post-run finalization — deferred deal IDs, `pendingRuns`, `finalizeRun`, `abandonRun` (v2.10)
- **Targeting Rules engine** — `targeting_rules` (IF nested AND/OR THEN action), replaced the flat `conditions` array (v2.11, June 17)
- **Data Sources v2** — header mapping, multiple named sources, append-only schema growth (v2.11, June 17)
- Source split — `source_split` (Frank Leta dual-site), one order → two CSVs
- Health monitoring + live DASHBOARD; in-app Transcription tab; Home dashboard render
- Performance sweep — `getAppBootstrap`, `getMasterSS_`/`getVinLogsSS_` handle caches, `waitForRecalc_` polling, parallel QR uploads + `trashFilesParallel_`, batched DASHBOARD formatting
- **Pipedrive integration (v2.12, merged to `main` June 24)** — Code.gs **Section 31** (+ the stacked sub-branches `feature/pipedrive-finalize-flow`, `feature/pipedrive-install-cost`, `feature/pipedrive-followups`, `feature/pipedrive-billing-pdf`, `feature/product-driven-schema`). Push a finalized run as a deal with per-type product line items. The code is deployed; it **activates per dealer** once its live config is filled in (ScriptProperties secrets + `PIPEDRIVE_SETTINGS` rules + per-dealer `PIPEDRIVE` rows, incl. the product map — now the **sole per-type config**, which retired `type_rules` from the run).
- **Dynamic vehicle-type registry (v2.13, merged to `main` June 25)** — built-ins + user-added types, dynamic billing/analytics; fail-safe to the canonical four.
- **Lot Sherpa theming** — CSS design-token system + light/dark theme, plus two import-health fixes (deterministic baseline flush + smarter "missing location" check).
- **Dealer Rules "Discard Changes"** button.
- **Tabbed Dealer Rules editor + newest-first Transcription** (commit `2cfedc1`).

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

Code lives in GitHub: `Silver-Fox-Marketing-STL/GAS-OPS-V2`. `Code.gs` (~7,160 lines; Section 31 = Pipedrive integration) + the App HTML files (below). clasp script ID: `1E5aTcofzWzJZssOikaf6lFytS92vRHmj-k1NDV0C_Xu7NoJk7VUEjtNO`. `main` is the single deployed/integration branch (`feature/health-monitoring` merged June 2026).

---

## The SilverFox App (single-modal SPA) — added June 2026, branch `feature/app-shell` (LIVE)

The five standalone modals (Run Dealer, Import, VIN Log Updater, Dealer Rules, Normalization) were converted into **view fragments inside one modal SPA**. The menu now has one primary item — **🚀 Open SilverFox** (`openApp`) — plus a "Classic menu (deprecated)" submenu fallback.

### Shell & navigation
- **`openApp()`** evaluates `App.html` as an HtmlService **template** (first use of `<?!= include_('ViewXxx') ?>` scriptlets via the `include_(name)` helper) at 1400×900 (`MODAL_WIDTH`/`MODAL_HEIGHT`). The shell = left **sidebar** (Home, Run Order, Transcription, Import Data, VIN Logs, + a collapsible **System Settings** group: Dealer Rules, Normalization, Data Sources, Pipedrive Settings, + Utilities, Close), a header title, and a content area.
- **Navigation is instant client-side show/hide** (`navTo`) — **hidden views retain full DOM + JS state**: live progress polling, pending finalization cards, dirty flags, and a Run→VIN-Logs cross-view jump all survive switching views (the old per-dialog swap destroyed that state). Views lazy-initialize on first visit via the `VIEW_INITS` registry; `VIEW_SHOWN` re-runs per visit (e.g. table sizing, Home dashboard reload).
- **`openViewStandalone_(fragmentName, title)`** serves any single fragment inside `Classic.html` as a standalone dialog — powers the Classic fallback menu with zero duplication (delete with the menu at validation sign-off).

### Files (HTML)
- `App.html` — shell + templating + sidebar nav (`toggleSettingsGroup` for the System Settings group).
- `SharedUtils.html` — shared `escHtml`, `toast`, `AppGuards` (close guards), `AppBusy` (mutual-exclusion flags), the view registries, **and (branch-only) the design-token CSS + `Theme` helper**. **Included FIRST** by both shells so parse-time registrations and tokens reach every view.
- View fragments (renamed from the old modals): `ViewRun` (was DealerSelector), `ViewImport` (ScraperImport), `ViewVinLog` (VINLogUpdater), `ViewRules` (RulesEditor), `ViewNorm` (NormManager). New views: `ViewHome` (workflow cards + live DASHBOARD render), `ViewTranscription`, `ViewUtilities`, `ViewDataSources`, and (branch-only) `ViewPipedriveSettings`.
- `Classic.html` — standalone single-view wrapper for the deprecated fallback menu.

### SPA invariants / gotchas (also in LEARNINGS)
- `.view[hidden]{display:none !important}` — authoring `display:flex` on a view root would defeat the UA `[hidden]` rule.
- **All fragments parse into ONE shared global JS scope** — a duplicate **top-level** `function name()` in two fragments silently clobbers (last-loaded wins). Defense: **prefix per-view helpers** (`ps*` / `tr*` / `pd*` / view-name-prefixed ids) or factor one shared implementation. Nested functions are safe. `App.html` and `Classic.html` are separate entry points (never co-loaded).
- Height math measures the **view container**, never `window.innerHeight`; element queries are **view-scoped** (a global `.top-bar` query would match other views in the shared DOM).
- Never assign `window.onresize` from a fragment (single-owner slot) — use `addEventListener`.
- Operations that were implicitly exclusive as separate dialogs (import vs run) now need explicit **`AppBusy`** mutual exclusion (an import rewrites SCRAPERDATA mid-run).
- `SpreadsheetApp.getUi().alert()` **fails via `google.script.run`** — server fns that report to the App must **return** a message for the client to toast; the menu/classic wrappers keep alerts. Hence the `*Core_` (shared impl) / `app*` (returns `{message}`) split: `eraseAllQRFoldersCore_`/`appEraseAllQRFolders`, `cleanUpOutputDocsCore_`/`appCleanUpOutputDocs`, `refreshNormReferenceCore_`/`appRefreshNormReference`, plus `appOpenRunLog`.

### App bootstrap & per-view data
- **`getAppBootstrap()`** — single round-trip: `{dealers, users, appTheme}` (active dealers incl. `splitDealLabel`, user profiles + last-used). Prefetched once per session into a client `AppData` latch (SharedUtils); Run Order and VIN Logs populate from it instead of firing separate cold-start executions.
- **Home HUD (Code.gs Section 34, July 10, 2026)** — `getDashboardView()` (the old whole-DASHBOARD-grid read) is **retired** (zero callers). Home now calls three read-only endpoints: **`getHomeHud()`** (today/this-week/all-time run stats from one filtered RUN_LOG read), **`getDealerSummary(dealerKey)`** (per-dealer inventory + run stats + latest run + EOM open-order count, each section fail-soft null on its own failure), and **`getInventorySnapshot()`** (slices the DASHBOARD sheet's inventory block — now rendered on the **Import Data** view instead of Home). Home reloads `getHomeHud()` (+ the picked dealer's summary) on every visit (`VIEW_SHOWN` + a Refresh button). The DASHBOARD sheet and `refreshDashboard_` are unchanged.
- **`getTranscriptionVins()`** — `{vins, count, lastImport}`: deduped, upper/trim-normalized set of all SCRAPERDATA col-A VINs. The **Transcription view** loads it once into a client `{VIN:1}` index and checks typed VINs **instantly per keystroke** (the in-app mirror of the TRANSCRIPTION sheet's Found/Not-Found ARRAYFORMULA).

---

## Critical Architecture Decisions

### Normalization
- **Post-normalization type values are `New`, `PO`, `CPO`** — never `Used`, `Certified`, etc.
- **CPO-EL is NOT normalized** — MBCC's scraper sends `CPO-EL` raw and it passes through unchanged. Always check it **before** `CPO` in any SEARCH/IF chain ("CPO" is a substring of "CPO-EL").
- **NORM_MAPS sheet is the live source of truth.** The hardcoded `NORMALIZATION_MAPS` constant in Code.gs is fallback only.
- **Normalization runs twice:** in `importScraperData()` on the master SCRAPERDATA, and in `pasteScraperData_()` when copying to the output doc. `normalizeScraperData_()` builds an O(1) lowercase hash via `buildNormLookup_()` once, then `normalizeCell_(value, lookup)` per cell.

### Stock Number Type Bug (fixed)
- **Root cause:** Purely numeric New stock numbers (`262677`) auto-convert to number type; alphanumeric Used/CPO stocks (`262617A`) stay strings → QUERY sees mixed types and silently drops the minority.
- **Fix:** `importScraperData()` and `pasteScraperData_()` both `String()`-convert VIN (idx 0) and Stock (idx 1) AND set `@` number format **before AND after** `setValues()`.

### Field Code System
- **`FIELD_TO_COL` in Code.gs is the only runtime mapping.** FIELD_CODES tab + ORDERMATCH headers are documentation only.
- **`buildCSVSheet_` reads 100 columns** from ORDERMATCH — new field codes through col CV need no read-range change.
- `dedupFieldCodeHeaders_()` suffixes a repeated field code in the CSV header (`YEARMODELSTOCK`, `YEARMODELSTOCK2`, …) so Illustrator can link each graphic independently; data rows still both pull from the same mapping.
- **Current FIELD_TO_COL:** YEAR:1, MAKE:2, MODEL:3, TRIM:4, VIN:5, STOCK:6, TYPE:7, PRICE_RAW:8, @QR:10, @QR2:10, YEARMAKE:11, YEARMODEL/QRYEARMODEL:12, MAKE_MODEL_COMBINED:13, QRSTOCK:14, MISC:15, PRICE_FMT:16, NEWYEARMAKE:17, TYPEVIN:18, YEARMODELSTOCK:19, PRICE_PLUS_2000:20, PRICE_TAGLINE:21

### type_rules → product map (v2.12: col O is DORMANT)
- **The per-type output config now lives in the Pipedrive `product_map`, not `type_rules` (col O).** The run builds synthetic rules from the product map (`buildTypeRulesFromProductMap_`); a matched type missing a product/schema **blocks the run** — there is **no `*` catch-all** any more. See *Pipedrive → Product map = the sole per-type config*. The historical `type_rules` table below records the old (now-migrated) per-type config.
- Per-type matching is still post-normalization `New`/`PO`/`CPO`/`CPO-EL`, first-match-wins, **CPO-EL before CPO** (substring trap).
- Multi-schema dealers → one CSV sheet per resolved schema (`CSV_NEW`, `CSV_PO`, `CSV_CPO`, …); a single schema → one sheet `CSV`.

### filtering_rules (col W; `FILTER_RULES: 22`, 0-indexed)
- Applied at CAO pre-fill **and** run-time step 8.5 in `runDealer` (build a VIN→scraperRow lookup, run each ordered VIN through `applyFilteringRules_`, drop filtered VINs before the ORDERMATCH QUERY). Bypass checkbox skips step 8.5.
- Every dealer has an explicit JSON entry — no implicit defaults. Baseline: `require_stock: true`, `exclude_status: ["OFFLOT"]`. Exceptions: SoCo DCJR no `allowed_types`; BMW West STL omits `exclude_status`. `require_price: true` only Glendale CDJR + Dean Team Brentwood.
- Flat keys: `allowed_types`, `exclude_status`, `require_stock`, `require_price`, `require_url` (reject blank/`*` Vehicle URL → reason `no_url`), `min_price`/`max_price`, per-type `seasoning`.
- Parsed by `getDealerFilterRules_(config)` → structured object with safe defaults (incl. `targetingRules`, `caoExcludeTypes`). Rejection reasons: `no_stock`, `no_price`, `no_url`, `type`, `status`, `price_low`, `price_high`, `seasoning`, `cao_excluded`, `rule:exclude_order`, `rule:exclude_cao` (CAO summary tallies dynamically).

### Targeting Rules engine — `targeting_rules` *(deployed June 17, 2026; REPLACED the flat `conditions` array)*
> The old `conditions` array + `FILTER_FIELD_INDEX` are **gone**. A not-yet-migrated dealer's legacy `conditions` key is dropped on load so it can't round-trip as inert passthrough. Migration JSON + rollback: `docs/targeting_rules_migration.md`.

- **Shape:** `targeting_rules` is an array of `{action, group}`. `group` = `{ match:"all"|"any", children:[ {field, op, values} | nested group ] }` — so `(A AND B) OR C` is expressible. `match:"all"` = AND, `"any"` = OR.
- **Actions (`TARGETING_ACTIONS`):**
  - `drop_on_import` — at IMPORT, drop the row before dedup, scoped to the dealer's Location (`getImportDropLocations_`/`dropRowsOnImport_`); never enters SCRAPERDATA. (Used to drop subprime cars from a direct feed; import review reports the dropped count.)
  - `exclude_cao` — skipped during CAO auto-fill only (still prints when entered manually).
  - `exclude_order` — skipped during CAO **and** order runs (Bypass overrides).
- **Field** = **any data schema column** (key), mapped to its SCRAPERDATA index by the cached, schema-driven **`getFilterFieldIndex_()`** (replaced the static `FILTER_FIELD_INDEX`), so a rule can target columns added via the Data Sources screen. `getRulesEditorBootstrap` surfaces the schema fields + ops + actions to the Rules editor so UI and engine can't drift.
- **Ops:** `in`/`not_in`/`contains`/`not_contains` (string, case-insensitive; `contains`/`not_contains` match **any** value — OR), `gte`/`lte`/`gt`/`lt` (numeric; price-safe — strips `$`/`,`). `gt`/`lt` were added for this model; the old `drop_on_import` operator was removed (now an action).
- **Engine:** `conditionMatches_` (leaf predicate) → `groupMatches_` (recursive AND/OR; empty group → false) → `ruleMatches_`. **`applyFilteringRules_(vehicles, filterRules, phase)`** runs `exclude_order` in both phases + `exclude_cao` in CAO only.
- **FAIL-SAFE (note the polarity flip from `conditions`):** a rule fires an **exclusion** when it matches, so every predicate fails to **no-match** on misconfig (unknown field/op, empty values, unparseable number, empty group) → the rule does **not** fire → the vehicle is **kept**. A config typo can never silently mass-exclude a dealer. *(The old `conditions` were inclusion filters and failed OPEN — same real-world outcome: keep the car. The lesson: pick the failure value by what it does — keep the car — not a fixed boolean.)*
- **Migrated dealers (June 17):** Pundmann Ford, Bommarito Cadillac, Dave Sinclair St. Peters, Frank Leta Honda (behavior-preserving). Mazda untouched (`cao_exclude_types` only).
- **`cao_exclude_types`** (unchanged by the overhaul) — a simple set of pills: types removed from CAO auto-fill only; keep the type in `allowed_types` so manual runs aren't blocked. Coexists with the more capable `exclude_cao` action (pills = easy path; rule builder = advanced).
- **Make/Model are RAW (un-normalized)** in SCRAPERDATA — for make/model targeting prefer `contains` and list keyword variants (`F-250` *and* `F250`); `in` is brittle against feed inconsistency.

### Billing split — `billing_split` *(v2.9, June 12; LIVE)*
One scraper feed serving **two billing accounts** (e.g. MBCC cars vs Sprinter/Metris vans): **one run, one CSV (one Illustrator setup), two billing sheets, two deals.**
- Optional key in `filtering_rules`: `{group_name, deal_label, field, op, values}`. `field` ∈ `model/make/trim/type` — **ORDERMATCH vehicle keys** (billing-time classification, deliberately *not* `getFilterFieldIndex_`). `op` ∈ `contains`/`in` (case-insensitive, OR). Parsed by **`getBillingSplit_`** (fail-safe: absent/malformed → identical to a normal run).
- **`writeBillingSheet_(outputDoc, billingSplit)`** partitions matched vehicles via **`isInBillingGroup_`**; the five-section layout is extracted into **`renderBillingSheet_(sheet, …)`** and rendered as **BILLING** (primary; group units excluded; carries the not-found list) + **BILLING_<group>** (created on demand via `insertSheet` — template untouched). Sums = old single-sheet totals. **`readBillingTotals_(outputDoc, sheetName?)`** reads either.
- **Two RUN_LOG rows** per split run (same `output_doc_id`/dealer_key; notes col U = `SPLIT:PRIMARY` / `SPLIT:<group>`), each its own deal ID + per-account totals + produced VINs. Zero group units → second row skipped (note `split: 0 <group> units`). ORDER_STATS gets one row per account. Commit/rollback per account works against the **single** dealer VIN tab. Split applies even under "Bypass filtering rules."
- **NOT a filter** — never removes vehicles. **MBCC** is configured: `field:"model", op:"contains", values:["Sprinter","Metris"]`.

### Source split — `source_split` *(Frank Leta dual-site, June 2026; LIVE — config-gated)*
A dealer whose single Location spans **two websites** (Frank Leta main site + the AUTOLOANPRO subprime superset): **one run, one billing sheet, one deal, but two CSV outputs** by URL domain. The inverse of `billing_split`.
- Optional key in `filtering_rules`: `{group_name, url_contains}`. `url_contains` is matched (case-insensitive) against the Vehicle URL to flag the secondary-site listing. Parsed by **`getSourceSplit_`** (fail-safe → null).
- **Run (`buildCSVSheet_` gains `sourceSplit`):** matched cars whose URL contains the marker → **`CSV_<group>`**; the rest → **`CSV`** (same type rule/schema/UTM). Both always written. The single **BILLING** sheet gains a **"BY SOURCE (QTY PER SKU)"** section (per source × type + per-source totals; labels source-prefixed like `Main Site — PO` so they never collide with `readBillingTotals_`'s RUN_LOG type totals). Deal + RUN_LOG unchanged (one each).
- **Import (`dedupeScraperRows_` via `getSourceSplitLocations_`):** "main first, then secondary" waterfall resolved at import — same VIN with a main URL and a marker URL **within a `source_split` Location** → keep the **main** listing automatically (no conflict prompt), order-independent, **scoped strictly by Location**. Net SCRAPERDATA: one row per VIN.
- **Activation:** Dealer Rules → Filtering → "Dual-Site Source Split" (writes `source_split` to col W). Inert until present and marker URLs exist.

### Post-run finalization *(v2.10, June 12; LIVE)*
Deals/log rows are created only once an order is known to exist. **`runDealer` writes NO log rows** — step 17 returns self-contained **`pendingRuns`** entries (one per prospective row; two for a split run with group units) plus `{outputFolderUrl, dealerName, producedVinCount}`.
- **`finalizeRun(dealerKey, entry, dealId)`** writes one RUN_LOG (+ ORDER_STATS) row via the unchanged `writeRunLog_`. **Invariant: no RUN_LOG row without a deal ID** — `finalizeRun` throws on blank; `test` marks test runs. **Invariant: the VIN log is never written implicitly** — finalizing logs the run only.
- **`abandonRun(dealerKey, outputDocId, qrFileIds)`** — abandoning the last live card with nothing finalized moves the output doc + this run's QR PNGs to **Drive trash** (30-day recovery; trashes exactly this run's files by ID, with a legacy name-scan fallback). Partial abandon of a split run keeps the shared doc/QRs.
- **UI (ViewRun finalization cards):** one card per prospective entry (label, counts, status). v2.10 (LIVE) = a pre-filled deal-ID input + Finalize/Abandon, cards independent; "✓ Add to VIN Log" enables once ≥1 card is finalized and commits all finalized/uncommitted/non-zero rows via **`commitRunRows`** (skips already-committed). Discard guards on dealer change / new run / Cancel; an X-closed run is simply never logged (GAS can't intercept the dialog X).
- **`test` runs are excluded from VIN-log commit** — `commitLatestRun` throws on a `test` col-D; `commitRunRows` skips it (returns `skippedTest`); the VIN Logs UI disables Commit.
- **Method-first finalize (v2.12, LIVE — superseded the v2.10 deal-ID-input card UI above):** each card now leads with a **New Deal / Existing / Test** selector + one Finalize button (controls from **`getRunPushModes(dealerKey, group)` → `{test, newDeal, existing, reason}`**, carried as `pushModes`). `finalizeRunNewDeal` creates the deal first; `finalizeRunExisting` validates then links; `finalizeRun(…, 'test')` logs only. See the Pipedrive section.

### Run Order view (`ViewRun.html`, was the Run Dealer modal/sidebar)
- **"Running as:" dropdown** (top, required — gates Run) from `USER_PROFILES`; last selection persisted per Google account.
- Dealer dropdown; a **VIN Log status row** after selection ("Most recent order in log: {id}" via `getLatestOrderId` + a 📋 Update VIN Log button that jumps to the VIN Logs view, dealer preselected — pending finalization cards survive the jump).
- **Deal ID fields are OPTIONAL at run time** (since v2.10) — they only pre-fill the finalization cards. A second deal-ID field shows only for `billing_split` dealers (`splitDealLabel`). Run gates on user + dealer + VINs.
- **Stackable VIN fills + submit de-dup:** "⟳ Pre-fill from CAO" **appends** (doesn't replace); a "🔍 Fill from Transcription" button appends the Transcription VINs; on submit the list is **de-duplicated** (case-insensitive, order-preserving) client-side (toast notes how many dropped) **and** server-side in `pasteVinsAndRun`.
- Bypass filters checkbox (amber; skips step 8.5); real-time progress (polls `getRunProgress(runId)` every 1.5s via ScriptProperties).

### Import view (`ViewImport.html`) — multi-file + Replace/Merge *(v2.8, June 11; LIVE)*
- **Two modes:** **Main Import (Replace)** clears SCRAPERDATA and imports the file(s); **Merge with Existing** combines them with current data. File input accepts multiple CSVs, each with its own header mapping (different orders OK); a file without a VIN column blocks the import (all-or-nothing). UTF-8 BOM stripped per file; mid-file header rows (VIN cell = "VIN") dropped.
- **VIN dedup/conflict engine (`dedupeScraperRows_`, server-side, post-normalization):** same VIN + identical data (tolerant compare via `cellsEqual_`/`rowsEqual_`/`diffCols_` — trim-string equal OR both-numeric equal, since `getValues()` returns numbers for non-`@` cols) → kept once silently; differing → 2-way conflict (incumbent = first-seen, challenger = latest distinct, `variantCount` tracked). Blank/`*` VINs pass through unkeyed.
- **Two-phase protocol:** `importScraperData(mappedData, mode, resolutions, fileNames, token)` — phase 1 detects conflicts and returns them with **zero mutation**; phase 2 re-sends payload + resolutions (`'*'` bulk fallback), verified against an optimistic-concurrency token (`lastRow|W1 X1`) under a `LockService` lock. **All mutations sit below the conflict gate** (also fixed the old clear-before-normalize hazard where a mid-pipeline throw left SCRAPERDATA empty).
- Final dataset **grouped by Location** (`groupRowsByLocation_`) before writing (preserves `getDealerScraperData_` contiguity); stats/health/dashboard computed on the **final** dataset in both modes. Conflict panel: full-width cards, `table-layout:fixed` Field/Existing/New table (the 2-col grid from the 1400×900 rework had clipped the New column — fixed). Review = mode-aware totals + Import Summary badges.

### Data Sources v2 + schema growth *(v2.11, June 17; LIVE)*
A **Data Sources** screen (`ViewDataSources.html`) for header mapping and adding columns, so feeds with different labels/order land in the right columns automatically.
- **Header mapping:** pick dealer + a **named source** + a sample CSV, map each header to a canonical column (pre-filled from saved mapping + exact-name match; VIN required), **Save Mapping**. The Import screen resolves saved headers as aliases (global union; the scraper's canonical headers unaffected).
- **Multiple sources per dealer (no clobbering):** `SOURCE_MAPPINGS` keyed per `(dealer, source_name)`. Server: `getSourcesForDealer`, `getSourceMapping(dealer, source)` (returns ordered original-case headers — view/edit without re-uploading), `saveSourceMapping`, `deleteSource`, `getHeaderAliasMap` (union).
- **Declare new columns (append-only schema growth):** "＋ Add new column…" → `addSchemaColumn(label)` appends a row to a **`SCHEMA`** tab (seeded with today's 21) and widens SCRAPERDATA by one column. **Append-only** — every fixed index ≤ col U is untouched (`NORM_COL`, Location=19, URL=20, the `SELECT A:U` QUERY all stay valid). New columns are **store-only** (captured/deduped/written by import, but not in ORDERMATCH QUERY / CSV / filters / stats until separately wired). Width is driven by **`getSchemaColCount_()`** (cached `getDataSchema_`) at every master-import site; the **run path stays at the base 21**.
- **Prerequisite — the scraper timestamp moved out of `SCRAPERDATA!W1:X1` into a dedicated `META` tab** (so columns can grow past col V without colliding): `fillScraperDateTime`/`computeImportToken_`/`getAppHomeStatus`/`getTranscriptionVins`/`onEdit` all read via `getTimestampMeta_` (META-first, W1:X1 fallback pre-migration).
- **`getDealerScraperData_` now returns full width** so CAO/run filtering can read appended columns; `pasteScraperData_` slices back to the base 21 for the output doc.

### VIN Log Architecture (redesigned May 2026)
- SF_VIN_LOGS tabs are three columns: `ORDER_ID | VIN | committed_at`.
- VINs are **never written automatically** during a run, **nor by finalizing one** — explicit commit only. Produced VINs are stored in RUN_LOG col V (`produced_vins`, CSV string from ORDERMATCH col E) at finalization; col W (`vin_log_status`) = blank/`committed`/`rolled_back`.
- Commit appends with a `committed_at` timestamp + marks the RUN_LOG row; rollback key = deal ID + `committed_at`. Via the VIN Logs view (`commitRunToVINLog`/`commitLatestRun`/`commitRunRows`/`rollbackRunFromVINLog`/`getCommittedAt`) or the post-run "Add to VIN Log" button.
- **Manual entry panel** (VIN Logs view, after dealer selection): `getLatestOrderId(dealerKey)` pre-populates the Order Number (reads col A bottom-up — reflects manual commits immediately); `manualCommitToVINLog(dealerKey, orderId, vins)` dedups (case-insensitive) and appends directly — **no RUN_LOG row**. For LIST orders / manually-entered VINs with no run record.

### User Profiles & Per-User QR Base Path (May 2026)
- **`USER_PROFILES` tab** (SF_DEALER_CONFIG): `user_key | display_name | qr_local_base_path`. One row per person — adding a user needs no code change.
- `getQRBasePathForUser_(userKey)` resolves + validates the path (normalizes trailing separator); `getLastSelectedUser`/`saveLastSelectedUser` persist per Google account; `getUserProfilesForModal()` bootstraps the dropdown (now folded into `getAppBootstrap`). The `QR_LOCAL_BASE_PATH` global constant was **removed**; `writeQRPaths_(…, basePath)` takes the path as a param threaded `pasteVinsAndRun → runDealer → writeQRPaths_`. Empty `userKey` aborts the run early.

### Performance: getDealerScraperData_ (two-pass)
- Read col T only first (fast), find the contiguous matching row span, then one `getRange` on that span (avoids ~120k-cell full reads that timed out). Used by `getCaoVins` and `runDealer`. Returns full width (schema growth, above); the output-doc paste slices to 21.

### Performance sweep *(branch `feature/app-shell`; LIVE)*
- **Spreadsheet-handle caches:** `getMasterSS_()` / `getVinLogsSS_()` mirror the `getConfigSS_()` single-open-per-execution pattern; all 14 scattered `openById(MASTER/VIN_LOGS)` sites routed through them. `getActiveSpreadsheet()` sites intentionally untouched (per LEARNINGS — write/read-back consistency).
- **`waitForRecalc_` replaced the fixed post-formula sleeps** — 250ms polls that exit as soon as the QUERY spill / last LINKBUILDER formula materializes (was ORDERMATCH up to 3.5s, LINKBUILDER up to 2s via `calcRecalcDelay_`); saves ~1–4s/run, worst case unchanged.
- **Parallel QR uploads** — `generateQRCodesParallel_` uploads PNGs via parallel multipart to the Drive REST API (`UrlFetchApp.fetchAll`, 50/batch, per-file DriveApp fallback) and returns the created file IDs (carried on `pendingRuns` for precise abandon). Was one sequential `createFile` per PNG.
- **QR folder hygiene** — the dealer QR folder is auto-cleared at run start (old PNGs → trash) so it only holds the current run; `trashFilesParallel_` batch-trashes via Drive REST (`UrlFetchApp.fetchAll`, 100/batch) so `clearQRFolder_` and abandons finish in ~1–2s regardless of count.
- **Import path trims** — DASHBOARD data-row formatting batched ~500 range ops → 7 block ops (`setBackgroundObjects` matrix); column widths/frozen rows only on first layout; `groupRowsByLocation_` switched O(n²) `concat` → `push.apply`; `checkImportHealth_` reads only the last 2,000 IMPORT_STATS rows.

### NormManager view (`ViewNorm.html`)
- Table scroll needs JS height calc (`sizeNormTable`, view-container-measured) — GAS iframe CSS flex height is broken. All five maps support ▲▼ reorder; changes write directly to NORM_MAPS (no save step). Add/edit/delete via `addNormEntry`/`updateNormEntry`/`deleteNormEntry`/`moveNormEntry`.

### NORM_MAPS reference columns (E+) — performance fix (June 10, 2026)
- The live `UNIQUE(SCRAPERDATA!…)` reference formulas were **removed**: at 10k+ rows their recalc made *programmatic* access to SF_DEALER_CONFIG time out (~100s `Service Spreadsheets failed`), breaking config-reading modals + `importScraperData`, while the browser UI stayed fine.
- Replaced with on-demand **`refreshNormReference()`** (menu/Utilities): scans SCRAPERDATA once, writes STATIC sorted distinct values per column + counts + timestamp. **Do not** reintroduce volatile full-column formulas. Script reads only cols A–C.

### Health Monitoring & Live Dashboard (June 2026)
- **`IMPORT_STATS`** (13 cols A–M): one row per location per import via `writeImportStats_()` (Section 29).
- **`checkImportHealth_()`** builds per-location rolling baselines and returns `[{location, severity, message}]`. Hard errors: total → 0 with prior data; `no_stock`/`no_price` > 20% (`MISSING_FIELD_THRESHOLD = 0.20`). Baseline warnings (≥ `MIN_IMPORTS_FOR_BASELINE = 5` rows): total/new/po > 40% below average (`DROP_THRESHOLD = 0.40`); unexpected type. Under baseline → `info`.
  - *(Branch-only on `styling-updates`, pending push):* a `flush()` between `writeImportStats_` and the health read makes baselines deterministic; the "Location missing entirely" check now compares only against the **most-recent prior import** (built from a `{timestamp:{location:true}}` map of locations with `total>0`), so a renamed/retired feed name ages out after one import instead of false-flagging forever.
- **`ORDER_STATS`** (12 cols A–L): side-written by `writeRunLog_()` in its own try/catch. Flat — ports 1:1 to a Postgres table.
- **`DASHBOARD`** rewritten by `refreshDashboard_()` (Section 30) at the end of every import: alphabetical per-location inventory snapshot (rows 6+), TOTALS, then RUN LOG SUMMARY / MOST RECENT RUN / RUNS BY DEALER (QUERY over `RUN_LOG!A:W`) at **dynamic** positions. IFERROR-wrapped, stale rows cleared, **no merged cells** (broke repositioning); `DASHBOARD_LOCATION_START_ROW = 6`, `DASHBOARD_MAX_LOCATIONS = 60`. Non-fatal. *(As of July 10, 2026: no longer rendered whole on Home — `getDashboardView` was retired; `getInventorySnapshot` now slices its inventory block for the Import Data view's snapshot table instead. See App bootstrap & per-view data above.)*
- **BILLING fifth section:** `── PRODUCED VINS (N) ──` in col B below Total Duplicates, one VIN/row (dupes included; B20 on a clean run).
- **`getRunsForDealer`** reads the full 23-column RUN_LOG (V=produced_vins, W=vin_log_status) and returns `note` (col U) for the `SPLIT:*` badge.

### Dealer Rules view (`ViewRules.html`)
- **Type Rules tab:** ordered cards (match badge / CSV schema / UTM), ▲▼ reorder, remove, add-rule form (match dropdown, live CSV schema dropdown from CSV_SCHEMAS, UTM input). A non-catch-all rule auto-inserts before any `*`.
- **Filtering Rules tab:** toggles (`require_stock`/`require_price`), pills for `allowed_types` + `exclude_status`, min/max price, per-type seasoning, **the recursive `targeting_rules` builder** (client `targetingRulesModel` is the source of truth — per-rule Action dropdown, per-group ALL/ANY, `+ Condition`/`+ Group`, nested removal), the **Exclude-from-CAO pills** (`cao_exclude_types`), and the **Dual-Site Source Split** section (`source_split`).
- **Save discipline:** `collectFilteringRules()` stashes unmanaged passthrough keys on load and re-merges on save (a fix from v2.9 — it used to drop `billing_split`/`source_split`). `FILTER_MANAGED_KEYS` lists `targeting_rules`, `require_url`, `source_split`, etc. Each tab saves independently (`saveDealerTypeRules`/`saveDealerFilterRules`, scanning by `dealer_key`). `getRulesEditorBootstrap` (dealers + schemas + field/op/action metadata) on open; `getDealerRulesData(dealerKey)` returns parsed objects with safe defaults.
- **(Branch-only)** a per-panel **"Discard Changes"** button (`discardTypeRules`/`discardFilterRules`, dirty-gated, `confirm()`-guarded) and the **Pipedrive panel** (below).

### TRANSCRIPTION (sheet + in-app view)
- Sheet col B = live ARRAYFORMULA `=ARRAYFORMULA(IF(A2:A="","",IF(COUNTIF(SCRAPERDATA!A:A,A2:A),"Found","Not Found")))` (no script). The in-app **Transcription view** mirrors it client-side via `getTranscriptionVins` (above).

---

## Pipedrive Integration — Code.gs Section 31 *(v2.12 — merged to `main` June 24, 2026; LIVE, activates per dealer once configured)*

Pushes a **finalized** run to Pipedrive as a deal with per-type product line items — a **separate, explicit step AFTER** in-system finalization, never automatic, never before the RUN_LOG row (+ col-D Deal ID) exists. Deployed on `main`; inert until the live config is filled in (ScriptProperties secrets + `PIPEDRIVE_SETTINGS` rules + per-dealer `PIPEDRIVE` rows incl. the product map).

### Secrets (ScriptProperties only)
`PD_API_TOKEN`, `PD_COMPANY_DOMAIN`, `PD_DEFAULT_PIPELINE_ID`/`_STAGE_ID`/`_CURRENCY` (read by `pdGetSecrets_`). **Never in repo/sheet.** `setupPipedriveSecrets(...)` validates via a live `GET /users/me` **before** saving; `getPipedriveStatus()` reports connection state and **never returns the token**.

### Never-throw fetch
**`pdFetch_(method, path, payload, opts)` never throws** — returns `{ok, status, data, error}` (token via `?api_token=`; v1 base by default, **v2** for org custom-field reads, product variations, and the org-scoped catalog; one bounded 429 backoff). Treats a response as ok unless HTTP error or explicit `success:false` — handles **both** the v1 envelope (`success:true`) and v2 (omits `success`, signals errors via HTTP status). Same isolation discipline as the non-fatal stats writes — an API failure can never fail a run.

### Global deal-field rules — `PIPEDRIVE_SETTINGS` tab (key/value, SF_DEALER_CONFIG)
Deal-field mapping is **GLOBAL**, not per-dealer. Row `deal_field_rules` = a JSON **array** of rules, each setting **one** deal field in one of **three modes**:
- **copy** — `{id, deal_field, type, mode:"copy", org_field, option_map?}`: read the org's custom field and copy it (`option_map` translates an enum/set option id; `type:"monetary"` writes the `<deal_field>_currency` companion).
- **conditional** — `{id, …, mode:"conditional", group, then_value, else_value}`: IF the org's fields match `group` THEN/ELSE. `group` is the targeting-rule shape but each `field` is a **Pipedrive org-field key**.
- **constant** — `{id, …, mode:"constant", value, if_empty}`: a fixed value, **no org needed**. `if_empty` makes one rule express create-vs-link: on a **New Deal** the value is **always set**; on a **Link** it's set **only if the deal field is empty**, and **skipped — never overwritten — if the current value can't be read** (fail-safe). *Motivating use: `Proof` = `"No Proof Required"` on every new deal, only-if-empty on a link — one global rule, nothing `Proof`/dealer-specific in code.*
- Other keys in the tab: `product_org_field` (org-scoped picker) and `install_cost_config` (install line + Design variation). Generic accessors `getPipedriveSettingValue_`/`setPipedriveSettingValue_`. Server: `getPipedriveGlobalRules_`/`getPipedriveGlobalSettings`/`savePipedriveGlobalSettings` (assigns stable `id`s — `r1`, `r2`, … — so overrides keep pointing at the right rule), `getPipedriveSettingsBootstrap`.

### Org-condition engine (parallel mirror of the targeting engine)
`pdOrgConditionMatches_` (leaf) + `pdOrgGroupMatches_` (recursive AND/OR) read an org's `custom_fields` by key and **fail SAFE** (unknown field/op, empty values, unparseable number, empty group → no match). Helpers `pdOrgFieldValue_` (pulls a comparable scalar from a scalar / `{id}` / `{value}`), `pdSetDealField_`, `pdCollectOrgKeys_` (fetch only the org keys a rule set references). **The production targeting engine (`conditionMatches_`/`groupMatches_`/`ruleMatches_`) is byte-for-byte unchanged** — a deliberate parallel implementation, not a refactor.

### `PIPEDRIVE` config tab — one row per `(dealer_key, group)`, cols A–L (12)
`dealer_key, group, org_id, org_name, product_map` (JSON `{type:{product_id, variation_id?, schema?, utm?}}` — `schema`/`utm` added in v2.12; see *Product map = the sole per-type config* below)`, deal_title_template, pipeline_id, stage_id, currency, field_overrides` (JSON keyed by global rule `id` → `{off:true}` or a full replacement rule; **col J — was `field_map` in v1**)`, active, source_product_map` (JSON `{"<sourceGroup>":{type:{product_id, variation_id?, schema?, utm?}}}`; **col L**, `PDCFG.SOURCE_PRODUCT_MAP = 11`). A PRIMARY row + one row per `billing_split` group (how MBCC's **two orgs** are handled — each group row its own org + product map). **Type Rules (col O) are now DORMANT** (v2.12 — the product map is the sole per-type config). Server: `getPipedriveDealerConfig_`, `getPipedriveDealerEditorData` (also returns `globalRules` + `sourceSplit`), `savePipedriveDealerConfig`, `getOrCreatePipedriveSheet_`.

### Org→deal-field resolution (no-op until configured)
**`pdResolveDealFields_(orgId, globalRules, overrides, currency, isNewDeal, existingDealFields)`** *(replaced `pdResolveFieldMap_`)*: (1) build the **effective** rule list (override `{off:true}` drops a rule, a replacement rule swaps it, else keep); (2) apply **constant** rules first **without** the org (`if_empty` semantics via `isNewDeal`/`existingDealFields`); (3) only if copy/conditional rules exist, read the referenced org keys and evaluate. Returns a **flat top-level** `{dealFieldKey: value}` map (+ `<key>_currency`) — **v1 deals take custom fields as top-level 40-char hash keys, NOT nested under `custom_fields` (that's v2-only)**. An org-fetch failure returns the constant results (not `{}`); copy/conditional output is byte-identical when no constant rule is present. Helpers `pdFieldEmpty_`, `pdHasIfEmptyConstant_`, `pdOptionId_` (id coercion). **No global rules / all overridden off = a no-op**, so the push works before any field mapping exists.

### Product variations (v2, lazy)
`product_map`/`source_product_map` values can pin `{product_id, variation_id?}` (bare id tolerated). Variations are a **separate v2-only endpoint** — `getProductVariations`/`pdListProductVariations_` lazily `GET /api/v2/products/{id}/variations`, fetched only for products that actually pin one. A variation carries its own `prices[]`; line-item idempotency keys by **product + variation**.

### Line items — quantity is GROSS
**`buildLineItems_(billing, productMap, products, currency, variationsByProduct)`** — quantity per type = **gross** (every produced car, **including VIN-log dupes** — a re-printed VIN is still produced and billed; reads `totalNew`/`totalPO`/`totalCpo`/`totalCpoEl` from `readBillingTotals_`, **no dupe subtraction**, all dealers). Same product+variation summed; different variations stay distinct; `item_price` from the variation's (then product's) `prices[]` by currency. *(Was net-of-dupes until June 2026.)* `pdAttachProducts_` sends `product_variation_id` and skips a product+variation already on the deal.

### The push + reusable helpers
**`pushRunToPipedrive(dealerKey, runRowIndex, mode, existingDealId)`**, `mode` ∈ `create`|`link`. Resolves the group from the RUN_LOG note (`SPLIT:<group>` → that group, else PRIMARY) and reads the matching BILLING sheet. `create` makes a new deal on the group's org; `link` attaches + sets fields on a supplied existing deal (doesn't change its org). For a `source_split` dealer with a `source_product_map`, builds `product_map × main qty` + `source_product_map[group] × secondary qty` on the **one** deal, merged by product+variation (`readBillingBySource_` → `bySourceToBilling_` → `mergeLineItems_`).
- Composed of: **`pdResolveRunContext_`** (config/org gate + currency + line items, read-only), **`pdResolveDealId_`** (create-or-validate, persists nothing — the caller owns the col-D write), **`pdCheckInactiveProducts_`** (the inactive-product preempt), **`pdApplyDealContents_`** (attach products + set fields + install cost + Design variation, idempotent via the passed `state`). Signature/gates/returns unchanged by the refactor.

### Idempotency — failure never loses a run
Deal ID written to **RUN_LOG col D the instant Pipedrive returns it**; a **numeric col D = "deal already created"** (dup guard — a retry never makes a second deal). A `pd_push_<row>` ScriptProperties record tracks `productsDone`/`fieldsDone`/`installDone`/`designDone` so a retry **resumes** mid-push. On failure → error + `retryable` flag, **no rollback**.
- **New-Deal create-before-row anchor** (method-first flow): because `finalizeRunNewDeal` creates the deal **before** the RUN_LOG row exists, the col-D guard isn't available yet — so it caches the deal id (then `rowIndex`) under a stable **`pd_new_<outputDocId|group>`** token (`pdNewDealCacheGet_`/`Set_`/`Merge_`/`Clear_`) the instant PD returns it; a retry **adopts** the cached id instead of creating a 2nd deal/row. Cleared on success with `pd_push_<row>`. (Keep **both** anchors: col-D for link/retry, `pd_new` for create-before-row.)

### Org-scoped product picker — `product_org_field` (+ auto-detect)
Pipedrive products are a **global catalog with no native product↔org link**, so the per-dealer picker scopes via a product **Organization-type custom field** (the "Customer" field). **`getEffectiveProductOrgField_()`** = the explicit `product_org_field` setting if set, **else AUTO-DETECT** the first product custom field with `field_type` `org`/`organization` (one Customer field ⇒ zero config). When in effect, `pdListProducts_` fetches via **v2 `/products?custom_fields=<key>`** and enriches each product with `customerOrgId` (`pdExtractOrgId_`). `pdProductVisible_(prod, groupOrgId, showAll, savedProductId)` scopes by `customerOrgId === groupOrgId`, with a per-group **"Show all products"** escape hatch and **always keeps an already-saved `product_id`** (renders a filtered-out one as "Product #N (saved)" — never drops a mapping on save). `savePipedriveProductOrgField` busts the `pd_catalog_v2` cache.

### Deactivated products — never mappable, never pushed
`pdListProducts_` flags `inactive` from the v2 product's **`is_linkable === false`** (v1 fallback `selectable===false || active_flag===false`; **NOT `is_deleted`** — that's soft-delete and stays false for a merely-deactivated product). The picker hides inactive products from NEW mapping (an already-saved-then-deactivated one stays, flagged); `pushRunToPipedrive` **preempts before creating/linking** — a mapped, would-be-pushed (qty>0) inactive product returns `{ok:false, stage:'inactive_product', retryable:false}` naming the product(s). No orphaned deal. Skipped on a field-only retry.

### Install cost + Design no-charge variation *(v2.12)*
`pdApplyInstallCost_` + `pdApplyDesignVariation_` run inside `pdApplyDealContents_` **after** products + fields, on **every** push, each gated by its own `state` flag. Config-driven via the `install_cost_config` row (`PD_INSTALL_COST_KEY`; `getInstallCostConfig_` / client `getPipedriveInstallCostConfig` / `saveInstallCostConfig`) — nothing dealer-/id-hardcoded; inert until set. Shape `{org_field_key, install_product_id, options:{<orgOptionId>:{variation_id|null, percent|null}}, design_product_id, design_no_charge_variation_id}`.
- **Install line:** reads the org's "Program Install Cost" enum, looks up the option, **adds-or-updates** the Install product line (idempotent). Price = `percent × subtotal` (subtotal **excludes** the design + install products), rounded to the cent, else 0. (Included → No-Charge @0; 20% → Professional @ 20%; Custom Billed → no variation @0.)
- **Design variation:** a PD automation adds the "Design" line a few seconds post-create, so this **polls** (~8×2s) and sets the No-Charge variation **only if the Design line's variation is empty** (`pdFieldEmpty_`) — never clobbers a template-request deal; `designPending` if the automation hasn't fired (a re-push sets it).
- **New line-item API helpers:** `pdUpdateDealProduct_(dealId, attachmentId, body)` → `PUT /deals/{id}/products/{attachmentId}` (**first line-item UPDATE in the codebase — keyed on the deal-product ATTACHMENT id, distinct from `product_id`**); `pdAddDealProduct_` → POST one line (no dedup — caller owns idempotency).

### Bulk dealer → org linker (one-time setup helper, Pipedrive Settings)
**`getDealerOrgLinkProposals()`** is **READ-ONLY** — proposes an org per active dealer by name (`pdListAllOrganizations_` + `normalizeOrgName_`/`matchOrg_`; `matchType` exact/strong/weak/none), writes nothing. **`saveDealerOrgLinks(links)`** upserts **only each dealer's PRIMARY-row org** (preserves `product_map`/`field_overrides`; creates a PRIMARY row if absent; never touches product maps or split-group rows). Review-gated.

### Rename-safety (audited)
Every mapping keys on a **stable id/key, never a name** — `product_id`/`variation_id`, `org_id` (`org_name` is a cache), deal/org fields by 40-char **key**, enum/THEN/ELSE/condition values by **option id**, deals by numeric `deal_id`. So the product-revision workflow — **edit the ORIGINAL to keep its id, deactivate the duplicate** — never orphans a mapping; the preserve-already-saved dropdown is the backstop.

### Pipedrive UI surfaces
- **`ViewPipedriveSettings.html`** (global): connection setup (moved here from Dealer Rules), the `product_org_field` picker, the bulk dealer→org linker card, the **Install Cost** card, and the **global deal-field rules builder** (copy / conditional / **Set value** modes; the constant value picker reuses `psRenderValuePicker_` + an "only set if empty" checkbox).
- **Dealer Rules → Pipedrive panel** (`ViewRules.html`, per-dealer): read-only connection state, per-group org picker, type→product grid (org-scoped + "Show all" + preserve-saved) with a variation selector, the secondary product grid for a `source_split` dealer, and per-field **overrides** (Use-global / Off / Override…). The inline override editor **reuses a shared, context-parameterized rule-card editor** — `psRenderRuleCard_`/`psSerializeOneRule_`/`psDeserializeOneRule_`/`psRegisterRuleCtx_` — one implementation shared with the global screen.
- **Apostrophe-safe org pickers (both):** an org name interpolated into an inline `onclick` breaks on an apostrophe (Serra Honda O'Fallon) — fixed by stashing results in a JS array and passing only an **integer index** (`pdPickOrg(gid, j)` / `psLinkPickOrg(i, j)`), rendering names via `escHtml`.

### Billing PDF attachment (v2.12)
On **every** push the system auto-generates a **formatted PDF of the run's BILLING sheet and attaches it to the deal** (replacing the manual download-the-CSV step — a CSV loses formatting and PD's Drive viewer can't size columns). A `state.billingPdfDone` step in `pdApplyDealContents_` (after `designDone`), gated by the `runCtx` param threaded from both callers; **best-effort / non-fatal** (own try/catch, like the stats writes — a failure flags `billingPdfPending` and a re-push retries). **Idempotent** — `pdDealHasBillingPdf_` matches a **date-free** filename (`Billing - <dealer>.pdf` / `Billing - <dealer> (<GROUP>).pdf`) so it doesn't re-attach across days. Pipeline: `readBillingForPdf_` parses the rendered sheet (checks `DUPLICATES` before `BY TYPE` — the CPO/CPO-EL substring-trap class), `buildBillingPdfTab_` lays it out in a temp tab (produced-VINs grid via `billingVinGrid_` — ≥15/column before wrapping, capped 6 cols), `exportSheetPdf_` exports via the Sheets PDF URL (`Authorization: Bearer ScriptApp.getOAuthToken()`), `pdAttachFileToDeal_` uploads via `POST /api/v1/files` multipart (`{deal_id, file: blob}` — the **first file upload in the codebase**; raw `UrlFetchApp.fetch`, since `pdFetch_` is JSON-only). Orchestrated by `attachBillingPdfToDeal_`. The working BILLING sheet is never modified.

### Product map = the sole per-type config (v2.12 — the big consolidation; retired `type_rules` from the run)
The arc: it started with the CSV schema set on `type_rules` (col O) → then the schema derived from the Pipedrive **product** → the product carried schema **and** UTM → finally **the product map became the SOLE per-type config** and `type_rules` was eliminated from the run (left DORMANT). The principle: **the product is the real-world output unit (= a template); a CSV schema is not a template, so the product carries the template identity.**
- **Shape:** each `product_map[type]` / `source_product_map[group][type]` entry is `{product_id, variation_id?, schema?, utm?}` — `schema` sets the CSV layout + grouping, `utm` the QR `utm_medium`. The same mapping the user already picks for billing now drives billing, CSV layout, grouping, and UTM.
- **`runDealer` rework:** dropped the top-of-function `getTypeRules_`; after the ORDERMATCH match it reads the product maps (`getCsvProductMaps_`), **validates** via `validateProductMapForRun_(matchedTypes, mainMap)`, then **builds synthetic type rules from the product map** via `buildTypeRulesFromProductMap_` (one `{match, csv_schema: entry.schema, utm: entry.utm}` per mapped type, **ordered CPO-EL before CPO** — load-bearing, `matchRule_` is substring-based). Those synthetic rules feed `buildLinks_`/`buildUtmFormula_` (QR UTM) and `buildCSVSheet_`/`csvOutputGroups_`/`resolveRuleSchema_` (CSV schema/grouping) **UNCHANGED** — only the *source* of the type rules changed. **No run-time fallback to col O.**
- **Blocks on missing config:** a matched type with no product or no schema → the run **THROWS** ("Cannot run `<dealer>` — no product/schema set for type(s): X. Set them in Dealer Rules → Pipedrive.") via the existing try/catch. So the run now **requires a complete product map for every dealer — even test runs**. **The `*` catch-all is gone** (an unmapped/normalization-missed type blocks instead of falling through).
- **Migration:** `migrateTypeRulesIntoProductMap()` (run once from the editor) backfills each entry's `schema` + `utm` from the legacy col O via `matchRule_`, only where a product is mapped, never overwriting; idempotent. `getTypeRules_` is kept for the migration only; the **Type Rules editor tab is removed** from `ViewRules.html` (per-type schema + UTM are now columns on the product pickers; `availableSchemas` kept to feed the Schema column).
- Plus the SCP_NEW→SCP redundant-schema consolidation (SCP_NEW is now identical to SCP — a cleanup candidate).

---

## Theming — Lot Sherpa design tokens + light/dark *(BRANCH-ONLY: `styling-updates`; NOT deployed)*
- **CSS design-token system, single source of truth in `SharedUtils.html`** (`include_()`-d first, so tokens reach every `#view-xxx` rule + the Classic fallback): `:root` (Light) + `:root[data-theme="dark"]` (neutral black→grey surface stack `#121214`→`#313137`, warm brand oranges — Coquelicot `#fd410d` accent / Coral hover / Rufous pressed — reserved for accents). Semantic + type-pill + type-scale + space-scale tokens; **Poppins** (headings) + **Montserrat** (body).
- **`Theme` helper** (apply/toggle/current) persists on UserProperties (`app_theme`) via new `getThemePreference()`/`saveThemePreference()`; `openApp`/`openViewStandalone_` inject `initialTheme` + a FOUC script (keep injected pref or follow OS before first paint); `getAppBootstrap` returns `appTheme`. Sidebar sun/moon toggle. Default Light, follows OS on first run.
- **All 9 view fragments migrated** from ~506 hardcoded colors to tokens; Google-blue accent → Coquelicot; Arial → Montserrat; type pills → `--type-new/po/cpo/cpoel`. The SilverFox fox-emoji replaced by the real **logo** (base64 `mask-image` so `background-color` themes it).
- **Dealer Rules screen redesign** (stacked full-width panels; Exclude-from-CAO pills moved under Allowed Types; sentence-style Add Rule form; responsive filtering card grid). Two pre-existing layout bugs fixed in passing (Home dashboard bottom rows clipped; long UTM string overflowing a Type Rules card).

---

## ORDERMATCH Column Layout (Current)

| Col | Index | Header | Source |
|---|---|---|---|
| A–I | 1–9 | YEAR/MAKE/MODEL/TRIM/VIN/STOCK/TYPE/PRICE_RAW/URL | QUERY spill zone — never write to template |
| J | 10 | QR_PATH | Script-written |
| K | 11 | YEARMAKE | ARRAYFORMULA |
| L | 12 | YEARMODEL | ARRAYFORMULA |
| M | 13 | MAKE_MODEL_COMBINED | ARRAYFORMULA |
| N | 14 | TYPESTOCK *(QRSTOCK field code maps here)* | ARRAYFORMULA — CPO-EL/CPO/New/PO prefix + stock |
| O | 15 | MISC | ARRAYFORMULA |
| P | 16 | PRICE_FMT | ARRAYFORMULA — `TEXT(H2:H,"#,##0")`, no `$` |
| Q | 17 | NEWYEARMAKE | ARRAYFORMULA |
| R | 18 | TYPEVIN | ARRAYFORMULA — type prefix + VIN |
| S | 19 | YEARMODELSTOCK | ARRAYFORMULA — YEAR MODEL - STOCK |
| T | 20 | PRICE_PLUS_2000 | ARRAYFORMULA — `IF(H2:H="*","*","$"&TEXT(H2:H+2000,"#,##0"))` (live; GLENDALE_COMBINED) |
| U | 21 | PRICE_TAGLINE | ARRAYFORMULA — `IFERROR(IF(VALUE(H2:H)>=15000,"as low as $300/mo",IF(VALUE(H2:H)>=10000,"Below $15,000","Below $10,000")),"")` (live; SCP_TAGLINE). `VALUE()` coerces text price; `IFERROR` blanks non-numeric. |

**TYPESTOCK formula (N2):**
```
=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(ISNUMBER(SEARCH("CPO-EL",G2:G)),"CPO-EL - ",IF(ISNUMBER(SEARCH("CPO",G2:G)),"CPO - ",IF(ISNUMBER(SEARCH("New",G2:G)),"NEW - ","USED - ")))&UPPER(F2:F)))
```

> Cols A–I are the QUERY spill; cols K+ are ARRAYFORMULAs that auto-expand with QUERY output. The **run path uses the base 21 columns** even though the master SCRAPERDATA schema can now grow (Data Sources). CSV schemas: `SCP`, `SCP_NEW`, `SC`, `SCWSB` (Dave Sinclair windshield-only), `GLENDALE_COMBINED`, `SCP_TAGLINE` (Dean Team).

---

## RUN_LOG Column Layout (Current — 23 columns, A–W)

| Col | Header | Description |
|---|---|---|
| A | `run_timestamp` | Run start time |
| B | `dealer_key` | DEALER_KEY |
| C | `dealer_name` | Human-readable name |
| D | `order_id` | Pipedrive Deal ID — **never blank** (`test` for test runs); written at finalization |
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
| U | `notes` | `SPLIT:PRIMARY` / `SPLIT:<group>` for split runs; else manual notes |
| V | `produced_vins` | CSV string of produced VINs (ORDERMATCH col E) |
| W | `vin_log_status` | blank / `committed` / `rolled_back` |

> Written **only at finalization** by `finalizeRun → writeRunLog_` — never during the run; abandoned runs never appear. A billing-split run writes **two** rows (filter on `notes` if counting). Expanded 19 → 23 cols May 2026 (pre-expansion rows have blanks in new columns).

---

## Dealer Config State (Key Dealers)

### type_rules (post-normalization values) — HISTORICAL (migrated into the product map in v2.12)
> As of v2.12 the run no longer reads col O; `migrateTypeRulesIntoProductMap()` copied each dealer's per-type **schema** (and UTM) into its Pipedrive `product_map`. This table is the pre-migration per-type mapping, kept as a reference for what each dealer's product map should carry (and there is now **no `*` catch-all** at run time — a matched type must have a product + schema or the run blocks).

| Dealer | type_rules summary |
|---|---|
| Auffenberg Hyundai | PO → SCP |
| Bommarito Cadillac | New → SCP_NEW, PO → SCP, CPO → SCP |
| CDJR of Columbia | New → SC, PO → SCP, CPO → SCP |
| Mercedes-Benz of Creve Coeur | CPO-EL → SC, CPO → SC, PO → SCP |
| Serra Honda | New → SC, PO → SCP (+ 7-day **PO** seasoning) |
| Glendale CDJR | * → GLENDALE_COMBINED |
| Dave Sinclair Lincoln | * → SCWSB (windshield-only) |
| Mazda of Columbia | * → SCP (used-only; Pipedrive IDs) |
| Dean Team Brentwood | * → SCP_TAGLINE (used-only, `require_price`; Pipedrive IDs) |
| Most others | * → SCP (catch-all) |

### filtering_rules / split notable entries
- Baseline `require_stock: true`, `exclude_status: ["OFFLOT"]` (exceptions: SoCo DCJR no `allowed_types`; BMW West STL no `exclude_status`).
- Serra Honda: `seasoning:[{New,0},{PO,7},{CPO,0}]` — **PO** is seasoned.
- Glendale CDJR + Dean Team Brentwood: `require_price: true`. MBCC: `allowed_types:["PO","CPO","CPO-EL"]` + **`billing_split`** (`field:model, contains, ["Sprinter","Metris"]`).
- **Frank Leta Honda:** `source_split` (AUTOLOANPRO / `url_contains:"autoloanpro"`) + a `drop_on_import` targeting rule (subprime). Pundmann Ford / Bommarito Cadillac / Dave Sinclair St. Peters: migrated to `targeting_rules` (June 17).
- Inactive legacy dealers: `{}`.

### Counts / mapping (verified June 2026)
43 configured rows in DEALERS; **29 active**; 14 inactive. ORDERS cols A–AQ (Mazda AP, Dean Team Brentwood AQ; widened 42→43). `scraper_location_name`: Serra Honda = `Serra Honda O'Fallon`; CDJR of Columbia = `Joe Machens Chrysler Dodge Jeep Ram` (legacy feed name — do not change); BMW of West St. Louis = `BMW of West St. Louis` (J6 corrected June 18 — the only real drift in the 29-dealer audit).

---

## Known Bugs & Pending Work (Priority Order)

### Active Design Issues
1. **Maintenance and Hybrid order types** — two-stream (CAO + manual) modal UI not built. Merge logic designed; CAO infrastructure in place.
2. **Auffenberg Hybrid config** — needs two-stream support + `type_override: "used"` on the manual stream (Courtesy Loaners listed New, must print/bill Used).
3. **Stock→VIN fallback** — no dealer uses `use_stock_not_vin`; VIN is always the key. Planned: if an ordered identifier isn't in the VIN column, look it up in Stock and substitute the VIN.
4. **`model_trim_split` config key inert** — present in Glendale's `data_transforms` but ignored by `applyDataTransforms_` (only `replacements` is read). Implement or remove.
5. **Stale dealer notes** — Hyundai/Nissan of Jefferson City notes say "Scraper #N/A — inactive" but both are active with live feeds.
6. **Trim cleanup (analyzed; deferred)** — trims overflow the print template. Full design (global `cleanTrim_` regex pass behind `ENABLE_TRIM_CLEANUP` + `dryRunCleanTrim_` preview, plus residual exact rules) is in the Bridge doc. Approach decision (A full / B phased / C exact-only) pending.
7. **Dave Sinclair St. Peters targeting (blocked)** — wants CAO used ≥ $35k + New manual-only. Blocked: used cars have **no price** in the feed, so the price floor can't function until used prices are scraped. The `cao_exclude_types:["New"]` half works.
8. **Pipedrive — live-config rollout pending (code is DEPLOYED).** Shipped to `main` June 24, 2026 (v2.12, Section 31). The remaining work is the per-dealer activation: ScriptProperties secrets + `PIPEDRIVE_SETTINGS` rules + per-dealer `PIPEDRIVE` rows (incl. the product map — now the sole per-type config, so a dealer's run blocks until its product map is complete) + the end-to-end test pass.
9. **Theming — deploy pending.** Built on `styling-updates`; in-app visual QA after it ships. The two import-health fixes on that branch are ready to push independently.

### Resolved since the last KB update
- **MBCC/Sprinter shared inventory — resolved** (v2.9 `billing_split`, Option B: one run, two billing outputs + two deals).
- **Glendale price + $2,000 — done** (`PRICE_PLUS_2000` live at ORDERMATCH col 20).
- **Generalized targeting — superseded/done** (the `conditions` model was replaced by the `targeting_rules` engine, June 17; Bommarito/Pundmann/Dave Sinclair St. Peters/Frank Leta migrated).
- **NORM_MAPS `UNIQUE()` timeout — fixed** (on-demand `refreshNormReference()`).
- **BMW of West St. Louis location drift — fixed** (J6, June 18).

### Housekeeping
- Fix `#ERROR!` cells in README tabs (cosmetic); fix legacy field names in `_CONFIG_CACHE` row 1 (cosmetic).
- Delete `VINLogMigration.gs` and `FolderSetup.gs` from Apps Script.
- `git rm` `test-write-access.txt` from the repo root and push.
- Consider consolidating `SCP_NEW` (now identical to `SCP`).

---

## V2 Development Priority Order (Updated)

1. ✅ CAO automation · 2. ✅ filtering_rules per dealer · 3. ✅ Run Dealer modal · 4. ✅ VIN log commit/rollback · 5. ✅ Dealer Rules Editor · 6. ✅ ScraperImport (now multi-file + Replace/Merge) · 7. ✅ Multi-user QR base path · 8. ✅ Health monitoring + DASHBOARD · 9. ✅ Glendale price+$2,000 · 10. ✅ Billing split (MBCC/Sprinter) · 11. ✅ Post-run finalization · 12. ✅ Targeting Rules engine (replaced `conditions`) · 13. ✅ Data Sources v2 + schema growth · 14. ✅ Source split (Frank Leta) · 15. ✅ The SilverFox App SPA + performance sweep
16. ✅ **Pipedrive integration (v2.12, deployed June 24, 2026)** — per-dealer live-config rollout + end-to-end validation next.
17. **Theming** — built (branch); deploy + visual QA.
18. **Maintenance/Hybrid order types** — two-stream modal UI, merge logic, bucket review.
19. **Stock→VIN fallback lookup** — planned.

---

## V2 → V3 Feature Port List (for when V3 resumes — FastAPI + React)

Features now built in V2 that the V3 rebuild must reproduce (V2 is the canonical spec):
- CAO automation; the full **filtering_rules** set (allowed_types, exclude_status, require_stock/price/url, seasoning, min/max price)
- The **`targeting_rules` engine** — IF nested AND/OR THEN action (`drop_on_import`/`exclude_cao`/`exclude_order`), fail-SAFE on misconfig, schema-driven fields
- **billing_split** (separate deals/orgs/product maps) and **source_split** (one deal, separate products/CSVs per source) — the two product-partition axes, both driven generically off filtering_rules
- **Post-run finalization** model — no log row without a deal id; the VIN log never written implicitly; abandonable runs
- VIN log commit/rollback with produced_vins; real-time progress (WebSocket in V3 vs ScriptProperties)
- GUI rules editor (live schema loading); Data Sources header mapping + append-only schema growth
- The **App SPA UX** (sidebar nav, hidden-view state, mutual exclusion, light/dark theming) → React component model
- **Pipedrive integration** as a spec input — global deal-field rules (copy/conditional/constant), per-dealer overrides, org-scoped products, gross line items, idempotent push
- Import **health monitoring + run analytics** — IMPORT_STATS/ORDER_STATS are flat, formula-free tables that map 1:1 to Postgres (`import_stats`/`order_stats`); thresholds become config
- The **live operations dashboard** → a React view backed by the analytics tables
- Per-user QR base path; bypass filters; NEW→USED type bypass (Hybrid); two-phase review modal; CSV VIN upload; detailed order summary

---

## Key Technical Gotchas

1. **GAS modal iframes ignore CSS flex height** — JS-calculate explicit pixel height for scrollable containers; measure the **view container**, not `window`, inside the SPA.
2. **QUERY mixed-type column bug** — force `@` format + `String()` on VIN and Stock before any `setValues()`.
3. **QUERY spill zone** — ORDERMATCH cols A–I are QUERY-populated; never write them in the template.
4. **type_rules match is substring** — `SEARCH("CPO","CPO-EL")` matches; check CPO-EL before CPO.
5. **`getValues()` returns JS booleans** for TRUE/FALSE — use `isTrue_()`. And **returns numbers/Dates** from non-`@` columns — compare with a tolerant comparator (`cellsEqual_`); Date objects can't be serialized to a modal (display-stringify first).
6. **`@` format before AND after `setValues()`** — belt-and-suspenders for plain-text storage.
7. **6-minute execution limit** — parallel QR via `UrlFetchApp.fetchAll()`; per-file DriveApp calls (~120ms each) build minutes-long ops — batch via Drive REST (`generateQRCodesParallel_`/`trashFilesParallel_`).
8. **`openById` vs `getActiveSpreadsheet()` consistency** — write/read-back pairs must use the same accessor (cross-instance cache can miss data even after `flush()`); use the `getConfigSS_`/`getMasterSS_`/`getVinLogsSS_` per-execution handle caches for repeated opens.
9. **PropertiesService is cross-execution** — enables the progress-polling pattern and the Pipedrive idempotency anchors.
10. **`google.script.run` silent failure** on a non-existent / underscore-private function name — verify names exactly.
11. **Large SCRAPERDATA reads time out** — use the two-pass `getDealerScraperData_`.
12. **`SpreadsheetApp.getUi().alert()` fails via `google.script.run`** — server fns return a message for the client to toast (`*Core_`/`app*` split).
13. **The SPA parses ALL fragments into ONE global JS scope** — a duplicate top-level `function name()` clobbers (prefix `ps*`/`tr*`/`pd*` or share one impl); `.view[hidden]{display:none !important}`; never claim `window.onresize` from a fragment.
14. **Interpolating dynamic text into an inline `onclick` breaks on an apostrophe** (Serra Honda O'Fallon) — stash items in a JS array and pass an integer index; render visible text via `escHtml`.
15. **Volatile full-column formulas in a config sheet can make it unreachable to code while the browser stays fine** — the NORM_MAPS `UNIQUE()` timeout; use on-demand static writers.
16. **Pipedrive (v2-API) traps** — coerce string-stored ids to INTEGER on writes (`product_id`/`variation_id`/option ids — by type, never blanket); v1 deal custom fields are **top-level hash keys** (not nested `custom_fields` — that's v2); v2 OMITS the `success` envelope field; product variations + a product's "deactivated" flag (`is_linkable:false`, not `is_deleted`) are **v2-only**; products are a global catalog with **no native org link** (scope via a product Organization custom field); line-item updates go to `PUT /deals/{id}/products/{attachmentId}` (the attachment id, not `product_id`). Confirm v2 shapes against live data — don't infer from v1 or the migration guide.
17. **PRICE_RAW (ORDERMATCH col H) is text** — `ISNUMBER(H2:H)` is FALSE; comparisons don't coerce (and Sheets sorts text above numbers) — use `VALUE(H2:H)` inside `IFERROR` for numeric compares.

---

## V3 Direction (Decided) — FastAPI + React, V2 as canonical spec

> Supersedes the earlier "Flask vs FastAPI + React (unresolved)" framing. The decision is **made**: when V3 resumes it is a **greenfield FastAPI + React + PostgreSQL build that treats the V2 config model as the canonical domain spec**, not an extension of the old Flask prototype.

- The Flask codebase is a **reference only** (local `qrcode` generation, the two-phase review UX, a starting Postgres schema), not a base to extend — its business logic encodes pre-hardening rules that have **diverged** from V2 (config schema; QR encoding the bare VIN instead of the UTM VDP URL; no PO/CPO/CPO-EL taxonomy; 36+ per-dealer `*_vin_log` tables via dynamic SQL; `$`-prefixed PRICE_FMT). Porting that forward would port the drift. (Full list: Appendix A of `GAS_ShortCut_OPS_Development_Plan.md`.)
- **Concretely:** port `type_rules` / `filtering_rules` / `targeting_rules` / `CSV_SCHEMAS` + a data-driven field-code registry / `NORM_MAPS` / `USER_PROFILES` from V2 field-for-field; QR encodes the **UTM VDP URL**; a **single `vin_logs` table keyed by `dealer_key`** (FK + indexes, no per-dealer tables); first-class **billing-group / source-split** concepts; the analytics tables map 1:1.
- Greenfield work doesn't start in earnest until V2 is in production and stable; until then V3 effort is limited to finalizing the canonical spec + the framework-agnostic data/migration design (and the Python translation layer that can also feed V2's importer).

---

## Dealer Account Catalog — Key Facts

Critical nuances:
- **Auffenberg Hyundai** — Hybrid (CAO used + manual Courtesy Loaners, NEW→USED override). Not yet in the modal.
- **BMW of West St. Louis** — LIST only, manual VIN entry. `scraper_location_name` corrected to "BMW of West St. Louis" (June 18).
- **Bommarito Cadillac** — Location reads "Bommarito St. Peters". New + Used. Migrated to `targeting_rules`.
- **BMW of Columbia** — reads LINKBUILDER col C. CAO.
- **Serra Honda** — AutoFi QR format (`utm_base_url_override`). New → SC, PO → SCP. 7-day **PO** seasoning. `scraper_location_name` = `Serra Honda O'Fallon`.
- **MBCC** — Used→SCP, CPO→SC, CPO-EL→SC. **`billing_split`** (cars vs Sprinter/Metris) → two billing sheets + two Pipedrive orgs. Shared scraper location with Sprinter of Creve Coeur. **Resolved.**
- **Glendale CDJR** — `require_price: true`; `data_transforms` Jeep model/trim splits; price+$2,000 **live**. `allowed_types:["PO","CPO"]`.
- **Frank Leta Honda** — **`source_split`** (main site + AUTOLOANPRO) → one deal, two CSVs, BY-SOURCE billing; `drop_on_import` subprime.
- **Dave Sinclair Lincoln** — SC windshield-only (`SCWSB`); price column blank.
- **CDJR of Columbia** — VIN log tab `CDJR_OF_COLUMBIA`; `scraper_location_name` stays "Joe Machens Chrysler Dodge Jeep Ram" (matches the live feed).
- **Mazda of Columbia** — 42nd dealer (June 2026). ORDERS AP. Used-only. * → SCP.
- **Dean Team Brentwood** — 43rd dealer (June 2026). ORDERS AQ. Used-only, `require_price`. * → SCP_TAGLINE.
- **Pundmann Ford** — `targeting_rules` exclude trucks (model/trim) + used <2022 + used <$35k; New-from-CAO via the `cao_exclude_types:["New"]` pill.
