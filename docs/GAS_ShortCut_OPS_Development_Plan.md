# SilverFox Marketing — GAS ShortCut OPS Development Plan
### GAS ShortCut OPS 1.0 | Last Updated: June 25, 2026

> **Revision note (June 24, 2026):** The **Pipedrive integration (v2.12) was merged to `main` and deployed** — the whole arc (global deal-field rules in copy/conditional/constant modes + per-dealer overrides, org-scoped products, gross line items, idempotent create/link, method-first finalize, billing-PDF attach, install-cost + Design variation, and the **product-map-as-sole-per-type-config** consolidation that retired `type_rules` from the run). It activates per dealer once its live config is filled in. **Lot Sherpa theming** + the **Dealer Rules "Discard Changes"** button remain branch-only (not yet `clasp push`ed).
>
> **Earlier revision note (June 23, 2026):** Brought current after a dense two weeks of V2 work. Newly reflected here: the **SilverFox App** single-modal SPA (the five modals are now `View*.html` fragments in `App.html`), the **Targeting Rules engine** (replaced the flat `conditions` array, June 17), **Data Sources v2 + append-only schema growth**, **billing split** (MBCC/Sprinter resolved) and **source split** (Frank Leta dual-site), **post-run finalization** (deferred deal IDs + abandonable runs), and a backend **performance sweep**. Deploy status is tracked by `clasp push`, not by branch — a feature can be merged to `main` and still be undeployed.
>
> **Earlier revision note (June 2026):** Updated to reflect V2's near-production status, a V2 architecture-hardening track, and a firm V3 direction. The prior "Development Path Decision" (Flask vs. FastAPI + React) was replaced by a firm recommendation — see **V3 Direction (Firm Recommendation)** below, basis in **Appendix A**.

---

## System Hierarchy

Before reading the development phases, understand the relationship between the three systems:

| System | Document | Status | Platform |
|---|---|---|---|
| **Legacy V1** | `SilverFox_V1_Production_System.md` | Legacy predecessor — superseded | Google Sheets + Apps Script |
| **GAS ShortCut OPS 1.0** | `GAS_ShortCut_OPS_Bridge_System.md` | **Production (released June 25, 2026)** | Google Sheets + Apps Script (config-driven; the SilverFox App SPA) |
| **V3 (future)** | `SilverFox_V3_Flask_System.md` | Long-term, paused — rebuild as FastAPI + React | Python (FastAPI) + React + PostgreSQL |

GAS ShortCut OPS 1.0 (the system formerly versioned SilverFox V2, 1.0–2.13) is the deployed production system, superseding legacy V1 — config-driven, universal template, parallel QR, wrapped in a single-modal SPA, all on Google Sheets. V3 is the long-term Python replacement (greenfield FastAPI + React, GAS ShortCut OPS as the canonical spec). Priorities flow accordingly: maintain the deployed GAS ShortCut OPS production system, then build V3.

> **Status field:** the Bridge doc now labels the system "Production (GAS ShortCut OPS 1.0)" — aligned with this plan.

---

## Vision

Replace the Google Sheets / Apps Script production system with a self-contained, multi-user web application — faster, more accurate, easier to use, easier to develop and debug. It handles mixed inventory from multiple sources through an intelligent translation layer and delivers output directly to the user as a downloadable package (no Google Drive dependency).

**Core goals:** Efficiency. Accuracy. Ease of use. User-configurable without programming knowledge.

---

## Current State

### V1 (Production)
Operational, handles all current orders. Limitations: ~42 near-identical per-dealer functions; sequential QR generation (`sleep(2000)`/vehicle); 6-minute execution limit; no real debugging; no version control; ~42 template spreadsheets + ~42 VIN-log spreadsheets.

### GAS ShortCut OPS 1.0 (Production)
The deployed production system (formerly SilverFox V2). Core improvements over legacy V1:
- Single universal script + universal template; config-driven dealers (`SF_DEALER_CONFIG`); master VIN log (`SF_VIN_LOGS`)
- Parallel QR generation via `UrlFetchApp.fetchAll()` (~3–5s for 50 vehicles vs 100+s)
- **The SilverFox App** — a single-modal SPA (`App.html` shell + `View*.html` fragments via HtmlService templating) that replaced the five standalone modals; instant client-side nav with hidden views retaining state; `AppBusy` mutual exclusion; a Classic fallback menu during validation
- CAO automation + the **`filtering_rules`** / **`targeting_rules`** engine (IF nested AND/OR THEN action; fail-SAFE)
- **Data Sources v2** — per-dealer header mapping + append-only schema growth (`SCHEMA`/`META` tabs)
- **billing_split** (MBCC/Sprinter: one run, two billing outputs/deals) and **source_split** (Frank Leta: one deal, two CSVs per source)
- **Post-run finalization** — deal IDs deferred to a finalization step; abandonable runs; no log row without a deal id; the VIN log never written implicitly
- Health monitoring + live DASHBOARD; in-app Transcription tab; per-user QR base path
- A backend **performance sweep** — handle caches, early-exit recalc polling, parallel QR + batch Drive trashing, batched dashboard formatting
- **Pipedrive integration (v2.12, deployed June 24, 2026)** — pushes a finalized run to Pipedrive as a deal with per-type product line items (global deal-field rules copy/conditional/constant + per-dealer overrides, org-scoped products, gross line items, idempotent create/link, method-first finalize, billing-PDF attach, install-cost + Design variation). The **Pipedrive product map is now the sole per-type output config** (CSV schema + UTM), which retired `type_rules` from the run. Activates per dealer once its live config is filled in (ScriptProperties secrets + `PIPEDRIVE_SETTINGS` rules + per-dealer `PIPEDRIVE` rows incl. the product map).

**Built but not yet deployed (branch-only — no `clasp push`):**
- **Lot Sherpa theming** — CSS design tokens + light/dark; pending deploy + visual QA (two import-health fixes on the same branch are ready to push)
- **Dealer Rules "Discard Changes"** button

**What remains before V2 is production:** end-to-end testing across many real dealers (now including the Pipedrive push + per-dealer live config rollout); the two-stream order types (Maintenance, Hybrid) + the Auffenberg type-override; deploying the theming branch; plus the architecture-hardening track (**Phase 1A**).

### V3 (Long-Term Replacement)
A Flask + PostgreSQL app exists (two-phase wizard, CAO/LIST, QR, CSV, VIN-log via Postgres, WebSocket progress) at `http://127.0.0.1:5000`. A side-by-side review shows it has **diverged from V2's validated logic** (config schema, QR content, VIN-log table design, price formatting — Appendix A). Because the divergence is baked into the Flask business layer, the recommendation is **a clean rebuild using V2 as the canonical spec** — below.

---

## V3 Direction (Firm Recommendation)

> Applies to V3 only. V2 development continues regardless. The team is willing to rebuild V3 to escape technical debt. **This plan recommends the rebuild.**

### Recommendation
**Rebuild V3 from the ground up as FastAPI + React, treating the V2 configuration model as the canonical domain specification.** The Flask codebase is retained only as a *reference implementation* for what it solved well (local QR generation, the two-phase review UX, a starting Postgres schema) — not as a base to extend.

### Why rebuild rather than evolve Flask
1. **The Flask logic encodes the *old* rules.** Its `filtering_rules`, `output_rules`, vehicle-type taxonomy, and CSV row builder predate V2's hardening and have drifted (Appendix A, items 1–3). Porting it forward ports the drift. V2 has since gone *further* — the `targeting_rules` engine, billing/source splits, and the finalization model don't exist in Flask at all.
2. **V3 reproduces a V1 anti-pattern** — 36+ per-dealer `*_vin_log` tables via dynamic f-string SQL (item 4), the proliferation V2 consolidated.
3. **V3 carries bugs V2 already fixed** (`$`-prefixed `PRICE_FMT`, hardcoded field-code builder — item 5).
4. **V2 is now the source of truth for *correct* behavior** — validated business rules live in V2's config sheets + `Code.gs`. Porting V2's rules ports the truth.

The cost of the rebuild is the frontend + route layer. The value is escaping the divergence permanently and landing on the originally-intended stack (FastAPI + React), with async-native QR/IO and a component model suited to the config-management UI.

### What "use V2 as the canonical spec" means concretely
- Domain model ported from V2 (not Flask): the **per-type output config** (now carried by the **Pipedrive product map** — `{product_id, variation_id?, schema?, utm?}` per type — which became the sole per-type config in v2.12 and retired `type_rules`; V3 should model the per-type CSV-schema + UTM as an attribute of the product/output unit, not a separate `type_rules` table, and **block a run on a missing product/schema** rather than fall through to a `*` catch-all); `filtering_rules` (per-type `seasoning`, `require_stock/price/url`, `min/max_price`, `allowed_types`, `exclude_status`); the **`targeting_rules`** engine (IF nested AND/OR THEN `drop_on_import`/`exclude_cao`/`exclude_order`, fail-SAFE); `CSV_SCHEMAS` + a data-driven `FIELD_CODES` registry; `NORM_MAPS`; `USER_PROFILES`; the **billing-group / source-split** partition axes; the **finalization** invariants.
- **QR content matches V2:** encode the **UTM-tagged VDP URL**, not the bare VIN (item 2). Keep V3's local `qrcode` generation.
- **Single `vin_logs` table** keyed by `dealer_key` (FK + indexes), no dynamic-table SQL.
- **First-class billing-group / sub-dealer concept** for MBCC/Sprinter (V2 solved this with `billing_split`; V3 makes it native).

### Decision timing
Made now, applies before any further V3 work. The greenfield build doesn't start in earnest until V2 is in production and stable; until then, V3 effort is limited to (a) finalizing the canonical spec extracted from V2 and (b) the framework-agnostic data/migration design.

---

## Key Design Decisions

### Multi-User Access
Cloud backend, browser access (no install), Google OAuth.

### Adjustable VL (Variable Library) Path
Each user has a saved `qr_base_path`; the CSV builder uses it for `@QR` values so Illustrator resolves the right path. **Implemented in V2 (May 2026):** `USER_PROFILES` tab + "Running as:" dropdown; adding a user is a new row, no code change. **V3:** a `qr_base_path` field on the user model — the V2 implementation validates the design.

### Direct ZIP Download
Output never stored on the server — a completed run downloads a ZIP (CSVs + `QR_Codes/` + `order_summary.txt`).

### Order Type System
Four first-class order types (see the Bridge doc + V3 doc):

| Order Type | Purpose |
|---|---|
| **CAO** | Automated — current inventory minus VIN log history |
| **LIST** | Manual VIN list — validated against scraper; VIN log for flagging only |
| **Maintenance** | CAO + manual lot scan merged; VIN log flagging-only on the manual stream |
| **Hybrid** | CAO + manual with optional type override on the manual stream (e.g. Auffenberg Courtesy Loaners) |

**Core principle:** the VIN log is never a gate for manually entered VINs — a manual VIN always means a graphic is needed; the log is checked on manual streams only to flag billing duplicates.

### Translation Layer
A module that accepts inventory files in any format and normalizes to the standard 21-column schema (multiple files, different column names, DMS feeds). *(V2 now has a Sheets-side version of this — Data Sources header mapping — that the Python translator should mirror.)*

### VIN Log with Real Transactions (V3)
Postgres transactions enable safe auto-append after a confirmed run; duplicate entries don't affect CAO (`SELECT DISTINCT`). **V3 uses a single `vin_logs` table keyed by `dealer_key`.**

---

## Development Phases

---

### Phase 1 — Stabilize & Deploy V2 (Current Priority)

V2 is the active bridge and near-term production system. The goal is full reliability for all active dealers before V3 work begins in earnest.

#### Already Complete
- [x] Universal script + universal template
- [x] `SF_DEALER_CONFIG` with `type_rules` JSON column; `SF_VIN_LOGS` master spreadsheet
- [x] Parallel QR generation via `UrlFetchApp.fetchAll()`
- [x] CAO automation — `getCaoVins`, filtering_rules engine, pre-fill with rejection summary
- [x] filtering_rules per dealer (col W); applied at pre-fill + run; bypass checkbox
- [x] VIN log commit/rollback — RUN_LOG `produced_vins` + `vin_log_status`; manual-entry path
- [x] Dealer Rules Editor — GUI for type_rules + filtering_rules; live CSV schema loading
- [x] Scraper normalization — NORM_MAPS; Norm Manager; post-import review
- [x] Real-time progress bar (ScriptProperties polling)
- [x] **Multi-user QR base path** — USER_PROFILES + "Running as:" selector
- [x] **Performance optimizations (v2.4)** — `getConfigSS_()` cache, O(1) `buildNormLookup_()`, scaled sleeps, consolidated transform I/O
- [x] **Import health monitoring (v2.5, §29)** + **ORDER_STATS analytics side-write** + **DASHBOARD auto-refresh (§30)**
- [x] Produced VINs list in BILLING; VIN Log status row in Run Dealer; `getRunsForDealer` → 23-col RUN_LOG
- [x] **Dean Team Brentwood dealer + `PRICE_TAGLINE` + `SCP_TAGLINE` (v2.7)**; **NORM_MAPS performance fix (v2.7)**
- [x] **Multi-file import + Replace/Merge + VIN conflict engine (v2.8)** — two-phase protocol, tolerant compare, `LockService`, Location grouping
- [x] **Uniform 1400×900 modals (v2.8)**
- [x] **Billing split (v2.9)** — `billing_split`; MBCC/Sprinter resolved (one run → two billing sheets + two deals + two RUN_LOG rows)
- [x] **Post-run finalization (v2.10)** — `pendingRuns`/`finalizeRun`/`abandonRun`; deal IDs deferred; no log row without a deal id; VIN log never written implicitly
- [x] **Targeting Rules engine (v2.11, June 17)** — `targeting_rules` (IF nested AND/OR THEN `drop_on_import`/`exclude_cao`/`exclude_order`); `conditionMatches_`/`groupMatches_`/`ruleMatches_`; fail-SAFE; `gt`/`lt`; **replaced the flat `conditions` array**; 4 dealers migrated
- [x] **Data Sources v2 (v2.11, June 17)** — multiple named sources per dealer, header mapping, append-only schema growth (`SCHEMA`/`META` tabs, `getSchemaColCount_`), schema-driven `getFilterFieldIndex_()`, `require_url`
- [x] **Source split** — `source_split` (Frank Leta dual-site): one order → `CSV` + `CSV_<group>`, one deal, BY-SOURCE billing section, import-time waterfall dedup
- [x] **The SilverFox App SPA** — `App.html` + `SharedUtils`/`Classic` + the migrated `View*` fragments + new Home/Transcription/Utilities/DataSources views
- [x] **Performance sweep** — `getAppBootstrap`, `getMasterSS_`/`getVinLogsSS_` handle caches, `waitForRecalc_` early-exit polling, parallel QR uploads + `trashFilesParallel_` + QR-folder hygiene, batched DASHBOARD formatting, in-app Transcription + Home dashboard
- [x] **Pipedrive integration (v2.12, deployed June 24, 2026)** — Code.gs Section 31 (+ `feature/pipedrive-finalize-flow`/`-install-cost`/`-followups`/`-billing-pdf`/`feature/product-driven-schema`), merged to `main`. Push a finalized run as a deal with per-type product line items; global deal-field rules (copy/conditional/constant) + per-dealer `field_overrides`; org-scoped products; gross line items; idempotent create/link; method-first finalize; billing-PDF attach; install-cost + Design variation; the **product map is now the sole per-type output config** (retired `type_rules` from the run). Remaining = the per-dealer live-config rollout (ScriptProperties secrets + `PIPEDRIVE_SETTINGS` rules + `PIPEDRIVE` rows) + end-to-end validation.

#### Built — deploy pending
- [ ] **Lot Sherpa theming** (branch `styling-updates`) — `clasp push` + in-app visual QA; the two import-health fixes on this branch can ship independently first
- [ ] **Dealer Rules "Discard Changes"** button (branch `feature/dealer-rules-discard`)

#### Remaining V2 Tasks
**Core reliability (the current bug-hunt):**
- [ ] End-to-end test on 5+ real dealers with real scraper data — the priority
- [ ] Add automatic ORDERS column clear after a successful run
- [ ] Confirm multi-rule + split behavior end-to-end (Bommarito, Serra Honda, MBCC split, Frank Leta source-split, Auffenberg)

**Order type system:**
- [ ] Add order-type selection to Run Order (CAO, LIST, Maintenance, Hybrid)
- [ ] Maintenance Order — two-stream modal (CAO + manual lot scan), merge logic, VIN-log bypass on the manual stream
- [ ] Hybrid Order — same two-stream structure + type override on the manual stream
- [ ] Two-phase review modal with bucket breakdown (CAO-only, manual-new, manual-dupe, in-both)

**Outstanding design challenges:**
- [x] **MBCC / Sprinter shared inventory** — resolved (v2.9 `billing_split`, Option B)
- [x] **Glendale CDJR price + $2,000** — `PRICE_PLUS_2000` live at ORDERMATCH col 20 (T)
- [ ] **Auffenberg Hybrid config** — `type_override: "used"` on the manual stream; wire through the modal + CSV builder

**Housekeeping:**
- [ ] Delete `VINLogMigration.gs` and `FolderSetup.gs` from Apps Script
- [ ] Fix `#ERROR!` cells in README tabs; update `_CONFIG_CACHE` header row
- [ ] `git rm test-write-access.txt` and push
- [ ] Fix stale "Scraper #N/A" notes on the active Jefferson City dealers; consider consolidating `SCP_NEW` (now identical to `SCP`)
- [x] Align the V2 doc status field to "near production" — done (Bridge doc)
- [x] Resolve the `scraper_location_name` audit — done June 18 (BMW J6 was the only real drift; Serra/CDJR confirmed not drift)

**Success criteria:** V2 runs a full order for any active dealer without errors; all four order types supported; BILLING totals accurate; CAO works; Pipedrive deployed (v2.12) with per-dealer live config in place and validated; theming deployed and validated.

---

### Phase 1A — V2 Architecture Hardening

Shrink the places bugs can hide. These harden V2 without changing behavior and attack the recurring failure modes (hardcoded indices, schema-migration fragility, the 6-minute ceiling).

- [ ] **`IFERROR`-wrap ORDERMATCH formulas.** *(Precedent: DASHBOARD formulas are IFERROR-wrapped; the `PRICE_TAGLINE` formula is too.)* Wrap the QUERY spill + downstream ARRAYFORMULAs so one unmatched VIN yields blank/`*` rather than an `#N/A` cascading into BILLING `#VALUE!`. The structural fix for the BILLING error.
- [ ] **Make `FIELD_TO_COL` self-describing.** Read the ORDERMATCH header row at runtime (cached, with the constant as fallback), so adding a field code stops needing a `Code.gs` edit and a template column shift can't silently break output.
- [ ] **Resumable runs for the 6-minute ceiling.** Checkpoint large orders to ScriptProperties and continue via a time-driven trigger.
- [ ] **Lightweight regression harness.** A `runQATest()` that runs a frozen scraper sample + a known multi-rule dealer through the full pipeline and diffs the CSV against a stored expected output; run before every `clasp push`. *(Partial precedent: the Pipedrive + install-cost work added focused backend unit tests — 15/15 and 11/11 — but there's no full-pipeline harness yet.)*
- [ ] **Scheduled config audit.** Run `auditConfigPlaceholders()` on a daily trigger so a malformed `filtering_rules`/`type_rules` is caught before an order.
- [x] **Extend the per-run cache** — done: `getMasterSS_()` / `getVinLogsSS_()` mirror `getConfigSS_()`; all scattered `openById(MASTER/VIN_LOGS)` sites routed through them (`getActiveSpreadsheet()` sites intentionally untouched).
- [x] **Replace fixed post-formula sleeps** — done: `waitForRecalc_` (250ms early-exit polls) replaced the fixed ORDERMATCH/LINKBUILDER sleeps.

**Success criteria:** no `#N/A`/`#VALUE!` cascades reach BILLING; a template column change can't silently corrupt output; large orders complete or resume; the regression harness passes before each deploy.

---

### Phase 2 — Translation Layer (Python)

Build the data-normalization module in Python (relevant to V3; can also feed clean CSVs into V2's Import screen immediately).

**Goals:** accept one+ files (CSV/Excel/API) in any layout; map source columns to the standard 21-column schema by header (case-insensitive + alias); merge with VIN dedup; flag unrecognized columns without failing; output a clean standard-schema CSV.

**Standard schema (21 columns):**
`VIN | Stock | Type | Year | Make | Model | Trim | Ext Color | Status | Price | Body Style | Fuel Type | MSRP | Date In Stock | Street Address | Locality | Postal Code | Region | Country | Location | Vehicle URL`

**Deliverables:** `translator.py`; a column alias map; multi-file merge with VIN dedup; a CLI; unit tests; supported-format docs.

**Note:** the alias logic should mirror V2's **Data Sources** header mapping + `NORM_MAPS` so the two systems normalize identically; output imports into V2 unchanged.

---

### Phase 3 — Core V3 Application (Greenfield FastAPI + React)

V3 is a clean rebuild on FastAPI + React with the V2 config model as the canonical spec. The Flask code is a reference, not a base. Doesn't begin in earnest until V2 is in production.

#### Reference assets from the Flask build (reuse, don't extend)
- Local `qrcode` generation (388×388) — **but encode the UTM-tagged VDP URL, not the bare VIN**
- The two-phase wizard UX + bucket-breakdown review modal
- A starting Postgres schema; the prepare → review → generate flow shapes

#### Canonical domain model (ported from V2)
- [ ] Per-type output config (first-match-wins, title-case incl. `CPO-EL` before `CPO`) — in V2 this now comes from the **Pipedrive product map** (each type → `{product_id, schema, utm}`), not a separate `type_rules` table; a missing product/schema **blocks the run** (no `*` catch-all)
- [ ] `filtering_rules` engine (`allowed_types`, `exclude_status`, `require_stock/price/url`, `min/max_price`, per-type `seasoning`; enumerated rejection reasons)
- [ ] **`targeting_rules` engine** — IF nested AND/OR THEN action (`drop_on_import`/`exclude_cao`/`exclude_order`), fail-SAFE, schema-driven fields, `gt`/`lt`/`in`/`contains`/…
- [ ] **billing_split** (separate deals/orgs/product maps) and **source_split** (one deal, separate products/CSVs per source) — both driven generically off filtering_rules
- [ ] `CSV_SCHEMAS` + a **data-driven field-code registry** (replaces hardcoded `build_csv_row()`); auto-suffix duplicate field codes
- [x] `PRICE_FMT` without `$`; `PRICE_PLUS_2000` + `PRICE_TAGLINE` implemented (V2 — port to the field-code registry)
- [ ] `NORM_MAPS`-equivalent normalization (shared with the Phase 2 translator)
- [ ] **Data Sources** equivalent — per-source header mapping + schema growth
- [ ] Single `vin_logs` table keyed by `dealer_key` (FK + indexes); no per-dealer tables
- [ ] **Post-run finalization** invariants — no log row without a deal id; VIN log never auto-written; abandonable runs

#### Order processing (all four types)
- [ ] CAO / LIST / Maintenance / Hybrid prepare + generate
- [ ] `merge_order_streams()` (CAO precedence on shared VINs); type override on LIST/Hybrid manual streams
- [ ] VIN-log behavior: flagging-only on manual streams; exclusion only for CAO (`SELECT DISTINCT`)

#### Integrations & platform
- [ ] **Pipedrive push** — port the V2 spec: global deal-field rules (copy/conditional/constant) + per-dealer overrides, org-scoped products, gross line items, idempotent retry-safe create/link
- [ ] FastAPI route layer (async; OpenAPI); Google OAuth 2.0; user model with `qr_base_path`
- [ ] React frontend (Vite): Run Dealer, Inventory/Import + Data Sources, Config Management, Run History, User Settings; **light/dark theming** (port the V2 token system)
- [ ] ZIP output endpoint; Alembic migrations; env config; HTTPS; deploy to Railway/Render

**Success criteria:** a user logs in from any browser, runs any of the four order types, and downloads a ZIP with correct CSVs + QR codes — "correct" = parity with V2 output for the same dealer + inventory.

---

### Phase 4 — Configuration Management UI

Make dealer + schema config fully manageable from the UI (no sheet/DB access) — the feature most aligned with "user-configurable without programming knowledge"; React's component model suits the form-heavy UI.

**Dealer management:** list (active/inactive); edit config (type_rules, scraper location, QR prefix, filtering + **targeting** rules, billing/source split, **Pipedrive** org/product mapping); guided add; activate/deactivate; read-only VIN log.

**Schema management:** list/edit/add CSV schemas with a field-code selector; preview with sample data; manage Data Sources mappings + schema columns.

The V2 **`ViewRules.html`** is the functional reference — the recursive `targeting_rules` builder, the per-tab independent save, live schema loading, and the Pipedrive panel (org-scoped product picker, variation selector, overrides). React should reach parity, then exceed it.

---

### Phase 5 — CAO Automation (V3)

V2's CAO is manual-assist (pre-fills a list). V3 fully automates the comparative analysis in the two-phase modal.
- [ ] Auto-fill flow: pull inventory → apply filtering + targeting rules → cross-reference VIN log (`SELECT DISTINCT`) → net-new list
- [ ] Review modal with pre-checked checkboxes; duplicate/already-produced counts; Maintenance CAO stream runs alongside the manual textarea

---

### Phase 6 — V2 Retirement

Once V3 is stable and trusted in production: confirm all dealers in V3; full VIN-log history in the single `vin_logs` table; all config migrated; run-log history migrated/archived; archive the four spreadsheets + Apps Script project in Drive (not deleted); notify the team.

---

## Dealer Configuration Outstanding Issues

### MBCC / Sprinter of Creve Coeur — RESOLVED (June 12, 2026)
Resolved via **`billing_split`** (Option B): a single run produces **BILLING** (MBCC) + **BILLING_SPRINTER** and two finalization cards with independent deal IDs / two Pipedrive orgs. MBCC's `filtering_rules` carries `billing_split` (`field:model, op:contains, values:["Sprinter","Metris"]`). V3 makes the billing-group concept native. *(Live-test verification remains as part of the Phase 1 bug-hunt.)*

### Glendale CDJR — Price + $2,000 — RESOLVED
`PRICE_PLUS_2000` field code live at ORDERMATCH col 20 (T) via a `*`-safe template ARRAYFORMULA; used by `GLENDALE_COMBINED`.

### Frank Leta Honda — Dual-site — RESOLVED (June 2026)
**`source_split`** (main site + AUTOLOANPRO): one order, one deal, two CSV outputs by URL domain; BY-SOURCE billing section; import-time main-first waterfall dedup. Per-source Pipedrive products supported via the `PIPEDRIVE` tab col L `source_product_map` (live with the v2.12 Pipedrive deploy; activates once configured).

### Auffenberg Hyundai — Hybrid Order Config (pending)
Needs `type_override: "used"` on the manual stream (Courtesy Loaners appear New, must print/bill Used). V2: a manual-stream override surfaced in the (not-yet-built) two-stream modal + CSV builder. V3: a parameter on the Hybrid order request.

### CDJR of Columbia — Naming (cleanup)
`scraper_location_name` stays "Joe Machens Chrysler Dodge Jeep Ram" (matches the live feed — do not change until the scraper is updated); the VIN-log tab is already `CDJR_OF_COLUMBIA`. The system functions correctly.

---

## Data Migration Plan

- **Dealer Config (SF_DEALER_CONFIG → Postgres):** DEALERS/CSV_SCHEMAS/FIELD_CODES export → insert; `type_rules`/`filtering_rules` (incl. `targeting_rules`/`billing_split`/`source_split`) JSON → JSONB. **V2 config is the source of truth — V3 is rebuilt from it, not the divergent Flask `dealership_configs` table.** The new `PIPEDRIVE`/`PIPEDRIVE_SETTINGS` tabs port as their own tables.
- **VIN Logs (SF_VIN_LOGS → Postgres):** tab-by-tab read → bulk insert into a **single `vin_logs` table** with `dealer_key` FK (not per-dealer tables). Consolidate any Flask `*_vin_log` tables here.
- **Run Log (RUN_LOG → Postgres):** import as-is (23-col schema). IMPORT_STATS/ORDER_STATS were deliberately built flat/formula-free → port 1:1.
- **Inventory (SCRAPERDATA → `inventory`):** ephemeral (replaced per import) — no historical migration. Whether V3 keeps snapshot-only or adds timestamped history is an open question.

---

## Technology Stack Summary

| Layer | V2 (Bridge) | V3 (FastAPI + React) |
|---|---|---|
| **Backend** | Google Apps Script | Python / FastAPI |
| **Frontend** | The SilverFox App — Google Sheets HtmlService SPA | React + Vite |
| **Database** | Google Sheets | PostgreSQL |
| **Auth** | Google account (implicit) | Google OAuth 2.0 |
| **QR Generation** | qrserver.com API (parallel), encodes UTM VDP URL | `qrcode` library (local), encodes UTM VDP URL |
| **CRM push** | Pipedrive (Code.gs §31, deployed v2.12) | Pipedrive (port the V2 spec) |
| **Hosting** | Google (Sheets/Drive) | Railway or Render |
| **Output delivery** | Google Drive download | ZIP download |
| **Migrations** | None | Alembic |
| **Version control** | Git (GitHub) | Git (GitHub) |

---

## Open Questions

1. **Inventory storage model (V3):** current-snapshot-only (simpler) or append-only timestamped history (enables historical CAO analytics)? Leans snapshot-plus-optional-history if analytics is on the roadmap. *(V2's append-only `SCHEMA` growth + IMPORT_STATS history are relevant precedents.)*
2. **QR caching (V3):** cache PNGs by VIN+UTM to avoid regenerating identical codes?
3. **Output ZIP retention (V3):** retain for re-download within a window, or regenerate?
4. **DMS direct feed:** scheduled auto-push or user-triggered import?
5. **Multi-tenant:** internal-only, or future dealer read access to their own order history?
6. **Maintenance Order frequency:** per-dealer configurable or fixed monthly?
7. **Rebuild sequencing:** does the V3 rebuild wait fully for V2 production, or can the framework-agnostic pieces (spec extraction, data model, migrations, translator) start during the V2 bug-hunt?

> *Resolved:* MBCC/Sprinter V2 approach (Option B — `billing_split`); V3 Flask-vs-FastAPI (FastAPI + React rebuild).

---

## Appendix A: V2 / V3 Divergence Findings

These (June 2026 review) motivate rebuilding V3 from V2 rather than extending Flask. Each is where Flask encodes behavior V2 has corrected or superseded.

1. **Config schema drift.** Flask `filtering_rules` uses `allowed_vehicle_types` (lowercase `new/used/cpo`) + a single `seasoning_days` int; V2 uses `allowed_types` (title-case, incl. `CPO-EL`), **per-type** `seasoning` arrays, `require_price`, `min/max_price`, **plus the `targeting_rules` engine and billing/source splits that don't exist in Flask at all.** Flask `output_rules` diverges from V2's `type_rules` + `CSV_SCHEMAS` + `FIELD_CODES`.
2. **QR content mismatch (correctness bug).** Flask `generate_qr_code()` encodes the bare VIN; V2 encodes the **UTM-tagged VDP URL** (breaks link tracking + the whole UTM system). V3 must encode the URL.
3. **Vehicle-type taxonomy gap.** Flask `new/used/cpo` has no PO-vs-CPO-vs-CPO-EL distinction; V2 distinguishes `New/PO/CPO/CPO-EL` and MBCC depends on `CPO-EL` (ordered before `CPO`). MBCC can't be expressed in the Flask model.
4. **VIN-log table proliferation.** Flask: 36+ per-dealer `*_vin_log` tables via dynamic f-string SQL — V1's anti-pattern V2 consolidated. V3: a single `vin_logs` table keyed by `dealer_key`.
5. **Carried-over fixes.** Flask `build_csv_row()` sets `PRICE_FMT` with a `$` prefix (V2 removed it in v2.3) and hardcodes the CSV row builder; V2's direction is a data-driven field-code registry.

---

## Document Maintenance

Update at the start of each phase and on any significant architectural decision. Keep current: phase completion status; V2 production/deploy status; technology decisions; open questions; new dealer requirements; Appendix A as divergences are found/resolved.

### Branch & Merge Strategy (as of June 24, 2026)

- **`main` is the single deployed/integration branch.** Deploy flow: edit locally → commit/push to GitHub → `clasp push`. Rollback = `git checkout <last good commit>` + `clasp push`. **A git merge to `main` ≠ a deploy** — deploying is the separate `clasp push`.
- **What's on `main` and deployed:** everything through v2.11 (Data Sources + Targeting Rules, tag `stable-post-targeting-rules`), plus the App SPA, the performance sweep, `source_split` (Frank Leta), and — **as of June 24 (v2.12)** — the full **Pipedrive integration** (`pipedrive-integration` + its stacked sub-branches `feature/pipedrive-finalize-flow`, `feature/pipedrive-install-cost`, `feature/pipedrive-followups`, `feature/pipedrive-billing-pdf`, and `feature/product-driven-schema`).
- **Live, undeployed branches (built, no `clasp push` yet):**
  - `styling-updates` — Lot Sherpa theming (+ two ready-to-push import-health fixes).
  - `feature/dealer-rules-discard` — the Discard Changes button.
- **Merge-conflict caution — `Code.gs` is one ~3,400-line file**, so any two branches that both touch it conflict on merge. (This was acute during the stacked Pipedrive sub-branches, now landed.) Prefer short-lived branches off the right base, land them in order, and avoid parallel long-lived branches that both edit `Code.gs`. (Doc-only branches like the one this plan is being edited on don't have that problem — these two planning docs are dormant on `main`, so they merge cleanly.)
- The merged `feature/health-monitoring` branch still exists but is fully integrated.
