# Routes — SilverFox V2

## Detected stack

- **Platform**: Google Apps Script (V8 runtime) — container-bound to a Google Sheet
  (`SF_SYSTEM_MASTER`). No package.json, no bundler, no framework.
- **Server**: `Code.gs` (~10k lines) — all business logic + HtmlService serving.
- **UI**: HtmlService HTML fragments with inline `<style>` + `<script>` per file.
  Templating = GAS scriptlets: `<?= var ?>` (printing) and `<?!= include_('File') ?>`
  (raw fragment include, defined in `Code.gs`).
- **Client-server bridge**: `google.script.run.withSuccessHandler(...).withFailureHandler(...).serverFn(args)`.
  All view JS shares ONE global scope (fragments are concatenated into one page).
- **CSS approach**: vanilla CSS custom properties (design tokens in `SharedUtils.html`),
  every view's rules scoped under its `#view-xxx` id.
- Sibling standalone GAS projects in the repo (own `.clasp.json`, separate deployments,
  NOT part of the App shell): `eom-viewer/` (public EOM report viewer) and `lot-scan/`
  (mobile VIN photo capture).

## Entry points (Code.gs)

There is no URL-path routing. Three ways in:

### 1. `doGet(e)` — Web App (browser tab at the deployment `/exec` URL)

```js
function doGet(e) {
  var t = HtmlService.createTemplateFromFile('App');
  t.initialTheme = getThemePreference();
  var uiPrefs_ = getUiPrefs();
  t.initialNavLayout = uiPrefs_.navLayout;   // 'auto' | 'sidebar' | 'top-rail' | 'bottom-rail' | 'start-menu'
  t.initialAutohide  = uiPrefs_.autohide ? 'true' : 'false';
  t.appMode = 'webapp';
  return t.evaluate()
    .setTitle('SilverFox')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

`appsscript.json` webapp config: `executeAs: USER_ACCESSING`, `access: DOMAIN` — each user
runs as themselves (per-user theme/UI prefs, active-spreadsheet binding).
`e` (URL parameters) is **ignored** — no query-param routing; the client always boots to
`view-home` (`navTo('view-home')` at the end of App.html's boot script).

### 2. `openApp()` — modal dialog from the Sheet menu ("SilverFox V2 → 🚀 Open SilverFox")

Identical template setup with `t.appMode = 'modal'`, shown via
`SpreadsheetApp.getUi().showModalDialog(html, 'SilverFox')` at `MODAL_WIDTH 1400 × MODAL_HEIGHT 900`.
`data-mode="modal|webapp"` on `<html>` is the only difference (webapp hides the Close item;
close falls back to a toast).

### 3. `openViewStandalone_(fragmentName, title)` — Classic menu fallback (deprecated)

Serves ONE view fragment inside `Classic.html`:

```js
function openViewStandalone_(fragmentName, title) {
  var t = HtmlService.createTemplateFromFile('Classic');
  t.fragment = fragmentName;
  t.initialTheme = getThemePreference();
  var html = t.evaluate().setWidth(MODAL_WIDTH).setHeight(MODAL_HEIGHT);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}
// Menu wrappers:
promptRunDealer()   → ViewRun        openScraperImport() → ViewImport
openVINLogUpdater() → ViewVinLog     openRulesEditor()   → ViewRules
openNormManager()   → ViewNorm       (Field Codes)       → ViewFieldCodes
```

### The include helper

```js
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
```

## Client-side "routing" (App.html)

`navTo(viewId)` hides every `.view` except the target, toggles `.nav-item.active`, sets
`#appHeaderTitle` from `NAV_TITLES`, then runs `VIEW_INITS[viewId]` once (lazy init) and
`VIEW_SHOWN[viewId]` on every visit. View ids ↔ titles:

```js
var NAV_TITLES = {
  'view-home': 'Home',                 'view-run': 'Run Order',
  'view-import': 'Import Data',        'view-datasources': 'Data Sources',
  'view-vinlog': 'VIN Logs',           'view-vin-inbox': 'VIN Inbox',
  'view-end-of-month': 'End of Month', 'view-rules': 'Dealer Rules',
  'view-norm': 'Normalization',        'view-utilities': 'Utilities',
  'view-pipedrive-settings': 'Pipedrive Settings',
  'view-fieldcodes': 'Field Codes',    'view-ui-settings': 'UI Settings'
};
```

## View → file → server functions (google.script.run surface)

| View id | File | Renders | Server functions called |
|---|---|---|---|
| `view-home` | `ViewHome.html` | Status strip, workflow launcher cards, live DASHBOARD tables | `getDashboardView` |
| `view-run` | `ViewRun.html` | Run a dealer order: dealer/user selects, VIN paste or CAO pre-fill, match table, progress, finalize cards, Pipedrive push | `getDealerVinData`, `getCaoVins`, `pasteVinsAndRun`, `getRunProgress`, `clearRunProgress`, `getLatestOrderId`, `commitRunRows`, `abandonRun`, `pushRunToPipedrive` |
| `view-import` | `ViewImport.html` | Scraper CSV import (replace/merge), header mapping preview, current-data panel | `importScraperData`, `getScraperDataPreview`, `getCanonicalHeaders`, `getHeaderAliasMap`, `getVehicleTypes` |
| `view-datasources` | `ViewDataSources.html` | Per-dealer alternate feed column-mapping editor | `getDataSourcesBootstrap`, `getSourcesForDealer`, `getSourceMapping`, `saveSourceMapping`, `deleteSource`, `addSchemaColumn` |
| `view-vinlog` | `ViewVinLog.html` | Commit/rollback run results to VIN logs; manual VIN commit | `getRunsForDealer`, `commitRunToVINLog`, `manualCommitToVINLog`, `rollbackRunFromVINLog`, `getCommittedAt` |
| `view-vin-inbox` | `ViewVinInbox.html` | Lot Scanner photo submissions grouped by dealer; process/discard | `getVinSubmissions`, `updateVinSubmissionStatus` |
| `view-end-of-month` | `ViewEndOfMonth.html` | EOM billing report generation, progress, archive list, in-app viewer (via `EomReportRenderer`) | `getEomBootstrap`, `generateEomReport`, `getEomProgress`, `clearEomProgress`, `getEomReportsList`, `getEomReportJson`, `getEomCurrentReport`, `finalizeEomReport`, `saveEomSettings` |
| `view-rules` | `ViewRules.html` | Per-dealer filtering rules (type pills, price, seasoning, source split) + Pipedrive dealer config, in two tabs | `getRulesEditorBootstrap`, `getDealerRulesData`, `saveDealerFilterRules`, `addVehicleType`, `removeVehicleType`, `getProductVariations`, `getPipedriveStatus`, `getPipedriveConfigBootstrap`, `getPipedriveDealerEditorData`, `savePipedriveDealerConfig`, `searchPipedriveOrganizations` |
| `view-norm` | `ViewNorm.html` | Normalization map CRUD table (raw → normalized), ordered first-match-wins | `getNormEntries`, `addNormEntry`, `updateNormEntry`, `deleteNormEntry`, `moveNormEntry` |
| `view-utilities` | `ViewUtilities.html` | One-off maintenance buttons | Dynamic `google.script.run[serverFn]()`: `fillScraperDateTime`, `appRefreshNormReference`, `appOpenRunLog`, `appEraseAllQRFolders`, `appCleanUpOutputDocs` |
| `view-pipedrive-settings` | `ViewPipedriveSettings.html` | Pipedrive connection, global settings, org links, install-cost config | `setupPipedriveSecrets`, `getPipedriveStatus`, `getPipedriveConfigBootstrap`, `getPipedriveGlobalSettings`, `savePipedriveGlobalSettings`, `savePipedriveProductOrgField`, `saveDealerOrgLinks`, `searchPipedriveOrganizations`, `getProductVariations`, `getPipedriveInstallCostConfig`, `saveInstallCostConfig` |
| `view-fieldcodes` | `ViewFieldCodes.html` | CSV field-code → ORDERMATCH column mapping table | `getFieldCodeMappings`, `saveFieldCodeMapping`, `deleteFieldCodeMapping` |
| `view-ui-settings` | `ViewUiSettings.html` | Nav-layout picker cards + autohide toggle (client-side `UiPrefs`) | (via SharedUtils `UiPrefs`) `saveUiPref` |

Shared (SharedUtils.html, any view): `getAppBootstrap` (dealers + user profiles, prefetched
at app open), `saveThemePreference`, `saveUiPref`.

Non-view fragments included by App.html: `SharedUtils.html` (tokens + shared JS, FIRST),
`EomReportRenderer.html` (shared EOM report renderer; byte-copied into `eom-viewer/`).
