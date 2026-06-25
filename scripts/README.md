# Doc PDF builder

`build-docs-pdf.js` renders the project's Markdown docs into clean, print-ready PDFs
(**Markdown → styled HTML → headless Chrome → PDF**). It's project-agnostic — pass any
`.md` files and it writes `<basename>.pdf` to the output dir.

## One-time setup
```sh
cd scripts
npm install        # installs `marked` (node_modules stays local / gitignored)
```

## Regenerate the PDFs — run from the **repo root**
This project's full set:
```sh
node scripts/build-docs-pdf.js --out docs/pdf \
  CLAUDE.md README.md CHANGELOG.md \
  docs/LEARNINGS.md docs/GAS_ShortCut_OPS_Development_Plan.md \
  docs/GAS_ShortCut_OPS_Project_Knowledge_Base.md docs/GAS_ShortCut_OPS_Bridge_System.md \
  docs/targeting_rules_migration.md
```
(On Windows PowerShell, put it on one line or use backtick line-continuations.)

PDFs land in `--out` (default `docs/pdf/`, which is **gitignored** — regenerate from the
`.md` sources rather than committing the binaries).

## Notes
- **Chrome or Edge is auto-detected** on Windows / macOS / Linux. If detection fails, set
  `CHROME_PATH=/path/to/chrome` and re-run.
- `--keep-html` also writes the intermediate HTML next to each PDF (handy for tweaking CSS).
- `.md` basenames must be **unique** across the set you pass (the PDF is named by the basename).
- The print CSS lives at the top of `build-docs-pdf.js`. It's tuned for technical docs with
  **wide tables**: cells wrap at spaces (`overflow-wrap: break-word`) so prose doesn't get
  squeezed into narrow columns or broken mid-word. Adjust margins / fonts / table sizing there.

## Reuse in other projects
Copy `scripts/` (the script + `package.json`), run `npm install`, then point it at that
project's `.md` files. Nothing here is SilverFox-specific except the example file list above.
