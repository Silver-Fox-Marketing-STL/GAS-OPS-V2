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
 *    owner's authority. Therefore the public surface is EXACTLY THREE functions:
 *    doGet, getViewerBootstrap, getReportJson. Everything else is `_`-suffixed.
 *    Both data endpoints expose PUBLISHED rows only and NEVER return file ids or
 *    Drive/spreadsheet URLs (those are owner-only artifacts).
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
 *
 * EomReportRenderer.html is a BYTE-COPY of the main app's file — keep them
 * identical (a checksum drift check guards this in the repo's Node self-checks).
 */

// ── Connection: data by ID only (paste the SF_EOM_REPORTS id here) ──
var INDEX_SHEET_ID = '';       // <-- paste the id logged by setupEomReportsIndex()
var INDEX_TAB = 'REPORTS';
// 0-based column map — MUST match the main app's EOMIDX.
var IDX = { MONTH_KEY: 0, MONTH_LABEL: 1, SCOPE: 2, STAGE_ID: 3, GENERATED_AT: 4,
  JSON_FILE_ID: 5, FOLDER_URL: 6, SS_URL: 7, ORG_COUNT: 8, DEAL_COUNT: 9, STATUS: 10,
  PUBLISHED_AT: 11, PUBLISHED_BY: 12, PUBLISHED_JSON_FILE_ID: 13 };
// Empty = any domain user may view. Add work emails to restrict further.
var EOM_VIEWER_ALLOWED = [];

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

/** Published months only, display fields only (never file ids or Drive urls). */
function getViewerBootstrap() {
  if (!viewerAllowed_()) return { ok: false, error: 'Not authorized.' };
  var sh = openIndex_();
  if (!sh) return { ok: true, reports: [] };
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
  return { ok: true, reports: out };
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
