# Handoff — 2026-09-25 — Order Desk rebuild + separate-frontend spike

Read this first when resuming. Everything below was true at the end of the
2026-09-25 session. The brain (vault) has the long form; this is the map.

## Where things are

| Thing | State |
|---|---|
| PROD | untouched all day: `main` tip `8cc179f` was the last promote (2026-09-23). |
| `main` | `f5ebcc4` = EXPERIMENTAL environment scaffold merged (no-ff). **Not pushed to origin** (`origin/main` = `c619e19`). |
| `exp/ui-playground` | **16 commits ahead of `main`**, tip `a1470f7`. No upstream. Not merged, not promoted. |
| EXPERIMENTAL env | third Apps Script project `EXP_SFOX OPS V2` (scriptId `1P8oMEhR0xpljFLCGnzEJQRGSs38aju2VUiUy0HIj3imB-Hopt26hD3Ha`), bound to DEV_SF_SYSTEM_MASTER, `ENV_IDS` name `exp`. `/exec` deployment `AKfycbzE7vg5xz-75kxmhskxidN58anS8nHM_Nvc5vuHKew5q8IBeRwJP607nag63tEdTtsf` at **version 10** = commit `ad93c27` (+ harness-only commits after it). Push path: `scripts/push-exp.ps1` from any non-main branch (uses `clasp -P .clasp.exp.json`). |
| Untracked in repo (pre-existing, not mine) | `AGENTS.md`, `docs/system-audit-handoff-2026-07-23.md`. |
| Vault | dirty, uncommitted (Nick commits the vault himself). New notes today: `decision-client-rebuild-order-desk.md`, `standards.md`, `debt-register.md`, session log `2026-09-25_job-ticket-ui-experiment.md`. |

## What was built today (all on `exp/ui-playground`)

1. **Job-ticket visual direction** (tokens: white stock, black ink, `--rule`, Barlow / Barlow Condensed / IBM Plex Mono, radius 0, no shadows) — `SharedUtils.html`.
2. **EXPERIMENTAL environment** (see table) — `Code.gs` Section 1 entry, `.clasp.exp.json`, `scripts/push-exp.ps1`, runbook section in `docs/dev-environment.md`.
3. **Order Desk client rebuild, phase 1 complete** per `docs/rebuild-order-desk-design.md`:
   - `App.html` shell: top bar (import chip, Settings drawer, theme, Close), work-queue rail (schedule + drafts + inbox batches + uncommitted runs, printed dealers folded), Tasks index, workspace, inspector column with header toggle, phone bottom bar.
   - `ViewRun.html` = the order workspace (view id `view-run` kept): stepper pick → Vehicles → Run → Finalize driven by `roApplyStage_()`; inline pre-flight checklist (`roUpdateChecks()`) replaced the three confirm dialogs; "Run anyway" while a warning stands; lot-scan strip (`roLoadScan_`); finalize/Pipedrive/draft/table JS unchanged (element ids are the contract).
   - `ViewInspector.html` (new): `window.Inspector.show/hide/refresh`; sections are `<details>`, VIN log open by default.
   - `ViewImport`, `ViewVinInbox`, `ViewVinLog`, `ViewStackCleanup`, `ViewEndOfMonth`, `ViewUtilities`, `ViewHome` rebuilt in the idiom around unchanged JS (strings + emitted markup only). Home lost the Dealer focus column.
   - Rule: the shell header owns each view title (sentence case); views show only a hint + actions.
   - The eight config views are hosted **unchanged** (phase 2).
4. **Progressive-disclosure pass** after Nick's review ("too much on screen at once") — commit `ad93c27`. Nick's rule is now a standing principle (memory + `standards.md`).
5. **Spike design note** `docs/spike-separate-frontend.md` — a desktop frontend on GitHub Pages over an Apps Script JSON API with Google sign-in token checks. **Nick chose the spike; the note awaits his approval before any Code.gs change.** Scanner PWA is shelved; current scanner stays.

## Verification state

- Screenshot harness (`.claude/skills/ui-screenshot-repro/full-app/`): `node build-app.js && node shoot.js --themes light --width 1440 --height 900 --out shots` → 41/41 clean on the new DOM (dark spot-checked). Fixtures now compute "today" for the import date. `home` / `home-bottom` scenarios retargeted after Dealer focus was removed.
- `node test/run-tests.js` → 137/137 throughout.
- Not yet done: a live run on EXP against DEV data (CAO → run → finalize → commit). The harness proves rendering, not the Apps Script round trips.

## Pending for Nick

1. Click through EXP with real DEV data: CAO order end to end, a lot-scan order from the queue, the checklist warnings, inspector commit / roll back. Decide whether the inspector should keep Inventory open too.
2. Confirm the phase split (config views hosted unchanged → phase 2 restyle).
3. Approve or amend `docs/spike-separate-frontend.md`. If approved, his prerequisites: an OAuth client id (Google Cloud console, free), EXP script properties `API_OAUTH_CLIENT_ID` + `API_ALLOWLIST`, re-authorize the EXP deployment after the manifest change.
4. Push `main` and `exp/ui-playground` to origin; commit the vault.
5. Carried over from before today: PROD `backfillVinLogOrderDates()` run; Lot Scanner `promote-lot-scan.ps1`; EXP dummy secrets (`PD_API_TOKEN=FAKE`, `PD_COMPANY_DOMAIN=fake-dev`) if not yet set.

## Next work, in order (if the spike is approved)

Increments in `docs/spike-separate-frontend.md` §Increments, on a new branch
`spike/desk-api` off `exp/ui-playground`: manifest + `apiEnabled` + promote
Gate 1.6 → router + token check + function map + identity context → `desk/`
Vite shell → one order flow → Pages workflow + live proof.

If the spike is NOT approved: phase 2 of the rebuild (restyle the eight config
views; remove or repurpose the inert nav-layout options in UI settings; retarget
the `run-confirm-dialog` harness scenario) — all listed in the vault
`debt-register.md`.

## Gotchas that bit today (don't repeat)

- Every `.html` and the harness's `harness.js` are **CRLF**. Exact-string patches must normalize line endings; a Node `includes()` precheck says "not found" otherwise.
- Long inline bash heredocs with mixed quotes fail to parse outright — write patch scripts to a scratch file and run them.
- `clasp create --type sheets --parentId X` ignores the parent and makes a NEW blank spreadsheet; use `--parentId X` with no `--type`.
- CustomSelect is three layers (native `<select>`, `.cs-field`, `.cs-btn`); size all of them.
- A background agent must never `git checkout -- <file>` while the main session may be editing it.
- `push-exp.ps1` refuses an uncommitted tracked tree — commit first.

## Key files

`docs/rebuild-order-desk-design.md` (design + progress table) · `docs/spike-separate-frontend.md` · `docs/dev-environment.md` (EXPERIMENTAL section) · `CHANGELOG.md` [Unreleased] · `.claude/rules/spa-htmlservice.md` · brain: `01-Projects/gas-ops-v2/{decision-client-rebuild-order-desk, standards, debt-register}.md`.
