# GAS ShortCut OPS — SilverFox Vehicle Graphic Production System

GAS ShortCut OPS 1.0 (production; formerly versioned SilverFox V2, 1.0–2.13).
Config-driven Google Apps Script that produces vehicle window banner graphics
(Shortcuts / Shortcut Packs) for automotive dealers: imports scraper inventory,
matches ordered VINs, generates QR codes, and builds CSVs for Adobe Illustrator
variable-data printing. One universal script + one universal template replaces
the legacy V1 system's ~42 per-dealer functions. 43 configured dealers, 29 active.

Nick is the primary developer and is using this project to learn Git/programming —
explain reasoning and use beginner-friendly guidance, but stay efficient.

## Expertise & approach

Beyond the always-on ponytail style (lazy senior dev — the simplest thing that
actually works), operate as a domain expert in this stack: know the failure mode
before writing the code, name the invariant you're protecting, reach for the
batched / native / one-line tool first.

- **Modern JS (GAS V8).** ES6+, but no Node/npm at runtime and Apps Script
  services are synchronous (no real async for Sheets/Drive/UrlFetch).
- **GAS runtime is the constraint.** 6-min cap; URL/Drive/Sheets quotas;
  `LockService` for concurrency; `PropertiesService` (cross-execution) for state;
  `CacheService` + per-execution caches for hot reads. Batch every
  network/Drive/Sheets call — per-item calls in a loop blow the time limit.
- **Sheets as a datastore.** `getValues()` returns typed cells; QUERY drops
  mixed-type minorities; recalc needs a settle delay; fixed-width schemas are
  append-only; volatile full-column formulas can make a config sheet unreachable.
- **HtmlService web apps.** SPA-in-a-modal shell, `<?!= include_() ?>` templating,
  the `google.script.run` boundary (no Date serialization, silent fail on
  private/missing fn names), one shared JS scope across fragments. Native HTML/CSS
  before JS.
- **Data analytics.** Long-format over wide for anything unbounded; flat,
  formula-free tables that port 1:1 to SQL; reference a user-entered label by
  cell, never inline it into a formula.

**Canon — lean on it, don't re-derive:** `docs/LEARNINGS.md` (required reading —
every gotcha below with the real incident), the Invariants section, and
`docs/GAS_ShortCut_OPS_Bridge_System.md` (canonical reference; Read on demand for
exact schemas/mechanism/history — NOT in context).

## Working rules

- **Plan, then approve.** Before any destructive or large-scale change (code push,
  sheet write, schema change), present the exact plan and wait for confirmation.
- **Verify before write; verify after.** Read live state (GitHub SHA, sheet values)
  immediately before editing; confirm results after. Don't loop on pre-checks once
  a plan is approved.
- **Changelog travels with code.** Every code change updates `CHANGELOG.md` (Keep a
  Changelog + Conventional Commits) in the same commit; significant changes also
  update the matching `docs/` section.
- **Live system is the source of truth.** When docs and the live sheets/code
  disagree, trust the live system and fix the docs.
- **Branch check before push.** Confirm the current branch first. Single deployed
  branch is `main`.
- **Deploy:** edit locally → commit/push to GitHub → `clasp push`. Rollback =
  checkout last good commit on `main` and `clasp push`.
- **Sheets MCP:** never edit anything outside the "Claude Sandbox" Drive folder;
  reads are fine anywhere.
- **Pipedrive is read-only for Claude.** Claude writes the scripts/functions that
  hit the Pipedrive API; Nick runs them himself. Never add/delete/mutate Pipedrive
  directly — GET probes only, even to check a field shape. (A debug probe once
  created a scratch deal Nick had to delete by hand.)

## Repo / environment

- Repo: `Silver-Fox-Marketing-STL/GAS-OPS-V2`. `Code.gs` (~7,160 lines; Section 31
  = Pipedrive). Local checkout path varies per machine (this PC:
  `C:\Users\newvi\Documents\GAS-OPS-V2`).
- clasp script ID: `1E5aTcofzWzJZssOikaf6lFytS92vRHmj-k1NDV0C_Xu7NoJk7VUEjtNO`.
  Bound to SF_SYSTEM_MASTER. In-code Apps Script menu label is still **SilverFox V2**
  (unchanged; the system is now GAS ShortCut OPS).
- **SilverFox App** (single-modal SPA): `App.html` shell (sidebar nav +
  `<?!= include_() ?>`) + view fragments (`ViewRun`, `ViewImport`, `ViewVinLog`,
  `ViewRules`, `ViewNorm`, `ViewUtilities`, `ViewHome`) + `SharedUtils.html`
  (include FIRST) + `Classic.html` (deprecated standalone fallback). Layout/theme
  detail: brain `ui-patterns`.
- App invariants: `.view[hidden]{display:none !important}`; hidden views keep DOM +
  JS state; imports and runs are mutually exclusive via `AppBusy`; `ui.alert` fails
  via `google.script.run` — use the `*Core_`/`app*` split (server fn returns the
  message, client renders it).

## Core spreadsheets

| Sheet | ID |
|---|---|
| SF_SYSTEM_MASTER (script bound; SCRAPERDATA, ORDERS, RUN_LOG, IMPORT_STATS, ORDER_STATS, DASHBOARD) | `1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes` |
| SF_DEALER_CONFIG (DEALERS, NORM_MAPS, CSV_SCHEMAS, USER_PROFILES, FIELD_CODES, PIPEDRIVE, PIPEDRIVE_SETTINGS) | `1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8` |
| SF_UNIVERSAL_TEMPLATE (copied per order; ORDERMATCH cols A–U) | `14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc` |
| SF_VIN_LOGS (one tab per dealer_key; `ORDER_ID | VIN | committed_at`) | `12Xf6dyZXWXp4JwbytGo6lRUShwuGeN0yS3zhbco4-Lk` |

## Invariants — do not break

Terse rules; mechanism/history in the Bridge doc. Each one prevents a real,
previously-hit failure — don't relax without reading the matching Bridge section.

**Schemas / column indices**
- `CFG` indices are 0-based against DEALERS (A–W, 23 cols): `TYPE_RULES: 14` (col O,
  dormant), `FILTER_RULES: 22` (col W). Cols P–V unused; inserting there means
  updating `CFG.FILTER_RULES`.
- RUN_LOG is 23 cols A–W (`produced_vins` = V, `vin_log_status` = W).
  `getRunsForDealer` reads all 23 — keep new reads in sync. Cols G–N are the
  canonical-four per-type counts — never widened (new types go to `ORDER_TYPE_STATS`).
- ORDERMATCH cols A–I are the QUERY spill zone — never write there in the template.
  `FIELD_TO_COL` in Code.gs is the only runtime mapping; `buildCSVSheet_` reads 100
  cols; `PRICE_TAGLINE` = col 21 (U). Template ARRAYFORMULAs `TYPESTOCK`/`TYPEVIN`
  (N2/R2) are exact-match — a custom type prints its own uppercased name, not "USED".
- Widening any fixed sheet schema is append-only; grep every read of that sheet in
  the same change (the RUN_LOG 19→23 expansion silently broke a reader).

**Types**
- Post-normalization types: `New`, `PO`, `CPO`; `CPO-EL` passes through raw (MBCC).
  **Always check CPO-EL before CPO** (substring match) — same trap in template
  formulas, `matchRule_`, and section-marker parsers.
- Vehicle type is a dynamic registry: `getCanonicalVehicleTypes_()` = built-ins
  `['New','PO','CPO','CPO-EL']` (always first) ∪ stored `vehicle_types`, fail-safe to
  the canonical four. Anything enumerating types reads the registry, never a literal
  four. `buildTypeRulesFromProductMap_` sorts longest-match-first. Bridge:
  "Vehicle-Type Registry".

**Run pipeline / config**
- The Pipedrive product map is the sole per-type config: each `product_map[type]` =
  `{product_id, variation_id?, schema?, utm?}`. `runDealer` builds synthetic type
  rules from it (`buildTypeRulesFromProductMap_`, CPO-EL before CPO); a matched type
  missing a `product_id` OR `schema` makes the run THROW (`validateProductMapForRun_`).
  No col-O fallback, no `*` catch-all. col O `type_rules` is dormant (migration source
  only). Bridge: "Per-type config".
- `filtering_rules` `targeting_rules[]` (IF nested AND/OR THEN
  `drop_on_import`/`exclude_cao`/`exclude_order`) + `cao_exclude_types`.
  `applyFilteringRules_(…, phase)`: `exclude_order` both phases, `exclude_cao` +
  `cao_exclude_types` CAO-only, `drop_on_import` at import. Engine fails SAFE
  (misconfig/empty group → keep the vehicle). Fields via `getFilterFieldIndex_()`.
- VIN and Stock must be `String()`-converted AND `@`-formatted before AND after
  `setValues()` (QUERY mixed-type bug).
- VIN is the vehicle primary key; `use_stock_not_vin` is FALSE for every dealer.
- VIN logs are never written automatically — explicit commit/rollback via the VIN
  Log Updater (key: deal ID + `committed_at`). Manually entered VINs are always
  produced (the log only flags dupes in billing). `test` runs are never committed.

**Scraper / config sheets**
- `scraper_location_name` must exactly match the live feed (an exact-match miss =
  zero inventory → broken CAO/runs). CDJR_OF_COLUMBIA is the legacy
  `"Joe Machens Chrysler Dodge Jeep Ram"` — do not change until the scraper is
  updated. (Full drift audit: brain `open-issues` / Bridge.)
- NORM_MAPS: the script reads only cols A–C; cols E+ are on-demand static reference
  regenerated by `refreshNormReference()`. Never reintroduce volatile full-column
  formulas here — over a 10k-row SCRAPERDATA they timed out all programmatic config
  access (~100s `Service Spreadsheets failed`).
- Stats/dashboard writes (`writeImportStats_`, ORDER_STATS side-write,
  `refreshDashboard_`) are non-fatal try/catch — keep it that way.

**Pipedrive** (v2.12; activates per dealer once live config is filled in)
- All mappings key on stable IDs/keys; names are display-only (rename-safe).
  `product_id`/`variation_id`, `org_id`, deal/org fields by 40-char key, enum values
  by option id, deals by numeric `deal_id`. Persist by id/key, never by name.
- `PIPEDRIVE` tab (SF_DEALER_CONFIG) is cols A–L, one row per `(dealer_key, group)`:
  col E `product_map`, col J `field_overrides`, col L `source_product_map`. Secrets
  (`PD_API_TOKEN` etc.) live in ScriptProperties only — never in repo/sheet.
- Deal-field mapping is GLOBAL in `PIPEDRIVE_SETTINGS` (`deal_field_rules`): modes
  copy / conditional / constant, with an `if_empty` fail-safe (on link, set only if
  empty; skip — never overwrite — when the current value can't be read). Resolver:
  `pdResolveDealFields_`.
- Idempotency: the deal ID is written to RUN_LOG col D the instant the API returns
  it, and a numeric col D is the dup guard (a retry never makes a second deal).
  `pdFetch_` never throws — a Pipedrive failure can never fail a run. New-Deal
  finalize creates the deal before the row, made retry-safe by the
  `pd_new_<outputDocId|group>` token cache; keep both anchors.
- Line-item quantity is GROSS (a re-printed VIN is still produced and billed — no
  dupe subtraction). Line-item tax must be sent explicitly (`tax` + `tax_method:
  'exclusive'`) — the API does not copy a product's catalog Tax % onto a deal line.
- Fail-safe + isolated: the org-condition engine (`pdOrgConditionMatches_`) is a
  parallel mirror of the targeting engine — never touch
  `conditionMatches_`/`groupMatches_`/`ruleMatches_`. Product↔org scoping,
  deactivated-product preemption (`is_linkable===false`), install-cost/Design
  variation, and billing-PDF attach are best-effort/idempotent. Bridge: "Pipedrive
  Integration".
- Two partition axes, both config-driven from `filtering_rules`: `billing_split` =
  separate deals/orgs/product_maps (MBCC); `source_split` = one deal, separate
  products per source via `source_product_map` (Frank Leta).

## Backlog & to-do

Not tracked here. The active to-do, housekeeping, hardening backlog, and working
agreements live in the brain (fresher and richer):
`~/Documents/claude-brain/01-Projects/gas-ops-v2/open-issues.md` — pull via
`/brain-find` or the brain skill. Deferred designs (Trim Cleanup, Order Types,
Capacity Plan) are specced in the Bridge doc.

## Reference docs

@docs/LEARNINGS.md  *(auto-loaded — required reading; the hard-won gotchas)*

Read on demand (NOT auto-loaded):
- `docs/GAS_ShortCut_OPS_Bridge_System.md` — exhaustive system reference + full
  changelog; **canonical source of truth** for any exact invariant, schema, column
  index, or feature history. (De-auto-loaded to save ~56k tokens/session.)
- Brain vault (`~/Documents/claude-brain/01-Projects/gas-ops-v2/`): `project-brief`,
  `architecture` (schema quick-ref), `open-issues` (backlog); plus
  `03-Resources/pipedrive/integration-notes`. Pull via the brain skill / `/brain-find`.
- `GAS_ShortCut_OPS_Development_Plan.md` — roadmap incl. V3 direction.

V3 (FastAPI + React + PostgreSQL) is paused; the GAS ShortCut OPS config model is
its canonical spec — don't extend the old Flask prototype.
