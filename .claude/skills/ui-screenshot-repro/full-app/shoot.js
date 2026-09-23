#!/usr/bin/env node
// Screenshot every (theme × scenario) of the mocked app.
//   node shoot.js --themes light,dark --scenarios home,run-vins --width 1440 --height 900 --out shots
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[++i];
}
const THEMES = (args.themes || 'light').split(',');
const WIDTH = +(args.width || 1440), HEIGHT = +(args.height || 900);
const OUT = path.resolve(__dirname, args.out || 'shots');
const APP = 'file:///' + path.resolve(__dirname, 'app.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-gpu', '--hide-scrollbars=false', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  const consoleLog = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => consoleLog.push('pageerror: ' + e.message));

  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForFunction('window.HARNESS_READY === true');
  let scenarios = (args.scenarios ? args.scenarios.split(',') : await page.evaluate('HARNESS.scenarios'));
  const report = {};

  for (const theme of THEMES) {
    fs.mkdirSync(path.join(OUT, theme), { recursive: true });
    for (const sc of scenarios) {
      consoleLog.length = 0;
      await page.goto(APP + '?theme=' + theme, { waitUntil: 'load' });
      await page.waitForFunction('window.HARNESS_READY === true');
      await page.evaluate(() => document.fonts.ready);
      let res;
      try { res = await page.evaluate(n => HARNESS.run(n), sc); }
      catch (e) { res = { unknown: [], errors: ['HARNESS: ' + e.message] }; }
      const file = path.join(OUT, theme, sc + '-' + WIDTH + '.png');
      await page.screenshot({ path: file });
      report[theme + '/' + sc] = { unknown: res.unknown, errors: res.errors.concat(consoleLog) };
      const flags = (res.unknown.length ? ' unknown=' + res.unknown.join(',') : '') + (res.errors.length || consoleLog.length ? ' ERR=' + res.errors.concat(consoleLog).join(' | ').slice(0, 300) : '');
      console.log(theme + '/' + sc + flags);
    }
  }
  fs.writeFileSync(path.join(OUT, 'report-' + WIDTH + '.json'), JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
