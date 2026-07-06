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
 *    owner's authority. Therefore the public surface is EXACTLY FOUR functions:
 *    doGet, getViewerBootstrap, getReportJson, getCurrentReport. Everything else
 *    is `_`-suffixed. The archive endpoints expose PUBLISHED rows only and NEVER
 *    return file ids or Drive/spreadsheet URLs (those are owner-only artifacts).
 *    getCurrentReport is a READ-ONLY Pipedrive pull (GETs only) of the EOM Merge
 *    stage — the same data class the published reports already expose; it never
 *    returns the token or any Pipedrive URL beyond the deal links.
 *  - EOM_VIEWER_ALLOWED (below) optionally narrows access to specific emails.
 *
 * SETUP / DEPLOY RUNBOOK:
 *  1. script.google.com → New project. Copy its Script ID into eom-viewer/.clasp.json.
 *  2. Paste the SF_EOM_REPORTS id (logged by setupEomReportsIndex) into INDEX_SHEET_ID.
 *  3. From INSIDE eom-viewer/:  clasp push
 *  4. Deploy → New deployment → Web app: Execute as = Me, Who has access = <domain>.
 *     Authorize (Drive read + Sheets). Share the /exec URL (NOT the /dev URL —
 *     /dev runs as the accessor and needs editor access).
 *  5. Bookmark the /exec URL. Code updates: Deploy -> Manage deployments -> Edit
 *     -> New version (keeps the same URL). NEVER "New deployment" (new URL).
 *  6. CURRENT-REPORT PULL (optional): Project Settings → Script properties → add
 *     PD_API_TOKEN + PD_COMPANY_DOMAIN (same values as the main app's). The
 *     "Current" sidebar section only appears once both are set. First use of
 *     UrlFetchApp adds the external-request scope → re-authorize on next deploy.
 *
 * EomReportRenderer.html is a BYTE-COPY of the main app's file — keep them
 * identical (a checksum drift check guards this in the repo's Node self-checks).
 */

// ── Connection: data by ID only (paste the SF_EOM_REPORTS id here) ──
var INDEX_SHEET_ID = '1p28o2IbGFrHOqKVs_DUpAtyzM6LFYyAKUpsBB7NwFxg';       // <-- paste the id logged by setupEomReportsIndex()
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
    .setTitle('Silver Fox — EOM Reports')
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
  var sh = openIndex_();
  if (!sh) return { ok: true, reports: [], current: current };
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
  return { ok: true, reports: out, current: current };
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
// UrlFetchApp GET with the token from THIS project's Script Properties.
// ════════════════════════════════════════════════════════════════════════════

/** Pipedrive credentials from THIS project's Script Properties (never the repo).
 *  Null until PD_API_TOKEN + PD_COMPANY_DOMAIN are set — the Current section
 *  stays hidden in the viewer until then. */
function cvSecrets_() {
  var p = PropertiesService.getScriptProperties();
  var token = (p.getProperty('PD_API_TOKEN') || '').trim();
  var domain = (p.getProperty('PD_COMPANY_DOMAIN') || '').trim()
    .replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/, '').replace(/\/.*$/, '');
  if (!token || !domain) return null;
  return { token: token, domain: domain, baseV1: 'https://' + domain + '.pipedrive.com/api/v1' };
}

/** GET a v1 url -> parsed body, or null on any error (never throws). */
function cvGetJson_(url) {
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    return JSON.parse(resp.getContentText());
  } catch (e) { return null; }
}

/** GET a v1 collection, following start/limit pagination (mirrors pdListAllV1_). */
function cvListAllV1_(s, path) {
  var out = [], start = 0, guard = 0;
  while (guard++ < 40) {
    var sep = (path.indexOf('?') === -1) ? '?' : '&';
    var body = cvGetJson_(s.baseV1 + path + sep + 'start=' + start + '&limit=500&api_token=' + encodeURIComponent(s.token));
    if (!body || !body.data) break;
    out = out.concat(body.data);
    var pg = body.additional_data && body.additional_data.pagination;
    if (pg && pg.more_items_in_collection && pg.next_start != null) start = pg.next_start;
    else break;
  }
  return out;
}

/** Products for many deals in ONE parallel batch (mirrors pdEomFetchProductsForDeals_).
 *  Never throws — a failed deal yields an empty product list. */
function cvFetchProductsForDeals_(s, dealIds) {
  var out = {};
  var requests = dealIds.map(function (id) {
    return {
      url: s.baseV1 + '/deals/' + id + '/products?include_product_data=1&api_token=' + encodeURIComponent(s.token),
      muteHttpExceptions: true
    };
  });
  var responses;
  try { responses = UrlFetchApp.fetchAll(requests); }
  catch (e) { dealIds.forEach(function (id) { out[id] = []; }); return out; }
  responses.forEach(function (resp, i) {
    var id = dealIds[i];
    try {
      if (resp.getResponseCode() !== 200) { out[id] = []; return; }
      var body = JSON.parse(resp.getContentText());
      out[id] = body.data || [];
    } catch (e) { out[id] = []; }
  });
  return out;
}

/** The 40-char key of the "Duplicates" custom deal field ('' if none). */
function cvDuplicatesFieldKey_(s) {
  var key = '';
  cvListAllV1_(s, '/dealFields').forEach(function (f) { if (f.name === 'Duplicates' && f.key) key = f.key; });
  return key;
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
function eomResolveName_(obj) { return eomIsObj_(obj) ? (obj.name || '') : ''; }
function eomVariationName_(product, variationId) {
  if (!variationId || !product) return '';
  var vars = product.product_variations || [];
  for (var i = 0; i < vars.length; i++) { if (vars[i].id === variationId) return vars[i].name || ''; }
  return '';
}

/** One deal (+ its products) → flat rows in EOM_COLUMNS order. Copy of the main
 *  app's eomBuildRows_ with two viewer-local deviations: dupKey is a parameter
 *  (no per-execution cache), and pipeline/stage names are '' — the renderer
 *  never reads them and blanking them saves two API calls per pull. */
function cvBuildRows_(deal, products, dupKey) {
  var dupVal = dupKey ? deal[dupKey] : '';
  if (dupVal == null) dupVal = '';
  var base = {
    processed_at: new Date().toISOString(),
    deal_id: deal.id,
    deal_title: deal.title || '',
    deal_created_at: deal.add_time || '',
    org_name: eomResolveName_(deal.org_id),
    person_name: eomResolveName_(deal.person_id),
    deal_owner: eomResolveName_(deal.user_id),
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
    var catalog = dp.product || {};
    var pr = Object.assign({}, base, {
      product_id: dp.product_id,
      product_code: catalog.code || '',
      product_name: dp.name || '',
      product_description: eomCleanHtml_(catalog.description || ''),
      product_tax_percent: catalog.tax != null ? catalog.tax : '',
      deal_tax_percent: dp.tax != null ? dp.tax : '',
      variation: eomVariationName_(catalog, dp.product_variation_id),
      quantity: dp.quantity != null ? dp.quantity : '',
      item_price: dp.item_price != null ? dp.item_price : '',
      discount: dp.discount != null ? dp.discount : '',
      sum: dp.sum != null ? dp.sum : '',
      billing_frequency: dp.billing_frequency || '',
      billing_start_date: dp.billing_start_date || '',
      product_notes: eomCleanHtml_(dp.comments || ''),
      product_added_at: dp.add_time || '',
      product_last_edited: dp.last_edit || ''
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
        dealMap[id].lines.push({ code: String(r[C.product_code] || '').trim(), name: String(r[C.product_name] || '').trim(), vari: String(r[C.variation] || '').trim(), qty: Number(r[C.quantity]) || 0, price: Number(r[C.item_price]) || 0, sum: Number(r[C.sum]) || 0, desc: String(r[C.product_description] || '').trim(), notes: String(r[C.product_notes] || '').trim() });
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
    try {
      var probe = UrlFetchApp.fetch(s.baseV1 + '/users/me?api_token=' + encodeURIComponent(s.token), { muteHttpExceptions: true });
      me = (probe.getResponseCode() === 200) ? JSON.parse(probe.getContentText()) : null;
    } catch (e) {
      return { ok: false, error: 'The viewer script is not authorized for external requests yet — open the script editor, run getCurrentReport once from the toolbar, and approve the prompt. (' + e.message + ')' };
    }
    if (!me || me.success === false || !me.data) {
      return { ok: false, error: 'Pipedrive rejected the viewer credentials — re-check PD_API_TOKEN and PD_COMPANY_DOMAIN in the viewer project’s Script Properties.' };
    }
    var deals = cvListAllV1_(s, '/deals?stage_id=' + CURRENT_STAGE_ID + '&status=all_not_deleted');
    // Stage name echo: if CURRENT_STAGE_ID ever stops being "EOM Merge", the UI
    // says which stage it actually pulled instead of lying about EOM Merge.
    var st = cvGetJson_(s.baseV1 + '/stages/' + CURRENT_STAGE_ID + '?api_token=' + encodeURIComponent(s.token));
    var stageName = (st && st.data && st.data.name) ? st.data.name : '';
    var dupKey = deals.length ? cvDuplicatesFieldKey_(s) : '';
    var rows = [], CHUNK = 100;
    for (var i = 0; i < deals.length; i += CHUNK) {
      var batch = deals.slice(i, i + CHUNK);
      var productsByDeal = cvFetchProductsForDeals_(s, batch.map(function (d) { return d.id; }));
      batch.forEach(function (deal) { rows = rows.concat(cvBuildRows_(deal, productsByDeal[deal.id] || [], dupKey)); });
      if (i + CHUNK < deals.length) Utilities.sleep(800);
    }
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
