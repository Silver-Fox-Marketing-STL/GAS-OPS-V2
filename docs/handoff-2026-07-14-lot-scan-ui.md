# Handoff — Lot Scanner UI rework (2026-07-14)

For a later Claude Code session continuing the `feat/lot-scan-ui` branch. Read
CLAUDE.md first (auto-loaded); this doc covers only what the repo and vault
don't already record. Transient — delete once the branch is merged.

## Where things stand

- **Branch `feat/lot-scan-ui` — complete and statically verified, NOT merged,
  NOT clasp-pushed anywhere.** One code commit (`8a0dca8`) + this doc, branched
  off `main` (`582908a`). The **dev scanner does NOT have this code yet** —
  nothing has been deployed.
- ⚠️ **Shared-checkout hazard:** the main repo checkout may be sitting on
  `feat/billing-pdf-layout` (a parallel session's branch — its work is separate
  and intact; the two branches never mixed). Before touching files, either
  `git checkout feat/lot-scan-ui` (only if no other session is active) or use a
  `git worktree` — a checkout in one session moves the ground under any other.
- Verification: test-verifier agent passed 7/7 static checks (JS/GAS syntax,
  id/class/token resolution against lot-scan's OWN files, `google.script.run`
  name audit, hidden-attr/grid interplay). **Runtime smoke is pending** — see
  Nick's steps below.

## What the change is

Four features, all in `lot-scan/Capture.html` + two functions in
`lot-scan/Code.gs` (`lot-scan/SharedUtils.html` deliberately untouched):

1. **Themes** — saved pref injected pre-paint via template scriptlet
   (`<html data-theme="<?= getThemePreference() ?>">`), OS light/dark fallback
   for fresh users, header picker driven by the `Theme` registry that already
   existed in lot-scan's SharedUtils copy. New `getThemePreference` /
   `saveThemePreference` in Code.gs (UserProperties key `lot_theme`) — the save
   name is load-bearing: `Theme.apply` calls it via `google.script.run`, which
   fails silently on missing names. All 10 themes, **palettes only** (structural
   axes write attributes with no matching CSS here — intended no-ops).
2. **Responsive two-column** — `≥760px`: tabs hidden, Capture + Drafts side by
   side in a 1100px `.ls-cols` grid. JS owns the `hidden` attributes
   (`vpSyncLayout` + `matchMedia('(min-width: 760px)')` listener); CSS never
   fights `[hidden]`. Phone keeps the tabbed 560px column.
3. **Session stats card** — Photos / Saved / Failed tiles (Failed tints danger
   only when >0), "N in progress…" busy line, dealer + short batch id. Driven by
   the rewritten `vpUpdateCount()`; `#lsCount` is gone.
4. **Idle unsent drafts** — phone-only list (wide mode hides it via CSS; the
   visible Drafts panel covers it) with Resume/Send per batch. Renders from the
   SAME `getMyDrafts` fetch as the Drafts pane (`vpLoadDrafts` success handler
   renders both) via the shared `vpGroupDrafts` helper; also populates
   `vpDraftMeta` (Resume depends on it). Only system batch ids go into inline
   `onclick` — never dealer names (apostrophe trap).

CHANGELOG `[Unreleased]` has the full entry. The approved design/plan (this
machine only): `C:\Users\Nick_Workstation\.claude\plans\i-want-to-adjust-curious-cosmos.md`.

## Decisions made with Nick — don't re-litigate

- Layout: responsive 2-col chosen over "enriched single column" and "dashboard
  home" (both presented, declined).
- **No VIN-read stats** in the session card — OCR is office-side now, the count
  would always be 0 (Nick's explicit call).
- Live VIN-match feedback on queue thumbnails and a dealer info card were
  offered and **declined** — don't add them unbidden.
- Full 10-theme list, palettes only, zero curation (Nick chose over a curated
  short list and auto-OS-only).

## Known accepted limitations / latent items

- `top-rail` theme = Light palette here (no own token block) — duplicate look
  in the picker; accepted under "full list, zero curation".
- Encarta/Luna fonts (e.g. Pixelify Sans) load in the main App.html only — the
  scanner falls back to the standard stack; palette still applies. Accepted.
- Latent (pre-existing, NOT this branch): lot-scan's divergent SharedUtils
  carries dormant `google.script.run.getAppBootstrap()` / `.saveUiPref()` calls
  with no matching Code.gs functions — silent-fail if a future view wires them.
  Worth a vault `open-issues` note.

## Nick's remaining steps (in order)

1. Get the checkout onto `feat/lot-scan-ui` (mind the hazard note above).
2. `clasp push` from `lot-scan/` (targets the DEV scanner per `.clasp.json`),
   open the dev `/dev` URL.
3. Smoke checklist:
   - **Phone width:** tabs toggle; idle shows unsent drafts when one exists
     (Resume and Send both work); stat tiles tick up live during a shoot;
     Failed tile tints red (kill network to force it).
   - **Desktop width:** tabs gone, two columns; Finish & Send refreshes and
     opens the batch in the right panel; resize across 760px re-syncs.
   - **Themes:** spot-check Dark, Midnight, Encarta; reload persists the pick;
     dealer `<select>` popup renders dark in dark themes; a no-pref user gets
     OS light/dark.
   - **Regression:** full shoot → Finish & Send → batch reaches the office VIN
     Inbox; failed-photo confirm guard still fires.
4. Merge: `git checkout main && git pull && git merge --no-ff feat/lot-scan-ui
   && git push` (house style: no-ff).
5. Promote: `.\scripts\promote-lot-scan.ps1` (Nick-run only). Delete this doc.

## Suggested skills / agents

- `frontend-specialist` agent for any follow-up UI tweaks from the dev smoke.
- `verify` before committing anything nontrivial on top of this branch.
- `code-review` if Nick wants a pre-merge pass.
