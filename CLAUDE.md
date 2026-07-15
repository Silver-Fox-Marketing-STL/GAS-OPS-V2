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

**Canon — lean on it, don't re-derive:** the Invariants and Recurring-traps
sections below; `docs/LEARNINGS.md` (the full incident record behind every trap —
Read on demand before deep work in an unfamiliar subsystem); and
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
- **Deploy:** feature branch → test in dev (`clasp push` targets DEV via
  `.clasp.json`) → merge to `main` → Nick runs `scripts/promote.ps1` — the ONLY
  path to prod (gates: main / clean / synced / green harness / typed PROMOTE;
  pushes code + bumps the versioned `/exec` deployment). Rollback = redeploy a
  prior version in the prod script's Manage Deployments (see
  `docs/dev-environment.md`); never "roll back" with `clasp push` — it targets DEV.
- **Sheets MCP:** never edit anything outside the "Claude Sandbox" Drive folder;
  reads are fine anywhere.
- **Pipedrive is read-only for Claude.** Claude writes the scripts/functions that
  hit the Pipedrive API; Nick runs them himself. Never add/delete/mutate Pipedrive
  directly — GET probes only, even to check a field shape. (A debug probe once
  created a scratch deal Nick had to delete by hand.)

## Repo / environment

- Repo: `Silver-Fox-Marketing-STL/GAS-OPS-V2`. `Code.gs` (~9,400 lines; Section 31
  = Pipedrive). Local checkout path varies per machine (this PC:
  `C:\Users\Nick_Workstation\Documents\SilverFox-V2`).
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
- New view UI uses the canonical SharedUtils classes (`.btn-*`, `.pill`, `.tag`,
  `.table-u`) — never re-declare a per-view button/pill/tag/table dialect; class
  renames must keep the App.html Encarta/Luna override selectors matching.

## Core spreadsheets

| Sheet | ID |
|---|---|
| SF_SYSTEM_MASTER (script bound; SCRAPERDATA, ORDERS, RUN_LOG, IMPORT_STATS, ORDER_STATS, DASHBOARD) | `1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes` |
| SF_DEALER_CONFIG (DEALERS, NORM_MAPS, CSV_SCHEMAS, USER_PROFILES, FIELD_CODES, PIPEDRIVE, PIPEDRIVE_SETTINGS) | `1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8` |
| SF_UNIVERSAL_TEMPLATE (copied per order; ORDERMATCH cols A–W) | `14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc` |
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
  `FIELD_TO_COL` + the FIELD_CODES tab's `ordermatch_col` overlay are the runtime
  mapping (`PRICE_MAINLINE` = col 22 (V) lives ONLY in the overlay — the constant
  is not the full picture; check both before claiming a column free);
  `buildCSVSheet_` reads 100 cols; `PRICE_TAGLINE` = col 21 (U); `FEATURES` =
  col 23 (W), script-written per-row manual text (like col J — template W2:W must
  stay EMPTY). Template ARRAYFORMULAs `TYPESTOCK`/`TYPEVIN` (N2/R2) are
  exact-match — a custom type prints its own uppercased name, not "USED".
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
  No col-O fallback, no `*` catch-all. col O `type_rules` is dormant (legacy record;
  the one-time migrator was removed after all active dealers were verified migrated).
  Bridge: "Per-type config".
- `filtering_rules` `targeting_rules[]` (IF nested AND/OR THEN
  `drop_on_import`/`exclude_cao`/`exclude_order`) + `cao_exclude_types`.
  `applyFilteringRules_(…, phase)`: `exclude_order` both phases, `exclude_cao` +
  `cao_exclude_types` CAO-only, `drop_on_import` at import. Engine fails SAFE
  (misconfig/empty group → keep the vehicle). Fields via `getFilterFieldIndex_()`.
- QR/LINKBUILDER is schema-gated: `runNeedsQR_` skips the whole block (links, folder
  clear, PNGs, col-J paths) when no resolved schema carries a QR field code —
  LINKBUILDER's only consumer is QR. Features text (`FEATURES` schemas) is required
  per-row: client blocks Run, `pasteVinsAndRun` fail-fasts BEFORE any write
  (`collectMissingFeatures_`); gating is exact-match on product-map keys both sides.
- VIN and Stock must be `String()`-converted AND `@`-formatted before AND after
  `setValues()` (QUERY mixed-type bug).
- VIN is the vehicle primary key. The legacy `use_stock_not_vin` flag is removed
  (DEALERS col F stays, dormant/append-only); ORDERMATCH always matches col A.
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
- Persist every mapping by stable id/key (product/variation/org ids, 40-char field
  keys, enum option ids, numeric deal ids); names are display-only (rename-safe).
  Secrets (`PD_API_TOKEN` etc.) live in ScriptProperties only — never repo/sheet.
- `PIPEDRIVE` tab (SF_DEALER_CONFIG) is cols A–L, one row per `(dealer_key, group)`:
  col E `product_map`, col J `field_overrides`, col L `source_product_map`.
- Deal-field mapping is GLOBAL in `PIPEDRIVE_SETTINGS` (`deal_field_rules`), modes
  copy / conditional / constant with the `if_empty` fail-safe: on link set only if
  empty; when the current value can't be read, SKIP — never overwrite.
- Idempotency: deal ID → RUN_LOG col D the instant the API returns it (numeric
  col D = dup guard); the `pd_new_<outputDocId|group>` token cache covers the
  create-before-row window — keep both anchors. `pdFetch_` never throws — a
  Pipedrive failure can never fail a run.
- Line-item quantity is GROSS (no dupe subtraction); tax is sent explicitly
  (`tax` + `tax_method: 'exclusive'`) — the API never copies catalog Tax %.
- The org-condition engine (`pdOrgConditionMatches_`) is a parallel mirror of the
  targeting engine — never touch `conditionMatches_`/`groupMatches_`/`ruleMatches_`.
  Product↔org scoping, deactivated-product preemption (`is_linkable===false`),
  install-cost/Design variation, and billing-PDF attach are best-effort/idempotent.
- Two partition axes from `filtering_rules`: `billing_split` = separate deals/orgs/
  product_maps (MBCC); `source_split` = one deal, per-source products via
  `source_product_map` (Frank Leta). Full mechanism: Bridge "Pipedrive Integration"
  + brain `03-Resources/pipedrive/integration-notes`.

## Recurring traps — always in context

The distillation of `docs/LEARNINGS.md` (no longer auto-loaded). Each line is a
real incident; the full story + fix pattern lives there — Read it before deep work
in an unfamiliar subsystem (Pipedrive push, Lot Scanner, theme system, import).

**GAS runtime**
- Batch everything network/Drive/Sheets-bound (`UrlFetchApp.fetchAll`, Drive REST):
  per-file `createFile`/`setTrashed` ≈120ms each; per-row formatting is ~12× a
  single block write (`setBackgroundObjects`). Fixed sleeps → `calcRecalcDelay_`.
- `google.script.run` fails SILENTLY on missing/`_`-suffixed names (spinner hangs)
  and cannot serialize Dates — stringify sheet rows before returning to a modal.
- `SpreadsheetApp.getUi().alert()` fails in client-invoked executions — server
  returns the message (`*Core_`/`app*` split); `toast()` works anywhere.
- Use ONE accessor for a write+read pair — `openById` vs `getActiveSpreadsheet`
  caches diverge even after `flush()`. `getConfigSS_()` for SF_DEALER_CONFIG.
- Never `getRange` a full-width 5k+ row sheet from a modal — two-pass (locate the
  span by one column, read just the span).
- Concurrent appends lose rows unless the sheet is opened INSIDE the lock and
  `flush()`ed before release — or better, serialize all row-writing through one
  chunked committer and parallelize only the slow upload.
- `LockService` is per-SCRIPT-PROJECT — two scripts sharing a sheet can't lock each
  other out; a slow cross-project loop must carry a stable row id and re-verify it
  (re-locate/skip) before each write, else a sibling project's `deleteRow` shifts rows
  under cached row numbers (office `runInboxOcr` vs the scanner).
- Drive trash is owner-only for *My-Drive* files (a `USER_ACCESSING` upload makes the
  uploader the owner) — a Shared Drive makes files org-owned with role-based trash (crew
  needs Content Manager); find-or-create of a shared folder under a parallel upload pool
  needs double-checked locking (raced → two subfolders).

**SPA / HtmlService**
- Every view root must declare `background: var(--bg); color: var(--text)` —
  SharedUtils pins `.view` to a HARDCODED WHITE readability guard that only an
  ID-scoped root rule overrides; omit the background and the view paints white
  in dark themes while its tokened content goes dark (EOM view, July 2026).
- All view fragments parse into ONE shared global JS scope — prefix per-view
  helpers (`ps*`/`tr*`/`pd*`); a duplicate top-level function silently clobbers.
- Include `SharedUtils` BEFORE views; element queries view-scoped
  (`view.querySelector`); `addEventListener`, never `window.onresize =`.
- `lot-scan/SharedUtils.html` is an OLD divergent copy (pre-unified-component-layer — no
  `.tag`/`.tone-*`); a class emitted in lot-scan HTML must exist in lot-scan's OWN files,
  not just the main app's.
- Never interpolate a dynamic string into an inline `onclick` — pass an integer
  index into a JS-side array (an apostrophe in the value kills the row silently).
- CSS Grid blockifies children and defaults to `stretch` — restore each child's
  pre-grid sizing (`justify-self:start` for content-width items). A portable
  injected widget defends its own box model with `!important` (view `* {padding:0}`
  resets outrank its class rules).
- iOS: re-parenting a `<select>` fires a spurious `change` (detach the inline
  `onchange` during DOM moves); pin `text-size-adjust:100%` on `:root` or identical
  px text renders at different sizes; no mobile console → toast the COMPUTED style
  on-device before theorizing. Decode big photos serially; parallelize only uploads.

**Sheets values / formulas**
- `getValues()` returns real booleans (`isTrue_`) and numbers/Dates from non-`@`
  columns (`cellsEqual_` for tolerant compares). `PRICE_RAW` is TEXT: `+` coerces
  but comparisons don't (text sorts above ALL numbers) — `VALUE()` first.
- QUERY drops mixed-type minorities (the VIN/Stock `String()` + `@` rule) and
  `MATCHES` doesn't reliably honor `(?i)`.
- Substring ordering wherever one name can contain another: longest-match-first
  (CPO-EL before CPO; `DUPLICATES BY TYPE` before `BY TYPE`; prefer exact-match
  once a set is user-extensible — "Deposit" contains "po").
- Never clear a sheet before the pipeline that refills it has fully succeeded;
  destructive writes go LAST.
- Volatile full-column formulas in a config sheet can make it unreachable to code
  (~100s timeout) while the browser opens fine — that split is the tell.
- CSV uploads: strip the leading U+FEFF BOM per file; guard mid-file headers.

**Pipedrive API**
- Coerce numeric ids to `Number` on writes — BY TYPE, never blanket (string ids
  create the deal fine, then product-attach/field-set silently fail).
- v1 deal custom fields are TOP-LEVEL 40-char hash keys (+ `<key>_currency` for
  monetary) — the `{custom_fields:{…}}` wrapper is v2-only and silently no-ops.
- Never guess a v2 shape from v1 or the docs — confirm live: v2 omits `success`;
  deactivated = `is_linkable:false` (not `is_deleted`); variations are v2-only,
  fetched per product; v1 GET under-reports line tax (verify via deal total or v2).
- Line-item update = `PUT` with the deal-product ATTACHMENT id, not `product_id`.
- Values a third-party automation owns: poll for the row, then set ONLY-IF-EMPTY;
  when the current value can't be read, skip — never overwrite.

**Git / clasp / MCP**
- GitHub MCP: fresh SHA fetched immediately before every write; explicit `branch`;
  `Code.gs` exceeds the push limit (local git for it); verify pushes by blob-SHA
  compare, not content re-read. Pull fresh before editing.
- A same-size `Copy-Item` (preserves source mtime) over a tracked file can match
  git's stat cache exactly — `git status` reports clean and `git checkout -- <file>`
  no-ops (a promote left `.clasp.json` on PROD). Verify swapped-and-restored files
  by `git hash-object` vs `HEAD:` blob; force restores by deleting first.
- A standalone clasp sub-project inside this repo: `clasp create` in a SIBLING temp
  dir (it walks up and finds the parent `.clasp.json`), copy `.clasp.json` in, and
  add the subfolder to the main `.claspignore` (clasp's namespace is flat).
- Sheets MCP: `update_cells` rejects a leading `=` (`batch_update_cells` writes real
  formulas); `unmergeCells` before `repeatCell`; delete columns right-to-left;
  60 reads/min — batch and back off on 429.

## Backlog & to-do

Not tracked here. The active to-do, housekeeping, hardening backlog, and working
agreements live in the brain (fresher and richer):
`~/Documents/claude-brain/01-Projects/gas-ops-v2/open-issues.md` — pull via
`/brain-find` or the brain skill. Deferred designs (Trim Cleanup, Order Types,
Capacity Plan) are specced in the Bridge doc.

## Reference docs

Read on demand (NOT auto-loaded):
- `docs/LEARNINGS.md` — the full gotcha/incident record behind the Recurring-traps
  list above. Read it before deep work in an unfamiliar subsystem. (De-auto-loaded
  July 2026 to save ~14k tokens/session; the brain carries distilled copies in
  `03-Resources/google-apps-script/` and `03-Resources/google-sheets/`.)
- `docs/GAS_ShortCut_OPS_Bridge_System.md` — exhaustive system reference + full
  changelog; **canonical source of truth** for any exact invariant, schema, column
  index, or feature history. (De-auto-loaded to save ~56k tokens/session.)
- Brain vault (`~/Documents/claude-brain/01-Projects/gas-ops-v2/`): `project-brief`,
  `architecture` (schema quick-ref), `open-issues` (backlog), `ui-patterns`
  (SPA/theme detail); plus `03-Resources/pipedrive/integration-notes`. Pull via the
  brain skill / `/brain-find`.
- `GAS_ShortCut_OPS_Development_Plan.md` — roadmap incl. V3 direction.

V3 (FastAPI + React + PostgreSQL) is paused; the GAS ShortCut OPS config model is
its canonical spec — don't extend the old Flask prototype.
