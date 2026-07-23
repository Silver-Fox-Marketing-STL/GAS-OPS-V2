---
name: ui-screenshot-repro
description: Use when changing SilverFox App view-fragment or SharedUtils CSS/layout and the result can't be verified by reading code — especially after a UI change came out different from what Nick described or mocked up, before deploying another attempt; also when layout depends on window width, table auto-sizing, theme, or content length.
---

# UI Screenshot Repro

## Overview

Deploying CSS theories to dev and asking Nick to look is a blind, slow loop.
Build a standalone HTML repro with the REAL project styles, screenshot it in
headless Chrome, and look at the pixels yourself — before any deploy.

Baseline failure this skill exists to prevent (July 2026, dedupe-button saga):
4 dev deploys in one evening, each a plausible-sounding CSS theory, all wrong.
The root cause (a block-level `<button>` shrinks to fit-content, unlike a div,
so it sat at the LEFT of a slack-widened table cell) was found in the FIRST
screenshot once one was finally taken.

## The rule

**After ONE failed attempt at matching a described or mocked design: stop
deploying. Repro + screenshot before the next attempt.** "The CSS should do X"
is a theory; the PNG is the fact.

## Workflow

1. **Write the DOM snippet** (scratchpad). Two rules that decide whether the
   render is trustworthy:
   - **Include the wrapper chain.** The view CSS is scoped to ancestors
     (`.rv-wrap > .rv-body > .rv-tablezone > .rv-table-scroll > table` for the
     Run table). Paste only the inner element and you silently lose borders,
     corner clips, and sizing. Copy the chain from the view fragment down to
     the element under test.
   - **Bake in by hand everything the view JS would compute.** Static markup
     is the pre-JS state: hidden buttons (`display:none`), empty counts, no
     row classes. Set them to the state under test yourself — button visible
     with its "(N)" count, `row-dup`/`row-warn` classes on rows, status
     suffixes, type pills — with REALISTIC data (real VIN widths, long status
     strings).
2. **Build the repro** (run from repo root):
   ```
   node .claude/skills/ui-screenshot-repro/build-repro.js --view ViewRun.html --body <scratchpad>\snippet.html --out <scratchpad>\repro.html
   ```
   Pulls every `<style>` block from SharedUtils.html + the view fragment(s).
   No `--theme` = default light tokens; `--theme dark` etc. for palette
   themes; `--view` is repeatable.
3. **Screenshot at MULTIPLE widths** — width-dependent bugs (table slack
   distribution, flex wrap) are invisible at one width. 1300 and 1900 minimum;
   change window-size AND the output filename together per width:
   ```powershell
   $out = & "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
     --window-size=1900,700 --screenshot="<scratchpad>/shot-1900.png" `
     --user-data-dir="<scratchpad>/chromeprofile" "file:///<scratchpad>/repro.html" 2>&1
   Start-Sleep 1
   ```
   The `file:///` URI wants forward slashes even on Windows. A clean run
   leaves `$out` EMPTY — success signal is the PNG existing after the sleep,
   not chrome's output.
4. **Read the PNG** (Read tool renders it). Compare against the description /
   mock. Wrong? Edit the real CSS file, rebuild the repro, re-shoot — iterate
   LOCALLY until the pixels match, then deploy ONCE.

## PowerShell gotchas (each cost real time)

| Symptom | Fix |
|---|---|
| `NativeCommandError`, or screenshot "fails" but chrome ran | Chrome logs to stderr; PS 5.1 wraps it. Capture: `$out = & chrome ... 2>&1` |
| `Test-Path` false right after chrome exits | PNG write lags — `Start-Sleep 1` first |
| Second concurrent shot never appears | One `--user-data-dir` per concurrent chrome; sequential runs can share |
| Edge box without Chrome | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, same flags |

## Limits — do not over-trust the repro

- **App.html is NOT included:** Encarta/Luna structural overrides (3D button
  bevels, `!important` borders) won't show. Palette themes are representative;
  XP-style themes are not.
- **CSS/layout only.** No `google.script.run`, no view JS — behavior bugs need
  the real app.
- Geometry *inside* the view is trustworthy; modal-level sizing (the `.view`
  shell height) is approximated.

## Red flags — build the repro NOW

- About to redeploy a CSS tweak after the last one "should have worked"
- Explaining to Nick why the render *ought* to look right
- The words "that should fix it" about anything visual, twice
