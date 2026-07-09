# Pages — SilverFox V2

There are no ES imports. A "page" = one view fragment stitched into the App shell at serve
time. The dependency tree for EVERY view is therefore:

```
App.html                          (shell: sidebar nav, header, theme picker, navTo)
├─ SharedUtils.html               (design tokens, toast, AppGuards, AppBusy, AppData,
│                                  Theme registry, UiPrefs, CustomSelect — included FIRST)
├─ EomReportRenderer.html         (shared eomr* report renderer)
└─ View<Name>.html                (markup + #view-scoped <style> + <script>)
   └─ Code.gs                     (server functions via google.script.run)
```

When designing a view, the `--context-file` set is: the view's HTML file + `SharedUtils.html`
(tokens) + `App.html` (shell). Line-range hints below point at each file's `<style>` block.

## view-home (Home)
Entry: `ViewHome.html` (315 lines; style 52–205)
- `App.html` (shell) → `SharedUtils.html` (tokens, `escHtml`, `VIEW_SHOWN`)
- Server (`Code.gs`): `getDashboardView` — DASHBOARD sheet as 2D display strings
- Renders: `.home-status` strip, `.home-cards` launcher grid, `.dash-section`/`.dash-table` dashboard

## view-run (Run Order) — most complex view
Entry: `ViewRun.html` (1449 lines; style 133–538)
- `App.html` → `SharedUtils.html` (`AppData.get` for dealers/users, `AppGuards`, `AppBusy`, `toast`, CustomSelect)
- Server (`Code.gs`): `getDealerVinData`, `getCaoVins`, `pasteVinsAndRun`, `getRunProgress`,
  `clearRunProgress`, `getLatestOrderId`, `commitRunRows`, `abandonRun`, `pushRunToPipedrive`
- Renders: topbar (dealer/user selects + actions), VIN textarea zone, sticky-header match
  table with type pills, right rail (CAO summary, progress bar, finalize cards, Pipedrive push)

## view-import (Import Data)
Entry: `ViewImport.html` (1355 lines; style 169–659)
- `App.html` → `SharedUtils.html` (`AppBusy`, `toast`)
- Server (`Code.gs`): `importScraperData`, `getScraperDataPreview`, `getCanonicalHeaders`,
  `getHeaderAliasMap`, `getVehicleTypes`
- Renders: modal-frame skeleton (`.modal-header/.modal-body/.modal-footer`), two-column
  `.import-cols` (mode selector + file pick left, current-data/preview right)

## view-datasources (Data Sources)
Entry: `ViewDataSources.html` (442 lines; style 58–110)
- `App.html` → `SharedUtils.html` (`AppData`, CustomSelect)
- Server (`Code.gs`): `getDataSourcesBootstrap`, `getSourcesForDealer`, `getSourceMapping`,
  `saveSourceMapping`, `deleteSource`, `addSchemaColumn`
- Renders: dealer/source/file controls row, fixed-layout `.ds-table` mapping editor, actions row

## view-vinlog (VIN Logs)
Entry: `ViewVinLog.html` (918 lines; style 92–454)
- `App.html` → `SharedUtils.html` (`AppData`, `AppGuards`, `toast`)
- Server (`Code.gs`): `getRunsForDealer`, `commitRunToVINLog`, `manualCommitToVINLog`,
  `rollbackRunFromVINLog`, `getCommittedAt`
- Renders: two-column `.layout` (runs list/table main; manual-commit + detail side rail)

## view-vin-inbox (VIN Inbox)
Entry: `ViewVinInbox.html` (185 lines; style 19–49)
- `App.html` → `SharedUtils.html` (`.u-*` utilities, `toast`)
- Server (`Code.gs`): `getVinSubmissions`, `updateVinSubmissionStatus`
- Renders: `.vi-cards` grid of photo-thumbnail cards with status badges + per-card actions
- Related sibling project: `lot-scan/` (the capture side; separate deployment)

## view-end-of-month (End of Month)
Entry: `ViewEndOfMonth.html` (503 lines; style 117–186)
- `App.html` → `SharedUtils.html` → **`EomReportRenderer.html`** (`eomrRenderReport` for the in-app viewer)
- Server (`Code.gs`): `getEomBootstrap`, `generateEomReport`, `getEomProgress`, `clearEomProgress`,
  `getEomReportsList`, `getEomReportJson`, `getEomCurrentReport`, `finalizeEomReport`, `saveEomSettings`
- Renders: settings/generate panels (`.eom-panel`), progress bar, reports archive rows, in-app report viewer
- Related sibling project: `eom-viewer/` (public standalone viewer; byte-copies `EomReportRenderer.html`)

## view-rules (Dealer Rules) — largest file
Entry: `ViewRules.html` (2709 lines; style 261–1017)
- `App.html` → `SharedUtils.html` (`AppData`, `AppGuards`, CustomSelect)
- Server (`Code.gs`): `getRulesEditorBootstrap`, `getDealerRulesData`, `saveDealerFilterRules`,
  `addVehicleType`, `removeVehicleType`, `getProductVariations`, `getPipedriveStatus`,
  `getPipedriveConfigBootstrap`, `getPipedriveDealerEditorData`, `savePipedriveDealerConfig`,
  `searchPipedriveOrganizations`
- Renders: dealer-select top-bar, two `role=tablist` tabs (Filtering Rules / Pipedrive) with
  unsaved-change dots, filter cards (type pills, price range, seasoning table, source split),
  Pipedrive dealer config editor, status bar

## view-norm (Normalization)
Entry: `ViewNorm.html` (419 lines; style 57–222)
- `App.html` → `SharedUtils.html` (CustomSelect for the map picker)
- Server (`Code.gs`): `getNormEntries`, `addNormEntry`, `updateNormEntry`, `deleteNormEntry`, `moveNormEntry`
- Renders: top-bar (map select + count + order note), add-bar (raw → normalized), status bar,
  JS-height CRUD table with inline edit + reorder arrows, footer

## view-utilities (Utilities)
Entry: `ViewUtilities.html` (86 lines; style 29–59)
- `App.html` → `SharedUtils.html` (`toast`)
- Server (`Code.gs`, dynamic dispatch `google.script.run[serverFn]()`): `fillScraperDateTime`,
  `appRefreshNormReference`, `appOpenRunLog`, `appEraseAllQRFolders`, `appCleanUpOutputDocs`
- Renders: grouped `.util-btn` button lists (destructive ones confirm first)

## view-pipedrive-settings (Pipedrive Settings)
Entry: `ViewPipedriveSettings.html` (1960 lines; style 138–540)
- `App.html` → `SharedUtils.html` (`AppData`, `toast`, CustomSelect)
- Server (`Code.gs`): `setupPipedriveSecrets`, `getPipedriveStatus`, `getPipedriveConfigBootstrap`,
  `getPipedriveGlobalSettings`, `savePipedriveGlobalSettings`, `savePipedriveProductOrgField`,
  `saveDealerOrgLinks`, `searchPipedriveOrganizations`, `getProductVariations`,
  `getPipedriveInstallCostConfig`, `saveInstallCostConfig`
- Renders: stacked `.ps-card` sections (Connection with status dot, global settings, dealer→org
  links with search, install-cost config) + sticky `.ps-save-row`

## view-fieldcodes (Field Codes)
Entry: `ViewFieldCodes.html` (470 lines; style 60–262)
- `App.html` → `SharedUtils.html`
- Server (`Code.gs`): `getFieldCodeMappings`, `saveFieldCodeMapping`, `deleteFieldCodeMapping`
- Renders: top-bar + add-bar + status + fixed-layout CRUD table (structural twin of view-norm)

## view-ui-settings (UI Settings)
Entry: `ViewUiSettings.html` (147 lines; style 57–111)
- `App.html` → `SharedUtils.html` (**`UiPrefs`** does the work; persists via `saveUiPref`)
- Server: none called directly from this file
- Renders: nav-layout option cards with mini layout diagrams (`.uis-fig`), autohide toggle
