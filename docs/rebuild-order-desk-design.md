# Design note — SilverFox App client rebuild ("Order Desk")

Branch `exp/ui-playground`, EXPERIMENTAL environment. 2026-09-25. One page.
Server (Code.gs) is fixed; the rebuild is the client on top of the existing
`google.script.run` surface (inventory: session log 2026-09-25 in the brain).

## Problem

The order is the crew's unit of work, but the app is organized by screen. One
order touches five: Home (schedule), VIN Inbox (lot-scan batch), Run Order
(VINs, match, run, finalize), the Drive folder (files), VIN Logs (commit). The
pre-flight "is the log caught up?" check sends the operator to Pipedrive by
hand. Recorded friction clusters exactly there: work lost on dealer switch
(drafts were the patch), the finalize box pushed off-screen, pasted VINs
silently vanishing to filters, three sequential confirm dialogs before a run.
The current shell is a generic sidebar-of-screens; the surface styling done
earlier on this branch didn't change any of that.

## Options

**A. Order Desk (recommended).** Three regions: a *work queue* rail (today's
orders, assembled from schedule + inbox batches + drafts + uncommitted runs),
an *order workspace* (one stepped flow per dealer: Source → Review → Run →
Finalize → Files & commit, with pre-flight as an inline checklist instead of
dialogs, and the lot-scan batch folded into Source), and a *dealer inspector*
(inventory, log status, recent runs with commit/rollback, stack cleanup).
Import is a morning task off the freshness chip. Config screens live in a
settings drawer. Trade-off: VIN Inbox and per-dealer VIN Logs stop being
screens; the nav-layout preference (sidebar / rails / start menu) has no
meaning in a single fixed workbench.

**B. Mission control.** The July "ops console" idea: dashboard as a live
wall, dense instrumentation, monospace readouts, screens as stations. Strong
on situational awareness, weak on the actual problem — the flow still spans
stations. Best as a *mode* of A's queue rail later, not a foundation.

**C. Spatial desktop.** The July "canvas workspace" idea: views as windows,
several visible at once, taskbar-driven (Luna's end state). Solves
"inbox beside the order" by window juggling inside a 1400×900 modal; the crew
works one order at a time, so it trades a fixed flow for window management.

## Decision

**A.** It is the only option that removes screen-hopping from the daily job.
Scope split by value: **phase 1** rebuilds the daily/weekly surfaces (shell,
queue, order workspace, inspector, import, logs, stack cleanup, month end);
the eight setup/config views are *hosted unchanged* inside the new shell in
phase 1 (rare tasks, ~7k lines, Nick-only) and restyled in **phase 2**.

Compatibility contract the new shell keeps so hosted views and reused logic
work: SharedUtils globals (`escHtml`, `toast`, `appConfirm`, `AppGuards`,
`AppBusy`, `AppData`, `Theme`, `UiPrefs`, `CustomSelect`, `VIEW_INITS` /
`VIEW_SHOWN` / `VIEW_LEFT`), `navTo(viewId)` over `#appContent .view[hidden]`,
the existing view ids, the boot sequence, and the `<?= ?>` scriptlets.

## Debt this incurs (register in the vault)

- Config views hosted as-is: visual mismatch until phase 2; their id-scoped
  CSS dialects and wildcard resets remain (no `@layer` migration).
- Nav-layout pref becomes inert (UI Settings loses its one option).
- `Classic.html` standalone fallback is not maintained for the new views.
- The screenshot harness scenarios (`harness.js`) drive the old DOM ids; new
  scenarios are part of each increment's definition of done.
- Queue assembly is four round-trips; a single `getWorkQueue()` server call
  is a phase-2 Code.gs candidate, not a phase-1 dependency.

## Out of scope

Code.gs changes; Order Types (Maintenance/Hybrid) — the Source step reserves
the slot; Trim cleanup; URL liveness; Lot Scanner; the eom-viewer sub-app.

## Progress (2026-09-25)

| # | Increment | State | Commit |
|---|---|---|---|
| 1 | Shell | done, on EXP | 1877cf7 |
| 2+3 | Order workspace (kept in `ViewRun.html` / view id `view-run`, not a new `ViewOrder` file — every jump into it keeps working) | done, on EXP | bd426be |
| 4 | Work queue: + inbox batches, + uncommitted runs | done, on EXP | 1a17c41 |
| 5 | Inspector (`ViewInspector.html`) | done, on EXP | 32a5234 |
| 6 | Lot-scan source strip in step 1 (photo correction stays in the inbox) | done, on EXP | 3159829 |
| 7 | Import task | done, on EXP | 4bf255e |
| 8 | Periodic: VIN inbox + VIN logs (cf29f6a); stack cleanup + month end + utilities (fc1dd3f) | done, on EXP | |
| 9 | Harness: `order-inspector` added; 41/41 pass on the new DOM | done | |
| 10 | Phase 2 | not started | |

## Increments (critical path first)

1. **Shell** — `App.html` rewrite: top bar (wordmark + env, import freshness,
   operator, busy, settings, theme), queue rail, workspace, inspector,
   settings drawer. Hosts every existing view unchanged. DoD: harness builds,
   all 40 existing scenarios render, zero console errors.
2. **Order workspace: Source + Review** — `ViewOrder.html` replaces ViewRun's
   top half: stepped layout, VIN box, CAO summary, match table, features,
   dupes/flags. DoD: `run-vins` scenario equivalent renders from the mock.
3. **Order workspace: Run + Finalize + Commit** — inline pre-flight
   checklist, progress, finalize cards, files, Add to VIN log.
4. **Work queue** — assembled from `getPrintSchedule`, `getVinSubmissions`,
   `getMyRunDrafts`, `getRunsForDealer('')`; click → workspace(dealer).
5. **Inspector** — `getDealerSummary`, `getLatestOrderId`,
   `getRunsForDealer(key)` with commit / rollback / delete actions.
6. **Source: lot scan** — batch photos + VIN correction inline.
7. **Import task** — rebuilt UI over the existing two-phase logic.
8. **Periodic** — all-dealer log, stack cleanup, month end in the new shell.
9. **Harness scenarios** for the new DOM (grows with 1–8).
10. **Phase 2** — config views restyled; nav-pref removal; `getWorkQueue()`.

Critical path: 1 → 2 → 3. 4, 5, 7 parallelize after 1.
