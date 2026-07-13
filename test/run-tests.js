// ============================================================================
// GAS ShortCut OPS — offline pure-logic assertion harness (Phase 3).
// Plain Node, zero deps: `node test/run-tests.js`. Exits 1 on any failure.
//
// Loads the FULL Code.gs via indirect eval after stubbing the few GAS globals
// it touches (verified: only ScriptApp.getScriptId at load time). Targets the
// pure functions that guard the recurring traps: type-rule ordering (CPO-EL
// before CPO), the fail-SAFE targeting engine, normalization maps, and the
// tolerant cell comparators. Anything needing live Sheets objects is out of
// scope here (Phase 4 gas-fakes territory).
// ============================================================================
'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('assert');

var ROOT = path.join(__dirname, '..');
var DEV_SCRIPT_ID = '1jbcjMNuopoO-WgzdG8me-7ZYscbi8xK8JuzmF9ajFPdioOrQlWOIWM5F';

// ── GAS global stubs — minimal, only what the tested paths touch ────────────
var currentScriptId = 'STRAY_DRIVE_COPY_SCRIPT_ID';
globalThis.ScriptApp = { getScriptId: function () { return currentScriptId; } };
globalThis.Logger = { log: function () {} };

function propStore_() {
  var m = {};
  return {
    getProperty: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setProperty: function (k, v) { m[k] = String(v); return this; },
    deleteProperty: function (k) { delete m[k]; return this; },
    getProperties: function () { return Object.assign({}, m); }
  };
}
var _scriptProps = propStore_(), _userProps = propStore_(), _docProps = propStore_();
globalThis.PropertiesService = {
  getScriptProperties: function () { return _scriptProps; },
  getUserProperties: function () { return _userProps; },
  getDocumentProperties: function () { return _docProps; }
};

// SpreadsheetApp: openById returns a fake config SS whose ONLY tab is a
// synthetic NORM_MAPS (cols A-C, like the live tab). Every other tab returns
// null, so getDataSchema_ / loadNormalizationMaps_ take their documented
// fallbacks — no Sheets mock layer, just the fallback paths Code.gs already has.
var NORM_MAPS_ROWS = [
  ['map', 'input', 'output'],
  ['global', '&amp;', '&'],
  ['global', 'undefined', '*'],
  ['type', 'Certified Used', 'CPO'],
  ['type', 'Certified Pre-Owned', 'CPO'],
  ['type', 'Used', 'PO']
];
var fakeNormSheet = {
  getDataRange: function () { return { getValues: function () { return NORM_MAPS_ROWS; } }; }
};
globalThis.SpreadsheetApp = {
  openById: function () {
    return {
      getSheetByName: function (name) { return name === 'NORM_MAPS' ? fakeNormSheet : null; }
    };
  }
};

// ── Load Code.gs (and PdFake.gs if the Pipedrive-fake branch has landed) ────
var codeSource = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
var pdFakePath = path.join(ROOT, 'PdFake.gs');
var pdFakeSource = fs.existsSync(pdFakePath) ? fs.readFileSync(pdFakePath, 'utf8') : null;
function loadAll() {
  if (pdFakeSource) (0, eval)(pdFakeSource);
  (0, eval)(codeSource);
}

var fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scraper-sample.json'), 'utf8'));
// Fixture column indices (base-21 schema): 0 VIN, 1 Stock, 2 Type, 3 Year,
// 4 Make, 5 Model, 6 Trim, 8 Status, 9 Price, 19 Location, 20 Vehicle URL.
function rows_() { return fixture.rows.map(function (r) { return r.slice(); }); }
function row_(overrides) {  // clone fixture row 0, override by column index
  var r = fixture.rows[0].slice();
  Object.keys(overrides || {}).forEach(function (i) { r[Number(i)] = overrides[i]; });
  return r;
}

// ── Tiny runner ──────────────────────────────────────────────────────────────
var suites = [];
var curr = null;
function suite(name) { curr = { name: name, pass: 0, fail: 0 }; suites.push(curr); }
function t(desc, fn) {
  try { fn(); curr.pass++; }
  catch (e) {
    curr.fail++;
    console.error('  FAIL [' + curr.name + '] ' + desc);
    console.error('    ' + (e && e.message));
  }
}

// ============================================================================
// Suite: ENV resolver — the scriptId IS the environment
// ============================================================================
suite('ENV resolver');
t('unknown scriptId throws Unknown scriptId (stray Drive copy can never hit prod)', function () {
  currentScriptId = 'STRAY_DRIVE_COPY_SCRIPT_ID';
  assert.throws(loadAll, /Unknown scriptId/);
});
t('dev scriptId resolves ENV.name === dev', function () {
  currentScriptId = DEV_SCRIPT_ID;
  loadAll();  // full re-eval with the dev stub — all globals now defined
  assert.strictEqual(ENV.name, 'dev');
});
t('dev ENV binds the DEV sheet IDs to the constants', function () {
  assert.strictEqual(MASTER_SHEET_ID, '1-0rHSoBmQip-yi_dB_S-kz-2fjc6x7pOxlbg2S7PEjk');
  assert.strictEqual(CONFIG_SHEET_ID, '1ajpIn_TD7fOZ_rZZMfK6KSdJ4niqiB4l85eC0dok5lA');
});

if (typeof ENV === 'undefined' || !ENV) {
  console.error('Code.gs failed to eval-load — aborting (see FAIL above).');
  report_();
  process.exit(1);
}

// ============================================================================
// Suite: isTrue_ / cellsEqual_ — Sheets typed-cell tolerance
// ============================================================================
suite('isTrue_/cellsEqual_');
t('isTrue_ accepts boolean true and TRUE strings (any case)', function () {
  assert.strictEqual(isTrue_(true), true);
  assert.strictEqual(isTrue_('TRUE'), true);
  assert.strictEqual(isTrue_('true'), true);
});
t('isTrue_ rejects false/FALSE/empty/other', function () {
  assert.strictEqual(isTrue_(false), false);
  assert.strictEqual(isTrue_('FALSE'), false);
  assert.strictEqual(isTrue_(''), false);
  assert.strictEqual(isTrue_('yes'), false);
});
t('cellsEqual_: number vs string of same value (getValues() typed cells)', function () {
  assert.strictEqual(cellsEqual_(2024, '2024'), true);
  assert.strictEqual(cellsEqual_('06234', 6234), true);  // zip losing leading zero
  assert.strictEqual(cellsEqual_('1.0', '1'), true);
});
t('cellsEqual_: trims strings, empty stays strict', function () {
  assert.strictEqual(cellsEqual_(' x ', 'x'), true);
  assert.strictEqual(cellsEqual_('', ''), true);
  assert.strictEqual(cellsEqual_('', 0), false);   // empty never numeric-matches
});
t('cellsEqual_: genuinely different values differ', function () {
  assert.strictEqual(cellsEqual_('abc', 'abd'), false);
  assert.strictEqual(cellsEqual_(1, 2), false);
});

// ============================================================================
// Suite: type rules — buildTypeRulesFromProductMap_ + matchRule_
// ============================================================================
suite('type rules');
var pm = {
  'CPO':    { product_id: 1, schema: 'SCP',    utm: 'VDP_CPO' },
  'New':    { product_id: 2, schema: 'SC',     utm: 'VDP_New' },
  'CPO-EL': { product_id: 3, schema: 'SCP_EL', utm: 'VDP_EL' },
  'PO':     { product_id: 4, schema: 'SCP',    utm: 'VDP_PO' }
};
var rules = buildTypeRulesFromProductMap_(pm);
t('longest match first: CPO-EL sorts before CPO', function () {
  var order = rules.map(function (r) { return r.match; });
  assert.strictEqual(order[0], 'CPO-EL');
  assert.ok(order.indexOf('CPO-EL') < order.indexOf('CPO'));
});
t('full order is deterministic (length desc, then alpha)', function () {
  assert.deepStrictEqual(rules.map(function (r) { return r.match; }),
    ['CPO-EL', 'CPO', 'New', 'PO']);
});
t('rules carry schema + utm as strings', function () {
  assert.deepStrictEqual(rules[0], { match: 'CPO-EL', csv_schema: 'SCP_EL', utm: 'VDP_EL' });
});
t('missing schema/utm become empty strings; null/empty map is []', function () {
  assert.deepStrictEqual(buildTypeRulesFromProductMap_({ X: {} })[0],
    { match: 'X', csv_schema: '', utm: '' });
  assert.deepStrictEqual(buildTypeRulesFromProductMap_(null), []);
});
t('a CPO-EL vehicle matches CPO-EL, never CPO', function () {
  assert.strictEqual(matchRule_('CPO-EL', rules).match, 'CPO-EL');
});
t('matchRule_ is case-insensitive substring', function () {
  assert.strictEqual(matchRule_('cpo-el', rules).match, 'CPO-EL');
  assert.strictEqual(matchRule_('CPO', rules).match, 'CPO');
  assert.strictEqual(matchRule_('New', rules).csv_schema, 'SC');
});
t('the trap the sort prevents: unsorted CPO-before-CPO-EL steals the match', function () {
  var unsorted = [{ match: 'CPO' }, { match: 'CPO-EL' }];
  assert.strictEqual(matchRule_('CPO-EL', unsorted).match, 'CPO');  // wrong on purpose
});
t('a star rule matches anything immediately', function () {
  var star = [{ match: '*', csv_schema: 'SCP', utm: 'U' }];
  assert.strictEqual(matchRule_('Anything', star).csv_schema, 'SCP');
});
t('no match falls back to the LAST rule (documented actual behavior)', function () {
  assert.strictEqual(matchRule_('Unmapped Thing', rules), rules[rules.length - 1]);
});
t('validateProductMapForRun_ reports missing entry / product_id / schema', function () {
  assert.deepStrictEqual(validateProductMapForRun_(['CPO'], pm), []);
  assert.deepStrictEqual(validateProductMapForRun_(['XYZ'], pm), ['XYZ']);
  assert.deepStrictEqual(validateProductMapForRun_(['A'], { A: { schema: 'SCP' } }), ['A']);   // no product_id
  assert.deepStrictEqual(validateProductMapForRun_(['B'], { B: { product_id: 9 } }), ['B']);   // no schema
});

// ============================================================================
// Suite: normalization — buildNormLookup_/normalizeCell_/normalizeScraperData_
// (NORM_MAPS rows come from the fake sheet above: global + type maps only;
//  trim/status/price fall back to the hardcoded NORMALIZATION_MAPS.)
// ============================================================================
suite('normalization');
t('normalizeCell_: case-insensitive exact full-cell match', function () {
  var lookup = buildNormLookup_([['Certified Used', 'CPO']]);
  assert.strictEqual(normalizeCell_('CERTIFIED USED', lookup), 'CPO');
  assert.strictEqual(normalizeCell_('certified used', lookup), 'CPO');
});
t('normalizeCell_: no match returns the value trimmed, unchanged', function () {
  var lookup = buildNormLookup_([['bar', 'baz']]);
  assert.strictEqual(normalizeCell_('  Foo  ', lookup), 'Foo');
});
t('loadNormalizationMaps_ merges sheet rows over hardcoded fallbacks per map', function () {
  var maps = loadNormalizationMaps_();
  assert.deepStrictEqual(maps.type, [
    ['Certified Used', 'CPO'], ['Certified Pre-Owned', 'CPO'], ['Used', 'PO']
  ]);
  assert.deepStrictEqual(maps.trim, NORMALIZATION_MAPS.trim);  // absent in sheet: fallback
});
t('normalizeScraperData_: type map normalizes col C (Certified Used to CPO, used to PO)', function () {
  var out = normalizeScraperData_([row_({ 2: 'Certified Used' }), row_({ 2: 'used' })]);
  assert.strictEqual(out[0][2], 'CPO');
  assert.strictEqual(out[1][2], 'PO');
});
t('normalizeScraperData_: global map runs on every column (&amp; and undefined)', function () {
  var out = normalizeScraperData_([row_({ 4: '&amp;', 7: 'undefined' })]);
  assert.strictEqual(out[0][4], '&');
  assert.strictEqual(out[0][7], '*');
});
t('normalizeScraperData_: empty cells become *, unmatched cells just trim', function () {
  var out = normalizeScraperData_([row_({ 4: '', 2: '  New  ' })]);
  assert.strictEqual(out[0][4], '*');
  assert.strictEqual(out[0][2], 'New');
});
t('normalizeScraperData_: untouched fixture values pass through (VIN, Location)', function () {
  var out = normalizeScraperData_(rows_());
  assert.strictEqual(out[0][0], 'JM3KE2CYXE0305592');
  assert.strictEqual(out[0][19], 'Auffenberg Hyundai');
});

// ============================================================================
// Suite: targeting conditions — conditionMatches_/groupMatches_/ruleMatches_
// ============================================================================
suite('targeting conditions');
var cpoRow = fixture.rows[2];      // 2021 Hyundai Sonata, CPO, price 18019
var poRow  = fixture.rows[0];      // 2014 Mazda CX-5, PO
t('in / not_in are case-insensitive exact', function () {
  assert.strictEqual(conditionMatches_(cpoRow, { field: 'type', op: 'in', values: ['cpo'] }), true);
  assert.strictEqual(conditionMatches_(poRow,  { field: 'type', op: 'in', values: ['CPO'] }), false);
  assert.strictEqual(conditionMatches_(cpoRow, { field: 'type', op: 'not_in', values: ['New'] }), true);
});
t('contains / not_contains are case-insensitive substring', function () {
  var santaFe = fixture.rows[7];   // model Santa Fe
  assert.strictEqual(conditionMatches_(santaFe, { field: 'model', op: 'contains', values: ['santa'] }), true);
  assert.strictEqual(conditionMatches_(santaFe, { field: 'model', op: 'not_contains', values: ['santa'] }), false);
  assert.strictEqual(conditionMatches_(poRow,   { field: 'model', op: 'not_contains', values: ['santa'] }), true);
});
t('numeric ops strip dollar signs and commas from BOTH cell and threshold', function () {
  var r = row_({ 9: '$18,019' });
  assert.strictEqual(conditionMatches_(r, { field: 'price', op: 'gte', values: ['18000'] }), true);
  assert.strictEqual(conditionMatches_(r, { field: 'price', op: 'lte', values: ['$18,000'] }), false);
  assert.strictEqual(conditionMatches_(r, { field: 'price', op: 'lt',  values: ['$20,000'] }), true);
  assert.strictEqual(conditionMatches_(r, { field: 'price', op: 'gt',  values: ['20,000'] }), false);
});
t('fail-safe: unparseable number cell means no match', function () {
  assert.strictEqual(conditionMatches_(row_({ 9: '*' }), { field: 'price', op: 'gte', values: ['1'] }), false);
});
t('fail-safe: unknown field / unknown op / empty values / missing keys mean no match', function () {
  assert.strictEqual(conditionMatches_(cpoRow, { field: 'colour', op: 'in', values: ['x'] }), false);
  assert.strictEqual(conditionMatches_(cpoRow, { field: 'type', op: 'equals', values: ['CPO'] }), false);
  assert.strictEqual(conditionMatches_(cpoRow, { field: 'type', op: 'in', values: [] }), false);
  assert.strictEqual(conditionMatches_(cpoRow, { field: 'type' }), false);
  assert.strictEqual(conditionMatches_(cpoRow, null), false);
});
t('contains skips empty-string values (fail-safe)', function () {
  assert.strictEqual(conditionMatches_(cpoRow, { field: 'type', op: 'contains', values: [''] }), false);
});
var condCpo = { field: 'type', op: 'in', values: ['CPO'] };
var condHyu = { field: 'make', op: 'in', values: ['Hyundai'] };
var condNew = { field: 'type', op: 'in', values: ['New'] };
t('groupMatches_: all is AND, any is OR, default is all', function () {
  assert.strictEqual(groupMatches_(cpoRow, { match: 'all', children: [condCpo, condHyu] }), true);
  assert.strictEqual(groupMatches_(cpoRow, { match: 'all', children: [condCpo, condNew] }), false);
  assert.strictEqual(groupMatches_(cpoRow, { match: 'any', children: [condNew, condCpo] }), true);
  assert.strictEqual(groupMatches_(cpoRow, { match: 'any', children: [condNew] }), false);
  assert.strictEqual(groupMatches_(cpoRow, { children: [condCpo, condHyu] }), true);  // default all
});
t('groupMatches_: nested groups recurse', function () {
  var nested = { match: 'any', children: [{ match: 'all', children: [condCpo, condHyu] }, condNew] };
  assert.strictEqual(groupMatches_(cpoRow, nested), true);
  assert.strictEqual(groupMatches_(poRow, nested), false);
});
t('fail-safe: empty/invalid group and rule-without-group mean no match', function () {
  assert.strictEqual(groupMatches_(cpoRow, { match: 'all', children: [] }), false);
  assert.strictEqual(groupMatches_(cpoRow, null), false);
  assert.strictEqual(ruleMatches_(cpoRow, { action: 'exclude_order' }), false);
  assert.strictEqual(ruleMatches_(cpoRow, null), false);
});

// ============================================================================
// Suite: filtering phases — applyFilteringRules_ truth table + import drop
// ============================================================================
suite('filtering phases');
function cfgRow_(filterJson) {  // synthetic DEALERS row: col W = filtering_rules
  var cfg = [];
  cfg[CFG.KEY] = 'TEST_DEALER';
  cfg[CFG.FILTER_RULES] = filterJson;
  return cfg;
}
var phaseRules = getDealerFilterRules_(cfgRow_(JSON.stringify({
  targeting_rules: [
    { action: 'exclude_order',  group: { match: 'all', children: [{ field: 'type', op: 'in', values: ['CPO'] }] } },
    { action: 'exclude_cao',    group: { match: 'all', children: [{ field: 'type', op: 'in', values: ['New'] }] } },
    { action: 'drop_on_import', group: { match: 'all', children: [{ field: 'make', op: 'in', values: ['Jeep'] }] } }
  ],
  cao_exclude_types: ['PO']
})));
// Fixture type mix: 5 PO (one Jeep), 2 CPO, 3 New.
t('run phase: exclude_order fires; exclude_cao, cao_exclude_types, drop_on_import do NOT', function () {
  var res = applyFilteringRules_(rows_(), phaseRules, 'run');
  assert.strictEqual(res.passed.length, 8);
  assert.strictEqual(res.rejected.length, 2);
  res.rejected.forEach(function (r) { assert.strictEqual(r.reason, 'rule:exclude_order'); });
  assert.ok(res.passed.some(function (r) { return r[4] === 'Jeep'; }));  // drop_on_import ignored at run
});
t('cao phase: exclude_order + exclude_cao + cao_exclude_types all fire', function () {
  var res = applyFilteringRules_(rows_(), phaseRules, 'cao');
  assert.strictEqual(res.passed.length, 0);
  var byReason = {};
  res.rejected.forEach(function (r) { byReason[r.reason] = (byReason[r.reason] || 0) + 1; });
  assert.deepStrictEqual(byReason,
    { 'rule:exclude_order': 2, 'rule:exclude_cao': 3, 'cao_excluded': 5 });
});
t('drop_on_import never fires inside applyFilteringRules_ (either phase)', function () {
  ['run', 'cao'].forEach(function (phase) {
    var res = applyFilteringRules_(rows_(), phaseRules, phase);
    res.rejected.forEach(function (r) { assert.notStrictEqual(r.reason, 'rule:drop_on_import'); });
  });
});
t('dropRowsOnImport_ drops matching rows only within the configured Location', function () {
  var dropRule = { action: 'drop_on_import', group: { match: 'all', children: [{ field: 'make', op: 'in', values: ['Jeep'] }] } };
  var res = dropRowsOnImport_(rows_(), { 'auffenberg hyundai': [dropRule] });
  assert.strictEqual(res.dropped, 1);
  assert.strictEqual(res.rows.length, 9);
  assert.ok(!res.rows.some(function (r) { return r[4] === 'Jeep'; }));
  var other = dropRowsOnImport_(rows_(), { 'some other dealer': [dropRule] });
  assert.strictEqual(other.dropped, 0);   // Location-scoped: other dealers untouched
});
t('fail-safe: an empty-group rule keeps every vehicle (misconfig can never mass-exclude)', function () {
  var fr = getDealerFilterRules_(cfgRow_(JSON.stringify({
    targeting_rules: [{ action: 'exclude_order', group: { match: 'all', children: [] } }]
  })));
  assert.strictEqual(applyFilteringRules_(rows_(), fr, 'run').passed.length, 10);
  assert.strictEqual(applyFilteringRules_(rows_(), fr, 'cao').passed.length, 10);
});
t('fail-safe: unknown-field rule keeps every vehicle', function () {
  var fr = getDealerFilterRules_(cfgRow_(JSON.stringify({
    targeting_rules: [{ action: 'exclude_order', group: { match: 'all', children: [{ field: 'nope', op: 'in', values: ['x'] }] } }]
  })));
  assert.strictEqual(applyFilteringRules_(rows_(), fr, 'run').passed.length, 10);
});
t('fail-safe: unparseable filtering_rules JSON falls back to defaults (nothing filtered)', function () {
  var fr = getDealerFilterRules_(cfgRow_('{not json'));
  assert.strictEqual(fr.allowedTypes, null);
  assert.deepStrictEqual(fr.targetingRules, []);
  assert.strictEqual(applyFilteringRules_(rows_(), fr, 'run').passed.length, 10);
});

// ── Report ───────────────────────────────────────────────────────────────────
function report_() {
  var totalPass = 0, totalFail = 0;
  console.log('');
  suites.forEach(function (s) {
    totalPass += s.pass; totalFail += s.fail;
    console.log('  ' + s.name + ': ' + s.pass + '/' + (s.pass + s.fail));
  });
  console.log('');
  console.log('TOTAL ' + totalPass + '/' + (totalPass + totalFail) + (totalFail ? ' — FAIL' : ' — PASS'));
}
report_();
process.exitCode = suites.some(function (s) { return s.fail > 0; }) ? 1 : 0;
