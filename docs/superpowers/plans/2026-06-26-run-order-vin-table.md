# Run Order live VIN table + Transcription retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Run Order screen's empty right-hand space with a live, dealer-scoped inventory table that fills in as VINs are typed, and retire the now-redundant Transcription page.

**Architecture:** A new backend `getDealerVinData(dealerKey)` returns the selected dealer's inventory as a VIN→data map (loaded once per dealer, looked up client-side as you type — mirroring the old Transcription index pattern). `ViewRun.html` is rearranged into Option B (top control bar + narrow VIN box + data table + a reserved right rail that holds the existing run-flow elements). This is **mostly a markup rearrangement that preserves every element id**, so the existing run/CAO/finalize JS is untouched; the table + lookup are additive.

**Tech Stack:** Google Apps Script (`Code.gs`), HtmlService SPA (`App.html` + `View*.html` fragments), CSS custom-property theming. No build step, no test framework.

## Global Constraints

- **Theming (first-class):** every color/border/radius/shadow/spacing/font in new markup uses `var(--…)` — NO hardcoded hex/px. Reuse already-themed primitives (`.pill`/`.type-*`, native `<select>`, `<button>`). New classes that a structural theme must restyle get explicit coverage (especially Encarta's `:root[data-theme="encarta"]` `!important` block in `App.html`). Must reskin under all 8 themes: light, dark, dark-dense, top-rail, top-rail-dark, midnight, cyberpunk, encarta.
- **No verification framework exists.** Per-task verification = `node --check` on the extracted `<script>` (syntax), a `<div>`/`</div>` balance check, a cross-fragment top-level `function`-name collision grep, ad-hoc `node` snippets for pure helpers, and a manual `clasp push` + in-app eyeball. GAS code cannot run locally.
- **Preserve element ids** when relocating existing controls/run-flow elements — the run/CAO/finalize/commit JS references them by id (`#userSelect`, `#runDealerSelect`, `#dealId`, `#splitDealRow`, `#bypassFilters`, `#caoBtn`, `#runBtn`, `#cancelBtn`, `#caoSummary`, `#progressSection`, `#postRunActions`, `#driveFolderBtn`, `#finalizeCards`, `#vinLogBtn`, `#runStatus`, `#vinInput`, `#runVinCount`, `#vinLogStatusRow`).
- **Shared global JS scope:** all view fragments concatenate into one window. Prefix new top-level functions to avoid collisions (use a `rv` prefix — "run vin"). Scope all new CSS to `#view-run`.
- **SCRAPERDATA column indices (0-based):** VIN=0, Stock=1, Type=2, Year=3, Make=4, Model=5, Status=8.
- **Commit after every task.** Branch: `feature/run-order-vin-table`. End git commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Do NOT `clasp push` (the user deploys).

---

### Task 1: Backend — `getDealerVinData(dealerKey)` + pure `buildVinDataMap_`

**Files:**
- Modify: `Code.gs` (add two functions near the other dealer-data helpers, e.g. after `getDealerScraperData_` ~line 1300+)

**Interfaces:**
- Consumes: existing `getDealerConfig_(dealerKey)` (returns the dealer's config row array; `CFG.SCRAPER_LOCATION = 9`), existing `getDealerScraperData_(scraperLocationName)` (returns an array of the dealer's SCRAPERDATA rows, full width).
- Produces:
  - `buildVinDataMap_(rows)` → `{ "<VIN-UPPER-TRIM>": { year, make, model, type, stock, status } }` (pure; skips rows whose VIN cell is blank/`*`).
  - `getDealerVinData(dealerKey)` → the same map object (client-callable). Returns `{}` on any error or unknown dealer (fail-safe).

- [ ] **Step 1: Write a pure helper unit-test snippet**

Create a throwaway test in the scratch dir and verify the projection logic. Write `C:/Users/NICK_W~1/AppData/Local/Temp/claude/c--Users-Nick-Workstation-Documents-SilverFox-V2/3a880670-bd1f-4874-87eb-8d496878f252/scratchpad/test-vinmap.js`:

```javascript
// Paste-in copy of buildVinDataMap_ for isolated testing (no GAS deps).
function buildVinDataMap_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var vin = String(r[0] == null ? '' : r[0]).trim();
    if (vin === '' || vin === '*') continue;
    map[vin.toUpperCase()] = {
      year:   String(r[3] == null ? '' : r[3]).trim(),
      make:   String(r[4] == null ? '' : r[4]).trim(),
      model:  String(r[5] == null ? '' : r[5]).trim(),
      type:   String(r[2] == null ? '' : r[2]).trim(),
      stock:  String(r[1] == null ? '' : r[1]).trim(),
      status: String(r[8] == null ? '' : r[8]).trim()
    };
  }
  return map;
}

var rows = [
  ['7FARW2H90NE035008','262617A','New',2024,'Honda','CR-V','LX','Black','ONLOT'],
  ['','*','New',2024,'X','Y','Z','W','ONLOT'],            // blank VIN → skipped
  ['1hgcv1f30la012345','261070L','PO',2020,'Honda','Civic','EX','Blue','OFFLOT']
];
var m = buildVinDataMap_(rows);
var ok =
  Object.keys(m).length === 2 &&
  m['7FARW2H90NE035008'].year === '2024' &&
  m['7FARW2H90NE035008'].type === 'New' &&
  m['7FARW2H90NE035008'].stock === '262617A' &&
  m['7FARW2H90NE035008'].status === 'ONLOT' &&
  m['1HGCV1F30LA012345'].make === 'Honda';      // key uppercased
console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(m['7FARW2H90NE035008']));
```

- [ ] **Step 2: Run it — expect FAIL until the real code matches, then PASS**

Run: `node "C:/Users/NICK_W~1/AppData/Local/Temp/claude/c--Users-Nick-Workstation-Documents-SilverFox-V2/3a880670-bd1f-4874-87eb-8d496878f252/scratchpad/test-vinmap.js"`
Expected: `PASS {"year":"2024",...}`

- [ ] **Step 3: Add the two functions to `Code.gs`**

```javascript
/**
 * Pure: projects SCRAPERDATA rows → a VIN-keyed map of the 7 display fields.
 * Skips rows with a blank/`*` VIN. Keys are upper-cased + trimmed VINs.
 */
function buildVinDataMap_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var vin = String(r[0] == null ? '' : r[0]).trim();
    if (vin === '' || vin === '*') continue;
    map[vin.toUpperCase()] = {
      year:   String(r[3] == null ? '' : r[3]).trim(),
      make:   String(r[4] == null ? '' : r[4]).trim(),
      model:  String(r[5] == null ? '' : r[5]).trim(),
      type:   String(r[2] == null ? '' : r[2]).trim(),
      stock:  String(r[1] == null ? '' : r[1]).trim(),
      status: String(r[8] == null ? '' : r[8]).trim()
    };
  }
  return map;
}

/**
 * Client-callable. Returns the selected dealer's inventory as a VIN→data map
 * for the Run Order live table. Fail-safe: returns {} on any error / unknown
 * dealer (the table then shows entered VINs as "not found" rather than break).
 */
function getDealerVinData(dealerKey) {
  try {
    var config = getDealerConfig_(dealerKey);
    if (!config) return {};
    var loc = config[CFG.SCRAPER_LOCATION];
    if (!loc) return {};
    var rows = getDealerScraperData_(loc) || [];
    return buildVinDataMap_(rows);
  } catch (e) {
    Logger.log('getDealerVinData failed for ' + dealerKey + ': ' + e.message);
    return {};
  }
}
```

- [ ] **Step 4: Re-run the snippet against the real implementation**

Copy the real `buildVinDataMap_` over the test copy's body (they should be identical) and re-run Step 2's command. Expected: `PASS`.

- [ ] **Step 5: Syntax-gate `Code.gs`**

Run: `cp Code.gs /tmp/c.js && node --check /tmp/c.js && echo OK`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add Code.gs
git commit -m "feat(run): getDealerVinData — dealer-scoped VIN→data map for the Run Order table"
```

---

### Task 2: Run Order layout — top bar + 3-zone body (markup + CSS), preserve ids

**Files:**
- Modify: `ViewRun.html` (the markup block lines 1–103, and add a CSS block scoped to `#view-run`; remove `#fillTrBtn` markup + `fillFromTranscription()` JS at ~605)

**Interfaces:**
- Produces (DOM the next task targets): `#vinDataTable` (the `<table>`), `#vinDataBody` (its `<tbody>`), `#vinMatchCount` (the found/not-found strip), and the zone containers `.rv-topbar`, `.rv-body`, `.rv-vinzone`, `.rv-tablezone`, `.rv-rail`.
- Consumes: all existing control + run-flow elements (moved, ids preserved).

- [ ] **Step 1: Rearrange the markup into Option B**

Replace the `<div class="layout app-measure">…</div>` body (lines 4–102) with the structure below. **Move the existing elements into these zones unchanged — keep every id, attribute, and inline `onclick`.** Set the view root's `data-layout` to `data` (table-centric) — change line 1 to `<div class="view" id="view-run" data-layout="data" hidden>`.

```html
  <div class="rv-wrap app-measure">

    <!-- TOP BAR: setup controls (primary row) + secondary row -->
    <div class="rv-topbar">
      <div class="rv-topbar-main">
        <!-- MOVE here, unchanged: .user-select-wrap (#userSelect),
             the Dealer label + #runDealerSelect,
             the Deal ID label + #dealId, #splitDealRow,
             the .bypass-label (#bypassFilters),
             #caoBtn (Pre-fill from CAO), #runBtn (Run Dealer), #cancelBtn -->
      </div>
      <div class="rv-topbar-sub">
        <!-- MOVE here, unchanged: #vinLogStatusRow (the "Most recent order" note + Update VIN Log button) -->
      </div>
    </div>

    <!-- BODY: VIN box | data table | reserved rail -->
    <div class="rv-body">

      <div class="rv-vinzone">
        <label for="vinInput">VINs / Stock Numbers</label>
        <!-- MOVE here, unchanged: #vinInput, #runVinCount -->
        <div class="rv-matchcount" id="vinMatchCount"></div>
      </div>

      <div class="rv-tablezone">
        <div class="rv-zone-label">Inventory match</div>
        <div class="rv-table-scroll">
          <table id="vinDataTable">
            <thead>
              <tr>
                <th>Year</th><th>Make</th><th>Model</th><th>Type</th>
                <th>Stock</th><th>VIN</th><th>Status</th>
              </tr>
            </thead>
            <tbody id="vinDataBody">
              <tr class="rv-empty-row"><td colspan="7">Select a dealer, then enter VINs to check them.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="rv-rail">
        <!-- MOVE here, unchanged (they stack; existing JS toggles their display):
             #caoSummary, #progressSection, #postRunActions, #runStatus -->
        <div class="rv-rail-hint" id="rvRailHint">Pre-fill from CAO or paste VINs, then Run.</div>
      </div>

    </div>
  </div>
```

Delete the old `.cao-row` containing `#fillTrBtn` (the "Fill from Transcription" button). Keep `#caoBtn` (moved to the top bar).

- [ ] **Step 2: Remove the dead `fillFromTranscription()` function**

In `ViewRun.html` delete the entire `function fillFromTranscription() { … }` (~line 605) and any reference to `#fillTrBtn`. (The Transcription view itself is removed in Task 5.)

- [ ] **Step 3: Add the layout CSS (tokens-only) inside `#view-run`'s `<style>`**

```css
    #view-run .rv-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: var(--space-3); padding: var(--space-3); }
    #view-run .rv-topbar { display: flex; flex-direction: column; gap: var(--space-2); }
    #view-run .rv-topbar-main { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    #view-run .rv-topbar-sub  { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); font-size: var(--fs-sm); color: var(--text-2); }
    #view-run .rv-body { display: flex; gap: var(--space-3); flex: 1; min-height: 0; }
    #view-run .rv-vinzone { flex: 0 0 250px; display: flex; flex-direction: column; min-height: 0; }
    #view-run .rv-tablezone { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
    #view-run .rv-rail { flex: 0 0 280px; display: flex; flex-direction: column; min-height: 0; overflow-y: auto;
                         border-left: 1px solid var(--border); padding-left: var(--space-3); }
    #view-run .rv-zone-label { font-size: var(--fs-overline); text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); margin-bottom: var(--space-2); }
    #view-run .rv-matchcount { font-size: var(--fs-sm); color: var(--text-2); margin-top: var(--space-2); }
    #view-run .rv-rail-hint { font-size: var(--fs-sm); color: var(--text-muted); padding: var(--space-2) 0; }

    /* Data table — token-bound, tabular figures, like the dash/runs tables */
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

Make `#vinInput` shrink to fill the `.rv-vinzone` height: ensure its existing CSS uses `flex: 1; min-height: 0; width: 100%`. (The narrowing comes from the 250px zone.)

- [ ] **Step 4: Syntax + structure gates**

```bash
awk '/<script>/{f=1;next} /<\/script>/{f=0} f' ViewRun.html > /tmp/vr.js && node --check /tmp/vr.js && echo "JS OK"
o=$(grep -oE '<div\b' ViewRun.html | wc -l); c=$(grep -oE '</div>' ViewRun.html | wc -l); echo "divs $o/$c"
grep -rhoE 'function (rv[A-Za-z0-9_]+|fillFromTranscription)' *.html | sort | uniq -d   # expect empty
```
Expected: `JS OK`; div counts equal; no duplicate function names; no remaining `fillFromTranscription`.

- [ ] **Step 5: Manual check (note for the deploy pass, not blocking the commit)**

After `clasp push`: open Run Order. The controls sit in the top bar; the VIN box is narrow on the left; an empty placeholder table is centered; the CAO/progress/finalization elements live in the right rail. **Verify the existing flows still work**: select dealer (VIN-log note updates), Pre-fill from CAO (summary fills in the rail), Run, finalize cards appear in the rail, Add to VIN Log. (The table is wired in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add ViewRun.html
git commit -m "feat(run): rearrange Run Order into top-bar + VIN box + table + reserved rail (ids preserved)"
```

---

### Task 3: The live VIN table — dealer-data load + debounced lookup + render

**Files:**
- Modify: `ViewRun.html` (`<script>`: add the cache + loader + render; extend the `#runDealerSelect` change handler at ~line 532; add a debounced `#vinInput` listener)

**Interfaces:**
- Consumes: `getDealerVinData(dealerKey)` (Task 1); DOM `#vinInput`, `#vinDataBody`, `#vinMatchCount` (Task 2); global `escHtml()` (SharedUtils).
- Produces: `rvLoadDealerData(dealerKey)`, `rvRenderTable()`, module var `rvVinData` (`{ dealerKey, map }`).

- [ ] **Step 1: Add the cache, loader, and render function (`<script>`)**

```javascript
    // ── Run Order live VIN table ──────────────────────────────────────────────
    var rvVinData = { dealerKey: '', map: {} };
    var rvDebounce = null;

    function rvLoadDealerData(dealerKey) {
      rvVinData = { dealerKey: dealerKey, map: {} };   // clear immediately
      rvRenderTable();
      if (!dealerKey) return;
      google.script.run
        .withSuccessHandler(function(map) {
          // ignore a stale response if the dealer changed again
          if (document.getElementById('runDealerSelect').value !== dealerKey) return;
          rvVinData = { dealerKey: dealerKey, map: map || {} };
          rvRenderTable();
        })
        .withFailureHandler(function() { /* fail-safe: leave empty → all not-found */ })
        .getDealerVinData(dealerKey);
    }

    function rvRenderTable() {
      var body = document.getElementById('vinDataBody');
      var countEl = document.getElementById('vinMatchCount');
      if (!body) return;
      var raw = (document.getElementById('vinInput').value || '').split(/\r?\n/);
      var lines = [];
      for (var i = 0; i < raw.length; i++) { var v = raw[i].trim(); if (v) lines.push(v); }

      if (!lines.length) {
        body.innerHTML = '<tr class="rv-empty-row"><td colspan="7">' +
          (rvVinData.dealerKey ? 'Enter VINs to check them against this dealer.' : 'Select a dealer, then enter VINs to check them.') +
          '</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }

      var html = '', found = 0;
      for (var j = 0; j < lines.length; j++) {
        var key = lines[j].toUpperCase();
        var d = rvVinData.map[key];
        if (d) {
          found++;
          html += '<tr>' +
            '<td>' + escHtml(d.year)  + '</td>' +
            '<td>' + escHtml(d.make)  + '</td>' +
            '<td>' + escHtml(d.model) + '</td>' +
            '<td>' + rvTypePill(d.type) + '</td>' +
            '<td>' + escHtml(d.stock) + '</td>' +
            '<td class="rv-vin">' + escHtml(lines[j]) + '</td>' +
            '<td>' + escHtml(d.status) + '</td>' +
          '</tr>';
        } else {
          html += '<tr class="rv-notfound">' +
            '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>' +
            '<td class="rv-vin">' + escHtml(lines[j]) + '</td>' +
            '<td>⚠ not in this dealer</td>' +
          '</tr>';
        }
      }
      body.innerHTML = html;
      if (countEl) countEl.textContent = lines.length + ' VINs · ' + found + ' found · ' + (lines.length - found) + ' not found';
    }

    // Reuse the themed type-pill classes (.pill + .type-*) so it themes everywhere.
    function rvTypePill(type) {
      var t = String(type || '').trim();
      var cls = t.toUpperCase() === 'NEW' ? 'type-new'
              : t.toUpperCase() === 'PO'  ? 'type-po'
              : t.toUpperCase() === 'CPO' ? 'type-cpo'
              : t.toUpperCase() === 'CPO-EL' ? 'type-cpoel' : '';
      if (!t) return '';
      return '<span class="pill ' + cls + ' active" style="cursor:default">' + escHtml(t) + '</span>';
    }
```

- [ ] **Step 2: Hook the dealer-change handler + add the debounced VIN listener**

In the existing `#runDealerSelect` change listener (ViewRun.html ~line 532), **add a call** to `rvLoadDealerData(this.value)` (keep all existing logic in that handler). Then add, near the other listener registrations (e.g. by the `#vinInput` input listener at ~line 529):

```javascript
    document.getElementById('vinInput').addEventListener('input', function() {
      if (rvDebounce) clearTimeout(rvDebounce);
      rvDebounce = setTimeout(rvRenderTable, 250);
    });
```

- [ ] **Step 3: Syntax + collision gates**

```bash
awk '/<script>/{f=1;next} /<\/script>/{f=0} f' ViewRun.html > /tmp/vr.js && node --check /tmp/vr.js && echo "JS OK"
grep -rhoE 'function (rv[A-Za-z0-9_]+)' *.html | sort | uniq -d   # expect empty (no collisions)
```
Expected: `JS OK`, no dup `rv*` names.

- [ ] **Step 4: Manual behavior check (deploy pass)**

After `clasp push`: select a dealer → paste/type that dealer's VINs → rows fill with year/make/model/type-pill/stock/vin/status; a wrong/unknown VIN → red "not in this dealer" row; the count strip reads "N VINs · X found · Y not found"; typing is smooth (debounced); switching dealers re-loads and re-renders. CAO pre-fill (which fills `#vinInput`) also populates the table.

- [ ] **Step 5: Commit**

```bash
git add ViewRun.html
git commit -m "feat(run): live dealer-scoped VIN table (debounced client-side lookup, not-found rows)"
```

---

### Task 4: Theme coverage + 8-theme sweep

**Files:**
- Modify: `App.html` (extend the `:root[data-theme="encarta"]` `!important` component-override block to cover the new Run Order table/rail/top-bar)

**Interfaces:**
- Consumes: the new classes from Task 2 (`.rv-topbar`, `.rv-rail`, `#vinDataTable`).

- [ ] **Step 1: Add Encarta coverage for the new elements**

In the Encarta component-override block in `App.html`, add (tokens/explicit Win95 values consistent with the existing block):

```css
    /* Encarta — Run Order table + rail as Win95 panels */
    :root[data-theme="encarta"] #view-run .rv-table-scroll { border: 2px inset #dfdfdf !important; }
    :root[data-theme="encarta"] #view-run #vinDataTable th { background: var(--surface) !important; }
    :root[data-theme="encarta"] #view-run .rv-rail { border-left: 2px inset #dfdfdf !important; }
```

(The top bar's controls are `<button>`/`<select>`/`.pill` which the existing Encarta rules + CustomSelect already cover; no extra rule needed.)

- [ ] **Step 2: Syntax + div-balance gate on App.html**

```bash
o=$(grep -oE '<div\b' App.html | wc -l); c=$(grep -oE '</div>' App.html | wc -l); echo "divs $o/$c"   # equal
awk '/<style>/{s=1} /<\/style>/{s=0} END{print}' App.html >/dev/null; echo "css block intact"
```

- [ ] **Step 3: Manual 8-theme sweep (deploy pass — the Global-Constraint requirement)**

After `clasp push`, open Run Order under **each** theme — light, dark, dark-dense, top-rail, top-rail-dark, midnight, cyberpunk, encarta — in each state (idle, after CAO pre-fill, during run, after run). Confirm: all colors come from tokens (no stray light element in dark themes); the type pills + dropdowns + buttons are themed; the table header/borders read correctly; Encarta shows sharp/beveled table + rail; top-rail/dark-dense/cyberpunk don't clip or misplace the view; the reserved rail keeps the table stable.

- [ ] **Step 4: Commit**

```bash
git add App.html
git commit -m "style(run): Encarta coverage for the new Run Order table + rail; verified across 8 themes"
```

---

### Task 5: Retire the Transcription page

**Files:**
- Delete: `ViewTranscription.html`
- Modify: `App.html` (nav item, include, `NAV_TITLES`, `markPendingViews`, the System-Settings comment), `Code.gs` (`getTranscriptionVins`)

**Interfaces:** none produced; removes `getTranscriptionVins` and the `view-transcription` view.

- [ ] **Step 1: Remove the App.html references**

Delete these from `App.html` (verify exact lines, they may shift):
- The nav item (`~435–437`): `<div class="nav-item" id="nav-view-transcription" …> … Transcription </div>`
- The include (`~496`): `<?!= include_('ViewTranscription') ?>`
- The `NAV_TITLES` entry (`~512`): `'view-transcription': 'Transcription',`
- The `'view-transcription'` element of the `markPendingViews` ids array (`~568`).
- The word "Transcription" in the System-Settings group comment (`~398`) if it lists nav members.

- [ ] **Step 2: Delete the view fragment + the backend function**

```bash
git rm ViewTranscription.html
```
In `Code.gs`, delete the entire `function getTranscriptionVins() { … }` (~line 464). Then grep for any other reference (`getAppBootstrap`, `VIEW_INITS`, `VIEW_SHOWN` keyed on transcription) and remove those too.

- [ ] **Step 3: Verify nothing references the removed symbols**

```bash
grep -rniE "transcription|getTranscriptionVins|view-transcription|fillFromTranscription" *.gs *.html
```
Expected: **no matches** (except possibly the CHANGELOG/spec/plan docs, which are fine).

- [ ] **Step 4: Syntax + div-balance gates**

```bash
cp Code.gs /tmp/c.js && node --check /tmp/c.js && echo "gs OK"
o=$(grep -oE '<div\b' App.html | wc -l); c=$(grep -oE '</div>' App.html | wc -l); echo "App divs $o/$c"
```
Expected: `gs OK`; App.html divs equal.

- [ ] **Step 5: Manual check (deploy pass)**

After `clasp push`: the Transcription nav item is gone; navigating the app works; Run Order is unaffected; no console errors about missing `getTranscriptionVins` / `view-transcription`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: retire the Transcription page (subsumed by the Run Order live VIN table)"
```

---

### Task 6: CHANGELOG + docs

**Files:**
- Modify: `CHANGELOG.md` (an `[Unreleased]` entry); `docs/GAS_ShortCut_OPS_Bridge_System.md` (Run Order / Transcription sections), per the project's "changelog travels with code" rule.

- [ ] **Step 1: Add a CHANGELOG `### Added`/`### Changed`/`### Removed` entry** describing the live VIN table (dealer-scoped, debounced, not-found rows), the Option-B layout, `getDealerVinData`/`buildVinDataMap_`, the 8-theme compatibility, and the Transcription retirement.

- [ ] **Step 2: Update the Bridge doc** — the Run Order screen description (new layout + table) and remove/annotate the Transcription view description.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/
git commit -m "docs: Run Order live VIN table + Transcription retirement"
```

---

## Self-Review

**Spec coverage:** Layout (Task 2) ✓; live dealer-scoped table + debounce + not-found + count (Tasks 1, 3) ✓; reserved rail holding run-flow (Task 2) ✓; transcription retirement (Task 5) ✓; theming-compatibility tokens-only + reuse primitives + Encarta coverage + 8-theme sweep (Global Constraints + Task 4) ✓; backend `getDealerVinData` fail-safe (Task 1) ✓; id-preservation / small blast radius (Global Constraints + Task 2) ✓; docs (Task 6) ✓.

**Placeholder scan:** all code steps show complete code; the markup "MOVE here" instructions name exact ids and are concrete (relocation, not new code), not placeholders.

**Type consistency:** `getDealerVinData`/`buildVinDataMap_` map shape `{year,make,model,type,stock,status}` is identical in Tasks 1 and 3; DOM ids (`#vinDataBody`, `#vinMatchCount`, `#vinDataTable`) and `rv*` function names are consistent across Tasks 2–4.

## Verification approach (project reality)

No local test runner exists for GAS. Per-task gates are `node --check` (syntax), `<div>` balance, `rv*`/function collision greps, and an ad-hoc `node` snippet for the one pure helper (`buildVinDataMap_`). Full behavior + the mandatory 8-theme sweep are verified by the user after `clasp push` (the user owns deployment).
