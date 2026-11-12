---
status: accepted
---

# Run identity is row + fingerprint; VIN-log batches are tagged by run

The run ledger (RUN_LOG) identifies a run by its row together with its run fingerprint (dealer, run time, deal ID), re-checked before every change, rather than by a new `run_id` column. Each VIN-log batch is tagged with the run it came from in a new append-only column E (`run_ref`; `manual` for manual entries), so a rollback removes exactly one run's batch. Nothing in code physically deletes RUN_LOG rows, so row positions are already stable and the fingerprint catches hand edits. The VIN log, though, cannot tell runs apart by deal ID: on 2026-11-12, 7 live deals had two or three committed runs, and 6 of them were reruns that logged the same VINs again.

## Considered Options

- **A `run_id` column on RUN_LOG.** Rejected: it widens a 23-column schema that 13 readers index by position, and legacy rows would need IDs backfilled. All of that solves a row-shifting problem that does not occur.
- **Match rollback by deal ID plus the run's VINs, with no new VIN-log column.** Rejected: any rerun under the same deal would become permanently impossible to roll back in the app.
- **Skip VINs already logged under the same deal when re-committing.** Rejected: rolling back the first run would then erase cars the second run really printed, which is a double-bill risk. Each run owns its own batch, even when the VINs repeat.

## Consequences

- Batches committed before column E existed have no tag. Rolling one back is allowed only when it is unambiguous (one batch and one committed run on that deal); otherwise the app refuses and the rollback is done by hand. No backfill.
- Every VIN-log reader must keep reading fixed columns A–D, or must consciously handle E.
