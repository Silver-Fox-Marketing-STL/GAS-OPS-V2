# Components — SilverFox V2

> **SUPERSEDED (July 2026).** The per-view button/pill/badge/table dialects
> described below were replaced by a single canonical, unscoped component layer
> — `.btn-primary/-secondary/-ghost/-danger`, `.pill`, `.tag` + `.tone-*`,
> `.table-u` — defined once in `SharedUtils.html` (SuperDesign "variant 1")
> and adopted by all 12 views (old dialect CSS deleted, not left alongside).
> See `docs/GAS_ShortCut_OPS_Bridge_System.md` → "Unified Component Layer" for
> the class table and the Encarta/Luna theme-coupling rule. This file is kept
> as the historical snapshot of the pre-unification state.

There are **no component files**. UI primitives exist as recurring CSS class + markup
patterns, each re-declared per view under its `#view-xxx` scope (pre-dating tokenization).
The only truly shared, single-definition primitives live in `SharedUtils.html`: the toast,
the custom select, the native `<select>` base, and the `.u-*` hierarchy utilities (all
included verbatim in `theme.md`'s SharedUtils dump — repeated here where they are primitives).

---

## Toast (`SharedUtils.html`) — transient feedback, used app-wide via `toast(msg, type)`

```css
#appToast {
  position: fixed; bottom: 18px; right: 18px; z-index: 2000;
  max-width: 420px; padding: 10px 16px; border-radius: var(--radius);
  font-family: var(--font-body); font-size: 12.5px; font-weight: 600;
  box-shadow: var(--shadow-lg); display: none; line-height: 1.5;
}
#appToast.info    { background: var(--info-weak);    color: var(--info);    border: 1px solid var(--info); }
#appToast.success { background: var(--success-weak); color: var(--success); border: 1px solid var(--success); }
#appToast.error   { background: var(--danger-weak);  color: var(--danger);  border: 1px solid var(--danger); }
```

```js
function toast(msg, type) { /* creates #appToast div lazily, shows 6s */ }
```

## Hierarchy utilities (`SharedUtils.html`)

```css
.u-h1 { font-family: var(--font-head); font-weight: 800; font-size: var(--fs-h1); color: var(--text); letter-spacing: -.01em; }
.u-h2 { font-family: var(--font-head); font-weight: 700; font-size: var(--fs-h2); color: var(--text); }
.u-h3 { font-family: var(--font-head); font-weight: 600; font-size: var(--fs-h3); color: var(--text); }
.u-overline { font-family: var(--font-head); font-weight: 700; font-size: var(--fs-overline); letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
.u-hint { font-size: var(--fs-hint); color: var(--text-3); }
```

## Custom Select (`SharedUtils.html`) — progressive enhancement of every native `<select>`

The Apps Script sandbox can't theme a native select's open list, so `CustomSelect.enhance()`
wraps each `<select>` in a `.cs-field` span with a `.cs-btn` button + fixed-position
`.cs-menu` listbox; the native select stays in the DOM as value holder / event source.

```css
.cs-field { position: relative; }
.cs-btn {
  width: 100%; box-sizing: border-box;
  display: flex; align-items: center; gap: 6px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-family: var(--font-body); font-size: 13px; font-weight: 600;
  padding: 8px !important; cursor: pointer; text-align: left;
}
.cs-btn:hover { border-color: var(--border-2); }
.cs-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cs-btn[aria-disabled="true"] { opacity: .55; cursor: default; }
.cs-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-caret { font-size: 9px; color: var(--text-3); flex-shrink: 0; }
.cs-menu {
  position: fixed; z-index: 70; margin: 0; padding: 4px !important; list-style: none;
  background: var(--surface); border: 1px solid var(--border-2);
  border-radius: var(--radius); box-shadow: var(--shadow-lg);
  max-height: 280px; overflow-y: auto;
}
.cs-menu[hidden] { display: none; }
.cs-menu li {
  padding: 11px 14px !important;
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 15px; font-weight: 600;
  color: var(--text); white-space: nowrap;
}
.cs-menu li:hover, .cs-menu li:focus { outline: none; background: var(--accent-weak); }
.cs-menu li[aria-selected="true"] { background: var(--accent); color: var(--on-accent); }
.cs-menu li[aria-disabled="true"] { opacity: .5; cursor: default; }
/* Native select base (pre-enhancement / fallback) */
select {
  font-family: var(--font-body); font-size: 13px; font-weight: 600;
  color: var(--text); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 8px; cursor: pointer;
}
select:hover { border-color: var(--border-2); }
select:focus-visible { outline: none; box-shadow: var(--focus-ring); }
```

Generated markup shape:

```html
<span class="cs-field" style="position:relative; ...">
  <select ...(visually hidden, value holder)...></select>
  <button type="button" class="cs-btn" aria-haspopup="listbox" aria-expanded="false">
    <span class="cs-label">Selected label</span><span class="cs-caret">&#9662;</span>
  </button>
  <ul class="cs-menu" role="listbox" hidden>
    <li role="option" data-i="0" aria-selected="true" tabindex="-1">Option A</li>
  </ul>
</span>
```

---

## Buttons

There is no single button component; each view defines its own set. The recurring
**three-variant grammar** is: solid accent primary / outlined-accent ghost / neutral bordered
secondary, plus danger/icon variants.

### Primary + secondary (ViewRun.html — the canonical pair)

```css
#view-run .btn-primary {
  padding: 10px 18px; background: var(--accent); color: var(--on-accent);
  border: none; font-size: 14px; font-weight: bold; cursor: pointer; border-radius: 4px;
}
#view-run .btn-primary:hover { background: var(--accent-hover); }
#view-run .btn-primary:disabled { background: var(--text-muted); cursor: default; }
#view-run .btn-secondary {
  padding: 10px 18px; background: var(--bg); color: var(--text-2);
  border: 1px solid var(--border-2); font-size: 13px; cursor: pointer; border-radius: 4px;
}
#view-run .btn-secondary:hover { background: var(--surface); }
```

### Accent-outline "ghost" button (ViewRun CAO / Drive-folder / retry pattern)

```css
#view-run #caoBtn {
  padding: 6px 12px; font-size: 12px; font-weight: bold;
  background: var(--bg); color: var(--accent); border: 1.5px solid var(--accent);
  border-radius: 4px; cursor: pointer; white-space: nowrap; width: auto; margin: 0;
}
#view-run #caoBtn:hover { background: var(--accent-weak); }
#view-run #caoBtn:disabled { background: var(--surface); color: var(--text-muted); border-color: var(--border-2); cursor: default; }
```

### Neutral utility button + danger variant (ViewUtilities.html)

```css
#view-utilities .util-btn {
  padding: 10px 16px; background: var(--bg); color: var(--text);
  border: 1px solid var(--border-2); border-radius: 5px;
  font-size: 12.5px; font-weight: bold; cursor: pointer;
}
#view-utilities .util-btn:hover:not(:disabled) { background: var(--surface-2); border-color: var(--text-3); }
#view-utilities .util-btn:disabled { opacity: 0.45; cursor: default; }
#view-utilities .util-btn.danger { border-color: var(--danger); color: var(--danger); }
#view-utilities .util-btn.danger:hover:not(:disabled) { background: var(--danger-weak); border-color: var(--danger); }
```

```html
<button class="util-btn" onclick="runUtility(this, 'fillScraperDateTime')">&#8635; Update Scraper Timestamp</button>
<button class="util-btn danger" onclick="confirmUtility(this, 'appEraseAllQRFolders', 'Clear the QR folders for ALL active dealers?')">&#129529; Clear QR Folders</button>
```

### Icon buttons in table rows (ViewNorm.html)

```css
#view-norm button {
  padding: 6px 13px; font-size: 12px; font-weight: bold;
  border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;
}
#view-norm .btn-primary         { background: var(--accent); color: var(--bg); }
#view-norm .btn-primary:hover   { background: var(--accent-hover); }
#view-norm .btn-secondary       { background: var(--bg); color: var(--text); border: 1px solid var(--border-2); }
#view-norm .btn-secondary:hover { background: var(--surface-2); }
#view-norm .btn-icon            { padding: 3px 8px; font-size: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px; color: var(--text-2); margin: 0 1px; }
#view-norm .btn-icon:hover      { background: var(--border); }
#view-norm .btn-icon.del        { background: var(--danger-weak); color: var(--danger); border-color: var(--danger); }
#view-norm .btn-icon.del:hover  { background: var(--danger); }
#view-norm .btn-icon.save       { background: var(--success-weak); color: var(--success); border-color: var(--success); }
#view-norm .btn-icon.save:hover { background: var(--success); }
#view-norm button:disabled      { opacity: 0.4; cursor: default; }
```

### Other per-view button dialects (same grammar, different literals)

```css
/* ViewDataSources */
#view-datasources .ds-btn { padding: 9px 18px; border-radius: 5px; font-size: 13px; font-weight: bold; cursor: pointer; border: 1px solid var(--border-2); background: var(--bg); color: var(--text); }
#view-datasources .ds-btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
#view-datasources .ds-btn.primary:disabled { background: var(--border-2); border-color: var(--border-2); cursor: default; }
#view-datasources .ds-btn.danger { border-color: var(--danger); color: var(--danger); background: var(--bg); }

/* ViewPipedriveSettings */
#view-pipedrive-settings .ps-btn-primary { padding: 8px 20px; background: var(--accent); color: var(--on-accent); border: none; font-size: 13px; font-weight: bold; cursor: pointer; border-radius: 4px; }
#view-pipedrive-settings .ps-btn-secondary { padding: 8px 16px; background: var(--bg); color: var(--text-2); border: 1px solid var(--border-2); font-size: 13px; cursor: pointer; border-radius: 4px; }
#view-pipedrive-settings .ps-btn-add, .ps-btn-ghost { padding: 5px 12px; background: var(--bg); border: 1px solid var(--accent); border-radius: 4px; font-size: 12px; color: var(--accent); cursor: pointer; font-weight: bold; }
#view-pipedrive-settings .ps-link { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 12px; font-weight: bold; padding: 2px 4px; text-decoration: underline; }

/* ViewEndOfMonth */
#view-end-of-month .eom-btn-primary { padding: 8px 16px; border: 1px solid var(--accent); border-radius: var(--radius-sm); background: var(--accent); color: #fff; cursor: pointer; font-weight: 600; }
#view-end-of-month .eom-btn-ghost { padding: 7px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text); cursor: pointer; }

/* ViewImport — note btn-secondary here is the ACCENT-OUTLINE style, not the neutral one */
#view-import .btn-primary { padding: 9px 22px; background: var(--accent); color: white; border: none; font-size: 13px; font-weight: bold; cursor: pointer; border-radius: 4px; white-space: nowrap; flex-shrink: 0; }
#view-import .btn-secondary { padding: 9px 18px; background: var(--bg); color: var(--accent); border: 1.5px solid var(--accent); font-size: 13px; font-weight: bold; cursor: pointer; border-radius: 4px; white-space: nowrap; flex-shrink: 0; }
```

---

## Pills (type/status)

Categorical vehicle-type pills; the type-* tokens are theme-independent. Two definitions:

### Clickable filter pills (ViewRules.html)

```css
#view-rules .pill-group { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 0; }
#view-rules .pill {
  padding: 5px 13px; border: 1.5px solid var(--border-2); border-radius: 20px;
  font-size: 12px; font-weight: bold; cursor: pointer;
  color: var(--text-2); background: var(--bg); transition: all 0.15s; user-select: none;
}
#view-rules .pill:hover { border-color: var(--accent); color: var(--accent); }
#view-rules .pill.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
#view-rules .pill.type-new.active   { background: var(--type-new);   border-color: var(--type-new);   color: var(--on-type); }
#view-rules .pill.type-po.active    { background: var(--type-po);    border-color: var(--type-po);    color: var(--on-type); }
#view-rules .pill.type-cpo.active   { background: var(--type-cpo);   border-color: var(--type-cpo);   color: var(--on-type); }
#view-rules .pill.type-cpoel.active { background: var(--type-cpoel); border-color: var(--type-cpoel); color: var(--on-type); }
```

### Read-only table pills (ViewRun.html)

```css
#view-run .pill {
  display: inline-block; padding: 2px 8px; font-size: 11px; font-weight: 600;
  border-radius: 10px; border: 1.5px solid var(--border-2);
  background: var(--surface-2); color: var(--text-2); line-height: 1.5;
}
#view-run .pill.type-new.active   { background: var(--type-new);   border-color: var(--type-new);   color: var(--on-type); }
/* ... same for type-po / type-cpo / type-cpoel */
```

### Status badges (ViewVinInbox.html + ViewEndOfMonth.html — 999px-radius chip dialect)

```css
#view-vin-inbox .vi-badge { font-size: var(--fs-hint); font-weight: 700; padding: 1px 8px; border-radius: 999px; }
#view-vin-inbox .vi-badge.ok    { background: var(--success-weak, #dcefe0); color: var(--success, #1c7a3a); }
#view-vin-inbox .vi-badge.bad   { background: var(--danger-weak, #f6dcdc);  color: var(--danger, #b3261e); }
#view-vin-inbox .vi-badge.draft { background: var(--warning-weak, #fbe7cf); color: var(--warning, #c87f00); }
#view-vin-inbox .vi-badge.wait  { background: var(--surface-3); color: var(--text-2); }

#view-end-of-month .eom-status { font-size: 10px; font-weight: 700; padding: 1px 8px; border-radius: 999px; margin-left: 6px; vertical-align: middle; }
#view-end-of-month .eom-status.gen  { background: var(--surface-3); color: var(--text-2); }
#view-end-of-month .eom-status.pub  { background: var(--success-weak, #dcefe0); color: var(--success, #1c7a3a); }
#view-end-of-month .eom-status.live { background: var(--info-weak, #e7eef7); color: var(--info, #2563a8); }
```

### Inline count/value pill (ViewRun `#vinLogStatusRow`, ViewVinLog `#latestOrderRow`)

```css
#view-vinlog #latestOrderRow span {
  display: inline-block; background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 10px; padding: 2px 9px; font-weight: bold; color: var(--text); margin-left: 4px;
}
```

---

## Cards

### Launcher card (ViewHome.html)

```css
#view-home .home-cards {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 260px));
  gap: 14px; margin-bottom: 28px;
}
#view-home .home-card {
  border: 1px solid var(--border); border-radius: 8px; padding: 16px;
  cursor: pointer; background: var(--bg);
  transition: box-shadow 0.12s, border-color 0.12s; user-select: none;
}
#view-home .home-card:hover { border-color: var(--accent); box-shadow: 0 1px 6px rgba(253,65,13,0.18); }
#view-home .card-icon { font-size: 20px; margin-bottom: 8px; color: var(--accent); font-weight: bold; }
#view-home .card-title { font-size: 14px; font-weight: bold; margin-bottom: 5px; }
#view-home .card-desc { font-size: 11.5px; color: var(--text-2); line-height: 1.5; }
```

```html
<div class="home-card" onclick="navTo('view-run')">
  <div class="card-icon">&#9654;</div>
  <div class="card-title">Run Order</div>
  <div class="card-desc">Run a dealer order — CAO pre-fill or manual VINs, QR codes, CSV output.</div>
</div>
```

### Settings/config surface card (ViewPipedriveSettings `.ps-card`, ViewRules `.filter-card`, ViewEndOfMonth `.eom-panel` — same recipe)

```css
#view-pipedrive-settings .ps-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 14px 16px; margin-bottom: 14px;
}
#view-pipedrive-settings .ps-section-label {
  font-family: var(--font-head); font-size: var(--fs-h3); font-weight: 700;
  color: var(--accent); margin-bottom: 10px;
}
#view-rules .filter-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; }
#view-end-of-month .eom-panel { margin-top: var(--space-4); padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
```

### Data card with thumbnail (ViewVinInbox.html)

```css
#view-vin-inbox .vi-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-3); }
#view-vin-inbox .vi-card { display: flex; gap: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3); }
#view-vin-inbox .vi-card.miss { border-color: var(--warning, #c87f00); }
#view-vin-inbox .vi-thumb { width: 92px; height: 92px; flex-shrink: 0; border-radius: var(--radius-sm); object-fit: cover; background: var(--surface-3); border: 1px solid var(--border); }
```

### Stateful workflow card (ViewRun finalize cards)

```css
#view-run .finalize-card {
  border: 1px solid var(--border); border-radius: 4px;
  padding: 10px 12px; margin-bottom: 8px; background: var(--surface);
}
#view-run .finalize-card.finalized { border-color: var(--success); background: var(--success-weak); }
#view-run .finalize-card.abandoned { opacity: 0.55; background: var(--surface-2); }
#view-run .finalize-card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
```

### Selectable option card (ViewUiSettings.html)

```css
#view-ui-settings .uis-card {
  width: 132px; padding: var(--space-3); cursor: pointer;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  transition: border-color .12s, background .12s;
}
#view-ui-settings .uis-card:hover { border-color: var(--border-2); background: var(--surface-2); }
#view-ui-settings .uis-card.active { border-color: var(--accent); background: var(--accent-weak); }
#view-ui-settings .uis-card.active .uis-card-title { color: var(--accent); }
```

---

## Data tables

Recurring recipe: `border-collapse: collapse`, uppercase 10–11px letter-spaced header,
sticky `thead` on `var(--surface-2)`, 1px `var(--border)` row dividers,
`font-variant-numeric: tabular-nums` for numeric columns.

### Dashboard table (ViewHome.html — sectioned, banner + zebra + totals row)

```css
#view-home .dash-section {
  font-size: 11.5px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px;
  color: var(--on-accent); background: var(--accent);
  padding: 7px 12px; border-radius: 4px 4px 0 0; margin-top: 18px;
}
#view-home .dash-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 4px; font-variant-numeric: tabular-nums; }
#view-home .dash-table td, #view-home .dash-table th { padding: 5px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
#view-home .dash-table tr.dash-hdr th { background: var(--bg); color: var(--text-3); font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; font-weight: bold; border-bottom: 1px solid var(--border); }
#view-home .dash-table tr:not(.dash-hdr):nth-child(even) td { background: var(--surface); }
#view-home .dash-table tr.dash-totals td { background: var(--text); color: var(--bg); font-weight: bold; }
```

### Scrolling data table with sticky header (ViewRun.html)

```css
#view-run .rv-table-scroll { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); }
#view-run #vinDataTable { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
#view-run #vinDataTable th { position: sticky; top: 0; background: var(--surface-2); color: var(--text-2);
  text-align: left; font-size: var(--fs-overline); text-transform: uppercase; letter-spacing: .03em;
  padding: 6px 8px; border-bottom: 1px solid var(--border); }
#view-run #vinDataTable td { padding: 5px 8px; border-bottom: 1px solid var(--border); color: var(--text); white-space: nowrap; }
#view-run #vinDataTable td.rv-vin { font-family: monospace; color: var(--text-2); }
#view-run #vinDataTable tr.rv-notfound td { color: var(--danger); background: var(--danger-weak); }
#view-run #vinDataTable tr.rv-empty-row td { color: var(--text-muted); text-align: center; padding: var(--space-4); }
```

### CRUD table with inline edit (ViewNorm.html; ViewFieldCodes near-identical)

```css
#view-norm table { width: 100%; border-collapse: collapse; font-size: 12px; }
#view-norm thead th {
  background: var(--surface-2); padding: 7px 12px; text-align: left;
  font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px;
  color: var(--text-2); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 1;
}
#view-norm tbody tr { border-bottom: 1px solid var(--border); }
#view-norm tbody tr:hover { background: var(--bg); }
#view-norm td { padding: 5px 12px; vertical-align: middle; }
#view-norm td.col-input  { font-family: monospace; color: var(--text); }
#view-norm td.col-output { font-family: monospace; font-weight: bold; color: var(--accent); }
#view-norm tr.editing td { background: var(--accent-weak); padding: 5px 8px; }
#view-norm .edit-input { width: 100%; padding: 4px 6px; font-size: 12px; font-family: monospace; border: 1px solid var(--accent); border-radius: 3px; }
#view-norm .state-row td { text-align: center; padding: 28px; color: var(--text-muted); font-size: 12px; }
```

### Mapping table (ViewDataSources.html — fixed layout, select cells)

```css
#view-datasources .ds-table { width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: fixed; }
#view-datasources .ds-table th { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-3); }
#view-datasources .ds-table td { padding: 5px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; word-break: break-word; }
#view-datasources .ds-table tr.ds-ignored td { background: var(--bg); color: var(--text-muted); }
#view-datasources .ds-table tr.ds-required-missing select { border-color: var(--danger); }
```

---

## Tabs (ViewRules.html — the only tab bar)

```css
#view-rules .rules-tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--border); flex-shrink: 0; }
#view-rules .rules-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 18px; border: 1px solid var(--border); border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: var(--bg); color: var(--text-2);
  font-family: var(--font-body); font-size: 13px; font-weight: 700;
  cursor: pointer; margin-bottom: -1px;
}
#view-rules .rules-tab:hover { color: var(--text); background: var(--surface); }
#view-rules .rules-tab.active { background: var(--surface); color: var(--accent); border-bottom: 2px solid var(--accent); }
#view-rules .rules-tab:focus-visible { outline: none; box-shadow: var(--focus-ring); }
#view-rules .rules-tab-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); flex-shrink: 0; }  /* unsaved-changes dot */
```

```html
<div class="rules-tabs app-measure" role="tablist">
  <button type="button" class="rules-tab active" id="rulesTabBtnFilter" ...>
    Filtering Rules <span class="rules-tab-dot" id="rulesTabDotFilter" hidden></span>
  </button>
  <button type="button" class="rules-tab" id="rulesTabBtnPipedrive" ...>
    Pipedrive <span class="rules-tab-dot" id="rulesTabDotPipedrive" hidden></span>
  </button>
</div>
```

---

## Toggle switch — two implementations

### ViewRules.html (36×20)

```css
#view-rules .toggle-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
#view-rules .toggle-switch { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
#view-rules .toggle-switch input { opacity: 0; width: 0; height: 0; }
#view-rules .toggle-slider { position: absolute; inset: 0; background: var(--border-2); border-radius: 20px; cursor: pointer; transition: background 0.2s; }
#view-rules .toggle-slider:before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--bg); border-radius: 50%; transition: transform 0.2s; }
#view-rules .toggle-switch input:checked + .toggle-slider { background: var(--accent); }
#view-rules .toggle-switch input:checked + .toggle-slider:before { transform: translateX(16px); }
#view-rules .toggle-label { font-size: 13px; color: var(--text); }
#view-rules .toggle-desc { font-size: 11px; color: var(--text-muted); margin-left: auto; }
```

### ViewUiSettings.html (40×22, ::before, focus-ring aware)

```css
#view-ui-settings .uis-slider {
  flex-shrink: 0; position: relative; width: 40px; height: 22px; margin-top: 2px;
  background: var(--surface-3); border: 1px solid var(--border-2); border-radius: 999px;
  transition: background .12s;
}
#view-ui-settings .uis-slider::before {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  background: var(--bg); border-radius: 50%; box-shadow: var(--shadow); transition: transform .12s;
}
#view-ui-settings .uis-toggle input:checked + .uis-slider { background: var(--accent); border-color: var(--accent); }
#view-ui-settings .uis-toggle input:checked + .uis-slider::before { transform: translateX(18px); }
#view-ui-settings .uis-toggle input:focus-visible + .uis-slider { box-shadow: var(--focus-ring); }
```

---

## Progress bar (ViewRun.html; ViewEndOfMonth mirrors it as `.eom-progress-*`)

```css
#view-run #progressSection { display: none; margin-bottom: var(--space-3); padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
#view-run #progressStep { font-size: 12px; color: var(--text); margin-bottom: 8px; min-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#view-run .progress-track { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
#view-run .progress-fill { height: 100%; background: var(--accent); border-radius: 3px; width: 0%; transition: width 0.5s ease, background 0.3s ease; }
#view-run .progress-fill.done { background: var(--success); }
#view-run .progress-fill.error { background: var(--danger); }
#view-run .progress-meta { display: flex; justify-content: space-between; margin-top: 5px; font-size: 11px; color: var(--text-3); }
```

---

## Inline status bar (per-view feedback line — Run/Norm/FieldCodes/Rules/DataSources all repeat it)

```css
#view-run #runStatus { font-size: 12px; min-height: 18px; padding: 6px 8px; border-radius: 4px; }
#view-run #runStatus.error   { background: var(--danger-weak);  color: var(--danger); }
#view-run #runStatus.success { background: var(--success-weak); color: var(--success); }
#view-run #runStatus.info    { background: var(--accent-weak);  color: var(--accent); }
#view-run #runStatus.empty   { background: none; color: var(--text-2); }
```

## Status strip pill (ViewHome.html — fresh/stale indicator)

```css
#view-home .home-status {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 14px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 16px; font-size: 12px; color: var(--text-2); margin-bottom: 22px;
}
#view-home .home-status .dot { color: var(--text-muted); font-size: 10px; }
#view-home .home-status.fresh .dot { color: var(--success); }
#view-home .home-status.stale .dot { color: var(--warning); }
```

```html
<div class="home-status" id="homeStatus">
  <span class="dot">&#9679;</span>
  <span id="homeStatusText">Loading dashboard&hellip;</span>
</div>
```

---

## Form fields

### Label-over-input column (add-bar dialect — ViewNorm/ViewFieldCodes)

```css
#view-norm .add-field { display: flex; flex-direction: column; gap: 3px; flex: 1; }
#view-norm .add-field label { font-size: 11px; font-weight: bold; color: var(--text-2); white-space: nowrap; }
#view-norm .add-field input[type="text"] {
  padding: 6px 8px; font-size: 12px; font-family: monospace;
  border: 1px solid var(--border-2); border-radius: 4px; width: 100%;
}
#view-norm .add-field input[type="text"]:focus { outline: none; border-color: var(--accent); }
```

### Block-label fields (ViewRun / ViewVinLog dialect)

```css
#view-run label { display: block; font-weight: bold; margin-bottom: 4px; margin-top: 14px; }
#view-run select, #view-run textarea, #view-run input[type="text"] {
  width: 100%; padding: 8px; font-size: 13px;
  border: 1px solid var(--border-2); border-radius: 4px;
  background: var(--bg); color: var(--text);
}
#view-run .field-hint { font-size: 11px; color: var(--text-3); margin-top: 3px; }
```

### EOM field dialect

```css
#view-end-of-month .eom-field label { display: block; font-size: var(--fs-sm); font-weight: 600; color: var(--text-2); margin-bottom: 4px; }
#view-end-of-month .eom-field select,
#view-end-of-month .eom-field input { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
```

### Uppercase overline label (ViewDataSources dialect)

```css
#view-datasources .ds-field label { font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-3); }
```

---

## Section label (overline) — repeated per view

```css
#view-home .home-section-label,   /* also .util-group-label, .ds-section */
#view-utilities .util-group-label {
  font-size: 11px; font-weight: bold; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--text-3); margin-bottom: 10px;
}
```

## "Modal" frame (ViewImport.html — header/body/footer skeleton retained from its dialog days)

```css
#view-import .modal-header { padding: 14px 18px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
#view-import .modal-header h3 { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
#view-import .modal-header .subtitle { font-size: 11px; color: var(--text-3); }
#view-import .modal-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
#view-import .modal-footer { border-top: 1px solid var(--border); padding: 10px 18px; flex-shrink: 0; display: flex; align-items: center; gap: 12px; }
```

Note: there is no true overlay modal component in the app; confirmations use native
`confirm()`. The one overlay-ish scrim usage is in ViewVinLog (`rgba(0,0,0,0.45)`).

## EOM report renderer (EomReportRenderer.html — self-contained fragment)

Collapsible `<details>` dealer cards with chips; every color is `var(--token, hexFallback)`
so it renders inside the app (themed) AND standalone in `eom-viewer/`. Prefix: `eomr-`.

```css
.eomr-report { color: var(--text, #1a2733); font: var(--fs-body, 13px)/1.45 var(--font-body, Arial, Helvetica, sans-serif); }
.eomr-contact { border: 1px solid var(--border, #dce4ec); border-radius: var(--radius, 8px); margin-bottom: 14px; background: var(--surface, #fff); overflow: hidden; }
.eomr-contact > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.eomr-contact > summary:hover { background: var(--surface-2, #f6f8fa); }
.eomr-contact[open] > summary { border-bottom: 2px solid var(--text, #1a3a5c); }
```
