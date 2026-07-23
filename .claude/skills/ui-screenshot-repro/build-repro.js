#!/usr/bin/env node
// Builds a standalone HTML repro of a SilverFox App view using the REAL
// project styles (every <style> block from SharedUtils.html + the view
// fragment), so headless Chrome can screenshot the actual rendered layout.
//
//   node .claude/skills/ui-screenshot-repro/build-repro.js \
//     --view ViewRun.html --body snippet.html --out repro.html [--theme dark]
//
// --view   view fragment filename (repo root); repeatable for multi-view CSS
// --body   file with the DOM under test (the markup INSIDE the view root,
//          with realistic data — real VINs, long status strings, etc.)
// --out    output HTML path
// --theme  optional data-theme id (e.g. dark, gruvbox) — palette tokens only;
//          App.html structural overrides (Encarta/Luna) are NOT included
// --id     view root id (default: taken from the first --view, e.g. view-run)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');   // repo root

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    (args[k] = args[k] || []).push(process.argv[++i]);
  }
}
if (!args.view || !args.body || !args.out) {
  console.error('usage: build-repro.js --view ViewX.html --body snippet.html --out repro.html [--theme dark] [--id view-x]');
  process.exit(1);
}

function styleBlocks(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const out = [];
  const re = /<style>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  if (!out.length) console.error('WARNING: no <style> blocks in ' + file);
  return out.join('\n');
}

// view root id: ViewRun.html → view-run (matches the fragments' naming)
const viewId = (args.id && args.id[0]) ||
  'view-' + path.basename(args.view[0], '.html').replace(/^View/, '').toLowerCase();

const css = [styleBlocks('SharedUtils.html')]
  .concat(args.view.map(styleBlocks)).join('\n');
const body = fs.readFileSync(args.body[0], 'utf8');
const themeAttr = args.theme ? ` data-theme="${args.theme[0]}"` : '';

const html = `<!doctype html><html${themeAttr}><head><meta charset="utf-8"><style>
${css}
/* repro shell: stand-in for the App.html modal — geometry inside the view is
   representative; modal-level sizing is not. */
html, body { margin: 0; height: 100%; }
.view { display: block !important; height: 100vh; }
</style></head><body>
<div class="view" id="${viewId}">
${body}
</div>
</body></html>`;

fs.writeFileSync(args.out[0], html);
console.log('wrote ' + args.out[0] + ' (view root #' + viewId + ')');
