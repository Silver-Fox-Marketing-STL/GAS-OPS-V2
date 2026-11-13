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
// Utilities.formatDate: only the 'yyyy-MM-dd HH:mm:ss' shape the run ledger uses.
// Formats in UTC (the timezone argument is ignored) — tests build Dates with Date.UTC.
globalThis.Utilities = {
  formatDate: function (d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
           p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }
};

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
  ['VDP_EDIT', 'editable modeltrim',  'YEAR:VDP_A', 'MODELTRIM:VDP_B:edit18', 'MISC:VDP_G', ''],
  ['VDP_FEAT_EDIT', 'FEATURES wrongly flagged editable', 'YEAR:VDP_A', 'FEATURES:VDP_D:edit', 'MODELTRIM:VDP_B:edit18', '']
];
var fakeCsvSchemasSheet = {
  getDataRange: function () { return { getValues: function () { return CSV_SCHEMAS_ROWS; } }; }
};
// Synthetic FIELD_CODES (col A field_code, B description, `ordermatch_col`
// overlay) mirroring SF_DEALER_CONFIG live: MODELTRIM (col X/24) lives ONLY in
// the overlay, not the FIELD_TO_COL constant — so getFieldToCol_() resolves it
// offline exactly as it does live (needed to validate MODELTRIM schema cells).
var FIELD_CODES_ROWS = [
  ['field_code', 'description', 'ordermatch_col'],
  ['MODELTRIM',  'model + trim (VDP)', 24]
];
var fakeFieldCodesSheet = {
  getLastRow: function () { return FIELD_CODES_ROWS.length; },
  getDataRange: function () { return { getValues: function () { return FIELD_CODES_ROWS; } }; }
};
globalThis.SpreadsheetApp = {
  openById: function () {
    return {
      getSheetByName: function (name) {
        if (name === 'NORM_MAPS') return fakeNormSheet;
        if (name === 'CSV_SCHEMAS') return fakeCsvSchemasSheet;
        if (name === 'FIELD_CODES') return fakeFieldCodesSheet;
        return null;
      }
    };
  }
};

// ── Load Code.gs (and PdFake.gs if the Pipedrive-fake branch has landed) ────
var codeSource = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
var pdFakePath = path.join(ROOT, 'PdFake.gs');
var pdFakeSource = fs.existsSync(pdFakePath) ? fs.readFileSync(pdFakePath, 'utf8') : null;
// RunLedger.gs has no load-time dependencies, so it loads before Code.gs (whose
// ENV resolver throws on an unknown scriptId) and its globals always exist.
var ledgerSource = fs.readFileSync(path.join(ROOT, 'RunLedger.gs'), 'utf8');
var makeFakeLedgerStore = require('./ledger-fake-store.js').makeFakeLedgerStore;
function loadAll() {
  if (pdFakeSource) (0, eval)(pdFakeSource);
  (0, eval)(ledgerSource);
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
t('buildFilteredVinMap_ mirrors the run phase exactly (VIN_UPPER → compact reason)', function () {
  var map = buildFilteredVinMap_(rows_(), phaseRules);
  var rej = applyFilteringRules_(rows_(), phaseRules, 'run').rejected;
  assert.strictEqual(Object.keys(map).length, rej.length);   // 2 CPO rows, nothing else
  rej.forEach(function (r) {
    var vin = String(r.row[0]).trim().toUpperCase();
    // compact form: the rule's field list, not the verbose describeRule_ text
    assert.strictEqual(map[vin], 'type');
  });
});
t('ruleFieldsSummary_: field list joined by the top-level operator, nested groups flatten', function () {
  assert.strictEqual(ruleFieldsSummary_({ group: { match: 'all', children: [
    { field: 'type', op: 'in', values: ['PO', 'CPO'] },
    { field: 'price', op: 'lt', values: [35000] }
  ] } }), 'type AND price');
  assert.strictEqual(ruleFieldsSummary_({ group: { match: 'any', children: [
    { field: 'type', op: 'in', values: ['New'] },
    { match: 'all', children: [{ field: 'price', op: 'lt', values: [1] }, { field: 'type', op: 'in', values: ['PO'] }] }
  ] } }), 'type OR price');
  assert.strictEqual(ruleFieldsSummary_(null), 'filter rule');   // fail-safe
});
t('buildFilteredVinMap_ fail-safe: bad inputs → {} (table load can never break)', function () {
  assert.deepStrictEqual(buildFilteredVinMap_(null, null), {});
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
// Suite: install cost — pdApplyInstallCost_. Guards: an EMPTY org field maps to
// the '(not set)' options row (key ''); an UNREADABLE org fails retryable — a
// transient Pipedrive blip can never silently drop the Install line again.
// ============================================================================
suite('install cost');
function withInstallStubs_(opts, fn) {
  var saved = {
    cfg: globalThis.getInstallCostConfig_, org: globalThis.pdGetOrgWithCustomFields_,
    list: globalThis.pdListDealProducts_, add: globalThis.pdAddDealProduct_,
    upd: globalThis.pdUpdateDealProduct_
  };
  var calls = { added: [], updated: [] };
  globalThis.getInstallCostConfig_ = function () { return opts.cfg; };
  globalThis.pdGetOrgWithCustomFields_ = function () { return opts.org; };
  globalThis.pdListDealProducts_ = function () { return opts.rows || []; };
  globalThis.pdAddDealProduct_ = function (dealId, item) { calls.added.push(item); return { ok: true }; };
  globalThis.pdUpdateDealProduct_ = function (dealId, attId, body) { calls.updated.push({ attId: attId, body: body }); return { ok: true }; };
  try { return fn(calls); }
  finally {
    globalThis.getInstallCostConfig_ = saved.cfg; globalThis.pdGetOrgWithCustomFields_ = saved.org;
    globalThis.pdListDealProducts_ = saved.list; globalThis.pdAddDealProduct_ = saved.add;
    globalThis.pdUpdateDealProduct_ = saved.upd;
  }
}
var IC_CFG = { org_field_key: 'icf', install_product_id: 700, options: {
  '21': { variation_id: 7001, percent: 3 },          // a mapped option (3%)
  '':   { variation_id: 7002, percent: null }        // '(not set)' → $0 Included
} };

t('EMPTY org field → install line still added at $0 via the \'(not set)\' mapping', function () {
  withInstallStubs_({ cfg: IC_CFG, org: { id: 1, custom_fields: {} } }, function (calls) {
    var r = pdApplyInstallCost_(1, { orgId: 1 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.applied, true);
    assert.strictEqual(r.price, 0);
    assert.strictEqual(calls.added.length, 1);
    assert.strictEqual(calls.added[0].item_price, 0);
    assert.strictEqual(calls.added[0].product_variation_id, 7002);
  });
});
t('EMPTY org field with NO \'(not set)\' row keeps the old fail-safe skip', function () {
  var cfg = { org_field_key: 'icf', install_product_id: 700, options: { '21': { variation_id: 7001, percent: 3 } } };
  withInstallStubs_({ cfg: cfg, org: { id: 1, custom_fields: {} } }, function (calls) {
    var r = pdApplyInstallCost_(1, { orgId: 1 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.applied, false);
    assert.strictEqual(calls.added.length, 0);
  });
});
t('UNREADABLE org (API failure) fails retryable — never a silent skip, never a $0 guess', function () {
  withInstallStubs_({ cfg: IC_CFG, org: null }, function (calls) {
    var r = pdApplyInstallCost_(1, { orgId: 1 });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error);
    assert.strictEqual(calls.added.length, 0);
    assert.strictEqual(calls.updated.length, 0);
  });
});
t('mapped option still prices percent × other-lines subtotal (regression)', function () {
  withInstallStubs_({ cfg: IC_CFG, org: { id: 1, custom_fields: { icf: { id: 21 } } },
    rows: [{ id: 5, product_id: 101, item_price: 40, quantity: 7 }] }, function (calls) {
    var r = pdApplyInstallCost_(1, { orgId: 1 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.price, 8.4);   // 3% of 280, to the cent
    assert.strictEqual(calls.added[0].product_variation_id, 7001);
  });
});
t('existing Install row is UPDATED (idempotent), not re-added — incl. the empty-field path', function () {
  withInstallStubs_({ cfg: IC_CFG, org: { id: 1, custom_fields: {} },
    rows: [{ id: 55, product_id: 700, item_price: 9, quantity: 1 }] }, function (calls) {
    var r = pdApplyInstallCost_(1, { orgId: 1 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls.added.length, 0);
    assert.strictEqual(calls.updated.length, 1);
    assert.strictEqual(calls.updated[0].attId, 55);
    assert.strictEqual(calls.updated[0].body.item_price, 0);
  });
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
t('csvUppercaseCell_: strings fold to UPPERCASE; numbers/blank/null pass through', function () {
  assert.strictEqual(csvUppercaseCell_('Mazda CX-50 2.5 S Prem', 'MODELTRIM'), 'MAZDA CX-50 2.5 S PREM');
  assert.strictEqual(csvUppercaseCell_('$24,995', 'PRICE_FMT'), '$24,995');
  assert.strictEqual(csvUppercaseCell_('', 'MISC'), '');
  assert.strictEqual(csvUppercaseCell_(2024, 'YEAR'), 2024);
  assert.strictEqual(csvUppercaseCell_(null, 'YEAR'), null);
});
t('csvUppercaseCell_: QR file-path codes are never case-folded (case-sensitive filesystems)', function () {
  var p = 'C:/QR/Auffenberg_Hyundai/kmhl14ja1pa000001.png';
  assert.strictEqual(csvUppercaseCell_(p, '@QR'), p);
  assert.strictEqual(csvUppercaseCell_(p, '@QR2'), p);
  assert.strictEqual(csvUppercaseCell_(p, '@qr'), p);          // code compare is case-insensitive
  assert.strictEqual(csvUppercaseCell_('abc', 'QRSTOCK'), 'ABC'); // QRSTOCK is text, not a path
});
t('getDealerFilterRules_: csv_uppercase is strict-boolean and defaults OFF', function () {
  assert.strictEqual(getDealerFilterRules_(cfgRow_(JSON.stringify({ csv_uppercase: true }))).csvUppercase, true);
  assert.strictEqual(getDealerFilterRules_(cfgRow_(JSON.stringify({ csv_uppercase: 'true' }))).csvUppercase, false);
  assert.strictEqual(getDealerFilterRules_(cfgRow_(JSON.stringify({ require_stock: true }))).csvUppercase, false);
  assert.strictEqual(getDealerFilterRules_(cfgRow_('')).csvUppercase, false);
  assert.strictEqual(getDealerFilterRules_(cfgRow_('{not json')).csvUppercase, false);
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

// ============================================================================
// Suite: vin log latest order — latestOrderIdFrom_ (latest order_date col D
// wins; legacy-system ids with an extra digit beat every new id numerically,
// and physically-last lies for an old run committed late — both July 2026)
// ============================================================================
suite('vin log latest order');
function vlRow(id, date) { return [id, 'VIN', '', date || '']; }
t('latestOrderIdFrom_: latest order_date wins over a bigger legacy id', function () {
  assert.strictEqual(latestOrderIdFrom_([
    vlRow('41833', ''),                       // legacy system, extra digit, no date
    vlRow('4244', '2026-07-20 09:00:00'),
    vlRow('4245', '2026-07-25 09:00:00')
  ]), '4245');
});
t('latestOrderIdFrom_: latest order_date wins over the physically-last row', function () {
  assert.strictEqual(latestOrderIdFrom_([
    vlRow('4245', '2026-07-25 09:00:00'),
    vlRow('4183', '2026-06-01 09:00:00')      // old run committed late
  ]), '4245');
  assert.strictEqual(latestOrderIdFrom_([     // Date cells (Sheets auto-parses)
    vlRow(4245, new Date(2026, 6, 25)),
    vlRow(4183, new Date(2026, 5, 1))
  ]), '4245');
});
t('latestOrderIdFrom_: order_date tie broken by higher numeric id', function () {
  assert.strictEqual(latestOrderIdFrom_([
    vlRow('4246', '2026-07-25 09:00:00'),
    vlRow('4245', '2026-07-25 09:00:00')
  ]), '4246');
});
t('latestOrderIdFrom_: no dated rows falls back to highest numeric id', function () {
  assert.strictEqual(latestOrderIdFrom_([['4244'], ['4245'], ['4183'], ['4193']]), '4245');
  assert.strictEqual(latestOrderIdFrom_([[4244], [4245], [4183], [4193]]), '4245');  // numeric cells
});
t('latestOrderIdFrom_: skips blanks + mid-file headers; empty log is null', function () {
  assert.strictEqual(latestOrderIdFrom_([['12'], [''], ['ORDER_ID'], ['9']]), '12');
  assert.strictEqual(latestOrderIdFrom_([[''], ['ORDER_ID']]), null);
});
t('latestOrderIdFrom_: all-non-numeric log falls back to last non-blank', function () {
  assert.strictEqual(latestOrderIdFrom_([['ABC-1'], ['ABC-2']]), 'ABC-2');
});
t('orderDateTime_: Date, string, blank, garbage', function () {
  assert.strictEqual(orderDateTime_(new Date(2026, 6, 25)), new Date(2026, 6, 25).getTime());
  assert.strictEqual(orderDateTime_('2026-07-25 09:00:00'), new Date(2026, 6, 25, 9).getTime());
  assert.strictEqual(orderDateTime_(''), null);
  assert.strictEqual(orderDateTime_(undefined), null);
  assert.strictEqual(orderDateTime_('not a date'), null);
});

// ============================================================================
// Suite: CSV schema editor cells — parse/serialize round-trip
// ============================================================================
suite('CSV schema editor cells');
t('serializeSchemaCell_ bare code', function () {
  assert.strictEqual(serializeSchemaCell_({ code: 'YEAR', header: null, edit: false, max: null }), 'YEAR');
});
t('serializeSchemaCell_ header override', function () {
  assert.strictEqual(serializeSchemaCell_({ code: 'YEAR', header: 'VDP_A', edit: false, max: null }), 'YEAR:VDP_A');
});
t('serializeSchemaCell_ editable with max', function () {
  assert.strictEqual(serializeSchemaCell_({ code: 'MODELTRIM', header: 'VDP_B', edit: true, max: 18 }), 'MODELTRIM:VDP_B:edit18');
});
t('serializeSchemaCell_ editable without max', function () {
  assert.strictEqual(serializeSchemaCell_({ code: 'MODELTRIM', header: 'VDP_B', edit: true, max: null }), 'MODELTRIM:VDP_B:edit');
});
t('serializeSchemaCell_ editable without header uses :: (header falls back to code on parse)', function () {
  assert.strictEqual(serializeSchemaCell_({ code: 'MODELTRIM', header: null, edit: true, max: 12 }), 'MODELTRIM::edit12');
});
t('schemaCellToEditor_ carries raw + nulls header when no override', function () {
  var e = schemaCellToEditor_('YEARMODELSTOCK');
  assert.deepStrictEqual(e, { code: 'YEARMODELSTOCK', header: null, edit: false, max: null, raw: 'YEARMODELSTOCK' });
});
t('schemaCellToEditor_ parses full syntax', function () {
  var e = schemaCellToEditor_('MODELTRIM:VDP_B:edit18');
  assert.deepStrictEqual(e, { code: 'MODELTRIM', header: 'VDP_B', edit: true, max: 18, raw: 'MODELTRIM:VDP_B:edit18' });
});
t('round-trip is byte-identical for every standard cell form', function () {
  ['YEAR', 'YEAR:VDP_A', 'MODELTRIM:VDP_B:edit', 'MODELTRIM:VDP_B:edit18',
   'MODELTRIM::edit', 'CODE:HEA:DER'].forEach(function (cell) {
    assert.strictEqual(serializeSchemaCell_(schemaCellToEditor_(cell)), cell, cell);
  });
});
t('getCsvSchemasEditorData parses every fake schema row', function () {
  var d = getCsvSchemasEditorData();
  var byKey = {};
  d.schemas.forEach(function (s) { byKey[s.key] = s; });
  assert.ok(byKey.SCP && byKey.VDP_EDIT, 'expected fake schemas present');
  assert.strictEqual(byKey.SCP.description, 'standard qr');
  assert.deepStrictEqual(
    byKey.SCP.columns.map(function (c) { return c.code; }),
    ['YEARMODELSTOCK', 'TYPEVIN', '@QR']);
  var mt = byKey.VDP_EDIT.columns[1];
  assert.deepStrictEqual(mt, { code: 'MODELTRIM', header: 'VDP_B', edit: true, max: 18, raw: 'MODELTRIM:VDP_B:edit18' });
});
t('getCsvSchemasEditorData ships field codes and empty usedBy offline', function () {
  var d = getCsvSchemasEditorData();
  assert.ok(d.fieldCodes.length > 10, 'built-in field codes expected');
  assert.ok(d.fieldCodes.some(function (f) { return f.fieldCode === 'YEARMODELSTOCK'; }));
  assert.deepStrictEqual(d.usedBy, {});
});
t('buildCsvSchemaCells_ serializes valid columns and passes raw verbatim', function () {
  var cells = buildCsvSchemaCells_([
    { raw: 'CODE:HEA:DER' },                                        // untouched — no validation
    { code: 'YEAR', header: 'VDP_A', edit: false, max: null },
    { code: 'MODELTRIM', header: null, edit: true, max: 18 }
  ], getFieldToCol_());
  assert.deepStrictEqual(cells, ['CODE:HEA:DER', 'YEAR:VDP_A', 'MODELTRIM::edit18']);
});
t('buildCsvSchemaCells_ rejects unknown code, colon header, bad max', function () {
  var codes = getFieldToCol_();
  assert.throws(function () { buildCsvSchemaCells_([{ code: 'NOPE' }], codes); }, /unknown field code/i);
  assert.throws(function () { buildCsvSchemaCells_([{ code: 'YEAR', header: 'A:B' }], codes); }, /cannot contain/i);
  assert.throws(function () { buildCsvSchemaCells_([{ code: 'YEAR', edit: true, max: 0 }], codes); }, /positive whole number/i);
  assert.throws(function () { buildCsvSchemaCells_([{ code: 'YEAR', edit: false, max: 5 }], codes); }, /requires the Editable flag/i);
  assert.throws(function () { buildCsvSchemaCells_([{ code: '' }], codes); }, /field code is required/i);
});
t('buildCsvSchemaCells_ allows duplicate codes (GLENDALE two-frame pattern)', function () {
  var cells = buildCsvSchemaCells_([
    { code: 'YEARMODELSTOCK' }, { code: 'YEARMODELSTOCK' }
  ], getFieldToCol_());
  assert.deepStrictEqual(cells, ['YEARMODELSTOCK', 'YEARMODELSTOCK']);
});

// ============================================================================
// Suite: Add Dealer wizard — pure provisioning helpers
// ============================================================================
suite('add dealer wizard');
t('ndKeyFromName_ derives ALL_CAPS keys', function () {
  assert.strictEqual(ndKeyFromName_('Joe Machens CDJR'), 'JOE_MACHENS_CDJR');
  assert.strictEqual(ndKeyFromName_("O'Fallon Buick-GMC"), 'O_FALLON_BUICK_GMC');
  assert.strictEqual(ndKeyFromName_('  spaced  '), 'SPACED');       // no leading/trailing _
  assert.strictEqual(ndKeyFromName_(''), '');
});
t('ndPrefixFromName_ preserves case, underscores separators', function () {
  assert.strictEqual(ndPrefixFromName_('Auffenberg Hyundai'), 'Auffenberg_Hyundai');
  assert.strictEqual(ndPrefixFromName_('BMW of West St. Louis'), 'BMW_of_West_St_Louis');
});
t('default filtering_rules match the baseline and omit the optional keys', function () {
  var parsed = JSON.parse(ndDefaultFilteringRules_());
  assert.deepStrictEqual(parsed, {
    allowed_types: ['New', 'PO', 'CPO'], exclude_status: ['OFFLOT'], require_stock: true
  });
  assert.ok(!('billing_split' in parsed) && !('source_split' in parsed) &&
            !('targeting_rules' in parsed));
});
t('default filtering_rules round-trip through getDealerFilterRules_ (the run path parser)', function () {
  var config = [];
  config[CFG.KEY] = 'TEST';
  config[CFG.FILTER_RULES] = ndDefaultFilteringRules_();
  var fr = getDealerFilterRules_(config);
  assert.deepStrictEqual(fr.allowedTypes, ['New', 'PO', 'CPO']);
  assert.deepStrictEqual(fr.excludeStatus, ['OFFLOT']);
  assert.strictEqual(fr.requireStock, true);
  assert.strictEqual(fr.requirePrice, false);
});
t('ndNextOrdersCol_ allocates max+1, never reuses gaps', function () {
  assert.strictEqual(ndNextOrdersCol_(['B', 'C', 'AQ']), 'AR');
  assert.strictEqual(ndNextOrdersCol_(['AQ', 'B']), 'AR');          // order-independent
  assert.strictEqual(ndNextOrdersCol_(['B', '', null, 'C']), 'D');  // blanks ignored
  assert.strictEqual(ndNextOrdersCol_(['Z']), 'AA');                // base-26 rollover
  assert.strictEqual(ndNextOrdersCol_([]), 'A');                    // empty sheet
  assert.strictEqual(ndNextOrdersCol_(['CV', 'CW']), 'CX');         // past col 100 (no cap)
});
t('ndDiffLocations_ diffs case- and whitespace-insensitively, suggests keys', function () {
  assert.deepStrictEqual(
    ndDiffLocations_(['Foo Ford', 'Bar Kia'], ['  foo ford ']),
    [{ location: 'Bar Kia', suggestedKey: 'BAR_KIA' }]);
  assert.deepStrictEqual(ndDiffLocations_([], ['X']), []);
  assert.deepStrictEqual(ndDiffLocations_(['', '  '], []), []);     // blank live rows dropped
});
t('ndValidatePayload_ rejects bad keys and duplicates, accepts a valid payload', function () {
  var base = { dealerName: 'Test Dealer', scraperLocationName: 'Test Dealer STL',
               linkbuilderCol: 'B', qrLocalPrefix: 'Test_Dealer' };
  function withKey(k) { return Object.assign({ dealerKey: k }, base); }
  assert.ok(ndValidatePayload_(withKey('1ABC'), []).length > 0);        // must start with a letter
  assert.ok(ndValidatePayload_(withKey('ABC MOTORS'), []).length > 0);  // no spaces
  assert.ok(ndValidatePayload_(withKey('ABC'), ['ABC']).length > 0);    // duplicate
  assert.ok(ndValidatePayload_(Object.assign(withKey('ABC'), { dealerName: '' }), []).length > 0);
  assert.deepStrictEqual(ndValidatePayload_(withKey('ABC'), ['XYZ']), []);
});
t('validateProductMapForRun_ over the wizard default types (checklist gate)', function () {
  var allowed = JSON.parse(ndDefaultFilteringRules_()).allowed_types;
  var full = { New: { product_id: 1, schema: 'SCP' }, PO: { product_id: 2, schema: 'SCP' },
               CPO: { product_id: 3, schema: 'SCP' } };
  assert.deepStrictEqual(validateProductMapForRun_(allowed, full), []);
  delete full.CPO.schema;
  assert.deepStrictEqual(validateProductMapForRun_(allowed, full), ['CPO']);
});

// ============================================================================
// Suite: FEATURES never double-renders — an `edit` flag on a FEATURES schema
// cell must NOT create a second dynamic edit column (the dedicated Features
// column owns that code; the run gate only checks featuresMap).
// ============================================================================
suite('features edit-flag exclusion');
t('editableCodesForDealer_ excludes FEATURES even when the cell is flagged edit', function () {
  var rules = [{ match: 'New', csv_schema: '' }];
  var map = { New: { product_id: 1, schema: 'VDP_FEAT_EDIT' } };
  var codes = editableCodesForDealer_(rules, map);
  // MODELTRIM (also flagged edit in the same schema) survives; FEATURES doesn't.
  assert.deepStrictEqual(codes, { New: [{ code: 'MODELTRIM', max: 18 }] });
});
t('featuresTypesForDealer_ still flags the type (dedicated column keeps working)', function () {
  var rules = [{ match: 'New', csv_schema: '' }];
  var map = { New: { product_id: 1, schema: 'VDP_FEAT_EDIT' } };
  assert.deepStrictEqual(featuresTypesForDealer_(rules, map), { New: true });
});
t('ordinary edit columns are unaffected (VDP_EDIT regression check)', function () {
  var rules = [{ match: 'New', csv_schema: '' }];
  var map = { New: { product_id: 1, schema: 'VDP_EDIT' } };
  assert.deepStrictEqual(editableCodesForDealer_(rules, map), { New: [{ code: 'MODELTRIM', max: 18 }] });
});
t('CSV Schemas editor refuses the Editable flag on FEATURES (config side of the same guard)', function () {
  var codes = getFieldToCol_();
  assert.throws(function () {
    buildCsvSchemaCells_([{ code: 'FEATURES', edit: true }], codes);
  }, /FEATURES cannot be flagged Editable/);
  // Plain FEATURES (no edit flag) still saves fine.
  assert.deepStrictEqual(buildCsvSchemaCells_([{ code: 'FEATURES' }], codes), ['FEATURES']);
});

// ============================================================================
// Suite: stack cleanup — buildStackCleanupRows_ (VIN log ∩ current inventory)
// ============================================================================
suite('stack cleanup');
t('intersects log with inventory and sorts by last-2 VIN chars', function () {
  var vinMap = {
    '1FTEW1EP5PKD10007': { stock: 'S1', year: '2023', make: 'Ford',  model: 'F-150' },
    '3GNKBKRS8PS220042': { stock: 'S2', year: '2023', make: 'Chevy', model: 'Blazer' },
    'WDDWJ8EB4KF799915': { stock: 'S3', year: '2019', make: 'MB',    model: 'C300' }
  };
  var logged = ['WDDWJ8EB4KF799915', '1FTEW1EP5PKD10007', '3GNKBKRS8PS220042', 'SOLDVIN0000000001'];
  var rows = buildStackCleanupRows_(logged, vinMap);
  // sold VIN dropped; order by last-2: 07 < 15 < 42
  assert.deepStrictEqual(rows.map(function (r) { return r.vin.slice(-2); }), ['07', '15', '42']);
  assert.strictEqual(rows[0].stock, 'S1');
  assert.strictEqual(rows[1].model, 'C300');
});
t('dedupes repeated log entries and tolerates case/whitespace', function () {
  var vinMap = { 'VIN00000000000001': { stock: 'S1', year: '2024', make: 'A', model: 'B' } };
  var rows = buildStackCleanupRows_([' vin00000000000001 ', 'VIN00000000000001', ''], vinMap);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].vin, 'VIN00000000000001');
});
t('ties on last-2 fall back to full-VIN order (stable, deterministic)', function () {
  var vinMap = {
    'BBB00000000000099': { stock: '', year: '', make: '', model: '' },
    'AAA00000000000099': { stock: '', year: '', make: '', model: '' }
  };
  var rows = buildStackCleanupRows_(['BBB00000000000099', 'AAA00000000000099'], vinMap);
  assert.deepStrictEqual(rows.map(function (r) { return r.vin; }),
    ['AAA00000000000099', 'BBB00000000000099']);
});
t('empty log or empty inventory yields empty list (never throws)', function () {
  assert.deepStrictEqual(buildStackCleanupRows_([], { X: {} }), []);
  assert.deepStrictEqual(buildStackCleanupRows_(['X'], {}), []);
});

// ============================================================================
// Suite: VDP liveness classifier — three-state, fail-SAFE (ambiguous → unknown)
// ============================================================================
suite('vdp liveness classifier');
var VDP_URL = 'https://www.dealer.com/used/Honda/2021-Civic-1HGCV1F34MA000001/';
var VDP_VIN = '1HGCV1F34MA000001';
function vdpBody_(n) {
  var s = '<html><title>2021 Honda Civic</title>';
  for (var i = 0; i < n; i++) s += ' data-vin="' + VDP_VIN.toLowerCase() + '"';   // case-insensitive count
  return s + '</html>';
}
t('404/410 → gone; other 4xx and 5xx → unknown (bot wall / transient is not evidence)', function () {
  assert.strictEqual(classifyVdpResponse_(404, '', '', VDP_VIN, VDP_URL), 'gone');
  assert.strictEqual(classifyVdpResponse_(410, '', '', VDP_VIN, VDP_URL), 'gone');
  assert.strictEqual(classifyVdpResponse_(403, '', vdpBody_(0), VDP_VIN, VDP_URL), 'unknown');
  assert.strictEqual(classifyVdpResponse_(429, '', '', VDP_VIN, VDP_URL), 'unknown');
  assert.strictEqual(classifyVdpResponse_(500, '', '', VDP_VIN, VDP_URL), 'unknown');
  assert.strictEqual(classifyVdpResponse_(503, '', vdpBody_(9), VDP_VIN, VDP_URL), 'unknown');
});
t('3xx same host+path (http→https, slash, www, query) → follow; different path → gone; no Location → unknown', function () {
  var httpUrl = VDP_URL.replace('https://', 'http://');
  assert.strictEqual(classifyVdpResponse_(301, VDP_URL, '', VDP_VIN, httpUrl), 'follow');
  assert.strictEqual(classifyVdpResponse_(301, VDP_URL.replace(/\/$/, ''), '', VDP_VIN, VDP_URL), 'follow');
  assert.strictEqual(classifyVdpResponse_(301, VDP_URL.replace('www.', ''), '', VDP_VIN, VDP_URL), 'follow');
  assert.strictEqual(classifyVdpResponse_(301, VDP_URL + '?utm_source=x', '', VDP_VIN, VDP_URL), 'follow');
  assert.strictEqual(classifyVdpResponse_(302, 'https://www.dealer.com/used-inventory/', '', VDP_VIN, VDP_URL), 'gone');
  assert.strictEqual(classifyVdpResponse_(302, '/used-inventory/index.htm', '', VDP_VIN, VDP_URL), 'gone');   // relative Location
  assert.strictEqual(classifyVdpResponse_(302, '', '', VDP_VIN, VDP_URL), 'unknown');
});
t('200: VIN ≥2× → alive (Dean Team live VDPs echo it exactly 2×), 0× → gone, 1× → unknown; blank VIN → unknown', function () {
  assert.strictEqual(classifyVdpResponse_(200, '', vdpBody_(5), VDP_VIN, VDP_URL), 'alive');
  assert.strictEqual(classifyVdpResponse_(200, '', vdpBody_(3), VDP_VIN, VDP_URL), 'alive');
  assert.strictEqual(classifyVdpResponse_(200, '', vdpBody_(0), VDP_VIN, VDP_URL), 'gone');
  assert.strictEqual(classifyVdpResponse_(200, '', vdpBody_(1), VDP_VIN, VDP_URL), 'unknown');
  assert.strictEqual(classifyVdpResponse_(200, '', vdpBody_(2), VDP_VIN, VDP_URL), 'alive');
  assert.strictEqual(classifyVdpResponse_(200, '', vdpBody_(5), '', VDP_URL), 'unknown');
  assert.strictEqual(classifyVdpResponse_(0, '', '', VDP_VIN, VDP_URL), 'unknown');
});
t('vdpResolveUrl_: absolute passes through; relative resolves against the request origin', function () {
  assert.strictEqual(vdpResolveUrl_('https://x.com/a', VDP_URL), 'https://x.com/a');
  assert.strictEqual(vdpResolveUrl_('/used/', VDP_URL), 'https://www.dealer.com/used/');
  assert.strictEqual(vdpResolveUrl_('used/', VDP_URL), 'https://www.dealer.com/used/');
  assert.strictEqual(vdpResolveUrl_('//www.dealer.com/used/', VDP_URL), 'https://www.dealer.com/used/');
  assert.strictEqual(vdpResolveUrl_('//www.dealer.com/used/', 'http://www.dealer.com/x'), 'http://www.dealer.com/used/');
});
t('protocol-relative Location ("//host/path"): same path → follow, different path → gone', function () {
  var proto = VDP_URL.replace('https:', '');
  assert.strictEqual(classifyVdpResponse_(301, proto, '', VDP_VIN, VDP_URL.replace('https://', 'http://')), 'follow');
  assert.strictEqual(classifyVdpResponse_(301, '//dealer.com/used-inventory/', '', VDP_VIN, VDP_URL), 'gone');
});
t('site-change guard: most definite answers "gone" (≥6 answers) → every gone becomes unknown', function () {
  var map = function (gone, alive, unknown) {
    var m = {}, i;
    for (i = 0; i < gone; i++) m['G' + i] = 'gone';
    for (i = 0; i < alive; i++) m['A' + i] = 'alive';
    for (i = 0; i < unknown; i++) m['U' + i] = 'unknown';
    return m;
  };
  var r = vdpSiteChangeGuard_(map(5, 1, 3));                    // 5 of 6 gone → site change
  assert.strictEqual(r.siteChange, true);
  assert.strictEqual(r.goneCount, 5);
  assert.strictEqual(r.answered, 6);
  assert.strictEqual(r.statuses.G0, 'unknown');
  assert.strictEqual(r.statuses.A0, 'alive');
  r = vdpSiteChangeGuard_(map(3, 3, 0));                        // exactly half → normal flags
  assert.strictEqual(r.siteChange, false);
  assert.strictEqual(r.statuses.G0, 'gone');
  r = vdpSiteChangeGuard_(map(5, 0, 9));                        // 5 answers — too few to judge
  assert.strictEqual(r.siteChange, false);
  assert.strictEqual(r.statuses.G4, 'gone');
  r = vdpSiteChangeGuard_(map(2, 10, 0));                       // the normal ~1-in-6 case
  assert.strictEqual(r.siteChange, false);
  assert.deepStrictEqual(vdpSiteChangeGuard_(null), { statuses: {}, siteChange: false, goneCount: 0, answered: 0 });
});
t('checkVehicleUrls never throws and fails safe: bad input / non-http URLs → unknown', function () {
  assert.deepStrictEqual(checkVehicleUrls(null).statuses, {});
  var r = checkVehicleUrls([{ vin: 'abc', url: '*' }, { vin: '', url: 'https://x' }]);
  assert.deepStrictEqual(r.statuses, { ABC: 'unknown' });
  assert.strictEqual(r.siteChange, false);
});

// ============================================================================
// Suite: VIN-log history + Compare Lists — appendVinLogHistory_, resolveCompareIds_
// ============================================================================
suite('compare lists');
t('history: one entry per order, order_date wins, committed_at fallback trimmed to date', function () {
  var hist = {};
  var ids = appendVinLogHistory_([
    ['ORDER_ID', 'VIN', 'committed_at', 'order_date'],        // stray header row
    ['5001', ' abc123 ', '2026-09-10 08:00:00', '2026-09-09'],
    ['5002', 'ABC123', '2026-09-20 10:00:00', ''],             // legacy: no order_date
    ['5002', 'ABC123', '2026-09-20 10:00:00', ''],             // same order twice
    ['',     'STK9',   '', '']                                  // logged, no order #
  ], hist, '');
  assert.deepStrictEqual(ids, ['ABC123', 'ABC123', 'ABC123', 'STK9']);   // header skipped
  assert.deepStrictEqual(hist.ABC123, [
    { order: '5001', date: '2026-09-09', dealer: '' },
    { order: '5002', date: '2026-09-20', dealer: '' }
  ]);
  assert.strictEqual(hist.STK9, undefined);
});
t('history: same order # under two dealers stays two entries', function () {
  var hist = {};
  appendVinLogHistory_([['7', 'V1', '', '2026-01-01']], hist, 'DEALER_A');
  appendVinLogHistory_([['7', 'V1', '', '2026-02-01']], hist, 'DEALER_B');
  assert.strictEqual(hist.V1.length, 2);
});
t('resolve: VIN-first then stock; history merged across VIN + stock, newest first', function () {
  var row = function (vin, stock, loc) {
    var r = new Array(21).fill('');
    r[0] = vin; r[1] = stock; r[2] = 'PO'; r[3] = '2022'; r[4] = 'Ford'; r[5] = 'F-150';
    r[8] = 'ONLOT'; r[19] = loc; r[20] = 'https://x/' + vin;
    return r;
  };
  var rows = [row('VINAAA', 'S100', 'Loc A'), row('VINBBB', 'S200', 'Loc B')];
  var history = {
    VINAAA: [{ order: '1', date: '2026-08-01', dealer: '' }],
    S100:   [{ order: '2', date: '2026-09-01', dealer: '' }, { order: '1', date: '2026-08-01', dealer: '' }]
  };
  var res = resolveCompareIds_(['VINAAA', 'S200', 'SOLDVIN'], rows, history, { 'Loc B': 'Dealer B' });
  assert.strictEqual(res.vehicles.VINAAA.stock, 'S100');
  assert.strictEqual(res.vehicles.VINAAA.dealer, '');                 // location not in map
  assert.strictEqual(res.vehicles.S200.vin, 'VINBBB');                // resolved by stock
  assert.strictEqual(res.vehicles.S200.dealer, 'Dealer B');
  assert.deepStrictEqual(res.history.VINAAA.map(function (e) { return e.order; }), ['2', '1']);
  assert.strictEqual(res.vehicles.SOLDVIN, undefined);
  assert.strictEqual(res.history.S200, undefined);
});
t('resolve: sold vehicle keeps its history with no vehicle data', function () {
  var res = resolveCompareIds_(['SOLDVIN'], [], { SOLDVIN: [{ order: '9', date: '', dealer: 'K' }] }, {});
  assert.strictEqual(res.vehicles.SOLDVIN, undefined);
  assert.strictEqual(res.history.SOLDVIN[0].order, '9');
});

// ============================================================================
// Suite: pipedrive api v2 — the Oct 2026 migration off the out-of-support v1
// endpoints. Pins the v2 WRITE shapes (monetary {value,currency}, enum id,
// set [ids], custom keys filed under custom_fields, standard keys top-level),
// the if_empty read of a v2 deal (custom_fields flattened; missing object =
// unreadable = never clobber), the v2 deals-list path (no all_not_deleted;
// server-side pipeline filter), and the EOM row builder resolving the names /
// catalog that a v2 deal no longer embeds.
// ============================================================================
suite('pipedrive api v2');
var CF_PROOF = 'a'.repeat(40), CF_AMT = 'b'.repeat(40), CF_DAYS = 'c'.repeat(40), CF_TXT = 'd'.repeat(40);

t('pdSetDealField_: monetary → {value,currency}; enum → integer id; set → [ids] (string / csv / array)', function () {
  var out = {};
  pdSetDealField_(out, CF_AMT, 'monetary', '1250.5', 'USD');     // the UI strips $/, before storing (psCoerceValue_)
  assert.deepStrictEqual(out[CF_AMT], { value: 1250.5, currency: 'USD' });
  assert.strictEqual(out[CF_AMT + '_currency'], undefined);          // the v1 companion key is gone
  pdSetDealField_(out, CF_AMT, 'monetary', { value: '99', currency: 'EUR' }, 'USD');
  assert.deepStrictEqual(out[CF_AMT], { value: 99, currency: 'EUR' });
  pdSetDealField_(out, CF_PROOF, 'enum', '12', 'USD');
  assert.strictEqual(out[CF_PROOF], 12);
  pdSetDealField_(out, CF_DAYS, 'set', '31', 'USD');
  assert.deepStrictEqual(out[CF_DAYS], [31]);
  pdSetDealField_(out, CF_DAYS, 'set', '31, 34', 'USD');
  assert.deepStrictEqual(out[CF_DAYS], [31, 34]);
  pdSetDealField_(out, CF_DAYS, 'set', [{ id: 35 }, 36], 'USD');
  assert.deepStrictEqual(out[CF_DAYS], [35, 36]);
  pdSetDealField_(out, CF_TXT, 'text', '00123', 'USD');
  assert.strictEqual(out[CF_TXT], '00123');                           // text is never coerced
});
t('pdDealPatchBody_: 40-char keys under custom_fields, standard keys top-level', function () {
  var body = pdDealPatchBody_({ title: 'T', value: 5 });
  assert.deepStrictEqual(body, { title: 'T', value: 5 });
  assert.strictEqual(body.custom_fields, undefined);
  var m = {}; m[CF_PROOF] = 12; m[CF_AMT] = { value: 1, currency: 'USD' }; m.title = 'X';
  body = pdDealPatchBody_(m);
  assert.strictEqual(body.title, 'X');
  assert.strictEqual(body[CF_PROOF], undefined);
  assert.strictEqual(body.custom_fields[CF_PROOF], 12);
  assert.deepStrictEqual(body.custom_fields[CF_AMT], { value: 1, currency: 'USD' });
});
t('pdFlattenDealFields_: v2 custom_fields merge flat; no custom_fields object = unreadable (null)', function () {
  var d = { id: 1, title: 'T', custom_fields: {} }; d.custom_fields[CF_PROOF] = 12;
  var flat = pdFlattenDealFields_(d);
  assert.strictEqual(flat[CF_PROOF], 12);
  assert.strictEqual(flat.title, 'T');
  assert.strictEqual(flat.custom_fields, undefined);
  assert.strictEqual(pdFlattenDealFields_({ id: 1, title: 'T' }), null);
  assert.strictEqual(pdFlattenDealFields_(null), null);
});
t('pdDealPatchBody_: v1 Owner key user_id → v2 owner_id; relation ids coerced to Number', function () {
  var m = { user_id: '12345', stage_id: '7', title: 'T' }; m[CF_PROOF] = 12;
  var body = pdDealPatchBody_(m);
  assert.strictEqual(body.user_id, undefined);         // v2 rejects it outright
  assert.strictEqual(body.owner_id, 12345);
  assert.strictEqual(body.stage_id, 7);
  assert.strictEqual(body.title, 'T');
  assert.strictEqual(body.custom_fields[CF_PROOF], 12);
});
t('pdFlattenDealFields_: v2 owner_id aliased to the v1 rule key user_id (if_empty reads it)', function () {
  var flat = pdFlattenDealFields_({ id: 1, owner_id: 99, custom_fields: {} });
  assert.strictEqual(flat.user_id, 99);
  assert.strictEqual(pdFieldEmpty_(flat.user_id), false);
});
t('pdFieldEmpty_: v2 shapes — {value:null} monetary, [] set, 0/id set are judged correctly', function () {
  assert.strictEqual(pdFieldEmpty_({ value: null, currency: 'USD' }), true);
  assert.strictEqual(pdFieldEmpty_({ value: 5, currency: 'USD' }), false);
  assert.strictEqual(pdFieldEmpty_([]), true);
  assert.strictEqual(pdFieldEmpty_([31]), false);
  assert.strictEqual(pdFieldEmpty_(12), false);
  assert.strictEqual(pdFieldEmpty_(null), true);
});
function withOrgStub_(org, fn) {
  var saved = globalThis.pdGetOrgWithCustomFields_;
  globalThis.pdGetOrgWithCustomFields_ = function () { return org; };
  try { fn(); } finally { globalThis.pdGetOrgWithCustomFields_ = saved; }
}
t('pdResolveDealFields_: copy rules read v2 org values (enum id, set array, monetary object) and emit v2 deal values', function () {
  var cf = {}; cf[CF_PROOF] = 21; cf[CF_DAYS] = [31, 34, 99]; cf[CF_AMT] = { value: 250, currency: 'USD' }; cf[CF_TXT] = 'note';
  var rules = [
    { id: 'r1', deal_field: CF_PROOF, type: 'enum', mode: 'copy', org_field: CF_PROOF, option_map: { '21': '12' } },
    { id: 'r2', deal_field: CF_DAYS,  type: 'set',  mode: 'copy', org_field: CF_DAYS,  option_map: { '31': '1', '34': '2' } },
    { id: 'r3', deal_field: CF_AMT,   type: 'monetary', mode: 'copy', org_field: CF_AMT },
    { id: 'r4', deal_field: CF_TXT,   type: 'text', mode: 'copy', org_field: CF_TXT }
  ];
  withOrgStub_({ id: 1, custom_fields: cf }, function () {
    var out = pdResolveDealFields_(1, rules, {}, 'USD', true, null);
    assert.strictEqual(out[CF_PROOF], 12);                             // mapped org option → deal option id
    assert.deepStrictEqual(out[CF_DAYS], [1, 2]);                      // set: mapped per element, unmapped 99 dropped
    assert.deepStrictEqual(out[CF_AMT], { value: 250, currency: 'USD' });
    assert.strictEqual(out[CF_TXT], 'note');
    assert.strictEqual(Object.keys(out).some(function (k) { return /_currency$/.test(k); }), false);
  });
});
t('pdResolveDealFields_: constant if_empty on a LINK reads the flattened v2 deal; set value → [id]; unreadable → skip', function () {
  var rules = [{ id: 'c1', deal_field: CF_PROOF, type: 'enum', mode: 'constant', value: '12', if_empty: true },
               { id: 'c2', deal_field: CF_DAYS,  type: 'set',  mode: 'constant', value: '31' }];
  var existingSet = {}; existingSet[CF_PROOF] = 11;
  var out = pdResolveDealFields_(1, rules, {}, 'USD', false, existingSet);
  assert.strictEqual(out[CF_PROOF], undefined);                        // already set → left alone
  assert.deepStrictEqual(out[CF_DAYS], [31]);
  out = pdResolveDealFields_(1, rules, {}, 'USD', false, {});          // readable + empty → set
  assert.strictEqual(out[CF_PROOF], 12);
  out = pdResolveDealFields_(1, rules, {}, 'USD', false, null);        // unreadable → never clobber
  assert.strictEqual(out[CF_PROOF], undefined);
  out = pdResolveDealFields_(1, rules, {}, 'USD', true, null);         // new deal = empty → set
  assert.strictEqual(out[CF_PROOF], 12);
});
t('pdRelId_: v2 plain id, v1 {name,value}, {id}, junk', function () {
  assert.strictEqual(pdRelId_(501), 501);
  assert.strictEqual(pdRelId_('501'), 501);
  assert.strictEqual(pdRelId_({ name: 'X', value: 502 }), 502);
  assert.strictEqual(pdRelId_({ id: 503 }), 503);
  assert.strictEqual(pdRelId_(null), 0);
  assert.strictEqual(pdRelId_({}), 0);
  assert.strictEqual(pdRelId_('abc'), 0);
});
t('eomDealsListPath_: v2 list paths — pipeline filtered server-side, no all_not_deleted, Duplicates via custom_fields', function () {
  var savedP = globalThis.eomGetPipelineId_, savedS = globalThis.eomGetDefaultStageId_;
  globalThis.eomGetPipelineId_ = function () { return 4; };
  globalThis.eomGetDefaultStageId_ = function () { return 44; };
  try {
    assert.strictEqual(eomDealsListPath_('full_billing', null, CF_TXT), '/deals?status=open&pipeline_id=4&custom_fields=' + CF_TXT);
    assert.strictEqual(eomDealsListPath_('stage', '45', ''), '/deals?stage_id=45');
    assert.strictEqual(eomDealsListPath_('stage', 'x', ''), '/deals?stage_id=44');
    assert.strictEqual(eomDealsListPath_('stage', 45, '').indexOf('all_not_deleted'), -1);
  } finally { globalThis.eomGetPipelineId_ = savedP; globalThis.eomGetDefaultStageId_ = savedS; }
});
t('eomBuildRows_: v2 deal + v2 lines → names/catalog from ctx, dup from custom_fields, update_time, RFC3339 kept', function () {
  var savedPn = globalThis.eomPipelineName_, savedSn = globalThis.eomStageName_;
  globalThis.eomPipelineName_ = function () { return 'Billing'; };
  globalThis.eomStageName_ = function () { return 'EOM Merge'; };
  try {
    var deal = { id: 900101, title: 'Deal A', add_time: '2026-07-01T09:00:00Z', org_id: 501, person_id: 601, owner_id: 701,
                 value: 610, currency: 'USD', pipeline_id: 4, stage_id: 44, custom_fields: {} };
    deal.custom_fields[CF_TXT] = 2;
    var lines = [{ id: 1, product_id: 9001, name: 'Shortcut Pack', item_price: 61, quantity: 10, sum: 610, tax: 9.679,
                   product_variation_id: 9001001, comments: '<p>hi</p>', add_time: '2026-07-01T09:00:00Z', update_time: '2026-07-02T10:00:00Z' }];
    var ctx = { dupKey: CF_TXT, orgNames: { '501': 'Sandbox Motors' }, personNames: { '601': 'Pat' }, userNames: { '701': 'Dev User' },
                catalog: { '9001': { code: 'SC', description: 'desc', tax: 9.679 } }, variations: { '9001001': 'Standard' } };
    var C = eomColIndex_();
    var rows = eomBuildRows_(deal, lines, ctx);
    assert.strictEqual(rows.length, 1);
    var r = rows[0];
    assert.strictEqual(r[C.org_name], 'Sandbox Motors');
    assert.strictEqual(r[C.person_name], 'Pat');
    assert.strictEqual(r[C.deal_owner], 'Dev User');
    assert.strictEqual(r[C.duplicates], 2);
    assert.strictEqual(r[C.deal_created_at], '2026-07-01T09:00:00Z');
    assert.strictEqual(r[C.product_code], 'SC');
    assert.strictEqual(r[C.product_description], 'desc');
    assert.strictEqual(r[C.product_tax_percent], 9.679);
    assert.strictEqual(r[C.variation], 'Standard');
    assert.strictEqual(r[C.product_notes], 'hi');
    assert.strictEqual(r[C.product_last_edited], '2026-07-02T10:00:00Z');
    // Legacy v1 shape still renders (archived report.json re-generation safety net).
    var v1deal = { id: 1, title: 'Old', org_id: { name: 'Old Org', value: 9 }, person_id: null, user_id: { name: 'Owner', value: 2 } };
    v1deal[CF_TXT] = 1;
    var v1line = { id: 2, product_id: 5, name: 'P', product_variation_id: 7, last_edit: '2026-01-01 00:00:00',
                   product: { code: 'OLD', description: '', tax: 0, product_variations: [{ id: 7, name: 'V7' }] } };
    var old = eomBuildRows_(v1deal, [v1line], { dupKey: CF_TXT, orgNames: {}, personNames: {}, userNames: {}, catalog: {}, variations: {} })[0];
    assert.strictEqual(old[C.org_name], 'Old Org');
    assert.strictEqual(old[C.deal_owner], 'Owner');
    assert.strictEqual(old[C.duplicates], 1);
    assert.strictEqual(old[C.product_code], 'OLD');
    assert.strictEqual(old[C.variation], 'V7');
    assert.strictEqual(old[C.product_last_edited], '2026-01-01 00:00:00');
    // No products → one row so the deal isn't lost.
    assert.strictEqual(eomBuildRows_(deal, [], ctx).length, 1);
  } finally { globalThis.eomPipelineName_ = savedPn; globalThis.eomStageName_ = savedSn; }
});
t('pdFakeFetch_: v2-shaped fixtures — plain relation ids, custom_fields, ?ids= filters, PATCH merges custom_fields', function () {
  if (typeof pdFakeFetch_ !== 'function') return;
  var saved = globalThis.eomGetPipelineId_; globalThis.eomGetPipelineId_ = function () { return 4; };
  try {
    var d = pdFakeFetch_('get', '/deals/900555').data;
    assert.strictEqual(typeof d.org_id, 'number');
    assert.strictEqual(typeof d.owner_id, 'number');
    assert.strictEqual(d.user_id, undefined);
    assert.strictEqual(typeof d.custom_fields, 'object');
    assert.ok(/T.*Z$/.test(d.add_time));
    var patch = { custom_fields: {} }; patch.custom_fields[CF_PROOF] = 12;
    var after = pdFakeFetch_('patch', '/deals/900555', patch).data;
    assert.strictEqual(after.custom_fields[CF_PROOF], 12);
    assert.strictEqual(after.custom_fields[PD_FAKE_DUP_FIELD_KEY], 1);  // merge, not replace
    var orgs = pdFakeFetch_('get', '/organizations?ids=502&limit=500').data;
    assert.deepStrictEqual(orgs.map(function (o) { return o.id; }), [502]);
    var users = pdFakeFetch_('get', '/users?start=0&limit=500', null, { version: 'v1' }).data;
    assert.strictEqual(users[0].id, 701);
    var line = pdFakeFetch_('post', '/deals/900555/products', { product_id: 9001, item_price: 61, quantity: 2, tax: 9.679, tax_method: 'exclusive' }).data;
    assert.strictEqual(line.name, 'FAKE Shortcut Pack');
    assert.strictEqual(line.sum, 122);
    var eom = pdFakeEomProducts_([900555])[900555];
    assert.strictEqual(eom[0].product, undefined);                      // v2: no embedded product
    assert.ok(eom.some(function (l) { return l.update_time; }));
  } finally { globalThis.eomGetPipelineId_ = saved; }
});

// ============================================================================
// Suite: standalone eom-viewer — byte-copies, ENV resolver, DEV Pipedrive fake.
// The viewer runs in its OWN vm context: its helper names (pdRelId_,
// eomGroupForReport_, ...) collide with Code.gs in the global scope.
// ============================================================================
suite('standalone eom-viewer');
var VIEWER_DIR = path.join(ROOT, 'eom-viewer');
var VIEWER_DEV_ID  = '1IlGUPGyJpPeF9YnuvcKMGVbD8qQRIPHR6YurtBe5PrL3s7k138ff-P_f';
var VIEWER_PROD_ID = '14AbPr3pM9Grg3gu2dFMWvQOAIksI-x-zGysygzy8PXCmcBRObKvVQgW2';
var viewerSource = fs.readFileSync(path.join(VIEWER_DIR, 'Code.gs'), 'utf8');
function loadViewer_(scriptId, fetchStub) {
  var vm = require('vm');
  var noNet = function (what) { return function () { throw new Error('UrlFetchApp.' + what + ' called — the fake path must make zero network calls'); }; };
  var ctx = {
    ScriptApp: { getScriptId: function () { return scriptId; } },
    Logger: { log: function () {} },
    PropertiesService: { getScriptProperties: function () { return propStore_(); } },
    Session: { getActiveUser: function () { return { getEmail: function () { return 'dev@example.com'; } }; },
               getScriptTimeZone: function () { return 'America/Chicago'; } },
    Utilities: { sleep: function () {}, formatDate: function (d) { return d.toISOString(); } },
    UrlFetchApp: fetchStub || { fetch: noNet('fetch'), fetchAll: noNet('fetchAll') },
    SpreadsheetApp: { openById: function () { throw new Error('no sheets in the harness'); } }
  };
  vm.createContext(ctx);
  vm.runInContext(pdFakeSource, ctx);   // the viewer's PdFake.gs is a byte-copy (guarded below)
  vm.runInContext(viewerSource, ctx);
  return ctx;
}
t('PdFake.gs and EomReportRenderer.html are byte-identical copies of the main app files', function () {
  ['PdFake.gs', 'EomReportRenderer.html'].forEach(function (f) {
    assert.ok(fs.readFileSync(path.join(ROOT, f)).equals(fs.readFileSync(path.join(VIEWER_DIR, f))),
              'eom-viewer/' + f + ' drifted from the root copy — re-copy it');
  });
});
t('ENV resolver: unregistered scriptId throws at load; DEV / PROD resolve their own index sheet', function () {
  assert.throws(function () { loadViewer_('STRAY_DRIVE_COPY_SCRIPT_ID'); }, /Unknown scriptId/);
  var dev = loadViewer_(VIEWER_DEV_ID), prod = loadViewer_(VIEWER_PROD_ID);
  assert.strictEqual(dev.ENV.name, 'dev');
  assert.strictEqual(dev.INDEX_SHEET_ID, '18EQEMCS6Z6ux767ETyeVsFFjsYxrmHMw_m00sQEaoDU');
  assert.strictEqual(prod.ENV.name, 'prod');
  assert.strictEqual(prod.INDEX_SHEET_ID, '1p28o2IbGFrHOqKVs_DUpAtyzM6LFYyAKUpsBB7NwFxg');
});
t('cvFakeJson_: a full v1/v2 url maps onto the fake route — token stripped, version honored', function () {
  var v = loadViewer_(VIEWER_DEV_ID);
  var st = v.cvFakeJson_('https://fake-dev.pipedrive.com/api/v2/stages?limit=500&api_token=FAKE');
  assert.strictEqual(st.data[0].name, 'FAKE EOM Merge');
  var users = v.cvFakeJson_('https://fake-dev.pipedrive.com/api/v1/users?start=0&limit=500&api_token=FAKE');
  assert.strictEqual(users.data[0].id, 701);
  var v1p = v.cvFakeJson_('https://fake-dev.pipedrive.com/api/v1/products?start=0&limit=500&api_token=FAKE');
  assert.strictEqual(v1p.data[0].selectable, true);          // v1 flag shape ⇒ version segment honored
  var v2p = v.cvFakeJson_('https://fake-dev.pipedrive.com/api/v2/products?ids=9001&limit=500&api_token=FAKE');
  assert.strictEqual(v2p.data.length, 1);
  assert.strictEqual(v2p.data[0].is_linkable, true);
  assert.strictEqual(v.cvFakeJson_('https://example.com/nope'), null);             // not an API url → null
});
t('DEV: Current pull is enabled without secrets and fully served by the fake — zero network calls', function () {
  var v = loadViewer_(VIEWER_DEV_ID);
  var s = v.cvSecrets_();
  assert.ok(s && s.fake === true && s.token === 'FAKE');
  assert.strictEqual(v.getViewerBootstrap().current, true);
  var res = v.getCurrentReport();
  assert.strictEqual(res.ok, true, res.error);
  var rep = JSON.parse(res.json);
  assert.strictEqual(rep.meta.current, true);
  assert.strictEqual(rep.meta.dealCount, 3);                 // the fake's canned stage-44 deals
  assert.strictEqual(rep.meta.stageName, 'FAKE Stage 44');
  assert.ok(rep.group.length >= 1);
  rep.group.forEach(function (g) { assert.ok(/^FAKE /.test(g.org), 'org resolved via fake /organizations?ids=: ' + g.org); });
  var text = res.json;
  assert.ok(text.indexOf('FAKE Dev Auto Group') !== -1);     // org name resolved (deal 900102 → org 502)
  assert.ok(text.indexOf('FAKE-SC') !== -1);                 // catalog code via fake /products?ids=
  assert.ok(text.indexOf('FAKE Standard') !== -1);           // variation name via fake /products/9001/variations
});
t('PROD: secrets still required; the fetch layer goes to UrlFetchApp, never the fake', function () {
  var calls = [];
  var stub = {
    fetch: function (url) { calls.push(url); return { getResponseCode: function () { return 200; }, getContentText: function () { return '{"data":{"id":1}}'; } }; },
    fetchAll: function () { return []; }
  };
  var v = loadViewer_(VIEWER_PROD_ID, stub);
  assert.strictEqual(v.cvSecrets_(), null);
  assert.strictEqual(v.getViewerBootstrap().current, false);
  var res = v.getCurrentReport();
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'The current-report pull is not configured.');
  var body = v.cvGetJson_('https://x.pipedrive.com/api/v2/stages/44?api_token=t');
  assert.strictEqual(body.data.id, 1);
  assert.strictEqual(calls.length, 1);
});

// ============================================================================
// Suite: run ledger codec — the one place that knows the RUN_LOG / VIN-log layout
// ============================================================================
suite('run ledger codec');
// A row exactly as writeRunLog_ appends it (A–W), with a Date in A like getValues() returns.
function runRow_(o) {
  o = o || {};
  return [
    o.ts !== undefined ? o.ts : new Date(Date.UTC(2026, 5, 22, 9, 56, 33)),
    o.dealer || 'COLUMBIA_HONDA', o.name || 'Columbia Honda',
    o.deal !== undefined ? o.deal : 3941,
    29, 29, 20, 9, 0, 0, 1, 0, 0, 0, 1, 29, '', o.doc || 'DOC_1', 42, '',
    o.note || '', o.vins !== undefined ? o.vins : '1HGAA,1HGBB,1HGCC', o.status || ''
  ];
}
t('decode: a writeRunLog_-shaped row reads back as a run record', function () {
  var r = rlDecodeRow_(runRow_(), 7);
  assert.strictEqual(r.rowIndex, 7);
  assert.strictEqual(r.timestamp, '2026-06-22 09:56:33');
  assert.strictEqual(r.dealerKey, 'COLUMBIA_HONDA');
  assert.strictEqual(r.dealId, '3941');                       // numeric cell → text
  assert.strictEqual(r.totalOrdered, 29);
  assert.strictEqual(r.billing.totalNew, 20);
  assert.strictEqual(r.billing.totalPO, 9);
  assert.strictEqual(r.billing.totalDupes, 1);
  assert.strictEqual(r.outputDocId, 'DOC_1');
  assert.deepStrictEqual(r.producedVins, ['1HGAA', '1HGBB', '1HGCC']);
  assert.strictEqual(r.status, 'pending');                    // blank W = pending
  assert.strictEqual(r.isTest, false);
  assert.strictEqual(r.isSplit, false);
  assert.strictEqual(r.group, 'PRIMARY');
});
t('decode → encode round-trips the exact 23-cell layout writeRunLog_ writes', function () {
  var row = runRow_({ ts: '2026-06-22 09:56:33', deal: '3941', status: 'committed', note: 'SPLIT:SPRINTER' });
  assert.deepStrictEqual(rlEncodeRecord_(rlDecodeRow_(row, 2)), row);
  assert.strictEqual(rlEncodeRecord_(rlDecodeRow_(row, 2)).length, RL_WIDTH);
});
t('encode: a pending record writes a blank status cell (blank W is what pending means)', function () {
  var rec = rlDecodeRow_(runRow_({ ts: '2026-06-22 09:56:33' }), 2);
  assert.strictEqual(rec.status, 'pending');
  assert.strictEqual(rlEncodeRecord_(rec)[RL_COL.STATUS], '');
});
t('decode: status words pass through; legacy date-only timestamps read as midnight', function () {
  assert.strictEqual(rlDecodeRow_(runRow_({ status: 'rolled_back' }), 2).status, 'rolled_back');
  assert.strictEqual(rlDecodeRow_(runRow_({ ts: new Date(Date.UTC(2026, 4, 8)) }), 2).timestamp, '2026-05-08 00:00:00');
});
t('decode: a short row reads as blanks instead of throwing', function () {
  var r = rlDecodeRow_(['2026-11-05 11:25:04', 'BMW_WEST_STL'], 3);
  assert.strictEqual(r.dealerKey, 'BMW_WEST_STL');
  assert.strictEqual(r.dealId, '');
  assert.deepStrictEqual(r.producedVins, []);
  assert.strictEqual(r.status, 'pending');
});
t('test runs: exact "test" in any case; "test2" and real deal ids are not tests', function () {
  ['test', 'TEST', ' Test '].forEach(function (d) { assert.strictEqual(rlIsTestDealId_(d), true, d); });
  ['test2', '', '4012', 4012, null].forEach(function (d) { assert.strictEqual(rlIsTestDealId_(d), false, String(d)); });
  assert.strictEqual(rlDecodeRow_(runRow_({ deal: 'TEST' }), 2).isTest, true);
});
t('split note: SPLIT:<group> gives the upper-cased group; anything else is PRIMARY, not split', function () {
  assert.strictEqual(rlSplitGroup_('SPLIT:sprinter'), 'SPRINTER');
  assert.strictEqual(rlSplitGroup_('SPLIT:PRIMARY'), 'PRIMARY');
  assert.strictEqual(rlSplitGroup_(''), 'PRIMARY');
  assert.strictEqual(rlSplitGroup_('rerun for dealer'), 'PRIMARY');
  assert.strictEqual(rlIsSplit_('SPLIT:PRIMARY'), true);
  assert.strictEqual(rlIsSplit_('rerun for dealer'), false);
});
t('produced VINs CSV: trims, drops blanks, keeps order and case', function () {
  assert.deepStrictEqual(rlParseVinsCsv_(' 1HGaa, 1HGBB ,,1HGCC '), ['1HGaa', '1HGBB', '1HGCC']);
  assert.deepStrictEqual(rlParseVinsCsv_(''), []);
  assert.deepStrictEqual(rlParseVinsCsv_(null), []);
});
t('fingerprint: a Date cell matches the formatted string a view hands back; numeric deal ids match text', function () {
  var rec = rlDecodeRow_(runRow_(), 5);
  var fp  = { dealerKey: 'COLUMBIA_HONDA', timestamp: '2026-06-22 09:56:33', dealId: 3941 };
  assert.strictEqual(rlFingerprintMatches_(rec, fp), true);
  assert.deepStrictEqual(rlFingerprint_(rec), { dealerKey: 'COLUMBIA_HONDA', timestamp: '2026-06-22 09:56:33', dealId: '3941' });
});
t('fingerprint: any one part different is a mismatch (stale row / wrong run)', function () {
  var rec = rlDecodeRow_(runRow_(), 5);
  var ok  = { dealerKey: 'COLUMBIA_HONDA', timestamp: '2026-06-22 09:56:33', dealId: '3941' };
  assert.strictEqual(rlFingerprintMatches_(rec, Object.assign({}, ok, { dealerKey: 'PUNDMANN_FORD' })), false);
  assert.strictEqual(rlFingerprintMatches_(rec, Object.assign({}, ok, { timestamp: '2026-06-22 01:37:31' })), false);
  assert.strictEqual(rlFingerprintMatches_(rec, Object.assign({}, ok, { dealId: '3942' })), false);
  assert.strictEqual(rlFingerprintMatches_(rec, null), false);
});
t('run_ref: the run time; split halves add their group so they never share a tag', function () {
  var plain = rlDecodeRow_(runRow_(), 2);
  var a = rlDecodeRow_(runRow_({ note: 'SPLIT:PRIMARY' }), 3);
  var b = rlDecodeRow_(runRow_({ note: 'SPLIT:SPRINTER' }), 4);
  assert.strictEqual(rlRunRef_(plain), '2026-06-22 09:56:33');
  assert.strictEqual(rlRunRef_(a), '2026-06-22 09:56:33|PRIMARY');
  assert.strictEqual(rlRunRef_(b), '2026-06-22 09:56:33|SPRINTER');
  assert.notStrictEqual(rlRunRef_(a), rlRunRef_(b));
});
t('VIN-log rows: legacy 3/4-col rows read with a blank run_ref; encode forces ids to text', function () {
  var legacy = rlDecodeVinLogRow_(['41556', '3FMCR9B69RRE99835', new Date(Date.UTC(2026, 5, 1, 17, 37, 46))], 2);
  assert.strictEqual(legacy.committedAt, '2026-06-01 17:37:46');
  assert.strictEqual(legacy.orderDate, '');
  assert.strictEqual(legacy.runRef, '');
  assert.deepStrictEqual(rlEncodeVinLogRow_({ orderId: 3664, vin: ' 1FMCU0GNXRUB21932 ', committedAt: 'c', orderDate: 'o', runRef: 'r' }),
                         ['3664', '1FMCU0GNXRUB21932', 'c', 'o', 'r']);
  assert.strictEqual(rlEncodeVinLogRow_({ orderId: 1, vin: 'V' }).length, VL_WIDTH);
});
t('contiguous blocks: highest first, runs merged, duplicates collapsed', function () {
  assert.deepStrictEqual(rlContiguousBlocks_([7, 3, 4, 5, 9]), [{ start: 9, count: 1 }, { start: 7, count: 1 }, { start: 3, count: 3 }]);
  assert.deepStrictEqual(rlContiguousBlocks_([4, 4, 5]), [{ start: 4, count: 2 }]);
  assert.deepStrictEqual(rlContiguousBlocks_([]), []);
});

// ============================================================================
// Suite: run ledger store seam — real adapter and in-memory fake stay in step
// ============================================================================
suite('run ledger store seam');
function storeMethods_(s) { return Object.keys(s).filter(function (k) { return k.charAt(0) !== '_'; }).sort(); }
t('the fake satisfies the same interface as rlSheetStore_ (no method missing on either side)', function () {
  assert.deepStrictEqual(storeMethods_(makeFakeLedgerStore()), storeMethods_(rlSheetStore_()));
});
t('real adapter: every write refuses to run outside withLock (checked before any sheet is touched)', function () {
  var real = rlSheetStore_();
  assert.throws(function () { real.appendRun([]); }, /appendRun outside withLock/);
  assert.throws(function () { real.setRunCell(2, RL_COL.STATUS, 'committed'); }, /setRunCell outside withLock/);
  assert.throws(function () { real.appendVinLog('X', [[]]); }, /appendVinLog outside withLock/);
  assert.throws(function () { real.deleteVinLogRows('X', [2]); }, /deleteVinLogRows outside withLock/);
});
t('fake: every write refuses to run outside withLock, like the real adapter', function () {
  var s = makeFakeLedgerStore({ runLog: [runRow_()], vinLogs: { COLUMBIA_HONDA: [] } });
  assert.throws(function () { s.appendRun(runRow_()); }, /outside withLock/);
  assert.throws(function () { s.setRunCell(2, RL_COL.STATUS, 'committed'); }, /outside withLock/);
  assert.throws(function () { s.appendVinLog('COLUMBIA_HONDA', [['1', 'V']]); }, /outside withLock/);
  assert.throws(function () { s.deleteVinLogRows('COLUMBIA_HONDA', [2]); }, /outside withLock/);
});
t('fake: a busy lock fails with the message the user sees', function () {
  var s = makeFakeLedgerStore({ lockBusy: true });
  assert.throws(function () { s.withLock(function () {}); }, /Another change is in progress — try again\./);
});
t('fake: rows behave like sheet rows — 1-based with a header, padded copies, appends return the row', function () {
  var s = makeFakeLedgerStore({ runLog: [runRow_()] });
  assert.strictEqual(s.readRun(1), null);                       // header row is not data
  assert.strictEqual(s.readRun(2).length, RL_WIDTH);
  assert.strictEqual(s.readRun(3), null);
  var at = s.withLock(function () { return s.appendRun(['2026-11-12 10:00:00', 'BMW_WEST_STL']); });
  assert.strictEqual(at, 3);
  assert.strictEqual(s.readRun(3).length, RL_WIDTH);
  s.readRun(2)[RL_COL.STATUS] = 'tampered';                     // a copy — the "sheet" is untouched
  assert.strictEqual(s.readRun(2)[RL_COL.STATUS], '');
});
t('fake: VIN-log appends store ids as text and add the run_ref header; deletes shift rows up', function () {
  var s = makeFakeLedgerStore({ vinLogs: { PUNDMANN_FORD: [['3664', 'A', 'c1'], ['3664', 'B', 'c1'], ['3664', 'C', 'c2']] } });
  assert.strictEqual(s._header('PUNDMANN_FORD')[4], '');
  s.withLock(function () { s.appendVinLog('PUNDMANN_FORD', [[3664, 'D', 'c3', 'o3', 'ref3']]); });
  assert.strictEqual(s._header('PUNDMANN_FORD')[4], 'run_ref');
  assert.strictEqual(s.readVinLog('PUNDMANN_FORD')[3][0], '3664');
  s.withLock(function () { s.deleteVinLogRows('PUNDMANN_FORD', [2, 4]); });   // A and C
  assert.deepStrictEqual(s.readVinLog('PUNDMANN_FORD').map(function (r) { return r[1]; }), ['B', 'D']);
  assert.throws(function () { s.withLock(function () { s.appendVinLog('NO_SUCH_TAB', [['1', 'V']]); }); }, /No VIN log tab found for: NO_SUCH_TAB/);
});

// ============================================================================
// Suite: run ledger operations — commit / rollback / delete / manual entry
// through the strict fake store (every write must happen inside the lock)
// ============================================================================
suite('run ledger operations');
// Text timestamps keep fixtures readable; rlFormatTs_ treats them the same as Dates.
var T1 = '2026-06-01 17:29:32', T2 = '2026-06-01 17:36:56';
function pf_(o) { return runRow_(Object.assign({ dealer: 'PUNDMANN_FORD', name: 'Pundmann Ford', deal: '3664', vins: 'VA,VB' }, o)); }
function fpRef_(store, row) {
  var r = rlDecodeRow_(store.readRun(row), row);
  return { rowIndex: row, dealerKey: r.dealerKey, timestamp: r.timestamp, dealId: r.dealId };
}
function vinCol_(store, key, col) { return store._vinLog(key).map(function (r) { return r[col]; }); }

t('commit by fingerprint: writes a tagged batch dated at the run, then marks the run committed', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [] }, now: '2026-06-01 17:40:00' });
  var res = ledgerCommitRunsWith_(s, [fpRef_(s, 2)]);
  assert.deepStrictEqual(res, { committed: 2, skippedCommitted: 0, skippedTest: 0 });
  assert.deepStrictEqual(s._vinLog('PUNDMANN_FORD'), [
    ['3664', 'VA', '2026-06-01 17:40:00', T1, T1],
    ['3664', 'VB', '2026-06-01 17:40:00', T1, T1]
  ]);
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], 'committed');
  assert.strictEqual(s._header('PUNDMANN_FORD')[4], 'run_ref');
  assert.strictEqual(s._stats().locks, 1);
});
t('double commit is a no-op: the second call skips, nothing new is written', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [] } });
  ledgerCommitRunsWith_(s, [fpRef_(s, 2)]);
  var again = ledgerCommitRunsWith_(s, [fpRef_(s, 2)]);
  assert.deepStrictEqual(again, { committed: 0, skippedCommitted: 1, skippedTest: 0 });
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 2);
});
t('the same run named twice in one call commits once', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [] } });
  var res = ledgerCommitRunsWith_(s, [fpRef_(s, 2), fpRef_(s, 2)]);
  assert.deepStrictEqual(res, { committed: 2, skippedCommitted: 1, skippedTest: 0 });
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 2);
});
t('test runs are skipped, never logged, and keep their blank status', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: 'TEST' })], vinLogs: { PUNDMANN_FORD: [] } });
  assert.deepStrictEqual(ledgerCommitRunsWith_(s, [fpRef_(s, 2)]), { committed: 0, skippedCommitted: 0, skippedTest: 1 });
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 0);
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], '');
});
t('a stale fingerprint is refused before anything is written', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [] } });
  var ref = fpRef_(s, 2); ref.timestamp = T2;
  assert.throws(function () { ledgerCommitRunsWith_(s, [ref]); }, /no longer matches this run — reload/);
  assert.throws(function () { ledgerCommitRunsWith_(s, [{ rowIndex: 9, dealerKey: 'PUNDMANN_FORD', timestamp: T1, dealId: '3664' }]); }, /no longer matches/);
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 0);
  assert.strictEqual(s._stats().writes, 0);
});
t('the VINs come from the run log row, not the caller (extra ref fields are ignored)', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [] } });
  var ref = fpRef_(s, 2); ref.producedVins = ['EVIL1', 'EVIL2', 'EVIL3']; ref.orderDate = '1999-01-01';
  ledgerCommitRunsWith_(s, [ref]);
  assert.deepStrictEqual(vinCol_(s, 'PUNDMANN_FORD', 1), ['VA', 'VB']);
  assert.deepStrictEqual(vinCol_(s, 'PUNDMANN_FORD', 3), [T1, T1]);
});
t('Run view: commit by output doc + group; split halves get distinct tags', function () {
  var s = makeFakeLedgerStore({
    runLog: [pf_({ ts: T1, deal: '501', doc: 'DOC_9', note: 'SPLIT:PRIMARY', vins: 'VA' }),
             pf_({ ts: T1, deal: '502', doc: 'DOC_9', note: 'SPLIT:SPRINTER', vins: 'VS' })],
    vinLogs: { PUNDMANN_FORD: [] }
  });
  var res = ledgerCommitRunsWith_(s, [{ dealerKey: 'PUNDMANN_FORD', outputDocId: 'DOC_9', note: 'SPLIT:PRIMARY' },
                                     { dealerKey: 'PUNDMANN_FORD', outputDocId: 'DOC_9', note: 'SPLIT:SPRINTER' }]);
  assert.strictEqual(res.committed, 2);
  assert.deepStrictEqual(vinCol_(s, 'PUNDMANN_FORD', 4), [T1 + '|PRIMARY', T1 + '|SPRINTER']);
});
t('Run view: an output doc with two live rows (an old double finalize) is refused', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, doc: 'DOC_7' }), pf_({ ts: T2, doc: 'DOC_7' })], vinLogs: { PUNDMANN_FORD: [] } });
  assert.throws(function () { ledgerCommitRunsWith_(s, [{ dealerKey: 'PUNDMANN_FORD', outputDocId: 'DOC_7', note: '' }]); },
                /has 2 rows in the run log — commit it from the VIN Logs page/);
  assert.throws(function () { ledgerCommitRunsWith_(s, [{ dealerKey: 'PUNDMANN_FORD', outputDocId: 'NOPE', note: '' }]); },
                /not in the run log yet/);
});
t('a half-finished commit (batch written, status not) is finished without writing the batch again', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })],
    vinLogs: { PUNDMANN_FORD: [['3664', 'VA', 'c', T1, T1], ['3664', 'VB', 'c', T1, T1]] } });
  assert.strictEqual(ledgerCommitRunsWith_(s, [fpRef_(s, 2)]).committed, 2);
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 2);
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], 'committed');
});
t('deleted runs, runs with no VINs and dealers with no VIN log tab cannot be committed', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'deleted' }), pf_({ ts: T2, vins: '' })], vinLogs: { PUNDMANN_FORD: [] } });
  assert.throws(function () { ledgerCommitRunsWith_(s, [fpRef_(s, 2)]); }, /was deleted/);
  assert.throws(function () { ledgerCommitRunsWith_(s, [fpRef_(s, 3)]); }, /No produced VINs/);
  var t2 = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })] });
  assert.throws(function () { ledgerCommitRunsWith_(t2, [fpRef_(t2, 2)]); }, /No VIN log tab found for: PUNDMANN_FORD/);
});
t('a rolled-back run can be committed again (a fresh tagged batch)', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'rolled_back' })], vinLogs: { PUNDMANN_FORD: [] } });
  assert.strictEqual(ledgerCommitRunsWith_(s, [fpRef_(s, 2)]).committed, 2);
});

t('rollback, tagged: two committed reruns on one deal — rolling back the OLDER removes only its own batch', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 }), pf_({ ts: T2 })], vinLogs: { PUNDMANN_FORD: [] } });
  s._setNow('2026-06-01 17:37:46'); ledgerCommitRunsWith_(s, [fpRef_(s, 2)]);
  s._setNow('2026-09-08 17:21:49'); ledgerCommitRunsWith_(s, [fpRef_(s, 3)]);
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 4);
  assert.deepStrictEqual(rlRollbackRun_(s, fpRef_(s, 2)), { removed: 2 });
  assert.deepStrictEqual(vinCol_(s, 'PUNDMANN_FORD', 4), [T2, T2]);          // the newer run's batch survives
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], 'rolled_back');
  assert.strictEqual(s._runLog()[1][RL_COL.STATUS], 'committed');
});
t('rollback, legacy + unambiguous: one untagged batch and one committed run → removed', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'committed' })],
    vinLogs: { PUNDMANN_FORD: [['3664', 'VA', '2026-06-01 17:37:46'], ['9999', 'VX', 'x'], ['3664', 'VB', '2026-06-01 17:37:46']] } });
  assert.deepStrictEqual(rlRollbackRun_(s, fpRef_(s, 2)), { removed: 2 });
  assert.deepStrictEqual(vinCol_(s, 'PUNDMANN_FORD', 1), ['VX']);
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], 'rolled_back');
});
t('rollback, legacy + ambiguous (the live Pundmann 3664 shape): refused, nothing removed, status kept', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'committed' }), pf_({ ts: T2, status: 'committed' })],
    vinLogs: { PUNDMANN_FORD: [['3664', 'VA', '2026-06-01 17:37:46'], ['3664', 'VB', '2026-06-01 17:37:46'],
                               ['3664', 'VA', '2026-09-08 17:21:49'], ['3664', 'VB', '2026-09-08 17:21:49']] } });
  assert.throws(function () { rlRollbackRun_(s, fpRef_(s, 2)); }, /more than one batch .* Roll it back by hand/);
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 4);
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], 'committed');
});
t('rollback, legacy: two committed runs but one untagged batch is still ambiguous → refused', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'committed' }), pf_({ ts: T2, status: 'committed' })],
    vinLogs: { PUNDMANN_FORD: [['3664', 'VA', 'c1'], ['3664', 'VB', 'c1']] } });
  assert.throws(function () { rlRollbackRun_(s, fpRef_(s, 3)); }, /Roll it back by hand/);
});
t('rollback, legacy: an old untagged manual entry under the same order makes it ambiguous → refused', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'committed' })],
    vinLogs: { PUNDMANN_FORD: [['3664', 'VA', 'c1'], ['3664', 'VB', 'c1'], ['3664', 'VM', 'c-manual']] } });
  assert.throws(function () { rlRollbackRun_(s, fpRef_(s, 2)); }, /Roll it back by hand/);
});
t('rollback, legacy: a competitor whose batch IS tagged does not count against an old run', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'committed' }), pf_({ ts: T2 })],
    vinLogs: { PUNDMANN_FORD: [['3664', 'VA', 'c1'], ['3664', 'VB', 'c1']] } });
  ledgerCommitRunsWith_(s, [fpRef_(s, 3)]);                 // the rerun commits with a tag
  assert.deepStrictEqual(rlRollbackRun_(s, fpRef_(s, 2)), { removed: 2 });
  assert.deepStrictEqual(vinCol_(s, 'PUNDMANN_FORD', 4), [T2, T2]);
});
t('rollback refuses a run that is not committed; a committed run with no log rows just flips status', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 }), pf_({ ts: T2, status: 'committed' })], vinLogs: { PUNDMANN_FORD: [] } });
  assert.throws(function () { rlRollbackRun_(s, fpRef_(s, 2)); }, /isn't committed/);
  assert.deepStrictEqual(rlRollbackRun_(s, fpRef_(s, 3)), { removed: 0 });
  assert.strictEqual(s._runLog()[1][RL_COL.STATUS], 'rolled_back');
});

t('delete: a committed run is rolled back first, then marked deleted (row stays in place)', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [] } });
  ledgerCommitRunsWith_(s, [fpRef_(s, 2)]);
  assert.deepStrictEqual(rlDeleteRun_(s, fpRef_(s, 2)), { removed: 2 });
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 0);
  assert.strictEqual(s._runLog().length, 1);
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], 'deleted');
});
t('delete: a pending run is marked deleted with no VIN-log change; deleting twice is a no-op', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [['1', 'VZ', 'c']] } });
  assert.deepStrictEqual(rlDeleteRun_(s, fpRef_(s, 2)), { removed: 0 });
  assert.deepStrictEqual(rlDeleteRun_(s, fpRef_(s, 2)), { removed: 0 });
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 1);
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], 'deleted');
});
t('delete: an ambiguous committed legacy run is refused as a whole (stays committed)', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'committed' }), pf_({ ts: T2, status: 'committed' })],
    vinLogs: { PUNDMANN_FORD: [['3664', 'VA', 'c1'], ['3664', 'VA', 'c2']] } });
  assert.throws(function () { rlDeleteRun_(s, fpRef_(s, 2)); }, /Roll it back by hand/);
  assert.strictEqual(s._runLog()[0][RL_COL.STATUS], 'committed');
});

t('manual entry: upper-cased, de-duplicated, tagged manual, dated now; legacy rollback ignores it', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, status: 'committed' })],
    vinLogs: { PUNDMANN_FORD: [['3664', 'VA', 'c1'], ['3664', 'VB', 'c1']] }, now: '2026-11-12 09:00:00' });
  assert.deepStrictEqual(rlManualEntry_(s, 'PUNDMANN_FORD', 3664, [' vm1 ', 'VM1', '', 'vm2']), { committed: 2 });
  assert.deepStrictEqual(s._vinLog('PUNDMANN_FORD').slice(2), [
    ['3664', 'VM1', '2026-11-12 09:00:00', '2026-11-12 09:00:00', 'manual'],
    ['3664', 'VM2', '2026-11-12 09:00:00', '2026-11-12 09:00:00', 'manual']
  ]);
  assert.deepStrictEqual(rlRollbackRun_(s, fpRef_(s, 2)), { removed: 2 });   // the run's legacy batch only
  assert.deepStrictEqual(vinCol_(s, 'PUNDMANN_FORD', 1), ['VM1', 'VM2']);
});
t('manual entry: needs a dealer, an order number, real VINs and an existing tab', function () {
  var s = makeFakeLedgerStore({ vinLogs: { PUNDMANN_FORD: [] } });
  assert.throws(function () { rlManualEntry_(s, '', '1', ['V']); }, /No dealer key/);
  assert.throws(function () { rlManualEntry_(s, 'PUNDMANN_FORD', ' ', ['V']); }, /Order number is required/);
  assert.throws(function () { rlManualEntry_(s, 'PUNDMANN_FORD', '1', ['', ' ']); }, /No valid VINs/);
  assert.throws(function () { rlManualEntry_(s, 'NO_TAB', '1', ['V']); }, /No VIN log tab found for: NO_TAB/);
});
t('a busy lock stops every operation before anything is read or written', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [] }, lockBusy: true });
  assert.throws(function () { ledgerCommitRunsWith_(s, [{ rowIndex: 2, dealerKey: 'PUNDMANN_FORD', timestamp: T1, dealId: '3664' }]); }, /Another change is in progress/);
  assert.throws(function () { rlManualEntry_(s, 'PUNDMANN_FORD', '1', ['V']); }, /Another change is in progress/);
  assert.strictEqual(s._stats().writes, 0);
});
t('the old trust-the-browser endpoints are gone (views can only reach the ledger)', function () {
  ['commitRunToVINLog', 'rollbackRunFromVINLog', 'getCommittedAt', 'commitLatestRun', 'commitRunRows', 'deleteRun', 'manualCommitToVINLog']
    .forEach(function (n) { assert.strictEqual(typeof globalThis[n], 'undefined', n + ' still defined'); });
  ['ledgerCommitRuns', 'ledgerRollbackRun', 'ledgerDeleteRun', 'ledgerManualEntry']
    .forEach(function (n) { assert.strictEqual(typeof globalThis[n], 'function', n + ' missing'); });
});
t('every view call into the ledger names a function that exists (google.script.run fails silently otherwise)', function () {
  ['ViewRun.html', 'ViewVinLog.html'].forEach(function (f) {
    var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    (src.match(/\.(ledger[A-Za-z]+)\(/g) || []).forEach(function (m) {
      var n = m.slice(1, -1);
      assert.strictEqual(typeof globalThis[n], 'function', f + ' calls missing ' + n);
    });
    ['commitRunToVINLog', 'rollbackRunFromVINLog', 'getCommittedAt', 'commitRunRows', '.deleteRun(', 'manualCommitToVINLog']
      .forEach(function (old) { assert.strictEqual(src.indexOf(old), -1, f + ' still calls ' + old); });
  });
});
// The public endpoint is a one-liner over rlSheetStore_(); tests drive the same internal with the fake.
function ledgerCommitRunsWith_(store, refs) { return rlCommitRuns_(store, refs); }

// ============================================================================
// Suite: run ledger finalize — one RUN_LOG row per output doc + group, and the
// Pipedrive deal-id (col D) write, both through the strict fake store
// ============================================================================
suite('run ledger finalize');
function entry_(o) {
  o = o || {};
  return {
    totalOrdered: 12, totalMatched: 10,
    billing: { totalNew: 7, totalPO: 3, totalCPO: 0, totalCPOEL: 0, newDupes: 1, poDupes: 0, cpoDupes: 0, cpoElDupes: 0, totalDupes: 1 },
    outputDocId: o.doc !== undefined ? o.doc : 'DOC_A', durationSec: 81, errors: o.errors || [],
    producedVins: o.vins || ['VA', 'VB'], note: o.note || ''
  };
}
function finRec_(deal, o) { return rlRecordFromEntry_('PUNDMANN_FORD', 'Pundmann Ford', deal, entry_(o)); }
var NOW_F = '2026-11-13 08:42:04';

t('finalize appends one pending row in the exact RUN_LOG layout, stamped by the ledger clock', function () {
  var s = makeFakeLedgerStore({ runLog: [], now: NOW_F });
  var res = rlFinalizeRun_(s, finRec_('5509', { errors: ['x', 'y'] }));
  assert.deepStrictEqual(res, { rowIndex: 2, timestamp: NOW_F, created: true });
  var row = s._runLog()[0];
  assert.strictEqual(row.length, RL_WIDTH);
  assert.deepStrictEqual(row, [NOW_F, 'PUNDMANN_FORD', 'Pundmann Ford', '5509', 12, 10, 7, 3, 0, 0, 1, 0, 0, 0, 1,
                               10, '', 'DOC_A', 81, 'x; y', '', 'VA,VB', '']);
  assert.strictEqual(s._stats().locks, 1);
});
t('a retried finalize (same output doc + group + deal) returns the existing row and writes nothing', function () {
  var s = makeFakeLedgerStore({ runLog: [], now: NOW_F });
  rlFinalizeRun_(s, finRec_('5509'));
  var writes = s._stats().writes;
  s._setNow('2026-11-13 08:45:00');
  assert.deepStrictEqual(rlFinalizeRun_(s, finRec_('5509')), { rowIndex: 2, timestamp: NOW_F, created: false });
  assert.strictEqual(s._runLog().length, 1);
  assert.strictEqual(s._stats().writes, writes);
});
t('split halves of one output doc are two runs (one row per billing group)', function () {
  var s = makeFakeLedgerStore({ runLog: [], now: NOW_F });
  assert.strictEqual(rlFinalizeRun_(s, finRec_('501', { note: 'SPLIT:PRIMARY' })).created, true);
  assert.strictEqual(rlFinalizeRun_(s, finRec_('502', { note: 'SPLIT:SPRINTER' })).created, true);
  assert.strictEqual(rlFinalizeRun_(s, finRec_('502', { note: 'SPLIT:SPRINTER' })).created, false);
  assert.strictEqual(s._runLog().length, 2);
});
t('a retry under a different deal id is refused and nothing is written', function () {
  var s = makeFakeLedgerStore({ runLog: [], now: NOW_F });
  rlFinalizeRun_(s, finRec_('test'));
  var writes = s._stats().writes;
  assert.throws(function () { rlFinalizeRun_(s, finRec_('5509')); }, /already in the run log \(row 2\) under deal "test"\. Delete that row/);
  assert.strictEqual(s._stats().writes, writes);
});
t('a deleted row does not block finalizing the same output doc again', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: 'test', doc: 'DOC_A', status: 'deleted' })], now: NOW_F });
  assert.deepStrictEqual(rlFinalizeRun_(s, finRec_('5509')), { rowIndex: 3, timestamp: NOW_F, created: true });
});
t('a run with no output doc has no retry key, so each finalize appends', function () {
  var s = makeFakeLedgerStore({ runLog: [], now: NOW_F });
  rlFinalizeRun_(s, finRec_('test', { doc: '' }));
  rlFinalizeRun_(s, finRec_('test', { doc: '' }));
  assert.strictEqual(s._runLog().length, 2);
});
t('finalize needs a dealer and a deal id; a busy lock writes nothing', function () {
  var s = makeFakeLedgerStore({ runLog: [] });
  assert.throws(function () { rlFinalizeRun_(s, finRec_(' ')); }, /A Deal ID is required/);
  assert.throws(function () { rlFinalizeRun_(s, rlRecordFromEntry_('', '', '1', entry_())); }, /No dealer key/);
  var b = makeFakeLedgerStore({ runLog: [], lockBusy: true });
  assert.throws(function () { rlFinalizeRun_(b, finRec_('1')); }, /Another change is in progress/);
  assert.strictEqual(b._stats().writes, 0);
});
t('a finalized row commits and its batch tag is its run time (finalize → commit round trip)', function () {
  var s = makeFakeLedgerStore({ runLog: [], vinLogs: { PUNDMANN_FORD: [] }, now: NOW_F });
  rlFinalizeRun_(s, finRec_('5509'));
  assert.strictEqual(ledgerCommitRunsWith_(s, [{ dealerKey: 'PUNDMANN_FORD', outputDocId: 'DOC_A', note: '' }]).committed, 2);
  assert.deepStrictEqual(vinCol_(s, 'PUNDMANN_FORD', 4), [NOW_F, NOW_F]);
});

function dref_(row, o) { return Object.assign({ rowIndex: row, dealerKey: 'PUNDMANN_FORD', outputDocId: 'DOC_A', note: '' }, o || {}); }
t('deal id: written to col D under the lock; the same id again is a no-op', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: 'test', doc: 'DOC_A' })] });
  assert.deepStrictEqual(rlSetDealId_(s, dref_(2), 5509), { rowIndex: 2, changed: true });
  assert.strictEqual(s._runLog()[0][RL_COL.DEAL_ID], '5509');
  var writes = s._stats().writes;
  assert.deepStrictEqual(rlSetDealId_(s, dref_(2), '5509'), { rowIndex: 2, changed: false });
  assert.strictEqual(s._stats().writes, writes);
});
t('deal id: a real deal is never repointed, and a committed run keeps the id its batch is filed under', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: '5509', doc: 'DOC_A' }),
                                         pf_({ ts: T2, deal: 'PENDING-1', doc: 'DOC_B', status: 'committed' })] });
  assert.throws(function () { rlSetDealId_(s, dref_(2), '5600'); }, /already linked to deal 5509, so it was not changed to 5600/);
  assert.throws(function () { rlSetDealId_(s, dref_(3, { outputDocId: 'DOC_B' }), '5600'); }, /roll it back on the VIN Logs page before changing/);
  assert.strictEqual(s._stats().writes, 0);
});
t('deal id: a ref that no longer names the row (other doc / group / dealer / missing row) is refused', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: 'test', doc: 'DOC_A' })] });
  [dref_(2, { outputDocId: 'DOC_X' }), dref_(2, { note: 'SPLIT:SPRINTER' }), dref_(2, { dealerKey: 'BMW_WEST_STL' }), dref_(9)]
    .forEach(function (ref) { assert.throws(function () { rlSetDealId_(s, ref, '1'); }, /no longer matches this run/); });
  assert.throws(function () { rlSetDealId_(s, dref_(2), ' '); }, /No deal ID to record/);
});
t('deal id pre-check (before a deal is created): placeholder ok, real deal or committed placeholder refused', function () {
  var pend = rlDecodeRow_(pf_({ ts: T1, deal: 'test' }), 2);
  var real = rlDecodeRow_(pf_({ ts: T1, deal: '5509' }), 2);
  var comm = rlDecodeRow_(pf_({ ts: T1, deal: 'X1', status: 'committed' }), 2);
  assert.strictEqual(rlDealIdChangeProblem_(pend, null), '');
  assert.strictEqual(rlDealIdChangeProblem_(real, '5509'), '');
  assert.match(rlDealIdChangeProblem_(real, null), /already linked to deal 5509\./);
  assert.match(rlDealIdChangeProblem_(comm, null), /roll it back/);
});

t('Code.gs finalizeRun: writes the stats side-rows once — a retry reuses the row and skips them', function () {
  var s = makeFakeLedgerStore({ runLog: [], now: NOW_F });
  var saved = { store: globalThis.rlSheetStore_, cfg: globalThis.getDealerConfig_, stats: globalThis.writeRunStats_ };
  var statCalls = [];
  try {
    globalThis.rlSheetStore_    = function () { return s; };
    globalThis.getDealerConfig_ = function (k) { var c = []; c[CFG.KEY] = k; c[CFG.NAME] = 'Pundmann Ford'; return c; };
    globalThis.writeRunStats_   = function (cfg, ts, id) { statCalls.push([ts, id]); };
    assert.deepStrictEqual(finalizeRun('PUNDMANN_FORD', entry_(), '5509'), { rowIndex: 2, vinCount: 2, reused: false });
    assert.deepStrictEqual(finalizeRun('PUNDMANN_FORD', entry_(), '5509'), { rowIndex: 2, vinCount: 2, reused: true });
    assert.deepStrictEqual(statCalls, [[NOW_F, '5509']]);
    assert.strictEqual(s._runLog().length, 1);
    var f = finalizeRunOrFail_('PUNDMANN_FORD', entry_(), '5600');       // a retry under another deal
    assert.strictEqual(f.ok, false);
    assert.strictEqual(f.stage, 'finalize');
    assert.strictEqual(f.retryable, false);
    assert.match(f.message, /under deal "5509"/);
  } finally {
    globalThis.rlSheetStore_ = saved.store; globalThis.getDealerConfig_ = saved.cfg; globalThis.writeRunStats_ = saved.stats;
  }
});
t('real adapter: a VIN-log append stores order id, VIN and run_ref as text (run_ref never becomes a Date)', function () {
  var formats = [], written = null;
  var sheet = {
    getMaxColumns: function () { return 5; }, getLastRow: function () { return 7; },
    getRange: function (r, c, nr, nc) {
      return {
        getValue: function () { return 'run_ref'; },
        setNumberFormat: function (f) { formats.push([r, c, nr || 1, nc || 1, f]); },
        setValues: function (v) { written = v; }
      };
    }
  };
  var saved = { ss: globalThis.getVinLogsSS_, lock: globalThis.LockService, flush: SpreadsheetApp.flush };
  try {
    globalThis.getVinLogsSS_ = function () { return { getSheetByName: function () { return sheet; } }; };
    globalThis.LockService   = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
    SpreadsheetApp.flush     = function () {};
    var real = rlSheetStore_();
    real.withLock(function () { real.appendVinLog('PUNDMANN_FORD', [['5509', 'VA', NOW_F, NOW_F, NOW_F]]); });
    assert.deepStrictEqual(formats.filter(function (f) { return f[1] === 5; }), [[8, 5, 1, 1, '@']]);   // col E, before the write
    assert.strictEqual(formats.filter(function (f) { return f[1] === 1 && f[3] === 2; }).length, 2);   // A–B before + after
    assert.deepStrictEqual(written, [['5509', 'VA', NOW_F, NOW_F, NOW_F]]);
  } finally {
    globalThis.getVinLogsSS_ = saved.ss; globalThis.LockService = saved.lock; SpreadsheetApp.flush = saved.flush;
  }
});
// pushRunToPipedrive with every Pipedrive/Properties call stubbed and the ledger on the fake store.
function withPushStubs_(store, pushState, fn) {
  var names = ['rlSheetStore_', 'getPipedriveStatus', 'pdResolveRunContext_', 'pdCheckInactiveProducts_', 'pdPushStateGet_',
               'pdPushStateSet_', 'pdPushStateClear_', 'pdResolveDealId_', 'pdApplyDealContents_'];
  var saved = {}; names.forEach(function (n) { saved[n] = globalThis[n]; });
  var savedActive = SpreadsheetApp.getActiveSpreadsheet;
  var calls = { created: 0 };
  try {
    globalThis.rlSheetStore_            = function () { return store; };
    globalThis.getPipedriveStatus       = function () { return { configured: true }; };
    globalThis.pdResolveRunContext_     = function () { return { ok: true, pdCfg: {}, currency: 'USD', lineItems: [] }; };
    globalThis.pdCheckInactiveProducts_ = function () { return null; };
    globalThis.pdPushStateGet_          = function () { return JSON.parse(JSON.stringify(pushState)); };
    globalThis.pdPushStateSet_          = function () {};
    globalThis.pdPushStateClear_        = function () {};
    globalThis.pdResolveDealId_         = function () { calls.created++; return { ok: true, dealId: 7001 }; };
    globalThis.pdApplyDealContents_     = function () { return { ok: true, fieldsSet: 0 }; };
    SpreadsheetApp.getActiveSpreadsheet = function () {
      return { getSheetByName: function () {
        return { getLastRow: function () { return store._runLog().length + 1; },
                 getRange: function (r) { return { getValues: function () { return [store.readRun(r)]; } }; } };
      } };
    };
    fn(calls);
  } finally {
    names.forEach(function (n) { globalThis[n] = saved[n]; });
    SpreadsheetApp.getActiveSpreadsheet = savedActive;
  }
}
t('push (create): the new deal id lands in col D through the ledger', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: 'test', doc: 'DOC_A' })] });
  withPushStubs_(s, { dealId: '' }, function (calls) {
    var res = pushRunToPipedrive('PUNDMANN_FORD', 2, 'create');
    assert.strictEqual(res.ok, true, res.message);
    assert.strictEqual(calls.created, 1);
    assert.strictEqual(s._runLog()[0][RL_COL.DEAL_ID], '7001');
  });
});
t('push retry: an id kept in the push state still lands in col D when the earlier write failed', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: 'test', doc: 'DOC_A' })] });
  withPushStubs_(s, { dealId: '7001' }, function (calls) {
    assert.strictEqual(pushRunToPipedrive('PUNDMANN_FORD', 2, 'create').ok, true);
    assert.strictEqual(calls.created, 0);                                   // adopted, not re-created
    assert.strictEqual(s._runLog()[0][RL_COL.DEAL_ID], '7001');
  });
});
t('push: a committed run filed under a placeholder is refused BEFORE any deal is created', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: 'PENDING-1', doc: 'DOC_A', status: 'committed' })] });
  withPushStubs_(s, { dealId: '' }, function (calls) {
    var res = pushRunToPipedrive('PUNDMANN_FORD', 2, 'create');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.stage, 'gate');
    assert.match(res.message, /roll it back/);
    assert.strictEqual(calls.created, 0);
    assert.strictEqual(s._stats().writes, 0);
  });
});
t('push (link): linking a different deal than the one already in col D is refused', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, deal: '5509', doc: 'DOC_A' })] });
  withPushStubs_(s, { dealId: '' }, function () {
    var res = pushRunToPipedrive('PUNDMANN_FORD', 2, 'link', '5600');
    assert.strictEqual(res.ok, false);
    assert.match(res.message, /already linked to deal 5509/);
    assert.strictEqual(s._runLog()[0][RL_COL.DEAL_ID], '5509');
  });
});
t('Code.gs writes no RUN_LOG row or col-D deal id itself (the ledger is the only writer)', function () {
  assert.strictEqual(codeSource.indexOf('writeRunLog_'), -1, 'writeRunLog_ still referenced');
  assert.strictEqual(/getRange\(\s*runRowIndex\s*,\s*4\s*\)/.test(codeSource), false, 'raw col-D write still present');
  assert.strictEqual(codeSource.slice(codeSource.indexOf('SECTION 14: RUN LOG'), codeSource.indexOf('SECTION 15:')).indexOf("'RUN_LOG'"), -1,
                     'Section 14 still opens RUN_LOG directly');
  ['ledgerFinalizeRun_', 'ledgerSetDealId_', 'ledgerFinalizedRunFor_'].forEach(function (n) {
    assert.strictEqual(typeof globalThis[n], 'function', n + ' missing');
  });
});

suite('run ledger readers');
// Code.gs readers with the ledger on the fake store and every other service stubbed.
function withReaderStubs_(store, fn) {
  var names = ['rlSheetStore_', 'getAppHomeStatus', 'getMyRunDrafts', 'getDealerConfig_', 'getPipedriveStatus', 'Session'];
  var saved = {}; names.forEach(function (n) { saved[n] = globalThis[n]; });
  var savedActive = SpreadsheetApp.getActiveSpreadsheet;
  try {
    globalThis.rlSheetStore_     = function () { return store; };
    globalThis.getAppHomeStatus  = function () { return { lastImportDate: '', lastImportTime: '' }; };
    globalThis.getMyRunDrafts    = function () { return { drafts: [] }; };
    globalThis.getDealerConfig_  = function (k) {
      var c = []; c[CFG.KEY] = k; c[CFG.NAME] = 'Pundmann Ford'; c[CFG.SCRAPER_LOCATION] = ''; return c;
    };
    globalThis.getPipedriveStatus = function () { return { configured: false }; };
    globalThis.Session = { getScriptTimeZone: function () { return 'America/Chicago'; } };
    SpreadsheetApp.getActiveSpreadsheet = function () { throw new Error('RUN_LOG must be read through the ledger'); };
    return fn();
  } finally {
    names.forEach(function (n) { globalThis[n] = saved[n]; });
    SpreadsheetApp.getActiveSpreadsheet = savedActive;
  }
}
var M1 = '2026-06-01 17:33:00', M2 = '2026-06-01 18:00:00';
function vl_(id, vin, at, ref) { return [id, vin, at, at, ref]; }

t('VIN Logs list: one dealer, newest first, deleted runs hidden, other dealers left out', function () {
  var s = makeFakeLedgerStore({
    runLog: [pf_({ ts: T1, deal: '3664' }), pf_({ ts: T2, deal: '3665', status: 'deleted' }),
             pf_({ ts: '2026-06-02 09:00:00', deal: '3670', status: 'committed' }),
             pf_({ ts: '2026-06-02 10:00:00', dealer: 'BMW_WEST_STL', name: 'BMW West', deal: '5509' })],
    vinLogs: { PUNDMANN_FORD: [], BMW_WEST_STL: [] }
  });
  var runs = withReaderStubs_(s, function () { return getRunsForDealer('PUNDMANN_FORD'); });
  assert.deepStrictEqual(runs.map(function (r) { return [r.rowIndex, r.dealId, r.status]; }), [[4, '3670', 'committed'], [2, '3664', 'pending']]);
  assert.deepStrictEqual(runs[1], {
    rowIndex: 2, dealerKey: 'PUNDMANN_FORD', dealerName: 'Pundmann Ford', timestamp: T1, dealId: '3664',
    vinCount: 2, status: 'pending', note: '', producedVins: ['VA', 'VB']
  });
});
t('VIN Logs list: manual entries show up read-only, one row per order + time, merged in by time', function () {
  var s = makeFakeLedgerStore({
    runLog: [pf_({ ts: T1, deal: '3664' }), pf_({ ts: T2, deal: '3665' })],
    vinLogs: { PUNDMANN_FORD: [
      vl_('3600', 'OLD1', '2026-05-01 08:00:00', ''),          // legacy untagged — not a manual row
      vl_('3664', 'VA', '2026-06-01 17:40:00', T1),            // a run's batch — not a manual row
      vl_('9001', 'MX1', M1, 'manual'), vl_('9001', 'MX2', M1, 'manual'),
      vl_('9001', 'MX3', M2, 'manual')                         // same order, later entry → its own row
    ] }
  });
  var runs = withReaderStubs_(s, function () { return getRunsForDealer('PUNDMANN_FORD'); });
  assert.deepStrictEqual(runs.map(function (r) { return [r.timestamp, r.dealId, r.status, r.vinCount]; }), [
    [M2, '9001', 'manual', 1], [T2, '3665', 'pending', 2], [M1, '9001', 'manual', 2], [T1, '3664', 'pending', 2]
  ]);
  assert.deepStrictEqual(runs[2], {
    rowIndex: null, dealerKey: 'PUNDMANN_FORD', dealerName: 'Pundmann Ford', timestamp: M1, dealId: '9001',
    vinCount: 2, status: 'manual', note: '', producedVins: ['MX1', 'MX2'], manual: true
  });
});
t('VIN Logs list (all dealers): manual rows from every tab; a dealer with no runs shows its key', function () {
  var s = makeFakeLedgerStore({
    runLog: [pf_({ ts: T1 })],
    vinLogs: { PUNDMANN_FORD: [vl_('9001', 'MX1', M1, 'manual')], WEBER_CHEVY: [vl_('77', 'WX1', M2, 'manual')] }
  });
  var runs = withReaderStubs_(s, function () { return getRunsForDealer(''); });
  assert.deepStrictEqual(runs.map(function (r) { return [r.dealerKey, r.dealerName, r.status]; }), [
    ['WEBER_CHEVY', 'WEBER_CHEVY', 'manual'], ['PUNDMANN_FORD', 'Pundmann Ford', 'manual'], ['PUNDMANN_FORD', 'Pundmann Ford', 'pending']
  ]);
});
t('rlManualBatches_: only rows tagged exactly "manual" form batches', function () {
  var recs = [vl_('1', 'A', M1, 'manual'), vl_('1', 'B', M1, T1), vl_('1', 'C', M1, ''), vl_('1', 'D', M1, 'Manual')]
    .map(function (r, i) { var v = rlDecodeVinLogRow_(r, i + 2); v.dealerKey = 'PUNDMANN_FORD'; return v; });
  assert.deepStrictEqual(rlManualBatches_(recs), [{ dealerKey: 'PUNDMANN_FORD', orderId: '1', committedAt: M1, vins: ['A'] }]);
});
t('VIN Logs list: a failed manual-entry lookup still returns the runs', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1 })], vinLogs: { PUNDMANN_FORD: [] } });
  s.findVinLogRowsByRunRef = function () { throw new Error('Service Spreadsheets timed out'); };
  var runs = withReaderStubs_(s, function () { return getRunsForDealer('PUNDMANN_FORD'); });
  assert.deepStrictEqual(runs.map(function (r) { return r.dealId; }), ['3664']);
});
t('manual entry refuses the order number "test" (any case) and writes nothing', function () {
  var s = makeFakeLedgerStore({ runLog: [], vinLogs: { PUNDMANN_FORD: [] } });
  withReaderStubs_(s, function () {
    assert.throws(function () { ledgerManualEntry('PUNDMANN_FORD', 'test', ['MX1']); }, /never goes in the VIN log/);
    assert.throws(function () { ledgerManualEntry('PUNDMANN_FORD', ' TEST ', ['MX1']); }, /never goes in the VIN log/);
    assert.deepStrictEqual(ledgerManualEntry('PUNDMANN_FORD', 'test2', ['MX1']), { committed: 1 });   // only exact 'test' is a test id
  });
  assert.strictEqual(s._vinLog('PUNDMANN_FORD').length, 1);
});
t('a manual entry appears in the list straight after it is added (the reported bug)', function () {
  var s = makeFakeLedgerStore({ runLog: [], vinLogs: { PUNDMANN_FORD: [] }, now: M1 });
  var runs = withReaderStubs_(s, function () {
    ledgerManualEntry('PUNDMANN_FORD', '9001', ['mx1', 'MX2']);
    return getRunsForDealer('PUNDMANN_FORD');
  });
  assert.deepStrictEqual(runs.map(function (r) { return [r.dealId, r.vinCount, r.manual]; }), [['9001', 2, true]]);
});
t('readRunLog_ / pendingRunCount_: decoded records, test and deleted runs left out', function () {
  var s = makeFakeLedgerStore({
    runLog: [pf_({ ts: T1, deal: '3664' }), pf_({ ts: T2, deal: 'test' }), pf_({ ts: T2, deal: '3665', status: 'deleted' }),
             pf_({ ts: T2, deal: '3666', status: 'committed' }), pf_({ ts: T2, deal: '3667', dealer: 'BMW_WEST_STL' })]
  });
  withReaderStubs_(s, function () {
    assert.deepStrictEqual(readRunLog_().map(function (r) { return r.dealId; }), ['3664', '3666', '3667']);
    assert.strictEqual(readRunLog_()[0].rowIndex, 2);
    assert.strictEqual(pendingRunCount_('PUNDMANN_FORD'), 1);
    assert.strictEqual(pendingRunCount_('BMW_WEST_STL'), 1);
  });
});
t('getLatestOrderId reads the VIN log through the store (latest order_date wins; no tab = none)', function () {
  var s = makeFakeLedgerStore({
    runLog: [pf_({ ts: T1 })],
    vinLogs: { PUNDMANN_FORD: [['99999', 'A', T2, '2026-01-01 00:00:00', ''], ['3664', 'B', T2, T1, T1]] }
  });
  withReaderStubs_(s, function () {
    assert.deepStrictEqual(getLatestOrderId('PUNDMANN_FORD'), { latestOrderId: '3664', pendingCount: 1 });
    assert.deepStrictEqual(getLatestOrderId('NO_SUCH_TAB'), { latestOrderId: null, pendingCount: 0 });
  });
});
t('getHomeHud all-time stats and getDealerSummary read decoded records', function () {
  var s = makeFakeLedgerStore({
    runLog: [runRow_({ ts: T1, dealer: 'PUNDMANN_FORD', deal: 3664, status: 'committed' }),
             runRow_({ ts: T2, dealer: 'PUNDMANN_FORD', deal: 3665, status: 'rolled_back' }),
             runRow_({ ts: T2, dealer: 'PUNDMANN_FORD', deal: 'test' }),
             runRow_({ ts: '2026-06-02 09:00:00', dealer: 'PUNDMANN_FORD', deal: 3666 })]
  });
  withReaderStubs_(s, function () {
    var hud = getHomeHud();
    assert.deepStrictEqual(hud.allTime, { runs: 3, vins: 87, avgVinsPerRun: 29, committed: 1, pending: 1, rolledBack: 1 });
    var sum = getDealerSummary('PUNDMANN_FORD');
    assert.deepStrictEqual(sum.runStats, { runs: 3, vinsOrdered: 87, vinsProduced: 87, avgMatchPct: 100,
                                           byType: { new: 60, po: 27, cpo: 0, cpoEl: 0 } });
    assert.strictEqual(sum.lastRun.orderId, '3666');
    assert.strictEqual(sum.lastRun.ordered, 29);
    assert.strictEqual(sum.lastRun.durationSec, 42);
    assert.strictEqual(sum.lastRun.vinLogStatus, 'pending');
  });
});
t('real adapter: manual rows are found with ONE text search and one read per tab with hits', function () {
  var reads = [];
  function tab(name, cells) {   // cells: {row: [5 values]}
    return {
      getName: function () { return name; },
      getRange: function (r, c, nr, nc) {
        reads.push([name, r, c, nr, nc]);
        return { getValues: function () { var out = []; for (var i = 0; i < nr; i++) out.push(cells[r + i] || ['', '', '', '', '']); return out; } };
      }
    };
  }
  var pf = tab('PUNDMANN_FORD', { 4: ['9001', 'MX1', M1, M1, 'manual'], 6: ['9001', 'MX2', M1, M1, 'manual'] });
  var wb = tab('WEBER_CHEVY', { 3: ['77', 'WX1', M2, M2, 'manual'] });
  function hit(sh, row, col) { return { getSheet: function () { return sh; }, getRow: function () { return row; }, getColumn: function () { return col; } }; }
  var searches = [];
  function finder(hits) {
    return function (q) {
      var opts = {};
      var f = { matchCase: function (v) { opts.matchCase = v; return f; }, matchEntireCell: function (v) { opts.entire = v; return f; },
                findAll: function () { searches.push([q, opts]); return hits; } };
      return f;
    };
  }
  var allHits = [hit(pf, 4, 5), hit(pf, 6, 5), hit(pf, 1, 5), hit(pf, 9, 1), hit(wb, 3, 5)];   // header row + col A hits ignored
  pf.createTextFinder = finder([hit(pf, 4, 5), hit(pf, 6, 5)]);
  var ss = { createTextFinder: finder(allHits), getSheetByName: function (k) { return k === 'PUNDMANN_FORD' ? pf : null; } };
  var saved = globalThis.getVinLogsSS_;
  try {
    globalThis.getVinLogsSS_ = function () { return ss; };
    var real = rlSheetStore_();
    var all = real.findVinLogRowsByRunRef('manual', null);
    assert.deepStrictEqual(all.map(function (h) { return [h.dealerKey, h.rowIndex, h.row[1]]; }),
                           [['PUNDMANN_FORD', 4, 'MX1'], ['PUNDMANN_FORD', 6, 'MX2'], ['WEBER_CHEVY', 3, 'WX1']]);
    assert.deepStrictEqual(reads, [['PUNDMANN_FORD', 4, 1, 3, 5], ['WEBER_CHEVY', 3, 1, 1, 5]]);
    assert.deepStrictEqual(searches[0], ['manual', { matchCase: true, entire: true }]);
    reads = [];
    assert.strictEqual(real.findVinLogRowsByRunRef('manual', 'PUNDMANN_FORD').length, 2);
    assert.deepStrictEqual(real.findVinLogRowsByRunRef('manual', 'NO_SUCH_TAB'), []);
  } finally {
    globalThis.getVinLogsSS_ = saved;
  }
});
t('pending overlap: names only the order cars already in an uncommitted run (case-insensitive, newest first)', function () {
  var s = makeFakeLedgerStore({
    runLog: [pf_({ ts: T1, deal: '3664', vins: 'VA,VB,VC' }),
             pf_({ ts: T2, deal: '3665', vins: 'vb,VD', note: 'SPLIT:SPRINTER' }),
             pf_({ ts: T2, deal: '3666', vins: 'VA', status: 'committed' }),     // in the log already → flagged elsewhere
             pf_({ ts: T2, deal: '3667', vins: 'VA', status: 'rolled_back' }),
             pf_({ ts: T2, deal: '3668', vins: 'VA', status: 'deleted' }),
             pf_({ ts: T2, deal: 'test', vins: 'VA' }),                          // test runs never commit
             pf_({ ts: T2, deal: '5509', vins: 'VA', dealer: 'BMW_WEST_STL' })]  // another dealer
  });
  var res = withReaderStubs_(s, function () { return ledgerPendingOverlap('PUNDMANN_FORD', ['va', 'VB', ' vd ', 'VZ', 'VA']); });
  assert.deepStrictEqual(res, {
    pendingCount: 2, overlapCount: 3,
    runs: [{ rowIndex: 3, dealId: '3665', timestamp: T2, note: 'SPLIT:SPRINTER', vins: ['VB', 'VD'] },
           { rowIndex: 2, dealId: '3664', timestamp: T1, note: '', vins: ['VA', 'VB'] }]
  });
});
t('pending overlap: pending runs that share no cars give no runs (no popup), but still count', function () {
  var s = makeFakeLedgerStore({ runLog: [pf_({ ts: T1, vins: 'VA,VB' })] });
  var res = withReaderStubs_(s, function () { return ledgerPendingOverlap('PUNDMANN_FORD', ['VX', 'VY']); });
  assert.deepStrictEqual(res, { pendingCount: 1, overlapCount: 0, runs: [] });
  assert.deepStrictEqual(rlPendingOverlap_([], 'PUNDMANN_FORD', null), { pendingCount: 0, overlapCount: 0, runs: [] });
});
t('Run view asks for the overlap with the order VINs, and warns only when runs come back', function () {
  var view = fs.readFileSync(path.join(ROOT, 'ViewRun.html'), 'utf8');
  assert.ok(/rvPendingCommitCheck_\(key, name, vins\)/.test(view), 'run handler does not pass the order VINs');
  assert.ok(/\.ledgerPendingOverlap\(dealerKey, vins\)/.test(view), 'check does not call ledgerPendingOverlap');
  assert.ok(/if \(!runs\.length\) return resolve\(true\);/.test(view), 'no-overlap path does not skip the popup');
});
t('Code.gs reads RUN_LOG only through the ledger (no raw row indexes, no own run list)', function () {
  var opens = codeSource.split("getSheetByName('RUN_LOG')").length - 1;
  assert.strictEqual(opens, 1, 'expected only openRunLog (the menu jump to the tab) to open RUN_LOG, found ' + opens);
  assert.strictEqual(codeSource.indexOf('backfillVinLogOrderDates'), -1, 'retired backfill tool is back');
  assert.strictEqual(/function getRunsForDealer\b/.test(codeSource), false, 'getRunsForDealer still defined in Code.gs');
  assert.strictEqual(/\b(?:row|r|last)\[(?:21|22)\]/.test(codeSource), false, 'raw produced_vins / status index still read');
  assert.strictEqual(typeof getRunsForDealer, 'function');
  assert.strictEqual(typeof ledgerLiveRuns_, 'function');
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
