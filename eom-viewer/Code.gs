/**
 * SF EOM REPORT VIEWER — standalone, read-only web app.
 * ────────────────────────────────────────────────────────────────────────────
 * A SEPARATE Apps Script project (its own web-app deployment). It shares NO
 * runtime code with the main SilverFox app — it CONNECTS by one data id: the
 * SF_EOM_REPORTS index spreadsheet (created by the main app's
 * setupEomReportsIndex()). The invoice team bookmarks this app's /exec URL and
 * sees the archive of PUBLISHED monthly reports; they need no access to the main
 * app, the sheets, or any Drive file.
 *
 * SECURITY MODEL (read before adding any function):
 *  - Deployed executeAs USER_DEPLOYING (runs as the OWNER) + access DOMAIN. So
 *    the owner's Drive/Sheets auth reads the data; any signed-in domain user can
 *    open it — and can invoke ANY public (non-underscore) function here with the
 *    owner's authority. Therefore the public surface is EXACTLY these functions:
 *    doGet, getViewerBootstrap, getReportJson, getCurrentReport — plus the
 *    commission tracker's four in Commission.gs (getCommissionReport,
 *    saveCommissionRate, finalizeCommissionReport, getFinalizedCommissionReport:
 *    the FIRST endpoints here that WRITE — the COMMISSIONS ledger tab + draft
 *    rates — gated by COMMISSION_EDITORS). Everything else
 *    is `_`-suffixed. The archive endpoints expose PUBLISHED rows only and NEVER
 *    return file ids or Drive/spreadsheet URLs (those are owner-only artifacts).
 *    getCurrentReport is a READ-ONLY Pipedrive pull (GETs only) of the EOM Merge
 *    stage — the same data class the published reports already expose; it never
 *    returns the token or any Pipedrive URL beyond the deal links.
 *  - EOM_VIEWER_ALLOWED (below) optionally narrows access to specific emails.
 *
 * SETUP / DEPLOY RUNBOOK:
 *  1. Two Apps Script projects exist: PROD (eom-viewer/.clasp.prod.json) and the
 *     DEV twin "DEV_SF EOM Report Viewer" (eom-viewer/.clasp.json — the default).
 *     Each scriptId is registered in ENV_IDS below with its SF_EOM_REPORTS index id.
 *  2. A new environment = new project + new ENV_IDS entry (never edit an id in place).
 *  3. From INSIDE eom-viewer/:  clasp push   → DEV. PROD = swap .clasp.prod.json in
 *     by hand (Nick-only), push, then bump the existing deployment's version.
 *  4. Deploy → New deployment → Web app: Execute as = Me, Who has access = <domain>.
 *     Authorize (Drive read + Sheets). Share the /exec URL (NOT the /dev URL —
 *     /dev runs as the accessor and needs editor access).
 *  5. Bookmark the /exec URL. Code updates: Deploy -> Manage deployments -> Edit
 *     -> New version (keeps the same URL). NEVER "New deployment" (new URL).
 *  6. CURRENT-REPORT PULL (optional, PROD only): Project Settings → Script
 *     properties → add PD_API_TOKEN + PD_COMPANY_DOMAIN (same values as the main
 *     app's). The "Current" sidebar section only appears once both are set.
 *     First use of UrlFetchApp adds the external-request scope → re-authorize
 *     on next deploy. OFF PROD (the DEV twin) no secrets are ever set: the
 *     in-process Pipedrive fake (PdFake.gs — a BYTE-COPY of the main app's,
 *     harness-guarded) serves the Current section with zero API traffic, the
 *     same way the main app's DEV script works.
 *
 * EomReportRenderer.html is a BYTE-COPY of the main app's file — keep them
 * identical (a checksum drift check guards this in the repo's Node self-checks).
 */

// ── Connection: data by ID only — resolved from THIS script's id (same idiom as
// main Code.gs Section 1 ENV_IDS / lot-scan). The scriptId IS the environment:
// the PROD viewer reads the prod SF_EOM_REPORTS index, the DEV twin reads
// DEV_SF_EOM_REPORTS_INDEX, and an unregistered id (a stray Drive copy) throws
// at load rather than running against guessed prod ids. Minted 2026-10-21
// (docs/dev-environment.md).
var ENV_IDS = {
  '14AbPr3pM9Grg3gu2dFMWvQOAIksI-x-zGysygzy8PXCmcBRObKvVQgW2': { // PROD viewer (eom-viewer/.clasp.prod.json)
    name: 'prod', INDEX_SHEET_ID: '1p28o2IbGFrHOqKVs_DUpAtyzM6LFYyAKUpsBB7NwFxg' }, // SF_EOM_REPORTS (logged by setupEomReportsIndex())
  '1IlGUPGyJpPeF9YnuvcKMGVbD8qQRIPHR6YurtBe5PrL3s7k138ff-P_f': { // DEV_SF EOM Report Viewer (eom-viewer/.clasp.json)
    name: 'dev',  INDEX_SHEET_ID: '18EQEMCS6Z6ux767ETyeVsFFjsYxrmHMw_m00sQEaoDU' }  // DEV_SF_EOM_REPORTS_INDEX
};
var ENV = ENV_IDS[ScriptApp.getScriptId()];
if (!ENV) throw new Error('Unknown scriptId ' + ScriptApp.getScriptId() +
  ' — add it to ENV_IDS in eom-viewer/Code.gs. Refusing to run against guessed (prod) IDs.');
var INDEX_SHEET_ID = ENV.INDEX_SHEET_ID;
var INDEX_TAB = 'REPORTS';
// 0-based column map — MUST match the main app's EOMIDX.
var IDX = { MONTH_KEY: 0, MONTH_LABEL: 1, SCOPE: 2, STAGE_ID: 3, GENERATED_AT: 4,
  JSON_FILE_ID: 5, FOLDER_URL: 6, SS_URL: 7, ORG_COUNT: 8, DEAL_COUNT: 9, STATUS: 10,
  PUBLISHED_AT: 11, PUBLISHED_BY: 12, PUBLISHED_JSON_FILE_ID: 13 };
// Empty = any domain user may view. Add work emails to restrict further.
var EOM_VIEWER_ALLOWED = [];
// The live "Current report" always reads THIS Pipedrive stage (EOM Merge).
var CURRENT_STAGE_ID = 44;

// ── Web-app entry (public) ──
function include_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
function doGet(e) {
  return HtmlService.createTemplateFromFile('Viewer').evaluate()
    .setTitle('Silver Fox — EOM Reports' + (ENV.name === 'prod' ? '' : ' (' + ENV.name.toUpperCase() + ')'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ── Guards / helpers (private) ──
function viewerAllowed_() {
  if (!EOM_VIEWER_ALLOWED.length) return true;
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  return EOM_VIEWER_ALLOWED.indexOf(email) !== -1;
}
function openIndex_() {
  if (!INDEX_SHEET_ID) return null;
  try { var ss = SpreadsheetApp.openById(INDEX_SHEET_ID); return ss.getSheetByName(INDEX_TAB) || ss.getSheets()[0]; }
  catch (e) { return null; }
}

// ── Public data endpoints (any domain user can call these — keep them TINY) ──

/** Published months only, display fields only (never file ids or Drive urls).
 *  `current` = whether the live EOM Merge pull is configured (a boolean only —
 *  the token itself is never returned). */
function getViewerBootstrap() {
  if (!viewerAllowed_()) return { ok: false, error: 'Not authorized.' };
  var current = !!cvSecrets_();
  var commissions = cmBootstrap_();   // Commission.gs — {enabled, reports}
  var sh = openIndex_();
  if (!sh) return { ok: true, reports: [], current: current, commissions: commissions };
  var data = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (String(r[IDX.STATUS]) !== 'published') continue;
    if (!String(r[IDX.PUBLISHED_JSON_FILE_ID] || '').trim()) continue;
    out.push({
      monthKey: String(r[IDX.MONTH_KEY]), monthLabel: String(r[IDX.MONTH_LABEL]),
      publishedAt: String(r[IDX.PUBLISHED_AT]), orgCount: String(r[IDX.ORG_COUNT]), dealCount: String(r[IDX.DEAL_COUNT])
    });
  }
  out.sort(function (a, b) { return a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0; });
  return { ok: true, reports: out, current: current, commissions: commissions };
}

/** The PUBLISHED snapshot for a month (matched by month_key or month_label), as a
 *  JSON string. Refuses anything not published. */
function getReportJson(monthRef) {
  if (!viewerAllowed_()) return { ok: false, error: 'Not authorized.' };
  var sh = openIndex_();
  if (!sh) return { ok: false, error: 'Viewer not configured.' };
  var key = String(monthRef || '');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (String(r[IDX.MONTH_KEY]) !== key && String(r[IDX.MONTH_LABEL]) !== key) continue;
    if (String(r[IDX.STATUS]) !== 'published') return { ok: false, error: 'That report is not published.' };
    var fileId = String(r[IDX.PUBLISHED_JSON_FILE_ID] || '');
    if (!fileId) return { ok: false, error: 'No published snapshot.' };
    try { return { ok: true, json: DriveApp.getFileById(fileId).getBlob().getDataAsString() }; }
    catch (e) { return { ok: false, error: 'Could not read report.' }; }
  }
  return { ok: false, error: 'No published report for ' + key + '.' };
}

// ════════════════════════════════════════════════════════════════════════════
// CURRENT REPORT — live read-only pull of the EOM Merge stage (CURRENT_STAGE_ID)
// so the invoice team can spot deals parked in EOM Merge that should be billed
// immediately. Separate from the published archive: nothing is written anywhere
// (no Drive file, no index row) — it's rendered and thrown away.
// The grouping/row functions below are VERBATIM copies of the main app's
// Section 33 (eomCleanHtml_ / eomBuildRows_ / eomGroupForReport_ / EOM_COLUMNS)
// so the output shape stays identical to report.json — keep them in sync with
// Code.gs when those change. The fetch layer (cv*) is viewer-local: a plain
// UrlFetchApp GET with the token from THIS project's Script Properties — on
// PROD. Off prod (ENV.name !== 'prod') three branch points route to the
// in-process fake instead (PdFake.gs byte-copy; mirrors the main app's
// pdFetch_ -> pdFakeFetch_ / pdEomFetchProductsForDeals_ -> pdFakeEomProducts_):
// cvSecrets_ (fake settings, no properties), cvGetJson_ -> cvFakeJson_, and
// cvFetchProductsForDeals_ -> pdFakeEomProducts_. Zero network, no credentials.
// ════════════════════════════════════════════════════════════════════════════

/** Pipedrive credentials from THIS project's Script Properties (never the repo).
 *  Null until PD_API_TOKEN + PD_COMPANY_DOMAIN are set — the Current section
 *  stays hidden in the viewer until then. */
function cvSecrets_() {
  // DEV / any non-prod scriptId: the in-process fake stands in for the API — no
  // secrets, no network. `fake:true` routes cvGetJson_ / cvFetchProductsForDeals_
  // and skips the credential probe; the urls still build so callers are unchanged.
  if (ENV.name !== 'prod') return { token: 'FAKE', domain: 'fake-dev', fake: true,
    baseV1: 'https://fake-dev.pipedrive.com/api/v1', baseV2: 'https://fake-dev.pipedrive.com/api/v2' };
  var p = PropertiesService.getScriptProperties();
  var token = (p.getProperty('PD_API_TOKEN') || '').trim();
  var domain = (p.getProperty('PD_COMPANY_DOMAIN') || '').trim()
    .replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/, '').replace(/\/.*$/, '');
  if (!token || !domain) return null;
  return { token: token, domain: domain,
           baseV1: 'https://' + domain + '.pipedrive.com/api/v1',    // field-definition lists + /users only
           baseV2: 'https://' + domain + '.pipedrive.com/api/v2' };  // deals / products / stages (v1 out of support Aug 2026)
}

/** GET a url -> parsed body, or null on any error (never throws). */
var CV_API_CALLS = 0;   // per-execution request counter (diagnostics; counts fake calls too = what PROD would make)
function cvGetJson_(url) {
  CV_API_CALLS++;
  if (ENV.name !== 'prod') return cvFakeJson_(url);   // DEV: in-process fake, zero API traffic (PdFake.gs + CommissionFake.gs)
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    return JSON.parse(resp.getContentText());
  } catch (e) { return null; }
}

/** DEV only: a full v1/v2 url → the fake pdFetch_ route (PdFake.gs), reshaped to
 *  the parsed-body form cvGetJson_ callers read ({data, additional_data}). GET
 *  only — the viewer never writes. The api_token param is stripped; the version
 *  segment is honored (v1 /users, /dealFields keep their legacy shapes). An
 *  unmatched route comes back as data:null, exactly like the fake. */
function cvFakeJson_(url) {
  var m = String(url || '').match(/\/api\/(v1|v2)(\/[^#]*)$/);
  if (!m) return null;
  var path = m[2].replace(/([?&])api_token=[^&]*&?/, '$1').replace(/[?&]$/, '');
  var r = cmFakeFetch_('get', path, null, { version: m[1] });   // commission fixtures first, then the shared fake
  if (!r || !r.ok) return null;
  return { success: true, data: r.data, additional_data: r.additional || {} };
}

/** GET a v1 collection, following start/limit pagination (mirrors pdListAllV1_).
 *  v1 is only for /dealFields and /users — neither has a v2 twin. */
function cvListAllV1_(s, path, info) {
  var out = [], start = 0, guard = 0;
  while (guard++ < 40) {
    var sep = (path.indexOf('?') === -1) ? '?' : '&';
    var body = cvGetJson_(s.baseV1 + path + sep + 'start=' + start + '&limit=500&api_token=' + encodeURIComponent(s.token));
    if (info) { info.pages = (info.pages || 0) + 1; if (!body) info.incomplete = true; }
    if (!body || !body.data) break;
    out = out.concat(body.data);
    var pg = body.additional_data && body.additional_data.pagination;
    if (pg && pg.more_items_in_collection && pg.next_start != null) start = pg.next_start;
    else break;
  }
  return out;
}

/** GET a v2 collection, following cursor pagination (mirrors pdListAllV2_). */
function cvListAllV2_(s, path, info) {
  var out = [], cursor = '', guard = 0;
  do {
    var sep = (path.indexOf('?') === -1) ? '?' : '&';
    var body = cvGetJson_(s.baseV2 + path + sep + 'limit=500' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
                          + '&api_token=' + encodeURIComponent(s.token));
    if (info) { info.pages = (info.pages || 0) + 1; if (!body) info.incomplete = true; }
    if (!body || !body.data) break;
    out = out.concat(body.data);
    cursor = (body.additional_data && body.additional_data.next_cursor) ? body.additional_data.next_cursor : '';
  } while (cursor && guard++ < 40);
  if (info && cursor) info.incomplete = true;   // page guard hit with more to read = truncated, never silently
  return out;
}

/** GET v2 entities by id in batches of 100 (`?ids=`) → {id: entity} (mirrors pdListByIdsV2_). */
function cvListByIdsV2_(s, path, ids, info) {
  var out = {}, uniq = {}, list = [];
  (ids || []).forEach(function (id) { var n = Number(id); if (n && !isNaN(n) && !uniq[n]) { uniq[n] = true; list.push(n); } });
  for (var i = 0; i < list.length; i += 100) {
    var sep = (path.indexOf('?') === -1) ? '?' : '&';
    cvListAllV2_(s, path + sep + 'ids=' + list.slice(i, i + 100).join(','), info).forEach(function (it) {
      if (it && it.id !== undefined) out[String(it.id)] = it;
    });
  }
  return out;
}

/** Relation id from either API shape (v2 plain id, v1 {value}/{id}); 0 if none (mirrors pdRelId_). */
function pdRelId_(v) {
  if (v && typeof v === 'object') v = (v.value !== undefined) ? v.value : v.id;
  var n = Number(v);
  return (v === undefined || v === null || v === '' || isNaN(n)) ? 0 : n;
}

/** Products for many deals in ONE parallel batch (mirrors pdEomFetchProductsForDeals_).
 *  v2 rows carry name/price/qty/tax/variation id but no embedded `product` —
 *  cvBuildContext_ resolves the catalog side. Never throws — a failed deal yields
 *  an empty product list. */
function cvFetchProductsForDeals_(s, dealIds, failed) {
  CV_API_CALLS += dealIds.length;
  if (ENV.name !== 'prod') return cmFakeDealProducts_(dealIds, failed);   // DEV: commission world, else the shared fake's pdFakeEomProducts_
  var out = {};
  var requests = dealIds.map(function (id) {
    return {
      url: s.baseV2 + '/deals/' + id + '/products?limit=500&api_token=' + encodeURIComponent(s.token),
      muteHttpExceptions: true
    };
  });
  var responses;
  try { responses = UrlFetchApp.fetchAll(requests); }
  catch (e) { dealIds.forEach(function (id) { out[id] = []; if (failed) failed.push(id); }); return out; }
  responses.forEach(function (resp, i) {
    var id = dealIds[i];
    try {
      if (resp.getResponseCode() !== 200) { out[id] = []; if (failed) failed.push(id); return; }
      var body = JSON.parse(resp.getContentText());
      out[id] = body.data || [];
    } catch (e) { out[id] = []; if (failed) failed.push(id); }
  });
  return out;
}

/** The 40-char key of the "Duplicates" custom deal field ('' if none). v1 /dealFields (no v2 twin). */
function cvDuplicatesFieldKey_(s) {
  var key = '';
  cvListAllV1_(s, '/dealFields').forEach(function (f) { if (f.name === 'Duplicates' && f.key) key = f.key; });
  return key;
}

/** Variations of one product (v2, cursor-paginated) → [{id, name}] (mirrors pdListProductVariations_). */
function cvListProductVariations_(s, productId) {
  if (!productId) return [];
  return cvListAllV2_(s, '/products/' + productId + '/variations').map(function (v) { return { id: v.id, name: v.name || '' }; });
}

/**
 * Everything cvBuildRows_ needs that a v2 deal / deal-product no longer embeds
 * (mirrors eomBuildContext_): org/person names via v2 `?ids=` batches, owner
 * names via v1 /users, catalog code/description/tax via v2 /products?ids=, and
 * variation names only for products that appear with a variation. Best-effort.
 */
function cvBuildContext_(s, deals, productsByDeal, dupKey) {
  var ctx = { dupKey: dupKey || '', orgNames: {}, personNames: {}, userNames: {}, catalog: {}, variations: {} };
  var orgIds = [], personIds = [], productIds = {}, variedProducts = {};
  (deals || []).forEach(function (d) { orgIds.push(pdRelId_(d.org_id)); personIds.push(pdRelId_(d.person_id)); });
  Object.keys(productsByDeal || {}).forEach(function (dealId) {
    (productsByDeal[dealId] || []).forEach(function (dp) {
      if (dp.product_id) productIds[String(dp.product_id)] = true;
      if (dp.product_id && dp.product_variation_id) variedProducts[String(dp.product_id)] = true;
    });
  });
  try { var orgs = cvListByIdsV2_(s, '/organizations', orgIds);
        Object.keys(orgs).forEach(function (id) { ctx.orgNames[id] = orgs[id].name || ''; }); } catch (e) {}
  try { var persons = cvListByIdsV2_(s, '/persons', personIds);
        Object.keys(persons).forEach(function (id) { ctx.personNames[id] = persons[id].name || ''; }); } catch (e) {}
  try { cvListAllV1_(s, '/users').forEach(function (u) { if (u && u.id) ctx.userNames[String(u.id)] = u.name || ''; }); } catch (e) {}
  try {
    var prods = cvListByIdsV2_(s, '/products', Object.keys(productIds));
    Object.keys(prods).forEach(function (id) {
      var p = prods[id];
      ctx.catalog[id] = { code: p.code || '', description: p.description || '', tax: (p.tax != null ? p.tax : '') };
    });
  } catch (e) {}
  Object.keys(variedProducts).forEach(function (pid) {
    try { cvListProductVariations_(s, pid).forEach(function (v) { ctx.variations[String(v.id)] = v.name || ''; }); } catch (e) {}
  });
  return ctx;
}

// ── Verbatim copies of the main app's row/group pipeline (Section 33) ──

var EOM_COLUMNS = [
  'processed_at', 'deal_id', 'deal_title', 'deal_created_at', 'org_name',
  'person_name', 'deal_owner', 'deal_value', 'currency', 'pipeline', 'stage',
  'duplicates', 'product_id', 'product_code', 'product_name', 'product_description',
  'product_tax_percent', 'deal_tax_percent', 'variation', 'quantity', 'item_price',
  'discount', 'sum', 'billing_frequency', 'billing_start_date', 'product_notes',
  'product_added_at', 'product_last_edited'
];

/** Pipedrive rich-text HTML → clean plain text (verbatim eomCleanHtml_). */
function eomCleanHtml_(raw) {
  if (raw == null || raw === '') return '';
  var s = String(raw);
  if (s.indexOf('<') === -1 && s.indexOf('&') === -1) return s.trim();
  var BLOCK_RE = /<\/?(?:div|p|br|li|tr|h[1-6]|blockquote|pre|ul|ol)[^>]*>/gi;
  var TAG_RE = /<[^>]+>/g;
  var NAMED = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
  var t = s.replace(BLOCK_RE, '\n').replace(TAG_RE, '');
  t = t.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, function (m) { return NAMED[m] || m; });
  t = t.replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); });
  t = t.replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
  t = t.replace(/\r\n?/g, '\n').replace(new RegExp(String.fromCharCode(160), 'g'), ' ').replace(/[ \t]+/g, ' ')
       .replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function eomIsObj_(x) { return x !== null && typeof x === 'object'; }
/** A relation's display name from either API shape: v1 `{name,value}` object, or a
 *  v2 plain id looked up in `names` ({id: name}). '' when unknown. */
function eomRelName_(rel, names) {
  if (eomIsObj_(rel) && rel.name) return rel.name;
  var id = pdRelId_(rel);
  return (id && names && names[String(id)]) ? names[String(id)] : '';
}
function eomVariationName_(product, variationId) {
  if (!variationId || !product) return '';
  var vars = product.product_variations || [];
  for (var i = 0; i < vars.length; i++) { if (vars[i].id === variationId) return vars[i].name || ''; }
  return '';
}

/** One deal (+ its products) → flat rows in EOM_COLUMNS order. Copy of the main
 *  app's eomBuildRows_ with one viewer-local deviation: pipeline/stage names are
 *  '' — the renderer never reads them and blanking them saves two API calls per
 *  pull. `ctx` = cvBuildContext_() — the names/catalog a v2 deal no longer embeds
 *  (tolerates both API shapes). */
function cvBuildRows_(deal, products, ctx) {
  ctx = ctx || { dupKey: '', orgNames: {}, personNames: {}, userNames: {}, catalog: {}, variations: {} };
  var dupKey = ctx.dupKey || '';
  var cfd = deal.custom_fields || {};
  var dupVal = dupKey ? (cfd[dupKey] !== undefined ? cfd[dupKey] : deal[dupKey]) : '';
  if (dupVal == null) dupVal = '';
  var base = {
    processed_at: new Date().toISOString(),
    deal_id: deal.id,
    deal_title: deal.title || '',
    deal_created_at: deal.add_time || '',
    org_name: eomRelName_(deal.org_id, ctx.orgNames),
    person_name: eomRelName_(deal.person_id, ctx.personNames),
    deal_owner: eomRelName_(deal.owner_id !== undefined ? deal.owner_id : deal.user_id, ctx.userNames),
    deal_value: deal.value != null ? deal.value : '',
    currency: deal.currency || '',
    pipeline: '',
    stage: '',
    duplicates: dupVal
  };
  if (!products || !products.length) {
    return [EOM_COLUMNS.map(function (c) { return base[c] != null ? base[c] : ''; })];
  }
  var rows = [];
  products.forEach(function (dp) {
    var catalog = ctx.catalog[String(dp.product_id)] || dp.product || {};
    var varName = (dp.product_variation_id && ctx.variations[String(dp.product_variation_id)])
                  || eomVariationName_(dp.product || null, dp.product_variation_id) || '';
    var pr = Object.assign({}, base, {
      product_id: dp.product_id,
      product_code: catalog.code || '',
      product_name: dp.name || '',
      product_description: eomCleanHtml_(catalog.description || ''),
      product_tax_percent: catalog.tax != null ? catalog.tax : '',
      deal_tax_percent: dp.tax != null ? dp.tax : '',
      variation: varName,
      quantity: dp.quantity != null ? dp.quantity : '',
      item_price: dp.item_price != null ? dp.item_price : '',
      discount: dp.discount != null ? dp.discount : '',
      sum: dp.sum != null ? dp.sum : '',
      billing_frequency: dp.billing_frequency || '',
      billing_start_date: dp.billing_start_date || '',
      product_notes: eomCleanHtml_(dp.comments || ''),
      product_added_at: dp.add_time || '',
      product_last_edited: dp.update_time || dp.last_edit || ''
    });
    rows.push(EOM_COLUMNS.map(function (c) { return pr[c] != null ? pr[c] : ''; }));
  });
  return rows;
}

function eomColIndex_() {
  var m = {};
  EOM_COLUMNS.forEach(function (c, i) { m[c] = i; });
  return m;
}

/** Groups flat rows -> [{org, contacts:[{contact, stats, summaryRows, deals}]}].
 *  Verbatim copy of the main app's eomGroupForReport_. */
function eomGroupForReport_(rows) {
  var C = eomColIndex_();
  var orgMap = {};
  rows.forEach(function (row) {
    var org = String(row[C.org_name] || '').trim();
    if (!org) return;
    var contact = String(row[C.person_name] || 'Unassigned').trim() || 'Unassigned';
    if (!orgMap[org]) orgMap[org] = {};
    if (!orgMap[org][contact]) orgMap[org][contact] = [];
    orgMap[org][contact].push(row);
  });
  return Object.keys(orgMap).sort().map(function (org) {
    var contacts = Object.keys(orgMap[org]).sort().map(function (contact) {
      var cRows = orgMap[org][contact];

      // Stats: unique deals + duplicate count (dupes counted once per deal)
      var seen = {}, orders = 0, duplicates = 0;
      cRows.forEach(function (r) {
        var id = r[C.deal_id];
        if (!seen[id]) { seen[id] = true; orders++; duplicates += Number(r[C.duplicates]) || 0; }
      });

      // Product summary grouped by code + variation (product-less rows —
      // deals with no line items — don't produce a blank summary line)
      var sumMap = {};
      cRows.forEach(function (r) {
        var code = String(r[C.product_code] || '').trim();
        var name = String(r[C.product_name] || '').trim();
        if (!code && !name) return;
        var vari = String(r[C.variation] || '').trim();
        var note = String(r[C.product_notes] || '').trim();
        var key = code + '|||' + vari;
        if (!sumMap[key]) sumMap[key] = { code: code, name: name, desc: String(r[C.product_description] || '').trim(), vari: vari, qty: 0, amt: 0, notes: {} };
        sumMap[key].qty += Number(r[C.quantity]) || 0;
        sumMap[key].amt += Number(r[C.sum]) || 0;
        if (note) sumMap[key].notes[note] = true;
      });
      var summaryRows = Object.keys(sumMap).map(function (k) { return sumMap[k]; }).sort(function (a, b) {
        return a.code < b.code ? -1 : a.code > b.code ? 1 : a.vari < b.vari ? -1 : a.vari > b.vari ? 1 : 0;
      }).map(function (p) {
        return { code: p.code, name: p.name, desc: p.desc, vari: p.vari, qty: p.qty, amt: p.amt, notesStr: Object.keys(p.notes).join(' | ') };
      });
      var totalQty = 0, totalAmt = 0;
      summaryRows.forEach(function (p) { totalQty += p.qty; totalAmt += p.amt; });

      // Per-deal grouping (a product-less deal still appears, flagged hasProducts:false)
      var dealMap = {};
      cRows.forEach(function (r) {
        var id = r[C.deal_id];
        if (!dealMap[id]) dealMap[id] = { id: id, title: String(r[C.deal_title] || '').trim(), created: String(r[C.deal_created_at] || '').trim(), owner: String(r[C.deal_owner] || '').trim(), contact: contact, duplicates: Number(r[C.duplicates]) || 0, dealValue: Number(r[C.deal_value]) || 0, lines: [] };
        // tax = the line's actual Tax % on the deal, falling back to the product
        // catalog rate (pre-tax-fix deals have 0 on the line but a real catalog rate)
        dealMap[id].lines.push({ code: String(r[C.product_code] || '').trim(), name: String(r[C.product_name] || '').trim(), vari: String(r[C.variation] || '').trim(), qty: Number(r[C.quantity]) || 0, price: Number(r[C.item_price]) || 0, sum: Number(r[C.sum]) || 0, tax: Number(r[C.deal_tax_percent]) || Number(r[C.product_tax_percent]) || 0, desc: String(r[C.product_description] || '').trim(), notes: String(r[C.product_notes] || '').trim() });
      });
      var deals = Object.keys(dealMap).map(function (k) { return dealMap[k]; }).sort(function (a, b) { return a.id - b.id; });
      deals.forEach(function (d) {
        d.hasProducts = d.lines.some(function (l) { return l.code || l.name; });
        if (!d.hasProducts) d.lines = [];
      });

      return { contact: contact, stats: { orders: orders, duplicates: duplicates, totalQty: totalQty, totalAmt: totalAmt }, summaryRows: summaryRows, deals: deals };
    });
    return { org: org, contacts: contacts };
  });
}

/** LIVE pull of the EOM Merge stage → the same {group, meta} JSON shape as
 *  report.json, so the client renders it exactly like an archived month.
 *  Read-only (GETs only), writes nothing anywhere. */
function getCurrentReport() {
  if (!viewerAllowed_()) return { ok: false, error: 'Not authorized.' };
  var s = cvSecrets_();
  if (!s) return { ok: false, error: 'The current-report pull is not configured.' };
  try {
    // Probe the credentials first — the never-throw fetch layer would otherwise
    // make a rejected token indistinguishable from a genuinely empty stage.
    // Fetched OUTSIDE cvGetJson_ so a missing OAuth scope (owner never
    // re-authorized after UrlFetchApp was added) surfaces as its own error
    // instead of masquerading as rejected credentials.
    var me = null;
    if (s.fake) me = cvFakeJson_(s.baseV1 + '/users/me');   // DEV: nothing to probe — the fake answers
    else try {
      var probe = UrlFetchApp.fetch(s.baseV1 + '/users/me?api_token=' + encodeURIComponent(s.token), { muteHttpExceptions: true });
      me = (probe.getResponseCode() === 200) ? JSON.parse(probe.getContentText()) : null;
    } catch (e) {
      return { ok: false, error: 'The viewer script is not authorized for external requests yet — open the script editor, run getCurrentReport once from the toolbar, and approve the prompt. (' + e.message + ')' };
    }
    if (!me || me.success === false || !me.data) {
      return { ok: false, error: 'Pipedrive rejected the viewer credentials — re-check PD_API_TOKEN and PD_COMPANY_DOMAIN in the viewer project’s Script Properties.' };
    }
    // v2 deals list: no `status` = every not-deleted deal in the stage (v1's
    // all_not_deleted); the Duplicates field is requested explicitly via custom_fields=.
    var dupKey = cvDuplicatesFieldKey_(s);
    var deals = cvListAllV2_(s, '/deals?stage_id=' + CURRENT_STAGE_ID + (dupKey ? '&custom_fields=' + encodeURIComponent(dupKey) : ''));
    // Stage name echo: if CURRENT_STAGE_ID ever stops being "EOM Merge", the UI
    // says which stage it actually pulled instead of lying about EOM Merge.
    var st = cvGetJson_(s.baseV2 + '/stages/' + CURRENT_STAGE_ID + '?api_token=' + encodeURIComponent(s.token));
    var stageName = (st && st.data && st.data.name) ? st.data.name : '';
    var productsByDeal = {}, CHUNK = 100;
    for (var i = 0; i < deals.length; i += CHUNK) {
      var got = cvFetchProductsForDeals_(s, deals.slice(i, i + CHUNK).map(function (d) { return d.id; }));
      Object.keys(got).forEach(function (k) { productsByDeal[k] = got[k]; });
      if (i + CHUNK < deals.length) Utilities.sleep(800);
    }
    var ctx = cvBuildContext_(s, deals, productsByDeal, dupKey);
    var rows = [];
    deals.forEach(function (deal) { rows = rows.concat(cvBuildRows_(deal, productsByDeal[deal.id] || [], ctx)); });
    var group = eomGroupForReport_(rows);
    var meta = {
      current: true, stageId: String(CURRENT_STAGE_ID), stageName: stageName,
      monthLabel: 'Current — EOM Merge',
      generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss'),
      orgCount: group.length, dealCount: deals.length,
      dealBaseUrl: 'https://' + s.domain + '.pipedrive.com/deal/',
      splitContacts: false
    };
    return { ok: true, json: JSON.stringify({ group: group, meta: meta }) };
  } catch (e) {
    return { ok: false, error: 'Current pull failed: ' + e.message };
  }
}
