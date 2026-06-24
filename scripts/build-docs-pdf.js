#!/usr/bin/env node
/*
 * build-docs-pdf.js — render Markdown docs to nicely-formatted, print-ready PDFs.
 *
 * Pipeline:  Markdown --(marked)--> styled HTML --(headless Chrome)--> PDF.
 * Project-agnostic: pass any .md files; output goes to --out (default ./docs/pdf).
 *
 * SETUP (one-time):   cd scripts && npm install        # installs `marked`
 * USAGE (from repo root):
 *   node scripts/build-docs-pdf.js [--out <dir>] [--keep-html] <file.md> [more.md ...]
 * EXAMPLES:
 *   node scripts/build-docs-pdf.js --out docs/pdf CLAUDE.md README.md docs/*.md
 *   CHROME_PATH="/path/to/chrome" node scripts/build-docs-pdf.js docs/Guide.md
 *
 * - Chrome/Edge is auto-detected (Windows/macOS/Linux); override with the CHROME_PATH env var.
 * - Output PDFs are named by the .md basename, so basenames must be unique across your set.
 *
 * The CSS below is tuned for technical docs with WIDE tables. The key choice is
 * `overflow-wrap: break-word` on cells (wrap at spaces; only break a genuinely-too-long
 * token like a 40-char hash) — NOT `word-break`/`overflow-wrap: anywhere`, which squeeze
 * prose into narrow columns and break normal words mid-character. Tweak to taste.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let marked;
try { marked = require('marked').marked; }
catch (e) {
  console.error('Missing dependency "marked". Run:  cd ' + __dirname + ' && npm install');
  process.exit(1);
}

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let outDir = 'docs/pdf', keepHtml = false;
const mdFiles = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outDir = argv[++i];
  else if (argv[i] === '--keep-html') keepHtml = true;
  else mdFiles.push(argv[i]);
}
if (!mdFiles.length) {
  console.error('No .md files given.\n  Usage: node build-docs-pdf.js [--out <dir>] [--keep-html] <file.md> ...');
  process.exit(1);
}

// ── locate Chrome / Edge ─────────────────────────────────────────────────────
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser', '/usr/bin/chromium'
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

// ── print CSS (Markdown technical docs; wide-table friendly) ─────────────────
const CSS = `
<style>
@page { size: Letter; margin: 13mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Segoe UI", -apple-system, Arial, sans-serif; font-size: 10.5px; line-height: 1.5; color: #1b1b1b; }
h1 { font-size: 20px; border-bottom: 2px solid #444; padding-bottom: 5px; margin: 0 0 12px; }
h2 { font-size: 15px; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin: 20px 0 8px; }
h3 { font-size: 12.5px; margin: 15px 0 6px; }
h4 { font-size: 11px; margin: 11px 0 5px; }
h1,h2,h3,h4 { page-break-after: avoid; }
p { margin: 6px 0; }

/* Inline code: wrap only long unbreakable tokens, never mid-normal-word. */
code { font-family: "Consolas","Courier New",monospace; background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font-size: 9px; overflow-wrap: break-word; }
pre { background: #f6f8fa; padding: 9px 11px; border: 1px solid #e1e4e8; border-radius: 5px; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.8px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: break-word; }

/* Tables: content-aware columns; cells wrap at SPACES (break-word, not anywhere) so prose
   reads normally and only a genuinely-too-long token (e.g. a 40-char hash) breaks. */
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9px; table-layout: auto; }
thead { display: table-header-group; }
th, td { border: 1px solid #c8c8c8; padding: 4px 7px; text-align: left; vertical-align: top; overflow-wrap: break-word; }
th { background: #ededed; font-weight: 600; }
tr:nth-child(even) td { background: #fafafa; }
td code, th code { background: #f3f3f3; white-space: normal; overflow-wrap: break-word; }

blockquote { border-left: 3px solid #ddd; margin: 8px 0; padding: 2px 12px; color: #555; }
a { color: #0b5cad; text-decoration: none; overflow-wrap: break-word; }
ul, ol { margin: 6px 0; padding-left: 22px; }
li { margin: 2px 0; }
hr { border: none; border-top: 1px solid #ddd; margin: 14px 0; }
img { max-width: 100%; }
strong { font-weight: 600; }
</style>`;

// ── render ───────────────────────────────────────────────────────────────────
marked.setOptions({ gfm: true, breaks: false });

const chrome = findChrome();
if (!chrome) {
  console.error('Could not find Chrome/Edge. Set CHROME_PATH=/path/to/chrome and retry.');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docpdf-'));
const profile = path.join(tmp, 'profile');
fs.mkdirSync(outDir, { recursive: true });

let ok = 0, fail = 0;
for (const rel of mdFiles) {
  try {
    const md = fs.readFileSync(rel, 'utf8');
    const base = path.basename(rel).replace(/\.md$/i, '');
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + base + '</title>' +
                 CSS + '</head><body>' + marked.parse(md) + '</body></html>';
    const htmlPath = path.join(tmp, base + '.html');
    fs.writeFileSync(htmlPath, html);
    const pdfPath = path.resolve(outDir, base + '.pdf').replace(/\\/g, '/');
    execFileSync(chrome, [
      '--headless', '--disable-gpu', '--no-pdf-header-footer',
      '--user-data-dir=' + profile,
      '--print-to-pdf=' + pdfPath,
      'file:///' + htmlPath.replace(/\\/g, '/')
    ], { stdio: 'ignore' });
    if (keepHtml) fs.copyFileSync(htmlPath, path.resolve(outDir, base + '.html'));
    console.log('  ' + path.relative(process.cwd(), pdfPath));
    ok++;
  } catch (e) {
    console.error('  FAILED ' + rel + ' — ' + e.message);
    fail++;
  }
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
console.log('\n' + ok + ' PDF(s) -> ' + outDir + (fail ? ' (' + fail + ' failed)' : ''));
process.exit(fail ? 1 : 0);
