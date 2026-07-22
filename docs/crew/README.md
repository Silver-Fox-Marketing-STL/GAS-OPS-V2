# Crew Handbooks — source of truth

These markdown files are the **crew-facing job aids** for GAS ShortCut OPS. They are
written for the production crew, not developers — no function names, no column letters.

- `field-crew-handbook.md` — Lot Scanner phone app (scan VINs on dealer lots)
- `office-operator-handbook.md` — scraper CSV import, VIN Inbox, Run Order, Finalize,
  output files, VIN Log

**Maintenance contract:** any feature merge that changes a crew-visible flow updates the
matching recipe here **in the same PR** (same rule as CHANGELOG.md).

**Publish flow:** after edits, Nick exports/pastes the updated handbook to the crew Drive
folder as a Google Doc or PDF. The crew reads the Drive copy; they never see this repo.

**Screenshots:** live in `screenshots/`, embedded with standard markdown image links.
When a flow's UI changes, re-capture the affected shot in the same PR as the text edit.
A `[SCREENSHOT: …]` marker in the text is a placeholder for a shot not yet captured.
