# Promote Checklist — dev → prod pipeline

> **`clasp push` from this repo ALWAYS hits DEV** (`.clasp.json` targets the dev
> script). Prod is reachable only via `scripts/promote.ps1`. Environment
> inventory + runbook: [dev-environment.md](dev-environment.md).

1. [ ] **Branch** — `git checkout -b feat/<slug>` from up-to-date `main`
2. [ ] **Implement** — backend-specialist (Code.gs) / frontend-specialist (views)
3. [ ] **`clasp push`** — lands on DEV (the default, safe target)
4. [ ] **Test** — `node test/run-tests.js` green + dev SPA flow via `/verify`
5. [ ] **Review** — `/code-review`; config JSON → config-rules-reviewer;
       engine/schema changes → test-verifier
6. [ ] **Docs** — CHANGELOG.md in the same commit; Bridge doc if significant
       (docs-curator)
7. [ ] **Merge to `main`** + Nick pushes to GitHub — announce "deployable" only now
8. [ ] **Promote** — Nick runs `scripts/promote.ps1` (requires: main, clean tree,
       synced with origin/main, typed `PROMOTE`)
9. [ ] **Prod smoke** — open the prod SPA, one read-only flow; sync
       LEARNINGS/brain if anything new surfaced
