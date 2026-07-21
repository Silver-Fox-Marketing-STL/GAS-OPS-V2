// ============================================================================
// GAS ShortCut OPS — offline pure-logic assertion harness (Phase 3).
// Plain Node, zero deps: `node test/run-tests.js`. Exits 1 on any failure.
//
// Loads the FULL Code.gs via indirect eval after stubbing the few GAS globals
// it touches (verified: only ScriptApp.getScriptId at load time). Targets the
// pure functions that guard the recurring traps: type-rule ordering (CPO-EL
// before CPO), the fail-SAFE targeting engine, normalization maps, the
// tolerant cell comparators, and the money paths — Pipedrive line-item
// building (GROSS qty, catalog tax, variations) and CSV schema grouping.
// Anything needing live Sheets objects is out of scope (Phase 4 gas-fakes).
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
// Synthetic CSV_SCHEMAS (col A key, col B label, C+ ordered field codes) so
// getCsvSchema_ resolves offline — needed by the features/QR-skip suite.
var CSV_SCHEMAS_ROWS = [
  ['schema_key', 'label', '', '', '', ''],
  ['SCP',   'standard qr',      'YEARMODELSTOCK', 'TYPEVIN', '@QR', ''],
  ['SC',    'qr via qrstock',   'QRSTOCK', 'YEAR', '', ''],
  ['LOGO1', 'features, no qr',  'YEAR', 'YEARMODEL', 'FEATURES', 'MISC'],
  ['LOGO3', 'no features/qr',   'YEAR', 'YEARMODEL', 'MISC', ''],
  ['VDP1',  'versaworks vdp headers', 'YEAR:VDP_A', 'FEATURES:VDP_D', 'MISC:VDP_G', ''],
  ['VDP_EDIT', 'editable modeltrim',  'YEAR:VDP_A', 'MODELTRIM:VDP_B:edit18', 'MISC:VDP_G', '']
];
var fakeCsvSchemasSheet = {
  getDataRange: function () { return { getValues: function () { return CSV_SCHEMAS_ROWS; } }; }
};
globalThis.SpreadsheetApp = {
  openById: function () {
    return {
      getSheetByName: function (name) {
        if (name === 'NORM_MAPS') return fakeNormSheet;
        if (name === 'CSV_SCHEMAS') return fakeCsvSchemasSheet;
        return null;
      }
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
t('starts_with / not_starts_with are case-insensitive prefix', function () {
  var santaFe = fixture.rows[7];   // model Santa Fe
  assert.strictEqual(conditionMatches_(santaFe, { field: 'model', op: 'starts_with', values: ['santa'] }), true);
  assert.strictEqual(conditionMatches_(santaFe, { field: 'model', op: 'starts_with', values: ['fe'] }), false);
  assert.strictEqual(conditionMatches_(santaFe, { field: 'model', op: 'not_starts_with', values: ['santa'] }), false);
  assert.strictEqual(conditionMatches_(poRow,   { field: 'model', op: 'not_starts_with', values: ['santa'] }), true);
  assert.strictEqual(conditionMatches_(santaFe, { field: 'model', op: 'starts_with', values: [''] }), false);
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

// ============================================================================
// Suite: pipedrive line items — buildLineItems_/bySourceToBilling_/mergeLineItems_
// (the money path: GROSS quantities, catalog tax carried per line, variation
//  pricing/naming, not-in-catalog treated unavailable, SKU merge across types)
// ============================================================================
suite('pipedrive line items');
var CATALOG = [
  { id: 101, name: 'Shortcut Pack', prices: [{ currency: 'USD', price: 40 }], tax: 8.99, inactive: false },
  { id: 102, name: 'Shortcut', prices: [{ currency: 'EUR', price: 30 }, { currency: 'USD', price: 35 }], tax: 0, inactive: false },
  { id: 103, name: 'Retired Thing', prices: [{ currency: 'USD', price: 99 }], tax: 5, inactive: true }
];
var VARS = { '101': [{ id: 9001, name: 'Design Included', prices: [{ currency: 'USD', price: 55 }] }] };
function billing_(byType) { return { byType: byType }; }

t('quantity is GROSS — VIN-log dupes are still produced & billed, never subtracted', function () {
  var items = buildLineItems_(billing_({ 'New': { gross: 7, dupes: 3 } }),
    { 'New': { product_id: 101 } }, CATALOG, 'USD', {});
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].quantity, 7);
});
t('catalog price + Tax %% travel on the line (tax is sent explicitly on attach)', function () {
  var li = buildLineItems_(billing_({ 'New': { gross: 1 } }),
    { 'New': { product_id: 101 } }, CATALOG, 'USD', {})[0];
  assert.strictEqual(li.item_price, 40);
  assert.strictEqual(li.tax, 8.99);
  assert.strictEqual(li.inactive, false);
});
t('price picks the requested currency from a multi-currency list', function () {
  var li = buildLineItems_(billing_({ 'PO': { gross: 2 } }),
    { 'PO': { product_id: 102 } }, CATALOG, 'usd', {})[0];
  assert.strictEqual(li.item_price, 35);   // USD entry, not the first (EUR) one
});
t('same product+variation across types collapses to ONE line with summed qty', function () {
  var items = buildLineItems_(billing_({ 'New': { gross: 7 }, 'PO': { gross: 2 } }),
    { 'New': { product_id: 101 }, 'PO': { product_id: 101 } }, CATALOG, 'USD', {});
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].quantity, 9);
});
t('different variation of the same product stays a distinct line', function () {
  var items = buildLineItems_(billing_({ 'New': { gross: 1 }, 'PO': { gross: 1 } }),
    { 'New': { product_id: 101, variation_id: 9001 }, 'PO': { product_id: 101 } },
    CATALOG, 'USD', VARS);
  assert.strictEqual(items.length, 2);
  var varLine = items.filter(function (i) { return i.product_variation_id === 9001; })[0];
  assert.strictEqual(varLine.item_price, 55);                              // variation price wins
  assert.strictEqual(varLine.name, 'Shortcut Pack — Design Included');     // variation naming
});
t('unknown variation id falls back to the product price but keeps the variation id', function () {
  var li = buildLineItems_(billing_({ 'New': { gross: 1 } }),
    { 'New': { product_id: 101, variation_id: 9999 } }, CATALOG, 'USD', VARS)[0];
  assert.strictEqual(li.item_price, 40);
  assert.strictEqual(li.product_variation_id, 9999);
});
t('catalog-inactive and not-in-catalog products are flagged unavailable', function () {
  var items = buildLineItems_(billing_({ 'New': { gross: 1 }, 'PO': { gross: 1 } }),
    { 'New': { product_id: 103 }, 'PO': { product_id: 555 } }, CATALOG, 'USD', {});
  items.forEach(function (i) { assert.strictEqual(i.inactive, true); });
});
t('zero-count types, empty entries and missing product_id are skipped; bare id tolerated', function () {
  var items = buildLineItems_(billing_({ 'New': { gross: 0 }, 'CPO': { gross: 4 } }),
    { 'New': { product_id: 101 }, 'CPO': 102, 'PO': '', 'X': {} }, CATALOG, 'USD', {});
  assert.strictEqual(items.length, 1);   // only the bare-id CPO line survives
  assert.strictEqual(String(items[0].product_id), '102');
  assert.strictEqual(items[0].quantity, 4);
});
t('null billing or null product map yields no lines', function () {
  assert.deepStrictEqual(buildLineItems_(null, { 'New': { product_id: 101 } }, CATALOG, 'USD', {}), []);
  assert.deepStrictEqual(buildLineItems_(billing_({}), null, CATALOG, 'USD', {}), []);
});
t('bySourceToBilling_ shapes {type: qty} into byType gross (dupes 0, non-numeric 0)', function () {
  assert.deepStrictEqual(bySourceToBilling_({ 'New': '3', 'PO': 'x' }),
    { byType: { 'New': { gross: 3, dupes: 0 }, 'PO': { gross: 0, dupes: 0 } } });
  assert.deepStrictEqual(bySourceToBilling_(null), { byType: {} });
});
t('mergeLineItems_ sums quantities by product+variation and keeps variations apart', function () {
  var merged = mergeLineItems_([
    { product_id: 101, quantity: 2, item_price: 40, name: 'Shortcut Pack', tax: 8.99 },
    { product_id: 101, quantity: 3, item_price: 40, name: 'Shortcut Pack', tax: 8.99 },
    { product_id: 101, product_variation_id: 9001, quantity: 1, item_price: 55, name: 'V', tax: 8.99 }
  ]);
  assert.strictEqual(merged.length, 2);
  var plain = merged.filter(function (i) { return !i.product_variation_id; })[0];
  assert.strictEqual(plain.quantity, 5);
  assert.strictEqual(plain.tax, 8.99);
});
t('mergeLineItems_: inactive is sticky — one unavailable source marks the merged line', function () {
  var merged = mergeLineItems_([
    { product_id: 101, quantity: 1, item_price: 40, name: 'X', tax: 0, inactive: false },
    { product_id: 101, quantity: 1, item_price: 40, name: 'X', tax: 0, inactive: true }
  ]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].inactive, true);
});

// ============================================================================
// Suite: csv groups — resolveRuleSchema_/csvOutputGroups_
// (the product a user picks for billing also picks the CSV layout; rules that
//  resolve to the same schema share one CSV sheet)
// ============================================================================
suite('csv groups');
var CSV_RULES = [
  { match: 'CPO-EL', csv_schema: 'SCP_EL', utm: '' },
  { match: 'CPO',    csv_schema: 'SCP',    utm: '' },
  { match: 'New',    csv_schema: 'SC',     utm: '' },
  { match: 'PO',     csv_schema: 'SCP',    utm: '' }
];
t('product-map schema overrides the rule csv_schema; missing schema falls back', function () {
  assert.strictEqual(resolveRuleSchema_({ match: 'New', csv_schema: 'SC' },
    { 'New': { product_id: 1, schema: 'GLENDALE_COMBINED' } }), 'GLENDALE_COMBINED');
  assert.strictEqual(resolveRuleSchema_({ match: 'New', csv_schema: 'SC' },
    { 'New': { product_id: 1 } }), 'SC');
});
t('a * catch-all rule always uses its own csv_schema, never a product schema', function () {
  assert.strictEqual(resolveRuleSchema_({ match: '*', csv_schema: 'SCP' },
    { '*': { schema: 'NOPE' } }), 'SCP');
});
t('one resolved schema means one sheet named CSV', function () {
  var og = csvOutputGroups_([{ match: 'New', csv_schema: 'SCP' }, { match: 'PO', csv_schema: 'SCP' }], {});
  assert.strictEqual(og.single, true);
  assert.strictEqual(og.groups.length, 1);
  assert.strictEqual(og.groups[0].sheetBase, 'CSV');
  assert.deepStrictEqual(og.groups[0].matches, ['New', 'PO']);
});
t('multiple schemas split into CSV_<SCHEMA> sheets, same-schema types share one', function () {
  var og = csvOutputGroups_(CSV_RULES, {});
  assert.strictEqual(og.single, false);
  assert.deepStrictEqual(og.groups.map(function (g) { return g.sheetBase; }),
    ['CSV_SCP_EL', 'CSV_SCP', 'CSV_SC']);
  assert.deepStrictEqual(og.matchToKey,
    { 'CPO-EL': 'SCP_EL', 'CPO': 'SCP', 'New': 'SC', 'PO': 'SCP' });
});
t('sheet names sanitize non-alphanumerics and uppercase the schema', function () {
  var og = csvOutputGroups_([{ match: 'A', csv_schema: 'scp-el' }, { match: 'B', csv_schema: 'x' }], {});
  assert.strictEqual(og.groups[0].sheetBase, 'CSV_SCP_EL');
});
t('no schema anywhere falls back to SCP; empty rules yield no groups', function () {
  var og = csvOutputGroups_([{ match: 'New', csv_schema: '' }], {});
  assert.strictEqual(og.groups[0].schema, 'SCP');
  assert.deepStrictEqual(csvOutputGroups_([], {}).groups, []);
});
t('a product-map schema regroups a type into its own CSV (billing product drives layout)', function () {
  var og = csvOutputGroups_(CSV_RULES, { 'PO': { product_id: 9, schema: 'PO_SPECIAL' } });
  assert.deepStrictEqual(og.matchToKey['PO'], 'PO_SPECIAL');
  assert.deepStrictEqual(og.groups.filter(function (g) { return g.key === 'SCP'; })[0].matches, ['CPO']);
});

// ============================================================================
// Suite: features + qr-skip — schema-driven Features column and the QR gate
// (FEATURES is a code-written ORDERMATCH col V value column, required per-row
//  when a vehicle's resolved schema lists it; QR generation is skipped entirely
//  when no resolved schema carries a QR field code.)
// ============================================================================
suite('features + qr-skip');
var FEAT_PM = {
  'New': { product_id: 1, schema: 'LOGO1' },   // LOGO1 lists FEATURES, no QR
  'PO':  { product_id: 2, schema: 'LOGO3' }    // LOGO3 lists neither
};
var FEAT_RULES = buildTypeRulesFromProductMap_(FEAT_PM);
t('schemaCodesHaveFeatures_: true only when FEATURES listed; null/empty-safe', function () {
  assert.strictEqual(schemaCodesHaveFeatures_(['YEAR', 'FEATURES', 'MISC']), true);
  assert.strictEqual(schemaCodesHaveFeatures_(['YEAR', 'MISC']), false);
  assert.strictEqual(schemaCodesHaveFeatures_([]), false);
  assert.strictEqual(schemaCodesHaveFeatures_(null), false);
});
t('schemaCodesHaveQR_: any QR field code counts; null/empty-safe', function () {
  assert.strictEqual(schemaCodesHaveQR_(['YEAR', '@QR']), true);
  assert.strictEqual(schemaCodesHaveQR_(['@QR2']), true);
  assert.strictEqual(schemaCodesHaveQR_(['QRYEARMODEL']), true);
  assert.strictEqual(schemaCodesHaveQR_(['QRSTOCK']), true);
  assert.strictEqual(schemaCodesHaveQR_(['YEAR', 'FEATURES']), false);
  assert.strictEqual(schemaCodesHaveQR_(null), false);
});
t('featuresTypesForDealer_: only types whose RESOLVED schema lists FEATURES', function () {
  assert.deepStrictEqual(featuresTypesForDealer_(FEAT_RULES, FEAT_PM), { 'New': true });
});
t('featuresTypesForDealer_: no features schemas / null inputs yield {}', function () {
  var pm = { 'New': { product_id: 1, schema: 'SCP' } };
  assert.deepStrictEqual(featuresTypesForDealer_(buildTypeRulesFromProductMap_(pm), pm), {});
  assert.deepStrictEqual(featuresTypesForDealer_(null, null), {});
  assert.deepStrictEqual(featuresTypesForDealer_([], {}), {});
});
t('featuresTypesForDealer_: unknown schema key (getCsvSchema_ null) is not a features type', function () {
  var pm = { 'New': { product_id: 1, schema: 'NO_SUCH_SCHEMA' } };
  assert.deepStrictEqual(featuresTypesForDealer_(buildTypeRulesFromProductMap_(pm), pm), {});
});
t('runNeedsQR_: false when no resolved schema has a QR code, true when any does', function () {
  assert.strictEqual(runNeedsQR_(FEAT_RULES, FEAT_PM), false);
  var qrPm = { 'New': { product_id: 1, schema: 'SCP' }, 'PO': { product_id: 2, schema: 'LOGO3' } };
  assert.strictEqual(runNeedsQR_(buildTypeRulesFromProductMap_(qrPm), qrPm), true);
  var qr2Pm = { 'CPO': { product_id: 3, schema: 'SC' } };   // QRSTOCK counts too
  assert.strictEqual(runNeedsQR_(buildTypeRulesFromProductMap_(qr2Pm), qr2Pm), true);
});
t('runNeedsQR_: unknown schema key / null inputs are not QR (skip is fail-safe)', function () {
  var pm = { 'New': { product_id: 1, schema: 'NO_SUCH_SCHEMA' } };
  assert.strictEqual(runNeedsQR_(buildTypeRulesFromProductMap_(pm), pm), false);
  assert.strictEqual(runNeedsQR_(null, null), false);
  assert.strictEqual(runNeedsQR_([], {}), false);
});
var FEAT_TYPES = { 'New': true };
var VIN_TYPE_MAP = {
  'VINNEW1': { type: 'New' },
  'VINNEW2': { type: 'New' },
  'VINPO1':  { type: 'PO' }
};
t('collectMissingFeatures_: blank/whitespace/missing text on a features-type VIN is reported', function () {
  assert.deepStrictEqual(
    collectMissingFeatures_(['VINNEW1', 'VINNEW2'], VIN_TYPE_MAP, FEAT_TYPES, { 'VINNEW1': '  ' }),
    ['VINNEW1', 'VINNEW2']);
  assert.deepStrictEqual(
    collectMissingFeatures_(['VINNEW1'], VIN_TYPE_MAP, FEAT_TYPES, null),
    ['VINNEW1']);
});
t('collectMissingFeatures_: filled text passes; non-features types and unknown VINs are skipped', function () {
  assert.deepStrictEqual(
    collectMissingFeatures_(['VINNEW1', 'VINPO1', 'VINUNKNOWN'], VIN_TYPE_MAP, FEAT_TYPES,
      { 'VINNEW1': 'Moonroof | Leather' }),
    []);
});
t('collectMissingFeatures_: VIN keys match case-insensitively, original casing reported', function () {
  assert.deepStrictEqual(
    collectMissingFeatures_(['vinNew1', ' vinnew2 '], VIN_TYPE_MAP, FEAT_TYPES, { 'VINNEW2': 'Nav' }),
    ['vinNew1']);
});
t('collectMissingFeatures_: empty featuresTypes or empty VIN list reports nothing', function () {
  assert.deepStrictEqual(collectMissingFeatures_(['VINNEW1'], VIN_TYPE_MAP, {}, {}), []);
  assert.deepStrictEqual(collectMissingFeatures_([], VIN_TYPE_MAP, FEAT_TYPES, {}), []);
  assert.deepStrictEqual(collectMissingFeatures_(null, VIN_TYPE_MAP, FEAT_TYPES, {}), []);
});

// ============================================================================
// Suite: schema header overrides — CODE:HEADER cells (VersaWorks VDP fields)
// (A schema cell is `CODE` or `CODE:HEADER`; the code drives the ORDERMATCH
//  column lookup, the header prints in the CSV header row. Plain cells keep
//  the legacy header-equals-code behavior byte-identical.)
// ============================================================================
suite('schema header overrides');
t('parseSchemaCell_: plain code has header = code', function () {
  assert.deepStrictEqual(parseSchemaCell_('YEAR'), { code: 'YEAR', header: 'YEAR', edit: false });
  assert.deepStrictEqual(parseSchemaCell_('@QR'), { code: '@QR', header: '@QR', edit: false });
});
t('parseSchemaCell_: CODE:HEADER splits on the first colon, trimmed', function () {
  assert.deepStrictEqual(parseSchemaCell_('YEAR:VDP_A'), { code: 'YEAR', header: 'VDP_A', edit: false });
  assert.deepStrictEqual(parseSchemaCell_(' MV_PRICE : VDP_F '), { code: 'MV_PRICE', header: 'VDP_F', edit: false });
});
t('parseSchemaCell_: blank header after colon falls back to the code; null-safe', function () {
  assert.deepStrictEqual(parseSchemaCell_('YEAR:'), { code: 'YEAR', header: 'YEAR', edit: false });
  assert.deepStrictEqual(parseSchemaCell_(''), { code: '', header: '', edit: false });
  assert.deepStrictEqual(parseSchemaCell_(null), { code: '', header: '', edit: false });
});
t('schemaCodesHaveFeatures_/HaveQR_ see through header overrides', function () {
  assert.strictEqual(schemaCodesHaveFeatures_(['YEAR:VDP_A', 'FEATURES:VDP_D']), true);
  assert.strictEqual(schemaCodesHaveFeatures_(['YEAR:VDP_A', 'MISC:VDP_G']), false);
  assert.strictEqual(schemaCodesHaveQR_(['@QR:VDP_B']), true);
  assert.strictEqual(schemaCodesHaveQR_(['YEAR:VDP_A']), false);
});
t('featuresTypesForDealer_ detects FEATURES inside an override-syntax schema', function () {
  var pm = { 'PO': { product_id: 1, schema: 'VDP1' } };
  assert.deepStrictEqual(featuresTypesForDealer_(buildTypeRulesFromProductMap_(pm), pm), { 'PO': true });
});
t('dedupFieldCodeHeaders_ applies to override headers like any header', function () {
  assert.deepStrictEqual(dedupFieldCodeHeaders_(['VDP_A', 'VDP_B', 'VDP_A']),
    ['VDP_A', 'VDP_B', 'VDP_A2']);
});

// ============================================================================
// Suite: pre-run editable columns — CODE:HEADER:edit (VersaWorks text-fit)
// (A third schema-cell segment `edit`/`edit<N>` marks a column user-editable in
//  the Run table before the run; seeds are advisory JS twins of the template
//  formulas, and only user-CHANGED values override the CSV at write time.)
// ============================================================================
suite('editable columns');
t('parseSchemaCell_: third segment edit/editN parses into the edit flag', function () {
  assert.deepStrictEqual(parseSchemaCell_('MODELTRIM:VDP_B:edit'),
    { code: 'MODELTRIM', header: 'VDP_B', edit: { max: null } });
  assert.deepStrictEqual(parseSchemaCell_('MODELTRIM:VDP_B:edit18'),
    { code: 'MODELTRIM', header: 'VDP_B', edit: { max: 18 } });
  assert.deepStrictEqual(parseSchemaCell_('MODELTRIM:VDP_B:EDIT'),
    { code: 'MODELTRIM', header: 'VDP_B', edit: { max: null } });
});
t('parseSchemaCell_: non-edit third segment folds back into the header (fail-safe)', function () {
  assert.deepStrictEqual(parseSchemaCell_('YEAR:VDP:A'),
    { code: 'YEAR', header: 'VDP:A', edit: false });
  assert.deepStrictEqual(parseSchemaCell_('YEAR:VDP_A'),
    { code: 'YEAR', header: 'VDP_A', edit: false });
  assert.deepStrictEqual(parseSchemaCell_('YEAR'),
    { code: 'YEAR', header: 'YEAR', edit: false });
});
t('editableCodesForDealer_: per-type editable entries from resolved schemas', function () {
  var pm = { 'PO': { product_id: 1, schema: 'VDP_EDIT' }, 'CPO': { product_id: 2, schema: 'LOGO3' } };
  var out = editableCodesForDealer_(buildTypeRulesFromProductMap_(pm), pm);
  assert.deepStrictEqual(out, { 'PO': [{ code: 'MODELTRIM', max: 18 }] });
});
t('editableCodesForDealer_: empty on no rules / no edit flags', function () {
  var pm = { 'PO': { product_id: 1, schema: 'LOGO1' } };
  assert.deepStrictEqual(editableCodesForDealer_(buildTypeRulesFromProductMap_(pm), pm), {});
  assert.deepStrictEqual(editableCodesForDealer_(null, null), {});
});
t('computeEditSeed_: JS twins of the editable formulas (advisory preview values)', function () {
  // Base-21 fixture row indices: 0 VIN, 1 Stock, 3 Year, 5 Model, 6 Trim, 9 Price.
  var r = row_({ 0: '1FMCU9J96GUA10243', 1: 'P6UA10243', 3: 2016, 5: 'CX-50', 6: '2.5 S Prem Plus Pkg AWD', 9: '28995' });
  assert.strictEqual(computeEditSeed_('MODELTRIM', r), 'CX-50 2.5 S PREM PLUS PKG AWD');
  assert.strictEqual(computeEditSeed_('YEARMODELSTOCK', r), '2016 CX-50 - P6UA10243');
  assert.strictEqual(computeEditSeed_('MISC', r), '2016 CX-50 - 1FMCU9J96GUA10243 - P6UA10243');
  assert.strictEqual(computeEditSeed_('VINHALF', r), '6GUA10243'.slice(-8));
  assert.strictEqual(computeEditSeed_('MV_PRICE', r), 'Market Value Price: $30,995');
});
t('computeEditSeed_: unknown code / unparseable price are fail-safe', function () {
  var r = row_({ 9: '*' });
  assert.strictEqual(computeEditSeed_('NO_SUCH_CODE', r), '');
  assert.strictEqual(computeEditSeed_('MV_PRICE', r), '*');
});
t('csvCellValue_: a user edit overrides the ORDERMATCH value for that VIN+code only', function () {
  var edits = { 'VIN1': { 'MODELTRIM': 'CX-50 2.5 S' } };
  assert.strictEqual(csvCellValue_('MAZDA CX-50 2.5 S PREM PLUS PKG AWD', 'VIN1', 'MODELTRIM', edits), 'CX-50 2.5 S');
  assert.strictEqual(csvCellValue_('SOMETHING', 'VIN2', 'MODELTRIM', edits), 'SOMETHING');
  assert.strictEqual(csvCellValue_('SOMETHING', 'VIN1', 'MISC', edits), 'SOMETHING');
  assert.strictEqual(csvCellValue_('SOMETHING', 'vin1', 'MODELTRIM', edits), 'CX-50 2.5 S');  // VIN case-insensitive
  assert.strictEqual(csvCellValue_('SOMETHING', 'VIN1', 'MODELTRIM', null), 'SOMETHING');
});

// ============================================================================
// Suite: billing csv files — deal-attach filename + CSV tab discovery
// (billing CSV replaces the billing PDF; per-schema CSV tabs export as real
//  .csv files into the run's output folder)
// ============================================================================
suite('billing csv files');
t('billingCsvFilename_: sanitized, date-free, group-suffixed, .csv', function () {
  assert.strictEqual(billingCsvFilename_('Suntrup Ford', 'PRIMARY'), 'Billing - Suntrup Ford.csv');
  assert.strictEqual(billingCsvFilename_('Suntrup Ford', 'SPRINTER'), 'Billing - Suntrup Ford (SPRINTER).csv');
  assert.strictEqual(billingCsvFilename_('A/B:C*?"<>|', 'PRIMARY'), 'Billing - A B C.csv');
  assert.strictEqual(billingCsvFilename_('', null), 'Billing - Order.csv');
});
t('isCsvTabName_: CSV / CSV_<TYPE> / CSV_<TYPE>_<group> in; everything else out', function () {
  assert.strictEqual(isCsvTabName_('CSV'), true);
  assert.strictEqual(isCsvTabName_('CSV_NEW'), true);
  assert.strictEqual(isCsvTabName_('CSV_PO_AUTOLOANPRO'), true);
  assert.strictEqual(isCsvTabName_('ORDERMATCH'), false);
  assert.strictEqual(isCsvTabName_('BILLING'), false);
  assert.strictEqual(isCsvTabName_('CSVX'), false);
  assert.strictEqual(isCsvTabName_(null), false);
});
t('csvExportFileName_: "<doc name> - <TAB>.csv"', function () {
  assert.strictEqual(csvExportFileName_('Suntrup Ford 2026-07-20 Order', 'CSV_NEW'),
    'Suntrup Ford 2026-07-20 Order - CSV_NEW.csv');
});

// ============================================================================
// Suite: run drafts — summarizeRunDraft_ (the Drafts band's summary parser)
// ============================================================================
suite('run drafts');
t('summarizeRunDraft_: dedupes VINs (trim/case) and counts non-blank features only', function () {
  var s = summarizeRunDraft_(JSON.stringify({
    dealerKey: 'SUNTRUP_FORD',
    dealerName: "O'Fallon Ford",
    vinText: '  1FTEW1EP5MKD12345 \n\n1ftew1ep5mkd12345\n3GNAXKEV1LL333333\n',
    features: { A: 'Moonroof', B: '   ', C: '', D: 'Tow pkg' }
  }));
  assert.strictEqual(s.dealerKey, 'SUNTRUP_FORD');
  assert.strictEqual(s.dealerName, "O'Fallon Ford");
  assert.strictEqual(s.vinCount, 2);    // dupe VIN collapses, blank lines dropped
  assert.strictEqual(s.featCount, 2);   // whitespace-only and empty don't count
});
t('summarizeRunDraft_: fail-safe zeros on bad JSON and missing fields', function () {
  var bad = summarizeRunDraft_('{not json');
  assert.deepStrictEqual(bad, { dealerKey: '', dealerName: '', vinCount: 0, featCount: 0 });
  var sparse = summarizeRunDraft_(JSON.stringify({ dealerKey: 'X' }));
  assert.strictEqual(sparse.vinCount, 0);
  assert.strictEqual(sparse.featCount, 0);
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
