# Full-app screenshot harness

Renders the REAL SilverFox App (App.html + every view fragment, real CSS and
real view JS) in headless Chrome with `google.script.run` replaced by a mock
that serves realistic data, then screenshots every (theme × scenario). This is
the whole-app complement to `build-repro.js` (which renders one static DOM
snippet with the view CSS only).

Born from the 2026-09-23 UI audit: 8 themes × 40 scenarios reviewed by pixels.

## Files

| File | Role |
|---|---|
| `build-app.js` | Assembles `app.html`: resolves `<?!= include_() ?>`, stubs the `<?= ?>` scriptlets, injects the mock + harness scripts. |
| `mock-gsr.js` | Proxy-based `google.script.run` mock. Any `.fnName(args)` looks up `window.MOCK[fnName]` (value or `function(args) → value`), calls the success handler async, deep-clones the fixture. Unknown names log `[mock] no mock for …` and resolve `null`. Return `window.MOCK_NEVER` to simulate a call that never returns (in-progress states). |
| `mock-data.js` | Fixtures for the operational views (Home, Run Order, Import, VIN Logs, VIN Inbox, Stack Cleanup). Shapes follow Code.gs as of Sep 2026. |
| `mock-data-settings.js` | Fixtures for the settings views (Dealer Rules, Pipedrive Settings, Data Sources, EOM, Norm, Field Codes, CSV Schemas, Add Dealer). |
| `harness.js` | In-page scenario driver. `HARNESS.scenarios` lists them; `HARNESS.run(name)` navigates + drives the view into the state (select dealer, paste VINs, start a run, open the editor, …). Add a scenario = add an entry to `S`. |
| `shoot.js` | puppeteer-core driver: loads `app.html?theme=<id>` fresh per scenario, runs it, screenshots to `shots/<theme>/<scenario>-<width>.png`, and writes `report-<width>.json` (unknown mocks + console errors per shot). |
| `probe.js` | Computed-style probe: `node probe.js --theme dark --scenario rules-pipedrive --sel ".pd-org-clear,.tr-match"` prints each selector's first match's background / color / border / font / appearance / box. Use it when a shot shows the wrong color or size and you need to know which rule won (e.g. it showed "Change" was already token-colored but rendering in Arial — the fix was `font-family`, not color). |

## Run

```powershell
cd .claude\skills\ui-screenshot-repro\full-app
npm install            # puppeteer-core only (uses the installed Chrome)
node build-app.js      # → app.html (re-run after any App/View/SharedUtils change)
node shoot.js --themes light,dark --scenarios home,run-vins --width 1440 --height 900 --out shots
node shoot.js --themes light,dark,midnight,encarta,sage,gruvbox-rail,slate-icons,luna --out shots   # everything
```

Then Read the PNGs. A clean run prints one `theme/scenario` line per shot with
no `unknown=` / `ERR=` suffix.

## Keeping it honest

- When a view starts calling a new server function, add its fixture to the
  matching mock file (the shooter's `unknown=` suffix tells you which).
- When a server return shape changes, update the fixture — the views render
  whatever the mock returns, so a stale shape shows a stale (or broken) UI.
- `shots/`, `app.html` and `node_modules/` are generated; don't commit them.
