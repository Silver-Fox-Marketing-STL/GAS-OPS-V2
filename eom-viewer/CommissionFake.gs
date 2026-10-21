// ============================================================================
// CommissionFake.gs — commission-tracker fixtures for the DEV viewer (viewer-only)
// ----------------------------------------------------------------------------
// A thin layer IN FRONT OF the shared Pipedrive fake (PdFake.gs, a harness-guarded
// byte-copy of the main app's — never edit that copy for viewer-only needs).
// cvFakeJson_ calls cmFakeFetch_, which answers the commission routes from the
// fixtures below and DELEGATES everything else to pdFakeFetch_ (augmenting the
// field-definition / users / orgs / products lists with commission entries).
// Inert on PROD: only reached through the off-prod branches in Code.gs.
//
// Mock shapes follow the shared fake's v2 conventions (plain relation ids,
// custom_fields object, no embedded `product` on deal products). Three shapes are
// ASSUMED until probed live (see Commission.gs header): v2 deal `label_ids`,
// v2 product `category` (an option id), product custom_fields on /products?ids=.
//
// EVERY fixture line carries `expect` — 'include' or the exclusion reason code
// the engine must report — so the harness can assert, line by line, that the
// correct products from the correct deals land in the table and nothing else.
// `expect` is stripped from the API-shaped responses.
// ============================================================================

var CM_FAKE_BILLED_STAGE_ID = 46;   // "FAKE Billed" — distinct from the shared fake's stage 44 (EOM Merge)

// Fake 40-char custom-field key (real Pipedrive keys are 40-char hashes).
var CM_FAKE_ELIG_FIELD_KEY = 'fake' + Array(33).join('0') + 'cme1';   // product "Commission Eligibility" (enum)
var CM_FAKE_ELIG_OPTIONS = [{ id: 41, label: 'Eligible' }, { id: 42, label: 'Ineligible' }];
var CM_FAKE_LABEL_OPTIONS = [                                          // deal labels (system field "label")
  { id: 51, label: 'Discounted', color: 'green' },
  { id: 52, label: 'Rush',       color: 'red' }
];
var CM_FAKE_CATEGORY_OPTIONS = [                                       // product system field "category"
  { id: 61, label: 'Shortcuts' }, { id: 62, label: 'Signage' }, { id: 63, label: 'Services' }
];

var CM_FAKE_USERS = [
  { id: 711, name: 'FAKE Rep Alpha',   email: 'rep.alpha@example.com' },
  { id: 712, name: 'FAKE Rep Bravo',   email: 'rep.bravo@example.com' },
  { id: 713, name: 'FAKE Rep Charlie', email: 'rep.charlie@example.com' }
];
var CM_FAKE_ORGS = [
  { id: 521, name: 'FAKE Gateway Motors' },
  { id: 522, name: 'FAKE Riverbend Auto' },
  { id: 523, name: 'FAKE Lakeside Cars' }
];

// Catalog. elig = option id (41 Eligible / 42 Ineligible) or null = NOT SET.
var CM_FAKE_PRODUCTS = [
  { id: 9101, name: 'FAKE Window Banner', code: 'CM-WB', category: 61, elig: 41 },
  { id: 9102, name: 'FAKE Lot Signage',   code: 'CM-LS', category: 62, elig: 41 },
  { id: 9103, name: 'FAKE Design Fee',    code: 'CM-DF', category: 63, elig: 42 },
  { id: 9104, name: 'FAKE Shipping',      code: 'CM-SH', category: 63, elig: null },          // never set → fail-safe exclude
  { id: 9105, name: 'FAKE Install',       code: 'CM-IN', category: 63, elig: 42 },
  { id: 9106, name: 'FAKE Wall Wrap',     code: 'CM-WW', category: 62, elig: 41, inactive: true }, // deactivated since billing — still pays
  { id: 9107, name: 'FAKE Floor Decal',   code: 'CM-FD', category: null, elig: 41 }           // no category → blank cell, still pays
];

// Deals. Each line: [lineId, productId, unitPrice, qty, discountPct, expect].
// Price basis = line total pre-tax (sum after line discount); tax is never commissioned.
var CM_FAKE_DEALS = [
  { id: 910001, title: 'FAKE CM — Gateway Oct banners', owner: 711, org: 521, stage: 46, status: 'open', labels: [],
    lines: [[81001, 9101, 61, 10, 0,  'include'],                     // 610.00 @5%  = 30.50
            [81002, 9103, 85,  1, 0,  'product_ineligible'],
            [81003, 9104, 25,  1, 0,  'eligibility_not_set']] },
  { id: 910002, title: 'FAKE CM — Riverbend promo (discounted)', owner: 711, org: 522, stage: 46, status: 'open', labels: [51],
    lines: [[81004, 9102, 150, 2, 0,  'include'],                     // 300.00 @2.5% = 7.50
            [81005, 9101, 61,  5, 10, 'include']] },                  // 274.50 @2.5% = 6.86 (6.8625 → half-up cents)
  { id: 910003, title: 'FAKE CM — Lakeside lot refresh (won)', owner: 712, org: 523, stage: 46, status: 'won', labels: [],
    lines: [[81006, 9101, 61, 20, 0,  'include'],                     // 1220.00 @5% = 61.00
            [81007, 9105, 0,   1, 0,  'product_ineligible']] },
  { id: 910004, title: 'FAKE CM — Gateway wall wrap (rush label only)', owner: 712, org: 521, stage: 46, status: 'open', labels: [52],
    lines: [[81008, 9106, 1200, 1, 0, 'include'],                     // 1200.00 @5% = 60.00 (Rush ≠ Discounted)
            [81009, 9107, 40,   3, 0, 'include']] },                  // 120.00 @5% = 6.00
  { id: 910005, title: 'FAKE CM — Riverbend design only', owner: 713, org: 522, stage: 46, status: 'open', labels: [],
    lines: [[81010, 9103, 85, 1, 0,   'product_ineligible']] },       // Rep Charlie: no eligible lines at all
  { id: 910006, title: 'FAKE CM — Lakeside empty deal', owner: 711, org: 523, stage: 46, status: 'open', labels: [],
    lines: [] },                                                      // no products — contributes nothing
  { id: 910007, title: 'FAKE CM — Gateway still in EOM Merge', owner: 712, org: 521, stage: 44, status: 'open', labels: [],
    lines: [[81011, 9101, 61, 10, 0,  'not_in_stage']] },             // wrong stage — must never be pulled
  { id: 910008, title: 'FAKE CM — Riverbend lost deal', owner: 713, org: 522, stage: 46, status: 'lost', labels: [],
    lines: [[81012, 9102, 150, 1, 0,  'deal_lost']] }                 // in Billed but lost — excluded
];

function cmFakeStrip_(obj) { var o = {}; for (var k in obj) if (k !== 'expect') o[k] = obj[k]; return o; }

/** A fixture deal in the v2 deal shape. */
function cmFakeDealShape_(d) {
  return { id: d.id, title: d.title, status: d.status, value: 0, currency: 'USD',
           pipeline_id: 4, stage_id: d.stage, add_time: '2026-10-01T09:00:00Z',
           stage_change_time: '2026-10-15T09:00:00Z',
           org_id: d.org, person_id: null, owner_id: d.owner,
           label_ids: d.labels.slice(), custom_fields: {} };
}

/** A fixture line in the v2 deal-product shape (sum = qty × price less the line discount). */
function cmFakeLineShape_(dealId, l) {
  var gross = l[2] * l[3];
  var sum = Math.round(gross * (1 - l[4] / 100) * 100) / 100;
  var cat = CM_FAKE_PRODUCTS.filter(function (p) { return p.id === l[1]; })[0] || {};
  return { id: l[0], deal_id: dealId, product_id: l[1], name: cat.name || ('FAKE Product #' + l[1]),
           item_price: l[2], quantity: l[3], discount: l[4], discount_type: 'percentage', sum: sum,
           tax: 9.679, tax_method: 'exclusive', currency: 'USD', is_enabled: true,
           product_variation_id: null, comments: '', add_time: '2026-10-01T09:00:00Z', update_time: '2026-10-01T09:00:00Z',
           expect: l[5] };
}

/** Every fixture line with its expectation — the harness's answer key. */
function cmFakeExpectations_() {
  var out = [];
  CM_FAKE_DEALS.forEach(function (d) {
    d.lines.forEach(function (l) { out.push({ dealId: d.id, lineId: l[0], productId: l[1], expect: l[5] }); });
  });
  return out;
}

/** v2 products: id, name, code, category, is_linkable, custom_fields. */
function cmFakeCatalog_() {
  return CM_FAKE_PRODUCTS.map(function (p) {
    var cf = {}; if (p.elig != null) cf[CM_FAKE_ELIG_FIELD_KEY] = p.elig;
    return { id: p.id, name: p.name, code: p.code, category: p.category, tax: 9.679,
             prices: [{ price: 0, currency: 'USD' }], description: 'Commission fixture ' + p.code,
             is_linkable: p.inactive !== true, custom_fields: cf };
  });
}

function cmFakeOk_(data) { return { ok: true, status: 200, data: data, additional: null, raw: null }; }

/** Commission routes first; everything else via the shared fake (augmented where lists overlap). */
function cmFakeFetch_(method, path, payload, opts) {
  method = String(method || 'get').toLowerCase();
  var full = String(path || ''), qi = full.indexOf('?');
  var p = (qi === -1) ? full : full.slice(0, qi);
  var qs = {};
  if (qi !== -1) full.slice(qi + 1).split('&').forEach(function (kv) {
    var eq = kv.indexOf('='); if (eq > 0) { try { qs[decodeURIComponent(kv.slice(0, eq))] = decodeURIComponent(kv.slice(eq + 1)); } catch (e) {} }
  });
  if (method !== 'get') return pdFakeFetch_(method, path, payload, opts);   // the viewer never writes to Pipedrive

  if (p === '/deals' && Number(qs.stage_id) === CM_FAKE_BILLED_STAGE_ID) {
    // Honors the stage filter like the real API: the stage-44 fixture is NOT returned.
    return cmFakeOk_(CM_FAKE_DEALS.filter(function (d) { return d.stage === CM_FAKE_BILLED_STAGE_ID; }).map(cmFakeDealShape_));
  }
  var m = p.match(/^\/stages\/([^\/]+)$/);
  if (m && Number(m[1]) === CM_FAKE_BILLED_STAGE_ID) return cmFakeOk_({ id: CM_FAKE_BILLED_STAGE_ID, name: 'FAKE Billed' });

  var base = pdFakeFetch_(method, path, payload, opts);
  var list = (base && Array.isArray(base.data)) ? base.data.slice() : [];
  var want = qs.ids ? String(qs.ids).split(',').map(function (s) { return String(Number(s)); }) : null;
  var pick = function (arr) { return want ? arr.filter(function (x) { return want.indexOf(String(x.id)) !== -1; }) : arr; };

  if (p === '/productFields') {
    return cmFakeOk_(list.concat([
      { key: CM_FAKE_ELIG_FIELD_KEY, name: 'Commission Eligibility', field_type: 'enum', options: CM_FAKE_ELIG_OPTIONS.slice() },
      { key: 'category', name: 'Category', field_type: 'enum', options: CM_FAKE_CATEGORY_OPTIONS.slice() }
    ]));
  }
  if (p === '/dealFields') {
    return cmFakeOk_(list.concat([{ key: 'label', name: 'Label', field_type: 'set', options: CM_FAKE_LABEL_OPTIONS.slice() }]));
  }
  if (p === '/users')         return cmFakeOk_(list.concat(CM_FAKE_USERS.map(function (u) { return { id: u.id, name: u.name, email: u.email }; })));
  if (p === '/organizations') return cmFakeOk_(list.concat(pick(CM_FAKE_ORGS).map(function (o) { return { id: o.id, name: o.name }; })));
  if (p === '/products')      return cmFakeOk_(list.concat(pick(cmFakeCatalog_())));
  return base;
}

/** Deal products for many deals: commission fixtures by id, the shared fake's canned lines otherwise. */
function cmFakeDealProducts_(dealIds) {
  var out = {}, rest = [];
  (dealIds || []).forEach(function (id) {
    var d = CM_FAKE_DEALS.filter(function (x) { return String(x.id) === String(id); })[0];
    if (d) out[id] = d.lines.map(function (l) { return cmFakeStrip_(cmFakeLineShape_(d.id, l)); });
    else rest.push(id);
  });
  if (rest.length) { var shared = pdFakeEomProducts_(rest); Object.keys(shared).forEach(function (k) { out[k] = shared[k]; }); }
  return out;
}
