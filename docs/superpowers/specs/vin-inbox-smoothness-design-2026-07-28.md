# VIN Inbox Smoothness — Design Spec

**Date:** 2026-07-28
**Status:** Approved (brainstorm session 2026-07-28)
**Scope:** Client-only — all changes land in `ViewVinInbox.html`. Zero server changes:
`updateVinSubmissionStatuses(ids, status)` already accepts any id list, and the
poll reuses `getVinSubmissions()`.

## Problem

1. Discarding a batch triggers a full `viLoad()` (refetch submissions + per-dealer
   inventory maps + full re-render). The wait between back-to-back deletes is long
   enough to be annoying.
2. OCR progress is invisible: during "Run OCR" the cards stay on "still
   processing…" until the final chunk's `viLoad()`; OCR run from someone else's
   session requires a manual refresh to see at all.
3. No way to bulk-select photos or batches for discard — only per-card and
   per-batch buttons.

## Design

### 1. Instant deletes (optimistic UI)

Every discard path (single card, batch header, bulk select) becomes:

- Confirm → **immediately** remove the DOM node(s) and splice the rows out of
  `viSubs` → fire `updateVinSubmissionStatus(es)` in the background.
- Success: toast only (mention `photosFailed` if nonzero). No `viLoad()`.
- Failure (server error or `!res.ok`): error toast + one `viLoad()` to resync —
  the sheet stays authoritative.
- A card discard that empties its batch removes the batch `<details>` too.
- Batch chips (`N submissions`, `N valid`) and the Run OCR queued count
  (`viRefreshOcrBtn`) update in place after every removal.
- `viGroupNames` is left untouched (indices stay stable for other handlers);
  a group with zero remaining rows simply renders/acts as empty.

### 2. Live OCR progress (light refresh + poll)

New `viRefresh()` — like `viLoad()` but:

- Does **not** reset `viVinMaps` (inventory maps are the expensive fetch and
  don't change during OCR).
- Preserves which batches are open: each `<details class="vi-batch">` carries
  `data-key="<group key>"`; before re-render record the open keys, re-apply after.
- Skips itself (no-op) when a guard is active: select mode is on, or
  `document.activeElement` is a VIN input (protects in-flight edits and
  checkmark state). Exiting select mode triggers one `viRefresh()`.

Wired in two places:

- **Own OCR run:** `viOcrStep` calls `viRefresh()` after each chunk, so cards
  flip from "still processing…" to results as they're read. The final chunk
  keeps the finished toast; the closing `viLoad()` becomes `viRefresh()`.
- **Background poll:** one `setInterval` (~15 s), registered once. Each tick
  does work only when the view is visible (`#view-vin-inbox` not hidden) AND
  `viSubs` has queued rows AND no guard is active. Covers OCR run from another
  session and the tail of your own run. No queued rows → the tick is free
  (no server call).

### 3. Select mode for bulk discard

- Header gains a **Select** button. Toggling it sets a class
  (`vi-select-mode`) on the view root.
- Checkboxes are always in the DOM, hidden by CSS outside select mode:
  one per photo card, one per batch `<summary>` (with `stopPropagation` so
  clicking it doesn't toggle the batch open/closed).
- Batch checkbox = check/uncheck all of its card checkboxes. Selection can
  span batches. Queued (not-yet-OCR'd) cards are selectable.
- Selection state lives in the DOM (`:checked`), not JS — one delegated
  `change` listener on `#viBody` updates the count.
- In select mode the header shows **Discard selected (N)** (disabled at 0)
  and **Cancel**. Discard → one `confirm()` → collect checked card ids →
  optimistic removal (section 1) → one `updateVinSubmissionStatuses` call →
  exit select mode.
- Re-render (`viRefresh`/`viLoad`) exits select mode implicitly (fresh DOM,
  no checked boxes) — the guards in section 2 make this unreachable while
  selecting; only an explicit user Refresh does it.

## Error handling

Uniform: any server failure → error toast + full `viLoad()` resync. Optimistic
removals are never "rolled back" surgically — resync from the sheet instead.

## Testing

- Syntax gates + existing offline harness via test-verifier (no server code
  changes expected to trip engine tests).
- Manual in dev: back-to-back batch discards, card discard emptying a batch,
  OCR run watching cards flip per chunk, second-session OCR visible via poll,
  select-across-batches bulk discard, poll skipping while typing a VIN.

## Alternatives rejected

- Surgical per-card DOM patching for OCR updates — more code and state-sync
  bugs than re-render-with-preserved-open-state.
- Making `viLoad` faster but keeping reload-on-delete — doesn't fix the
  back-to-back delete flow.
- Always-visible checkboxes — Nick chose the Select-mode toggle.
