# Ponytail Audit — GAS ShortCut OPS (repo-wide)

_Generated June 25, 2026. Scope: over-engineering & complexity only — correctness/security/perf are out of scope. Read-only cut-list; nothing was applied._

Ranked biggest cut first.

## Findings

| # | Tag | Cut | Replacement / note | Path |
|---|-----|-----|--------------------|------|
| 1 | `delete:` | `SilverFox_Project_Files.zip` (54 KB binary snapshot) | Source already lives in the tree; `git rm` it. | `SilverFox_Project_Files.zip` |
| 2 | `delete:` | Classic menu fallback layer — `Classic.html` + `openViewStandalone_` + `promptRunDealer`/`openScraperImport`/`openNormManager`/`openVINLogUpdater`/`openRulesEditor`/`openRunLog` + the `onOpen` "Classic menu (deprecated)" submenu (~165 lines + 1 file) | The App (`openApp`) is the real path. **Gate:** only after App validation sign-off (already on the CLAUDE.md to-do). | `Code.gs`, `Classic.html`, `App.html` |
| 3 | `delete:` | `migrateTypeRulesIntoProductMap` (47 L) | One-time col-O→product-map migration, already run. | `Code.gs` |
| 4 | `delete:` | `saveDealerTypeRules` (24 L) | Zero callers; Type Rules editor tab was removed (col O dormant). | `Code.gs:4025` |
| 5 | `delete:` | `auditConfigPlaceholders` (27 L) | Defined, never called, not menu-wired. | `Code.gs` |
| 6 | `delete:` | `addCommittedAtHeaders` (22 L) | One-time SF_VIN_LOGS header setup, already done. | `Code.gs` |
| 7 | `delete:` | `getAppHomeStatus` (10 L) | Superseded on Home by `getDashboardView`; kept only for the Classic path (finding #2). | `Code.gs` |
| 8 | `delete:` | `getTypeRules_` (9 L) | Only caller is finding #3's migration; dies with it. **Keep `matchRule_`** — still used by the live run path. | `Code.gs` |
| 9 | `delete:` | `getActiveDealerKeys_` (8 L) | Private helper, zero callers. | `Code.gs` |
| 10 | `delete:` | `getPipedriveProductFields` (4 L) | Client-callable, zero references in any view. | `Code.gs` |
| 11 | `yagni:` | `use_stock_not_vin` flag | FALSE for every dealer; planned stock→VIN replacement never built. ~10 always-no-op branches in the run path. Drop the flag + its guards. | `Code.gs`, DEALERS col F |
| 12 | `yagni:` | `model_trim_split` key | Inert in Glendale's `data_transforms`; `applyDataTransforms_` never reads it. Remove from config. | SF_DEALER_CONFIG |
| 13 | `delete:` | `test-write-access.txt` (empty) | MCP write-test leftover. | `test-write-access.txt` |

## Not findings (deliberately kept)

- **`app*` / `*Core_` / classic `open*` triple-split** is forced by the platform bug where `ui.alert()` fails via `google.script.run` — `native:`-justified, not bloat. It shrinks naturally once finding #2 removes the classic third.
- **`psRenderRuleCard_` / `psSerializeOneRule_` / `psDeserializeOneRule_`** are already one shared implementation reused across ViewRules + ViewPipedriveSettings — not duplicated. Correct.

## Net

**-~320 lines, -2 files, -1 committed zip (54 KB), -2 dead config keys possible. -0 deps** (GAS repo; no npm runtime deps).

## If applying

- Findings **3–10, 13** are zero-risk deletions — grep-confirmed no references. Findings **1, 13** are file removes (`git rm`).
- Findings **2, 11, 12** touch live paths / config — apply **last, one at a time**, with a `clasp push` + smoke test (open App, run a dealer) between each, per the repo's verify-after rule.
- The audit itself applies nothing; this file is the backlog.
