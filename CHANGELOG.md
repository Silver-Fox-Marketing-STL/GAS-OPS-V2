# Changelog

All notable changes to GAS-OPS-V2 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Entries are grouped under **Added**, **Changed**, **Fixed**, and **Removed**.
Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).

---

## [Unreleased]

### Added
- **New dealer: Dean Team Brentwood** (`DEAN_TEAM_BRENTWOOD`) — 43rd dealer row in DEALERS. ORDERS col AQ (the ORDERS sheet was widened from 42 to 43 columns), used-only (`allowed_types: ["PO","CPO"]`, `require_stock`/`require_price` true), Pipedrive deal IDs, `scraper_location_name` = "Dean Team Brentwood", CAO order entry, VIN log tab created. Drive output + QR folders created under the global OUTPUT folder.
- **New field code `PRICE_TAGLINE`** — mapped at ORDERMATCH col 21 (U). ARRAYFORMULA renders a price-tier tagline from `PRICE_RAW` (col H): `≥ $15,000` → "as low as $300/mo"; `$10,000–$14,999` → "Below $15,000"; `< $10,000` → "Below $10,000"; non-numeric → blank. Added to `FIELD_TO_COL`.

### Fixed
- **`PRICE_TAGLINE` returned blank for every row.** `PRICE_RAW` (ORDERMATCH col H) is stored as text, so the original `ISNUMBER(H2:H)` guard was always FALSE. Reworked the formula to coerce with `VALUE()` inside `IFERROR` (`IFERROR(IF(VALUE(H2:H)>=15000,…),"")`). A plain text-vs-number comparison was avoided because Sheets sorts any text above any number, which would bucket every text price into the top tier. Fixed in the SF_UNIVERSAL_TEMPLATE ORDERMATCH U2 cell (no code change).
- **New CSV schema `SCP_TAGLINE`** — the SCP layout plus `PRICE_TAGLINE` appended as col_11. Used by Dean Team Brentwood; leaves the shared `SCP` schema untouched.

### Pending merge — `feature/health-monitoring`
- Data health monitoring system: new `IMPORT_STATS` and `ORDER_STATS` sheets in SF_SYSTEM_MASTER
- `writeImportStats_` and `checkImportHealth_` functions (Code.gs Section 29)
- Health issue indicators in the `ScraperImport.html` review panel
- `ORDER_STATS` side-write added to `writeRunLog_`
- Note: local commits exist on the feature branch; large-file (`Code.gs`) pushes must be done via local `git push`, not the GitHub API

### Known issues
- `getRunsForDealer` reads only 19 columns from the now 23-column RUN_LOG (A–W) — fix pending
- `CDJR_OF_COLUMBIA` `scraper_location_name` intentionally remains `"Joe Machens Chrysler Dodge Jeep Ram"` to match the live scraper feed; update when the feed reflects the new dealer name

### Planned
- Pipedrive post-run API integration (architecture designed; `pushToPipedrive_()` to be isolated in its own try/catch; config expansion at columns P–V requires updating hardcoded `CFG.FILTER_RULES` index)
- Unresolved order configurations: MBCC/Sprinter shared inventory, Glendale CDJR price+$2,000 field, Auffenberg Hybrid (Courtesy Loaners NEW→USED)
- Architecture hardening: IFERROR-wrapped ORDERMATCH formulas, self-describing field-to-column map, resumable runs (6-minute Apps Script ceiling), regression harness, scheduled config audits, extended per-run caching

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
