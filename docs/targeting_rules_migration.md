# Targeting Rules Migration — `conditions` → `targeting_rules`

> **✅ DONE — completed live June 17, 2026.** All 4 dealers migrated and verified
> (0 stale `conditions` keys sheet-wide; 25 behavioral-equivalence checks against the
> deployed engine; UI round-trip confirmed). Code merged to `main`; rollback tag for
> this state is **`stable-post-targeting-rules`**. This file is retained as the
> before/after record and rollback reference.

**Original plan: apply during the Data Sources v2 deploy window, on the cloned copies first, then live.**
Pre-deploy rollback tag was `stable-post-frankleta`.

The filtering engine no longer reads the legacy `conditions` key or the `drop_on_import`
**operator**. Targeting is now an array of **IF (nested AND/OR conditions) THEN action**
rules under `targeting_rules` (col W). Only the **4 dealers that had a `conditions` key**
need their col W rewritten. Every other key (`cao_exclude_types`, `allowed_types`,
`exclude_status`, `require_*`, `source_split`, `seasoning`, …) is **unchanged** — in
particular the "Exclude from CAO" behavior still rides on the untouched
`cao_exclude_types` pills.

**Polarity:** old `conditions` were *inclusion* ("keep only if it matches"); the new
rules are *exclusion-on-match*. Each condition is inverted (`not_contains`→`contains`,
`gte`→`lt`, `gte`(price floor)→`lt`, etc.) and `applies_to` becomes a `{type, in, […]}`
condition AND'd into the group. Missing/garbage numbers stay **kept** in both engines
(old fail-open-keep ≡ new no-match-keep), so behavior is identical including edge cases.

Mazda of Columbia has only `cao_exclude_types` (no `conditions`) → **not migrated**.

---

## PUNDMANN_FORD (DEALERS row 29)

**Before:**
```json
{"require_stock":true,"require_price":false,"exclude_status":["OFFLOT"],"conditions":[{"field":"model","op":"not_contains","values":["F-250","F250","E-Transit","Chassis Cab","Transit","Cutaway","Commercial","Super Duty","F-350","F-450","F-550","F-650","F-750"],"applies_to":["New","PO","CPO","CPO-EL"]},{"field":"year","op":"gte","values":[2022],"applies_to":["PO","CPO","CPO-EL"]},{"field":"trim","op":"not_contains","values":["F-250","F250","E-Transit","Chassis Cab","Transit","Cutaway","Commercial","Super Duty","F-350","F-450","F-550","F-650","F-750"],"applies_to":["New","PO","CPO","CPO-EL"]},{"field":"price","op":"gte","values":[35000],"applies_to":["PO","CPO","CPO-EL"]}],"cao_exclude_types":["New"]}
```

**After:**
```json
{"require_stock":true,"require_price":false,"exclude_status":["OFFLOT"],"cao_exclude_types":["New"],"targeting_rules":[{"action":"exclude_order","group":{"match":"any","children":[{"field":"model","op":"contains","values":["F-250","F250","E-Transit","Chassis Cab","Transit","Cutaway","Commercial","Super Duty","F-350","F-450","F-550","F-650","F-750"]},{"field":"trim","op":"contains","values":["F-250","F250","E-Transit","Chassis Cab","Transit","Cutaway","Commercial","Super Duty","F-350","F-450","F-550","F-650","F-750"]}]}},{"action":"exclude_order","group":{"match":"all","children":[{"field":"type","op":"in","values":["PO","CPO","CPO-EL"]},{"field":"year","op":"lt","values":[2022]}]}},{"action":"exclude_order","group":{"match":"all","children":[{"field":"type","op":"in","values":["PO","CPO","CPO-EL"]},{"field":"price","op":"lt","values":[35000]}]}}]}
```

Truck model/trim filter (all types) merged into one `any` rule; used-car year<2022 and
price<$35k each become an `all` rule. `cao_exclude_types:["New"]` stays as the pill.

---

## BOMMARITO_CADILLAC (DEALERS row 7)

**Before:**
```json
{"require_stock":true,"require_price":false,"allowed_types":["New","PO","CPO"],"exclude_status":["OFFLOT"],"conditions":[{"field":"price","op":"gte","values":[35000],"applies_to":["PO","CPO"]}],"cao_exclude_types":["New"]}
```

**After:**
```json
{"require_stock":true,"require_price":false,"allowed_types":["New","PO","CPO"],"exclude_status":["OFFLOT"],"cao_exclude_types":["New"],"targeting_rules":[{"action":"exclude_order","group":{"match":"all","children":[{"field":"type","op":"in","values":["PO","CPO"]},{"field":"price","op":"lt","values":[35000]}]}}]}
```

---

## DAVE_SINCLAIR_ST_PETERS (DEALERS row 11)

**Before:**
```json
{"require_stock":true,"require_price":false,"exclude_status":["OFFLOT"],"conditions":[{"field":"price","op":"gte","values":[35000],"applies_to":["PO","CPO"]}],"cao_exclude_types":["New"]}
```

**After:**
```json
{"require_stock":true,"require_price":false,"exclude_status":["OFFLOT"],"cao_exclude_types":["New"],"targeting_rules":[{"action":"exclude_order","group":{"match":"all","children":[{"field":"type","op":"in","values":["PO","CPO"]},{"field":"price","op":"lt","values":[35000]}]}}]}
```

---

## FRANK_LETA_HONDA (DEALERS row 12)

**Before:**
```json
{"require_stock":true,"require_price":false,"require_url":true,"allowed_types":["PO","CPO"],"exclude_status":["OFFLOT"],"conditions":[{"field":"subprime","op":"drop_on_import","values":["Subprime"],"applies_to":["PO","CPO","CPO-EL"]}],"cao_exclude_types":["New"],"source_split":{"group_name":"AUTOLOANPRO","url_contains":"autoloanpro"}}
```

**After:**
```json
{"require_stock":true,"require_price":false,"require_url":true,"allowed_types":["PO","CPO"],"exclude_status":["OFFLOT"],"cao_exclude_types":["New"],"source_split":{"group_name":"AUTOLOANPRO","url_contains":"autoloanpro"},"targeting_rules":[{"action":"drop_on_import","group":{"match":"all","children":[{"field":"subprime","op":"contains","values":["Subprime"]}]}}]}
```

The `drop_on_import` **operator** becomes a `drop_on_import` **action**. The old import
drop ignored `applies_to`, so the converted rule has no type condition — exact same
behavior. `require_url` + `source_split` are untouched.

---

## Apply steps (in the window)

1. Record the **Before** value of col W for each of the 4 rows (Version history of
   SF_DEALER_CONFIG also covers this).
2. After `clasp push -f` of the new code, paste each **After** JSON into DEALERS col W
   for the matching row.
3. Verify per dealer on the cloned copy (CAO pre-fill + a manual run) — see the plan's
   Verification section. The "Exclude from CAO" pills (`cao_exclude_types`) must still
   behave identically.
4. Rollback: `git checkout stable-post-frankleta` → `clasp push -f`, then restore each
   recorded **Before** value into col W.
