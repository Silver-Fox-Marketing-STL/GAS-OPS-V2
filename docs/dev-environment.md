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
| DEV_SF_EOM_REPORTS_INDEX | `18EQEMCS6Z6ux767ETyeVsFFjsYxrmHMw_m00sQEaoDU` | `1p28o2IbGFrHOqKVs_DUpAtyzM6LFYyAKUpsBB7NwFxg` |
| DEV_QR folder (all dealers) | `1c_BIBBmJL5HYJWIsMTzmHXNo5RvDUdQ1` | per-dealer folders (DEALERS col D) |
| DEV_OUTPUT folder (all dealers) | `1h5FS0FDkY91bjKx2nTRMuCVflMYa77P2` | per-dealer folders (DEALERS col E) + `1iRDDlqgQPn9R67AEIUJcF8JmyiOyn8DI` |
| DEV_EOM_REPORTS folder (inside DEV_OUTPUT) | `1EVSMdF1b7s__uAnTpCkET0tCHroOb1uV` | `1gM69qlwuUQYKCSYiwo6eXy9U3F83DQ19` (via PIPEDRIVE_SETTINGS `eom_reports_folder_id`) |
| Dev Apps Script project (bound to DEV master) | _pending — Nick grabs from DEV master → Extensions → Apps Script_ | `1E5aTcofzWzJZssOikaf6lFytS92vRHmj-k1NDV0C_Xu7NoJk7VUEjtNO` |

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
3. **Pipedrive**: dev NEVER gets a `PD_API_TOKEN` script property, and the Phase 2b
   fake layer intercepts at the `pdFetch_` / `pdEomFetchProductsForDeals_` choke
   points when `ENV.name !== 'prod'`. PIPEDRIVE config rows stay ACTIVE in dev so
   the integration code paths run against the fake.
4. **Template**: verified free of IMPORTRANGE / external-ID formulas (all
   ARRAYFORMULAs are self-contained).

## Data refresh (re-seed) — NEVER re-copy the master

Re-copying DEV_SF_SYSTEM_MASTER would mint a NEW bound script and invalidate
`ENV_IDS` + `.clasp.json`. To refresh dev data:

1. Sheets-MCP copy the tab *contents* prod → dev (reads are allowed anywhere;
   writes only in Claude Sandbox).
2. Re-run the neutralization: DEALERS `D2:E45` → DEV_QR / DEV_OUTPUT ids (above).
3. Confirm no `PD_API_TOKEN` appeared in dev script properties.

<!-- ponytail: manual runbook; script it only if refresh becomes frequent -->

## clasp targets

- `.clasp.json` (committed) → **DEV** scriptId — default `clasp push` is safe.
- `.clasp.prod.json` (committed) → PROD scriptId — reached ONLY via
  `scripts/promote.ps1` (Nick-run, guarded: main branch, clean tree, synced with
  origin, typed confirmation).
- lot-scan/ and eom-viewer/ have **no dev twins yet** — their `.clasp.json` still
  points at prod. Rare changes; review gate + Nick-only pushes until twins exist.
