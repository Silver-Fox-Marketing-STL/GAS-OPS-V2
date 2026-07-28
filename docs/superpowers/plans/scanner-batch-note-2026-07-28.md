# Scanner Batch Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Field crew can attach a free-text note to a Lot Scanner batch; the office sees it on the batch header in the VIN Inbox.

**Architecture:** Reuse the existing `notes` column (`LOTC.NOTES` = 19) in SF_LOT_SUBMISSIONS — no schema change. The note is stamped on every row of the batch **at Finish time** (not per commit chunk): `sendDraftBatch` gains an optional `note` param (stamps in its existing row loop), and a new `setBatchNote` covers the Finish-without-send path. The main app's inbox reader already returns `notes` per submission — display-only change there.

**Tech Stack:** Google Apps Script (V8), HtmlService, `google.script.run`.

**Spec deviation (approved mechanism refined):** the spec had `commitQueuedBatch` carrying the note per chunk. Chunks commit *during* shooting, so a note typed after the last photo — the common case — would never persist. Stamping at Finish covers all paths with rows always uniform. `commitQueuedBatch` is untouched. Trade-off: a mid-shoot page reload loses an unsaved note — consistent with losing unsaved photos in the same crash.

## Global Constraints

- Note is plain text, trimmed, capped at 500 chars (client `maxlength` + server `.slice(0, 500)`).
- All display is `escHtml`-escaped on both apps.
- Never interpolate the note into an inline `onclick` (SPA trap — apostrophes kill the row).
- lot-scan has NO offline test harness — verification is the DEV deploy (manual). Main-app harness (`node test/run-tests.js`) must stay green.
- lot-scan/SharedUtils.html is a divergent copy — any class used in lot-scan HTML must exist in lot-scan's own files.
- Two separate Apps Script projects: main app (`clasp push` from repo root → DEV) and lot-scan (`clasp push` from `lot-scan/` → its own DEV script).

---

### Task 1: lot-scan server — persist + return the note

**Files:**
- Modify: `lot-scan/Code.gs` — `sendDraftBatch` (~line 408), `getMyDrafts` (~line 356), new `setBatchNote` after `sendDraftBatch`.

**Interfaces:**
- Produces: `sendDraftBatch(batchId, note?)` — unchanged return `{ok, sent}`; when `note` is a non-empty string, also writes it to the notes col of every row it flips. Callers passing no note (drafts-pane Send button) leave existing notes untouched.
- Produces: `setBatchNote(batchId, note)` → `{ok, updated}` — stamps the notes col on this user's draft rows in the batch.
- Produces: `getMyDrafts()` drafts gain `note: string`.

- [ ] **Step 1: `sendDraftBatch` — optional note stamp in the existing loop**

Replace the function body's loop section:

```javascript
// Field "Send to office" — flip this user's draft rows in a batch to submitted.
// Optional note (batch note typed during capture): stamped on every row in the
// same pass. Empty/absent note = leave the notes column untouched.
function sendDraftBatch(batchId, note) {
  try {
    var me = getActiveEmail_();
    var noteStr = String(note || '').trim().slice(0, 500);
    var sh = getOrCreateLotSubmissionsSheet_();
    var data = sh.getDataRange().getValues();
    var n = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][LOTC.EMAIL]) !== me) continue;
      if (String(data[i][LOTC.BATCH_ID]) !== String(batchId)) continue;
      if (String(data[i][LOTC.STATUS]) !== 'draft') continue;
      sh.getRange(i + 1, LOTC.STATUS + 1).setValue('submitted');
      if (noteStr) sh.getRange(i + 1, LOTC.NOTES + 1).setValue(noteStr);
      n++;
    }
    return { ok: true, sent: n };
  } catch (e) {
    Logger.log('sendDraftBatch failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}
```

(Per-cell `setValue` in a loop matches this function's existing pattern; batches are ~10–50 rows.)

- [ ] **Step 2: add `setBatchNote` directly below `sendDraftBatch`**

```javascript
// Stamp/replace the batch note on this user's draft rows (Finish-without-send
// path — Finish & Send stamps via sendDraftBatch instead).
function setBatchNote(batchId, note) {
  try {
    var me = getActiveEmail_();
    var noteStr = String(note || '').trim().slice(0, 500);
    var sh = getOrCreateLotSubmissionsSheet_();
    var data = sh.getDataRange().getValues();
    var n = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][LOTC.EMAIL]) !== me) continue;
      if (String(data[i][LOTC.BATCH_ID]) !== String(batchId)) continue;
      if (String(data[i][LOTC.STATUS]) !== 'draft') continue;
      sh.getRange(i + 1, LOTC.NOTES + 1).setValue(noteStr);
      n++;
    }
    return { ok: true, updated: n };
  } catch (e) {
    Logger.log('setBatchNote failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 3: `getMyDrafts` returns the note**

In the `out.push({...})` object, after `ocrState: ...` add:

```javascript
        note: String(r[LOTC.NOTES] || ''),
```

- [ ] **Step 4: Commit**

```bash
git add lot-scan/Code.gs
git commit -m "feat(lot-scan): persist batch note server-side (sendDraftBatch note param, setBatchNote, getMyDrafts note)"
```

---

### Task 2: lot-scan client — note field in the capture flow

**Files:**
- Modify: `lot-scan/Capture.html` — Shooting pane markup (~line 265), `vpBeginShooting` (~380), `vpStartOrder` (~369), `vpResumeOrder` (~861), `vpCompleteFinish` (~418), `vpEndOrder` (~442), `vpRenderIdleDrafts` (~744), `vpRenderDrafts` (~776), CSS block.

**Interfaces:**
- Consumes: `sendDraftBatch(batchId, note)`, `setBatchNote(batchId, note)`, `getMyDrafts().drafts[].note` from Task 1.
- Produces: `vpDraftMeta[bid]` gains `.note` (first non-empty in group); `vpBeginShooting` gains 5th param `note`.

- [ ] **Step 1: add the note field to the Shooting pane**

After the `<div class="ls-qstrip" id="lsQueue"></div>` line, before `<div class="ls-actions">`:

```html
        <textarea id="lsOrderNote" class="ls-note" rows="2" maxlength="500"
          placeholder="Note to office (optional) — e.g. rush order, damaged vehicle, special placement"></textarea>
```

- [ ] **Step 2: style it (lot-scan's own CSS — divergent SharedUtils copy)**

In the `<style>` block near the `.ls-qstrip` rules:

```css
    .ls-note { width: 100%; box-sizing: border-box; margin-top: var(--space-3);
      padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--surface); color: var(--text); font: inherit; resize: vertical; }
    .ls-note::placeholder { color: var(--text-dim); }
    .ls-dnote { margin: 0 0 var(--space-2); }
```

(If `--text-dim` doesn't exist in lot-scan's SharedUtils, use `opacity: .6` on the placeholder rule instead — check before pushing.)

- [ ] **Step 3: wire begin/resume to seed the field**

`vpBeginShooting` gains a 5th param and sets the field (add before `vpRenderQueue()`):

```javascript
    function vpBeginShooting(dealerKey, dealerName, batchId, label, note) {
      ...
      document.getElementById('lsOrderNote').value = note || '';
      vpRenderQueue(); vpUpdateCount(); vpUpdateFinishUI();
    }
```

`vpStartOrder`: pass `''` — `vpBeginShooting(dealerKey, dealerName, batchId, dealerName + ' — new order', '')`.

`vpResumeOrder` (calls `vpBeginShooting` with `vpDraftMeta[bid]`): pass `(vpDraftMeta[bid] && vpDraftMeta[bid].note) || ''` as the 5th arg so resuming a batch pre-fills its persisted note.

- [ ] **Step 4: capture the note in both group-meta builders**

In `vpRenderIdleDrafts` and `vpRenderDrafts`, where `vpDraftMeta[bid] = { dealerKey: ..., dealerName: dealer }` is set, compute the group note first and include it:

```javascript
        var note = '';
        for (var ni = 0; ni < rows.length; ni++) { if (rows[ni].note) { note = rows[ni].note; break; } }
        vpDraftMeta[bid] = { dealerKey: rows[0].dealerKey || '', dealerName: dealer, note: note };
```

- [ ] **Step 5: stamp at Finish**

In `vpCompleteFinish`, read the note BEFORE `vpEndOrder()` clears the pane, then stamp per path:

```javascript
    function vpCompleteFinish() {
      var order = vpOrder, send = vpFinishing && vpFinishing.send;
      var savedN = vpQueue.filter(function (q) { return q.state === 'saved'; }).length;
      var noteEl = document.getElementById('lsOrderNote');
      var note = noteEl ? noteEl.value.trim().slice(0, 500) : '';
      vpFinishing = null;
      vpEndOrder();
      if (send) {
        google.script.run
          .withSuccessHandler(function (res) {
            if (res && res.ok) {
              // Sent batches leave the Drafts list — confirm instead of auto-opening a gone batch.
              toast('Batch sent to office ✓ (' + (res.sent != null ? res.sent : savedN) + ' photos)', 'success');
              vpTab('drafts');
            } else {
              toast('Send failed: ' + ((res && res.error) || 'unknown'), 'error');
              vpTab('drafts', order.batchId);   // still a draft — open it
            }
          })
          .withFailureHandler(function (e) { toast('Send failed: ' + ((e && e.message) || e), 'error'); vpTab('drafts', order.batchId); })
          .sendDraftBatch(order.batchId, note);
      } else {
        if (note) {
          google.script.run
            .withSuccessHandler(function (res) {
              if (!res || !res.ok) toast('Note not saved: ' + ((res && res.error) || 'unknown') + ' — Resume the draft to retry.', 'error');
              else vpLoadDrafts();   // draft card should show the fresh note
            })
            .withFailureHandler(function (e) { toast('Note not saved: ' + ((e && e.message) || e) + ' — Resume the draft to retry.', 'error'); })
            .setBatchNote(order.batchId, note);
        }
        vpTab('drafts', order.batchId);
      }
    }
```

(Only the two `.sendDraftBatch(...)`/note-branch lines change — success/failure handlers of the send path stay exactly as they are.)

In `vpEndOrder`, alongside `lsQueue` clearing: `document.getElementById('lsOrderNote').value = '';`

- [ ] **Step 6: show the note on the draft batch card (read-only)**

In `vpRenderDrafts`, after the `ls-dbtns` div is closed and before `html += '<div class="ls-drows">';`:

```javascript
        var gnote = (vpDraftMeta[bid] && vpDraftMeta[bid].note) || '';
        if (gnote) html += '<div class="ls-hint ls-dnote">&#128221; ' + escHtml(gnote) + '</div>';
```

- [ ] **Step 7: verify + commit**

No harness — eyeball a full `Capture.html` re-read for balanced tags/braces, then:

```bash
git add lot-scan/Capture.html
git commit -m "feat(lot-scan): batch note field in capture flow (persist at Finish, prefill on Resume, show on draft card)"
```

---

### Task 3: main app — show the note on the VIN Inbox batch header

**Files:**
- Modify: `ViewVinInbox.html` — `viRender` (~line 135–139), CSS block (~line 45).

**Interfaces:**
- Consumes: `s.notes` per submission — already returned by the main app's inbox reader (`Code.gs:8597`), no server change.

- [ ] **Step 1: render the note in the batch title**

In `viRender`, after the `vi-group-sub` line inside `if (isBatch) {...}`:

```javascript
      if (isBatch) {
        html += '<span class="vi-group-sub">' + escHtml(rows[0].email || '') + (rows[0].ts ? (' · ' + escHtml(rows[0].ts)) : '') + '</span>';
        var batchNote = '';
        for (var ni = 0; ni < rows.length; ni++) { if (rows[ni].notes) { batchNote = rows[ni].notes; break; } }
        if (batchNote) html += '<span class="vi-note">&#128221; ' + escHtml(batchNote) + '</span>';
      }
```

- [ ] **Step 2: CSS for `.vi-note`** (with the other `#view-vin-inbox` rules)

```css
  #view-vin-inbox .vi-note { font-size: var(--fs-sm); color: var(--text); opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60ch; }
```

(`vi-batch-title` is already a min-width:0 flex column, so long notes ellipsis-clip at ~60ch on the collapsed header. The 500-char full text has no second display surface in this iteration; showing it inside the expanded batch body is a follow-up if clipping proves annoying.)

- [ ] **Step 3: harness + commit**

```bash
node test/run-tests.js   # expect 113/113 PASS (no server change, belt-and-suspenders)
git add ViewVinInbox.html
git commit -m "feat(vin-inbox): show scanner batch note on the batch header"
```

---

### Task 4: docs + deploys

**Files:**
- Modify: `CHANGELOG.md` (Unreleased → Added), `docs/superpowers/specs/scanner-batch-note-design-2026-07-28.md` (mechanism amendment).

- [ ] **Step 1: CHANGELOG entry** under `## [Unreleased]` → `### Added`:

```markdown
- **Scanner batch note**: field crew can type an optional "Note to office"
  (500-char cap) on the Lot Scanner capture screen; it's stamped into the
  existing `notes` column on every row of the batch at Finish
  (`sendDraftBatch` note param / new `setBatchNote` for finish-without-send),
  pre-fills on Resume, shows read-only on the draft card, and displays on the
  VIN Inbox batch header (reader already returned `notes` — display-only
  main-app change). No schema change.
```

- [ ] **Step 2: amend the spec** — replace its `commitQueuedBatch` mechanism paragraph with the stamp-at-Finish mechanism (mirror the "Spec deviation" note at the top of this plan).

- [ ] **Step 3: commit docs**

```bash
git add CHANGELOG.md docs/superpowers/specs/scanner-batch-note-design-2026-07-28.md
git commit -m "docs: changelog + spec amendment for scanner batch note"
```

- [ ] **Step 4: deploy both DEV apps**

```powershell
# main app (repo root .clasp.json → DEV script)
clasp push -f
clasp deploy -i AKfycbzw11TK7k66DY0YLPgkEtU91vxIohjG1DkObfKXCckq4ZFdP44OzhYnA7AuVGIEoO7- -d "Dev OPS Deploy"
# lot-scan (own project)
cd lot-scan
clasp push -f
clasp deployments   # find the scanner's dev deployment id, then bump it the same way
cd ..
```

- [ ] **Step 5: manual DEV verification (Nick)** — scan a test batch with a note → note visible on draft card → Finish & Send → note on the DEV VIN Inbox batch header. Also: Finish (no send) → note on draft card → Send from Drafts pane → note still on inbox header.
