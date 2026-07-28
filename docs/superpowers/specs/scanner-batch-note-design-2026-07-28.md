# Scanner Batch Note — Design

**Date:** 2026-07-28
**Status:** Approved (Nick, 2026-07-28)

## Purpose

Field crew can attach a free-text note to a Lot Scanner batch so the office
sees order-relevant info (e.g. "silver Tahoe has no front plate bracket,
banner goes on rear glass") when reviewing the batch in the VIN Inbox.

## Storage

Reuse the existing `notes` column (col T, `LOTC.NOTES` = 19) in
SF_LOT_SUBMISSIONS — currently written as `''` by the scanner and already
returned per-submission by the main app's inbox reader (`Code.gs:8597`).
One note per batch, stamped identically on every row the batch commits.
**No schema change on either side.**

Rejected alternative: a separate BATCHES tab — a new sheet + second reader +
join on both sides to avoid repeating a short string. Long-format repetition
is the system's idiom.

## Scanner (lot-scan project)

*Amended 2026-07-28 (implementation): the note is stamped at **Finish**, not at
commit — `commitQueuedBatch` is untouched.*

- **Capture screen:** optional "Note to office" text input in the batch/queue
  area. Plain text, trimmed, client-capped at 500 chars. Cleared when a new
  batch starts.
- **Stamped at Finish, in one pass over the batch's draft rows:**
  - **`sendDraftBatch(batchId, note)`** — optional 2nd param, written to the
    notes column inside the existing draft→submitted status-flip loop
    (Finish & Send). No extra pass, no extra call.
  - **`setBatchNote(batchId, note)`** — new, covers Finish-without-send: same
    owner/batch/`draft` row filter, writes the notes column only.
  - `commitQueuedBatch` keeps its 3-param signature; chunks still write `''`.
    Photo commits stay on the hot path, and the note is read once from the
    live input at Finish, so mid-shoot edits can't split across chunks.
- **`getMyDrafts`** returns `note` per draft row; the draft batch card shows
  it read-only (first non-empty in the batch) so crew can confirm it
  persisted, and Resume pre-fills the capture input from it — so a draft
  sent after an app reload still carries its note.

## Main app (VIN Inbox)

- Server: no change (reader already returns `notes`).
- `ViewVinInbox.html`: batch grouping picks the first non-empty `notes` in
  the group and renders it on the batch header, `escHtml`-escaped, visible
  without expanding the batch.

## Edge cases

- Blank note → blank column → header renders nothing. Legacy rows unaffected.
- *(Amended 2026-07-28: chunk divergence no longer applies — one stamp at
  Finish writes every row.)* A page reload mid-shoot loses an untyped/unsaved
  note, the same way unsaved photos are lost. Clearing a previously
  saved note back to empty does not propagate (an empty note is skipped rather
  than written) — known, deferred.
- Note display is escape-only (no markdown/HTML).

## Testing

- No offline-harness coverage for lot-scan (none exists); this is glue code.
  Verification = DEV deploy: scan a test batch with a note, confirm it in the
  DEV VIN Inbox header and on the draft card.
- Re-run the main-app harness (`node test/run-tests.js`) for regressions.

## Deploys

Two deployments: main app (DEV via clasp) and lot-scan (its own project,
separate push). Feature is inert until both sides ship; each side is
independently safe (scanner writing notes nobody displays / inbox displaying
notes nobody writes).
