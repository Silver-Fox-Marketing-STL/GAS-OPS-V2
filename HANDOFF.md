# HANDOFF — Crew Handbooks (job aids) — branch `docs/crew-handbooks`, awaiting Nick's review

Written 2026-07-21 end of session (work PC). Previous handoff (Lot Scanner order-flow
rework) was fully resolved 2026-07-09 and is in git history if ever needed.

## Where things stand

Branch **`docs/crew-handbooks`** (off main @ faa62d5), **one commit `38a58fb`**,
pushed to origin. **NOT merged to main** — merge is gated on Nick's text review.
Docs-only change: no code, no clasp, no deploy involved.

What it contains — the first-ever end-user documentation for the system, in
`docs/crew/` (plus a CHANGELOG entry in the same commit):

- `README.md` — maintenance contract: crew-visible flow changes update the matching
  recipe in the same PR; published to Drive for the crew (they never see the repo).
- `field-crew-handbook.md` — Lot Scanner phone app: first-time setup, scan a lot,
  fix/resend a draft. Calls out the data-loss trap (in-app photos aren't in the
  camera roll — "finish WITHOUT them?" destroys failed shots).
- `office-operator-handbook.md` — the big one: start-your-day (Today's Print
  Schedule), the FOUR order-origination paths (CAO-only / VIN Inbox / inbox+CAO
  combined / manual paste) feeding one common run flow, finalize decision box,
  output files, VIN log commit/rollback, drafts, troubleshooting table.
- `import-handbook.md` — Replace vs Merge, per-file column matching, conflict
  panel, health check (🔴 = stop and tell Nick before running orders).

Every quoted on-screen label was extracted from the live view fragments
(ViewRun/ViewVinInbox/ViewImport/ViewVinLog/ViewHome/App + lot-scan/Capture.html)
and grep-verified verbatim. Recipe format throughout: When you do this / Before you
start / Steps / What good looks like / If something goes wrong.

## Decisions made with Nick (brainstormed this session — don't re-litigate)

- Audience: field crew, office/run operators, import. Illustrator/VersaWorks deferred.
- Formats in order: handbook (markdown in repo, published to Drive) → printable
  one-pagers distilled per recipe → videos scripted from the recipes. This branch
  is the handbook phase only.
- Structure: by role, task-recipe based; each recipe self-contained so it becomes a
  one-pager verbatim later.
- Finalize rule (Nick's words): if someone already put the order into Pipedrive →
  Existing with that deal's ID; if not started yet → New Deal; Test = practice only.
- Guardrails: ONLY ⚙ System Settings (Dealer Rules / Pipedrive Settings etc.) is
  marked Nick-only. Bypass filtering, Rollback, Remove Duplicates are all crew-usable
  and documented.
- Screenshots: `[SCREENSHOT: …]` placeholders in the text (~10); Nick captures in a
  batch pass after approving the text.

## Immediately pending — Nick (in order)

1. **Review the three handbooks** (office one first — it encodes your judgment
   calls). Best test: someone runs one task per book following only the doc.
2. **Fill the per-dealer routine table** in office handbook §1 (`[NICK: fill in]`
   rows — which dealers are CAO vs scanned vs manual vs combo). The vault's
   dealership-accounts note is a skeleton; only you have this.
3. **Capture screenshots** for the `[SCREENSHOT: …]` markers (after text approval).

## Then (Claude, next session)

- Apply Nick's review edits → merge `docs/crew-handbooks` → main (--no-ff) → push.
- Insert screenshots when Nick provides them (or he inserts them in the Drive copy).
- Publish to Drive as Google Docs/PDF (Drive MCP `create_file`, or Nick pastes —
  decide at publish time). Crew reads the Drive copy.
- Later phases (out of scope, agreed): one-pagers per recipe → laminate; video
  scripts from recipes; Illustrator/VersaWorks handbook; maybe in-app help.

## Context worth keeping

- Ground-truth label inventories came from two Explore agents over the view
  fragments; if the UI changes before merge, re-verify labels by grep (the commit's
  quoted strings are exact).
- The plan file for this work lives on the WORK PC only
  (`~\.claude\plans\my-next-goal-is-bubbly-allen.md`); everything actionable from it
  is in this handoff.
- Vault raw material used: `02-Areas/silver-fox-operations/production-workflow.md`,
  `data-flow.md`, `01-Projects/lot-scanner/project-brief.md`. `dealership-accounts.md`
  is a skeleton — filling it would also feed the §1 cheat table.
