# Dev Environment — Provisioning Record & Runbook

The contained development environment for GAS ShortCut OPS. One codebase serves
both environments via the `ENV_IDS` scriptId map in Code.gs Section 1 — the
scriptId IS the environment. Full rationale: brain project
`01-Projects/gas-ops-dev-pipeline/` (decision logs).

## Environment inventory

All dev artifacts live in the **Claude Sandbox** Drive folder
(`1csrF3PhM-2Wj2Npq5NgdPev4Xn6fU5b1`) — the Sheets MCP's write scope — and are
prefixed `DEV_`. Minted 2026-07-10 by Drive-copying the prod originals.

| Artifact | ID | Prod original |
|---|---|---|
| DEV_SF_SYSTEM_MASTER (dev script bound here) | `1-0rHSoBmQip-yi_dB_S-kz-2fjc6x7pOxlbg2S7PEjk` | `1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes` |
| DEV_SF_DEALER_CONFIG | `1ajpIn_TD7fOZ_rZZMfK6KSdJ4niqiB4l85eC0dok5lA` | `1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8` |
| DEV_SF_UNIVERSAL_TEMPLATE | `1BgwoKC_QnRm4SF9HwrSZxmKTe8PznzwCBr33oJ5LFxg` | `14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc` |
| DEV_SF_VIN_LOGS | `1iXLrqW7e3DSdiGz5K13POjr561AwmfwL2DyXe3FR2no` | `12Xf6dyZXWXp4JwbytGo6lRUShwuGeN0yS3zhbco4-Lk` |
| DEV_SF_LOT_SUBMISSIONS | `1mftxwQOW_Pdqka8ZNPBlczDbBIku2lS91hwWUqUwNfg` | `1zs-Ycj64LTwIYJt84kC_-qY_EhsWgB1Pa5pQlsG-N1M` |
| DEV_LOT_PHOTOS folder (My Drive, Nick-only) | `10HB0u_IVHC6ah2OOgXraBzDbKnKUbxCF` | `1Gmw3fQ6tiPLL76tE374646huuYIVHxHf` ("SF Lot Submissions", Shared Drive) |
| DEV lot-scan Apps Script project, named **"DEV_SF Lot Scanner"** (standalone; minted 2026-07-13) | `1SrMalU5GszZERqAk5xmISUCwGTgqjZwuPMtybJ4nsPrDY15PBPbc25Vu` | `1ww7VJnkeFdpQj8-m06r4RRKxPFikgpNGVMwEgU9BWOgL0DWaJP-jmZJ7` |
| DEV_SF_EOM_REPORTS_INDEX | `18EQEMCS6Z6ux767ETyeVsFFjsYxrmHMw_m00sQEaoDU` | `1p28o2IbGFrHOqKVs_DUpAtyzM6LFYyAKUpsBB7NwFxg` |
| DEV_QR folder (all dealers) | `1c_BIBBmJL5HYJWIsMTzmHXNo5RvDUdQ1` | per-dealer folders (DEALERS col D) |
| DEV_OUTPUT folder (all dealers) | `1h5FS0FDkY91bjKx2nTRMuCVflMYa77P2` | per-dealer folders (DEALERS col E) + `1iRDDlqgQPn9R67AEIUJcF8JmyiOyn8DI` |
| DEV_EOM_REPORTS folder (inside DEV_OUTPUT) | `1EVSMdF1b7s__uAnTpCkET0tCHroOb1uV` | `1gM69qlwuUQYKCSYiwo6eXy9U3F83DQ19` (via PIPEDRIVE_SETTINGS `eom_reports_folder_id`) |
| Dev Apps Script project (bound to DEV master), named **"DEV_SFOX OPS V2"** in the editor | `1jbcjMNuopoO-WgzdG8me-7ZYscbi8xK8JuzmF9ajFPdioOrQlWOIWM5F` | `1E5aTcofzWzJZssOikaf6lFytS92vRHmj-k1NDV0C_Xu7NoJk7VUEjtNO` |

## Containment guarantees

1. **Sheets/Drive**: the dev script is container-bound to DEV_SF_SYSTEM_MASTER, so
   all `getActiveSpreadsheet()` sites resolve to dev; every `openById` target comes
   from the dev `ENV_IDS` entry; DEALERS cols D/E in the dev config point at
   DEV_QR/DEV_OUTPUT for every dealer, and PIPEDRIVE_SETTINGS
   `eom_reports_folder_id` points at DEV_EOM_REPORTS (neutralized 2026-07-10; audit
   confirmed DEALERS D/E, `eom_reports_folder_id`, and the `OUTPUT_FOLDER_ID`
   constant are the ONLY three sheet/code-sourced Drive write destinations).
2. **Fail-safe**: an unregistered scriptId (any stray Drive copy) throws at load —
   it can never run against prod IDs.
3. **Pipedrive**: in dev, ALL Pipedrive traffic routes to `PdFake.gs` at the three
   choke points (`pdFetch_`, `pdEomFetchProductsForDeals_`, and the
   `pdAttachFileToDeal_` multipart upload) when `ENV.name !== 'prod'` — fake deal
   ids start at 900000. PIPEDRIVE config rows stay ACTIVE in dev so the integration
   code paths run against the fake. **Dev script properties must hold DUMMY secrets**
   (`PD_API_TOKEN` = `FAKE`, `PD_COMPANY_DOMAIN` = `fake-dev`, set by hand in
   Project Settings → Script Properties — NOT via `setupPipedriveSecrets`, which
   validates against the live API): the `configured` gates in
   finalize/EOM check secrets exist BEFORE `pdFetch_` runs, and the fake branch
   fires before the token is ever used. Never put the real token in dev.
4. **Template**: verified free of IMPORTRANGE / external-ID formulas (all
   ARRAYFORMULAs are self-contained).

## Structural sheet changes — migrations

The sheets are the datastore, so schema changes need their own promote path
(code rides git+clasp; sheet structure does not). Convention:

- Every structural change (new column, tab, config key) is **append-only** (house
  invariant) and ships as an **idempotent `migration_<date>_<slug>()` function in
  the same commit** as the code that needs it — same idiom as
  `setupEomReportsIndex()` / `setupLotScannerResources()`. Idempotent = safe to
  run twice (check-before-add).
- **Dev**: run the migration from the dev script editor while developing — that's
  how the dev sheets acquire the structure.
- **Prod**: running the migration from the prod script editor is checklist stage 8,
  BEFORE `promote.ps1` (stage 9). Schema first, then code: append-only widening
  never breaks the old code still running, but new code against an unmigrated
  sheet breaks immediately.
- **Why in-flight divergence is safe**: because changes are append-only, a hotfix
  cut from `main` (old schema) still tests correctly against structurally-ahead
  dev sheets — the unmerged columns just sit there unread. Non-append-only changes
  (renaming/moving/inserting inside a fixed range) would break this guarantee and
  are already forbidden by the invariants.

<!-- ponytail: convention + checklist stage only; add a runPendingMigrations()
     registry (applied-ids in ScriptProperties) if migrations ever stack up
     faster than they promote -->

## Data refresh (re-seed) — NEVER re-copy the master

Re-copying DEV_SF_SYSTEM_MASTER would mint a NEW bound script and invalidate
`ENV_IDS` + `.clasp.json`. To refresh dev data:

1. Sheets-MCP copy the tab *contents* prod → dev (reads are allowed anywhere;
   writes only in Claude Sandbox).
2. Re-run the neutralization: DEALERS `D2:E45` → DEV_QR / DEV_OUTPUT ids (above).
3. Confirm no `PD_API_TOKEN` appeared in dev script properties.

<!-- ponytail: manual runbook; script it only if refresh becomes frequent -->

## Web-app deployments (fullscreen /exec usage)

The sheet menu/modal always runs HEAD (latest push, no deployment involved).
The fullscreen web app is a *deployment* and behaves differently per env:

- **DEV**: use the HEAD deployment's **`/dev` test URL** (script editor →
  Deploy → Test deployments). It always serves the latest `clasp push` —
  zero deployment management, every push instantly live. HEAD deployment id:
  `AKfycbwuFcrVSyE05fSiT1FSkNzxW-4PC4OZVj8d71dtNa8`.
- **PROD**: the real `/exec` URL serves the pinned versioned deployment
  (`AKfycbwB_wXCfnBEJCwM-bN6lO_HYtzeFI5J2e-EdURk5y-V0ZrfZ9qetotggbIE28Ez6pkI`).
  `promote.ps1` bumps it automatically after the code push
  (`clasp deploy --deploymentId … --description "promote <sha>"`) — same URL,
  new version. Version pinning is a feature: rollback = redeploy a previous
  version from Manage deployments in the Apps Script UI.

## clasp targets

- `.clasp.json` (committed) → **DEV** scriptId — default `clasp push` is safe.
- `.clasp.prod.json` (committed) → PROD scriptId — reached ONLY via
  `scripts/promote.ps1` (Nick-run, guarded: main branch, clean tree, synced with
  origin, typed confirmation).
- **lot-scan/** mirrors the same model (added 2026-07-13): `lot-scan/.clasp.json`
  → DEV scanner scriptId, `lot-scan/.clasp.prod.json` → PROD scanner, reached
  ONLY via `scripts/promote-lot-scan.ps1` (same gates minus the Node harness —
  it tests main-app paths). `lot-scan/.claspignore` keeps `.clasp.prod.json`
  out of pushes (the root `.claspignore` does NOT apply to sub-project pushes).
  The scanner's `ENV_IDS` resolver (lot-scan/Code.gs, same scriptId-keyed idiom)
  routes dev to DEV_SF_SYSTEM_MASTER / DEV_SF_DEALER_CONFIG /
  DEV_SF_LOT_SUBMISSIONS / DEV_LOT_PHOTOS; an unregistered scriptId throws.
  No Pipedrive in the scanner, so no fake needed. Dev web app = the HEAD
  deployment's `/dev` test URL (id `AKfycbyD8S_9SqHtExPhaHCnwP9EDBtrO3z-GjVaSMvMzHHV`);
  prod `/exec` = pinned versioned deployment
  (`AKfycbwOv4waW5OrV6tLllV2HxVqLsO6fMdP6hfGbYvuDu8IpGyRb5r2bmCNVkTB0mvcpOFvCQ`),
  bumped by the promote script.
- eom-viewer/ has **no dev twin yet** — its `.clasp.json` still points at prod.
  Rare changes; review gate + Nick-only pushes until a twin exists.
