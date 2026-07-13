# Promote Checklist — dev → prod pipeline

> **`clasp push` from this repo ALWAYS hits DEV** (`.clasp.json` targets the dev
> script). Prod is reachable only via `scripts/promote.ps1`. Environment
> inventory + runbook: [dev-environment.md](dev-environment.md). Full guide:
> brain `03-Resources/google-apps-script/dev-prod-environments.md`.

## The branch model

- **`main`** = finished, tested work only; always promotable; never commit to it
  directly. **`feat/<slug>`** = where all work happens.
- The dev environment is a **screen showing whatever branch was last pushed**,
  not a version — `.clasp.json` is committed on every branch, so `clasp push`
  is dev-safe from anywhere.
- **Hotfix while mid-feature**: your unfinished work is committed on its
  feature branch, so `git checkout main` → `fix/<slug>` → push/test in dev →
  merge → promote ships ONLY the fix. No rollback, ever. Then check the feature
  branch back out and `clasp push` — dev shows your feature again.
- **Three kinds of changes**: code promotes via git+promote.ps1; sheet SCHEMA
  promotes via migration functions (stage 8); sheet CONFIG/DATA does **not
  promote at all** — dev config is a snapshot copy; a tested config change is
  applied to prod by editing the PROD config sheet directly.

1. [ ] **Branch** — `git checkout -b feat/<slug>` from up-to-date `main`
2. [ ] **Implement** — backend-specialist (Code.gs) / frontend-specialist (views).
       **Structural sheet change needed?** (new column/tab/config key — append-only,
       per the invariants): write it as an idempotent `migration_<date>_<slug>()`
       function in the SAME commit, run it against DEV from the dev script editor,
       and flag the feature "needs prod migration" in its CHANGELOG line
3. [ ] **`clasp push`** — lands on DEV (the default, safe target)
4. [ ] **Test** — `node test/run-tests.js` green + dev SPA flow via `/verify`
5. [ ] **Review** — `/code-review`; config JSON → config-rules-reviewer;
       engine/schema changes → test-verifier
6. [ ] **Docs** — CHANGELOG.md in the same commit; Bridge doc if significant
       (docs-curator)
7. [ ] **Merge to `main`** + Nick pushes to GitHub — announce "deployable" only now
8. [ ] **Migrate prod sheets FIRST** (only if the feature has a migration): run its
       `migration_*()` from the PROD script editor. Schema before code —
       append-only widening is backward-compatible with the still-running old code;
       new code against an unmigrated sheet is not
9. [ ] **Promote** — Nick runs `scripts/promote.ps1` (requires: main, clean tree,
       synced with origin/main, typed `PROMOTE`)
10. [ ] **Prod smoke** — open the prod SPA, one read-only flow; sync
        LEARNINGS/brain if anything new surfaced
