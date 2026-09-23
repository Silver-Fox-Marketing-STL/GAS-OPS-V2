#!/usr/bin/env node
// Builds a standalone, fully-scripted copy of the SilverFox App (App.html +
// every included fragment) with google.script.run replaced by a mock that
// serves realistic data from mock-data.js. Output: app.html next to this file.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');   // repo root
const OUT = path.join(__dirname, 'app.html');

let html = fs.readFileSync(path.join(ROOT, 'App.html'), 'utf8');

// 1. Resolve <?!= include_('X') ?> with the real fragment contents.
html = html.replace(/<\?!=\s*include_\('([^']+)'\)\s*\?>/g, (m, name) =>
  fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8'));

// 2. Server-side scriptlets → static values (theme/view are set by the harness).
html = html.replace(/<\?=\s*initialTheme\s*\?>/g, 'light')
           .replace(/<\?=\s*appMode\s*\?>/g, 'webapp')
           .replace(/<\?=\s*initialNavLayout\s*\?>/g, 'sidebar')
           .replace(/<\?=\s*ENV\.name[\s\S]*?\?>/g, '');

if (/<\?[=!]/.test(html)) {
  const left = html.match(/<\?[=!][^?]*\?>/g);
  console.error('Unresolved scriptlets:', left);
  process.exit(1);
}

// 3. Inject the mock google.script.run + data BEFORE SharedUtils (first thing in <body>).
const mockTag = '<script src="mock-data.js"></script><script src="mock-data-settings.js"></script><script src="mock-gsr.js"></script>';
html = html.replace('<body>', '<body>\n' + mockTag);

// 4. Harness driver at the very end (after the shell boot script).
html = html.replace('</body>', '<script src="harness.js"></script>\n</body>');

fs.writeFileSync(OUT, html);
console.log('wrote ' + OUT + ' (' + html.length + ' bytes)');
