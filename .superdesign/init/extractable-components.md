# Extractable Components — SilverFox V2

Catalog of recurring UI patterns extractable as SuperDesign DraftComponents. Full CSS/markup
for each lives in `components.md` (basics) and `layouts.md` (layout). Everything is
token-driven (`var(--…)` from SharedUtils) — extracted components should carry the token
block or inline the Light values.

## Layout components

### SidebarNav
- Source: `App.html` (`nav#sidebar`, CSS `#sidebar`, `.app-brand`, `.nav-item`, `.nav-group*`, `.nav-footer`)
- Category: layout
- Description: Left rail with logo brand, 7 top-level items (icon + label), collapsible
  "System Settings" group of 6 sub-items, theme picker, footer credit. Re-composes to
  right/top/bottom rail, icon rail, or start-menu panel via `data-shell`/`data-nav`.
- Extractable props: `activeItem` (view id, default "view-home"), `settingsGroupOpen`
  (boolean, default false), `pendingItems` (string[], dimmed items)
- Hardcoded: logo mask PNG data-URI, item icons (HTML entities), item labels, onclick wiring, all CSS

### AppHeader
- Source: `App.html` (`#appHeader`)
- Category: layout
- Description: 46px top bar: current view title left, small meta text right.
- Extractable props: `title` (string, default "Home"), `rightText` (string, default "")
- Hardcoded: heights/tokens, all CSS

### AppShell
- Source: `App.html` (`#appRoot` = sidebar + `#appMain` (header + content))
- Category: layout
- Description: Full app frame; content area hosts one visible `.view` at a time.
  `data-layout`/`.app-measure` width-caps content at 880/1280/1680px on wide screens.
- Extractable props: `activeView` (string), `navLayout` ("sidebar" | "top-rail" | "bottom-rail" | "start-menu")
- Hardcoded: all shell CSS, structural-axis rules

### StartBar
- Source: `App.html` (`#startBar`, `.start-btn`, `.start-clock`)
- Category: layout
- Description: Bottom taskbar with Start button + clock; nav becomes a pop-up panel.
  Used by the start-menu layout and forced on mobile.
- Extractable props: `menuOpen` (boolean, default false), `clockText` (string)
- Hardcoded: Start glyph, Luna XP gradient skin, all CSS

### ViewScaffold
- Source: every `View*.html` (root `.view` + `.*-scroll.app-measure` wrapper)
- Category: layout
- Description: Standard view container: full-height scroll pane with 20–26px padding,
  content measure-capped.
- Extractable props: `viewId` (string), `dataLayout` ("form" | "form-wide" | "data")
- Hardcoded: padding, overflow behavior

### TopBarAddBarTable
- Source: `ViewNorm.html` / `ViewFieldCodes.html` (`.top-bar`, `.add-bar`, `#xxStatus`, `.table-wrap`, `.footer`)
- Category: layout
- Description: CRUD-view skeleton: control bar, inline add-entry form bar, status line,
  sticky-header table, right-aligned footer actions. Duplicated verbatim across the two views.
- Extractable props: `title` (string), `count` (number), `statusText`/`statusType`
  ("empty" | "info" | "success" | "error")
- Hardcoded: field labels, column set, all CSS

## Basic components

### PrimaryButton / SecondaryButton / GhostButton
- Source: `ViewRun.html` `.btn-primary`/`.btn-secondary`, `#caoBtn` (accent-outline ghost)
- Category: basic
- Description: The app's 3-variant button grammar (solid accent / neutral bordered /
  accent outline). Six per-view dialects exist — Run's is the canonical spec.
- Extractable props: `label` (string), `disabled` (boolean, default false), `variant`
  ("primary" | "secondary" | "ghost" | "danger")
- Hardcoded: paddings, radius 4px, font sizes

### UtilityButton
- Source: `ViewUtilities.html` `.util-btn` (+ `.danger`)
- Category: basic
- Description: Neutral action chip with emoji-entity icon; danger variant outlined red.
- Extractable props: `label`, `danger` (boolean, default false), `disabled` (boolean)
- Hardcoded: icon entities, CSS

### TypePill
- Source: `ViewRules.html` `.pill` (clickable) and `ViewRun.html` `.pill` (read-only)
- Category: basic
- Description: Rounded vehicle-type pill; per-type saturated fill when active
  (`--type-new/po/cpo/cpoel`), outlined neutral when inactive.
- Extractable props: `label` (string), `type` ("new" | "po" | "cpo" | "cpoel" | ""),
  `active` (boolean, default false), `interactive` (boolean — Rules vs Run sizing)
- Hardcoded: type→color token mapping, radius, CSS

### StatusBadge
- Source: `ViewVinInbox.html` `.vi-badge`, `ViewEndOfMonth.html` `.eom-status`
- Category: basic
- Description: Tiny 999px-radius weak-tint chip (ok/bad/draft/wait; gen/pub/live).
- Extractable props: `label` (string), `tone` ("success" | "danger" | "warning" | "info" | "neutral")
- Hardcoded: tint token pairs, CSS

### StatusStrip
- Source: `ViewHome.html` `.home-status`
- Category: basic
- Description: Inline pill with colored dot — freshness indicator ("Last scraper import: …").
- Extractable props: `text` (string), `state` ("fresh" | "stale" | "", default "")
- Hardcoded: dot glyph, CSS

### LauncherCard
- Source: `ViewHome.html` `.home-card` (in `.home-cards` grid)
- Category: basic
- Description: Clickable workflow card: accent icon, bold title, hint desc; accent border +
  glow on hover. Becomes a desktop icon under `data-arrange="desktop"`.
- Extractable props: `icon` (entity string), `title`, `description`, `targetView` (string)
- Hardcoded: grid sizing, hover shadow, CSS

### SettingsCard
- Source: `ViewPipedriveSettings.html` `.ps-card` + `.ps-section-label` (twins: `ViewRules.html`
  `.filter-card`, `ViewEndOfMonth.html` `.eom-panel`)
- Category: basic
- Description: Surface-tinted bordered section card with accent heading.
- Extractable props: `title` (string), `children`
- Hardcoded: padding/radius/margin, CSS

### OptionCard
- Source: `ViewUiSettings.html` `.uis-card` (+ `.uis-fig` mini-diagram)
- Category: basic
- Description: Selectable radio-style card with figure, title, hint; accent-weak fill when active.
- Extractable props: `active` (boolean, default false), `title`, `description`, `value` (string)
- Hardcoded: figure diagrams, 132px width, CSS

### DataTable
- Source: `ViewRun.html` `#vinDataTable` + `.rv-table-scroll`; siblings `ViewHome.html`
  `.dash-table`, `ViewNorm.html` table, `ViewDataSources.html` `.ds-table`
- Category: basic
- Description: Collapse-border table, sticky uppercase header on `--surface-2`, hairline row
  dividers, tabular numerals, semantic row states (`.rv-notfound`, `.dash-totals`,
  `.ds-ignored`, `.editing`).
- Extractable props: `columns` (string[]), `rows`, `emptyText` (string)
- Hardcoded: cell padding/typography, state classes, CSS

### SectionedDashboard
- Source: `ViewHome.html` `.dash-section` + `.dash-table`
- Category: basic
- Description: Accent banner header followed by a zebra table; TOTALS row inverts to
  text-on-bg. Rendered from sheet data by `renderDashboardRows_`.
- Extractable props: `sections` ({ title, headers, rows }[])
- Hardcoded: banner style, zebra/totals rules, CSS

### TabBar
- Source: `ViewRules.html` `.rules-tabs` / `.rules-tab` / `.rules-tab-dot`
- Category: basic
- Description: Folder-style tabs seated on a border line; active tab gets accent text +
  accent bottom border; warning dot signals unsaved changes.
- Extractable props: `tabs` (string[]), `activeIndex` (number, default 0),
  `dirtyFlags` (boolean[], default all false)
- Hardcoded: tab shape/radius, CSS

### ToggleSwitch
- Source: `ViewUiSettings.html` `.uis-toggle`/`.uis-slider` (newer) and `ViewRules.html`
  `.toggle-switch`/`.toggle-slider` (older)
- Category: basic
- Description: iOS-style switch; accent track when checked. Two slightly different sizes exist.
- Extractable props: `checked` (boolean, default false), `label`, `description` (string)
- Hardcoded: dimensions, transition, CSS

### ProgressBar
- Source: `ViewRun.html` `.progress-track`/`.progress-fill` (mirrored `ViewEndOfMonth.html` `.eom-progress-*`)
- Category: basic
- Description: 6px rounded track with animated accent fill; done→success, error→danger;
  step text above, meta row (label + percent) below.
- Extractable props: `percent` (number 0–100), `state` ("running" | "done" | "error"),
  `stepText` (string)
- Hardcoded: bar height/radius, transitions, CSS

### InlineStatusBar
- Source: `ViewRun.html` `#runStatus` (repeated: `#normStatus`, `#fcStatus`, `#rulesStatus`, `.ds-status`)
- Category: basic
- Description: One-line feedback strip with weak-tint background per severity.
- Extractable props: `text` (string), `type` ("empty" | "info" | "success" | "error")
- Hardcoded: sizing, tint token pairs, CSS

### Toast
- Source: `SharedUtils.html` `#appToast` + `toast()`
- Category: basic
- Description: Fixed bottom-right transient notification (info/success/error), auto-hides 6s.
- Extractable props: `message` (string), `type` ("info" | "success" | "error")
- Hardcoded: position, timing, CSS

### CustomSelect
- Source: `SharedUtils.html` `.cs-field`/`.cs-btn`/`.cs-menu` (+ `CustomSelect` JS)
- Category: basic
- Description: Themed dropdown replacing native select popups (unthemeable in the GAS
  sandbox); button + fixed-position listbox, keyboard accessible.
- Extractable props: `options` (string[]), `selectedIndex` (number), `disabled` (boolean),
  `label` (string, aria)
- Hardcoded: sizing, open-list typography, CSS

### ThemePicker
- Source: `App.html` `.nav-theme`/`.theme-btn`/`.theme-menu` (+ `Theme` registry in SharedUtils)
- Category: basic
- Description: Sidebar dropdown listing the 10 registered themes; opens upward.
- Extractable props: `currentTheme` (string, default "light"), `open` (boolean, default false)
- Hardcoded: theme list, CSS

### VinCard
- Source: `ViewVinInbox.html` `.vi-card`
- Category: basic
- Description: Photo thumbnail + monospace VIN + status badges + vehicle/meta lines +
  action row (correct VIN input, Processed/Discard buttons).
- Extractable props: `vin`, `imageUrl`, `badges` (tone+label[]), `vehicleText`, `metaText`,
  `miss` (boolean — warning border)
- Hardcoded: 92px thumb, layout, CSS

### FinalizeCard
- Source: `ViewRun.html` `.finalize-card` (+ `.card-methods`, `.card-push`)
- Category: basic
- Description: Per-run-log-entry workflow card: title/count head, method radios
  (New Deal / Existing / Test), order-id input, Finalize/Abandon actions, then an embedded
  Pipedrive-push sub-block. State classes: `.finalized` (success tint), `.abandoned` (dimmed).
- Extractable props: `title`, `count`, `state` ("pending" | "finalized" | "abandoned"),
  `statusText`, `statusTone`
- Hardcoded: radio labels, sub-block layout, CSS

### ModalFrame
- Source: `ViewImport.html` `.modal-header`/`.modal-body`/`.modal-footer`
- Category: basic
- Description: Header (h3 + subtitle) / scrolling body / bordered footer-with-actions column
  skeleton — the in-page descendant of the old dialog chrome.
- Extractable props: `title`, `subtitle` (strings)
- Hardcoded: paddings/borders, CSS

### EomReportCard
- Source: `EomReportRenderer.html` `.eomr-contact` et al.
- Category: basic
- Description: Collapsible `<details>` dealer card with summary chips (orders / duplicates /
  total) expanding to product summary + per-deal sub-details. Self-contained with hex
  fallbacks (also used standalone in `eom-viewer/`).
- Extractable props: `dealerName`, `chips` (label+value[]), `open` (boolean, default false)
- Hardcoded: chip styles, fallback palette, CSS
