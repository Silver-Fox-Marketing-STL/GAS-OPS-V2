# Run Order redesign — live VIN data table + retire Transcription

**Date:** 2026-06-26
**Branch:** `feature/run-order-vin-table`
**Status:** Design approved; ready for implementation plan.

## Context

The Run Order screen (`ViewRun.html`) is a two-column layout: a left **form column** (controls + the run-flow content — CAO summary, progress bar, finalization cards) and a right column that is just a large, mostly-empty VIN textarea. That right-hand space is badly underused.

Separately, the **Transcription** screen lets a user paste VINs and see Found / Not-Found against inventory — a check that logically belongs exactly where orders are built. The two are already coupled: Run Order's **"Fill from Transcription"** button copies VINs out of the Transcription view's textarea.

This redesign reclaims the unused space with a **live, dealer-scoped inventory table** beside the VIN box (Year · Make · Model · Type · Stock · VIN · Status, updating as you type), and **retires the now-redundant Transcription page**.

**Hard constraint (first-class):** the rework must reskin cleanly under **all 8 themes** (light, dark, dark-dense, top-rail, top-rail-dark, midnight, cyberpunk, encarta) with zero breakage. The theming system's purpose is that UI elements can be moved/restyled without breaking — this redesign must honor that.

## Goals

- Use the unused horizontal space on Run Order for a **live data table** of the cars whose VINs are in the box.
- As VINs are typed/pasted, show key datapoints per VIN from the **selected dealer's** inventory; clearly flag misses ("not in this dealer").
- **Retire the Transcription page** (subsumed by the table).
- **Zero theming breakage** across all 8 themes.
- No change to the run / CAO / finalize / commit / Pipedrive logic — this is **layout rearrangement + an additive lookup**, nothing more.

## Non-goals

- No change to the run pipeline, finalization, billing, Pipedrive, or VIN-log logic.
- No table columns beyond the seven listed.
- Do **not** remove the TRANSCRIPTION *sheet tab* in SF_SYSTEM_MASTER (it's separate; only the *view* is retired).
- No cross-dealer lookup (dealer-scoped only — chosen for relevance, safety, and a small payload).

## Layout (Option B — approved)

A thin **top control bar** spanning the width, then a 3-zone body filling the remaining height.

**Top bar** (one row): Running as · Dealer · a small "log: #<latest order>" note · Deal ID · (the split Deal ID field, shown only for `billing_split` dealers) · "Bypass filters" checkbox · **Pre-fill from CAO** button · **Run Dealer** button.

**Body, left → right:**
1. **VIN box** — the existing `#vinInput` textarea narrowed to ~250px (VINs/stock numbers are fixed-width), with the live count strip below it ("N VINs · X found · Y not found").
2. **Data table** — the centerpiece, fills the middle: columns **Year · Make · Model · Type · Stock · VIN · Status**. Type renders as the existing colored `.pill`/`.type-*` chip; a miss renders as a single red row ("⚠ not in this dealer"); the table uses `tabular-nums` + token borders like the existing dash/runs tables.
3. **Right rail** — a **reserved**, fixed-width column (so the table never reflows). Its content cycles with the run lifecycle: **idle hint → CAO report → progress bar (during run) → finalization cards + "Add to VIN Log" (after run)**. This is where the existing run-flow elements (`#caoSummary`, `#progressSection`, `#postRunActions`, `#runStatus`) move to from the left column.

**Reserved vs slide-in:** the rail is reserved/always-present (approved) so the table layout is stable.

## Live VIN table — data flow

1. **On dealer select** (existing `#runDealerSelect` change handler, extended): call a new server function `getDealerVinData(dealerKey)` once. It returns the selected dealer's inventory as a map `{ "<VIN-UPPER-TRIM>": { year, make, model, type, stock, status } }`. Cache it client-side for that dealer (re-fetched on dealer change). This mirrors how Transcription loads its index once, then checks client-side.
2. **As VINs change** (debounced ~250ms `input` listener on `#vinInput`): split into non-empty trimmed lines, look each up in the cached map (instant, client-side), and render the table in the **same order** as the box. Found → the 6 data columns; miss → the red not-found row. Update the count strip.
3. No dealer selected yet → the table shows an idle hint ("Select a dealer to check VINs").

## Transcription removal

Remove, in one pass:
- `ViewTranscription.html` (the view fragment) + its `include_()` in `App.html`.
- The Transcription **nav item** in `App.html` (and any `NAV_TITLES` / `navTo` keep-open / `markPendingViews` references).
- The **"Fill from Transcription"** button (`#fillTrBtn`) + `fillFromTranscription()` in `ViewRun.html`.
- `getTranscriptionVins()` in `Code.gs` (superseded by `getDealerVinData`), plus `getAppBootstrap`/`VIEW_INITS`/`VIEW_SHOWN` references to the transcription view.

Keep: the **TRANSCRIPTION sheet tab** (unrelated to the view).

## Theming compatibility (first-class requirement)

The new markup must be a good theming citizen so all 8 themes reskin it for free / via their existing structural rules:

- **Tokens only.** Every color, border, radius, shadow, spacing, and font in the new markup uses `var(--…)` — no hardcoded hex/px (the mockup's literal colors were mockup-only). This is what lets the token-driven themes (dark, midnight, dark-dense, etc.) reskin automatically.
- **Reuse already-themed primitives.** Type chip → existing `.pill` + `.type-*` (already themed *and* covered by Encarta's bevel overrides). Dropdowns stay native `<select>` so the CustomSelect enhancer themes them everywhere. Actions are real `<button>`s (Encarta auto-bevels). The run-flow elements keep their existing classes/ids (so they keep their existing theming) — they just move location.
- **New elements get explicit theme coverage.** The top bar, the data table, and the right rail are new classes; where a theme does more than recolor, add coverage:
  - **Encarta** (`App.html` `:root[data-theme="encarta"]` `!important` block): square + bevel the new table (sunken/raised header band), the rail, and the top bar; ensure buttons/pills already covered.
  - **top-rail / top-rail-dark / dark-dense / cyberpunk**: these restructure the *shell* (nav/header), not the view body — verify the new view still fills `#appContent` correctly under each (it should, being self-contained), and that the cyberpunk scanline overlay / borders don't clash.
- **Responsive frame.** The view keeps a `data-layout` tier + `.app-measure` so the wide-screen measure caps still apply to the new structure.
- **Verification is an explicit 8-theme sweep** (see Verification).

## Backend

`getDealerVinData(dealerKey)` (new, `Code.gs`):
- Resolve the dealer's `scraper_location_name` via `getDealerConfig_(dealerKey)`.
- Read the dealer's rows via the existing `getDealerScraperData_(locationName)`.
- Project each row to `{ year, make, model, type, stock, status }` using the SCRAPERDATA indices (VIN=0, Stock=1, Type=2, Year=3, Make=4, Model=5, Status=8); key the map by `String(VIN).trim().toUpperCase()`.
- **Fail-safe:** return `{}` (empty map) on any error or missing data — the table then shows everything as "not found" rather than throwing.
- No other backend change. The run/CAO/finalize/commit functions are untouched.

## Component boundaries / blast radius

- **Primarily a markup rearrangement + an additive table.** The existing controls and run-flow elements **keep their element ids** (`#userSelect`, `#runDealerSelect`, `#dealId`, `#splitDealRow`, `#bypassFilters`, `#caoBtn`, `#runBtn`, `#caoSummary`, `#progressSection`, `#postRunActions`, `#runStatus`, `#vinInput`, …), so the existing Run/CAO/finalize/commit JS that references them by id is **unaffected** — only their position in the DOM changes.
- **New, isolated pieces:** (a) the table markup + its render function; (b) the debounced `#vinInput` listener + the dealer-data cache; (c) the `getDealerVinData` backend fn; (d) the theme-coverage CSS. Each can be reasoned about independently.

## Error handling

- `getDealerVinData` fail-safe → `{}`; client treats unknown VINs as not-found (no crash).
- Debounce protects against per-keystroke churn.
- No dealer selected → idle hint, no lookup.
- CustomSelect already graceful-degrades, so the enhanced top-bar selects can't break the run.

## Verification

- **Behavior:** dealer-scoped lookup correctness; debounce; not-found rendering; count strip; row order matches the box; switching dealers refreshes the cache. The existing Run / CAO pre-fill / finalize / Add-to-VIN-Log flows still work end to end (selects are CustomSelect-enhanced).
- **Theme sweep (the constraint):** the new Run Order screen under **all 8 themes** — light, dark, dark-dense, top-rail, top-rail-dark, midnight, cyberpunk, encarta — in each run state (idle, after CAO pre-fill, during run, after run). Confirm tokens resolve, Encarta bevels the table/rail/bar, structural themes don't clip or misplace the view.
- **Gates:** `node --check` (extracted scripts), `<div>`/`</div>` balance, no cross-fragment `function` name collisions, no orphaned references to removed Transcription symbols.

## Open items (non-blocking)

- Exact top-bar packing of the secondary controls (VIN-log note, split Deal ID, Update-VIN-Log button) — a layout detail to settle during implementation; all keep their ids.
- Whether the count strip lives under the VIN box or in the top bar (default: under the VIN box).
