/**
 * COMMISSION TRACKER — PROTOTYPE (feat/commission-tracker; DEV twin only).
 * ────────────────────────────────────────────────────────────────────────────
 * Which billed line items earn commission, for whom, at what rate — as a
 * filterable table per account manager (deal owner), finalized into a ledger.
 *
 * RULES (all fail SAFE — when in doubt, a line is NOT commissioned):
 *  - Deal:    in the Billed stage (cmStageId_) and not lost. (v2 /deals?stage_id=
 *             omits deleted deals; open + won both count.)
 *  - Line:    enabled, and its product's "Commission Eligibility" single-select is
 *             exactly "Eligible". Ineligible, blank, an unknown option, a product
 *             missing from the catalog, or the field not existing at all → excluded.
 *  - Ledger:  a line (deal-product ATTACHMENT id) is paid at most once, ever. A
 *             report = every eligible line in Billed that no finalized report has
 *             paid yet ("whatever is unpaid in Billed" — no date attribution).
 *  - Rate:    5% default; 2.5% when the deal carries the "Discounted" label; a
 *             manual per-line rate (saved as a draft) overrides either.
 *  - Amount:  commission = line total pre-tax (`sum`, after line discount) × rate,
 *             rounded half-up to the cent per line.
 *  - Owner:   the deal owner is owed the commission (owner_id → v1 /users name).
 *  - Customer = the deal's organization.
 *
 * STORAGE (the index spreadsheet this viewer already reads — ENV.INDEX_SHEET_ID):
 *  - COMMISSIONS tab: flat long-format ledger, one row per finalized line
 *    (COMMISSION_HEADERS — append-only; SQL-portable). Finalized = immutable.
 *  - Draft manual rates: ScriptProperties CM_DRAFT_PROP {lineId: rate}; cleared
 *    for each line as it is finalized.
 *
 * PUBLIC SURFACE (callable by any domain user — see Code.gs SECURITY MODEL):
 *   getCommissionReport, saveCommissionRate, finalizeCommissionReport,
 *   getFinalizedCommissionReport. COMMISSION_EDITORS gates the two writers
 *   (empty = anyone — prototype decision 2026-10-21; decide before prod).
 *
 * BEFORE PROD (open items — none of these exist in Pipedrive yet):
 *  - Create the product field "Commission Eligibility" (Eligible / Ineligible) and
 *    the deal label "Discounted"; then pin their key / option ids here instead of
 *    resolving by name (names are display-only — rename-safe ids win).
 *  - Set COMMISSION_STAGE_ID to the real Billed stage id (0 = section hidden on prod).
 *  - Confirm three v2 shapes with a read-only probe Nick runs: deal `label_ids`,
 *    product `category` (option id vs label), product `custom_fields` on /products?ids=.
 */

var COMMISSION_STAGE_ID = 0;              // PROD Billed stage id — TODO (0 = not configured)
var COMMISSION_DEFAULT_RATE = 5;          // percent
var COMMISSION_DISCOUNTED_RATE = 2.5;     // percent, when the deal has the discount label
var COMMISSION_RATE_PRESETS = [5, 2.5, 0];
var COMMISSION_DISCOUNT_LABEL = 'Discounted';
var COMMISSION_ELIG_FIELD_NAME = 'Commission Eligibility';
var COMMISSION_ELIG_YES = 'Eligible';
var COMMISSION_ELIG_NO = 'Ineligible';
var COMMISSION_EDITORS = [];              // empty = anyone may edit rates / finalize (prototype)
var COMMISSION_TAB = 'COMMISSIONS';
var COMMISSION_HEADERS = ['report_key', 'finalized_at', 'finalized_by', 'owner_id', 'owner_name',
  'deal_id', 'deal_title', 'line_id', 'product_id', 'product_name', 'product_code', 'category',
  'customer', 'quantity', 'price', 'rate', 'rate_source', 'commission'];
var CM_DRAFT_PROP = 'comm_draft_rates';

var CM_REASONS = {
  deal_lost: 'Deal is lost',
  line_disabled: 'Line item disabled on the deal',
  product_ineligible: 'Product is Ineligible',
  eligibility_not_set: 'Commission Eligibility not set',
  already_paid: 'Already paid'
};

/** The Billed stage this environment reads; 0 = not configured. DEV = the fixture stage. */
function cmStageId_() { return ENV.name === 'prod' ? COMMISSION_STAGE_ID : CM_FAKE_BILLED_STAGE_ID; }
function cmEnabled_() { return !!cvSecrets_() && !!cmStageId_(); }
function cmCanEdit_() {
  if (!COMMISSION_EDITORS.length) return true;
  return COMMISSION_EDITORS.indexOf(cmUserEmail_()) !== -1;
}
function cmUserEmail_() { try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } }
function cmRound2_(n) { return Math.round((Number(n) || 0) * 100 + 1e-7) / 100; }
function cmValidRate_(r) { var n = Number(r); return (r !== null && r !== '' && !isNaN(n) && n >= 0 && n <= 100) ? n : null; }

/** A single-select / option value from either shape (id, "id", {id}, {value}) → string ('' if none). */
function cmOptVal_(v) {
  if (v && typeof v === 'object') v = (v.id !== undefined) ? v.id : v.value;
  return (v === undefined || v === null) ? '' : String(v).trim();
}

// ── Field definitions: eligibility key + options, category options, discount label ids ──
function cmFieldDefs_(s) {
  var defs = { eligKey: '', eligYes: '', eligNo: '', categories: {}, discountIds: {}, warnings: [] };
  cvListAllV1_(s, '/productFields').forEach(function (f) {
    if (f.name === COMMISSION_ELIG_FIELD_NAME && f.key) {
      defs.eligKey = f.key;
      (f.options || []).forEach(function (o) {
        var lab = String(o.label || '').trim().toLowerCase();
        if (lab === COMMISSION_ELIG_YES.toLowerCase()) defs.eligYes = String(o.id);
        if (lab === COMMISSION_ELIG_NO.toLowerCase()) defs.eligNo = String(o.id);
      });
    }
    if (f.key === 'category') (f.options || []).forEach(function (o) { defs.categories[String(o.id)] = o.label || ''; });
  });
  cvListAllV1_(s, '/dealFields').forEach(function (f) {
    if (f.key !== 'label') return;
    (f.options || []).forEach(function (o) {
      if (String(o.label || '').trim().toLowerCase() === COMMISSION_DISCOUNT_LABEL.toLowerCase()) defs.discountIds[String(o.id)] = true;
    });
  });
  if (!defs.eligKey) defs.warnings.push('No "' + COMMISSION_ELIG_FIELD_NAME + '" product field exists in Pipedrive — every line is excluded.');
  else if (!defs.eligYes) defs.warnings.push('The "' + COMMISSION_ELIG_FIELD_NAME + '" field has no "' + COMMISSION_ELIG_YES + '" option — every line is excluded.');
  if (!Object.keys(defs.discountIds).length) defs.warnings.push('No "' + COMMISSION_DISCOUNT_LABEL + '" deal label exists — every deal uses the ' + COMMISSION_DEFAULT_RATE + '% default.');
  return defs;
}

/** Deal labels from either shape: v2 label_ids [ids] or v1 label "51,52" / 51. */
function cmDealLabelIds_(deal) {
  if (Array.isArray(deal.label_ids)) return deal.label_ids.map(String);
  if (deal.label != null && deal.label !== '') return String(deal.label).split(',').map(function (x) { return x.trim(); });
  return [];
}

function cmCategoryName_(raw, defs) {
  var v = cmOptVal_(raw);
  if (!v) return '';
  if (defs.categories[v] !== undefined) return defs.categories[v];
  return isNaN(Number(v)) ? v : '';     // an already-resolved label passes through; an unknown id doesn't
}

/**
 * PURE engine — no I/O, so the harness can drive it directly.
 * in: deals (v2), productsByDeal {dealId:[deal products]}, ctx {orgNames, userNames, catalog{id:product}},
 *     defs (cmFieldDefs_), paid {lineId: reportKey}, overrides {lineId: rate}
 * out: {lines:[included], excluded:[...]} sorted owner → deal → line.
 */
function cmEvaluate_(deals, productsByDeal, ctx, defs, paid, overrides) {
  var lines = [], excluded = [];
  paid = paid || {}; overrides = overrides || {};
  (deals || []).forEach(function (deal) {
    var ownerId = pdRelId_(deal.owner_id !== undefined ? deal.owner_id : deal.user_id);
    var ownerName = (ctx.userNames[String(ownerId)] || (ownerId ? 'User #' + ownerId : 'Unassigned'));
    var orgId = pdRelId_(deal.org_id);
    var customer = ctx.orgNames[String(orgId)] || '';
    var discounted = cmDealLabelIds_(deal).some(function (id) { return defs.discountIds[id]; });
    (productsByDeal[deal.id] || productsByDeal[String(deal.id)] || []).forEach(function (dp) {
      var prod = ctx.catalog[String(dp.product_id)] || null;
      var row = {
        lineId: Number(dp.id), dealId: Number(deal.id), dealTitle: deal.title || '',
        ownerId: ownerId, ownerName: ownerName, customer: customer,
        productId: Number(dp.product_id) || 0, productName: dp.name || (prod && prod.name) || '',
        productCode: (prod && prod.code) || '', category: prod ? cmCategoryName_(prod.category, defs) : '',
        qty: Number(dp.quantity) || 0, price: cmRound2_(dp.sum)
      };
      var reason = '', detail = '';
      if (deal.status === 'lost') reason = 'deal_lost';
      else if (dp.is_enabled === false || dp.enabled_flag === false) reason = 'line_disabled';
      else if (paid[String(row.lineId)]) { reason = 'already_paid'; detail = paid[String(row.lineId)]; }
      else {
        var cf = (prod && prod.custom_fields) || {};
        var ev = defs.eligKey && prod ? cmOptVal_(cf[defs.eligKey] !== undefined ? cf[defs.eligKey] : prod[defs.eligKey]) : '';
        if (!prod) { reason = 'eligibility_not_set'; detail = 'product not in catalog'; }
        else if (defs.eligYes && ev === defs.eligYes) reason = '';
        else if (defs.eligNo && ev === defs.eligNo) reason = 'product_ineligible';
        else { reason = 'eligibility_not_set'; if (ev) detail = 'unknown option ' + ev; }
      }
      if (reason) {
        row.reason = reason; row.reasonText = CM_REASONS[reason] + (detail ? ' (' + detail + ')' : '');
        excluded.push(row); return;
      }
      row.discounted = discounted;
      row.defaultRate = discounted ? COMMISSION_DISCOUNTED_RATE : COMMISSION_DEFAULT_RATE;
      row.rateSource = discounted ? 'discounted' : 'default';
      var ov = cmValidRate_(overrides[String(row.lineId)]);
      row.rate = ov !== null ? ov : row.defaultRate;
      if (ov !== null) row.rateSource = 'manual';
      row.commission = cmRound2_(row.price * row.rate / 100);
      lines.push(row);
    });
  });
  var cmp = function (a, b) {
    return a.ownerName < b.ownerName ? -1 : a.ownerName > b.ownerName ? 1 : (a.dealId - b.dealId) || (a.lineId - b.lineId);
  };
  lines.sort(cmp); excluded.sort(cmp);
  return { lines: lines, excluded: excluded };
}

// ── Ledger + draft storage ──
function cmLedgerSheet_(create) {
  var ss = SpreadsheetApp.openById(INDEX_SHEET_ID);
  var sh = ss.getSheetByName(COMMISSION_TAB);
  if (!sh && create) {
    sh = ss.insertSheet(COMMISSION_TAB);
    sh.getRange(1, 1, 1, COMMISSION_HEADERS.length).setValues([COMMISSION_HEADERS]);
  }
  return sh;
}
/** Every ledger row as objects keyed by COMMISSION_HEADERS (values stringified for the client boundary). */
function cmLedgerRows_() {
  var sh = cmLedgerSheet_(false);
  if (!sh) return [];
  var data = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < data.length; i++) {
    var o = {};
    COMMISSION_HEADERS.forEach(function (h, c) { o[h] = data[i][c]; });
    if (String(o.line_id || '').trim()) out.push(o);
  }
  return out;
}
function cmPaidIndex_(rows) {
  var paid = {};
  rows.forEach(function (r) { paid[String(Number(r.line_id))] = String(r.report_key); });
  return paid;
}
function cmReportList_(rows) {
  var by = {};
  rows.forEach(function (r) {
    var k = String(r.report_key);
    if (!by[k]) by[k] = { reportKey: k, finalizedAt: String(r.finalized_at), lineCount: 0, total: 0 };
    by[k].lineCount++; by[k].total = cmRound2_(by[k].total + (Number(r.commission) || 0));
  });
  return Object.keys(by).sort().reverse().map(function (k) { return by[k]; });
}
function cmDraftGet_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(CM_DRAFT_PROP) || '{}') || {}; }
  catch (e) { return {}; }
}
function cmDraftPut_(m) { PropertiesService.getScriptProperties().setProperty(CM_DRAFT_PROP, JSON.stringify(m || {})); }
function cmWithLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Another commission save is in progress — try again.' };
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Live pull: Billed-stage deals + their lines + names/catalog, evaluated against the ledger + drafts. */
function cmPull_() {
  var s = cvSecrets_(), stageId = cmStageId_();
  var defs = cmFieldDefs_(s);
  var deals = cvListAllV2_(s, '/deals?stage_id=' + stageId)
    .filter(function (d) { return Number(d.stage_id) === Number(stageId); });   // guard: never trust the filter alone
  var productsByDeal = {}, CHUNK = 100;
  for (var i = 0; i < deals.length; i += CHUNK) {
    var got = cvFetchProductsForDeals_(s, deals.slice(i, i + CHUNK).map(function (d) { return d.id; }));
    Object.keys(got).forEach(function (k) { productsByDeal[k] = got[k]; });
    if (i + CHUNK < deals.length) Utilities.sleep(800);
  }
  var ctx = { orgNames: {}, userNames: {}, catalog: {} }, productIds = [];
  Object.keys(productsByDeal).forEach(function (k) { (productsByDeal[k] || []).forEach(function (dp) { productIds.push(dp.product_id); }); });
  try { var orgs = cvListByIdsV2_(s, '/organizations', deals.map(function (d) { return pdRelId_(d.org_id); }));
        Object.keys(orgs).forEach(function (id) { ctx.orgNames[id] = orgs[id].name || ''; }); } catch (e) {}
  try { cvListAllV1_(s, '/users').forEach(function (u) { if (u && u.id) ctx.userNames[String(u.id)] = u.name || ''; }); } catch (e) {}
  try { ctx.catalog = cvListByIdsV2_(s, '/products', productIds); } catch (e) {}
  var ledger = cmLedgerRows_();
  var ev = cmEvaluate_(deals, productsByDeal, ctx, defs, cmPaidIndex_(ledger), cmDraftGet_());
  var st = cvGetJson_(s.baseV2 + '/stages/' + stageId + '?api_token=' + encodeURIComponent(s.token));
  return {
    lines: ev.lines, excluded: ev.excluded, warnings: defs.warnings,
    meta: { stageId: String(stageId), stageName: (st && st.data && st.data.name) || '', dealCount: deals.length,
            generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss'),
            dealBaseUrl: 'https://' + s.domain + '.pipedrive.com/deal/', canEdit: cmCanEdit_(),
            presets: COMMISSION_RATE_PRESETS.slice(), defaultRate: COMMISSION_DEFAULT_RATE,
            discountedRate: COMMISSION_DISCOUNTED_RATE, finalizedKeys: cmReportList_(ledger).map(function (r) { return r.reportKey; }) }
  };
}

// ── Public endpoints ──

/** The open (unfinalized) commission report: eligible unpaid lines + why everything else was excluded. */
function getCommissionReport() {
  if (!viewerAllowed_()) return { ok: false, error: 'Not authorized.' };
  if (!cmEnabled_()) return { ok: false, error: 'The commission tracker is not configured.' };
  try { return { ok: true, json: JSON.stringify(cmPull_()) }; }
  catch (e) { return { ok: false, error: 'Commission pull failed: ' + e.message }; }
}

/** Draft manual rate for one line (rate null/'' = back to the default). Refused once the line is paid. */
function saveCommissionRate(lineId, rate) {
  if (!viewerAllowed_() || !cmCanEdit_()) return { ok: false, error: 'Not authorized to edit commissions.' };
  var id = Number(lineId);
  if (!id || isNaN(id)) return { ok: false, error: 'Bad line id.' };
  var reset = (rate === null || rate === '' || rate === undefined);
  var r = reset ? null : cmValidRate_(rate);
  if (!reset && r === null) return { ok: false, error: 'Rate must be a number from 0 to 100.' };
  return cmWithLock_(function () {
    var paid = cmPaidIndex_(cmLedgerRows_());
    if (paid[String(id)]) return { ok: false, error: 'That line was already finalized in ' + paid[String(id)] + '.' };
    var d = cmDraftGet_();
    if (reset) delete d[String(id)]; else d[String(id)] = r;
    cmDraftPut_(d);
    return { ok: true };
  });
}

/**
 * Locks the open report into the ledger under `reportKey` (yyyy-MM). `seen` =
 * [[lineId, rate, price], ...] exactly as the user reviewed it: the server
 * re-pulls and refuses if ANYTHING differs (a deal edited, a line added, a rate
 * changed by someone else) — what gets finalized is what was on screen.
 */
function finalizeCommissionReport(reportKey, seen) {
  if (!viewerAllowed_() || !cmCanEdit_()) return { ok: false, error: 'Not authorized to finalize commissions.' };
  if (!cmEnabled_()) return { ok: false, error: 'The commission tracker is not configured.' };
  var key = String(reportKey || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return { ok: false, error: 'Pick the month this report is for (YYYY-MM).' };
  return cmWithLock_(function () {
    try {
      var ledger = cmLedgerRows_();
      if (ledger.some(function (r) { return String(r.report_key) === key; })) return { ok: false, error: key + ' is already finalized — finalized reports cannot be changed.' };
      var live = cmPull_();
      if (!live.lines.length) return { ok: false, error: 'Nothing to finalize — no unpaid eligible lines.' };
      var want = {}; (seen || []).forEach(function (x) { if (x) want[String(Number(x[0]))] = x; });
      var stale = Object.keys(want).length !== live.lines.length || live.lines.some(function (l) {
        var w = want[String(l.lineId)];
        return !w || Math.abs(Number(w[1]) - l.rate) > 1e-9 || Math.abs(Number(w[2]) - l.price) > 0.004;
      });
      if (stale) return { ok: false, stale: true, error: 'The report changed since you loaded it — refresh and review again before finalizing.' };
      var at = live.meta.generatedAt, by = cmUserEmail_();
      var rows = live.lines.map(function (l) {
        return [key, at, by, l.ownerId, l.ownerName, l.dealId, l.dealTitle, l.lineId, l.productId, l.productName,
                l.productCode, l.category, l.customer, l.qty, l.price, l.rate, l.rateSource, l.commission];
      });
      var sh = cmLedgerSheet_(true);
      // '@' BEFORE setValues: Sheets would parse "2026-10" / the timestamp into Dates. The only write, last.
      var rng = sh.getRange(sh.getLastRow() + 1, 1, rows.length, COMMISSION_HEADERS.length);
      rng.setNumberFormat('@');
      rng.setValues(rows.map(function (r) { return r.map(function (v) { return String(v); }); }));
      var d = cmDraftGet_(); live.lines.forEach(function (l) { delete d[String(l.lineId)]; }); cmDraftPut_(d);
      var total = 0; live.lines.forEach(function (l) { total += l.commission; });
      return { ok: true, reportKey: key, lineCount: rows.length, total: cmRound2_(total) };
    } catch (e) { return { ok: false, error: 'Finalize failed: ' + e.message }; }
  });
}

/** A finalized (read-only) report from the ledger, in the same line shape as the open report. */
function getFinalizedCommissionReport(reportKey) {
  if (!viewerAllowed_()) return { ok: false, error: 'Not authorized.' };
  var key = String(reportKey || '');
  try {
    var rows = cmLedgerRows_().filter(function (r) { return String(r.report_key) === key; });
    if (!rows.length) return { ok: false, error: 'No finalized commission report for ' + key + '.' };
    var lines = rows.map(function (r) {
      return { lineId: Number(r.line_id), dealId: Number(r.deal_id), dealTitle: String(r.deal_title), ownerId: Number(r.owner_id),
               ownerName: String(r.owner_name), customer: String(r.customer), productId: Number(r.product_id),
               productName: String(r.product_name), productCode: String(r.product_code), category: String(r.category),
               qty: Number(r.quantity) || 0, price: Number(r.price) || 0, rate: Number(r.rate) || 0,
               rateSource: String(r.rate_source), commission: Number(r.commission) || 0 };
    });
    var s = cvSecrets_();
    return { ok: true, json: JSON.stringify({ lines: lines, excluded: [], warnings: [], meta: {
      finalized: true, reportKey: key, finalizedAt: String(rows[0].finalized_at), finalizedBy: String(rows[0].finalized_by),
      dealBaseUrl: s ? 'https://' + s.domain + '.pipedrive.com/deal/' : '', canEdit: false } }) };
  } catch (e) { return { ok: false, error: 'Could not read the commission ledger.' }; }
}

/** Bootstrap slice: whether the section shows, and the finalized reports for the sidebar. */
function cmBootstrap_() {
  if (!cmEnabled_()) return { enabled: false, reports: [] };
  var reports = [];
  try { reports = cmReportList_(cmLedgerRows_()); } catch (e) {}
  return { enabled: true, reports: reports };
}
