# VDP Batch Automation (pilot)

One-click daily operation for the Illustrator middle of the Variable Data Print
pipeline: operator picks OPS-exported CSV(s) → each record is filled into the
paired template through its existing variable bindings, overflowing point text is
auto-fit (shrink font size only), each record's QR is relinked, and every record
is exported as a PDF, then merged into **one multi-page print PDF per CSV** for
VersaWorks. Replaces the manual Variables-import → step-datasets → hand-resize →
Actions-export → Acrobat-combine middle.

> **Pilot status.** Phase 1 — local build/test in this repo. Template pairing is a
> hand-edited `template-map.json` and the operator picks the template per CSV in a
> dialog. Phase 2 (OPS integration: `template_map` in DEALER_CONFIG + a `manifest.json`
> OPS emits alongside the CSV) is deliberately **not** built here.

## Files

| File | What it is |
|---|---|
| `run-vdp-batch.ps1` | The one-click entry point (pre-flight → launch Illustrator → qpdf merge). |
| `vdp-batch.jsx` | The ExtendScript engine that fills, fits, and exports per-record PDFs. |
| `template-map.json` | Dealer/type → template `.ai` path. Seeds the picker dropdown. |
| `lib/json2.js` | JSON support for ExtendScript (ES3 has none). |
| `bin/` | Drop `qpdf.exe` here (see `bin/README.txt`). |

## One-time setup

1. **Install qpdf.** Put a portable `qpdf.exe` in `bin\` (or have it on PATH). See
   [`bin/README.txt`](bin/README.txt).
2. **Prep each template (~5 min, overflow-capable fields only).** In the `.ai`,
   add a hidden layer named exactly **`FIT_BOUNDS`**. On it, draw one rectangle per
   overflow-prone text field and **name the rectangle exactly after the variable**
   that feeds that field (Variables panel → the variable `name`; Layers panel → rename
   the rectangle to match). The rectangle's **width** is the allowed width — text wider
   than it gets shrunk to fit.
   - A field with **no** matching rectangle is **never resized** (this is how the one
     appearance-panel-warped field is left alone — just don't give it a rect).
   - The layer can stay hidden; only its rectangle geometry is read.
3. **Fill in `template-map.json`** with the pilot dealer's template paths (see the
   `_EXAMPLE_DEALER` entry for the shape). Optional — you can always **Browse…** to a
   template in the dialog instead.

## Daily run

1. Double-click / run `run-vdp-batch.ps1`.
2. Pick one or more OPS CSVs.
3. **Pre-flight** checks every QR / linked-image path in those CSVs exists. Missing
   links are listed; you choose whether to continue (missing-QR rows are flagged and
   their QR skipped, the batch still runs).
4. Illustrator opens with the **template picker** — choose a template per CSV
   (dropdown of `template-map.json` presets, or **Browse…**), then **Run batch**.
5. Per-record PDFs export to `%TEMP%\vdp-batch\<csv>\`, then qpdf merges them into
   `_VDP_OUTPUT\<csv>_<timestamp>.pdf` next to your CSVs. The output folder opens; a
   `_runlog.txt` sits beside each PDF.

You can also run `vdp-batch.jsx` directly (File > Scripts > Other Script) for template
testing — it will prompt for CSVs and export per-record PDFs, but **won't** merge
(no qpdf step). Use the `.ps1` for the real run.

## How it works (the three decisions that matter)

- **Variables-free binding.** We do **not** import the CSV into the Variables panel
  (not scriptable, flaky). The template already has bindings; the script reads
  `doc.variables[i]` from the DOM (`.name` = CSV column, `.kind` TEXTUAL/IMAGE,
  `.pageItems` = bound objects) and pushes values straight in. Zero template rework
  for data.
- **Restore-then-fit** (prevents the #1 batch-fit bug). Font-size edits persist across
  records, so sizes would ratchet down permanently. The script snapshots every bound
  text frame's original size once, **restores it before every record**, then fits.
  Running the same CSV twice yields identical output.
- **Shrink-only fit, one-shot math.** All overflow fields are point text, whose width
  scales linearly with size, so: `newSize = origSize × (allowedWidth / renderedWidth)`.
  A **legibility floor** (`FLOOR_RATIO`, default 60%) caps the shrink; a value that
  would go below it is left at the floor and **flagged in the run log** — the batch
  continues. No horizontal condensing.

## Config knobs

- `vdp-batch.jsx` top: `FLOOR_RATIO` (legibility floor), `PDF_PRESET` (name of an
  Illustrator PDF preset for print output; blank = built-in defaults).
- `run-vdp-batch.ps1` top: `$LinkExtensions` (which path columns pre-flight checks).

## Troubleshooting

- **"qpdf.exe not found"** → drop it in `bin\` (see `bin/README.txt`).
- **"Could not start Illustrator via COM"** → Illustrator must be installed. As a
  fallback, run `vdp-batch.jsx` manually via File > Scripts (no auto-merge).
- **Text not shrinking** → the `FIT_BOUNDS` rectangle name must match the variable
  `name` exactly (case-sensitive), and the field must be **point** text.
- **QR blank / row flagged** → the `@QR` path in the CSV doesn't exist locally; check
  the QR download step / `qr_local_base_path`. Pre-flight lists these before the run.
- **Page count ≠ row count** → check the CSV's `_runlog.txt` for per-row errors; the
  temp folder is wiped at the start of each run so stale PDFs can't inflate the count.

## Phase 2 (not built here)

`template_map` field in DEALER_CONFIG (cloned from the Pipedrive `product_map` pattern
+ its settings-UI editor) → OPS exports a `manifest.json` alongside the CSV (template
path, csv, output name) so the `.jsx` needs zero inference → optional VersaWorks hot
folder. File as a gas-ops-v2 open-issue when greenlit.
