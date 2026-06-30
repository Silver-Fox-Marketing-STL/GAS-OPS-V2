# GAS ShortCut OPS — SilverFox Vehicle Graphic Production System

GAS ShortCut OPS 1.0 (production; formerly versioned SilverFox V2, 1.0–2.13).
Config-driven Google Apps Script that produces vehicle window banner graphics
(Shortcuts / Shortcut Packs) for automotive dealers: imports scraper inventory,
matches ordered VINs, generates QR codes, and builds CSVs for Adobe Illustrator
variable data printing. One universal script + one universal template replaces
the legacy V1 system's ~42 per-dealer functions. **43 configured dealers, 29 active** (June 25, 2026).

Nick is the primary developer and is using this project to learn Git/programming —
explain reasoning and use beginner-friendly guidance, but stay efficient.

## Expertise & approach

Beyond the always-on ponytail style (lazy senior dev — the simplest thing that
actually works), operate as a **domain expert** in this stack. Expert means:
know the failure mode *before* writing the code, name the invariant you're
protecting, and reach for the batched / native / one-line tool first.

- **Modern JavaScript (GAS V8 runtime).** ES6+ — `const`/`let`, arrow fns,
  destructuring, template literals, `Map`/`Set`. But: no Node/npm at runtime, and
  Apps Script services are **synchronous** (no real `async/await` for Sheets/Drive/UrlFetch).
- **Google Apps Script — the runtime *is* the constraint.** 6-min execution cap;
  URL/Drive/Sheets quotas; `LockService` for concurrency; `PropertiesService`
  (cross-execution) for state/progress; `CacheService` + per-execution module caches
  for hot reads. **Batch every network/Drive/Sheets call** (`UrlFetchApp.fetchAll`,
  one `setValues`) — per-item calls in a loop are the #1 way to blow the time limit.
- **Google Sheets as a datastore.** `getValues()` returns typed cells (numbers,
  booleans, Dates); QUERY silently drops mixed-type minorities; formula recalc needs
  a settle delay; fixed-width schemas are **append-only**; volatile full-column
  formulas in a config sheet can make it unreachable to code.
- **HtmlService web apps.** The SPA-in-a-modal shell, `<?!= include_() ?>` templating,
  the `google.script.run` client/server boundary (no Date serialization, silent fail
  on private/missing fn names), one shared JS scope across fragments. Native HTML/CSS
  before JS, always.
- **Data analytics.** Long-format over wide for anything unbounded; flat,
  formula-free tables that port 1:1 to SQL; aggregate in the cheapest layer;
  reference a user-entered label by cell, never inline it into a formula.

**Canon — lean on it, don't re-derive:** `docs/LEARNINGS.md` (every hard-won gotcha
above is catalogued there with the real incident), the **Invariants** section below,
and `docs/GAS_ShortCut_OPS_Bridge_System.md` (read on demand — NOT in context; Read
it for exact invariants/schemas/history). Treat LEARNINGS.md as required reading,
not optional.

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
  Single deployed branch is `main` (`feature/health-monitoring` merged June 2026;
  `pipedrive-integration` merged to `main` June 24, 2026 — v2.12;
  `feature/dynamic-vehicle-types` merged to `main` June 25, 2026 — v2.13).
- **Deploy:** edit locally → commit/push to GitHub → `clasp push` to Apps Script.
  Rollback = checkout last good commit on `main` and `clasp push`.
- **Sheets MCP:** never edit anything outside the "Claude Sandbox" Drive folder.
  Reads are fine anywhere.

## Repo / environment

- Repo: `Silver-Fox-Marketing-STL/GAS-OPS-V2` — `Code.gs` (~7,160 lines;
  Section 31 = Pipedrive integration)
  plus the **SilverFox App** (single-modal SPA, June 2026): `App.html` shell
  (sidebar nav + `<?!= include_() ?>` templating), view fragments `ViewRun`
  (Option-B layout — top control bar + narrow VIN box + a **live dealer-scoped
  inventory table** populated as VINs are typed via `getDealerVinData`/`buildVinDataMap_`,
  miss → "not in this dealer"; the old Transcription page was retired into this
  June 26 2026), `ViewImport`, `ViewVinLog`, `ViewRules` (a sidebar view, not a modal — two
  top-level tabs `Filtering Rules | Pipedrive` with per-tab unsaved dots, a
  collapsible `<details>` Dual-Site Source Split, a unified "Per Dealer Overrides"
  collapsible, and ⓘ info-toggles; Type Rules panel removed), `ViewNorm`, `ViewUtilities`,
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
- Script is bound to SF_SYSTEM_MASTER; menu: **SilverFox V2** (the literal in-code
  Apps Script menu label — unchanged; the system is now called **GAS ShortCut OPS**).

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
- Vehicle type is a **dynamic registry** *(v2.13 — merged to `main` June 25, 2026; deployed;
  active)*: `CANONICAL_TYPES = ['New','PO','CPO','CPO-EL']` (protected built-ins) +
  user-added extras stored in `PIPEDRIVE_SETTINGS` key `vehicle_types`.
  **`getCanonicalVehicleTypes_()`** = the de-duped union (built-ins **always first**),
  cached per execution, **fail-safe** (built-ins present even if the stored value is
  missing/malformed → with no row it's exactly the canonical four, byte-identical to before).
  `PD_TYPE_KEYS` was **removed** → `CANONICAL_TYPES` + `CANONICAL_BILLING_FIELDS`
  (canonical type → legacy billing-field names). `readBillingTotals_` now also returns a
  **`byType:{type:{gross,dupes}}`** map but **keeps the legacy `totalNew/…/cpoElDupes`
  fields** (derived via `CANONICAL_BILLING_FIELDS`) so **RUN_LOG cols G–N + ORDER_STATS
  stay byte-identical**; `buildLineItems_`/`bySourceToBilling_` read `byType` (qty still
  GROSS). `buildTypeRulesFromProductMap_` now **sorts longest-match-first** (generic
  substring safety for `matchRule_`, replaced the hardcoded `CPO-EL>CPO` list). New types
  are **register-only** (inert until vehicles normalize to them); `removeVehicleType` is
  guarded by `dealersUsingType_` (scans `filtering_rules` — incl. `targeting_rules`
  `{field:"type"}` nested groups + `billing_split(field:"type")` — and PIPEDRIVE
  product maps). Per-type analytics go in a NEW long-format `ORDER_TYPE_STATS` tab + a
  dynamic dashboard; **the fixed log schemas (RUN_LOG/ORDER_STATS/IMPORT_STATS) are NOT
  widened**. Anything enumerating types **must** read the registry, never a literal four.
  See Bridge doc "Vehicle-Type Registry". **Template formulas updated LIVE
  (behavior-preserving):** `TYPESTOCK`/`TYPEVIN` (SF_UNIVERSAL_TEMPLATE
  ORDERMATCH N2/R2) use exact type-match with an `UPPER(TRIM(G))&" - "` else — a custom
  type prints its own uppercased name instead of "USED" (canonical four unchanged); this is
  the live behavior. The old `SEARCH` cascade hardcoded the four and defaulted the rest to USED.
- ORDERMATCH cols A–I are the QUERY spill zone — never write there in the template.
  `FIELD_TO_COL` in Code.gs is the only runtime mapping; headers/FIELD_CODES tab
  are documentation. `buildCSVSheet_` reads 100 cols. `PRICE_TAGLINE` = col 21 (U).
- The **Pipedrive product map is the SOLE per-type config** *(v2.12 — supersedes the
  earlier fallback model; the fallback is gone)*: each `product_map[type]` (and
  `source_product_map[group][type]`)
  entry is `{product_id, variation_id?, schema?, utm?}`, carrying both the CSV
  **schema** and the QR **UTM**. **`runDealer` no longer reads `type_rules` (col O)** —
  after matching it reads the product maps via **`getCsvProductMaps_`**, **validates**
  via **`validateProductMapForRun_(matchedTypes, mainMap)`** (a matched type missing a
  `product_id` OR a `schema` → **the run THROWS/BLOCKS** with "set them in Dealer Rules →
  Pipedrive"; UTM is not required), then builds synthetic run rules via
  **`buildTypeRulesFromProductMap_`** (one `{match, csv_schema: entry.schema, utm:
  entry.utm}` per mapped type, **ordered CPO-EL before CPO** — load-bearing, substring
  match). Those synthetic rules feed `buildLinks_`/`buildUtmFormula_` (QR UTM) and
  `buildCSVSheet_`/`csvOutputGroups_`/`resolveRuleSchema_` (CSV schema/grouping)
  **unchanged** — only the *source* of the rules changed. CSV sheets are **grouped by
  the resolved schema** (one schema → `CSV`, else `CSV_<SCHEMA>`). **There is NO
  run-time fallback to col O and NO `*` catch-all** — an unmapped/unexpected type blocks
  the run. **col O `type_rules` is DORMANT** — only the migration source
  (`migrateTypeRulesIntoProductMap`, run once from the editor) + a historical record;
  `getTypeRules_` is kept for that migration only. The Type Rules editor tab is removed;
  UTM is a product-picker column. `buildLineItems_` ignores `schema`/`utm`.
- `filtering_rules` `targeting_rules[]` (IF nested AND/OR `group` THEN `action`;
  actions `drop_on_import`/`exclude_cao`/`exclude_order`) + `cao_exclude_types`
  (replaced the old `conditions[]` June 17 2026): `applyFilteringRules_(…, phase)` —
  `exclude_order` applies in **both** phases (Bypass overrides), `exclude_cao` +
  `cao_exclude_types` are **CAO-only**; `drop_on_import` fires at import, not here.
  Engine `conditionMatches_`/`groupMatches_`/`ruleMatches_` **fails SAFE** (misconfig
  or empty group → no match → vehicle kept; a typo must never empty a dealer). Fields
  map via the cached, schema-driven `getFilterFieldIndex_()` (replaced static
  `FILTER_FIELD_INDEX`), surfaced to the Rules Editor by `getRulesEditorBootstrap`.
- VIN and Stock must be `String()`-converted **and** `@`-formatted before AND
  after `setValues()` (QUERY mixed-type bug).
- VIN logs are never written automatically during a run — explicit commit/rollback
  via the VIN Log Updater (key: deal ID + `committed_at`). Manually entered VINs
  are always produced; the log only flags duplicates in billing. **`test` runs are
  never committed** — `commitLatestRun` throws on a `test` col-D and `commitRunRows`
  skips it (returns `skippedTest`); the VIN Logs UI disables Commit for them.
- VIN is always the vehicle primary key. `use_stock_not_vin` is FALSE for every
  dealer (planned replacement: stock→VIN fallback lookup — see to-do).
- `scraper_location_name` for CDJR_OF_COLUMBIA is
  `"Joe Machens Chrysler Dodge Jeep Ram"` — matches the live scraper feed;
  do not change until the scraper is updated.
- `scraper_location_name` audit (June 18, 2026, all 29 active dealers):
  **BMW of West St. Louis was the only real drift — now resolved.** The feed
  renamed the location to `"BMW of West St. Louis"` (with a period) but DEALERS
  col J was `"BMW of West St Louis"` (no period); the exact-match miss made
  `getDealerScraperData_` pull zero inventory (CAO/runs broken) and threw a false
  import-health warning. Fixed by setting J6 to `"BMW of West St. Louis"` (live
  sheet edit, not a code change). **Serra Honda O'Fallon and CDJR of Columbia
  are NOT drift** — their config values match the feed (CDJR's is the legacy
  `"Joe Machens Chrysler Dodge Jeep Ram"` above). 12 dealers were unconfirmed
  only because they weren't in the latest import.
- NORM_MAPS cols E+ are a **static, on-demand reference area** (sorted unique
  SCRAPERDATA values per column) regenerated by `refreshNormReference()`
  (menu: **Refresh Norm/Field Reference**) — the script reads only cols A–C, so E+
  is inert scratch space. The old live `UNIQUE()` formulas were removed June 10, 2026:
  recalculating them over a 10k+ row SCRAPERDATA made programmatic access to
  SF_DEALER_CONFIG time out (~100s `Service Spreadsheets failed`) while the browser
  UI stayed fine. Do **not** reintroduce volatile full-column formulas here.
- Stats/dashboard writes (`writeImportStats_`, ORDER_STATS side-write,
  `refreshDashboard_`) are non-fatal try/catch — keep it that way.
- Pipedrive *(v2.12 — merged to `main` June 24, 2026; deployed, activates per dealer
  once live config is filled in)*: the **`PIPEDRIVE` tab** in SF_DEALER_CONFIG is
  **cols A–L (12)**, keyed **one row per `(dealer_key, group)`** (PRIMARY + one per
  `billing_split` group, each with its own org + per-type `product_map`, now
  `{type:{product_id, variation_id?, schema?, utm?}}` — the **product map is the SOLE
  per-type config**: `schema`/`utm` per mapping drive CSV layout/grouping + QR UTM, so
  `type_rules` (col O) is no longer read by the run; a matched type missing a
  `product_id` or `schema` **blocks the run**). **Col J = `field_overrides`**
  (`PDCFG.FIELD_OVERRIDES`; was `field_map` in v1): JSON keyed by global rule `id` →
  `{off:true}` or a full replacement rule. **Col L = `source_product_map`**
  (`PDCFG.SOURCE_PRODUCT_MAP = 11`): JSON
  `{ "<sourceGroupName>": {type:{product_id, variation_id?, schema?, utm?}} }` —
  per-type products for a `source_split` dealer's secondary CSV output, pushed on the
  **same** deal; `{}` for non-source-split dealers. Secrets (`PD_API_TOKEN` etc.) live
  in **ScriptProperties only**, never in repo/sheet.
- Pipedrive deal-field mapping is **GLOBAL**, in the **`PIPEDRIVE_SETTINGS`** tab
  (key/value; row `deal_field_rules` = JSON array). Each rule is one of **three**
  modes: **copy** (`{id, deal_field, type, mode:"copy", org_field, option_map?}`),
  **conditional** (`{id, …, mode:"conditional", group, then_value, else_value}` — IF
  org-field conditions THEN/ELSE), or **constant** (`{id, …, mode:"constant", value,
  if_empty}` — a fixed value; applies **without** the org). **`if_empty` fail-safe:**
  on a New Deal (create) the value is **always set**; on a Link (existing) it's set
  **only if the deal field is empty**, and **skipped — never overwritten — if the
  current value can't be read** (so e.g. a required `Proof` is never clobbered).
  Resolved at push time by `pdResolveDealFields_(orgId, globalRules, overrides,
  currency, isNewDeal, existingDealFields)` (global rules + per-dealer
  `field_overrides`; constants applied first without the org, an org-fetch failure
  returns the constant results not `{}`), **replacing `pdResolveFieldMap_`**.
  `isNewDeal` is threaded from the create paths (→ true) and link paths (→ false);
  `pushRunToPipedrive`'s signature/gates/returns stay unchanged.
- Pipedrive org-condition engine `pdOrgConditionMatches_`/`pdOrgGroupMatches_`
  (reads an org's `custom_fields` by key) **fails SAFE** (unknown field/op, empty
  values, empty group → no match) and is a **parallel mirror** of the targeting
  engine — it must **not** touch `conditionMatches_`/`groupMatches_`/`ruleMatches_`
  (those stay byte-for-byte unchanged).
- Pipedrive products are a **global catalog with no native product↔org link** —
  scoping the per-dealer product picker to an org uses the **effective** product→org
  field from **`getEffectiveProductOrgField_()`**: the explicit **`product_org_field`**
  setting (`PIPEDRIVE_SETTINGS` row; the **KEY** of a product *Organization-type*
  custom field that stores the org id) **if set, else AUTO-DETECTED** as the first
  product custom field with `field_type` `org`/`organization` (blank explicit +
  none found = show all). When a field is in effect `pdListProducts_` fetches **via
  v2 `/products?custom_fields=<key>`** and enriches each product with `customerOrgId`
  (`pdExtractOrgId_`); `pdProductVisible_` scopes by `customerOrgId === org_id` with a
  per-group **show-all** fallback and **always keeps an already-saved `product_id`**
  (never drop a mapping on save). Catalog cache key is **`pd_catalog_v2`**
  (`savePipedriveProductOrgField` busts it). The stored `{product_id, variation_id?}`
  mapping is unchanged — only the options offered.
- A product deactivated in Pipedrive (**`is_linkable === false`** in v2; v1 fallback
  `selectable===false || active_flag===false`) can't be added to a deal:
  `pdListProducts_` flags it `inactive`, the picker hides inactive products from NEW
  mapping (an already-saved-then-deactivated one stays, flagged), and
  `pushRunToPipedrive` **preempts before creating/linking any deal** — a mapped,
  would-be-pushed (qty>0) inactive product returns `stage:'inactive_product'`
  (no orphaned deal). Skipped on a field-only retry (products already attached).
- Bulk dealer→org linker (one-time setup, Pipedrive Settings): **`getDealerOrgLinkProposals()`**
  is **READ-ONLY** (proposes an org per active dealer by name via `pdListAllOrganizations_`
  + `normalizeOrgName_`/`matchOrg_`; `matchType` exact/strong/weak/none — writes nothing);
  **`saveDealerOrgLinks(links)`** upserts **only each dealer's PRIMARY-row org**
  (preserves `product_map`/`field_overrides`; creates a PRIMARY row if absent;
  never touches product maps or `billing_split`-group rows). Review-gated — nothing
  writes until the user confirms.
- **All Pipedrive mappings key on stable IDs/keys; names are display-only
  (rename-safe).** `product_id`/`variation_id`, `org_id` (`org_name` is a cache),
  deal/org fields by 40-char **key**, enum/THEN/ELSE/condition values by **option id**,
  deals by numeric `deal_id`. Persist references by id/key, never by name — so the
  product-revision workflow (edit the original to keep its id, deactivate the
  duplicate) can't orphan a mapping.
- Pipedrive idempotency anchor: the deal ID is written to **RUN_LOG col D** the
  instant the API returns it, and a **numeric col D = "deal already created"**
  (dup guard) — so a retry never makes a second deal. `pdFetch_` **never throws**
  (returns `{ok,…}`) so a Pipedrive failure can never fail a run. Keep both.
- Run-Order finalize is **method-first** (v2.12):
  each post-run card picks **New Deal / Existing / Test** then Finalizes once
  (controls from `getRunPushModes(dealerKey, group)` → `{test,newDeal,existing,reason}`,
  carried as `pushModes` on each `pendingRuns` entry).
  **New Deal (`finalizeRunNewDeal`) creates the deal FIRST** (real numeric id), then
  finalizes — so the "no RUN_LOG row without a real deal id" invariant still holds
  with **no placeholder**. Because the deal exists before the row (numeric-col-D dup
  guard not yet available), New Deal is made retry-safe by a **second anchor: the
  `pd_new_<outputDocId|group>` ScriptProperties token cache** — the deal id (then
  `rowIndex`) is cached the instant PD returns it, so a retry adopts it instead of
  creating a 2nd deal/row; cleared on success with the `pd_push_<row>` state. Keep
  **both** anchors (col-D guard for link/retry, `pd_new` cache for create-before-row).
  Existing (`finalizeRunExisting`) validates via `pdGetDeal_` before writing a row.
  `pushRunToPipedrive` was split into `pdResolveRunContext_`/`pdResolveDealId_`/
  `pdCheckInactiveProducts_`/`pdApplyDealContents_` with **no** behavior/signature
  change — the ViewVinLog push + link/retry paths are unchanged.
- Pipedrive install cost + Design no-charge variation *(v2.12)*:
  `pdApplyInstallCost_` + `pdApplyDesignVariation_`
  run inside `pdApplyDealContents_` **after** products + fields, on **every** push
  (create + link), each gated by its own `state` flag (`installDone`/`designDone`,
  retry-safe). Config-driven via the **`install_cost_config`** `PIPEDRIVE_SETTINGS` row
  (`PD_INSTALL_COST_KEY`; `getInstallCostConfig_`) — **nothing dealer- or id-hardcoded**,
  inert until set. Install price = the org's "Program Install Cost" option's
  `percent × subtotal` (subtotal **EXCLUDES the design + install products**), rounded to
  the cent, else 0; the install line is **add-or-update** (idempotent). Design variation
  is set **only if the Design line's variation is empty** (`pdFieldEmpty_`) — never
  clobber a template-request deal's existing Design; the Design line is **polled** for
  (a PD automation adds it post-create), `designPending` if it hasn't fired (a re-push
  sets it). `pdUpdateDealProduct_` = the only line-item UPDATE
  (`PUT /deals/{id}/products/{attachmentId}`, keyed on the attachment `id`, not
  `product_id`). `pushRunToPipedrive` signature/gates/returns unchanged.
- Pipedrive billing-PDF attach *(v2.12)*:
  `attachBillingPdfToDeal_` (via `state.billingPdfDone` in `pdApplyDealContents_`,
  after `designDone`, gated by the new `runCtx` 8th param) generates a formatted PDF
  of the run's BILLING sheet and attaches it to the deal on **every** push. It is
  **best-effort / never fails a push** (own try/catch — like the stats/dashboard
  writes; a failure flags `billingPdfPending` and a re-push retries) and **idempotent
  — one billing PDF per deal** (`pdDealHasBillingPdf_` does a `GET /files` by the
  **date-free** filename). The working **BILLING sheet is never modified** — the PDF
  is built fresh in a temp tab (`_BILLING_PDF`, always deleted). `pushRunToPipedrive`
  signature/gates/returns unchanged.
- Pipedrive line-item quantity is **GROSS** — `buildLineItems_` does **not**
  subtract VIN-log dupes (a re-printed VIN is still produced and billed); reads the
  gross `totalNew`/`totalPO`/`totalCpo`/`totalCpoEl` from `readBillingTotals_`. All
  dealers. (Was net-of-dupes.)
- Pipedrive line-item **tax** must be sent explicitly — the API does **not** copy a
  product's catalog "Tax %" onto a deal line (only the UI does). `pdListProducts_`
  captures `tax` from the catalog (v1 + v2); `buildLineItems_`/`mergeLineItems_`
  carry it; `pdAttachProducts_`/`pdAddDealProduct_` send `tax` + **`tax_method:
  'exclusive'`** (SilverFox never includes tax in the price). NB: the v1 GET
  `/deals/{id}/products` under-reports `tax` as 0 — verify via the deal total or v2.
  The attach dup-guard skips products already on a deal, so a re-push does **not**
  retro-fix a line attached at 0% by an earlier push (fresh attaches only). See the
  LEARNINGS "Pipedrive does NOT auto-copy product tax" note.
- Two product-partition axes, both driven generically from `filtering_rules` (no
  per-dealer code): **`billing_split`** = separate deals, each its own org +
  `product_map` (e.g. MBCC); **`source_split`** = one deal, separate products per
  source via `source_product_map` (col L, e.g. Frank Leta). The Dealer Rules →
  Pipedrive screen renders the right product config for either automatically.
  Source-split push merges `product_map × main qty` + `source_product_map[group] ×
  secondary qty` by product+variation (`readBillingBySource_` → `bySourceToBilling_`
  → `mergeLineItems_`); unchanged until a `source_product_map` is set.

## Current to-do (verified June 10, 2026)

1. Maintenance/Hybrid order types — two-stream modal (CAO + manual), merge logic,
   type override for Auffenberg Courtesy Loaners (New in scraper → print as Used).
2. MBCC/Sprinter shared scraper location — billing split design decision pending.
3. Stock→VIN fallback lookup (replaces unused `use_stock_not_vin` concept).
4. Glendale `model_trim_split` key is inert in `data_transforms` — implement or remove.
5. ✅ **DONE — Pipedrive integration (v2.12, merged to `main` June 24, 2026).** Code is
   deployed; it **activates per dealer** once the live config is filled in: ScriptProperties
   secrets + `PIPEDRIVE_SETTINGS` global rules + per-dealer `PIPEDRIVE` rows (incl. the
   product map, now the sole per-type config). Remaining = that live-config rollout + the
   end-to-end test pass. See the Bridge doc "Pipedrive Integration" section.
6. Trim cleanup — trims overflow the print template; full analysis + validated
   auto-cleanup design (global `cleanTrim_` regex pass, feature-flag + dry-run
   gated, plus residual exact-match rules) captured in the Bridge doc
   ("Trim Normalization & Cleanup — Analysis & Deferred Design"). Approach decision
   (A full / B phased / C exact-only) pending.
7. Housekeeping: README `#ERROR!` cells, delete `VINLogMigration.gs`/`FolderSetup.gs`
   from Apps Script, `git rm test-write-access.txt`, fix stale "Scraper #N/A" notes
   on the active Jefferson City dealers.
8. Log capacity (watch, don't build yet): when any log tab passes ~25k rows or
   imports/dashboard slow down, build `archiveOldLogs()` per the "Capacity & Log
   Growth Plan" section in the Bridge doc (12-month hot window → SF_LOG_ARCHIVE;
   never archive SF_VIN_LOGS).

## Reference docs

@docs/LEARNINGS.md  *(auto-loaded — required reading; the hard-won gotchas)*

Read on demand (NOT auto-loaded — Read the file when you need it):
- `docs/GAS_ShortCut_OPS_Bridge_System.md` — the exhaustive system reference +
  full changelog. **Canonical source of truth.** Read it whenever you need an exact
  invariant, schema, column index, or a feature's history. De-auto-loaded to save
  context (~56k tokens/session); its precision is unchanged — just no longer free.
- `GAS_ShortCut_OPS_Project_Knowledge_Base.md` (compressed decision history),
  `GAS_ShortCut_OPS_Development_Plan.md` (roadmap incl. V3 direction).

V3 (FastAPI + React + PostgreSQL) is paused; the GAS ShortCut OPS config model is its
canonical spec — don't extend the old Flask prototype.
