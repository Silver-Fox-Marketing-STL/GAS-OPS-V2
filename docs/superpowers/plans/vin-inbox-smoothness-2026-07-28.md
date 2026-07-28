# VIN Inbox Smoothness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discards in the VIN Inbox are instant (optimistic, no reload), OCR progress shows live (per-chunk refresh + 15s poll), and a Select mode enables cross-batch bulk discard.

**Architecture:** Client-only — every change lands in `ViewVinInbox.html`. The server already has everything needed: `updateVinSubmissionStatuses(ids, status)` accepts any id list, and the poll reuses `getVinSubmissions()`. Optimistic removal splices `viSubs` + removes DOM nodes; failure resyncs via `viLoad()`. A new `viRefresh()` re-renders while keeping the expensive per-dealer inventory maps and each batch's open/closed state.

**Tech Stack:** Google Apps Script HtmlService fragment (ES5-style JS in one shared SPA scope), `google.script.run`, SharedUtils (`escHtml`, `toast`, `.btn-*`/`.tag` classes).

**Spec:** `docs/superpowers/specs/vin-inbox-smoothness-design-2026-07-28.md`

## Global Constraints

- All symbols prefixed `vi` (one shared JS scope across all view fragments).
- Never interpolate a dynamic string into an inline `onclick` — dynamic values go in `data-*` attributes (escHtml'd; escHtml escapes `"` so double-quoted attrs are safe) and are read back with `getAttribute`.
- `viGroupNames` is never mutated after render — `gi` indices baked into inline handlers must stay valid.
- Server failure handling is uniform: error toast + `viLoad()` resync. Never surgically roll back an optimistic removal.
- Syntax gate after every edit (run from repo root, Bash tool):
  `node -e "const s=require('fs').readFileSync('ViewVinInbox.html','utf8');const parts=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);new Function(parts.join('\n'));console.log('syntax OK')"`
- Offline harness must stay green: `node test/run-tests.js` (it doesn't cover HTML, but must not regress).
- Work on branch `feat/vin-inbox-smooth`; commit per task; DEV deploy only in Task 4 (`clasp push -f` targets DEV + bump the "Dev OPS Deploy" deployment — never `promote.ps1`).

---

### Task 1: Optimistic discard core

**Files:**
- Modify: `ViewVinInbox.html` — `viRender` (~line 126–162), `viAction`/`viDiscard`/`viDeleteBatch` (~line 336–384), new helpers after `viFindSub_`.

**Interfaces:**
- Produces: `viRemoveRows(ids: string[])` — splices rows out of `viSubs`, removes their card DOM nodes, removes emptied batch `<details>`, updates batch chips + OCR button count. No server call.
- Produces: `viDiscardIds(ids: string[])` — `viRemoveRows(ids)` then fire-and-forget `updateVinSubmissionStatuses(ids, 'discarded')`; failure → toast + `viLoad()`.
- Produces: `viSubsChip_(n: number)` → `'<b>N</b> submission(s)'` HTML string (render + in-place chip update share it).
- Produces (markup): each `<details class="vi-batch">` carries `data-key="<escHtml(group key)>"`; the submissions chip is `<span class="eomr-chip" id="visubs_<gi>">`.
- Removes: `viAction` (its only caller was `viDiscard`).

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/vin-inbox-smooth
```

- [ ] **Step 2: Tag batches and chips in `viRender`**

Replace (line ~133):

```javascript
      html += '<details class="vi-batch">';
```

with:

```javascript
      html += '<details class="vi-batch" data-key="' + escHtml(key) + '">';
```

Replace (line ~145):

```javascript
      html += '<span class="eomr-chip"><b>' + rows.length + '</b> submission' + (rows.length === 1 ? '' : 's') + '</span>';
```

with:

```javascript
      html += '<span class="eomr-chip" id="visubs_' + gi + '">' + viSubsChip_(rows.length) + '</span>';
```

- [ ] **Step 3: Add the helpers after `viFindSub_` (~line 248)**

```javascript
  function viSubsChip_(n) {
    return '<b>' + n + '</b> submission' + (n === 1 ? '' : 's');
  }

  // Optimistic removal: drop rows from viSubs + the DOM in place — no reload.
  // viGroupNames is deliberately untouched (gi indices baked into inline
  // handlers stay valid); an emptied group's <details> is removed here, so its
  // stale handlers can't fire.
  function viRemoveRows(ids) {
    var gone = {};
    ids.forEach(function (id) { gone[String(id)] = 1; });
    viSubs = viSubs.filter(function (s) { return !gone[String(s.id)]; });
    ids.forEach(function (id) {
      var card = document.getElementById('vicard_' + id);
      if (card && card.parentNode) card.parentNode.removeChild(card);
    });
    var batches = document.querySelectorAll('#viBody .vi-batch');
    for (var i = 0; i < batches.length; i++) {
      var det = batches[i];
      var key = det.getAttribute('data-key');
      var left = viSubs.filter(function (s) { return viGroupKey(s) === key; });
      if (!left.length) { det.parentNode.removeChild(det); continue; }
      var gi = viGroupNames.indexOf(key);
      var subsChip = document.getElementById('visubs_' + gi);
      if (subsChip) subsChip.innerHTML = viSubsChip_(left.length);
      var validB = document.getElementById('vivalid_' + gi);
      if (validB) validB.textContent = left.filter(function (s) { return s.valid; }).length;
    }
    if (!viSubs.length) document.getElementById('viBody').innerHTML = '<p class="vi-empty">No open submissions.</p>';
    viRefreshOcrBtn();
  }

  // Optimistic bulk discard: rows vanish immediately; the server call runs in
  // the background. Failure (thrown or !ok) → toast + full viLoad resync — the
  // sheet stays authoritative, we never surgically roll back.
  function viDiscardIds(ids) {
    viRemoveRows(ids);
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res || !res.ok) { toast('Discard failed: ' + escHtml((res && res.error) || '?'), 'error'); viLoad(); return; }
        var msg = 'Discarded ' + res.updated + ' submission' + (res.updated === 1 ? '' : 's') + '.';
        if (res.photosFailed > 0) msg += ' (' + res.photosFailed + ' photo(s) couldn\'t be deleted)';
        toast(msg, 'success');
      })
      .withFailureHandler(function (e) { toast('Discard failed: ' + escHtml((e && e.message) || String(e)), 'error'); viLoad(); })
      .updateVinSubmissionStatuses(ids, 'discarded');
  }
```

- [ ] **Step 4: Rewire the discard entry points**

Delete the whole `viAction` function (~line 336–351). Replace `viDiscard` and `viDeleteBatch` (~line 353–384) with:

```javascript
  function viDiscard(sid) { if (confirm('Discard this submission?')) viDiscardIds([sid]); }

  function viDeleteBatch(gi, evt) {
    // Button lives inside <summary> — prevent the click from also toggling the batch open/closed.
    if (evt) { evt.preventDefault(); evt.stopPropagation(); }
    var key = viGroupNames[gi];
    var rows = viSubs.filter(function (s) { return viGroupKey(s) === key; });
    if (!rows.length) return;
    if (!confirm('Discard all ' + rows.length + ' submissions in this batch?')) return;
    viDiscardIds(rows.map(function (s) { return s.id; }));
  }
```

(Single-card discard moves from `updateVinSubmissionStatus` to the bulk `updateVinSubmissionStatuses` — same status/timestamp/by stamping and photo trash server-side. `viMaybeDiscardBatch` in this file is untouched: it runs from ViewRun with the inbox not rendered, and already doesn't reload.)

- [ ] **Step 5: Run the gates**

Run (Bash): the syntax-gate one-liner from Global Constraints — expected `syntax OK`.
Run: `node test/run-tests.js` — expected all tests pass.

- [ ] **Step 6: Commit**

```bash
git add ViewVinInbox.html
git commit -m "feat(vin-inbox): optimistic discards - cards/batches vanish instantly, no reload"
```

---

### Task 2: Live OCR progress — `viRefresh` + per-chunk update + background poll

**Files:**
- Modify: `ViewVinInbox.html` — new `viRefresh`/`viRefreshBlocked_` + poll after `viLoad` (~line 100), `viOcrStep` (~line 402–427).

**Interfaces:**
- Consumes: existing `viRender(res)`, `viLoad()`, `viSubs`.
- Produces: `viRefresh()` — refetch `getVinSubmissions` + re-render, KEEPING `viVinMaps` (not reset — `viLoadMaps` already skips loaded dealers) and each batch's open state (via `data-key` from Task 1). No-ops while blocked or while one is already in flight.
- Produces: `viRefreshBlocked_()` → boolean — true when select mode is on or a VIN input has focus.
- Produces: `var viSelectMode = false;` — declared here (used by the guard), driven by Task 3.

- [ ] **Step 1: Add the refresh machinery after `viLoad` (~line 100)**

```javascript
  var viSelectMode = false;   // Task: select mode — declared here for the refresh guard
  var viRefreshing = false;

  // True while an innerHTML re-render would destroy user state (checkmarks in
  // select mode, or an in-flight VIN edit). Checked before AND after the fetch.
  function viRefreshBlocked_() {
    if (viSelectMode) return true;
    var ae = document.activeElement;
    return !!(ae && ae.id && ae.id.indexOf('vivin_') === 0);
  }

  // Light refresh: like viLoad but keeps the per-dealer inventory maps (the
  // expensive fetch — unchanged by OCR) and re-opens the batches the user had
  // open. Used after each OCR chunk and by the background poll.
  function viRefresh() {
    if (viRefreshing || viRefreshBlocked_()) return;
    if (!document.getElementById('viBody')) return;
    viRefreshing = true;
    google.script.run
      .withSuccessHandler(function (res) {
        viRefreshing = false;
        if (viRefreshBlocked_()) return;   // state changed mid-flight — drop this snapshot
        var openKeys = {};
        var open = document.querySelectorAll('#viBody .vi-batch[open]');
        for (var i = 0; i < open.length; i++) openKeys[open[i].getAttribute('data-key')] = 1;
        viRender(res);
        var all = document.querySelectorAll('#viBody .vi-batch');
        for (var j = 0; j < all.length; j++) {
          if (openKeys[all[j].getAttribute('data-key')]) all[j].setAttribute('open', '');
        }
      })
      .withFailureHandler(function () { viRefreshing = false; })   // silent — poll/next chunk retries soon
      .getVinSubmissions();
  }

  // Background poll: OCR run from ANOTHER session becomes visible without a
  // manual refresh. The tick is free (no server call) unless the view is
  // showing and queued rows exist.
  setInterval(function () {
    var view = document.getElementById('view-vin-inbox');
    if (!view || view.hidden) return;
    var queued = false;
    for (var i = 0; i < viSubs.length; i++) if (viSubs[i].ocrState === 'queued') { queued = true; break; }
    if (queued) viRefresh();
  }, 15000);
```

- [ ] **Step 2: Refresh after every OCR chunk**

In `viOcrStep`'s success handler, replace:

```javascript
        var total = doneSoFar + res.processed;
        toast('OCR: ' + total + ' done, ' + res.remaining + ' remaining…', 'info');
        if (res.remaining > 0 && res.processed > 0) {
          viOcrStep(total);
        } else {
          if (btn) btn.disabled = false;
          toast('OCR finished — ' + total + ' processed.', 'success');
          viLoad();
        }
```

with:

```javascript
        var total = doneSoFar + res.processed;
        if (res.remaining > 0 && res.processed > 0) {
          toast('OCR: ' + total + ' done, ' + res.remaining + ' remaining…', 'info');
          viRefresh();          // cards flip to results chunk by chunk
          viOcrStep(total);
        } else {
          if (btn) btn.disabled = false;
          toast('OCR finished — ' + total + ' processed.', 'success');
          viRefresh();          // inventory maps unchanged — no need for full viLoad
        }
```

- [ ] **Step 3: Run the gates**

Run (Bash): the syntax-gate one-liner — expected `syntax OK`.
Run: `node test/run-tests.js` — expected all tests pass.

- [ ] **Step 4: Commit**

```bash
git add ViewVinInbox.html
git commit -m "feat(vin-inbox): live OCR progress - per-chunk refresh + 15s poll, open batches preserved"
```

---

### Task 3: Select mode — cross-batch bulk discard

**Files:**
- Modify: `ViewVinInbox.html` — header buttons (~line 18–21), CSS block (~line 28–64), `viRender` summary (~line 135) + end of `viRender` (~line 161), `viCard` (~line 210), `viRemoveRows` (from Task 1), new select-mode JS at the end of the script.

**Interfaces:**
- Consumes: `viDiscardIds(ids)` (Task 1), `viRefresh()` + `viSelectMode` (Task 2).
- Produces: `viSelToggle(skipRefresh?)`, `viSelDiscard()`, `viSelCountUpdate()`; checkbox classes `.vi-check`, `.vi-check-batch`, `.vi-check-card` (card boxes carry `data-id`).

- [ ] **Step 1: Header buttons**

In `.vi-head-actions` (~line 18), insert BEFORE the Refresh button:

```html
        <button type="button" class="btn-danger" id="viSelDiscardBtn" onclick="viSelDiscard()" hidden>Discard selected (<span id="viSelCount">0</span>)</button>
        <button type="button" class="btn-ghost" id="viSelBtn" onclick="viSelToggle()">Select</button>
```

- [ ] **Step 2: CSS — checkboxes hidden outside select mode**

Add to the `<style>` block:

```css
  #view-vin-inbox .vi-check { display: none; width: 18px; height: 18px; margin: 0; flex-shrink: 0; align-self: center; cursor: pointer; }
  #view-vin-inbox.vi-select-mode .vi-check { display: inline-block; }
```

- [ ] **Step 3: Emit the checkboxes**

In `viRender`, right after `html += '<summary>';` (~line 134) and BEFORE the caret span, add:

```javascript
      html += '<input type="checkbox" class="vi-check vi-check-batch" onclick="event.stopPropagation()" aria-label="Select batch">';
```

(`stopPropagation` only — `preventDefault` would stop the box from checking; stopping the bubble is what keeps `<details>` from toggling.)

In `viCard`, right after `h += '<div class="vi-card' + … + '">';` (~line 210, before `h += thumb;`), add:

```javascript
    h += '<input type="checkbox" class="vi-check vi-check-card" data-id="' + escHtml(s.id) + '" aria-label="Select photo">';
```

At the very end of `viRender` (after `viLoadMaps();`), add:

```javascript
    viSelCountUpdate();   // re-render clears checkmarks — sync the count
```

- [ ] **Step 4: Select-mode JS at the end of the script block**

```javascript
  // ── Select mode — bulk discard across batches ──
  function viSelToggle(skipRefresh) {
    viSelectMode = !viSelectMode;
    document.getElementById('view-vin-inbox').classList.toggle('vi-select-mode', viSelectMode);
    var selBtn = document.getElementById('viSelBtn');
    if (selBtn) selBtn.textContent = viSelectMode ? 'Cancel' : 'Select';
    var dBtn = document.getElementById('viSelDiscardBtn');
    if (dBtn) dBtn.hidden = !viSelectMode;
    if (viSelectMode) { viSelCountUpdate(); return; }
    // Exiting: clear leftover checks, then catch up on refreshes the mode blocked
    // (skipRefresh: bulk discard passes true — a refetch would race the server
    // write and momentarily resurrect the discarded rows).
    var boxes = document.querySelectorAll('#viBody .vi-check:checked');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
    if (!skipRefresh) viRefresh();
  }

  function viSelCountUpdate() {
    var n = document.querySelectorAll('#viBody .vi-check-card:checked').length;
    var span = document.getElementById('viSelCount');
    if (span) span.textContent = n;
    var dBtn = document.getElementById('viSelDiscardBtn');
    if (dBtn) dBtn.disabled = (n === 0);
  }

  function viSelDiscard() {
    var boxes = document.querySelectorAll('#viBody .vi-check-card:checked');
    if (!boxes.length) return;
    if (!confirm('Discard ' + boxes.length + ' selected submission' + (boxes.length === 1 ? '' : 's') + '?')) return;
    var ids = [];
    for (var i = 0; i < boxes.length; i++) ids.push(boxes[i].getAttribute('data-id'));
    viSelToggle(true);   // exit select mode without the catch-up refresh
    viDiscardIds(ids);
  }

  // One delegated listener — survives every innerHTML re-render of #viBody.
  // Batch box drives its cards; a card change re-derives its batch box.
  document.getElementById('viBody').addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('vi-check')) return;
    var det = t.closest('.vi-batch');
    if (t.classList.contains('vi-check-batch')) {
      if (det) {
        var cards = det.querySelectorAll('.vi-check-card');
        for (var i = 0; i < cards.length; i++) cards[i].checked = t.checked;
      }
    } else if (det) {
      var all = det.querySelectorAll('.vi-check-card');
      var checked = det.querySelectorAll('.vi-check-card:checked');
      var bb = det.querySelector('.vi-check-batch');
      if (bb) bb.checked = (all.length > 0 && checked.length === all.length);
    }
    viSelCountUpdate();
  });
```

- [ ] **Step 5: Keep the count honest during optimistic removals**

At the end of `viRemoveRows` (Task 1), after `viRefreshOcrBtn();`, add:

```javascript
    viSelCountUpdate();   // a checked card can be removed via its own Discard button mid-select
```

- [ ] **Step 6: Run the gates**

Run (Bash): the syntax-gate one-liner — expected `syntax OK`.
Run: `node test/run-tests.js` — expected all tests pass.

- [ ] **Step 7: Commit**

```bash
git add ViewVinInbox.html
git commit -m "feat(vin-inbox): select mode - checkbox bulk discard across batches"
```

---

### Task 4: Changelog + DEV deploy

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]` section).

**Interfaces:**
- Consumes: everything above; produces the deployable increment Nick tests at the DEV `/exec` URL.

- [ ] **Step 1: Changelog entries**

Under `## [Unreleased]` → `### Added`, add:

```markdown
- **VIN Inbox Select mode**: checkboxes on photo cards and batch headers
  (batch box selects its cards), cross-batch "Discard selected (N)" bulk
  discard — one `updateVinSubmissionStatuses` call. Client-only.
```

Under `## [Unreleased]` → `### Changed`, add:

```markdown
- **VIN Inbox discards are optimistic**: cards/batches vanish immediately
  (no full reload between deletes); server failure resyncs via reload.
  Single-card discard now routes through the bulk endpoint.
- **VIN Inbox OCR progress is live**: cards update after each Run OCR chunk,
  and a 15s background poll (only while the view is visible AND queued photos
  exist) picks up OCR run from other sessions. Refreshes keep loaded inventory
  maps and open batches, and skip while typing a VIN or in Select mode.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for VIN Inbox smoothness pass"
```

- [ ] **Step 3: DEV deploy (the pair — push + bump)**

Confirm branch is `feat/vin-inbox-smooth` (`git branch --show-current`), then:

```bash
npx clasp push -f
npx clasp deployments   # find the "Dev OPS Deploy" deployment id (AKfyc…)
npx clasp deploy -i <Dev-OPS-Deploy-id> -d "Dev OPS Deploy"
```

Expected: push lists `ViewVinInbox.html`; deploy bumps the existing versioned deployment (Nick tests at the DEV `/exec` URL, not `/dev`).

- [ ] **Step 4: Report deployable**

Tell Nick it's deployed to DEV and list the manual checks (from the spec):
back-to-back batch discards; card discard emptying a batch removes the header;
Run OCR flips cards chunk-by-chunk; a second session's OCR shows within ~15s;
select-across-batches bulk discard; poll never eats an in-progress VIN edit or
checkmarks; batch open/closed state survives refreshes.
