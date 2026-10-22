// ============================================================================
// CommissionFake.gs — commission-tracker fixtures for the DEV viewer (viewer-only)
// ----------------------------------------------------------------------------
// A thin layer IN FRONT OF the shared Pipedrive fake (PdFake.gs, a harness-guarded
// byte-copy of the main app's — never edit that copy for viewer-only needs).
// cvFakeJson_ calls cmFakeFetch_, which answers the commission routes from the
// active "world" below and DELEGATES everything else to pdFakeFetch_ (augmenting
// the field-definition / users / orgs / products lists with commission entries).
// Inert on PROD: only reached through the off-prod branches in Code.gs.
//
// Two worlds, picked by the DEV ScriptProperty CM_FAKE_CFG_PROP (default fixtures):
//  - fixtures: the 8 hand-made deals below, one per rule.
//  - volume:   a seeded, deterministic generator at production scale (a busy
//              month ≈ 400 deals × ~6 lines) with the same edge cases mixed in at
//              realistic rates. `month` advances the Billed stage like month end:
//              the previous month's deals move out, 5% linger (carry-over).
//
// Mock shapes follow the shared fake's v2 conventions (plain relation ids,
// custom_fields object, no embedded `product` on deal products). The /deals list
// is cursor-paginated at 500 like the real API, so the pagination loop runs.
// Three shapes are ASSUMED until probed live (see Commission.gs header): v2 deal
// `label_ids`, v2 product `category` (an option id), product custom_fields on
// /products?ids=.
//
// EVERY line carries `expect` — 'include' or the exclusion reason code the engine
// must report — plus, via cmFakeExpectations_(), the expected commission in
// integer cents (computed independently of the engine's float math). `expect`
// is stripped from the API-shaped responses.
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

// Deals. Each line: [lineId, productId, unitPrice, qty, discountPct, expect, disabled?].
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

// ── Volume mode (DEV test data at production scale) ──────────────────────────
var CM_FAKE_CFG_PROP = 'cm_fake_cfg';   // DEV ScriptProperties JSON {volume, failPct, month}
var CM_FAKE_VOLUMES = {                 // a busy month = ~400 deals × 5+ lines (Nick, 2026-10-22)
  fixtures: { label: 'Hand-made fixtures (8 deals)', deals: 0 },
  month:    { label: 'Busy month — 400 deals',       deals: 400 },
  x5:       { label: '5× — 2,000 deals',              deals: 2000 },
  overload: { label: 'Overload — 8,000 deals',        deals: 8000 }
};
var CM_FAKE_PAGE = 500;                 // v2 page-size cap
var CM_FAKE_CARRY_EVERY = 20;           // 1 in 20 of last month's deals is still in Billed (5%)
var CM_FAKE_SEED_LINE_BASE = 900000000; // synthetic ledger-history line ids (never collide with fake deals)
var cmFakeWorldMemo_ = null;            // per-execution cache {key, world}

function cmFakeCfg_() {
  var c = {};
  try { c = JSON.parse(PropertiesService.getScriptProperties().getProperty(CM_FAKE_CFG_PROP) || '{}') || {}; } catch (e) {}
  return { volume: CM_FAKE_VOLUMES[c.volume] ? c.volume : 'fixtures',
           failPct: Math.max(0, Math.min(50, Number(c.failPct) || 0)),
           month: Math.max(0, Math.floor(Number(c.month) || 0)) };
}
function cmFakeCfgPut_(c) {
  PropertiesService.getScriptProperties().setProperty(CM_FAKE_CFG_PROP, JSON.stringify(c));
  cmFakeWorldMemo_ = null;
}

/** mulberry32 — tiny seeded PRNG, so every pull of the same config is identical. */
function cmFakeRng_(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function cmFakePad_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

var CM_FAKE_VOL_NAMES = ['Window Banner', 'Windshield Shortcut', 'Lot Signage', 'Wall Wrap', 'Floor Decal',
                         'Design Fee', 'Install', 'Shipping', 'Pole Banner', 'Showroom Decal'];

/** Volume catalog: 120 products — 70% Eligible, 20% Ineligible, 10% not set; some inactive / uncategorized. */
function cmFakeVolCatalog_() {
  var out = [];
  for (var i = 0; i < 120; i++) {
    var e = i % 10;
    out.push({ id: 92001 + i, name: 'FAKE ' + CM_FAKE_VOL_NAMES[i % CM_FAKE_VOL_NAMES.length] + ' ' + cmFakePad_(i + 1, 3),
               code: 'VP-' + cmFakePad_(i + 1, 3), category: (i % 13 === 0) ? null : 61 + (i % 3),
               elig: e <= 6 ? 41 : e <= 8 ? 42 : null, inactive: i % 17 === 5,
               cents: 1999 + ((i * 3701) % 60000) });            // $19.99 … $619.98, cents exercised
  }
  return out;
}
function cmFakeVolUsers_() {
  var out = []; for (var i = 0; i < 12; i++) out.push({ id: 7301 + i, name: 'FAKE Rep ' + cmFakePad_(i + 1, 2), email: 'rep' + (i + 1) + '@example.com' });
  return out;
}
function cmFakeVolOrgs_() {
  var out = []; for (var i = 0; i < 43; i++) out.push({ id: 5401 + i, name: 'FAKE Dealer ' + cmFakePad_(i + 1, 2) });
  return out;
}

/**
 * One month of Billed-stage deals (deterministic per month). Rates per deal:
 * 3% lost, 22% won, 13% Discounted, 5% Rush, 2% both labels, 2% wrong stage,
 * 1% empty. Per line: 1% product missing from the catalog, 3% $0, 2% disabled,
 * 10% line discount (5/10/15%). Lines per deal 3–9 (mean 6).
 */
function cmFakeVolMonth_(m, n, catalog) {
  var rng = cmFakeRng_(20261022 + m * 7919), deals = [], lineId = 40000000 + m * 1000000;
  for (var k = 0; k < n; k++) {
    var id = 3000000 + m * 100000 + k;
    var r = rng(), status = r < 0.03 ? 'lost' : r < 0.25 ? 'won' : 'open';
    var lr = rng(), labels = lr < 0.13 ? [51] : lr < 0.18 ? [52] : lr < 0.20 ? [51, 52] : [];
    var stage = rng() < 0.02 ? 44 : CM_FAKE_BILLED_STAGE_ID;
    var owner = 7301 + Math.floor(rng() * 12), org = 5401 + Math.floor(rng() * 43);
    var nLines = rng() < 0.01 ? 0 : 3 + Math.floor(rng() * 7), lines = [];
    for (var j = 0; j < nLines; j++) {
      var missing = rng() < 0.01, prod = missing ? null : catalog[Math.floor(rng() * catalog.length)];
      var pid = prod ? prod.id : 99000 + Math.floor(rng() * 900);
      var cents = rng() < 0.03 ? 0 : (prod ? prod.cents : 4999);
      var qty = 1 + Math.floor(rng() * 24);
      var dr = rng(), disc = dr < 0.04 ? 5 : dr < 0.08 ? 10 : dr < 0.10 ? 15 : 0;
      var disabled = rng() < 0.02;
      var expect = stage !== CM_FAKE_BILLED_STAGE_ID ? 'not_in_stage' : status === 'lost' ? 'deal_lost'
        : disabled ? 'line_disabled' : !prod ? 'eligibility_not_set'
        : prod.elig === 41 ? 'include' : prod.elig === 42 ? 'product_ineligible' : 'eligibility_not_set';
      lines.push([lineId++, pid, cents / 100, qty, disc, expect, disabled]);
    }
    deals.push({ id: id, title: 'FAKE M' + m + ' — Dealer ' + cmFakePad_(org - 5400, 2) + ' order ' + cmFakePad_(k + 1, 4),
                 owner: owner, org: org, stage: stage, status: status, labels: labels, lines: lines, month: m });
  }
  return deals;
}

/** The active world: {deals, byId, products, productsById, users, orgs, billed, cfg}. Memoized per execution. */
function cmFakeWorld_() {
  var cfg = cmFakeCfg_(), key = JSON.stringify(cfg);
  if (cmFakeWorldMemo_ && cmFakeWorldMemo_.key === key) return cmFakeWorldMemo_.world;
  var w;
  if (cfg.volume === 'fixtures') {
    w = { deals: CM_FAKE_DEALS, products: CM_FAKE_PRODUCTS, users: CM_FAKE_USERS, orgs: CM_FAKE_ORGS };
  } else {
    var n = CM_FAKE_VOLUMES[cfg.volume].deals, cat = cmFakeVolCatalog_();
    var deals = cmFakeVolMonth_(cfg.month, n, cat);
    if (cfg.month > 0) deals = cmFakeVolMonth_(cfg.month - 1, n, cat)
      .filter(function (d, k) { return k % CM_FAKE_CARRY_EVERY === 0; }).concat(deals);   // month-end stragglers
    w = { deals: deals, products: cat, users: cmFakeVolUsers_(), orgs: cmFakeVolOrgs_() };
  }
  w.cfg = cfg; w.byId = {}; w.productsById = {};
  w.deals.forEach(function (d) { w.byId[String(d.id)] = d; });
  w.products.forEach(function (p) { w.productsById[String(p.id)] = p; });
  w.billed = w.deals.filter(function (d) { return d.stage === CM_FAKE_BILLED_STAGE_ID; });
  cmFakeWorldMemo_ = { key: key, world: w };
  return w;
}

function cmFakeStrip_(obj) { var o = {}; for (var k in obj) if (k !== 'expect') o[k] = obj[k]; return o; }

/** Line total pre-tax in integer cents (qty × unit, less the line discount, rounded half-up). */
function cmFakeSumCents_(l) { return Math.round(Math.round(l[2] * 100) * l[3] * (100 - l[4]) / 100); }

/** A fixture deal in the v2 deal shape. */
function cmFakeDealShape_(d) {
  return { id: d.id, title: d.title, status: d.status, value: 0, currency: 'USD',
           pipeline_id: 4, stage_id: d.stage, add_time: '2026-10-01T09:00:00Z',
           stage_change_time: '2026-10-15T09:00:00Z',
           org_id: d.org, person_id: null, owner_id: d.owner,
           label_ids: d.labels.slice(), custom_fields: {} };
}

/** A fixture line in the v2 deal-product shape. */
function cmFakeLineShape_(dealId, l, productsById) {
  var cat = productsById[String(l[1])] || {};
  return { id: l[0], deal_id: dealId, product_id: l[1], name: cat.name || ('FAKE Product #' + l[1]),
           item_price: l[2], quantity: l[3], discount: l[4], discount_type: 'percentage', sum: cmFakeSumCents_(l) / 100,
           tax: 9.679, tax_method: 'exclusive', currency: 'USD', is_enabled: l[6] !== true,
           product_variation_id: null, comments: '', add_time: '2026-10-01T09:00:00Z', update_time: '2026-10-01T09:00:00Z',
           expect: l[5] };
}

/**
 * Every line of the active world with its expectation — the harness's answer
 * key. `commissionCents` (include lines only) is integer math, half-up:
 * sumCents × rate‰ / 1000, rate 5% (2.5% when the deal carries label 51).
 */
function cmFakeExpectations_() {
  var out = [];
  cmFakeWorld_().deals.forEach(function (d) {
    var r10 = d.labels.indexOf(51) !== -1 ? 25 : 50;
    d.lines.forEach(function (l) {
      var k = { dealId: d.id, lineId: l[0], productId: l[1], expect: l[5], ownerId: d.owner };
      if (l[5] === 'include') k.commissionCents = Math.floor((cmFakeSumCents_(l) * r10 + 500) / 1000);
      out.push(k);
    });
  });
  return out;
}

/** v2 products: id, name, code, category, is_linkable, custom_fields. */
function cmFakeCatalog_() {
  return cmFakeWorld_().products.map(function (p) {
    var cf = {}; if (p.elig != null) cf[CM_FAKE_ELIG_FIELD_KEY] = p.elig;
    return { id: p.id, name: p.name, code: p.code, category: p.category, tax: 9.679,
             prices: [{ price: (p.cents || 0) / 100, currency: 'USD' }], description: 'Commission fixture ' + p.code,
             is_linkable: p.inactive !== true, custom_fields: cf };
  });
}

function cmFakeOk_(data, additional) { return { ok: true, status: 200, data: data, additional: additional || null, raw: null }; }

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
    // Honors the stage filter like the real API (wrong-stage deals are NOT returned)
    // and its cursor pagination: at most 500 per page, next_cursor until the end.
    var all = cmFakeWorld_().billed, lim = Math.min(Number(qs.limit) || 100, CM_FAKE_PAGE);
    var off = qs.cursor ? (Number(String(qs.cursor).replace(/^cm:/, '')) || 0) : 0;
    var next = off + lim < all.length ? 'cm:' + (off + lim) : null;
    return cmFakeOk_(all.slice(off, off + lim).map(cmFakeDealShape_), { next_cursor: next });
  }
  var m = p.match(/^\/stages\/([^\/]+)$/);
  if (m && Number(m[1]) === CM_FAKE_BILLED_STAGE_ID) return cmFakeOk_({ id: CM_FAKE_BILLED_STAGE_ID, name: 'FAKE Billed' });

  var base = pdFakeFetch_(method, path, payload, opts);
  var list = (base && Array.isArray(base.data)) ? base.data.slice() : [];
  var want = null;
  if (qs.ids) { want = {}; String(qs.ids).split(',').forEach(function (s) { want[String(Number(s))] = true; }); }
  var pick = function (arr) { return want ? arr.filter(function (x) { return want[String(x.id)]; }) : arr; };

  if (p === '/productFields') {
    return cmFakeOk_(list.concat([
      { key: CM_FAKE_ELIG_FIELD_KEY, name: 'Commission Eligibility', field_type: 'enum', options: CM_FAKE_ELIG_OPTIONS.slice() },
      { key: 'category', name: 'Category', field_type: 'enum', options: CM_FAKE_CATEGORY_OPTIONS.slice() }
    ]));
  }
  if (p === '/dealFields') {
    return cmFakeOk_(list.concat([{ key: 'label', name: 'Label', field_type: 'set', options: CM_FAKE_LABEL_OPTIONS.slice() }]));
  }
  var w = cmFakeWorld_();
  if (p === '/users')         return cmFakeOk_(list.concat(w.users.map(function (u) { return { id: u.id, name: u.name, email: u.email }; })));
  if (p === '/organizations') return cmFakeOk_(list.concat(pick(w.orgs).map(function (o) { return { id: o.id, name: o.name }; })));
  if (p === '/products')      return cmFakeOk_(list.concat(pick(cmFakeCatalog_())));
  return base;
}

/** Deterministic "this deal's line-item request fails" (simulated 429 / 5xx) at failPct %. */
function cmFakeFails_(id, pct) { return pct > 0 && ((Math.imul(Number(id) | 0, -1640531535) >>> 0) % 100) < pct; }

/**
 * Deal products for many deals: commission-world deals by id, the shared fake's
 * canned lines otherwise. Simulated failures behave exactly like the PROD
 * fetch layer: the deal gets [] AND its id is pushed onto `failed`.
 */
function cmFakeDealProducts_(dealIds, failed) {
  var w = cmFakeWorld_(), out = {}, rest = [];
  (dealIds || []).forEach(function (id) {
    var d = w.byId[String(id)];
    if (!d) { rest.push(id); return; }
    if (cmFakeFails_(id, w.cfg.failPct)) { out[id] = []; if (failed) failed.push(id); return; }
    out[id] = d.lines.map(function (l) { return cmFakeStrip_(cmFakeLineShape_(d.id, l, w.productsById)); });
  });
  if (rest.length) { var shared = pdFakeEomProducts_(rest); Object.keys(shared).forEach(function (k) { out[k] = shared[k]; }); }
  return out;
}

// ── DEV test controls (public — google.script.run; every one refuses on PROD) ──

function cmDevAllowed_() { return ENV.name !== 'prod' && viewerAllowed_(); }
var CM_DEV_REFUSED = { ok: false, error: 'DEV test controls are disabled on PROD.' };

/** Panel state: config, volume options, ledger size, draft store size. */
function cmDevState_() {
  var drafts = PropertiesService.getScriptProperties().getProperty(CM_DRAFT_PROP) || '';
  var sh = null; try { sh = cmLedgerSheet_(false); } catch (e) {}
  return { cfg: cmFakeCfg_(), volumes: Object.keys(CM_FAKE_VOLUMES).map(function (k) { return { key: k, label: CM_FAKE_VOLUMES[k].label }; }),
           ledgerRows: sh ? Math.max(0, sh.getLastRow() - 1) : 0, ledgerMaxRows: sh ? sh.getMaxRows() : 0,
           draftCount: drafts ? Object.keys(cmDraftGet_()).length : 0, draftBytes: drafts.length };
}

/** Volume tier + simulated failure %. Keeps the current month. */
function cmDevSetConfig(volume, failPct) {
  if (!cmDevAllowed_()) return CM_DEV_REFUSED;
  var c = cmFakeCfg_();
  if (volume !== undefined && volume !== null) { if (!CM_FAKE_VOLUMES[volume]) return { ok: false, error: 'Unknown volume ' + volume }; c.volume = volume; }
  if (failPct !== undefined && failPct !== null) c.failPct = Math.max(0, Math.min(50, Number(failPct) || 0));
  cmFakeCfgPut_(c);
  return { ok: true, cfg: c };
}

/** Month end: last month's deals move out of Billed (5% linger), a new month's arrive. */
function cmDevNextMonth() {
  if (!cmDevAllowed_()) return CM_DEV_REFUSED;
  var c = cmFakeCfg_(); c.month++; cmFakeCfgPut_(c);
  return { ok: true, cfg: c };
}

/** Wipe the DEV ledger tab + drafts and go back to month 0 (keeps the volume tier). */
function cmDevReset() {
  if (!cmDevAllowed_()) return CM_DEV_REFUSED;
  return cmWithLock_(function () {
    var ss = SpreadsheetApp.openById(INDEX_SHEET_ID), sh = ss.getSheetByName(COMMISSION_TAB);
    if (sh) ss.deleteSheet(sh);
    PropertiesService.getScriptProperties().deleteProperty(CM_DRAFT_PROP);
    var c = cmFakeCfg_(); c.month = 0; cmFakeCfgPut_(c);
    return { ok: true };
  });
}

/**
 * Append `months` of synthetic finalized history (~2,400 lines each, the busy-
 * month size) BEFORE the earliest existing report, so the ledger read cost can be
 * measured at 1–3 years of growth. Line ids live in their own range.
 */
function cmDevSeedLedger(months) {
  if (!cmDevAllowed_()) return CM_DEV_REFUSED;
  months = Math.max(1, Math.min(36, Math.floor(Number(months) || 12)));
  return cmWithLock_(function () {
    var t0 = Date.now(), ledger = cmLedgerRows_();
    var tz = Session.getScriptTimeZone() || 'America/Chicago';
    var earliest = Utilities.formatDate(new Date(), tz, 'yyyy-MM'), nextLine = CM_FAKE_SEED_LINE_BASE;
    ledger.forEach(function (r) {
      var k = String(r.report_key); if (/^\d{4}-\d{2}$/.test(k) && k < earliest) earliest = k;
      var id = Number(r.line_id); if (id >= nextLine) nextLine = id + 1;
    });
    var y = Number(earliest.slice(0, 4)), mo = Number(earliest.slice(5, 7));
    var rng = cmFakeRng_(4242 + ledger.length), users = cmFakeVolUsers_(), orgs = cmFakeVolOrgs_(), cat = cmFakeVolCatalog_();
    var rows = [];
    for (var i = 0; i < months; i++) {
      mo--; if (mo < 1) { mo = 12; y--; }
      var key = y + '-' + cmFakePad_(mo, 2), at = key + '-28 17:00:00';
      for (var j = 0; j < 2400; j++) {
        var u = users[Math.floor(rng() * users.length)], o = orgs[Math.floor(rng() * orgs.length)], p = cat[Math.floor(rng() * cat.length)];
        var qty = 1 + Math.floor(rng() * 24), price = cmRound2_(p.cents * qty / 100), rate = rng() < 0.15 ? 2.5 : 5;
        rows.push([key, at, 'seed@example.com', u.id, u.name, 8000000 + i * 1000 + Math.floor(j / 6), 'SEED history ' + key,
                   nextLine++, p.id, p.name, p.code, '', o.name, qty, price, rate, rate === 5 ? 'default' : 'discounted',
                   cmRound2_(price * rate / 100)]);
      }
    }
    cmLedgerAppend_(rows);
    return { ok: true, months: months, rows: rows.length, ms: Date.now() - t0 };
  });
}

/**
 * Stress the draft store: a manual 7.5% rate on the first `count` open lines,
 * written the same way saveCommissionRate stores them (one ScriptProperty).
 * Reports the property size, or the error when the store overflows.
 */
function cmDevBulkRates(count) {
  if (!cmDevAllowed_()) return CM_DEV_REFUSED;
  count = Math.max(1, Math.floor(Number(count) || 100));
  return cmWithLock_(function () {
    var lines = cmPull_().lines.slice(0, count), d = cmDraftGet_();
    lines.forEach(function (l) { d[String(l.lineId)] = 7.5; });
    var bytes = JSON.stringify(d).length;
    try { cmDraftPut_(d); }
    catch (e) { return { ok: false, error: 'Draft store rejected ' + Object.keys(d).length + ' rates (' + bytes + ' bytes): ' + e.message }; }
    return { ok: true, applied: lines.length, total: Object.keys(d).length, bytes: bytes };
  });
}
