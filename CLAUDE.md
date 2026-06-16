# GAS-OPS-V2 — SilverFox Vehicle Graphic Production System

Config-driven Google Apps Script that produces vehicle window banner graphics
(Shortcuts / Shortcut Packs) for automotive dealers: imports scraper inventory,
matches ordered VINs, generates QR codes, and builds CSVs for Adobe Illustrator
variable data printing. One universal script + one universal template replaces
V1's ~42 per-dealer functions. **43 configured dealers, 29 active** (June 2026).

Nick is the primary developer and is using this project to learn Git/programming —
explain reasoning and use beginner-friendly guidance, but stay efficient.

## Working rules

- **Plan, then approve.** Before any destructive or large-scale change (code push,
  sheet write, schema change), present the exact plan and wait for confirmation.
- **Verify before write; verify after.** Read live state (GitHub SHA, sheet values)
  immediately before editing. Confirm results after. Don't loop on pre-checks once
  a plan is approved.
- **Changelog travels with code.** Every code change updates `CHANGELOG.md`
  (Keep a Changelog + Conventional Commits) in the same commit. Significant
  changes also update the matching section in `docs/`.
- **Live system is the source of truth.** When docs and the live sheets/code
  disagree, trust the live system and fix the docs.
- **Branch check before push.** Confirm the current branch before any push.
  Single deployed branch is `main` (`feature/health-monitoring` merged June 2026).
- **Deploy:** edit locally → commit/push to GitHub → `clasp push` to Apps Script.
  Rollback = checkout last good commit on `main` and `clasp push`.
- **Sheets MCP:** never edit anything outside the "Claude Sandbox" Drive folder.
  Reads are fine anywhere.

## Repo / environment

- Repo: `Silver-Fox-Marketing-STL/GAS-OPS-V2` — `Code.gs` (~3,400 lines, 30 sections)
  plus the **SilverFox App** (single-modal SPA, June 2026): `App.html` shell
  (sidebar nav + `<?!= include_() ?>` templating), view fragments `ViewRun`,
  `ViewImport`, `ViewVinLog`, `ViewTranscription` (live Found/Not-Found VIN
  check via `getTranscriptionVins`), `ViewRules`, `ViewNorm`, `ViewUtilities`,
  `ViewHome` (workflow cards + a live DASHBOARD render via `getDashboardView`,
  refreshed on every Home visit), plus
  `SharedUtils.html` (escHtml/toast/AppGuards/AppBusy — include FIRST) and
  `Classic.html` (standalone single-view wrapper for the deprecated Classic
  menu fallback; delete with `openViewStandalone_` at validation sign-off).
  App invariants: `.view[hidden]{display:none !important}`; hidden views keep
  state; imports and runs are mutually exclusive via `AppBusy`; `ui.alert`
  fails via `google.script.run` — use the `*Core_`/`app*` wrapper split.
- Local project: `C:\Users\Nick_Workstation\Documents\SilverFox-V2`
- clasp script ID: `1E5aTcofzWzJZssOikaf6lFytS92vRHmj-k1NDV0C_Xu7NoJk7VUEjtNO`
- Script is bound to SF_SYSTEM_MASTER; menu: **SilverFox V2**.

## Core spreadsheets

| Sheet | ID |
|---|---|
| SF_SYSTEM_MASTER (script bound; SCRAPERDATA, ORDERS, RUN_LOG, IMPORT_STATS, ORDER_STATS, DASHBOARD) | `1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes` |
| SF_DEALER_CONFIG (DEALERS, NORM_MAPS, CSV_SCHEMAS, USER_PROFILES, FIELD_CODES) | `1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8` |
| SF_UNIVERSAL_TEMPLATE (copied per order; ORDERMATCH cols A–T) | `14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc` |
| SF_VIN_LOGS (one tab per dealer_key; `ORDER_ID | VIN | committed_at`) | `12Xf6dyZXWXp4JwbytGo6lRUShwuGeN0yS3zhbco4-Lk` |

## Invariants — do not break

- `CFG` column indices are 0-based against DEALERS (A–W, 23 cols):
  `TYPE_RULES: 14` (col O), `FILTER_RULES: 22` (col W). Cols P–V are unused;
  inserting columns there requires updating `CFG.FILTER_RULES`.
- RUN_LOG is **23 columns A–W**; `produced_vins` = V, `vin_log_status` = W.
  `getRunsForDealer` reads all 23 — keep any new reads in sync.
- Post-normalization types are `New`, `PO`, `CPO`; `CPO-EL` passes through raw
  (MBCC only). **Always check `CPO-EL` before `CPO`** — substring match.
- ORDERMATCH cols A–I are the QUERY spill zone — never write there in the template.
  `FIELD_TO_COL` in Code.gs is the only runtime mapping; headers/FIELD_CODES tab
  are documentation. `buildCSVSheet_` reads 100 cols. `PRICE_TAGLINE` = col 21 (U).
- `filtering_rules` `conditions[]` (field/op/values/applies_to) + `cao_exclude_types`:
  `applyFilteringRules_(…, phase)` — `conditions` apply in **both** phases (Bypass
  overrides), `cao_exclude_types` is **CAO-only**. `evaluateCondition_` **fails open**
  on misconfig (a typo must never empty a dealer). Fields map via `FILTER_FIELD_INDEX`
  (single source of truth, surfaced to the Rules Editor by `getRulesEditorBootstrap`).
- VIN and Stock must be `String()`-converted **and** `@`-formatted before AND
  after `setValues()` (QUERY mixed-type bug).
- VIN logs are never written automatically during a run — explicit commit/rollback
  via the VIN Log Updater (key: deal ID + `committed_at`). Manually entered VINs
  are always produced; the log only flags duplicates in billing.
- VIN is always the vehicle primary key. `use_stock_not_vin` is FALSE for every
  dealer (planned replacement: stock→VIN fallback lookup — see to-do).
- `scraper_location_name` for CDJR_OF_COLUMBIA is
  `"Joe Machens Chrysler Dodge Jeep Ram"` — matches the live scraper feed;
  do not change until the scraper is updated.
- NORM_MAPS cols E+ are a **static, on-demand reference area** (sorted unique
  SCRAPERDATA values per column) regenerated by `refreshNormReference()`
  (menu: **Refresh Norm/Field Reference**) — the script reads only cols A–C, so E+
  is inert scratch space. The old live `UNIQUE()` formulas were removed June 10, 2026:
  recalculating them over a 10k+ row SCRAPERDATA made programmatic access to
  SF_DEALER_CONFIG time out (~100s `Service Spreadsheets failed`) while the browser
  UI stayed fine. Do **not** reintroduce volatile full-column formulas here.
- Stats/dashboard writes (`writeImportStats_`, ORDER_STATS side-write,
  `refreshDashboard_`) are non-fatal try/catch — keep it that way.

## Current to-do (verified June 10, 2026)

1. Maintenance/Hybrid order types — two-stream modal (CAO + manual), merge logic,
   type override for Auffenberg Courtesy Loaners (New in scraper → print as Used).
2. MBCC/Sprinter shared scraper location — billing split design decision pending.
3. Stock→VIN fallback lookup (replaces unused `use_stock_not_vin` concept).
4. Glendale `model_trim_split` key is inert in `data_transforms` — implement or remove.
5. Pipedrive integration — push completed runs as deal updates; isolate API calls
   in try/catch so failures never surface as run failures.
6. Trim cleanup — trims overflow the print template; full analysis + validated
   auto-cleanup design (global `cleanTrim_` regex pass, feature-flag + dry-run
   gated, plus residual exact-match rules) captured in the Bridge doc
   ("Trim Normalization & Cleanup — Analysis & Deferred Design"). Approach decision
   (A full / B phased / C exact-only) pending.
7. Housekeeping: README `#ERROR!` cells, delete `VINLogMigration.gs`/`FolderSetup.gs`
   from Apps Script, `git rm test-write-access.txt`, fix stale "Scraper #N/A" notes
   on the active Jefferson City dealers, consider consolidating SCP_NEW (now
   identical to SCP).
8. Log capacity (watch, don't build yet): when any log tab passes ~25k rows or
   imports/dashboard slow down, build `archiveOldLogs()` per the "Capacity & Log
   Growth Plan" section in the Bridge doc (12-month hot window → SF_LOG_ARCHIVE;
   never archive SF_VIN_LOGS).

## Reference docs

@docs/SilverFox_V2_Bridge_System.md
@docs/LEARNINGS.md

Also in `docs/` (read on demand, not auto-loaded):
`SilverFox_Project_Knowledge_Base.md` (compressed decision history),
`SilverFox_Development_Plan_V2.md` (roadmap incl. V3 direction).
V3 (FastAPI + React + PostgreSQL) is paused; the V2 config model is its
canonical spec — don't extend the old Flask prototype.
