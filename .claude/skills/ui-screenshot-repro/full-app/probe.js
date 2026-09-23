#!/usr/bin/env node
// Computed-style probe: drive one scenario in one theme, then print the
// computed background / color / border / font / box of each selector's FIRST
// match. Use it when a screenshot shows the wrong color and you need to know
// WHICH rule won rather than guess.
//   node probe.js --theme dark --scenario rules-pipedrive --sel ".pd-org-clear,.pd-product-table input"
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[++i];
}
const THEME = args.theme || 'light';
const SCENARIO = args.scenario || 'home';
const SELS = (args.sel || 'body').split(',');
const WIDTH = +(args.width || 1440), HEIGHT = +(args.height || 900);
const APP = 'file:///' + path.resolve(__dirname, 'app.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-gpu', '--hide-scrollbars=false', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.goto(APP + '?theme=' + THEME, { waitUntil: 'load' });
  await page.waitForFunction('window.HARNESS_READY === true');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(n => HARNESS.run(n), SCENARIO);
  const out = await page.evaluate(sels => sels.map(sel => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel, tag: el.tagName.toLowerCase(), cls: el.className,
      bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 60), color: cs.color,
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      font: cs.fontSize + ' ' + cs.fontWeight + ' ' + cs.fontFamily.split(',')[0],
      appearance: cs.appearance, display: cs.display,
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',')
    };
  }), SELS);
  for (const o of out) console.log(JSON.stringify(o));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
