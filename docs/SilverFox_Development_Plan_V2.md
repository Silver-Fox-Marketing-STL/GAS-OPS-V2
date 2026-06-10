# SilverFox Marketing — Production System Development Plan
### Version 2 | Last Updated: June 2026

> **Revision note (June 2026):** Updated to reflect V2's near-production status, a new V2 architecture-hardening track, and a firm V3 direction. The prior "Development Path Decision" (Flask vs. FastAPI + React, framed as a salvage decision) has been replaced by a firm recommendation — see **V3 Direction (Firm Recommendation)** below. The basis for the change is a side-by-side review of the V2 and V3 documentation that surfaced several divergences; these are captured in **Appendix A: V2 / V3 Divergence Findings**.

---

## System Hierarchy

Before reading the development phases, it is important to understand the relationship between the three systems:

| System | Document | Status | Platform |
|---|---|---|---|
| **V1** | `SilverFox_V1_Production_System.md` | **Active production** | Google Sheets + Apps Script |
| **V2** | `SilverFox_V2_Bridge_System.md` | **Active development — near production (final testing)** | Google Sheets + Apps Script (config-driven) |
| **V3** | `SilverFox_V3_Flask_System.md` | Long-term development, not in use | Python (current: Flask) + PostgreSQL |

V1 is the system running every order today. V2 is functionally complete and is in the final bug-hunt phase before it takes over production — config-driven, universal template, parallel QR generation, all while remaining on Google Sheets. V3 is the long-term Python-based replacement. Development priorities flow accordingly: finish hardening V2 into production, then build V3.

> **Note on the V2 doc's status field:** `SilverFox_V2_Bridge_System.md` currently labels V2 as "active production." That is slightly ahead of reality — V2 is feature-complete and very close, but still under test to flush out edge-case bugs. This plan treats V2 as **near-production, in final testing**. The V2 doc status line should be aligned to match at the next doc update.

---

## Vision

Replace the current Google Sheets / Apps Script production system with a self-contained, multi-user web application. The new system will be faster, more accurate, easier to use, and easier to develop and debug. It will handle mixed inventory data from multiple sources through an intelligent translation layer, and will deliver output directly to the user as a downloadable package — no Google Drive dependency required.

**Core goals:** Efficiency. Accuracy. Ease of use. User-configurable without programming knowledge.

---

## Current State

### V1 (Production)
V1 is operational and handles all current orders. Its fundamental limitations are well-documented:
- ~42 near-identical per-dealer Apps Script functions — all logic duplicated
- QR code generation bottlenecked by sequential API calls (`sleep(2000)` per vehicle)
- 6-minute Apps Script execution limit
- No real debugging (flat logs, no breakpoints)
- No version control
- ~42 separate template spreadsheets and ~42 separate VIN log spreadsheets

### V2 (Bridge — Near Production)
V2 is functionally complete and in final testing. Core improvements over V1:
- Single universal script + single universal template (replaces ~42 of each)
- Config-driven dealer settings in one spreadsheet (`SF_DEALER_CONFIG`)
- Master VIN log (`SF_VIN_LOGS`) consolidates ~42 separate spreadsheets
- Parallel QR generation via `UrlFetchApp.fetchAll()` — 50-vehicle order: ~3–5 seconds vs. 100+ seconds in V1
- Modal-based workflow (Run Dealer, Import Scraper Data, VIN Log Updater, Dealer Rules Editor, Normalization Maps)
- CAO automation with `filtering_rules` — pre-fills net-new VIN list with filter rejection summary
- Per-user QR base path — `USER_PROFILES` tab + "Running as:" modal selector; last selection persisted per Google account

**What remains before V2 is production:** end-to-end testing across many real dealers to find the bugs hiding in the edge cases (multi-rule dealers, unusual scraper data, large orders), plus the two-stream order types (Maintenance, Hybrid) and two outstanding design decisions (MBCC/Sprinter, Glendale price). A dedicated architecture-hardening track is added below (**Phase 1A**) to reduce the surface area where those edge-case bugs hide.

### V3 (Long-Term Replacement)
A Flask + PostgreSQL web application has been built: a two-phase order wizard, CAO and LIST order processing, QR generation, CSV building, VIN log management via PostgreSQL, and WebSocket-based real-time progress. It runs locally at `http://127.0.0.1:5000`.

However, a side-by-side review against the now-hardened V2 system shows that the existing Flask implementation has **diverged from V2's validated production logic** in several material ways (config schema, QR content, VIN-log table design, price formatting). See **Appendix A**. Because the divergent logic is baked into the Flask business layer, the previous assumption that this code is a low-cost reusable asset no longer holds. The recommendation has therefore changed from "evolve or pivot the existing code" to **a clean rebuild using V2 as the canonical specification** — see below.

---

## V3 Direction (Firm Recommendation)

> This decision applies to V3 only. V2 development continues regardless. The team has stated it is willing to rebuild V3 from the ground up if doing so escapes technical debt. **It does. This plan recommends the rebuild.**

### Recommendation

**Rebuild V3 from the ground up as FastAPI + React, treating the V2 configuration model as the canonical domain specification.** The existing Flask codebase is retained only as a *reference implementation* for problems it already solved well (local QR generation, the two-phase review UX, a starting Postgres schema) — not as the base to extend.

### Why rebuild rather than evolve Flask

The original plan framed the choice as Flask-vs-FastAPI with the Flask business logic (`correct_order_processing.py`) as a "largely framework-agnostic" asset worth preserving. The V2/V3 review undermines that premise:

1. **The Flask logic encodes the *old* rules, not V2's hardened rules.** V3's `filtering_rules`, `output_rules`, vehicle-type taxonomy, and CSV row builder all predate V2's production hardening and have drifted from it (Appendix A, items 1–3). Porting that logic forward would port the drift forward.
2. **V3 reproduces a V1 anti-pattern.** 36+ per-dealer `*_vin_log` tables addressed via dynamic f-string SQL (Appendix A, item 4) is the same proliferation problem V2 solved by consolidating ~42 VIN-log spreadsheets into one master. It blocks parameterized queries, foreign keys, and central indexing.
3. **V3 carries bugs V2 already fixed** (e.g. `$`-prefixed `PRICE_FMT`, hardcoded field-code builder — Appendix A, item 5).
4. **V2 is now the source of truth for *correct* behavior.** After the V1→V2 migration and months of fixes, the validated business rules live in V2's config sheets and `Code.gs`. A rebuild that ports *V2's* rules is porting the truth; extending Flask is extending a fork that diverged before that truth existed.

The cost of the rebuild is the frontend and the route layer. The value is escaping the divergence permanently and landing on the stack originally intended for V3 (FastAPI + React), with async-native QR/IO handling and a component model well-suited to the config-management UI.

### What "use V2 as the canonical spec" means concretely

- **Domain model ported from V2, not Flask:**
  - `type_rules` (per-type `match` → `csv_schema` → `utm`, evaluated in order, first match wins; title-case types `New / PO / CPO / CPO-EL`, with CPO-EL ordered before CPO)
  - `filtering_rules` with **per-type `seasoning` arrays**, `require_stock`, `require_price`, `min_price`/`max_price`, `allowed_types`, `exclude_status` — matching V2 field-for-field
  - `CSV_SCHEMAS` + a **data-driven `FIELD_CODES` registry** (not a hardcoded `build_csv_row()`), so adding a field code is config, not code
  - `NORM_MAPS` normalization (global + per-column passes, first-match-wins, O(1) lookup)
  - `USER_PROFILES` → per-user `qr_base_path` (V2 already validated this design)
- **QR content matches V2:** encode the **UTM-tagged VDP URL**, not the bare VIN (Appendix A, item 2). Keep V3's local `qrcode`-library generation — it is faster than V2's API approach and is one of the things the Flask build got right.
- **Single `vin_logs` table** keyed by `dealer_key` (FK + indexes), replacing the 36+ per-dealer tables and all dynamic-table SQL.
- **First-class billing-group / sub-dealer concept** to solve MBCC/Sprinter cleanly (one run, multiple tagged billing outputs) rather than the V2 workaround.

### Decision timing
This decision is made now and applies before any further V3 work. The greenfield FastAPI + React build does not start in earnest until V2 is in production and stable; until then, V3 effort is limited to (a) finalizing the canonical spec extracted from V2 and (b) the framework-agnostic data/migration design.

---

## Key Design Decisions

### Multi-User Access
The backend runs on a cloud server. Users access the system through a web browser — no installation required, works on any machine. Authentication via Google OAuth (leverages existing Google accounts, no separate password management).

### Adjustable VL (Variable Library) Path
Each user has a saved `qr_base_path` — the local folder path where QR PNGs will be placed on their machine. The CSV builder uses this path when writing `@QR` column values, so Illustrator resolves the correct path for that user automatically.

**Implemented in V2 (May 2026):** The `USER_PROFILES` tab in `SF_DEALER_CONFIG` stores `user_key`, `display_name`, and `qr_local_base_path` per user. The Run Dealer modal has a "Running as:" dropdown that resolves the correct path at run time. Adding a new user requires only a new row in the tab — no code changes. The last-used selection is persisted per Google account.

**V3 path:** User model with `qr_base_path` field, editable from the User Settings UI. The V2 implementation validates this design pattern.

### Direct ZIP Download
The output is never stored on the server. When an order run completes, the user downloads a ZIP containing CSV files, a `QR_Codes/` folder with all PNGs, and an `order_summary.txt`. The user extracts the ZIP to their local QRS folder and imports the CSV into Illustrator.

### Order Type System
Four first-class order types are supported. See `SilverFox_V2_Bridge_System.md` and `SilverFox_V3_Flask_System.md` for full specifications.

| Order Type | Purpose |
|---|---|
| **CAO** | Automated — current inventory minus VIN log history |
| **LIST** | Manual VIN list — validated against scraper, VIN log for flagging only |
| **Maintenance** | Monthly sweep — CAO + manual lot scan merged; VIN log for flagging only on manual stream |
| **Hybrid** | CAO + manual with optional type override on manual stream (e.g., Auffenberg Courtesy Loaners) |

**Core principle:** The VIN log is never a gate for manually entered VINs. Any manually entered VIN means a graphic is definitely needed. The VIN log is checked on manual streams only to flag duplicates in billing.

### Translation Layer
A dedicated module accepts inventory files in any format and normalizes them to the standard 21-column schema. Handles multiple files in a single upload, different column names, and DMS direct feeds.

### VIN Log with Real Transactions (V3)
PostgreSQL transactions enable safe automatic VIN log appending after a confirmed run. Duplicate log entries (from re-prints in Maintenance/Hybrid orders) have no effect on future CAO runs since the exclusion query always uses `SELECT DISTINCT`. **V3 stores all VIN history in a single `vin_logs` table keyed by `dealer_key`** (not per-dealer tables) — see V3 Direction above.

---

## Development Phases

---

### Phase 1 — Stabilize V2 (Current Priority)

V2 is the active bridge and the near-term production system. The goal is to make it fully reliable for all active dealers before V3 work begins in earnest.

#### Already Complete
- [x] Universal script + universal template (replaces per-dealer duplication)
- [x] `SF_DEALER_CONFIG` with `type_rules` JSON column
- [x] `SF_VIN_LOGS` master spreadsheet (consolidated from ~42 separate logs)
- [x] Parallel QR generation via `UrlFetchApp.fetchAll()`
- [x] Run Dealer modal (replaced sidebar; deal ID required; progress bar; post-run actions)
- [x] Import Scraper Data modal (replaced sidebar; two-column column mapping preview)
- [x] VIN log migration from V1
- [x] CAO automation — `getCaoVins`, filtering_rules engine, pre-fill button with rejection summary
- [x] filtering_rules per dealer — col W in DEALERS; applied at pre-fill and run time; bypass checkbox
- [x] VIN log commit/rollback — VIN Log Updater modal; RUN_LOG produced_vins + vin_log_status
- [x] Dealer Rules Editor modal — GUI for type_rules and filtering_rules; live CSV schema loading
- [x] Scraper data normalization — NORM_MAPS tab; Normalization Maps modal; post-import review
- [x] Real-time progress bar — ScriptProperties polling; step messages; elapsed timer
- [x] **Multi-user QR base path** — USER_PROFILES tab in SF_DEALER_CONFIG; "Running as:" dropdown in Run Dealer modal; per-user path resolved and persisted per Google account
- [x] Performance optimizations (v2.4) — `getConfigSS_()` cache, `buildNormLookup_()` O(1) normalization, `calcRecalcDelay_()` scaled sleeps, consolidated `applyDataTransforms_` reads/writes
- [x] **Import health monitoring (v2.5, Section 29)** — `IMPORT_STATS` tab + `writeImportStats_()` per-location history; `checkImportHealth_()` rolling-baseline anomaly detection (zero-total, >20% missing stock/price, >40% drops vs. average, unexpected types); health issues rendered in the ScraperImport review panel
- [x] **ORDER_STATS analytics side-write (v2.5)** — flat 12-column per-run analytics row appended by `writeRunLog_()`, isolated try/catch; designed to port directly to a Postgres table in V3
- [x] **DASHBOARD auto-refresh (v2.5, Section 30)** — `refreshDashboard_()` rewrites the live dashboard (per-location inventory snapshot, TOTALS, RUN LOG SUMMARY / MOST RECENT RUN / RUNS BY DEALER) on every scraper import; dynamic section positions, no merged cells, IFERROR-wrapped formulas, non-fatal
- [x] Produced VINs list in BILLING — fifth section in col B below the order summary, one VIN per row
- [x] VIN Log status row in Run Dealer modal — most recent order ID via `getLatestOrderId` + Update VIN Log button
- [x] `getRunsForDealer` updated to the 23-column RUN_LOG (was reading 19 columns against the pre-expansion schema)

#### Remaining V2 Tasks

**Core reliability (the current bug-hunt):**
- [ ] End-to-end test on 5+ real dealers with real scraper data — the priority right now
- [ ] Fix BILLING2 `#VALUE!` errors in the universal template (root cause: `#N/A` rows in ORDERMATCH when a VIN is not found in scraper) — see Phase 1A for the structural fix
- [ ] Add automatic ORDERS column clear after a successful run
- [ ] Confirm `type_rules` behavior for all multi-rule dealers (Bommarito, Serra Honda, Mercedes-Benz of Creve Coeur, Auffenberg)

**Order type system:**
- [ ] Add order type selection to the Run Dealer modal (CAO, LIST, Maintenance, Hybrid)
- [ ] Implement Maintenance Order: two-stream modal (CAO auto-fill + manual lot scan textarea), merge logic, VIN log bypass on manual stream
- [ ] Implement Hybrid Order: same two-stream structure with type override option on the manual stream
- [ ] Implement two-phase review modal with bucket breakdown (CAO-only, manual-new, manual-duplicate, in-both-streams)

**Outstanding design challenges (require decisions before implementation):**
- [ ] **MBCC / Sprinter shared inventory:** Decide between (a) separate dealer config entry for Sprinter reading from the same scraper location, or (b) a single run producing two billing outputs. Implement chosen approach.
- [x] **Glendale CDJR price + $2,000:** Implemented. `PRICE_PLUS_2000` live at ORDERMATCH col 20 (T) via template ARRAYFORMULA (`"$"&TEXT(H2:H+2000,"#,##0")`, `*`-safe); used by the GLENDALE_COMBINED schema.
- [ ] **Auffenberg Hybrid config:** Add `type_override` field to `SF_DEALER_CONFIG` for the manual stream. Wire through to sidebar and CSV builder.

**Housekeeping:**
- [ ] Delete `VINLogMigration.gs` and `FolderSetup.gs` from Apps Script (one-time scripts, no longer needed)
- [ ] Delete blank `Sheet1` tab from `SF_VIN_LOGS`
- [ ] Rename `JOE_MACHENS_CDJR` tab in `SF_VIN_LOGS` to `CDJR_OF_COLUMBIA`
- [ ] Fix `#ERROR!` cells in README tabs of `SF_SYSTEM_MASTER` and `SF_DEALER_CONFIG`
- [ ] Update `_CONFIG_CACHE` header row in universal template to reflect current config schema
- [ ] Resolve remaining `scraper_location_name` mismatches (BMW of West St. Louis, Serra Honda O'Fallon)
- [x] Align the V2 doc status field from "active production" to "near production (final testing)" — done in Bridge doc v2.5 update (June 2026)
- [ ] Delete `test-write-access.txt` from the GitHub repo root (`git rm` locally and push)

**Success criteria:** V2 can run a full order for any active dealer without errors. All four order types are supported. BILLING totals are accurate. CAO automation works.

---

### Phase 1A — V2 Architecture Hardening (New)

The fastest way to finish the bug-hunt is to shrink the places bugs can hide. These changes harden V2 without changing its behavior, and several directly attack the recurring failure modes documented in the project knowledge base (hardcoded indices, schema-migration fragility, the 6-minute ceiling).

- [ ] **`IFERROR`-wrap ORDERMATCH formulas.** *(Partial precedent: all DASHBOARD formulas added in v2.5 are IFERROR-wrapped; ORDERMATCH itself still pending.)* Wrap the QUERY spill and the downstream ARRAYFORMULA columns so a single unmatched VIN produces a blank/`*` rather than an `#N/A` that cascades into BILLING2 `#VALUE!`. This is the structural fix for the BILLING2 error rather than a per-symptom patch.
- [ ] **Make `FIELD_TO_COL` self-describing.** Read the ORDERMATCH header row at runtime to build the field-code→column map (cached for the run, with the current hardcoded constant as a fallback only). Adding a field code then stops requiring a `Code.gs` edit and removes the class of bug where a template column shift silently breaks output. Directly addresses the "hardcoded column indices are fragile" learning from the RUN_LOG migration.
- [ ] **Resumable runs for the 6-minute ceiling.** For large orders, checkpoint progress to ScriptProperties and continue via a time-driven trigger if the run approaches the execution limit. Prevents the one failure mode V2 inherits unchanged from V1.
- [ ] **Lightweight regression harness.** A `runQATest()` function that runs a frozen scraper sample + a known multi-rule dealer through the full pipeline and diffs the resulting CSV against a stored expected output. Run before every `clasp push`. Turns "test on real dealers and hope" into a repeatable check.
- [ ] **Scheduled config audit.** Run `auditConfigPlaceholders()` on a daily trigger and surface results, rather than running it ad hoc, so a malformed `filtering_rules` or missing `type_rules` is caught before an order does.
- [ ] **Extend the per-run cache.** Apply the `getConfigSS_()` single-open pattern to the master spreadsheet object as well, eliminating remaining redundant `openById` round trips within a run.

**Success criteria:** No `#N/A`/`#VALUE!` cascades reach BILLING; a template column change cannot silently corrupt output; large orders complete or resume cleanly; the regression harness passes before each deploy.

---

### Phase 2 — Translation Layer (Python)

Build the data normalization module in Python. This is relevant to V3 but can also deliver immediate value into V2 by producing clean, consistently formatted CSVs for the Import Scraper Data modal.

**Goals:**
- Accept one or more inventory files (CSV, Excel, or API response) in any column layout
- Map source columns to the standard 21-column schema by header name (case-insensitive, with alias support)
- Merge multiple files into a single homogenized dataset (deduplication by VIN across files)
- Flag unrecognized columns without failing
- Output a clean CSV in the standard schema format

**Standard schema (21 columns):**
`VIN | Stock | Type | Year | Make | Model | Trim | Ext Color | Status | Price | Body Style | Fuel Type | MSRP | Date In Stock | Street Address | Locality | Postal Code | Region | Country | Location | Vehicle URL`

**Deliverables:**
- [ ] `translator.py` — core normalization logic
- [ ] Column alias map — common alternative names for each standard column
- [ ] Multi-file merge logic with VIN deduplication
- [ ] CLI: `python translate.py --input file1.csv file2.xlsx --output inventory.csv`
- [ ] Unit tests for column mapping and merge logic
- [ ] Documentation of supported source formats

**Note:** The translation layer outputs a CSV that can be imported into V2 via the existing Import Scraper Data modal immediately upon completion. No changes to V2 required. All work here is directly reusable in V3, and the normalization rules should mirror V2's `NORM_MAPS` so the two systems normalize identically.

---

### Phase 3 — Core V3 Application (Greenfield FastAPI + React)

Per **V3 Direction**, V3 is a clean rebuild on FastAPI + React with the V2 config model as the canonical spec. The existing Flask code is a reference, not a base. This phase does not begin in earnest until V2 is in production.

#### Reference assets from the Flask build (reuse, don't extend)
- Local QR generation via the `qrcode` library (388×388 PNG) — **but encode the UTM-tagged VDP URL, not the bare VIN**
- Two-phase order wizard UX and the bucket-breakdown review modal concept
- A starting Postgres schema for inventory and import tracking
- The order-processing *flow shapes* (prepare → review → generate) for CAO/LIST/Maintenance/Hybrid

#### Canonical domain model (ported from V2)
- [ ] `type_rules` engine — per-type `match`/`csv_schema`/`utm`, first-match-wins, title-case types incl. `CPO-EL` (ordered before `CPO`)
- [ ] `filtering_rules` engine — `allowed_types`, `exclude_status`, `require_stock`, `require_price`, `min_price`/`max_price`, **per-type `seasoning` arrays**; rejection reasons enumerated (`no_stock`, `no_price`, `type`, `status`, `price_low`, `price_high`, `seasoning`)
- [ ] `CSV_SCHEMAS` table + **data-driven field-code registry** (replaces hardcoded `build_csv_row()`); auto-suffix duplicate field codes in headers (`YEARMODELSTOCK`, `YEARMODELSTOCK2`, …)
- [x] `PRICE_FMT` without `$`; `PRICE_PLUS_2000` implemented (V2 — port to V3 field-code registry)
- [ ] `NORM_MAPS`-equivalent normalization (shared with the Phase 2 translator)
- [ ] Single `vin_logs` table keyed by `dealer_key` (FK + indexes); no per-dealer tables, no dynamic-table SQL

#### Order processing (all four types)
- [ ] CAO, LIST, Maintenance, Hybrid prepare + generate flows
- [ ] `merge_order_streams()` (CAO precedence on shared VINs)
- [ ] Type override on LIST/Hybrid manual streams
- [ ] VIN log behavior: flagging-only on all manual streams; exclusion only for the CAO stream (`SELECT DISTINCT`)
- [ ] Billing-group / sub-dealer support for MBCC/Sprinter (one run → tagged billing outputs)

#### Platform
- [ ] FastAPI route layer (async-native; OpenAPI docs auto-generated)
- [ ] Google OAuth 2.0 auth; user model with `qr_base_path`
- [ ] React frontend (Vite): Run Dealer, Inventory/Import, Config Management, Run History, User Settings
- [ ] ZIP output endpoint (CSV + QR codes + `order_summary.txt`)
- [ ] Alembic migrations; env-based config; HTTPS; deploy to Railway or Render

**Success criteria:** A user can log in from any machine with a browser, select a dealer, run any of the four order types, and download a ZIP containing correct CSVs and QR codes — where "correct" is defined by parity with V2 output for the same dealer and inventory.

---

### Phase 4 — Configuration Management UI

Once the core workflow is stable, dealer and schema configuration should be fully manageable from the UI without database or spreadsheet access. This is the feature most directly aligned with "user-configurable without programming knowledge," and React's component model is well-suited to the form-heavy config UI (a reason the rebuild lands here cleanly).

**Dealer management:**
- [ ] List all dealers (active and inactive)
- [ ] Edit dealer config (type_rules, scraper location, QR prefix, filtering rules, etc.)
- [ ] Add new dealer (guided setup)
- [ ] Activate / deactivate dealers
- [ ] View dealer's VIN log (read-only)

**Schema management:**
- [ ] List CSV schemas
- [ ] Edit schema column layout
- [ ] Add new schema with field code selector
- [ ] Preview schema output with sample data

The V2 Dealer Rules Editor modal (`RulesEditor.html`) is the functional reference for this UI — the React build should reach parity with it (independent save for type_rules and filtering_rules, live schema loading, reorderable rule cards) and then exceed it.

---

### Phase 5 — CAO Automation (V3)

The CAO automation built in V2 is manual-assist (pre-fills a VIN list for the user to review). V3 should fully automate the comparative analysis and present results in the two-phase modal.

- [ ] "Auto-Fill from Inventory" flow: pull current inventory → apply filtering_rules → cross-reference VIN log (`SELECT DISTINCT`) → present net-new VIN list
- [ ] CAO review modal with checkboxes (pre-checked, user can deselect)
- [ ] Duplicate count and already-produced count displayed
- [ ] Maintenance Order CAO stream runs automatically alongside the manual textarea

---

### Phase 6 — V2 Retirement

Once V3 is stable and has run in production long enough to be trusted, V2 is retired.

**Retirement checklist:**
- [ ] All active dealers confirmed working in V3
- [ ] Full VIN log history confirmed in PostgreSQL (single `vin_logs` table)
- [ ] All dealer config confirmed migrated
- [ ] Run log history migrated or archived
- [ ] `SF_SYSTEM_MASTER`, `SF_DEALER_CONFIG`, `SF_UNIVERSAL_TEMPLATE`, `SF_VIN_LOGS` archived in Drive (not deleted)
- [ ] Apps Script project archived
- [ ] Team notified — V3 URL is the new workflow

---

## Dealer Configuration Outstanding Issues

These are known design challenges that must be resolved before the relevant dealers can be fully configured in V2 or V3. Documented here and in `SilverFox_Dealer_Account_Catalog.md`.

### MBCC / Sprinter of Creve Coeur
Mercedes-Benz of Creve Coeur and Sprinter of Creve Coeur share a scraper location (`Location` column value) and use identical print templates, but require separate Pipedrive entries and invoices. Currently only MBCC has a dealer config entry. Sprinter has no entry in V2 or V3.

**Options under consideration:**
- **(A)** Add a `SPRINTER_CREVE_COEUR` dealer entry pointing to the same `scraper_location_name`. Each dealer runs as a separate order. User splits the VIN list between the two dealers manually.
- **(B)** Build a shared-inventory concept: a single order run produces two billing outputs (one for MBCC, one for Sprinter) by tagging each VIN with the appropriate sub-dealer.

Option A is simpler to implement in V2. **Option B is the recommended target for V3**, where the billing-group / sub-dealer concept can be a first-class part of the data model rather than a workaround. Decision for V2 pending; V3 should build Option B.

### Glendale CDJR — Price + $2,000
The `GLENDALE_COMBINED` schema includes a `PRICE_FMT` field, but the actual requirement is `vehicle price + $2,000` in the output. The current `PRICE_FMT` field code applies no arithmetic offset.

**Solution:** Add a `PRICE_PLUS_2000` field code to `SF_DEALER_CONFIG FIELD_CODES` (V2; reserved at ORDERMATCH col 20) and to the field-code registry (V3). Straightforward once prioritized.

### Auffenberg Hyundai — Hybrid Order Config
Auffenberg needs a `type_override: "used"` flag on the manual stream (Courtesy Loaners appear as "New" in the scraper but must print as "Used"). In V2, this requires adding a `manual_stream_type_override` column to `SF_DEALER_CONFIG`. In V3, this is a parameter on the Hybrid order request. The sidebar and order wizard both need to surface this option at order time.

### CDJR of Columbia — Naming Alignment
Listed as "CDJR of Columbia" in the dealer catalog but as "SoCo DCJR" in the V1/V2 system, with a `scraper_location_name` of "Joe Machens Chrysler Dodge Jeep Ram" (legacy scraper feed name). The system functions correctly; this is a documented cleanup item. Align naming and rename the `JOE_MACHENS_CDJR` VIN-log tab to `CDJR_OF_COLUMBIA` before V3 migration to avoid scraper `location` filter mismatches.

---

## Data Migration Plan

### Dealer Config (SF_DEALER_CONFIG → PostgreSQL)
The DEALERS, CSV_SCHEMAS, and FIELD_CODES tabs are structured and clean. Migration is a CSV export → database insert. The `type_rules` and `filtering_rules` JSON columns map directly to JSONB columns in Postgres. **The V2 config is the source of truth — V3 config is rebuilt from it, not from the existing Flask `dealership_configs` table** (which uses the divergent schema in Appendix A).

### VIN Logs (SF_VIN_LOGS → PostgreSQL)
SF_VIN_LOGS was already standardized during the V1→V2 migration (`ORDER_ID | VIN | committed_at`, one tab per dealer). Migration is a tab-by-tab read → bulk insert into a **single `vin_logs` table** with `dealer_key` as a foreign key (not per-dealer tables). Any existing Flask per-dealer `*_vin_log` tables are consolidated into this single table during the rebuild.

### Run Log (RUN_LOG → PostgreSQL)
Historical run log rows import as-is. The 23-column schema is well-defined.

### Inventory Data (SCRAPERDATA → PostgreSQL `inventory` table)
The current SCRAPERDATA sheet is ephemeral — replaced on every scraper import. Whether V3 keeps a current-snapshot-only model or adds an append-only timestamped history is an open question (below) tied to whether historical CAO analytics is wanted. No historical data migration is required either way.

---

## Technology Stack Summary

| Layer | V2 (Bridge) | V3 (Recommended: FastAPI + React) |
|---|---|---|
| **Backend** | Google Apps Script | Python / FastAPI |
| **Frontend** | Google Sheets + HTML modals | React + Vite |
| **Database** | Google Sheets | PostgreSQL |
| **Auth** | Google account (implicit) | Google OAuth 2.0 |
| **QR Generation** | qrserver.com API (parallel), encodes UTM VDP URL | `qrcode` library (local), encodes UTM VDP URL |
| **Hosting** | Google (Sheets/Drive) | Railway or Render |
| **Output delivery** | Google Drive download | ZIP download |
| **Migrations** | None | Alembic |
| **Version control** | Git (GitHub) | Git (GitHub) |

> The earlier "V3 Path A (Flask) vs Path B (FastAPI + React)" comparison table has been removed; the decision is made (rebuild on FastAPI + React). The Flask column is preserved in `SilverFox_V3_Flask_System.md` as the reference implementation.

---

## Open Questions

1. **MBCC / Sprinter shared inventory (V2):** Option A (two separate dealer entries) or Option B (one run, two billing outputs) for the V2 bridge? (V3 builds Option B regardless.)

2. **Inventory storage model (V3):** Current-snapshot-only (simpler) or append-only timestamped history (enables historical CAO comparisons and analytics)? Recommendation leans snapshot-plus-optional-history if analytics is on the roadmap.

3. **QR code caching (V3):** Cache QR PNGs by VIN+UTM to avoid regenerating identical codes across orders?

4. **Output ZIP retention (V3):** Retain the output ZIP for re-download within a time window, or generate fresh every time?

5. **DMS direct feed integration:** When a DMS provider is onboarded, does data push automatically on a schedule, or does a user trigger the import manually?

6. **Multi-tenant considerations:** Is V3 exclusively for SilverFox internal use, or is there a future where dealer clients have limited read access to their own order history?

7. **Maintenance Order frequency:** Configurable per dealer, or a fixed monthly cadence?

8. **Rebuild sequencing:** Does the V3 rebuild wait fully for V2 production, or can the framework-agnostic pieces (canonical spec extraction, data model, migrations, translator) start in parallel during the V2 bug-hunt?

---

## Appendix A: V2 / V3 Divergence Findings

These are the specific divergences (June 2026 review) that motivate rebuilding V3 from V2 rather than extending the existing Flask code. Each is a place where the Flask implementation encodes behavior that V2 has since corrected or superseded.

1. **Config schema drift.** Flask `filtering_rules` uses `allowed_vehicle_types` (lowercase `new/used/cpo`) and a single `seasoning_days` integer; V2 uses `allowed_types` (title-case `New/PO/CPO/CPO-EL`), **per-type** `seasoning` arrays, plus `require_price` and `min/max_price`. Flask `output_rules` is a separate object (`template_type`, `custom_templates`, `csv_columns`, `sort_by`) that diverges from V2's battle-tested `type_rules` + `CSV_SCHEMAS` + `FIELD_CODES` system.

2. **QR content mismatch (correctness bug).** Flask `generate_qr_code()` encodes the bare VIN (`qr.add_data(vin.upper())`). V2 encodes the **UTM-tagged VDP URL** built in LINKBUILDER from the `utm` value in `type_rules`. VIN-only QR codes would break dealer link tracking and the entire UTM system. V3 must encode the URL.

3. **Vehicle-type taxonomy gap.** Flask `vehicle_condition` is `new/used/cpo` with no PO-vs-CPO-vs-CPO-EL distinction. V2 distinguishes `New / PO / CPO / CPO-EL`, and MBCC's configuration depends on `CPO-EL` (ordered before `CPO` because "CPO" is a substring). MBCC cannot be expressed in the Flask model as built.

4. **VIN-log table proliferation.** Flask uses 36+ per-dealer `*_vin_log` tables accessed via dynamic f-string SQL (`SELECT DISTINCT vin FROM {table}`). This mirrors V1's ~42-spreadsheet anti-pattern that V2 explicitly consolidated, and it blocks parameterized queries, foreign keys, and central indexing. V3 should use a single `vin_logs` table keyed by `dealer_key`.

5. **Carried-over fixes.** Flask `build_csv_row()` sets `PRICE_FMT` with a `$` prefix; V2 removed the `$` (v2.3) because Illustrator cannot map two variables to the same field code and the dollar sign caused type conflicts. Flask also hardcodes the CSV row builder in code, whereas V2's direction is a data-driven field-code registry so new field codes are config, not code.

---

## Document Maintenance

This document should be updated at the start of each new phase and whenever a significant architectural decision is made. Key things to keep current:

- Phase completion status (check off completed items)
- V2 production status (and align the V2 doc status field when V2 goes live)
- Technology decisions that diverge from what's documented here
- Open questions as they are resolved or added
- New dealer configuration requirements from `SilverFox_Dealer_Account_Catalog.md`
- Appendix A as additional V2/V3 divergences are found or resolved during the rebuild

### Branch & Merge Strategy (as of June 2026)

- Active development continues on **`feature/health-monitoring`** — it now carries all June work (health monitoring, dashboard, billing/modal additions) and is fully pushed to remote.
- **`main`** remains the clean rollback target (`git checkout main && clasp push` reverts the deployed script).
- **Merge-conflict caution:** `Code.gs` is a single ~3,000-line file, so any two branches that both touch it will conflict on merge. Until `feature/health-monitoring` is merged to `main`, branch new feature work **off `feature/health-monitoring`** (not off `main`) — or merge to `main` first and branch from there. Avoid parallel long-lived branches that both edit `Code.gs`.
- Recommended next step: open a PR to merge `feature/health-monitoring` → `main` once the current bug-hunt round passes, restoring `main` as the single integration point before the next feature branch.
