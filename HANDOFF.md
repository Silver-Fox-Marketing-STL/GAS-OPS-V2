# HANDOFF — EOM viewer "Current" section (2026-07-06)

For the next session picking up branch `feature/eom-billing-report` on another
machine. Read this, finish the two deploy steps below, verify, then delete this
file. Local checkout path varies per machine — everything here is repo-relative.

## What was built this session (both committed on this branch)

1. **Per-dealer "Expand all" / "Collapse all" buttons** in each dealer card's
   Deals header — `EomReportRenderer.html` (shared renderer; the copy in
   `eom-viewer/` is a byte-copy, hashes verified — keep them identical).
2. **Live "Current — EOM Merge" section** in the standalone viewer sidebar
   (`eom-viewer/Code.gs` + `eom-viewer/Viewer.html`): one new public function
   `getCurrentReport()` pulls stage **44** (`CURRENT_STAGE_ID`) straight from
   Pipedrive — read-only GETs, writes nothing — and renders it exactly like an
   archived month. Purpose: spot deals parked in EOM Merge mid-month that
   should be billed immediately. Full detail in `CHANGELOG.md` (Unreleased).

## Deploy state — IMPORTANT

- **Viewer Apps Script project** (`eom-viewer/.clasp.json`, script id
  `14AbPr…VQgW2`): deployment `AKfycby7…PitIQ` is live at **version 11**
  (has the feature + credential probe).
- **NOT yet pushed to Apps Script:** the last local commit's error-split in
  `getCurrentReport` (distinguishes "missing OAuth grant" from "Pipedrive
  rejected the token"). Nick's `clasp` login expired mid-session
  (`invalid_rapt`), so the final push/deploy never happened.
- The **main app** (root project) needed no changes for this feature.

## Where it's stuck (the live blocker)

Clicking Current shows **"Pipedrive rejected the viewer credentials"**. Almost
certainly NOT the credentials: the viewer gained the `UrlFetchApp`
external-request scope and the OWNER has not re-authorized, and at v11 that
missing grant is caught and mislabeled as a credential rejection.

## Next steps, in order

1. Nick: `clasp login` (his session expired).
2. Nick (one-time, browser): open the viewer script editor → run
   `getCurrentReport` from the toolbar → approve the consent prompt
   (external-request scope). This alone may fix the live error at v11.
3. From INSIDE `eom-viewer/` (never the repo root — root `.claspignore`
   excludes it, a root push silently does nothing to the viewer):
   `clasp push -f`, then `clasp version "<label>"`, then
   `clasp deploy -i AKfycby7zl3kavPEXArOp0lnSiEnW450R_jQThspSkhIUvUEDl4GaZ46DSNkYSVzMyXtoPitIQ -V <new version>`
   — redeploying the SAME deployment id keeps the invoice team's URL.
   (`clasp push` alone never updates the served app — that was one of this
   session's failure modes.)
4. Verify in the viewer: Current section → should render live deals.
   - Still "credentials rejected" (now meaning it, post-v12): re-check
     `PD_API_TOKEN` / `PD_COMPANY_DOMAIN` in the VIEWER project's
     **Project Settings → Script properties** (copied from the main app's).
   - "No deals in stage "<name>" (id 44)" with an unexpected name: stage 44
     isn't EOM Merge — fix `CURRENT_STAGE_ID` in `eom-viewer/Code.gs`.
5. When working: consider `docs/GAS_ShortCut_OPS_Bridge_System.md` sync
   (docs-curator) and delete this file.

## Invariants to respect (from this feature)

- Viewer public surface is EXACTLY FOUR functions (`doGet`,
  `getViewerBootstrap`, `getReportJson`, `getCurrentReport`) — everything else
  `_`-suffixed. Never return the token or Drive/file ids.
- `EomReportRenderer.html` ↔ `eom-viewer/EomReportRenderer.html` stay
  byte-identical (compare hashes after any renderer edit).
- The viewer's row/group pipeline is a verbatim copy of main `Code.gs`
  Section 33 (`eomBuildRows_`/`eomGroupForReport_` etc.) — if Section 33
  changes, re-sync the copies (two documented deviations in `cvBuildRows_`).
- Secrets live in Script Properties only; the Current section auto-hides when
  they're unset.
