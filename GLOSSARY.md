# GAS ShortCut OPS

The system that turns a dealer's vehicle order into print files, a billing record and a Pipedrive deal, and remembers which vehicles have already been printed so none is printed or billed twice.

## Runs and the VIN log

**Run**:
One finalized production of a dealer order: the vehicles matched, the files built, and the counts billed. A billing-split order produces one run per billing group.
_Avoid_: job, order (an order is what the dealer asks for; a run is what we produced for it)

**Test run**:
A run made only to check output, marked by `test` as its deal ID. It is never committed and never billed.
_Avoid_: dry run, debug run

**Pending run**:
A run that is finalized but not yet committed to the VIN log.
_Avoid_: uncommitted run, open run

**Run ledger**:
The record of every run and where it stands with the VIN log: pending, committed, rolled back or deleted. Lives on the RUN_LOG sheet.
_Avoid_: run history, run log (when meaning the record rather than the sheet)

**Run fingerprint**:
What identifies one run in the run ledger: its dealer, its run time and its deal ID.
_Avoid_: run key, row number

**VIN log**:
The per-dealer record of every vehicle already printed, and under which order. It is what decides "already printed" for CAO, the Run table and billing dupes.
_Avoid_: dedup log, printed list

**Commit**:
Adding a pending run's produced vehicles to the VIN log, making them count as already printed.
_Avoid_: log, save, push (push means sending to Pipedrive)

**Batch**:
The VIN-log rows one commit added, belonging to exactly one run (or to one manual entry).
_Avoid_: commit group, upload

**Rollback**:
Removing one committed run's batch from the VIN log, returning the run to not-printed.
_Avoid_: undo, uncommit

**Manual entry**:
Vehicles typed straight into the VIN log under an order number, with no run behind them.
_Avoid_: manual commit
