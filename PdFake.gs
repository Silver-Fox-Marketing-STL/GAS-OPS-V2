// ============================================================================
// PdFake.gs — Pipedrive FAKE layer (DEV environment only)
// ----------------------------------------------------------------------------
// In-process stand-in for the Pipedrive API so the DEV script exercises the
// FULL Pipedrive code path (deal push, line items, deal fields, EOM reports)
// with ZERO real API traffic. Wired in via two one-line branch points in
// Code.gs: pdFetch_ -> pdFakeFetch_, pdEomFetchProductsForDeals_ ->
// pdFakeEomProducts_, both gated on ENV.name !== 'prod'.
//
// This file SHIPS TO PROD but is inert there — nothing calls into it when
// ENV.name === 'prod' (the ENV_IDS resolver in Code.gs Section 1 keys the
// environment off the scriptId, so a prod execution can never take the fake
// branch).
//
// Fixture shapes mirror LIVE-CONFIRMED responses (see brain
// 03-Resources/pipedrive/integration-notes.md and docs/LEARNINGS.md):
//   - envelope matches pdFetch_'s {ok, status, data, additional, raw} and
//     NEVER throws (unmatched paths log + return ok/null, mirroring the
//     never-throw contract);
//   - v1 relation fields (org_id/person_id/user_id) are {name, value} objects;
//   - v2 products carry is_linkable + custom_fields; variations are v2-only,
//     per product; deal custom fields are TOP-LEVEL 40-char keys.
// Only the fields real callers consume are provided — this is not a full API.
//
// Fake deal ids: incrementing ScriptProperties counter seeded at 900000 so a
// fake id is unmistakable in RUN_LOG col D. Returned as NUMBERS (callers
// coerce ids to Number on writes — same type here).
// ============================================================================

var PD_FAKE_DEAL_ID_PROP = 'pd_fake_next_deal_id';
var PD_FAKE_DEAL_ID_SEED = 900000;

// Fake 40-char custom-field keys (real Pipedrive keys are 40-char hashes).
var PD_FAKE_DUP_FIELD_KEY     = 'fake' + Array(33).join('0') + 'dup1'; // deal "Duplicates"
var PD_FAKE_PROOF_FIELD_KEY   = 'fake' + Array(33).join('0') + 'prf1'; // deal "Proof" (enum)
var PD_FAKE_ORG_FIELD_KEY     = 'fake' + Array(33).join('0') + 'org1'; // product "Customer" (org type)
var PD_FAKE_INSTALL_FIELD_KEY = 'fake' + Array(33).join('0') + 'ins1'; // org "Program Install Cost" (enum)
var PD_FAKE_SCHED_FIELD_KEY   = 'fake' + Array(33).join('0') + 'sch1'; // org "Print Schedule" (set)

// Print Schedule day options + per-org day sets. Org 501 has ALL seven day ids
// so the Home band renders in dev on any weekday; 502 is a partial set.
// Fixed literals only — no new Date() tricks in the fake.
var PD_FAKE_SCHED_OPTIONS = [
  { id: 31, label: 'Monday' }, { id: 32, label: 'Tuesday' }, { id: 33, label: 'Wednesday' },
  { id: 34, label: 'Thursday' }, { id: 35, label: 'Friday' }, { id: 36, label: 'Saturday' },
  { id: 37, label: 'Sunday' }
];
var PD_FAKE_SCHED_DAYS = { 501: [31, 32, 33, 34, 35, 36, 37], 502: [31, 34] };

// Canned catalog. tax = catalog "Tax %" (pdListProducts_/buildLineItems_ carry
// it through to the line-item tax + tax_method:'exclusive' — keep non-zero on
// one product so the tax path is exercised).
var PD_FAKE_PRODUCTS = [
  { id: 9001, name: 'FAKE Shortcut Pack', code: 'FAKE-SC', tax: 9.679, prices: [{ price: 61, currency: 'USD' }] },
  { id: 9002, name: 'FAKE Design',        code: 'FAKE-DS', tax: 0,     prices: [{ price: 85, currency: 'USD' }] },
  { id: 9003, name: 'FAKE Install',       code: 'FAKE-IN', tax: 0,     prices: [{ price: 0,  currency: 'USD' }] },
  { id: 9004, name: 'FAKE Retired',       code: 'FAKE-RT', tax: 0,     prices: [{ price: 10, currency: 'USD' }], inactive: true }
];

var PD_FAKE_ORGS = [
  { id: 501, name: 'FAKE Sandbox Motors' },
  { id: 502, name: 'FAKE Dev Auto Group' }
];

// ── Per-execution state ─────────────────────────────────────────────────────
// Deals created / line items attached DURING one execution read back correctly
// (pdAttachProducts_ dedupes against GET, pdApplyInstallCost_ sums the lines it
// just attached). State does NOT persist across executions — a later GET of a
// deal id returns a canned deal, which every consumer tolerates.
var PD_FAKE_STATE__ = null;
function pdFakeState_() {
  if (!PD_FAKE_STATE__) PD_FAKE_STATE__ = { deals: {}, dealProducts: {}, nextAttach: 70001 };
  return PD_FAKE_STATE__;
}

/** Next fake deal id — incrementing, durable (ScriptProperties), numeric. */
function pdFakeNextDealId_() {
  var p = PropertiesService.getScriptProperties();
  var n = parseInt(p.getProperty(PD_FAKE_DEAL_ID_PROP), 10);
  if (isNaN(n) || n < PD_FAKE_DEAL_ID_SEED) n = PD_FAKE_DEAL_ID_SEED;
  p.setProperty(PD_FAKE_DEAL_ID_PROP, String(n + 1));
  return n;
}

/** The pdFetch_ envelope for a successful fake response. */
function pdFakeOk_(data, additional) {
  return { ok: true, status: 200, data: (data === undefined ? null : data),
           additional: additional || null, raw: null };
}

/** A canned deal. v1 relation fields are {name,value} objects (live-confirmed shape). */
function pdFakeDeal_(id, extra) {
  var d = {
    id: Number(id),
    title: 'FAKE Deal ' + id,
    status: 'open',
    value: 610, currency: 'USD',
    pipeline_id: pdFakeEomPipelineId_(), stage_id: 44,
    add_time: '2026-07-01 09:00:00',
    org_id:    { name: PD_FAKE_ORGS[0].name, value: PD_FAKE_ORGS[0].id },
    person_id: { name: 'FAKE Pat Example',   value: 601 },
    user_id:   { name: 'FAKE Dev User',      value: 701 }
  };
  d[PD_FAKE_DUP_FIELD_KEY] = 1;   // "Duplicates" custom field (top-level 40-char key, v1)
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) d[k] = extra[k];
  return d;
}

/** EOM billing pipeline id — the configured one so eomListDeals_ filter matches. */
function pdFakeEomPipelineId_() {
  try { return eomGetPipelineId_(); } catch (e) { return 4; }
}

/**
 * Catalog products in the requested API shape. Beyond the canned four, emits a
 * synthetic ACTIVE product for every product_id referenced in the (copied-from-
 * prod) PIPEDRIVE tab — otherwise buildLineItems_ marks the mapped products
 * "not in catalog" -> inactive -> pdCheckInactiveProducts_ blocks every dev push.
 * Best-effort: a config read failure falls back to the canned list.
 */
function pdFakeCatalogProducts_(isV2) {
  var out = [], seen = {};
  PD_FAKE_PRODUCTS.forEach(function (p) { seen[String(p.id)] = true; out.push(p); });
  try {
    var sh = getPipedriveSheet_();
    if (sh) {
      var data = sh.getDataRange().getValues();
      var addId = function (entry) {
        var pid = (entry && typeof entry === 'object') ? entry.product_id : entry;
        if (pid === undefined || pid === null || pid === '' || seen[String(pid)]) return;
        seen[String(pid)] = true;
        out.push({ id: Number(pid), name: 'FAKE Product #' + pid, code: 'FAKE-' + pid,
                   tax: 9.679, prices: [{ price: 61, currency: 'USD' }] });
      };
      for (var i = 1; i < data.length; i++) {
        var map = pdParseJson_(data[i][PDCFG.PRODUCT_MAP], {});
        Object.keys(map).forEach(function (t) { addId(map[t]); });
        var srcMap = pdParseJson_(data[i][PDCFG.SOURCE_PRODUCT_MAP], {});
        Object.keys(srcMap).forEach(function (g) {
          var m = srcMap[g] || {};
          Object.keys(m).forEach(function (t) { addId(m[t]); });
        });
      }
    }
  } catch (e) { /* fail-safe: canned catalog only */ }
  return out.map(function (p) {
    var shaped = { id: p.id, name: p.name, code: p.code, tax: p.tax, prices: p.prices };
    if (isV2) { shaped.is_linkable = p.inactive !== true; shaped.custom_fields = {}; }
    else      { shaped.selectable = p.inactive !== true; shaped.active_flag = p.inactive !== true; }
    return shaped;
  });
}

/** Line items attached to a fake deal this execution (live array — mutate in place). */
function pdFakeDealProductsOf_(dealId) {
  var s = pdFakeState_();
  var k = String(dealId);
  if (!s.dealProducts[k]) s.dealProducts[k] = [];
  return s.dealProducts[k];
}

/**
 * Fake pdFetch_. Same signature + envelope, never throws. Routes on
 * method + path; unmatched paths return ok/null and log, so a new call site
 * surfaces in the log without breaking a run.
 */
function pdFakeFetch_(method, path, payload, opts) {
  method = String(method || 'get').toLowerCase();
  var full = String(path || '');
  var qi = full.indexOf('?');
  var p = (qi === -1) ? full : full.slice(0, qi);
  var qs = {};
  if (qi !== -1) full.slice(qi + 1).split('&').forEach(function (kv) {
    var eq = kv.indexOf('=');
    if (eq > 0) { try { qs[decodeURIComponent(kv.slice(0, eq))] = decodeURIComponent(kv.slice(eq + 1)); } catch (e) {} }
  });
  var m, s = pdFakeState_();

  // ── Deals ──
  if (method === 'post' && p === '/deals') {
    var newId = pdFakeNextDealId_();
    var deal = pdFakeDeal_(newId, payload || {});
    deal.id = newId;                            // payload can't override the fake id
    s.deals[String(newId)] = deal;
    return pdFakeOk_(deal);
  }
  m = p.match(/^\/deals\/([^\/]+)\/products\/([^\/]+)$/);
  if (m && (method === 'put' || method === 'patch')) {
    var lines = pdFakeDealProductsOf_(m[1]);
    for (var i = 0; i < lines.length; i++) {
      if (String(lines[i].id) === String(m[2])) {
        for (var k in (payload || {})) if (Object.prototype.hasOwnProperty.call(payload, k)) lines[i][k] = payload[k];
        return pdFakeOk_(lines[i]);
      }
    }
    return pdFakeOk_(payload || null);          // unknown attachment (prior execution) — still ok
  }
  m = p.match(/^\/deals\/([^\/]+)\/products$/);
  if (m) {
    if (method === 'post') {
      var attach = { id: s.nextAttach++, deal_id: Number(m[1]) };
      for (var k2 in (payload || {})) if (Object.prototype.hasOwnProperty.call(payload, k2)) attach[k2] = payload[k2];
      attach.sum = (Number(attach.item_price) || 0) * (Number(attach.quantity) || 0);
      pdFakeDealProductsOf_(m[1]).push(attach);
      return pdFakeOk_(attach);
    }
    return pdFakeOk_(pdFakeDealProductsOf_(m[1]).slice());
  }
  m = p.match(/^\/deals\/([^\/]+)$/);
  if (m) {
    var key = String(m[1]);
    if (method === 'put' || method === 'patch') {
      var cur = s.deals[key] || pdFakeDeal_(m[1]);
      for (var k3 in (payload || {})) if (Object.prototype.hasOwnProperty.call(payload, k3)) cur[k3] = payload[k3];
      s.deals[key] = cur;
      return pdFakeOk_(cur);
    }
    return pdFakeOk_(s.deals[key] || pdFakeDeal_(m[1]));
  }
  if (method === 'get' && p === '/deals') {
    // EOM lists: ?status=open (full billing, filtered by pipeline_id) or
    // ?stage_id=N&status=all_not_deleted. Canned deals adopt the requested stage.
    var stage = parseInt(qs.stage_id, 10); if (isNaN(stage)) stage = 44;
    return pdFakeOk_([
      pdFakeDeal_(900101, { title: 'FAKE Deal — Sandbox Motors',   stage_id: stage }),
      pdFakeDeal_(900102, { title: 'FAKE Deal — Dev Auto Group',   stage_id: stage,
                            org_id: { name: PD_FAKE_ORGS[1].name, value: PD_FAKE_ORGS[1].id }, value: 305 }),
      pdFakeDeal_(900103, { title: 'FAKE Deal — Sandbox Motors 2', stage_id: stage, value: 122 })
    ]);
  }

  // ── Organizations ──
  if (method === 'get' && p === '/organizations/search') {
    return pdFakeOk_({ items: PD_FAKE_ORGS.map(function (o) { return { item: { id: o.id, name: o.name } }; }) });
  }
  m = p.match(/^\/organizations\/([^\/]+)$/);
  if (m && method === 'get') {
    // custom_fields: {} — absent keys read as undefined, so every org-driven rule
    // (install cost, copy/conditional deal fields, org conditions) fail-safes to skip.
    return pdFakeOk_({ id: Number(m[1]) || m[1], name: 'FAKE Org #' + m[1], custom_fields: {} });
  }
  if (method === 'get' && p === '/organizations') {
    // v2 list with ?custom_fields= (print schedule): attach each org's day set.
    var withCf = String(qs.custom_fields || '').indexOf(PD_FAKE_SCHED_FIELD_KEY) !== -1;
    return pdFakeOk_(PD_FAKE_ORGS.map(function (o) {
      var org = { id: o.id, name: o.name };
      if (withCf) {
        org.custom_fields = {};
        org.custom_fields[PD_FAKE_SCHED_FIELD_KEY] = (PD_FAKE_SCHED_DAYS[o.id] || []).slice();
      }
      return org;
    }));
  }

  // ── Products / fields ──
  m = p.match(/^\/products\/([^\/]+)\/variations$/);
  if (m && method === 'get') {
    var pid = Number(m[1]) || 0;
    return pdFakeOk_([
      { id: pid * 1000 + 1, name: 'FAKE Standard',  prices: [{ price: 61, currency: 'USD' }] },
      { id: pid * 1000 + 2, name: 'FAKE No Charge', prices: [{ price: 0,  currency: 'USD' }] }
    ]);
  }
  if (method === 'get' && p === '/products') {
    return pdFakeOk_(pdFakeCatalogProducts_(!!(opts && opts.version === 'v2')));
  }
  if (method === 'get' && p === '/productFields') {
    return pdFakeOk_([{ key: PD_FAKE_ORG_FIELD_KEY, name: 'Customer', field_type: 'org' }]);
  }
  if (method === 'get' && p === '/dealFields') {
    return pdFakeOk_([
      { key: PD_FAKE_DUP_FIELD_KEY,   name: 'Duplicates', field_type: 'double', options: [] },
      { key: PD_FAKE_PROOF_FIELD_KEY, name: 'Proof',      field_type: 'enum',
        options: [{ id: 11, label: 'Required' }, { id: 12, label: 'Not Required' }] }
    ]);
  }
  if (method === 'get' && p === '/organizationFields') {
    return pdFakeOk_([
      { key: PD_FAKE_INSTALL_FIELD_KEY, name: 'Program Install Cost', field_type: 'enum',
        options: [{ id: 21, label: 'Installed' }, { id: 22, label: 'Not Installed' }] },
      { key: PD_FAKE_SCHED_FIELD_KEY, name: 'Print Schedule', field_type: 'set',
        options: PD_FAKE_SCHED_OPTIONS.slice() }
    ]);
  }

  // ── Pipelines / stages / user / files ──
  m = p.match(/^\/pipelines\/([^\/]+)$/);
  if (m && method === 'get') {
    return pdFakeOk_({ id: Number(m[1]) || m[1], name: 'FAKE Pipeline ' + m[1] });
  }
  if (method === 'get' && p === '/pipelines') {
    return pdFakeOk_([{ id: pdFakeEomPipelineId_(), name: 'FAKE Billing' }]);
  }
  if (method === 'get' && p === '/stages') {
    return pdFakeOk_([
      { id: 44, name: 'FAKE EOM Merge', order_nr: 1 },
      { id: 45, name: 'FAKE Invoiced',  order_nr: 2 }
    ]);
  }
  m = p.match(/^\/stages\/([^\/]+)$/);
  if (m && method === 'get') {
    return pdFakeOk_({ id: Number(m[1]) || m[1], name: 'FAKE Stage ' + m[1] });
  }
  if (method === 'get' && p === '/users/me') {
    return pdFakeOk_({ id: 1, name: 'FAKE Dev User', email: 'dev@example.com' });
  }
  if (p === '/files') {
    if (method === 'post') return pdFakeOk_({ id: s.nextAttach++, name: (payload && payload.name) || 'fake.pdf' });
    return pdFakeOk_([]);   // GET ?deal_id= — nothing attached -> billing-file dup check proceeds
  }

  Logger.log('pdFakeFetch_: unmatched ' + method + ' ' + path);
  return pdFakeOk_(null);
}

/**
 * Fake pdEomFetchProductsForDeals_: {dealId: [dealProduct, ...]} with exactly
 * the fields eomBuildRows_ reads (incl. the embedded `product` catalog object
 * from include_product_data=1). Line items attached this execution are included.
 */
function pdFakeEomProducts_(dealIds) {
  var out = {};
  (dealIds || []).forEach(function (id, i) {
    var qty = 10 + i;
    out[id] = pdFakeDealProductsOf_(id).slice().concat([{
      id: 80001 + i, product_id: 9001, name: 'FAKE Shortcut Pack',
      item_price: 61, quantity: qty, sum: 61 * qty, tax: 9.679, discount: 0,
      billing_frequency: null, billing_start_date: null,
      comments: 'FAKE line item', add_time: '2026-07-01 09:00:00', last_edit: '',
      product_variation_id: null,
      product: { id: 9001, code: 'FAKE-SC', description: 'Fake dev catalog product',
                 tax: 9.679, product_variations: [{ id: 9001001, name: 'FAKE Standard' }] }
    }, {
      id: 80501 + i, product_id: 9002, name: 'FAKE Design',
      item_price: 85, quantity: 1, sum: 85, tax: 0, discount: 0,
      billing_frequency: null, billing_start_date: null,
      comments: '', add_time: '2026-07-01 09:05:00', last_edit: '',
      product_variation_id: null,
      product: { id: 9002, code: 'FAKE-DS', description: '', tax: 0, product_variations: [] }
    }]);
  });
  return out;
}
