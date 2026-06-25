# SilverFox Marketing — Vehicle Graphic Production System V2
### Bridge System Documentation | Last Updated: June 25, 2026

---

## System Status & Context

**Role:** Bridge System — Near Production (Final Bug-Hunt Testing)
**Platform:** Google Sheets + Google Apps Script (config-driven)
**As of:** June 2026
**Development branch:** `main` — `feature/health-monitoring` merged June 2026; **`pipedrive-integration` merged to `main` June 24, 2026 (v2.12 — deployed)**; **`feature/dynamic-vehicle-types` merged to `main` June 25, 2026 (v2.13 — deployed)**. `main` is the single deployed branch.

V2 is in final bug-hunt testing ahead of production launch. It replaces V1's ~42 per-dealer functions and ~42 separate template spreadsheets with a single universal script, a single universal template, and a config-driven architecture. V2 runs on Google Sheets — no server or Python dependency required. The **Pipedrive integration** (v2.12) is now deployed on `main`; it activates per dealer once its live config is filled in (ScriptProperties secrets, `PIPEDRIVE_SETTINGS` global rules, and the per-dealer `PIPEDRIVE` rows — including the product map, which is now the sole per-type output config).

**System Hierarchy:**
- **V1** — Legacy. Documented in `SilverFox_V1_Production_System.md`. Superseded by V2.
- **V2 (this document)** — Near-production bridge system in final bug-hunt testing.
- **V3** — Long-term Python-based replacement. Documented in `SilverFox_V3_Flask_System.md`. Development paused until V2 is fully stable.

---

## Changelog

| Date | Version | Change Summary |
|---|---|---|
| June 25, 2026 | **2.13** | **Dynamic vehicle-type registry — MERGED TO `main` (deployed + active).** Vehicle **type** was a hardcoded four (`New`/`PO`/`CPO`/`CPO-EL`) baked into ~14 sites; it's now a **dynamic registry** (built-ins + user-added types) so new types can be added on the fly from the Dealer Rules screen and are recognized everywhere — Allowed-Types/CAO pills, seasoning, the Pipedrive product picker, billing, line items, and analytics. Backend Code.gs + UI `ViewRules.html`/`ViewImport.html`. With no extra types added the registry falls back to exactly the canonical four, so behavior is byte-identical to before. (1) **Storage + single source of truth:** new `CANONICAL_TYPES = ['New','PO','CPO','CPO-EL']`; extras stored as a JSON array in **`PIPEDRIVE_SETTINGS`** key **`vehicle_types`** (`PD_VEHICLE_TYPES_KEY`). **`getCanonicalVehicleTypes_()`** = de-duplicated union (built-ins **always first** + stored extras), cached per execution — **fail-safe** (built-ins present even if the stored value is missing/partial/malformed; a stored value can only ADD, never drop/reorder). `PD_TYPE_KEYS` **removed**, folded into `CANONICAL_TYPES` + **`CANONICAL_BILLING_FIELDS`** (canonical type → legacy billing-field names). Client-callable `addVehicleType(label)` (validates: non-blank, ≤40 chars, no case-insensitive dup, rejects reserved billing labels — "Total Ordered"/"Total Duplicates"/etc. and any "… Dupes"), `removeVehicleType(label)` (guarded), `getVehicleTypes()`. (2) **Backend dynamic, fixed logs untouched:** `readBillingTotals_` returns a **`byType:{<type>:{gross,dupes}}`** map AND keeps the legacy `totalNew/…/cpoElDupes` fields (derived via `CANONICAL_BILLING_FIELDS`) → **RUN_LOG cols G–N + ORDER_STATS byte-identical**; `buildLineItems_`/`bySourceToBilling_` read `byType` (qty still **GROSS**); `renderBillingSheet_` `TYPE_ORDER = getCanonicalVehicleTypes_()` ("⚠ unexpected type" now = in the data but not registered); `buildTypeRulesFromProductMap_` replaced its hardcoded `['CPO-EL','CPO','New','PO']` with **sort-by-length-descending (longest match first)** — generic substring safety for `matchRule_`. (3) **UI (`ViewRules.html`):** Allowed-Types + CAO pills + seasoning dropdown render from the registry (`renderTypePills`); **"+ Add type"** (`addNewType`) + **× on user-added pills** (`removeTypeFromPill`, guarded; built-ins protected), type read from the pill's `data-type` (apostrophe-safe). Product picker **filtered to the dealer's Allowed Types** via `pdEffectiveTypes()` (none selected = all); a hidden type's mapping is **preserved automatically** because `buildProductMap_` serializes the MODEL (`pdSelections`), not the rendered rows. (4) **Assignment is separate (register-only):** a new type is **inert until vehicles normalize to it** (a NORM_MAPS rule, or the feed already uses the label); "Add New Type" only registers the label. (5) **Remove guard scans EVERY type-reference site:** `removeVehicleType` refuses a built-in (`isCanonicalType_`) or an **in-use** type; **`dealersUsingType_`** scans every dealer's `filtering_rules` + every PIPEDRIVE row, returning blocking dealer names. `filterRulesUseType_` checks `allowed_types`, `cao_exclude_types`, `seasoning[].type`, `billing_split(field:"type")`, and `targeting_rules` conditions (`{field:"type"}` incl. nested AND/OR groups); `pdRowUsesType_` checks `product_map` + `source_product_map` keys. *(`ed0b5f8` config review caught that `targeting_rules` + `billing_split` were initially missed — live Bommarito/Pundmann/Dave Sinclair St. Peters use `{field:"type"}` targeting conditions — and fixed the gap.)* (6) **Analytics — dynamic dashboard + a new long-format tab, fixed schemas untouched:** new **`ORDER_TYPE_STATS`** tab (`timestamp \| dealer_key \| dealer_name \| order_id \| type \| produced \| dupes`) written by `writeRunLog_` from `billing.byType` (one row per type present, non-fatal, auto-created via `createOrderTypeStatsSheet_`); `computeImportReview_` tallies `locationDetail.byType`; `refreshDashboard_` INVENTORY gets a **dynamic column per registered type + "Other"** plus a new **RUNS BY TYPE** section (per-type COUNTIF/SUMIF over `ORDER_TYPE_STATS`, criterion references the type cell so a quoted label can't break it); RUNS BY DEALER stays the last spilling QUERY (its per-type sums still read fixed RUN_LOG cols G–J); ViewImport's "unexpected type" badge reads the registry. **RUN_LOG / ORDER_STATS / IMPORT_STATS keep their fixed canonical-four columns** (a new type folds into existing totals/"Other" there). Verification: `test-verifier` all gates (syntax, `PD_TYPE_KEYS` removed, no SPA cross-fragment collisions, 31/31 unit tests, byType + legacy back-compat); `config-rules-reviewer` behavior-preserved + caught/fixed the remove-guard gap. **Verified live** — after `clasp push` the user added a real custom type and ran an end-to-end test order that worked. The registry is now **active** (the live `PIPEDRIVE_SETTINGS` has a `vehicle_types` row). See **Vehicle-Type Registry** below. |
| June 24, 2026 | **2.12** | **Pipedrive Integration MERGED TO `main` (deployed).** The entire Pipedrive arc — `pipedrive-integration` plus its stacked sub-branches (`feature/pipedrive-finalize-flow`, `feature/pipedrive-install-cost`, `feature/pipedrive-followups`, `feature/pipedrive-billing-pdf`, `feature/product-driven-schema`) — landed on `main`, the single deployed branch. The detailed per-feature rows below (June 19–24, previously "branch-only / NOT shipped") are all part of this release. **What it is:** push a finalized run to Pipedrive as a deal with per-type product line items (Code.gs **Section 31** + `ViewRules.html`/`ViewRun.html`/`ViewVinLog.html`/the new global `ViewPipedriveSettings.html`) — a separate explicit step **after** in-system finalization. **Highlights:** secrets in ScriptProperties (never repo/sheet); never-throw `pdFetch_`; idempotent (Deal ID → RUN_LOG col D the instant PD returns it, numeric col D = dup guard); GLOBAL deal-field rules (`PIPEDRIVE_SETTINGS` row `deal_field_rules`) in **copy / conditional / constant** modes (the constant `if_empty` rule = the `Proof` default), with per-dealer `field_overrides`; a fail-safe org-condition engine that **mirrors** the targeting engine (which stays byte-for-byte unchanged); deactivated-product blocking (`is_linkable`); org-scoped product picker (`product_org_field`, auto-detected); bulk dealer→org linker; **gross** line-item quantities; `source_split` per-source products. **Method-first finalize** (New Deal creates the deal first / Existing links / Test) with the `pd_new_<…>` token cache. **Billing PDF** auto-attached to the deal. **Install cost + Design no-charge variation** (config-driven off the org's Program Install Cost field). **The big consolidation:** the Pipedrive **product map became the SOLE per-type config** (schema + UTM) and `type_rules` (col O) was eliminated from the run (left dormant) — the run builds synthetic type rules from the product map and BLOCKS with a prompt if a matched type has no product/schema. **Activation is per dealer once its live config is filled in** (secrets + `PIPEDRIVE_SETTINGS` rules + per-dealer `PIPEDRIVE` rows incl. the product map). See the **Pipedrive Integration** section below. |
| June 24, 2026 | 2.12 | **Pipedrive product map is now the SOLE per-type config — `type_rules` eliminated from the run (part of the 2.12 release).** **Supersedes the earlier product-driven-schema "fallback" entry from the same day** — the run-time fallback to `type_rules.csv_schema` is now **gone**. Each `product_map[type]` (and `source_product_map[group][type]`) entry now holds `{product_id, variation_id?, schema?, utm?}`, carrying both the CSV **schema** (layout/grouping) AND the QR **UTM**; the run reads both from the product map, and **`type_rules` (DEALERS col O) is no longer read by the run** (left DORMANT — migration source + historical record). Backend Code.gs; UI `ViewRules.html`. (1) **`runDealer` rework:** dropped the top-of-function `getTypeRules_`; after matching, it reads the product maps (`getCsvProductMaps_`), **validates** via **`validateProductMapForRun_(matchedTypes, mainMap)`** — a matched type missing a `product_id` OR a `schema` → the run **THROWS** ("Cannot run `<dealer>` — no product/schema set for type(s): X. Set them in Dealer Rules → Pipedrive.") via the existing try/catch → `setProgressError_` → shown in the run modal — then builds the run's rules from the product map. (2) **`buildTypeRulesFromProductMap_(productMap)`** (new, pure) — one synthetic `{match, csv_schema: entry.schema, utm: entry.utm}` per mapped type, **ordered CPO-EL before CPO** (load-bearing — `matchRule_` is substring-based), so `buildLinks_`/`buildUtmFormula_` (UTM) and `buildCSVSheet_`/`csvOutputGroups_`/`resolveRuleSchema_` (schema/grouping) work **UNCHANGED**; the synthetic `csv_schema` IS the product schema, so there's no run-time col-O fallback. (3) **`validateProductMapForRun_`** (new, pure) returns matched types missing a product or schema (UTM not required). (4) **The `*` catch-all is gone** — an unmapped/unexpected (normalization-missed) type blocks the run. (5) **`migrateTypeRulesIntoProductMap()`** (new; run once from the editor) copies each dealer's legacy per-type schema + UTM (from col O, via `matchRule_`) into its `product_map`/`source_product_map` entries — only where a product is mapped, never overwriting; idempotent. `getTypeRules_` kept for the migration only; `getDealerRulesData` still returns `typeRules` but the UI ignores it. (6) **UI:** a per-product **UTM** column added to both product pickers (round-tripped via `normalizeProductMap_`/`buildProductMap_` like `schema`); the **entire Type Rules editor panel is deleted** (`renderTypeRules`/`addTypeRule`/`saveTypeRules` + call sites; `availableSchemas` kept for the Schema column). **Risk:** the run now **REQUIRES a complete product map for every dealer — even test runs**; prerequisite = the migration + finishing the Pipedrive product config. `node --check` + 10/10 new unit tests. See **Type Rules System** + **Pipedrive Integration → PIPEDRIVE config tab** below. |
| June 23, 2026 | 2.12 | **Billing PDF auto-attached to the Pipedrive deal on every push (part of the 2.12 release; verified live).** After a deal is pushed, the system generates a **well-formatted PDF of the run's BILLING sheet and attaches it to the deal**, replacing the manual CSV-download-and-attach step (a CSV lost formatting and Pipedrive's Drive attachment view can't size columns). All new in Code.gs **Section 31** ("Billing PDF" subsection); **no UI/view-fragment changes**, and the working BILLING sheet (`renderBillingSheet_`) is **untouched** — the PDF is built fresh in a temp tab. (1) **Best-effort / non-fatal:** a new **`state.billingPdfDone`** step in **`pdApplyDealContents_`** (after `designDone`), gated by a new **`runCtx` 8th param** (`{outputDocId, group, dealerName}`) threaded from both callers (`pushRunToPipedrive`, `finalizeRunNewDeal`); a failure flags **`billingPdfPending`** (returned in the push result + appended to the success message as "(billing PDF will attach on a re-push)"), the push still succeeds, and a re-push retries. Runs on **every push — New Deal + Existing/Link**. (2) **Idempotent — one billing PDF per deal:** `pdDealHasBillingPdf_(dealId, filename)` does a `GET /files?deal_id=` and returns true if a billing PDF with the same **date-free** filename is already attached; `billingPdfFilename_(dealerName, group)` → `Billing - <dealerName>.pdf` (PRIMARY) / `Billing - <dealerName> (<GROUP>).pdf`, filesystem-sanitized and **date-free so the check matches across days**. (3) **Pipeline:** `readBillingForPdf_` parses the rendered `BILLING`/`BILLING_<group>` sheet into `{summary, byType, bySource, duplicates, dupDetail, producedVins, producedCount}` — **checking `DUPLICATES` before `BY TYPE`** because `── DUPLICATES BY TYPE ──` contains the substring `BY TYPE` (the CPO/CPO-EL substring-trap class; URL column dropped); `buildBillingPdfTab_` writes a polished banded layout into a temp tab (`_BILLING_PDF`, stale one deleted first; produced-VINs laid out by the pure helper `billingVinGrid_(vins, cols)` — column-major, filling each column to ≥15 (`MIN_PER_COL`) before wrapping, capped at 6 columns, banded-only; formatting applied as batched matrices); `exportSheetPdf_(spreadsheetId, gid)` fetches the Sheets `…/export?format=pdf&gid=…&fitw=true&portrait=true&gridlines=false…` URL with `Authorization: Bearer ScriptApp.getOAuthToken()` → PDF Blob; `generateBillingPdf_` orchestrates open → read → build → export by `getSheetId()` → **always delete the temp tab** (even on failure). (4) **Upload:** `pdAttachFileToDeal_(dealId, blob, filename)` posts to `POST /api/v1/files` with an **object payload `{deal_id, file: blob}`** so GAS auto-builds `multipart/form-data` from the Blob field (raw `UrlFetchApp.fetch` — `pdFetch_` is JSON-only); the **first file upload in the codebase**. `attachBillingPdfToDeal_` is the orchestrator (skip-if-present else generate+attach). `node --check` + 32 unit tests; **verified live** — the Sheets PDF export and the `/files` multipart upload both confirmed working (PDF generates, attaches to the deal, reads the billing data correctly). See **Pipedrive Integration → Billing PDF attachment** below. |
| June 21, 2026 | 2.12 | **Third deal-field rule mode — "Set value" (constant) (part of the 2.12 release).** The global Pipedrive deal-field rules (`deal_field_rules` in `PIPEDRIVE_SETTINGS`) gain a third **mode `constant`** alongside `copy` and `conditional`: set a deal field to a fixed value, with an optional **`if_empty`** policy. Backend Code.gs **Section 31**; UI `ViewPipedriveSettings.html` (shared rule-card editor). (1) **Rule shape** `{id, deal_field, type, mode:"constant", value, if_empty}` — constant rules apply **without** the org. (2) **`if_empty` create-vs-link semantics:** on a **New Deal** (create) the deal is treated as empty → value **always set**; on a **Linked** (existing) deal the engine reads the deal's CURRENT value and sets **only if empty** — and **skips, never overwrites, if the current value can't be read** (fail-safe). So one rule expresses "create = always; link = set-if-empty". (3) **Motivating use case — the `Proof` deal field** (single-select gating design approval): Proof = `"No Proof Required"` on every New Deal, on a Link only if empty — configured as **one** global rule, with nothing Proof-/dealer-specific in code; overridable per dealer via `field_overrides`. (4) **Backend:** `pdResolveDealFields_` now `(orgId, globalRules, overrides, currency, isNewDeal, existingDealFields)` — an org-fetch failure now returns the constant results (not `{}`); copy/conditional output is byte-identical when no constant rule is present. New helpers `pdFieldEmpty_` + `pdHasIfEmptyConstant_`; `pdApplyDealContents_` gained `isNewDeal` and (for a LINK with an `if_empty` constant) reads the deal via `pdGetDeal_` once. `isNewDeal` threaded from the create paths (`finalizeRunNewDeal`, `pushRunToPipedrive` create → true) and link paths (`finalizeRunExisting`, link → false); `pushRunToPipedrive`'s signature/gates/returns unchanged. Enum/set option ids coerce via `pdOptionId_`. 15/15 unit tests. (5) **UI:** a third **"Set value"** mode (segmented button) + a value picker (reuses `psRenderValuePicker_`) + an **"Only set if the deal's field is empty"** checkbox; per-dealer overrides inherit the mode (`ViewRules.html` untouched). See **Pipedrive Integration → Global deal-field rules** below. |
| June 21, 2026 | 2.12 | **Run-Order finalize is now METHOD-FIRST (part of the 2.12 release).** Each post-run finalization card now leads with a **push-method choice** then **one Finalize** button — **replacing** the v2.10 "type a deal ID → Finalize → separate Push to Pipedrive block" flow (a brand-new order previously had no id to finalize with except the placeholder `test`). Backend Code.gs **Section 31** (+ finalize/commit fns); UI `ViewRun.html` + `ViewVinLog.html`. (1) **New Deal — `finalizeRunNewDeal(dealerKey, entry)`** creates the Pipedrive deal **first** (real numeric id, nothing typed), finalizes the run with it (so the "no RUN_LOG row without a real deal id" invariant holds — no placeholder), then attaches products + sets fields; the deactivated-product preempt (`pdCheckInactiveProducts_`) runs **before** any deal is created. Retry-safe across the create-before-row reorder via a **`pd_new_<outputDocId|group>` token cache** (`pdNewDealCacheGet_/Set_/Merge_/Clear_`): the deal id (then `rowIndex`) is cached the instant PD returns it, so a retry **adopts** it instead of making a 2nd deal/row (the numeric-col-D dup guard isn't available pre-row); cleared on success with the `pd_push_<row>` state. (2) **Existing — `finalizeRunExisting(dealerKey, entry, existingDealId)`** validates the id via `pdGetDeal_` **first** (no row for a bad id), finalizes, links products (`pushRunToPipedrive(…,'link',id)`). (3) **Test — `finalizeRun(dealerKey, entry, 'test')`** (unchanged) never touches Pipedrive and is **now excluded from VIN-log commit** (`commitLatestRun` throws on `test`; `commitRunRows` skips it, returns `skippedTest`; UI disables Commit for test runs). (4) Card method availability from **`getRunPushModes(dealerKey, group)`** → `{test, newDeal, existing, reason}`, attached as **`pushModes`** on each `pendingRuns` entry. (5) **`pushRunToPipedrive` split into reusable helpers — NO behavior change** (`pdResolveRunContext_`/`pdResolveDealId_`/`pdCheckInactiveProducts_`/`pdApplyDealContents_`); its signature/gates/returns are unchanged, so the ViewVinLog push + link/retry paths are untouched. See the **Pipedrive Integration → Finalize-from-card** section below. |
| June 19, 2026 | 2.12 | **Pipedrive API integration (v2 model) — the base feature (part of the 2.12 release).** Pushes a **finalized** run to Pipedrive as a deal with per-type product line items, as a **separate, explicit step after** in-system finalization (never automatic; never before the RUN_LOG row + col-D Deal ID exist). Code.gs **Section 31**. (1) **Secrets in ScriptProperties** (`PD_API_TOKEN`, `PD_COMPANY_DOMAIN`, `PD_DEFAULT_PIPELINE_ID`/`_STAGE_ID`/`_CURRENCY`) — never in repo/sheet; `setupPipedriveSecrets` validates via a live `GET /users/me` before saving; `getPipedriveStatus` never returns the token. (2) **Deal-field mapping is GLOBAL, not per-dealer** — a new **`PIPEDRIVE_SETTINGS`** key/value tab holds row `deal_field_rules` (JSON array). Each rule sets one deal field in **copy** mode (`{id, deal_field, type, mode:"copy", org_field, option_map?}` — old `field_map` behavior) or **conditional** mode (`{id, deal_field, type, mode:"conditional", group, then_value, else_value}` — IF org-field conditions THEN/ELSE). `group` is the targeting-rule shape (`{match, children:[{field,op,values}|nested]}`) but `field` is a Pipedrive **org-field** key. New **org-condition engine** `pdOrgConditionMatches_`/`pdOrgGroupMatches_` (reads an org's `custom_fields` by key; **fails SAFE**) — a *parallel mirror* of the targeting engine, which is **byte-for-byte unchanged**. Server: `getPipedriveGlobalRules_`/`getPipedriveGlobalSettings`/`savePipedriveGlobalSettings` (stable `id`s), `getPipedriveSettingsBootstrap`, `getOrCreatePipedriveSettingsSheet_`. (3) **`PIPEDRIVE` tab**, one row per `(dealer_key, group)`, cols A–L (`dealer_key, group, org_id, org_name, product_map` {type:{product_id,variation_id?}}, `deal_title_template, pipeline_id, stage_id, currency, field_overrides, active, source_product_map`) — a PRIMARY row + one row per `billing_split` group, each with its own org **and** product map (how MB Creve Coeur's two orgs are handled). Col L `source_product_map` (`PDCFG.SOURCE_PRODUCT_MAP`) holds per-source products for a `source_split` dealer's secondary CSV output, pushed on the same deal. **Col J repurposed `field_map` → `field_overrides`** (`PDCFG.FIELD_OVERRIDES`): JSON keyed by global rule `id` → `{off:true}` (disable for this dealer) or a full replacement rule. Resolution `pdResolveDealFields_(orgId, globalRules, overrides, currency)` (**replaces `pdResolveFieldMap_`**) applies overrides to the global rules, evaluates against the org, returns the flat v1 top-level deal-field map. Type Rules (col O) unchanged. (4) **Product variations (v2):** `product_map` values are `{product_id, variation_id?}` (bare id tolerated); new `getProductVariations`/`pdListProductVariations_` lazily fetch `GET /api/v2/products/{id}/variations` (**v2-only**); `buildLineItems_` emits `product_variation_id` + variation prices; `pdAttachProducts_` keys idempotency by product+variation. (5) **`pushRunToPipedrive(dealerKey, runRowIndex, mode, existingDealId)`** (`mode` `create`/`link`); qty per type = **gross** (VIN-log dupes included — re-printed VINs are still billed), shared product+variation summed; a `source_split` dealer with a `source_product_map` adds the secondary output's products on the same deal (`readBillingBySource_`/`bySourceToBilling_`/`mergeLineItems_`). **Idempotent / retry-safe:** Deal ID written to **RUN_LOG col D** the instant PD returns it (numeric col D ⇒ already-created, dup guard); a `pd_push_<row>` ScriptProperties record resumes a retry; on failure → error + retry, no rollback. (6) **`pdFetch_` never throws** (`{ok,status,data,error}`; v1 default, v2 for org custom-field reads + product variations; one bounded 429 backoff; ok unless HTTP error or explicit `success:false`, so it handles both the v1 `success:true` envelope and v2's success-less envelope). Config UI populated LIVE from PD (`getPipedriveConfigBootstrap` cached ~10 min, `searchPipedriveOrganizations`). (7) **UI + nav:** new global **`ViewPipedriveSettings.html`** (connection setup + global deal-field rules builder); Dealer Rules **Pipedrive panel** (`ViewRules.html`) dropped the field-map builder/connection setup (now points to System Settings) and gained the **variation selector** + per-field **overrides** (Use-global / Off / Override…), whose inline editor **reuses a shared rule-card editor** (`psRenderRuleCard_`/`psSerializeOneRule_`/`psDeserializeOneRule_`/`psRegisterRuleCtx_`); `App.html` gained a collapsible **System Settings** sidebar group (Dealer Rules, Normalization, Data Sources, Pipedrive Settings). ViewRun **Push to Pipedrive** sub-block on finalized cards + ViewVinLog per-run push/retry retained. *(Two items here were superseded later in the 2.12 release: the ViewRun "Push to Pipedrive sub-block" → the method-first finalize cards, June 21; and "Type Rules (col O) unchanged" → col O retired from the run, June 24. See the rows above + the **Pipedrive Integration** section below.)* |
| June 17, 2026 | 2.11 | **Data Sources v2 + Targeting Rules engine deployed (branch `feature/data-sources` merged to `main`; tag `stable-post-targeting-rules`).** (1) **Targeting Rules replace the flat `conditions` array.** The "Targeting Conditions" table in the Dealer Rules editor is now an **IF (nested AND/OR conditions) THEN action** builder — new **`targeting_rules`** key in `filtering_rules` (col W): array of `{action, group}` where `group` = `{match:"all"|"any", children:[ {field,op,values} | nested group ]}` and `action` ∈ `drop_on_import` / `exclude_cao` / `exclude_order`. Engine: `evaluateCondition_` → `conditionMatches_` (leaf) + `groupMatches_` (recursive AND/OR) + `ruleMatches_`; polarity flipped from inclusion (fail-open) to **exclusion-on-match (fail-SAFE)** — misconfig → no match → vehicle kept. New ops **`gt`/`lt`** added; the `drop_on_import` **operator** removed (now an action, `TARGETING_ACTIONS`). `applyFilteringRules_` runs `exclude_order` in both phases + `exclude_cao` in CAO only; `getImportDropLocations_`/`dropRowsOnImport_` run `drop_on_import` actions via the same engine. `getDealerFilterRules_` returns `targetingRules`; `getRulesEditorBootstrap` returns `filterActions` + `gt`/`lt`. UI (`ViewRules.html`): recursive rule builder (client `targetingRulesModel`); only that section changed — Allowed Types, Exclude Status, Require flags, Price Range, Seasoning, and the **Exclude-from-CAO pills** (`cao_exclude_types`) are all unchanged. (2) **4 dealer configs migrated** (col W `conditions`→`targeting_rules`, behavior-preserving incl. missing-price/year still kept): **Pundmann Ford, Bommarito Cadillac, Dave Sinclair St. Peters, Frank Leta Honda**; Mazda untouched (`cao_exclude_types` only). Verified live with 25 behavioral-equivalence checks + UI round-trip. See `docs/targeting_rules_migration.md`. (3) **Data Sources v2** (Parts A/B + testing fixes) deployed in the same push — multiple named sources per dealer, append-only schema growth (timestamp relocated to META tab), schema-driven `getFilterFieldIndex_()`, `require_url` flag. |
| June 12, 2026 | 2.10 | **Post-run finalization — deferred deal IDs + abandonable runs.** Pipedrive deals are only created once an order is known to exist, so deal IDs can no longer be demanded before the run. (1) **Deal ID fields optional at run time for all dealers** (primary + split) — they only pre-fill the finalization cards; Run gates on user + dealer + VINs. `pasteVinsAndRun` required-throws removed. (2) **RUN_LOG/ORDER_STATS written only at finalization:** `runDealer` step 17 now returns self-contained **`pendingRuns`** entries (two for a split run with group units) instead of writing rows; new **`finalizeRun(dealerKey, entry, dealId)`** writes one row per finalized entry via the unchanged `writeRunLog_`. **Invariants:** no RUN_LOG row ever has a blank deal ID (`test` marks test runs); the VIN log is never written implicitly (explicit commit only). (3) **Finalization cards in the Run Dealer modal** — per-entry label/counts, deal ID input (pre-filled), Finalize/Abandon buttons, independent per card (e.g. abandon a 0-match primary, finalize the Sprinter half); "Add to VIN Log" enables once ≥1 card is finalized (0-VIN rows excluded from commit). Discard guards (confirm) on dealer change / new run / Cancel; dialog X-close not interceptable — an X-closed run is simply never logged. (4) **`abandonRun(dealerKey, outputDocId)`**: abandoning the last live card (nothing finalized) deletes the run's artifacts after a warning — output doc + dealer `<prefix>_QR_Code_N.PNG` files moved to **Drive trash** (30-day recovery); partial abandon of a split run keeps the shared doc/QRs. (5) **Fix:** pre-run deal-ID input listeners no longer clear post-run state on every keystroke. Behavior changes: editor-direct `runDealer` returns `pendingRuns` without logging; zero-match runs are abandonable with zero residue. |
| June 12, 2026 | 2.9 | **Billing split for shared-feed dual accounts (MBCC / Sprinter).** One run, one CSV — two billing sheets and two Pipedrive deals. (1) New optional **`billing_split`** key in `filtering_rules` (col W): `{group_name, deal_label, field, op, values}` — fields `model/make/trim/type` (ORDERMATCH vehicle keys), ops `contains`/`in` (case-insensitive, OR across values). Parsed by `getBillingSplit_` — **fail-safe**: absent/malformed → identical to today. MBCC: `field: "model", values: ["Sprinter", "Metris"]`. (2) **Billing writer refactor:** the five-section layout extracted into `renderBillingSheet_(sheet, …)`; `writeBillingSheet_(outputDoc, billingSplit)` partitions matched vehicles (`isInBillingGroup_`) and renders **BILLING** (primary account; also carries not-found identifiers) + **BILLING_<group>** (created via `insertSheet` — template untouched). Sheet sums = old single-sheet totals. `readBillingTotals_(outputDoc, sheetName?)`. (3) **Two RUN_LOG rows per split run** — each with its own deal ID, per-account totals, produced VINs; notes col U = `SPLIT:PRIMARY`/`SPLIT:<group>`; same output_doc_id/dealer_key. Zero group units → second row skipped (note `split: 0 <group> units`). ORDER_STATS gets one row per account. Commit/rollback per account works unchanged (single VIN log tab; group VINs carry the group deal ID). (4) **Run Dealer modal:** second required deal ID field shown only for split dealers (`getActiveDealersForUI` returns `splitDealLabel`); `pasteVinsAndRun`/`runDealer` gain trailing `splitDealId`; post-run "Add to VIN Log" commits both rows via new `commitRunRows` (skips already-committed — retry-safe). VIN Log Updater shows `SPLIT:*` badges (`getRunsForDealer` returns `note`). (5) **Fix:** Rules Editor `collectFilteringRules()` rebuilt the JSON from managed keys only and silently dropped passthrough keys (e.g. `billing_split`) on save — now stashes and re-merges unmanaged keys. Caveat: RUN_LOG row-count queries see a split run as two rows (filter on `notes`). Split applies even under "Bypass filtering rules" (billing-time classification, not a filter). |
| June 11, 2026 | 2.8 | **Multi-file import with Replace/Merge modes + VIN conflict resolution + modal layout rework.** (1) **`importScraperData` rewritten as a two-phase protocol** — `importScraperData(mappedData, mode, resolutions, fileNames, token)`. Phase 1 normalizes, dedupes by VIN, and (if same-VIN-different-data conflicts exist) returns them with **zero mutation**; phase 2 re-sends the payload + per-VIN resolutions (`'*'` bulk fallback), verified against an optimistic-concurrency token under a `LockService` lock. All mutations now sit below the conflict gate — fixes the latent hazard where the old importer cleared SCRAPERDATA *before* processing. New helpers: `dedupeScraperRows_` (incumbent vs newest challenger; identical rows dropped silently), `cellsEqual_`/`rowsEqual_`/`diffCols_` (tolerant compare — `getValues()` returns numbers for non-`@` cols), `groupRowsByLocation_` (rows grouped by Location on every write, preserving `getDealerScraperData_`'s contiguity invariant), `readExistingScraperRows_`, `computeImportToken_`, `applyConflictResolutions_`. Stats/health/dashboard computed on the **final** dataset in both modes. (2) **ScraperImport modal**: Replace/Merge mode selector, multi-file input with per-file header mapping + preview cards (all-or-nothing gate; VIN column required per file), UTF-8 BOM strip (fixes silent VIN-unmatch), mid-file header guard, conflict-resolution panel (side-by-side diff of differing fields, per-VIN radios, bulk buttons), mode-aware review with Import Summary badges. (3) **All five modals resized to a uniform 1400×900** (`MODAL_WIDTH`/`MODAL_HEIGHT`) **with layouts reworked for the wide canvas**: Run Dealer → two columns with full-height VIN workspace; VIN Log Updater → scrolling runs table + actions sidebar; Rules Editor → tabs replaced by side-by-side Type/Filtering panels; ScraperImport → two-column form + 2-up conflict grid; NormManager unchanged (already JS-sized). (4) **Fix:** "View Run Log" menu item did nothing (`openRunLog` activated a sheet via a separate `openById()` handle); now uses `getActiveSpreadsheet()`. (5) **Capacity & Log Growth Plan** section added (limits, growth math, ~25k-row triggers, `archiveOldLogs()` design; SF_VIN_LOGS never archived). |
| June 10, 2026 | 2.7 | **Targeting rules + Dean Team Brentwood + NORM_MAPS performance fix.** (1) **`feature/health-monitoring` merged to `main`** — `main` is now the single deployed branch. (2) **New dealer: `DEAN_TEAM_BRENTWOOD`** — 43rd dealer row, ORDERS col **AQ** (ORDERS widened 42→43 cols), used-only (`require_stock`/`require_price` true), Pipedrive, CAO. System now has **43 configured dealers, 29 active**. (3) **New field code `PRICE_TAGLINE`** at ORDERMATCH col **21 (U)** — price-tier tagline (`≥15000`→"as low as $300/mo", `10000–14999`→"Below $15,000", `<10000`→"Below $10,000"); formula coerces text price via `IFERROR(IF(VALUE(H2:H)>=…),"")` (PRICE_RAW is text). Plus new **`SCP_TAGLINE`** schema (SCP + PRICE_TAGLINE). (4) **Generalized targeting rules in `filtering_rules`** — two new optional keys: **`conditions`** (array of `{field, op, values, applies_to?}`; ops `in/not_in/contains/not_contains/gte/lte`; new `FILTER_FIELD_INDEX` map + `evaluateCondition_` helper, **fail-open** on misconfig; applied in CAO + run, Bypass overrides) and **`cao_exclude_types`** (manual-only types, CAO-phase only). `applyFilteringRules_` gains a `phase` param; `getCaoVins` tallies reasons dynamically; `getRulesEditorBootstrap` returns field/op metadata; RulesEditor adds a Targeting Conditions table + Exclude-from-CAO pills; DealerSelector renders `cond:*`/`cao_excluded` reasons. Pundmann Ford configured to exclude F-250. (5) **NORM_MAPS cols E+ live `UNIQUE()` formulas removed** — at 10k+ SCRAPERDATA rows they made programmatic access to SF_DEALER_CONFIG time out (~100s `Service Spreadsheets failed`), breaking config-reading modals + imports while the browser UI stayed fine. Replaced with on-demand **`refreshNormReference()`** (menu: **Refresh Norm/Field Reference**) writing static sorted distinct values (Type/Make/Model/Trim/Status/Body Style/Fuel Type) to cols E+. (6) **Trim cleanup** — full analysis + validated auto-cleanup design captured as a deferred section (see Trim Normalization & Cleanup); implementation pending. |
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
- Rows are **grouped by Location on every write** (first-seen order) — `getDealerScraperData_`'s two-pass read assumes each location's rows are contiguous, and merge-mode imports would otherwise scatter them
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

- **`order_id` (col D)** — Pipedrive Deal ID, entered (or confirmed) on the post-run **finalization card**. **Never blank** — a row cannot be finalized without one; `test` marks test runs. *(v2.10: RUN_LOG rows are written only at finalization, never during the run; abandoned runs never appear here.)*
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
One row per dealer (43 rows; 29 active), 23 columns (A–W).

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
| O | `type_rules` | **DORMANT** *(v2.12)* — JSON array of per-type rules. No longer read by the run (the Pipedrive product map is the sole per-type config); kept only as the source for `migrateTypeRulesIntoProductMap()` and a historical record. See Type Rules section. |
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

**Reference columns (E onward):** a **static, on-demand** reference area — one column each of sorted unique SCRAPERDATA values for `Type, Make, Model, Trim, Status, Body Style, Fuel Type` (header shows the distinct count), plus a "Refreshed: …" timestamp. Regenerated by `refreshNormReference()` (menu: **Refresh Norm/Field Reference**), which scans SCRAPERDATA once and writes plain values — zero ongoing recalc cost. Use it to spot new raw values needing normalization rules **and** to see the exact raw values available when authoring `filtering_rules` targeting conditions. The script only reads cols A–C; E+ is inert scratch space and never affects normalization. *(These were live `UNIQUE()` formulas until June 10, 2026 — at 10k+ SCRAPERDATA rows their recalculation made programmatic access to SF_DEALER_CONFIG time out, so they were replaced with this on-demand writer. Do not reintroduce volatile full-column formulas here.)*

**Normalized output values:**
- Type: `New`, `PO`, `CPO` (CPO-EL passes through unchanged — MBCC only)
- Status: `ONLOT`, `OFFLOT`

**Matching:** Case-insensitive exact match on full trimmed cell value. Rules evaluated top-to-bottom, first match wins. For Type map, more specific strings must appear above broader ones (`Certified Used` before `Certified`).

**Fallback:** Code.gs contains hardcoded `NORMALIZATION_MAPS` constant as read-only fallback if the tab is missing. Never the live source.

---

## Type Rules System

**The per-type output config (CSV schema + QR UTM) now lives in the Pipedrive product map, not in `type_rules`** *(v2.12)*. Each type's `product_map` entry (`PIPEDRIVE` tab col E, and `source_product_map` col L for a `source_split` dealer's secondary output) carries `{product_id, variation_id?, schema?, utm?}`: the same mapping the user already picks for billing now drives billing, the CSV layout, the grouping, **and** the QR UTM. This resolves "schema ≠ template" — the *product* carries the template identity.

**`type_rules` (DEALERS col O) is DORMANT** — it is no longer read by the run. It survives only as (a) the source for the one-time `migrateTypeRulesIntoProductMap()` migration and (b) a historical record. `getTypeRules_` is kept for that migration only; the Type Rules editor tab in the Dealer Rules view is **removed**. *(Before v2.12, col O was the live per-type config; a brief intermediate step in the same release had made the product `schema` the primary source with `csv_schema` as a fallback — that fallback is now gone too.)*

### How the run builds its rules

After the ORDERMATCH match (so the matched types are known), `runDealer`:

1. reads the dealer's product maps via **`getCsvProductMaps_(dealerKey, sourceSplit)`** → `{main, secondary}` (main = product maps merged across billing groups, first-wins; secondary = a `source_split` group's `source_product_map`);
2. **validates** with **`validateProductMapForRun_(matchedTypes, mainMap)`** — any matched type whose entry is missing a `product_id` **or** a `schema` makes the run **THROW** a clear Error ("Cannot run `<dealer>` — no product/schema set for type(s): X. Set them in Dealer Rules → Pipedrive."), caught by the existing run try/catch → `setProgressError_` → surfaced in the run modal like any failure. (UTM is **not** required.)
3. builds the run's type rules with **`buildTypeRulesFromProductMap_(productMap)`** — one synthetic rule `{match: type, csv_schema: entry.schema, utm: entry.utm}` per mapped type, **ordered CPO-EL before CPO** (load-bearing — `matchRule_` is substring-based: `"CPO"` ⊂ `"CPO-EL"`, `"PO"` ⊂ `"CPO"`).

Those synthetic rules feed `buildLinks_`/`buildUtmFormula_` (QR UTM) and `buildCSVSheet_`/`csvOutputGroups_`/`resolveRuleSchema_` (CSV schema/grouping) **unchanged** — only the *source* of the rules changed (product map, not col O). Because the synthetic rule's `csv_schema` **is** the product's `schema`, there is **no run-time fallback** to col O, and the old **`*` catch-all is gone** — an unmapped or unexpected (normalization-missed) type blocks the run rather than falling through.

**Consequence:** the run now **requires a complete product map for every dealer — even test runs** (each matched type needs a product + a schema). Prerequisite: run `migrateTypeRulesIntoProductMap()` once, then finish the Pipedrive product config.

**Critical:** product-map type keys must use post-normalization type strings: `New`, `PO`, `CPO`, `CPO-EL`. Never use raw scraper values like `Used`, `Certified`, etc.

### Grouping & CSV output naming

`csvOutputGroups_` groups the synthetic rules by their **resolved schema** (`resolveRuleSchema_` → `product_map[type].schema`): types resolving to the **same** schema merge into one CSV sheet. One resolved schema → a single `CSV` sheet; multiple → one sheet per schema named `CSV_<SCHEMA>` (e.g. `CSV_SC`, `CSV_SCP`). For a `source_split` dealer the main and secondary outputs are grouped by their **own** product maps (`product_map` vs `source_product_map[group]`), so the subprime site can use a different layout. See **Pipedrive Integration → PIPEDRIVE config tab** for the per-mapping `schema`/`utm` keys.

---

## Vehicle-Type Registry *(v2.13 — merged to `main` June 25, 2026; deployed; active)*

> **Status:** **merged to `main` June 25, 2026 (v2.13), deployed, and active.** After `clasp push` the user added a real custom type and ran an end-to-end test order that worked; the live `PIPEDRIVE_SETTINGS` now carries a `vehicle_types` row. With no extra types added the registry returns exactly the canonical four and behavior is byte-identical to before, so the deploy was safe to ship dark.

The vehicle **type** — `New` / `PO` / `CPO` / `CPO-EL` — was a fixed four hardcoded in ~14 places. It is now a **dynamic registry**: the four are protected built-ins, and a user can add new types on the fly from the **Dealer Rules** screen. A registered type is recognized **everywhere** that enumerates types — the Allowed-Types and Exclude-from-CAO pills, seasoning, the Pipedrive product picker, the BILLING sheet, Pipedrive line items, and the dashboard/analytics — with **no per-type code**.

### Storage + single source of truth

- **Built-ins:** `CANONICAL_TYPES = ['New', 'PO', 'CPO', 'CPO-EL']` (Code.gs constant) — always present, never removable, and the basis for the legacy per-type RUN_LOG / ORDER_STATS billing columns.
- **User-added extras:** a JSON array in the **`PIPEDRIVE_SETTINGS`** tab (SF_DEALER_CONFIG) under key **`vehicle_types`** (constant `PD_VEHICLE_TYPES_KEY`), read/written via the generic `getPipedriveSettingValue_` / `setPipedriveSettingValue_` accessors.
- **`getCanonicalVehicleTypes_()`** is the single source of truth: the de-duplicated (case-insensitive) **union of `CANONICAL_TYPES` (always first, in order) + the stored extras**, cached per execution (`_vehicleTypes_`). **Fail-safe:** the built-ins are always present even if the stored value is missing, partial, or malformed — a stored value can only ever *add* a type, never drop or reorder the protected defaults. This is the guaranteed floor: with no `vehicle_types` row the union is exactly the canonical four, so the registry is byte-identical to the old hardcoded four until a type is actually added.
- `PD_TYPE_KEYS` (the old `[{type, gross, dupes}]` array) was **removed** and folded into `CANONICAL_TYPES` + **`CANONICAL_BILLING_FIELDS`** (canonical type → its legacy billing-totals field names, e.g. `CPO-EL → {gross:'totalCPOEL', dupes:'cpoElDupes'}`).
- Helpers: `getExtraVehicleTypes_()` (extras only), `isCanonicalType_(label)` (is it a protected built-in?).

### Client-callable registry API

| Function | Behavior |
|---|---|
| `getVehicleTypes()` | Returns the full registry (`getCanonicalVehicleTypes_()`). |
| `addVehicleType(label)` | Validates — non-blank, ≤40 chars, no case-insensitive duplicate, and **rejects reserved billing-sheet labels** ("Total Ordered" / "Total Matched in Scraper" / "Total Duplicates" / etc. and any name ending in " Dupes") that would collide with `readBillingTotals_`'s row parsing — then appends to the extras, busts the cache, and returns the updated list. **Throws** on invalid input. |
| `removeVehicleType(label)` | **Guarded** (see below). Refuses a built-in or an in-use type. Returns `{ok, types?, blockedBy?, message?}`. |

Surfaced to the editors via `getRulesEditorBootstrap` (`vehicleTypes`) and `getPipedriveDealerEditorData` (`types`).

### Assignment is a separate, deliberate step (register-only by decision)

"Add New Type" only **registers the label** — it does not touch any vehicle. A new type is **inert until vehicles normalize to it**: the user maps a raw scraper value to the new type in **Manage Normalization** (or the feed already emits the label). The Add UI shows a hint saying so. (This keeps the registry a vocabulary list, decoupled from the normalization rules that actually assign a type.)

### Remove guard — scans EVERY place a type can be referenced

`removeVehicleType` refuses to delete a type that is still in use, so a removal can never leave a dangling reference. **`dealersUsingType_(type)`** (read-only) scans **every dealer's `filtering_rules` (col W) and every `PIPEDRIVE` row** and returns the blocking dealer **names** so the UI can explain the refusal:

- **`filterRulesUseType_(fr, targetLower)`** checks `allowed_types`, `cao_exclude_types`, `seasoning[].type`, **`billing_split` when `field:"type"`** (checks its `values`), and **`targeting_rules` conditions** — a `{field:"type"}` leaf, **recursing nested AND/OR groups**.
- **`pdRowUsesType_(row, targetLower)`** checks the `product_map` and `source_product_map` keys.

> The `targeting_rules` and `billing_split(field:"type")` scans were **added in the `ed0b5f8` remove-guard fix** after a config review — live dealers **Bommarito Cadillac, Pundmann Ford, and Dave Sinclair St. Peters** use `{field:"type"}` targeting conditions, so without the fix an in-use type could have been wrongly deleted, leaving a dangling condition. (Same lesson as the inert-config landmines elsewhere: a usage guard must enumerate every reference site.)

### Backend — billing/run go dynamic, fixed log schemas untouched

- **`readBillingTotals_`** now returns a **`byType: {<type>:{gross,dupes}}`** map (registry-driven row labels) **and** keeps the legacy `totalNew` / … / `cpoElDupes` fields, derived from `byType` via `CANONICAL_BILLING_FIELDS`. So **RUN_LOG cols G–N and ORDER_STATS are byte-identical** (`writeRunLog_` is unchanged there); `byType` is the dynamic interface, the canonical fields are the back-compat shim.
- **`buildLineItems_`** iterates the mapped product-map types reading `billing.byType[type].gross` (was `PD_TYPE_KEYS` + `billing.totalNew`); **`bySourceToBilling_`** emits the `byType` shape. Quantity stays **GROSS** — a VIN-log dupe is still produced and billed.
- **`renderBillingSheet_`** `TYPE_ORDER` is now `getCanonicalVehicleTypes_()`: a registered type gets a clean fixed row; the **"⚠ unexpected type"** path now means "in the data but not registered."
- **`buildTypeRulesFromProductMap_`** replaced its hardcoded `['CPO-EL','CPO','New','PO']` order with **sort-by-length-descending (longest match first)** — the generic substring-safety rule for `matchRule_` (which is `indexOf`-based, so `CPO` must not precede `CPO-EL`). Same order for the canonical four; orders any user-added type safely.

### UI — Dealer Rules (`ViewRules.html`)

- The **Allowed Types** and **Exclude-from-CAO** pills and the **seasoning** type dropdown render from the registry (`renderTypePills`, preserving the current selection across re-renders; a saved seasoning type that's somehow no longer registered is preserved defensively).
- A **"+ Add type"** control (`addNewType` → `addVehicleType`) registers a type system-wide and auto-selects it for the current dealer (so a product can be mapped to it). A **× on user-added pills only** (`removeTypeFromPill` → `removeVehicleType`, guarded) — built-ins (the client `BUILTIN_TYPES`) never get a ×. The type is read from the pill's **`data-type`**, never interpolated into the inline `onclick` (apostrophe-safe — see the inline-handler LEARNING).
- The **Pipedrive product picker is filtered to the dealer's Allowed Types** via **`pdEffectiveTypes()`** (the active Allowed-Types selection, registry order preserved; **none selected = "all types pass" → show all**). It re-renders when Allowed Types changes (toggle / add / remove) and after the filtering panel loads (handling the dealer-change load-order race).
- **A hidden type's product mapping is preserved automatically:** `buildProductMap_` serializes the **model** (`pdSelections[group].productMap`), not the rendered rows — filtering only changes what `pdRenderProductRows_` *renders*, so a mapping for a type that's currently filtered out still round-trips on save. (Same end as the existing "preserve-already-saved" backstop, with zero extra code.)

### Analytics — dynamic dashboard + a new long-format tab

Decision: **per-type history goes in a long-format tab + a dynamic dashboard; the fixed log schemas keep their canonical-four columns** (a new type folds into existing totals / "Other" there, so RUN_LOG / ORDER_STATS / IMPORT_STATS never change shape).

- **New `ORDER_TYPE_STATS` tab** (SF_SYSTEM_MASTER): `timestamp | dealer_key | dealer_name | order_id | type | produced | dupes` — **one row per type present in a run** (gross or dupes > 0), written by `writeRunLog_` from `billing.byType` in its own non-fatal try/catch (auto-created by `createOrderTypeStatsSheet_`). Gives complete per-type history for **any** type without a schema change, and — like ORDER_STATS — is a flat, formula-free table that ports 1:1 to a V3 Postgres table.
- **`computeImportReview_`** tallies inventory per registered type into `locationDetail.byType` (the canonical `new/po/cpo/cpo_el/other_types` fields are still computed for the fixed IMPORT_STATS).
- **`refreshDashboard_`** — the INVENTORY snapshot gets a **dynamic column per registered type + "Other"** (vehicles whose type isn't registered), and a new **RUNS BY TYPE** section (per-type COUNTIF/SUMIF over `ORDER_TYPE_STATS`; the criterion references the type cell so a quoted label can't break the formula). RUNS BY DEALER stays the **last, spilling** QUERY (its per-type sums still read the fixed RUN_LOG cols G–J); the clear range was widened (rows + cols) for the added block. Because the dashboard is regenerated from scratch on every import — no readers, no history — it can go fully dynamic freely.
- **ViewImport** — the "unexpected type" review badge now reads the registry (`getVehicleTypes` → `window.importKnownTypes`) so a registered type isn't flagged (cosmetic — badge color only).

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

**`require_url`:** Rejects vehicles whose Vehicle URL (col U) is blank or `*` — no link to build a QR from (reason `no_url`).

**`require_price`:** Rejects vehicles where price is blank, `*`, `callforprice`, or non-positive. Currently enabled only for Glendale CDJR.

**`seasoning`:** Filters on SCRAPERDATA col N (Date In Stock). A vehicle passes if `today - dateInStock >= required days`. Vehicles with unparseable dates pass through.

**Rejection reasons** (shown in CAO summary and logged during runs): `no_stock`, `no_price`, `no_url`, `type`, `status`, `price_low`, `price_high`, `seasoning`, plus `cao_excluded` (from `cao_exclude_types`) and `rule:exclude_order` / `rule:exclude_cao` (from `targeting_rules`). The CAO summary renders these dynamically.

### Targeting rules & CAO exclusions *(targeting_rules — deployed June 17, 2026; replaces `conditions`)*

Two optional keys extend the flat rules above with granular, field-based targeting — fully configurable in the **Edit Dealer Rules** modal (Filtering tab), no code per dealer.

**`targeting_rules`** — an array of **IF (nested AND/OR conditions) THEN action** rules. Replaces the old flat `conditions` array (and its `applies_to`). Each rule:
```json
{ "action": "exclude_order",
  "group": { "match": "all",
             "children": [ { "field": "type",  "op": "in", "values": ["PO","CPO"] },
                           { "field": "price", "op": "lt", "values": [35000] } ] } }
```
- **`action`** — what to DO when the rule's condition group matches the vehicle:
  - `drop_on_import` — at IMPORT, the row is dropped **before dedup**, scoped to the dealer's Location (`getImportDropLocations_`/`dropRowsOnImport_`); it never enters SCRAPERDATA. (Used to drop e.g. subprime cars from a dealer's direct feed. The import review reports the dropped count.)
  - `exclude_cao` — skipped during CAO auto-fill **only** (still prints when entered manually).
  - `exclude_order` — skipped during CAO **and** order runs (the "Bypass filtering rules" checkbox is the per-run override).
- **`group`** — `{ match: "all"|"any", children: [...] }`. `all` = AND (every child matches), `any` = OR (some child matches). A child is either a **condition** `{field, op, values}` or a **nested group** — so `(A AND B) OR C` is expressible. An empty group matches nothing (fail-safe).
- **condition `field`** — **any data SCHEMA column** (key), mapped to its SCRAPERDATA index by the cached, schema-driven `getFilterFieldIndex_()` (replaced the static `FILTER_FIELD_INDEX`), so a rule can target every column **including ones added via the Data Sources screen**. The Rules editor Field dropdown reads the schema via `getRulesEditorBootstrap`. *(For CAO/run filtering to read appended columns, `getDealerScraperData_` returns full width; `pasteScraperData_` slices to the base 21 for the output doc.)*
- **condition `op`** — `in`, `not_in`, `contains`, `not_contains` (string, case-insensitive; `contains`/`not_contains` match **any** value — OR), or `gte`, `lte`, `gt`, `lt` (numeric; price-safe — strips `$`/`,` before compare, since prices are stored as text). *(`gt`/`lt` were added for this model; the `drop_on_import` operator was removed — it's now an action.)*
- **Fail-SAFE (note the polarity flip from the old `conditions`):** a rule fires an **exclusion** when it matches, so every predicate fails to **no-match** on misconfiguration — unknown field/op, empty values, unparseable number, or an empty group → **the rule does not fire** (the vehicle is kept). A config typo can never silently mass-exclude a dealer's inventory. *(The old `conditions` were inclusion filters and failed OPEN — kept the vehicle on misconfig — which was the correct direction for inclusion. Same end result: misconfig → vehicle kept.)*
- Engine: `conditionMatches_` (leaf predicate) → `groupMatches_` (recursive AND/OR) → `ruleMatches_`; `applyFilteringRules_` runs `exclude_order` rules in both phases and `exclude_cao` rules in CAO only. Rejection reason is `rule:exclude_order` / `rule:exclude_cao` (tallied dynamically in the CAO summary).

**`cao_exclude_types`** — array of types removed from CAO auto-fill **only** (the "manual-only type" mechanism — they still print when entered manually). **Unchanged by the targeting_rules overhaul** — these remain a separate, simple set of pills in the editor (the easy path), coexisting with the more capable `exclude_cao` action. Keep the type in `allowed_types` so manual runs aren't blocked.

**Example dealers** (post-migration — see `docs/targeting_rules_migration.md` for full before/after):
- *Bommarito Cadillac / Dave Sinclair St. Peters* — exclude used under $35k from orders: `{"action":"exclude_order","group":{"match":"all","children":[{"field":"type","op":"in","values":["PO","CPO"]},{"field":"price","op":"lt","values":[35000]}]}}`
- *Pundmann Ford* — exclude trucks (model OR trim contains an `any` list) from orders, plus used <2022 and used <$35k as two `all` rules; New-from-CAO still handled by the unchanged `cao_exclude_types:["New"]` pill.
- *Frank Leta Honda* — drop subprime on import: `{"action":"drop_on_import","group":{"match":"all","children":[{"field":"subprime","op":"contains","values":["Subprime"]}]}}`

### Billing split *(v2.9 — June 12, 2026; deployed)*

**`billing_split`** — optional object for dealers whose single scraper feed serves **two billing accounts** (MBCC cars vs Sprinter/Metris vans). One run, one CSV (one Illustrator setup); billing separated per account.

```json
"billing_split": {
  "group_name": "SPRINTER",
  "deal_label": "Sprinter Deal ID",
  "field": "model",
  "op": "contains",
  "values": ["Sprinter", "Metris"]
}
```

- `field` — `model`, `make`, `trim`, or `type`. These are **ORDERMATCH vehicle keys** (the split classifies matched vehicles at billing time), deliberately *not* `FILTER_FIELD_INDEX`.
- `op` — `contains` or `in`; case-insensitive; matches **any** value (OR).
- `deal_label` — label for the optional second deal ID field in the Run Dealer modal and the group's finalization card (defaults to `<group_name> Deal ID`).
- **Fail-safe:** absent or malformed → the run behaves exactly as a normal single-billing run (`getBillingSplit_` returns null).
- **Not a filter.** The split is billing-time classification only — it never removes vehicles, and it applies even when "Bypass filtering rules" is checked.

**Effects when active and the run contains group vehicles:** the output doc gets **BILLING** (primary account — group units excluded; carries the not-found list) plus **BILLING_<group_name>** (created on demand; identical five-section layout); the post-run panel shows **two finalization cards** (one per account, each requiring its own deal ID to finalize — see v2.10), producing up to **two RUN_LOG rows** (notes col U = `SPLIT:PRIMARY` / `SPLIT:<group>`; same output_doc_id) plus matching ORDER_STATS rows. Either card can instead be abandoned. Commit/rollback in the VIN Log Updater works per account against the dealer's **single** VIN log tab — group VINs are logged under the group's deal ID; duplicate detection is identifier-based and unaffected. Zero group units in a run → BILLING_<group> is still written (zeroed) but there is no group card (note: `split: 0 <group> units` on the primary entry). Sheet-side QUERYs that count RUN_LOG rows see a fully-finalized split run as two rows — filter on `notes` if exact run counts matter.

### Source split — dual-site dealers *(June 2026 — merged to `main`; deployed, config-gated)*

**`source_split`** — optional object for a dealer whose single Location spans **two websites** (Frank Leta's main site + the AutoLoanPro subprime site, which is a superset). One run, **one billing sheet, one Pipedrive deal**, but **two CSV outputs** split by URL domain. The inverse of `billing_split` (which splits billing and keeps one CSV).

```json
"source_split": { "group_name": "AUTOLOANPRO", "url_contains": "autoloanpro" }
```

- `url_contains` — substring matched (case-insensitive) against the Vehicle URL to identify the **secondary-site** listing.
- `group_name` — suffix for the secondary CSV sheet (`CSV` → `CSV_AUTOLOANPRO`) and the dedup scope label.
- **Fail-safe:** absent/malformed → `getSourceSplit_` returns null and the run is a normal single-CSV run.

**Two effects:**
1. **Run (`buildCSVSheet_`):** matched cars whose URL contains the marker go to **`CSV_<group>`**; the rest to the normal **`CSV`** (per type rule; same schema/UTM). Both sheets always written (secondary may be empty). QR per-row already points at each car's own URL. **The deal and RUN_LOG are unchanged — one of each** (no `billing_split` here). The single **BILLING** sheet gains a **"BY SOURCE (QTY PER SKU)"** section: per source (`Main Site`, `<group>`) × type counts plus per-source totals (`renderBillingSheet_` gains a `sourceSplit` param), so the correct quantity per SKU can be entered in the one Pipedrive deal. Labels are source-prefixed (`Main Site — PO`) so they never collide with the trimmed type labels `readBillingTotals_` reads for the RUN_LOG.

   **Pipedrive (per-source products):** the secondary output can map to its **own** Pipedrive products on this **same** deal — `PIPEDRIVE` tab col L `source_product_map`, pushed as extra line items alongside the main `product_map`. The BY SOURCE section above is what supplies the per-source quantities to the push. See *Per-source product config — `source_split` dealers* in the Pipedrive Integration section.
2. **Import (`dedupeScraperRows_`, via `getSourceSplitLocations_`):** the "main first, then secondary" waterfall is resolved at import — when the same VIN appears with a main-site URL and a marker URL **within a Location that has `source_split` configured**, the **main** listing is kept automatically (no conflict prompt), regardless of import order or whether the feeds arrive together or as separate re-run merges. **Scoped strictly by Location**, so no other dealer's dedup is touched. Net SCRAPERDATA: one row per VIN — main URL for cars on both sites, AutoLoanPro URL only for subprime-only cars.

**Activation:** configure it in the **Dealer Rules editor → Filtering tab → "Dual-Site Source Split"** (enable + group name + URL-contains), which writes the `source_split` key to `filtering_rules` (col W) — or hand-edit col W. Inert until present (and until marker URLs exist in the data — e.g. a manually-imported AutoLoanPro feed).

### Where filtering is applied

**At CAO pre-fill time** (`getCaoVins`, phase `cao`): applied to raw SCRAPERDATA rows, then VIN log dedup. `targeting_rules` (`exclude_order` + `exclude_cao` actions) and `cao_exclude_types` are all active.

**At run time, step 8.5** (`runDealer`, phase `run`): applied to the ordered VINs array before the ORDERMATCH QUERY is written. `targeting_rules` `exclude_order` actions are active; `exclude_cao` actions and `cao_exclude_types` are **not** (so manual-only types print). `drop_on_import` actions never run here — they fire at import time. If all VINs are filtered, the run aborts with a descriptive error.

**Bypass:** The Run Dealer modal has a "Bypass filtering rules" checkbox. When enabled, step 8.5 is skipped entirely — the per-run override for manual orders.

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

## Pipedrive Integration *(v2.12 — merged to `main` June 24, 2026; deployed)*

Pushes a **finalized** run into Pipedrive as a deal with per-type product line items. It is a **separate, explicit step taken AFTER in-system finalization** — never automatic, and never before the run's RUN_LOG row (with its Deal ID in col D) exists. All of it lives in **Code.gs Section 31**. The code is deployed on `main`; the feature **activates per dealer once its live config is filled in** — the ScriptProperties secrets + the `PIPEDRIVE_SETTINGS` global rules + the per-dealer `PIPEDRIVE` config rows (including the product map). Until then it is inert (no global rules + no product map = a no-op push, and a dealer's run blocks if its product map is incomplete — see *PIPEDRIVE config tab* and *Type Rules System*).

### Secrets — ScriptProperties only
The API token and connection defaults live in `PropertiesService.getScriptProperties()`, **never in the repo or a sheet**: `PD_API_TOKEN`, `PD_COMPANY_DOMAIN`, `PD_DEFAULT_PIPELINE_ID`, `PD_DEFAULT_STAGE_ID`, `PD_DEFAULT_CURRENCY` (read by `pdGetSecrets_`). `setupPipedriveSecrets(token, domain, pipelineId, stageId, currency)` validates the token + domain with a live `GET /users/me` **before** persisting anything (nothing is saved on a failed validation). `getPipedriveStatus()` reports connection state to the config UI and **never returns the token**.

### Global deal-field rules — `PIPEDRIVE_SETTINGS` tab (SF_DEALER_CONFIG)
Deal-field mapping is **global** (not per-dealer). A simple **`PIPEDRIVE_SETTINGS`** key/value tab (`key | value`, auto-created by `getOrCreatePipedriveSettingsSheet_`) holds the global settings. Its primary row is key **`deal_field_rules`**, whose value is a JSON **array of rules**; a second key, **`product_org_field`**, scopes the product picker (see *Org-scoped product picker* below) and a third, **`install_cost_config`**, configures the install line item + Design no-charge variation (see *Install cost & Design no-charge variation* below). Generic `getPipedriveSettingValue_(key)` / `setPipedriveSettingValue_(key, value)` accessors read/upsert any row. Each deal-field rule sets **one** deal field, in one of three modes:

- **copy** — `{ "id", "deal_field", "type", "mode": "copy", "org_field", "option_map"? }`. Reads the org's custom field `org_field` and copies it to `deal_field` (the old per-dealer `field_map` behavior; `option_map` translates an enum/set option id; `type: "monetary"` writes the `<deal_field>_currency` companion).
- **conditional** — `{ "id", "deal_field", "type", "mode": "conditional", "group", "then_value", "else_value" }`. *IF* the org's fields match `group` *THEN* `deal_field = then_value` *ELSE* `else_value`. `group` is the **same shape as a targeting rule** — `{ "match": "all"|"any", "children": [ {field, op, values} | nested group ] }` — except each condition's `field` is a **Pipedrive org-field key** (not a SCRAPERDATA column).
- **constant** — `{ "id", "deal_field", "type", "mode": "constant", "value", "if_empty" }`. Sets `deal_field` to a fixed `value`. **Needs no org** (it applies even when the dealer/group has no org). The optional **`if_empty`** policy makes one rule express both create and link behavior: on a **New Deal** (create) the deal is treated as empty → the value is **always set**; on a **Linked** (existing) deal the engine reads the deal's CURRENT value and sets **only if it's empty** — and **skips (never overwrites) if that current value can't be read** (fail-safe — a value already there is never clobbered). *Example — the `Proof` deal field* (a single-select gating design approval): set Proof = `"No Proof Required"` on every New Deal but only on a Link if Proof is empty (a template-request deal that already requires a proof is left alone). That is **one** rule (Set value → Proof → `"No Proof Required"` → `if_empty`), with nothing Proof- or dealer-specific in code. Overridable per dealer via `field_overrides` like any rule.

```json
[
  { "id": "r1", "deal_field": "<deal-hash>", "type": "varchar", "mode": "copy", "org_field": "<org-hash>" },
  { "id": "r2", "deal_field": "<deal-hash>", "type": "enum", "mode": "conditional", "then_value": 42, "else_value": 7,
    "group": { "match": "all", "children": [ { "field": "<org-hash>", "op": "in", "values": ["Fleet"] } ] } },
  { "id": "r3", "deal_field": "<deal-hash>", "type": "enum", "mode": "constant", "value": 17, "if_empty": true }
]
```

Server: `getPipedriveGlobalRules_()` (reads the array; `[]` if absent), `getPipedriveGlobalSettings()` / `savePipedriveGlobalSettings(rules)` (the saver assigns a stable `id` — `r1`, `r2`, … — to any rule lacking one, preserving existing ids so per-dealer overrides keep pointing at the right rule), and `getPipedriveSettingsBootstrap(refresh)` (connection status + live deal/org field defs + the saved rules) for the global settings screen.

### Org-condition engine (parallel mirror of the targeting engine)
Conditional rules are evaluated by a **separate, parallel** engine that reads an organization's `custom_fields` object keyed by org-field key:
- `pdOrgConditionMatches_(orgFields, cond)` — one leaf predicate; ops `in`/`not_in`/`contains`/`not_contains` (string, case-insensitive) and `gte`/`lte`/`gt`/`lt` (numeric, `$`/`,`-stripped). Pulls a comparable scalar from a value that may be a scalar, `{id}`, or `{value}` (`pdOrgFieldValue_`).
- `pdOrgGroupMatches_(orgFields, group)` — recursive AND/OR (`match: "all"`/`"any"`; a child is a condition or a nested group).
- **Fails SAFE** in exactly the targeting engine's spirit: unknown field/op, empty values, an unparseable number, a field the org doesn't have, or an empty group all → **no match**.

**The production targeting engine (`conditionMatches_` / `groupMatches_` / `ruleMatches_`) is byte-for-byte unchanged** — this is a deliberate parallel implementation, not a refactor of the live filter engine. (Verified: the only diff reference to those names is a comment.)

### PIPEDRIVE config tab (SF_DEALER_CONFIG)
A **`PIPEDRIVE` tab**, **one row per `(dealer_key, group)`** (per-dealer org, product map, deal defaults, and overrides of the global rules). Cols A–L:

| Col | Field | Description |
|---|---|---|
| A | `dealer_key` | Matches DEALERS `dealer_key`. |
| B | `group` | `PRIMARY` or a `billing_split` group name (e.g. `SPRINTER`). |
| C | `org_id` | Pipedrive organization ID the deal is created on. |
| D | `org_name` | Cached org display name. |
| E | `product_map` | JSON `{type: {product_id, variation_id?, schema?, utm?}}` — per-type Pipedrive product (`New`/`PO`/`CPO`/`CPO-EL`), optionally a specific variation, the **`schema`** (CSV-schema key — sets that product's CSV layout/grouping) and the **`utm`** (QR `utm_medium`). **This is now the SOLE per-type config — the run reads schema + UTM from here, not from `type_rules` (col O); a matched type missing a `product_id` or `schema` blocks the run.** A bare `{type: product_id}` is still tolerated. *(`schema`+`utm` added in v2.12; `buildLineItems_` ignores both. See *Type Rules System*.)* |
| F | `deal_title_template` | Optional template (`{dealer_name} {date} {group} {count}`). |
| G | `pipeline_id` | Optional override of the default pipeline. |
| H | `stage_id` | Optional override of the default stage. |
| I | `currency` | Optional override of the default currency. |
| J | `field_overrides` | JSON object keyed by **global rule `id`** → `{off:true}` (disable that global rule for this dealer/group) or a **full replacement rule** (copy\|conditional, minus `id`). `{}` (empty) = use the global rules as-is. *(This column was `field_map` in v1.)* |
| K | `active` | TRUE = this group's push is enabled. |
| L | `source_product_map` | JSON `{ "<sourceGroupName>": { type: {product_id, variation_id?, schema?, utm?} } }` — per-type products (each with an optional `schema` + `utm` like col E) for a `source_split` dealer's **secondary** CSV output (e.g. `{AUTOLOANPRO: {New:{…}, PO:{…}}}`), pushed onto the **same** deal as the main map (col E). `{}` (empty) for non-source-split dealers. *(`PDCFG.SOURCE_PRODUCT_MAP = 11`. See *Per-source product config* below.)* |

A dealer has a **PRIMARY row plus one row per `billing_split` group**, each with its own org **and** its own per-type product map. This is how **Mercedes-Benz of Creve Coeur's two Pipedrive orgs** (MB Creve Coeur for cars + Sprinter Creve Coeur for vans) are handled — the split run's two billing accounts map to two PIPEDRIVE rows, each pushing to its own org. **Type Rules (col O) are now DORMANT** *(v2.12)* — the product map is the sole per-type config; col O is read only by the `migrateTypeRulesIntoProductMap()` migration. Server: `getPipedriveDealerConfig_(dealerKey, group)`, `getPipedriveDealerEditorData(dealerKey)` (now also returns `globalRules`, so the panel can list the rules that are overridable), `savePipedriveDealerConfig(dealerKey, rows)` (replaces all of a dealer's rows); the tab is auto-created by `getOrCreatePipedriveSheet_`.

**Per-mapping `schema` + `utm` ARE the per-type config** *(v2.12)*: each `product_map` / `source_product_map` entry's `schema` sets the CSV layout (and grouping) and its `utm` the QR `utm_medium` for that product — so the product the user picks for billing also picks the template and the tracking. The run pipeline reads these maps via `getCsvProductMaps_`, **validates** them (`validateProductMapForRun_` — missing product or schema blocks the run), builds synthetic type rules (`buildTypeRulesFromProductMap_`), and groups CSV sheets by the **resolved** schema (`resolveRuleSchema_` → `product_map[type].schema`). There is **no run-time fallback to `type_rules`**. The Dealer Rules → Pipedrive product grids (main + source-split) carry **Schema** and **UTM** columns for this. See **Type Rules System**.

### Product variations (v2, lazy)
`product_map` entries can pin a specific **variation**: `{product_id, variation_id?}`. Variations are a **separate endpoint** in v2 — they are *not* embedded in the product response — so `getProductVariations(productId)` / `pdListProductVariations_(productId)` lazily `GET /api/v2/products/{id}/variations` (**v2-only**) only when needed. `pushRunToPipedrive` fetches variations only for products that actually have one chosen, and passes them to `buildLineItems_`.

### Per-source product config — `source_split` dealers (col L `source_product_map`)
A **`source_split`** dealer (one Location, two websites — Frank Leta's main site + AUTOLOANPRO; see *Source split — dual-site dealers*) produces a **second CSV output on the same deal**. That secondary output can now be mapped to its **own** Pipedrive products, separate from the main-site map.

- **Config.** The secondary products live in `PIPEDRIVE` tab **col L `source_product_map`** (`PDCFG.SOURCE_PRODUCT_MAP = 11`): JSON `{ "<sourceGroupName>": { type: {product_id, variation_id?, schema?, utm?} } }`. The main-site products stay in `product_map` (col E). Parsed as `sourceProductMap` by `pdRowToConfig_` and persisted by `savePipedriveDealerConfig`.
- **Editor (`ViewRules.html`).** `getPipedriveDealerEditorData` now also returns `sourceSplit` (from `getSourceSplit_`). Whenever the dealer has a `source_split`, each deal block renders a **secondary per-type product grid** ("Products for the `<groupName>` output") below the main grid — with its own **Schema** and **UTM** columns — driven generically off `filtering_rules`, the same way `billing_split` drives the per-deal blocks (no per-dealer code).
- **Push.** When a `source_split` **and** a secondary product map are both set, `pushRunToPipedrive` builds line items from `product_map × main-source qty` **plus** `source_product_map[group] × secondary-source qty` on the **one** deal, merged by product+variation. Per-source **gross** quantities are read from the BILLING **"BY SOURCE (QTY PER SKU)"** section via new **`readBillingBySource_`**; **`bySourceToBilling_`** converts a per-source `{type:qty}` into the billing-totals shape `buildLineItems_` reads, and **`mergeLineItems_`** sums the main + secondary lines by `product_id|variation_id`. Until a secondary product map is configured, the push is **unchanged** (main map × all vehicles), so enabling `source_split` never silently drops the secondary cars before they're mapped. The deactivated-product preemption covers secondary products too.
- **Both splits together.** `renderBillingSheet_` now also writes the BY SOURCE section on a `billing_split` **group** sheet (not just the primary), so a future dealer configured with **both** a `billing_split` and a `source_split` works. `billing_split` (separate deals, each its own org + product map — e.g. MBCC) and `source_split` (one deal, separate products per source — e.g. Frank Leta) are the two product-partition axes; the Dealer Rules → Pipedrive screen renders the right product config for either **automatically from `filtering_rules`**.

### Org-scoped product picker (`product_org_field`)
By default the per-dealer type→product dropdown offers the **entire** product catalog. It can instead be scoped to the products linked to a dealer/group's **organization** — but Pipedrive products are a **global catalog with no native product↔org link**. The link is therefore a **product custom field**: an **Organization-type** field on the product (the user's **"Customer"** field) that stores the org by id.

- **Setting (with auto-detection).** A global **`product_org_field`** row in the `PIPEDRIVE_SETTINGS` tab holds the **KEY** of that product custom field (stored by key, never by name; **blank = unscoped**, show the whole catalog). The **effective** field is resolved by **`getEffectiveProductOrgField_()`**: the explicit `product_org_field` setting if one is chosen, **else AUTO-DETECTED as the first product custom field whose `field_type` is `org`/`organization`**. So a dealer org with one "Customer" org field on products gets scoping with **zero configuration** — the explicit setting only matters to disambiguate when there are *multiple* org-type product fields. `getPipedriveProductOrgField_()` reads the explicit setting; `getEffectiveProductOrgField_()` returns explicit-or-auto-detect (this is what the catalog read and both bootstraps use); client-callable `savePipedriveProductOrgField(fieldKey)` writes the explicit key (blank clears it → falls back to auto-detect) and **busts the `pd_catalog_v2` cache** so the catalog re-enriches with the newly chosen field on the next fetch.
- **Catalog enrichment.** When a field is in effect, `pdListProducts_` fetches the catalog **via v2 — `GET /products?custom_fields=<key>`** (v2 reliably returns the custom-field value under `custom_fields[<key>]`; for an Organization field that value is the org id) — and adds **`customerOrgId`** to each product, read from that value via `pdExtractOrgId_` (normalizes a scalar id, or `{value}` / `{id}`). With **no** field in effect it stays on the v1 `/products` list (no `customerOrgId`, full catalog). `pdListProductFields_` / `getPipedriveProductFields()` list product custom fields for the picker. `getPipedriveConfigBootstrap` products now carry `customerOrgId` and it returns `productOrgField` (the **effective** key); `getPipedriveSettingsBootstrap` returns `productFields` + `productOrgField`. *(The catalog cache key is `pd_catalog_v2` — bumped from `pd_catalog_v1` when products gained `customerOrgId`, so any stale pre-enrichment cache is ignored.)*
- **The filter (`ViewRules.html`).** `pdProductVisible_(prod, groupOrgId, showAll, savedProductId)`: scoping-off / no field configured / group has no org → **full catalog**; the **already-saved `product_id` is ALWAYS kept** (so a filtered-out or deactivated product can't silently drop the mapping on save); otherwise keep only products whose `customerOrgId === groupOrgId`. A saved product that's filtered out / no longer in the catalog renders as **"Product #N (saved)"** (mirrors the variation dropdown). A per-group view-only **"Show all products"** toggle (`pdSetShowAll`) bypasses the scope for that group; it is **not persisted** and doesn't mark the panel dirty.
- **Settings UI (`ViewPipedriveSettings.html`).** A **"Product → Organization field"** picker (save-on-change via `savePipedriveProductOrgField`) with a **"— none (show all products) —"** option; an unknown saved key (field removed from Pipedrive) is preserved in the dropdown rather than dropped.
- The stored mapping `{product_id, variation_id?}` is **unchanged** by all of this — only *which options are offered* changes.

### Bulk dealer → organization linker (one-time setup helper)
Each dealer's deal pushes to its Pipedrive **organization** (`PIPEDRIVE` tab col C `org_id`, per `(dealer_key, group)`). Rather than hand-search the org for each of the ~29 active dealers in the per-dealer picker, a **review-gated bulk linker** in **Pipedrive Settings** matches them all by name in one pass.

- **Read-only scan — `getDealerOrgLinkProposals()`** (client-callable). For every **active** dealer it returns its current PRIMARY-row org (if any) **and** a proposed Pipedrive org matched by name, for the user to review **before any write**: `[{dealerKey, dealerName, currentOrgId, currentOrgName, proposedOrgId, proposedOrgName, matchType}]`. It pulls all orgs via `pdListAllOrganizations_` and matches with `normalizeOrgName_` (lowercase; strip punctuation; drop filler words `of/the/inc/llc/co/group/automotive/auto`) + `matchOrg_` (exact-normalized name → token-overlap score). `matchType` ∈ **`exact`** (normalized names equal) / **`strong`** (token overlap ≥ 0.6) / **`weak`** (some shared token) / **`none`** (no shared token). **The scan writes nothing.**
- **Confirmed save — `saveDealerOrgLinks(links)`** (`links = [{dealerKey, orgId, orgName}]`). Upserts **only each dealer's PRIMARY-row org** (col C `org_id` + col D `org_name`): it **preserves `product_map` / `field_overrides`** on an existing PRIMARY row, and **creates** a PRIMARY row (empty `product_map`/`field_overrides`, `active=true`) for a dealer that has none. It **never touches a `billing_split`-group row, nor any product mapping** — org only. Returns `{ok, updated, appended}`.
- **UI (`ViewPipedriveSettings.html`).** A **"Link dealers to organizations"** card: **Scan & match dealers** renders a review table — per row an **Include** checkbox (**defaulted ON for `exact`/`strong`**, off for `weak`/`none`), the dealer, its current org, and the proposed org with a **per-row override search** (re-uses `searchPipedriveOrganizations`) and a **match badge**. **Save confirmed links** writes only the checked rows. Both this picker and the per-dealer org picker are **apostrophe-safe** — see the LEARNINGS note (stash results, pass an index).

> **Rename-safety (audited).** Every Pipedrive mapping keys on a **stable id/key, never a name** — `product_id`/`variation_id`, `org_id` (authoritative; `org_name` is a display-only cache), deal/org fields by their 40-char **key**, enum / THEN/ELSE / condition values by **option id**, deals by numeric `deal_id`. So the supported product-revision workflow — **edit the ORIGINAL product to keep its id, deactivate the duplicate** — never orphans a mapping; the preserve-already-saved dropdown behavior above is the backstop that keeps a deactivated product selected.

### Line items
`buildLineItems_(billing, productMap, products, currency, variationsByProduct)` turns the run's billing totals into deal products. **Quantity per type = gross** — every matched/produced car, **including** cars flagged as duplicates because their VIN is already in the VIN log (a re-printed VIN is still produced and billed). It reads the gross per-type totals (`totalNew`, `totalPO`, `totalCpo`, `totalCpoEl` from `readBillingTotals_`) and does **not** subtract the per-type dupe counts; this applies to **all dealers**. Types mapping to the **same product *and* variation** are **summed** into one line item, while different variations stay distinct lines. `item_price` is resolved from the chosen **variation's** `prices[]` (falling back to the product's prices) by the target currency, falling back to the first listed price. A line carrying a variation emits `product_variation_id`. *(This was net-of-dupes — `gross − dupes` — until June 2026; the dupe subtraction was removed so re-printed/re-billed VINs are counted.)*

### Deactivated products — never mappable, never pushed
Pipedrive rejects a **deactivated** product when attaching it to a deal, so the integration blocks one at two layers:
- **Catalog flag.** `pdListProducts_` adds `inactive` to each product — from the v2 product's **`is_linkable === false`** (whether it can be added to a deal), with a v1 fallback of `selectable === false || active_flag === false`.
- **Picker hides them (`ViewRules.html`).** The per-dealer type→product dropdown (`pdProductSelect_`) excludes `inactive` products so a deactivated one can't be **newly** mapped — but an **already-saved** product that has since gone inactive stays visible, flagged **"(inactive — pick a new product)"**, and is **never silently dropped** (kept even under the per-group "Show all products" toggle — the same preserve-already-saved backstop as org-scoping).
- **Push preempts (`buildLineItems_` + `pushRunToPipedrive`).** `buildLineItems_` carries `inactive` onto each line item (a mapped product not found in the catalog is treated as inactive too). Before creating or linking a deal, `pushRunToPipedrive` checks: if any mapped product that would actually be pushed (qty > 0) is deactivated, it returns `{ ok:false, stage:'inactive_product', retryable:false }` with a message naming the product(s) and pointing to **Dealer Rules → Pipedrive** to update the mapping. **No orphaned deal is created.** The check is skipped once products are already attached (a field-only retry).

### The push
`pushRunToPipedrive(dealerKey, runRowIndex, mode, existingDealId)`, `mode` ∈ `create` | `link`:
- It resolves the group from the RUN_LOG note (`SPLIT:<group>` → that group, else `PRIMARY`) and reads the matching `BILLING` / `BILLING_<group>` sheet from the run's output doc.
- **`create`** makes a new deal on the group's org (title from the template, pipeline/stage/currency from the row or the defaults), attaches the per-type products, then sets deal fields.
- **`link`** attaches the run's products and sets fields on a **supplied existing deal** — it does **not** change that deal's org.

Internally `pushRunToPipedrive` is composed of reusable helpers — **`pdResolveRunContext_`** (config/org gate + currency + line items, read-only, incl. `source_split`), **`pdResolveDealId_`** (create-or-validate, persists nothing — the caller owns the col-D write), **`pdCheckInactiveProducts_`**, and **`pdApplyDealContents_`** (attach products + set fields, idempotent via the passed `state`). Its signature, gates, and return shapes are unchanged; the same helpers back the method-first finalize orchestrators below.

### Install cost & Design no-charge variation *(v2.12)*
Two extra deal-contents steps that run inside **`pdApplyDealContents_`** **after** the products + fields steps, on **every push** (`create` **and** `link`), each gated by a new `state` flag (`installDone` / `designDone`) so a retry resumes instead of repeating. Both are **generic and config-driven** off a new **`install_cost_config`** row in the `PIPEDRIVE_SETTINGS` tab (constant `PD_INSTALL_COST_KEY = 'install_cost_config'`) — nothing dealer- or id-hardcoded — and both are **inert (no-op) until configured**. Config accessors: `getInstallCostConfig_()` (`{}` if unset), client-callable `getPipedriveInstallCostConfig()` / `saveInstallCostConfig(cfg)` (via `getPipedriveSettingValue_` / `setPipedriveSettingValue_`). `pushRunToPipedrive`'s signature/gates/returns are **unchanged**.

**Config shape:** `{ org_field_key, install_product_id, options:{ <orgOptionId>:{variation_id|null, percent|null} }, design_product_id, design_no_charge_variation_id }`.

- **Install line item — `pdApplyInstallCost_(dealId, pdCfg)`.** Reads the org's **"Program Install Cost"** enum field (`pdGetOrgWithCustomFields_(pdCfg.orgId, [org_field_key])` → `pdOrgFieldValue_`), looks up the option in `options[<orgOptionId>] = {variation_id, percent}`, and **adds or updates** the configured Install product line item with that variation + price. **Idempotent** — if an Install row already exists on the deal it's updated in place (keeps its quantity), not duplicated. **Price:** `percent > 0` → `percent × (Σ item_price × quantity over the deal's OTHER current line items, EXCLUDING the design and install products)`, rounded to the cent; **else 0**. **Fail-safe no-op** until configured, or if the org's selected option isn't mapped in `options`. The three real-world behaviors are pure config: *Included* → No-Charge variation @ 0; *20%* → Professional variation @ 20% of the subtotal; *Custom Billed* → no variation @ 0.
- **Design no-charge variation — `pdApplyDesignVariation_(dealId)`.** A Pipedrive **automation** adds a "Design" line item a few seconds after deal creation, so this **polls** for that line (~8 × 2s) and then sets the configured No-Charge variation **only if the Design line's variation is currently empty** (`pdFieldEmpty_`) — a template-request deal already has its Design variation set and is **left alone** (`alreadySet`). Best-effort: if the automation hasn't fired within the poll window it returns **`designPending`** (the push still succeeds; `state.designDone` is left unset so a re-push sets it).
- **New line-item API helpers.** `pdUpdateDealProduct_(dealId, attachmentId, body)` → **`PUT /deals/{id}/products/{attachmentId}`** — the **first line-item UPDATE in the codebase**, keyed on the deal-product **attachment `id`** (distinct from `product_id`); `pdAddDealProduct_(dealId, item)` → POST one line item (no dedup — the caller owns idempotency). *(Verified live: the deal-product rows expose the attachment `id`, `product_id`, `product_variation_id`, `item_price`, `quantity`.)*
- **UI (`ViewPipedriveSettings.html`).** A new **"Install Cost"** card: pick the Program-Install-Cost org field (→ a per-option grid of variation + percent), the Install product, the Design product (lazy-loaded variations; deactivated hidden / already-saved id preserved — the Dealer Rules product-picker patterns), and the Design No-Charge variation. Save/load via `saveInstallCostConfig` / `getPipedriveInstallCostConfig`.

### Billing PDF attachment *(v2.12)*
After a deal is pushed, the system auto-generates a **well-formatted PDF of the run's BILLING sheet and attaches it to the deal** — replacing the manual workflow of downloading the billing CSV and attaching it (a CSV loses all formatting, and Pipedrive's Drive attachment view can't size columns). All new in **Code.gs Section 31** ("Billing PDF" subsection); there are **no UI/view-fragment changes**, and the working BILLING sheet (`renderBillingSheet_`) is **never modified** — the PDF is built fresh in a temp tab.

It is a final step inside **`pdApplyDealContents_`**, after the products + fields + install + design steps, on **every push** (`create` **and** `link`), gated by a new **`state.billingPdfDone`** flag (retry-safe) **and** a new **`runCtx` 8th param** (`{outputDocId, group, dealerName}`) threaded in from both callers (`pushRunToPipedrive`, `finalizeRunNewDeal`). It is **best-effort / non-fatal** — wrapped in its own try/catch, a failure (or thrown error) flags **`billingPdfPending`** (returned in the push result and appended to the success message as *"(billing PDF will attach on a re-push)"*), the push still succeeds, and a re-push retries. Same isolation discipline as the non-fatal stats/dashboard writes — it can never fail a run. **One billing PDF per deal.** `pushRunToPipedrive`'s signature/gates/returns are unchanged.

- **Idempotency — `pdDealHasBillingPdf_(dealId, filename)`.** A `GET /files?deal_id=` returns true if a billing PDF with the same **date-free** filename is already attached (best-effort; false on error), so `attachBillingPdfToDeal_` skips. `billingPdfFilename_(dealerName, group)` → `Billing - <dealerName>.pdf` (PRIMARY) or `Billing - <dealerName> (<GROUP>).pdf` — filesystem-sanitized and deliberately **date-free so the idempotency check matches across days** (a re-push the next day still finds the existing attachment).
- **Parser — `readBillingForPdf_(outputDoc, sheetName)`.** Parses the already-rendered `BILLING` / `BILLING_<group>` sheet into a structured object `{summary, byType, bySource, duplicates, dupDetail, producedVins, producedCount}` (section markers in col B, values col C, not-found list col D, the duplicate-detail table at col F, produced VINs one-per-row in col B). It **checks `DUPLICATES` before `BY TYPE`** because `── DUPLICATES BY TYPE ──` contains the substring `BY TYPE` — the same substring trap as CPO/CPO-EL type matching (caught by a unit test). The URL column is dropped from the PDF.
- **Layout — `buildBillingPdfTab_(outputDoc, data, meta)`.** Writes a polished vertical layout into a temp tab (`_BILLING_PDF`; a stale one is deleted first): a navy title band (dealer · Deal #id · group · date), then each section as a clean banded table (section-header bands, sub-header rows, alternating row shading, outer borders, right-aligned counts). The **produced-VINs list is laid out by a new pure helper `billingVinGrid_(vins, cols)`** — column-major, filling each column top-to-bottom to **≥15 (a `MIN_PER_COL` floor)** before wrapping into the next column: a small run (e.g. 12 VINs) is a single column, 30 → two columns of 15, and the column count caps at **6** for page width (the column height grows past 15 only beyond ~90 VINs). The VIN grid is **banded only (no outer border)** so a narrow grid of full columns doesn't draw a wide mostly-empty box — the alternating row shading carries the structure. *(This replaced a too-aggressive `ceil(N/cols)` wrap that produced ~2 VINs per column.)* Backgrounds/fonts/borders are applied as **batched matrices** (`setBackgrounds`/`setFontColors`/`setFontWeights`/`setFontSizes`) — one pass per push.
- **Export — `exportSheetPdf_(spreadsheetId, gid)`.** Fetches the Google Sheets export URL `…/export?format=pdf&gid=<gid>&portrait=true&fitw=true&size=letter&gridlines=false&sheetnames=false&printtitle=false…` with `Authorization: Bearer ScriptApp.getOAuthToken()` → a PDF Blob (`fitw` fits to page width; preserves the sheet's formatting). **`generateBillingPdf_(outputDocId, sheetName, meta)`** orchestrates open doc → `readBillingForPdf_` → `buildBillingPdfTab_` → export by `getSheetId()` → **always delete the temp tab** (even on failure) → `{ok, blob, filename}`.
- **Upload — `pdAttachFileToDeal_(dealId, blob, filename)`.** Uploads to Pipedrive `POST /api/v1/files` with an **object payload `{deal_id, file: blob}`** so GAS auto-builds `multipart/form-data` from the Blob field (a raw `UrlFetchApp.fetch` — `pdFetch_` is JSON-only). This is the **first file upload in the codebase** to the deal-attach `/files` endpoint.
- **Orchestrator — `attachBillingPdfToDeal_(dealId, outputDocId, group, meta)`** = skip if already attached, else generate + attach.

*(Validated: `node --check` + 32 unit tests — parser sections incl. the DUPLICATES-vs-BY-TYPE substring trap, by-source, no-dupes, filename + idempotency match, plus the `billingVinGrid_` column-grid layout. **Verified live:** the Sheets PDF export and the Pipedrive `/files` multipart upload are both confirmed working — the PDF generates, attaches to the deal, and reads the billing data correctly.)*

### Finalize-from-card — method-first finalization *(v2.12)*
The push is now invoked **from** the post-run finalization card, not from a separate sub-block shown after finalizing. **This replaces the v2.10 "deal-id-optional, finalize, then push" model:** each card leads with a **push-method choice** (New Deal / Existing / Test) and a single **Finalize** button. Which methods a card offers comes from **`getRunPushModes(dealerKey, group)`** → `{test, newDeal, existing, reason}` (Test always; New/Existing require an active Pipedrive org config), attached as **`pushModes`** on each `pendingRuns` entry by `runDealer`.
- **New Deal — `finalizeRunNewDeal(dealerKey, entry)`** creates the Pipedrive deal **first** (a real numeric id — nothing is typed), then finalizes the run with that id (so the "no RUN_LOG row without a real deal id" invariant holds with no placeholder), then attaches products + sets fields. The deactivated-product preempt (`pdCheckInactiveProducts_` → `stage:'inactive_product'`) runs **before any deal is created**, so a bad mapping creates and logs nothing. Because the deal exists before the RUN_LOG row (so the numeric-col-D dup guard isn't available yet), it is made retry-safe by a **`pd_new_<outputDocId|group>` token cache** (`pdNewDealCacheGet_`/`…Set_`/`…Merge_`/`…Clear_`): the deal id — then the `rowIndex` — is cached in ScriptProperties the instant Pipedrive returns it, so a retry that failed before or after finalize **adopts** the cached id instead of creating a second deal or a second row. Cleared on success alongside the row-keyed `pd_push_<row>` state.
- **Existing — `finalizeRunExisting(dealerKey, entry, existingDealId)`** validates the id via `pdGetDeal_` **first** (no row written for a bad id), finalizes with it, then links products via `pushRunToPipedrive(…, 'link', id)`.
- **Test — `finalizeRun(dealerKey, entry, 'test')`** (unchanged) never touches Pipedrive, and a `test` run is now **excluded from VIN-log commit** (`commitLatestRun` throws on a `test` col-D; `commitRunRows` skips it, returning `skippedTest`; the UI hides/disables Commit for test runs).

### Idempotency — failure never loses a run
The Deal ID is written to **RUN_LOG col D the instant Pipedrive returns it**; a **numeric col D is then treated as "deal already created"** (dup guard — a retry never creates a second deal). A `pd_push_<row>` ScriptProperties record tracks `productsDone` / `fieldsDone`, so a retry **resumes** mid-push instead of repeating completed steps; `pdAttachProducts_` additionally skips any **product + variation** already on the deal (idempotency keyed by `product_id|variation_id`). On any failure the function returns an error + `retryable` flag — **no rollback**; the user simply retries (from ViewRun or the VIN Log Updater).

### Never-throw fetch wrapper
`pdFetch_(method, path, payload, opts)` **never throws** — it returns `{ok, status, data, error}`. The token is passed as `?api_token=`; the **v1** base is used by default and **v2** (via `opts.version:'v2'`) for organization custom-field reads, **product variations**, and the **org-scoped product catalog** (`/products?custom_fields=<key>` when a product→org field is in effect); it does **one bounded 429 backoff**. It treats a response as ok unless it's an HTTP error or carries an explicit `success:false`, so it handles **both** the v1 envelope (`{success, data, additional_data}`) **and** v2 (which omits `success` and signals errors via HTTP status only). This is the same isolation discipline as the non-fatal stats/dashboard writes — a Pipedrive API failure can never fail a run.

### Org→deal field resolution (global rules + per-dealer overrides; no-op until configured)
`pdResolveDealFields_(orgId, globalRules, overrides, currency, isNewDeal, existingDealFields)` *(the last two params added with the constant-rule mode; the function **replaced `pdResolveFieldMap_`**)* is the runtime resolver. It (1) builds the **effective** rule list — each global rule is dropped if its override is `{off:true}`, replaced wholesale if the override is a replacement rule, or kept as-is otherwise; (2) applies the **constant** rules first, **without** the org (a constant `if_empty` rule is set always on a New Deal, set-only-if-empty on a Link via `existingDealFields`, and skipped — never clobbered — if that current value can't be read); (3) **only then**, if any copy/conditional rules are present, reads the org keys they reference (`pdCollectOrgKeys_` walks copy `org_field`s + conditional condition fields) and evaluates them — *copy* rules read-and-translate, *conditional* rules pick `then_value`/`else_value` via `pdOrgGroupMatches_` — writing each via `pdSetDealField_`. An **org-fetch failure now returns the constant results** (not `{}`), and the copy/conditional output is **byte-identical when no constant rule is present**. The result is a **flat top-level** `{dealFieldKey: value}` map (v1 deals API takes custom fields as top-level 40-char hash keys, with a `<key>_currency` companion for monetary fields — *not* nested under a `custom_fields` object, which is v2-only). New helpers `pdFieldEmpty_` (empty check across scalar / `{value}` / `{id}` / `{}`) and `pdHasIfEmptyConstant_` (does any effective rule have a constant `if_empty`?) support this; `pdApplyDealContents_` gained an `isNewDeal` param and, for a LINK with an `if_empty` constant rule, reads the deal's current fields once via `pdGetDeal_` before resolving (`isNewDeal` is threaded from the create paths → `true` and the link paths → `false`; `pushRunToPipedrive`'s signature/gates/returns are unchanged). **No global rules (or every rule overridden off) = a no-op**, so the push works before any field mapping exists.

### Config UI populated live from Pipedrive
So Pipedrive stays the single source of truth, the config editors read its catalog live: `getPipedriveConfigBootstrap(refresh)` returns products + deal/org field definitions (cached ~10 min via `CacheService`) and `searchPipedriveOrganizations(term)` powers the org picker; `getPipedriveSettingsBootstrap(refresh)` reuses that cached catalog for the global rule builder.

### UI surfaces
- **System Settings → Pipedrive Settings (`ViewPipedriveSettings.html`, new)** — the **global** screen: the **connection setup** (token + domain + defaults, validated live; moved here out of the Dealer Rules panel), the **"Product → Organization field"** picker (the `product_org_field` setting — see *Org-scoped product picker*), the **"Link dealers to organizations"** bulk linker card (scan → review → save — see *Bulk dealer → organization linker*), and the **global deal-field rules builder** (copy / conditional / **constant** rules against the live `dealFields` / `orgFields`). The rule-card editor's mode selector has a third **"Set value"** (constant) segmented button: a value picker that **reuses `psRenderValuePicker_`** (an enum/set deal field → a dropdown of its options; number/text → a plain input) plus an **"Only set if the deal's field is empty"** checkbox. Per-dealer overrides inherit the mode automatically.
- **Dealer Rules → Pipedrive panel (`ViewRules.html`)** — now **per-dealer only**: connection state is read-only (it points to System Settings when not connected); a per-group org picker; a type→product grid (**org-scoped** when `product_org_field` is set, with a per-group **"Show all products"** escape hatch and preserve-already-saved — see *Org-scoped product picker*) with a **variation selector** (lazy-loaded per product); and a **Deal-Field Overrides** section listing each global rule with **Use-global / Off / Override…**, where the inline "Override…" editor **reuses a shared, context-parameterized rule-card editor** (`psRenderRuleCard_` / `psSerializeOneRule_` / `psDeserializeOneRule_` / `psRegisterRuleCtx_`) shared with the global settings screen so there is one implementation.
- **App shell (`App.html`)** — a collapsible **"System Settings"** sidebar group (`toggleSettingsGroup`) houses Dealer Rules, Normalization, Data Sources, and the new Pipedrive Settings; navigating to any of them keeps the group expanded.
- **Run Order (`ViewRun.html`)** — each finalization card now leads with an up-front **New Deal / Existing / Test** method selector + one **Finalize** button (Existing reveals a deal-id input), driven by the card's `pushModes`. New Deal / Existing create-or-link the deal as part of finalizing (`finalizeRunNewDeal` / `finalizeRunExisting`); a finalize-ok-but-push-fail result keeps the card finalized and offers **Retry**. *(Replaces the earlier separate "Push to Pipedrive" sub-block that appeared only after a deal-id finalize.)*
- **VIN Logs (`ViewVinLog.html`)** — a per-run **Push to Pipedrive** / retry action for finalized runs; **Commit is disabled for a `test` run** (test runs never enter the VIN log).

---

## CSV Schemas

Defined in the `CSV_SCHEMAS` tab of SF_DEALER_CONFIG.

| Schema Key | Description | Columns |
|---|---|---|
| `SCP` | Shortcut Pack — full 10-col output (most dealers) | `NEWYEARMAKE, MODEL, TRIM, YEARMODELSTOCK, TYPEVIN, @QR, YEARMODELSTOCK, TYPEVIN, @QR2, MISC` |
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
| N | 14 | TYPESTOCK *(the `QRSTOCK` field code maps here)* | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(UPPER(TRIM(G2:G))="CPO-EL","CPO-EL - ",IF(UPPER(TRIM(G2:G))="CPO","CPO - ",IF(UPPER(TRIM(G2:G))="NEW","NEW - ",IF(UPPER(TRIM(G2:G))="PO","USED - ",UPPER(TRIM(G2:G))&" - "))))&UPPER(F2:F)))` *(exact-match cascade: `New`→NEW, `PO`→USED, `CPO`/`CPO-EL` literal, **any other registered/custom type → its own uppercased name** (not USED). Updated June 2026 for the dynamic vehicle-type registry — behavior-identical for the canonical four; replaces the substring `SEARCH` cascade, which both defaulted custom types to USED and could misclassify a custom name containing `po`/`cpo`/`new`.)* |
| O | 15 | MISC | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",A2:A&" "&C2:C&" - "&E2:E&" - "&F2:F))` |
| P | 16 | PRICE_FMT | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",TEXT(H2:H,"#,##0")))` *(no dollar sign — updated June 2026)* |
| Q | 17 | NEWYEARMAKE | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(ISNUMBER(SEARCH("New",G2:G)),"NEW "&UPPER(A2:A&" "&B2:B),UPPER(A2:A&" "&B2:B))))` |
| R | 18 | TYPEVIN | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(UPPER(TRIM(G2:G))="CPO-EL","CPO-EL - ",IF(UPPER(TRIM(G2:G))="CPO","CPO - ",IF(UPPER(TRIM(G2:G))="NEW","NEW - ",IF(UPPER(TRIM(G2:G))="PO","USED - ",UPPER(TRIM(G2:G))&" - "))))&UPPER(E2:E)))` *(same exact-match cascade as TYPESTOCK — custom types print their own uppercased name; updated June 2026 for the type registry.)* |
| S | 19 | YEARMODELSTOCK | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",UPPER(A2:A&" "&C2:C&" - "&F2:F)))` |
| T | 20 | PRICE_PLUS_2000 | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IF(H2:H="*","*","$"&TEXT(H2:H+2000,"#,##0"))))` |
| U | 21 | PRICE_TAGLINE | `=ARRAYFORMULA(IF(ISBLANK(A2:A),"",IFERROR(IF(VALUE(H2:H)>=15000,"as low as $300/mo",IF(VALUE(H2:H)>=10000,"Below $15,000","Below $10,000")),"")))` *(PRICE_RAW is stored as text — `VALUE()` coerces before comparison; `IFERROR` blanks non-numeric prices)* |

**Cols A–I are the QUERY spill zone.** Nothing should be written there in the template. Col J is the first script-written column. Cols K onward are ARRAYFORMULAs that auto-expand with QUERY output.

### Other Tabs

**ORDER** — VINs/stock numbers for current order. Col A from row 2. Header: `STOCK_OR_VIN`.

**SCRAPERDATA** — Full dealer inventory (21 cols A–U). Written by script.

**LINKBUILDER** — Col A: source URL, Col B: UTM-tagged URL, Col C: alt URL (BMW of Columbia).

**CSV / CSV_`<SCHEMA>` / etc.** — Final export sheets built from ORDERMATCH, grouped by the schema resolved from the Pipedrive product map (one schema → `CSV`, else `CSV_<SCHEMA>`). Headers are auto-suffixed when a schema contains duplicate field codes (`YEARMODELSTOCK`, `YEARMODELSTOCK2`, etc.).

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

VIN log entries are **never written automatically — not by a run, and not by finalizing one.** The workflow is:

1. Run completes → results shown as finalization card(s) in the modal (nothing logged yet)
2. User reviews results, creates the Pipedrive deal(s), and **finalizes** each card with its deal ID → RUN_LOG row written with produced VINs in col V, status = pending (or **abandons** the card — never logged)
3. Commit either via **✓ Add to VIN Log** in the modal (commits all finalized entries), or later via **SilverFox V2 → Update VIN Log...**
4. In the Updater: select dealer → see pending/committed runs → **Commit to VIN Log** → entries appended with `committed_at` timestamp
5. If a run was committed in error → click **Rollback** → entries removed by deal ID + `committed_at` key

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

## Trim Normalization & Cleanup — Analysis & Deferred Design *(June 2026)*

**Status:** Analysis complete; **implementation deferred** by request. This section is the complete spec to implement later — no further investigation needed.

### The problem
Vehicle **Trim** strings from the scraper are often too long or carry extraneous labels (bed lengths, wheelbase measurements, body-style words, encoding artifacts), so they overflow the Illustrator print template and require manual editing before a graphic can be produced. Goal: auto-clean trims to minimize that manual work.

### How trim is processed today
- Normalization is **exact full-string match only**. `normalizeScraperData_()` applies a global exact-match lookup then a per-column exact-match lookup; `normalizeCell_(value, lookup)` returns the mapped value or the original. Trim is **column index 6** (`NORM_COL.TRIM`). There is **no substring/regex/token-stripping** in this path.
- Cleaning a trim today therefore requires **one hand-authored exact rule per raw string** in the NORM_MAPS `trim` map (e.g. `"4WD Crew Cab 143.5\" SLE" → "Crew Cab SLE"`). ~120 such rules exist.
- There **are 1,319 distinct raw trim values** across active inventory — so exact rules do not scale. Snapshot the current distinct values anytime via **Refresh Norm/Field Reference** (`refreshNormReference()`) → NORM_MAPS **col H**.
- A separate, **per-dealer** literal substring `remove` exists in `applyDataTransforms_()` (Glendale only), but it runs on the *output doc* (1-based `TRIM_COL = 7`), single-occurrence `String.replace(s,'')`, and is not global.
- Downstream: trim → ORDERMATCH col D (`TRIM`, uppercased) → CSV schemas (e.g. SCP col_3). Blank trims become `*`.

### Analysis — what can be removed

**Safe to auto-strip globally** (structural junk, universally unwanted on a graphic):

| Category | Examples in the data | Notes |
|---|---|---|
| Encoding artifacts | `&quot;`→`"`, `%2F`→`/`, mojibake `â` | Decode **first**, before measurement matching. Do *not* blanket-strip a bare `â` (locale-fragile) — target the specific mojibake sequences. |
| Bed / box length | `5.5' Box`, `5'7" Box`, `6'4 BOX`, `8' Box`, `5' Bed`, `64 Box`, `57 Box` | Very common on trucks. |
| Wheelbase / cab / inch dims | `143.5"`, `147"`, `128.3"`, `193" WB 108" CA`, `60' CA`, `159' WB` | |
| National-spec marker | `(Natl)` | |
| Brand/legal symbols | `®`, `™` (`Platinum®`, `C 300 4MATIC®`, `PRO-4X®`) | |
| Body-style words (narrow set) | `4dr`, `2dr`, `5dr`, `Sdn`, `Sedan`, `Wgn` | Anchor with `\b`. **Drop `HB`** from the auto set (high false-positive risk). |
| BMW noise | `Sports Activity Vehicle` / `Sports Activity` | |

**Context-dependent — do NOT blanket-strip** (often the meaningful differentiator; leave to exact-map rules or keep):

| Category | Examples | Why keep |
|---|---|---|
| Drivetrain | `AWD`, `FWD`, `4WD`, `4x4`, `quattro`, `xDrive`, `4MOTION` | Meaningful; existing rules keep these. |
| Engine specs | `3.6L V6`, `2.5 Turbo`, `EcoBoost`, `5.7L V8` | Sometimes the trim essence (Mazda "2.5 Turbo", Audi "45 TFSI"). |
| Spelled door counts | `4-DOOR RUBICON`, `2-DOOR SPORT` | Door count is part of Jeep Wrangler / Bronco trims — do **not** remove the spelled `4-DOOR`/`2-DOOR`. |
| Coupe/convertible body words | `Coupe`, `Convertible`, `Cabriolet`, `Fastback`, `Hardtop` | Meaningful (e.g. Porsche `Carrera GTS Cabriolet`, BMW `430i Convertible`). |
| Package/option codes | `w/1LT`, `w/2LT`, `w/1FL`, `(2FL)`, `w/Knapheide…` | Mixed; per-string. |
| Abbreviations | `Premium`→`Prem`, `Package`→`Pkg`, `w/Technology`→`w/Tech` | Replacement, not removal; per-string. |
| Truck descriptors | `GVWR`, `Med Rf`/`Roof`, `CARGO VAN`, `9070 GVWR` | Per-string exact rules. |
| Pure-noise singletons | `+`, `.`, `WB`, `2` | Map to `*`. But `S`/`L`/`M`/`T` are real trims — never auto-blank. |

### Approach options (decision pending)
- **A — Full auto-cleanup now:** implement the complete regex cleanup pass (all safe categories) + exact-map adds, behind a feature flag + dry-run. Most reduction; one round.
- **B — Phased (recommended):** ship the zero-false-positive fixes first (decode `&quot;`/`%2F`, strip `(Natl)`, `®`/`™`), validate via dry-run, then enable the measurement/bed-length/body-word stripping in a second round. Safest path to the same end state.
- **C — Exact-match rules only:** no code change; just keep adding raw→clean rules to the `trim` map. Zero behavior surprise, but does not scale to 1,300+ values.

### Recommended design (validated; for when implemented)
Add a **global `cleanTrim_(str)` regex pass** applied to the trim column inside `normalizeScraperData_()`, **after** the exact-match `trim` map (so existing exact rules fire first on the raw full string; `cleanTrim_` only cleans the unmapped long tail and is harmless/idempotent on already-clean values). Integration seam:

```
val = normalizeCell_(rows[r][c], globalLookup);
if (colLookups[c]) val = normalizeCell_(val, colLookups[c]);
if (c === NORM_COL.TRIM) val = cleanTrim_(val);   // <-- new
rows[r][c] = (val === '') ? '*' : val;
```

**Ordered patterns** (case-insensitive, ES5-safe — no lookbehind): (1) decode artifacts → (2) bed/box → (3) wheelbase/inch/`WB`/`CA` dims → (4) `(Natl)` → (5) `®`/`™` → (6) narrow body words (anchored `\b`, no `HB`) → (7) `Sports Activity [Vehicle]` → (8) collapse whitespace + trim edge punctuation. **Decode (1) must precede measurement matching (2,3).**

**Required guards (non-negotiable):**
- **Never-empty:** if cleaning yields `""`, return the **original** pre-clean string (not `*`).
- **Never-bare-residue:** if the result is just a measurement or a lone body word (e.g. `"4D Sedan"`→`"4D"`, `"2dr Cpe"`→`"Cpe"`), revert to original.
- Anchor every body word with `\b`; drop `HB` from the auto set; do not bare-strip `â`.

**Where patterns live:** a **hardcoded `TRIM_CLEANUP_PATTERNS` constant** in `Code.gs` (near `NORMALIZATION_MAPS`). Do **not** put live regex in a NORM_MAPS sheet — unvalidated regex with global blast radius is exactly the failure mode to avoid. The exact-match `trim` map stays the config-driven, user-editable override layer.

**Rollout safety (this changes trim for ALL ~28 dealers at once):**
- **Feature flag** `ENABLE_TRIM_CLEANUP` (default **off**) gating the `cleanTrim_` call — ship dark, validate, flip on, instant rollback without a code push.
- **Dry-run harness** `dryRunCleanTrim_()` (read-only): run every current distinct trim (NORM_MAPS col H) through `cleanTrim_` in memory and write a `raw | cleaned | changed?` diff to a scratch sheet. Eyeball every changed row — hunt for results that shrank to ≤2 chars, equal a measurement, or lost a meaningful body word (Coupe/Convertible/4-DOOR/2-DOOR). Report the changed-count as a greediness sanity gate.

**Do not double-process:** `cleanTrim_` belongs only in `normalizeScraperData_()` (index 6). The Glendale `applyDataTransforms_` `remove` (output doc, col 7) is a separate stage — confirm its rules don't conflict once the global pass is on.

### Proposed exact-match `trim` rules to add (residuals the regex won't handle)
`PROMASTER 1500 TRADESMAN CARGO VAN LOW ROOF 118' W → PROMASTER 1500 TRADESMAN` · `T-250 148" Med Rf 9070 GVWR RWD → T-250` · `2500 Standard Roof V6 144" 4WD → 2500 4WD` · `Work Truck w/Knapheide Bed Conversion → Work Truck` · `4dr Sdn LT w/1LT → LT` · `XtraCab V6 Manual 4WD → XtraCab 4WD` · `SEL w/Two-Tone Roof → SEL` · `2.5 Turbo Premium Plus Package AWD → Premium Plus AWD` · `Premium Plus 45 TFSI quattro → Premium Plus quattro` · `4dr Wgn 3.5L AWD EcoBoost → AWD EcoBoost` · `85TH ANNIVERSARY EDITION 4X4 → 85TH ANNIVERSARY 4X4` · noise singletons `+`, `.`, `WB`, `2` → `*` (never auto-blank `S`/`L`/`M`/`T`). *(Authored via Manage Normalization Maps; extend as the col-H reference surfaces more.)*

### Code anchors (for the implementer)
`Code.gs`: `NORM_COL`/constants ~69; `normalizeCell_` ~791 and `normalizeScraperData_` ~797 (integration seam); `applyDataTransforms_` ~897 (double-process check); `refreshNormReference()` ~1706 / `loadNormalizationMaps_` ~1682 (reference snapshot + exact-map adds + dry-run source).

---

## Production Workflow — Step by Step

1. **Check TRANSCRIPTION** — paste VINs in col A and confirm they show "Found" in real time before creating an order.
2. **Import/verify scraper data** — SilverFox V2 → Import Scraper Data. Review post-import panel.
3. **Open Run Dealer modal** — SilverFox V2 → Run Dealer...
4. **Select "Running as:"** — choose your name from the dropdown. Your local QR path is resolved automatically. The dropdown remembers your last selection.
5. **Select dealer** from dropdown.
6. *(Optional)* **Enter Pipedrive Deal ID(s)** — pre-fills the **Existing**-deal input on the finalization card shown after the run. Leave blank to create a brand-new deal at finalize time (the **New Deal** method) or to run a `test`.
7. **Enter VINs** — either paste manually, or click **⟳ Pre-fill from CAO** to automatically pull net-new inventory filtered by `filtering_rules` and deduped against VIN log. Review the CAO summary before proceeding.
8. *(Optional)* **Check "Bypass filtering rules"** if a specific vehicle is being incorrectly filtered.
9. **Click Run Dealer.** Progress bar and step messages update in real time. Nothing is logged yet.
10. **Pick a method and finalize (or abandon) each result card.** After completion, one finalization card appears per billing account (one for normal dealers; two for a split run with group units). On each card choose a push method, then click **Finalize**: **New Deal** creates a fresh Pipedrive deal first (no deal ID to type — the real id is generated and used to finalize), **Existing** links a deal you've already created (enter its ID — it's validated before anything is written), or **Test** logs the run with `test` (never touches Pipedrive and is excluded from the VIN log). Finalizing writes the RUN_LOG/ORDER_STATS row and (for New Deal / Existing) attaches the per-type products + sets deal fields; if the deal step fails after the row is written, the card stays finalized and offers **Retry**. Or click **Abandon**: the entry is never logged, and if nothing in the run was finalized, the output doc and QR codes are moved to Drive trash (warning popup explains this).
11. **Open Output Folder** to access the output doc and QR codes. Review the output doc and the Pipedrive entry.
12. **Download QR codes** from Drive to your configured local QR folder (set in USER_PROFILES tab).
13. **Export CSV** from output doc → import into Adobe Illustrator for variable data printing.
14. **Commit to VIN Log** — either click **✓ Add to VIN Log** in the modal (enabled once at least one card is finalized; commits all finalized entries), or use SilverFox V2 → Update VIN Log... later. The VIN log is **never** written automatically — finalizing a run does not commit it.

---

## Apps Script — Function Reference

Bound to SF_SYSTEM_MASTER.

### Code.gs — Key Functions

| Function | Signature | Description |
|---|---|---|
| `onOpen` | `()` | Installs the menu: **🚀 Open SilverFox** (`openApp`) + "Classic menu (deprecated)" submenu with the per-view items. |
| `openApp` | `()` | Opens the SilverFox App — `App.html` evaluated as an HtmlService template (1400×900; `MODAL_WIDTH`/`MODAL_HEIGHT`); views stitched in via `include_()`. |
| `include_` | `(name)` | Template include helper — returns a fragment file's raw content for `<?!= include_('ViewXxx') ?>` scriptlets. |
| `openViewStandalone_` | `(fragmentName, title)` | Serves one converted view fragment inside `Classic.html` as a standalone dialog — powers the Classic fallback menu with zero duplication. |
| `getAppBootstrap` | `()` | Single round-trip App bootstrap: `{dealers, users}` (active dealers incl. `splitDealLabel` + user profiles/lastUser). Prefetched once per App session into the shared client-side `AppData` latch (SharedUtils) — Run Order and VIN Logs populate from it instead of firing separate executions. |
| `getAppHomeStatus` | `()` | Home status strip: `{lastImportDate, lastImportTime}` from SCRAPERDATA W1:X1 display values. *(Superseded on Home by `getDashboardView`, which carries the same timestamp; retained for the Classic standalone path.)* |
| `getDashboardView` | `()` | Returns the DASHBOARD tab as `{rows}` — a 2D array of display strings (serializable, no Date objects). Rendered by the Home view; reflects `refreshDashboard_`'s inventory table plus the live formula-driven Run Log Summary / Most Recent Run / Runs By Dealer sections, so Home shows current run numbers without a re-import. |
| `getTranscriptionVins` | `()` | Returns `{vins, count, lastImport}` — the deduped, upper/trim-normalized set of all SCRAPERDATA col-A VINs plus the last-import timestamp. The Transcription view loads it once into a client-side `{VIN:1}` index and checks typed VINs against it instantly (the in-app equivalent of the TRANSCRIPTION sheet's Found/Not-Found ARRAYFORMULA). |
| `appEraseAllQRFolders` / `appCleanUpOutputDocs` / `appRefreshNormReference` / `appOpenRunLog` | `()` | App wrappers returning `{message}` for in-app toasts (`ui.alert` fails when invoked via `google.script.run`); the classic menu functions keep their alerts and share the `*Core_` implementations. |
| `promptRunDealer` | `()` | Classic fallback: opens the ViewRun fragment standalone via `openViewStandalone_`. |
| `openScraperImport` | `()` | Classic fallback: opens the ViewImport fragment standalone. |
| `openNormManager` | `()` | Classic fallback: opens the ViewNorm fragment standalone. |
| `openVINLogUpdater` | `()` | Classic fallback: opens the ViewVinLog fragment standalone. |
| `openRulesEditor` | `()` | Classic fallback: opens the ViewRules fragment standalone. |
| `getRulesEditorBootstrap` | `()` | Single round-trip bootstrap for Rules Editor. Returns `{dealers, schemas}` — active dealers and all CSV schema keys from CSV_SCHEMAS tab. |
| `getDealerRulesData` | `(dealerKey)` | Returns `{dealerName, typeRules, filteringRules}` — parsed objects for both rule sets. Safe defaults on parse failure. *(`typeRules` is now ignored by the UI — the Type Rules editor tab was removed.)* |
| `saveDealerTypeRules` | `(dealerKey, typeRulesJson)` | Validates JSON and writes to DEALERS col O (TYPE_RULES). **No longer called from the UI** (Type Rules editor removed); col O is dormant. |
| `saveDealerFilterRules` | `(dealerKey, filteringRulesJson)` | Validates JSON and writes to DEALERS col W (FILTER_RULES). |
| `buildTypeRulesFromProductMap_` | `(productMap)` | **(new, pure)** Builds the run's synthetic type rules from the Pipedrive product map — one `{match, csv_schema: entry.schema, utm: entry.utm}` per mapped type, **ordered CPO-EL before CPO** (substring safety). Replaces `getTypeRules_` in the run path so `buildLinks_`/`buildCSVSheet_` are unchanged. |
| `validateProductMapForRun_` | `(matchedTypes, productMap)` | **(new, pure)** Returns the matched types whose product-map entry is missing a `product_id` or a `schema`. Non-empty → `runDealer` throws ("set them in Dealer Rules → Pipedrive"). UTM not required. |
| `getCsvProductMaps_` | `(dealerKey, sourceSplit)` | Reads the dealer's Pipedrive product maps via `getPipedriveDealerRows_` → `{main, secondary}` (main merged across billing groups, first-wins; secondary = the `source_split` group's `source_product_map`). `{}` when Pipedrive is unset. |
| `migrateTypeRulesIntoProductMap` | `()` | **(new; one-time, run from the editor)** Copies each dealer's legacy per-type `schema` + `utm` (from col O, via `matchRule_`) into its `product_map`/`source_product_map` entries — only where a product is mapped, never overwriting. Saves via `savePipedriveDealerConfig`; idempotent. |
| `pasteVinsAndRun` | `(dealerKey, vins, dealId, runId, bypassFilters, userKey, splitDealId)` | Resolves QR base path for `userKey` from USER_PROFILES, persists selection, writes VINs to ORDERS, calls `runDealer` (passing preloaded config to avoid a redundant SF_DEALER_CONFIG read). Both deal IDs are **optional** — they only pre-fill the finalization cards. Returns result object. |
| `runDealer` | `(dealerKey, dealId, runId, bypassFilters, qrBasePath, preloadedConfig, splitDealId)` | Main entry point. Produces the output doc / QR codes / CSV / billing sheet(s) but **writes no log rows** — returns `{outputFolderUrl, pendingRuns, dealerName, producedVinCount}` where `pendingRuns` holds one self-contained prospective log entry per billing account, finalized or abandoned in the modal. |
| `finalizeRun` | `(dealerKey, entry, dealId)` | Writes the RUN_LOG (+ ORDER_STATS) row for one finalized pending-run entry via `writeRunLog_`. Throws on blank deal ID (**invariant: no RUN_LOG row without a deal ID**; `test` marks test runs). Never touches the VIN log. Returns `{rowIndex, vinCount}`. Called directly for a **Test** finalize, and internally by `finalizeRunNewDeal` / `finalizeRunExisting` (with the real/created deal id). |
| `finalizeRunNewDeal` | `(dealerKey, entry)` | **New Deal** finalize. Resolves the run context, preempts deactivated products, creates a fresh Pipedrive deal (real numeric id), finalizes the run with it via `finalizeRun`, then attaches products + sets fields (`pdApplyDealContents_`). Retry-safe via the `pd_new_<outputDocId|group>` token cache (caches the deal id, then `rowIndex`, the instant PD returns it — a retry adopts, never re-creates). Returns the push result `{ok, dealId, rowIndex, vinCount, …}`. |
| `finalizeRunExisting` | `(dealerKey, entry, existingDealId)` | **Existing** finalize. Validates the supplied deal id via `pdGetDeal_` **first** (no row written for a bad id), finalizes with it, then links products via `pushRunToPipedrive(…, 'link', id)`. Returns the push result with `rowIndex` attached. |
| `getRunPushModes` | `(dealerKey, group)` | Which finalize methods a run card offers: `{test, newDeal, existing, reason}`. Test always true; New/Existing require a connected Pipedrive **and** an active org config for the dealer/group. Attached as `pushModes` on each `pendingRuns` entry. |
| `pdResolveRunContext_` / `pdResolveDealId_` / `pdCheckInactiveProducts_` / `pdApplyDealContents_` | (various) | Reusable push helpers extracted from `pushRunToPipedrive` (no behavior change). `pdResolveRunContext_` = read-only config/org gate + currency + line items (incl. `source_split`); `pdResolveDealId_` = create-or-validate a deal, persisting nothing; `pdCheckInactiveProducts_` = the `inactive_product` preempt; `pdApplyDealContents_` = attach products + set fields, idempotent via the passed `state`. Composed by both `pushRunToPipedrive` and the finalize orchestrators. |
| `abandonRun` | `(dealerKey, outputDocId)` | Full-abandonment cleanup: moves the output doc and the dealer's `<prefix>_QR_Code_N.PNG` files to Drive trash (30-day recovery). Called only when no card of the run was finalized and none remain pending. Returns `{trashedDoc, trashedQrs}`. |
| `getBillingSplit_` | `(config)` | Parses/validates the optional `billing_split` key from `filtering_rules` (col W). Returns `{groupName, dealLabel, field, op, values}` or **null** on absence/misconfig (fail-safe — run behaves as unsplit). |
| `isInBillingGroup_` | `(vehicle, split)` | Tests one parsed ORDERMATCH vehicle object against a billing split (case-insensitive `contains`/`in`, OR across values). |
| `getCaoVins` | `(dealerKey)` | Pulls current inventory, applies filtering_rules, deduplicates against VIN log. Returns `{vins, summary}`. Called by Run Dealer modal. |
| `getDealerFilterRules_` | `(config)` | Parses `filtering_rules` JSON from dealer config row. Returns structured object with safe defaults (incl. `targetingRules`, `caoExcludeTypes`). |
| `applyFilteringRules_` | `(vehicles, filterRules, phase)` | Filters SCRAPERDATA-format rows. `phase` ('cao'/'run', default 'run') gates `cao_exclude_types` + `exclude_cao` rules (CAO only); `exclude_order` rules apply in both. Returns `{passed, rejected}` with per-vehicle rejection reasons (incl. `rule:exclude_order`, `rule:exclude_cao`, `cao_excluded`). |
| `conditionMatches_` | `(row, cond)` | Evaluates one targeting condition leaf (`{field, op, values}`) against a SCRAPERDATA row via `getFilterFieldIndex_()`. Returns **bool**. Ops `in/not_in/contains/not_contains/gte/lte/gt/lt`, price-safe numeric coercion. **Fails SAFE** (no match) on unknown field/op, empty values, or unparseable number — so an exclusion can't fire on a typo. |
| `groupMatches_` | `(row, group)` | Recursive AND/OR evaluator: `match:"all"` = every child matches, `"any"` = some child matches; a child is a condition or a nested group; empty group → false (fail-safe). |
| `ruleMatches_` | `(row, rule)` | True when `rule.group` matches the row. Drives both the import drop pass and `applyFilteringRules_`. |
| `getConfigSS_` | `()` | Returns the SF_DEALER_CONFIG Spreadsheet object, opening it only on the first call per script execution. All config reads use this instead of direct `openById` calls. |
| `getDealerConfig_` | `(dealerKey)` | Reads dealer row from SF_DEALER_CONFIG DEALERS tab via `getConfigSS_()`. |
| `getTypeRules_` | `(config)` | Parses `type_rules` JSON (col O). Falls back to SCP default if absent. **No longer called by the run** — kept only for `migrateTypeRulesIntoProductMap()`. |
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
| `writeRunLog_` | `(config, dealId, ..., note)` | Appends 23-column row to RUN_LOG. Per-type billing columns (G–N) sourced from the billing totals object. Optional `note` lands in col U (`SPLIT:PRIMARY` / `SPLIT:<group>` markers). Also side-writes a 12-column analytics row to ORDER_STATS (isolated try/catch, non-fatal). Returns 1-based row index of new entry. **Called only by `finalizeRun`** — once per finalized card, never during the run itself. |
| `writeBillingSheet_` | `(outputDoc, billingSplit)` | Reads ORDER/ORDERMATCH/LOG, partitions matched vehicles when `billingSplit` is active, and renders BILLING (+ BILLING_<group>, created on demand) via `renderBillingSheet_`. Returns `{primary: {matchedCount, producedVins}, group: …\|null}` or null if sheets missing. |
| `renderBillingSheet_` | `(sheet, omRows, totalOrdered, notFoundList, logMap)` | Renders one billing sheet from scratch (five sections). All four vehicle types always get a row (zero if absent). Duplicate detail table at col F row 1. Produced VINs list in col B below the summary. Layout matches `readBillingTotals_`'s label map. |
| `readBillingTotals_` | `(outputDoc, sheetName?)` | Reads a billing sheet by label (not cell address) and returns a structured totals object used to populate the RUN_LOG. `sheetName` defaults to `BILLING`; pass `BILLING_<group>` for a split sheet. |
| `getRunsForDealer` | `(dealerKey)` | Returns RUN_LOG rows for a dealer (reading 23 columns), most recent first, with status and `note` (col U — surfaces the `SPLIT:*` badge in the VIN Log Updater). |
| `commitRunToVINLog` | `(dealerKey, runRowIndex, dealId, producedVins)` | Appends VINs to SF_VIN_LOGS with `committed_at`, marks RUN_LOG col W as committed. |
| `commitLatestRun` | `(dealerKey, runRowIndex)` | Reads `produced_vins` (col V) and `deal_id` (col D) from RUN_LOG row, calls `commitRunToVINLog`. **Throws on a `test` deal ID** (test runs are debugging-only and never enter the VIN log). |
| `commitRunRows` | `(dealerKey, rowIndexes)` | Commits multiple RUN_LOG rows (post-run button — both rows of a billing-split run). Skips rows already `committed` **and rows whose deal ID is `test`**, so retry after a partial failure is safe. Returns `{committed, skippedCommitted, skippedTest}`. |
| `rollbackRunFromVINLog` | `(dealerKey, runRowIndex, dealId, committedAt)` | Removes VIN log entries by deal ID + committed_at key. Marks RUN_LOG col W as rolled_back. |
| `getCommittedAt` | `(dealerKey, dealId)` | Returns `committed_at` timestamp for a deal ID from VIN log. Used before rollback. |
| `setProgress_` | `(runId, message, percent)` | Writes `{message, percent, done, error}` to ScriptProperties. No-op if runId is falsy. |
| `getRunProgress` | `(runId)` | Returns current progress state. Polled by modal every 1.5 seconds. |
| `clearRunProgress` | `(runId)` | Deletes progress property after run completes. |
| `importScraperData` | `(mappedData, mode, resolutions, fileNames, token)` | Two-phase import. Normalizes incoming rows, builds the working set (`mode`: `'replace'` default = clear-and-write; `'merge'` = combine with existing SCRAPERDATA), runs the VIN dedup engine. Conflicts found + no `resolutions` → returns `{needsResolution, conflicts, token, …}` with **zero mutation**; otherwise (or on the phase-2 call with `resolutions` `{VIN:'existing'\|'new'}` + `'*'` bulk fallback, verified against `token`) groups rows by Location and writes under a `LockService` script lock. Stats/health/dashboard computed on the **final** dataset. Returns review stats + `{mode, duplicatesRemoved, conflictsResolved, blankVinCount, fileCount}`. |
| `dedupeScraperRows_` | `(baseRows, newRows, fileNames)` | VIN-keyed dedup/conflict engine. Order: existing rows → files in selection order. First-seen row per VIN = incumbent; identical later rows (tolerant compare) dropped silently; differing rows become/replace the "challenger" (latest distinct wins, `variantCount` tracked) → 2-way conflict. Blank/`*` VINs pass through unkeyed. |
| `cellsEqual_` / `rowsEqual_` / `diffCols_` | `(a, b)` | Tolerant comparison: trim-string equal, else both-numeric equal (`getValues()` returns numbers for non-`@` columns like Year/MSRP while incoming rows are strings — naive compare would false-conflict every merged row). |
| `applyConflictResolutions_` | `(d, resolutions)` | Applies per-VIN choices; `'new'` substitutes the challenger in the incumbent's position; `resolutions['*']` is the bulk fallback for VINs without an explicit choice. |
| `groupRowsByLocation_` | `(rows)` | Buckets rows by exact Location string (col T) in first-seen order and concatenates — restores the contiguity invariant `getDealerScraperData_` relies on. |
| `readExistingScraperRows_` / `computeImportToken_` | `(sheet)` | Merge-mode base read (A2:U) and the optimistic-concurrency token (`lastRow \| W1 X1 timestamp`) verified between the two phases. |
| `writeImportStats_` | `(ss, timestamp, locationDetail)` | Section 29. Appends one 13-column row per scraper location to IMPORT_STATS after every import. Non-fatal try/catch; skips silently if the sheet is missing. |
| `checkImportHealth_` | `(ss, currentTs, locationDetail)` | Section 29. Reads IMPORT_STATS history (excluding the current import's rows), builds per-location rolling baselines, and returns `[{location, severity, message}]`. Hard errors: total dropped to 0 with prior data; `no_stock`/`no_price` > 20% (`MISSING_FIELD_THRESHOLD`). Baseline warnings (≥ 5 prior rows, `MIN_IMPORTS_FOR_BASELINE`): total/new/po > 40% below rolling average (`DROP_THRESHOLD`); unexpected type appeared. Under-baseline locations return `info` "Building baseline". |
| `refreshDashboard_` | `(ss, importTimestamp, locationDetail)` | Section 30. Rewrites the DASHBOARD tab: timestamp, alphabetical per-location inventory table, TOTALS row, then RUN LOG SUMMARY / MOST RECENT RUN / RUNS BY DEALER sections at dynamic row positions. Clears stale rows; fully dynamic formatting, no merged cells; IFERROR-wrapped formulas. Called at the end of every `importScraperData()`. Non-fatal. |
| `buildNormLookup_` | `(map)` | Converts a norm map array into a lowercase-keyed hash object for O(1) lookups. Called once per map at the start of `normalizeScraperData_()`. |
| `normalizeCell_` | `(value, lookup)` | Normalizes a single cell value against a pre-built lookup object (O(1)). |
| `normalizeScraperData_` | `(rows)` | Builds lookup objects via `buildNormLookup_()`, then runs global + column-specific normalization passes in-place. Fills blanks with `*`. |
| `loadNormalizationMaps_` | `()` | Reads from NORM_MAPS sheet via `getConfigSS_()`. Falls back to hardcoded constant. |
| `refreshNormReference` | `()` | Menu action. Scans SCRAPERDATA once and writes a static sorted distinct-values reference (Type/Make/Model/Trim/Status/Body Style/Fuel Type) to NORM_MAPS cols E+, with per-column counts and a timestamp. On-demand replacement for the removed live `UNIQUE()` reference formulas — zero recalc cost. |
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

> **The SilverFox App (June 2026, `feature/app-shell`).** The five standalone modals were converted into **view fragments** inside a single-modal SPA. The menu has one primary item — **🚀 Open SilverFox** (`openApp`) — opening `App.html` (1400×900): a persistent left **sidebar** (Home, Run Order, Import Data, VIN Logs, Transcription, Dealer Rules, Normalization, Utilities, Close), a header with the section title, and a content area where views are stitched in via `<?!= include_('ViewXxx') ?>` (HtmlService templating). Navigation is instant client-side show/hide (`navTo`) — **hidden views retain full DOM + JS state** (live progress polling, pending finalization cards, dirty flags all survive switching views). Views lazy-initialize on first visit via the `VIEW_INITS` registry (`VIEW_SHOWN` re-runs per visit, e.g. table sizing). Supporting files: `ViewHome.html` (workflow launcher cards + a **live Dashboard render** of the DASHBOARD sheet via `getDashboardView`, reloaded on every Home visit through `VIEW_SHOWN` + a Refresh button, with the last-import status strip derived from the dashboard's timestamp row), `ViewUtilities.html` (the five maintenance buttons — Update Timestamp, Refresh Norm Reference, View Run Log, Clear QR Folders, Clean Up Output Docs — moved off Home onto their own 🔧 Utilities sidebar page; in-app toasts via the `runUtility`/`confirmUtility` helpers), `ViewTranscription.html` (🔍 Transcription — paste/type VINs and get instant Found/Not-Found against the current inventory via `getTranscriptionVins`, a client-side `{VIN:1}` index checked per keystroke; the in-app mirror of the TRANSCRIPTION sheet's ARRAYFORMULA), `SharedUtils.html` (shared `escHtml`, `toast`, `AppGuards` close-guards, `AppBusy` mutual-exclusion flags — included **before** the fragments so parse-time registrations work), and `Classic.html` + `openViewStandalone_` (serves any single fragment standalone — powers the **"Classic menu (deprecated)"** submenu fallback during validation with zero code duplication; remove at sign-off). New invariants: `.view[hidden]{display:none !important}` (author display rules would defeat `[hidden]`); imports and runs are mutually exclusive via `AppBusy`; exits run all registered guards through `exitApp()`.
>
> File renames: `DealerSelector.html`→`ViewRun.html`, `ScraperImport.html`→`ViewImport.html`, `VINLogUpdater.html`→`ViewVinLog.html`, `RulesEditor.html`→`ViewRules.html`, `NormManager.html`→`ViewNorm.html`. The per-view descriptions below still apply (CSS is scoped per view; the formerly-colliding `status`/`dealerSelect`/`vinCount` ids and `setStatus`/`updateVinCount` helpers are view-prefixed). In the App, ViewRun's "Update VIN Log" button jumps to the VIN Logs view with the dealer preselected — pending finalization cards survive the jump.

**ViewRun.html** *(formerly DealerSelector.html)* — Run Order view (was the Run Dealer modal). "Running as:" user dropdown (top, required — gates Run button; pre-selects last-used selection per Google account), dealer dropdown, VIN Log status row (appears after a dealer is selected: "Most recent order in log: {id}" populated via `getLatestOrderId`, plus a 📋 Update VIN Log button that opens the VIN Log Updater modal), **optional** Pipedrive Deal ID field (+ optional second deal ID field for billing-split dealers — both only pre-fill the finalization cards), VIN textarea with live count, CAO pre-fill button with filter rejection summary, bypass filters checkbox, progress bar with step messages and elapsed timer. **Post-run finalization panel (method-first, v2.12):** one card per prospective RUN_LOG entry (label, unit/ordered counts, per-card status), each leading with a **New Deal / Existing / Test** method selector + one **Finalize** button (the controls shown come from the entry's `pushModes`; Existing reveals a deal-id input). **New Deal** calls `finalizeRunNewDeal` (creates the deal, finalizes with the real id, attaches products/fields); **Existing** calls `finalizeRunExisting` (validates the id, finalizes, links); **Test** calls `finalizeRun(…, 'test')` (logs only, never touches Pipedrive). A finalize-ok-but-push-fail keeps the card finalized and offers **Retry**. *(Replaces the v2.10 "type a deal ID → Finalize → separate Push to Pipedrive block" flow — a brand-new order no longer needs a deal ID up front, and the `test` placeholder is now an explicit method, not a workaround.)* Abandon is per-card — abandoning the last live card with nothing finalized warns and calls `abandonRun` (output doc + QR PNGs → Drive trash). "✓ Add to VIN Log" enables once ≥1 card is finalized and commits all finalized, uncommitted, non-zero-VIN rows via `commitRunRows` (`test` rows are skipped). Confirm-dialog guards protect un-finalized results on dealer change, new run, and Cancel/Close (the dialog X cannot be intercepted — an X-closed run is never logged).

**ViewImport.html** *(formerly ScraperImport.html)* — Import Data view. **Multi-file import with two modes** (June 2026): a segmented mode selector chooses **Main Import (Replace)** (clears SCRAPERDATA, imports the selected file(s)) or **Merge with Existing** (combines the selected file(s) with the current data). The file input accepts multiple CSVs; each file is parsed independently with its own header mapping (files may have different column orders/sets), rendered as a per-file card (name, row count, matched/missing/ignored columns); a file without a VIN column is rejected and blocks the import (all-or-nothing). A UTF-8 BOM is stripped per file, and stray header rows hiding mid-file (VIN cell = literal "VIN") are dropped. Calls `importScraperData(rows, mode, resolutions, fileNames, token)` — when the server detects VIN conflicts (same VIN, differing data) it returns them without writing, and a **conflict resolution panel** appears: per-VIN side-by-side diff cards (only differing fields shown, sources labeled by filename or "Existing data"; cards are full-width with a `table-layout: fixed` Field/Existing/New table so both occurrences always render — a 2-col grid from the 1400×900 rework had clipped the New column, fixed June 2026), per-VIN keep-existing/keep-new radios, bulk "Keep All Existing"/"Keep All New" buttons (the `'*'` fallback choice covers conflicts beyond the rendered cap of 200), Cancel (safe — nothing written) and Apply & Import. Identical duplicate VINs are removed silently. The review panel shows mode-aware totals plus an Import Summary badge row (files, mode, duplicates removed, conflicts resolved, rows without VIN), the type/status breakdowns, Location × Type table, and the `checkImportHealth_()` health section.

**ViewNorm.html** *(formerly NormManager.html)* — Normalization view. Stacked layout: add form on top, scrollable entries table below. All five maps support inline edit, delete, ▲▼ reorder.

**ViewVinLog.html** *(formerly VINLogUpdater.html)* — VIN Logs view. Dealer dropdown, runs table with timestamp/deal ID/VIN count/status badges, Commit and Rollback action buttons (**Commit is disabled for a `test` run** — test runs never enter the VIN log). After a dealer is selected, a collapsible **"＋ Manually add VINs to log"** panel appears below the runs table. The panel contains an Order Number input (pre-populated with the most recent order ID from the dealer's VIN log tab via `getLatestOrderId`), a VIN textarea (one VIN or stock number per line, with live count), and a Submit button. On submit, calls `manualCommitToVINLog` — which deduplicates the input list (case-insensitive), appends `ORDER_ID | VIN | committed_at` rows directly to SF_VIN_LOGS, and returns the committed count. Does **not** touch the RUN_LOG.

**ViewRules.html** *(formerly RulesEditor.html)* — Dealer Rules view. **The Type Rules tab was removed** *(v2.12)* — per-type schema + UTM now live in the Pipedrive panel's product pickers (each product picker grid carries **Schema** and **UTM** columns). The view now shows the Filtering panel (`require_stock`/`require_price` toggle switches, `allowed_types` and `exclude_status` pill buttons, min/max price inputs, per-type seasoning table) over the Pipedrive panel. `availableSchemas` (CSV schema keys from CSV_SCHEMAS) is still loaded to feed the product picker's Schema column.

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
3. In **Dealer Rules → Pipedrive**, map each post-normalization type (`New`, `PO`, `CPO`) to a product and set its **Schema** + **UTM** — this is the per-type output config (a matched type with no product/schema blocks the run). *(col O `type_rules` is dormant — not read by the run.)*
4. Set `filtering_rules` JSON — use `allowed_types`, `exclude_status: ["OFFLOT"]`, `require_stock: true` as a minimum baseline
5. Create tab in SF_VIN_LOGS named exactly by `dealer_key` with headers `ORDER_ID | VIN | committed_at`
6. Set `active` to TRUE
7. Reload SF_SYSTEM_MASTER — dealer appears in modal immediately

## Adding a New CSV Schema

1. Add row to CSV_SCHEMAS tab with unique `schema_key`
2. Fill `col_1` through `col_N` with valid field codes
3. If the same field code appears multiple times (multi-graphic template), just list it as many times as needed — the header row will auto-suffix duplicates at write time
4. Reference the schema key in the **Schema** column of the dealer's Pipedrive product map (Dealer Rules → Pipedrive)

## Adding a New Field Code

1. Add ARRAYFORMULA column to ORDERMATCH in SF_UNIVERSAL_TEMPLATE; note 1-based column number
2. Add entry to `FIELD_TO_COL` in Code.gs
3. Add row to FIELD_CODES tab in SF_DEALER_CONFIG (documentation only)
4. Add field code to a schema in CSV_SCHEMAS
5. Reference the schema in the **Schema** column of the dealer's Pipedrive product map (Dealer Rules → Pipedrive)

## Adding or Updating Normalization Rules

Use **SilverFox V2 → Manage Normalization Maps**. Never edit Code.gs for routine rule changes.

## Editing per-type output (schema/UTM) or Filtering Rules

Use **SilverFox V2 → Edit Dealer Rules...**. Select a dealer from the dropdown — rules load immediately. The **Pipedrive panel** manages the per-type output config (each product mapping's **Schema** + **UTM**, the sole per-type config); the **Filtering Rules** panel manages `filtering_rules` (col W). Each saves independently. Schema options are loaded live from the CSV_SCHEMAS tab — no hardcoded values. *(The Type Rules editor tab was removed — `type_rules` (col O) is dormant.)*

---

## Capacity & Log Growth Plan *(written June 2026, while logs were <1k rows)*

At production pace the log tabs grow without bound. This section records the limits, the growth math, the thresholds to watch, and the archive design to build **when — and only when — a threshold is hit**. Nothing needs to be built before then.

### The two limits

**Hard limit:** Google Sheets caps a spreadsheet at **10 million cells** (sum of all tabs; empty-but-allocated grid cells count). Each core file (SF_SYSTEM_MASTER, SF_DEALER_CONFIG, SF_UNIVERSAL_TEMPLATE, SF_VIN_LOGS) has its own 10M budget. The log tabs all live in **SF_SYSTEM_MASTER**, so it is the document to watch.

**Practical limit (hits first):** several functions read *entire* log tabs and scale linearly with their size:
- `checkImportHealth_` reads **all of IMPORT_STATS** on every import
- DASHBOARD's RUNS BY DEALER is a **QUERY over RUN_LOG A:W**, recalculated on refresh
- `getRunsForDealer` reads the full RUN_LOG and filters in memory

The NORM_MAPS `UNIQUE()` incident (June 2026) is the canonical example of this failure pattern: cheap for years, then a size threshold turns programmatic access into ~100s timeouts. Expect sluggishness in the **~25k–50k rows-per-tab range — roughly 2–3 years** at production volume.

### Growth math (assumes ~300 orders/week, imports most days)

| Tab | Growth driver | ≈ Cells/year |
|---|---|---|
| RUN_LOG (23 cols) | 1 row per run (~15,600/yr) | ~360k |
| ORDER_STATS (12 cols) | 1 row per run | ~190k |
| IMPORT_STATS (13 cols) | ~43 locations × every import (incl. merges) | ~290k |
| SCRAPERDATA | snapshot — replaced per import, does not accumulate | ~220k standing |

Total ≈ **850k cells/year** vs a 10M ceiling → hard limit is ~8–10 years out; the practical limit arrives first. **IMPORT_STATS is the fastest-growing tab** (merge imports append a row for *every* location) — first to watch if merge imports become frequent.

### Triggers to act

Build the archiver when **any** of these occur:
1. Any log tab exceeds **~25,000 rows**.
2. Imports or DASHBOARD refresh become noticeably slow.
3. SF_SYSTEM_MASTER total cell count passes ~5M (check File → Settings or count rows×cols per tab).

### Archive design (build at trigger time; ~half-day job)

Menu-driven `archiveOldLogs()`:
- Moves rows **older than 12 months** from RUN_LOG, IMPORT_STATS, and ORDER_STATS into a separate **`SF_LOG_ARCHIVE`** spreadsheet (per-year tabs, e.g. `RUN_LOG_2026`).
- **No live function needs to reference the archive** — every runtime consumer only needs recent data: health baselines are rolling averages over recent IMPORT_STATS; commit/rollback only touches recent runs; the DASHBOARD summarizes current state.
- One semantic change: all-time counts (e.g. RUNS BY DEALER) become **trailing-12-months**. Lifetime totals live in the archive workbook (or the archiver writes a small carry-forward summary row).
- Non-fatal/isolated like the stats writes: an archive failure must never break an import or run.

### Explicitly out of scope for archiving

- **SF_VIN_LOGS — never archive.** It is the CAO dedup source of truth ("have we ever printed this VIN"), grows slowly (3 narrow columns per dealer tab), and has decades of headroom in its own document.
- **SCRAPERDATA** — a snapshot, self-limiting.

### Structural endgame

V3's PostgreSQL migration eliminates this problem class entirely — IMPORT_STATS and ORDER_STATS were deliberately designed as flat, formula-free tables so they port 1:1 to `import_stats` / `order_stats` database tables.

---

## Known Issues & Pending Work

### Active Issues
- **Trim cleanup (analyzed; deferred):** Trim strings overflow the print template and need manual editing. Full analysis + a validated auto-cleanup design (global `cleanTrim_` regex pass behind a feature flag + dry-run, plus residual exact-match rules) is captured in **Trim Normalization & Cleanup — Analysis & Deferred Design** above. Decision on approach (A full / B phased / C exact-only) pending.
- **Stock→VIN fallback (planned):** No dealer uses `use_stock_not_vin` — VIN is always the primary key. Desired behavior: if an ordered identifier isn't found in the SCRAPERDATA VIN column, check the Stock column and substitute the matching row's VIN. Not yet implemented.
- **`model_trim_split` config key inert:** present in Glendale's `data_transforms` but ignored by `applyDataTransforms_`. Implement or remove.
- **Stale dealer notes:** Hyundai of Jefferson City and Nissan of Jefferson City notes still say "Scraper #N/A — inactive" but both dealers are active with live scraper feeds. Notes-column cleanup.
- **MBCC/Sprinter shared inventory — resolved (v2.9/v2.10, June 12 2026):** Option B (one run, two billing outputs) deployed and configured. MBCC's `filtering_rules` carries the `billing_split` key (`field: "model", op: "contains", values: ["Sprinter", "Metris"]`); split runs produce BILLING + BILLING_SPRINTER and two finalization cards with independent deal IDs. Live-test verification per the v2.9/v2.10 changelog entries is the remaining step.
- **Auffenberg Hybrid order:** Run Dealer modal doesn't support two-stream (CAO + manual) orders or type override on manual stream. Needs modal additions when Maintenance/Hybrid order types are implemented.
- **Maintenance and Hybrid order types:** Designed and documented but not yet in the Run Dealer modal.
- **`scraper_location_name` mismatches — audited June 18, 2026 (all 29 active dealers); BMW resolved.** **BMW of West St. Louis was the only genuine drift.** The scraper feed renamed the location to "BMW of West St. Louis" (with a period), but DEALERS col J still held "BMW of West St Louis" (no period) — an exact-match miss that made `getDealerScraperData_` pull **zero** inventory for BMW (CAO and runs broken) and threw a false import-health "missing location" warning. **Fixed by setting J6 to "BMW of West St. Louis"** (live sheet edit, not a code change). **Serra Honda O'Fallon and CDJR of Columbia are NOT drift** — their config values match the feed (CDJR's is the legacy "Joe Machens Chrysler Dodge Jeep Ram", which the system reads correctly). 12 dealers were "unconfirmed" only because they weren't in the latest import. *(The health "missing location" check was hardened the same day so a future feed-name rename ages out after one import instead of false-flagging forever — see the [Unreleased] CHANGELOG.)*

### Housekeeping
- Fix `#ERROR!` cells in README tabs of SF_SYSTEM_MASTER and SF_DEALER_CONFIG (cosmetic)
- Delete `VINLogMigration.gs` and `FolderSetup.gs` from Apps Script
- Fix legacy field names in `_CONFIG_CACHE` row 1 (cosmetic)
- ~~Resolve remaining `scraper_location_name` mismatches for BMW of West St. Louis and Serra Honda O'Fallon~~ — done (June 18, 2026 audit): BMW corrected; Serra Honda O'Fallon confirmed not drift (see Active Issues)
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
