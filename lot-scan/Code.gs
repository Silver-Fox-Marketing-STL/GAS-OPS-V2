// ============================================================================
// SILVERFOX LOT SCANNER — standalone on-lot VIN photo capture/batch/send tool
// ----------------------------------------------------------------------------
// A SEPARATE Apps Script project (its own web-app deployment + scopes). It does
// NOT share code with the main SilverFox app at runtime — it CONNECTS by sharing
// DATA BY ID: it reads the same dealer config + scraper inventory and writes
// submissions to a dedicated SF_LOT_SUBMISSIONS sheet + a Drive photos folder
// that the main app's "VIN Inbox" view reads. The reused helpers below are
// deliberate copies (Apps Script has no good cross-project import).
//
// SCOPE: capture / upload / batch / dealer / send ONLY. OCR is office-side —
// the main app's VIN Inbox runs it on demand (runInboxOcr, Code.gs Section 32).
// This project used to run OCR itself via a per-user time trigger
// (drainOcrQueue); that stalled in the field (batches sent to the office before
// OCR drained sat at ocr_state='queued' forever) and installed per-user
// triggers/scopes, so the trigger machinery was removed. Client-side barcode
// scanning (ZXing) still rides along per item in commitQueuedBatch — a photo
// whose barcode already decoded a VIN skips OCR entirely (ocr_state='done'
// straight away, field-proven); everything else lands ocr_state='queued', which
// is now simply the office's signal to run OCR after the batch is sent. The old
// synchronous-OCR real-time-camera path (submitVinPhoto) is retired behind a
// deprecation stub so a stale cached client fails LOUDLY instead of silently.
//
// FIRST-TIME SETUP: run setupLotScannerResources() once from the editor, paste the
// two logged IDs into the constants below (+ the sheet id into the main app).
// ============================================================================


// ── Shared data (same IDs the main app uses; read-only here) ──
var MASTER_SHEET_ID = '1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes';  // SF_SYSTEM_MASTER (SCRAPERDATA)
var CONFIG_SHEET_ID = '1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8';  // SF_DEALER_CONFIG (DEALERS)

// ── Lot-scanner-owned data (created by setupLotScannerResources()). Paste the
//    logged IDs here; also paste LOT_SUBMISSIONS_SHEET_ID into the MAIN app. ──
var LOT_SUBMISSIONS_SHEET_ID = '1zs-Ycj64LTwIYJt84kC_-qY_EhsWgB1Pa5pQlsG-N1M';   // SF_LOT_SUBMISSIONS spreadsheet
var LOT_PHOTOS_FOLDER_ID     = '190dyWuBX8pf3ldP7iGwMnbqZJSllIYKH';   // "SF Lot Submissions" Drive folder

var LOT_SUBMISSIONS_TAB = 'SUBMISSIONS';
// One row per photo. Flat / long / SQL-portable. KEEP IN SYNC with the main app reader.
// status = human lifecycle: draft | submitted | processed | discarded.
// ocr_state = OCR progress: queued | done | failed.
var LOT_SUBMISSION_COLS = [
  'submission_id', 'submission_ts', 'submitter_email', 'dealer_key', 'dealer_name',
  'photo_file_id', 'photo_url', 'vin_extracted', 'vin_final', 'vin_valid', 'matched',
  'year', 'make', 'model', 'type', 'stock', 'status', 'processed_ts', 'processed_by', 'notes',
  'batch_id', 'ocr_state'
];
// 0-based column map (matches LOT_SUBMISSION_COLS order).
var LOTC = {
  ID: 0, TS: 1, EMAIL: 2, DEALER_KEY: 3, DEALER_NAME: 4, PHOTO_ID: 5, PHOTO_URL: 6,
  VIN_EXTRACTED: 7, VIN_FINAL: 8, VALID: 9, MATCHED: 10, YEAR: 11, MAKE: 12, MODEL: 13,
  TYPE: 14, STOCK: 15, STATUS: 16, PROCESSED_TS: 17, PROCESSED_BY: 18, NOTES: 19,
  BATCH_ID: 20, OCR_STATE: 21
};

// DEALERS column indices (subset copied from the main app's CFG).
var CFG = { KEY: 0, NAME: 1, SCRAPER_LOCATION: 9, ACTIVE: 11 };


// ── per-execution opens (copied from the main app) ──
var _masterSS_ = null, _configSS_ = null;
function getMasterSS_() { if (!_masterSS_) _masterSS_ = SpreadsheetApp.openById(MASTER_SHEET_ID); return _masterSS_; }
function getConfigSS_() { if (!_configSS_) _configSS_ = SpreadsheetApp.openById(CONFIG_SHEET_ID); return _configSS_; }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function getActiveEmail_() { try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } }


// ============================================================================
// WEB-APP ENTRY
// ============================================================================
function include_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function doGet(e) {
  return HtmlService.createTemplateFromFile('Capture').evaluate()
    .setTitle('SilverFox Lot Scan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}


// ============================================================================
// BOOTSTRAP — active dealers + last-used dealer
// ============================================================================
function getCaptureBootstrap() {
  return { dealers: getActiveDealersForScanner_(), lastDealer: getLastSelectedDealer() };
}

function getActiveDealersForScanner_() {
  var data = getConfigSS_().getSheetByName('DEALERS').getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (isTrue_(data[i][CFG.ACTIVE])) out.push({ key: data[i][CFG.KEY], name: data[i][CFG.NAME] });
  }
  return out;
}

function getLastSelectedDealer() {
  return PropertiesService.getUserProperties().getProperty('lot_last_dealer') || '';
}
function saveLastSelectedDealer(dealerKey) {
  if (dealerKey && String(dealerKey).trim() !== '') {
    PropertiesService.getUserProperties().setProperty('lot_last_dealer', String(dealerKey).trim());
  }
}


// ============================================================================
// DEALER-SCOPED VIN MAP (copied readers; fixed 21-col read — the scanner only
// needs the base columns, so it skips the main app's dynamic-schema machinery)
// ============================================================================
function getDealerConfig_(dealerKey) {
  var data = getConfigSS_().getSheetByName('DEALERS').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (data[i][CFG.KEY] === dealerKey) return data[i];
  return null;
}

function getDealerScraperData_(loc) {
  var sheet = getMasterSS_().getSheetByName('SCRAPERDATA');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var locCol = sheet.getRange(2, 20, lastRow - 1, 1).getValues();   // col T (index 19) = Location
  var first = -1, last = -1;
  for (var i = 0; i < locCol.length; i++) {
    if (String(locCol[i][0]).trim() === loc) { if (first === -1) first = i; last = i; }
  }
  if (first === -1) return [];
  var data = sheet.getRange(first + 2, 1, last - first + 1, 21).getValues();   // base 21 cols A–U
  return data.filter(function(r) { return String(r[19]).trim() === loc; });
}

function buildVinDataMap_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], vin = String(r[0] == null ? '' : r[0]).trim();
    if (vin === '' || vin === '*') continue;
    map[vin.toUpperCase()] = {
      year:  String(r[3] == null ? '' : r[3]).trim(),
      make:  String(r[4] == null ? '' : r[4]).trim(),
      model: String(r[5] == null ? '' : r[5]).trim(),
      type:  String(r[2] == null ? '' : r[2]).trim(),
      stock: String(r[1] == null ? '' : r[1]).trim(),
      status: String(r[8] == null ? '' : r[8]).trim()
    };
  }
  return map;
}

// Client-callable: dealer-scoped VIN→data map (cached client-side for instant
// match feedback). Fail-safe {} on any error.
function getDealerVinMap(dealerKey) {
  try {
    var c = getDealerConfig_(dealerKey); if (!c) return {};
    var loc = c[CFG.SCRAPER_LOCATION]; if (!loc) return {};
    return buildVinDataMap_(getDealerScraperData_(loc) || []);
  } catch (e) {
    Logger.log('getDealerVinMap ' + dealerKey + ': ' + e.message);
    return {};
  }
}


// ============================================================================
// VIN VALIDATION (ISO 3779) — pure. The check digit is the reliability lever:
// it rejects almost every OCR misread, and drives the confusion-repair below.
// ============================================================================
var VIN_TRANSLIT = {
  A:1, B:2, C:3, D:4, E:5, F:6, G:7, H:8, J:1, K:2, L:3, M:4, N:5, P:7, R:9,
  S:2, T:3, U:4, V:5, W:6, X:7, Y:8, Z:9,
  '0':0, '1':1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9
};
var VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function vinCheckDigit_(vin) {
  var sum = 0;
  for (var i = 0; i < 17; i++) {
    var v = VIN_TRANSLIT[vin.charAt(i)];
    if (v === undefined) return null;
    sum += v * VIN_WEIGHTS[i];
  }
  var r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

function isValidVin_(vin) {
  if (typeof vin !== 'string') return false;
  vin = vin.toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;   // exactly 17, no I/O/Q
  var cd = vinCheckDigit_(vin);
  return cd !== null && vin.charAt(8) === cd;
}

// ============================================================================
// VIN CORRECTION — re-validate + re-match a human-typed VIN against an existing
// submission row (drafts "Re-check" and any future VIN Inbox correction UI).
// Fail-soft (returns a result object, never throws).
// ============================================================================
function correctSubmissionVin(submissionId, dealerKey, vin) {
  try {
    var corrected = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var validC = isValidVin_(corrected);
    var vehC = corrected ? (getDealerVinMap(dealerKey)[corrected] || null) : null;
    updateLotSubmissionVin_(submissionId, corrected, validC, !!vehC, vehC);
    return { ok: true, submissionId: submissionId, vin: corrected, valid: validC, matched: !!vehC, vehicle: vehC };
  } catch (e) {
    Logger.log('correctSubmissionVin failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// TEMP: deprecation stub — remove after scanner prod repoint (plan Phase 3).
// The synchronous-OCR real-time-camera path is retired. THROWS (not {ok:false}):
// 2 of the 3 legacy call sites never check res.ok, so a returned error object
// produced a false "Saved."/"Updated." success. Throwing routes to each caller's
// withFailureHandler — all three legacy paths register one (camera result panel,
// vpCommitEdit's "Save failed" toast, vpDraftRecheck's "Failed" toast), so every
// stale cached client gets a VISIBLE error.
function submitVinPhoto() {
  throw new Error('Old app version — pull down to refresh the page.');
}

// Delete a submission + trash its photo (real-time "Retake", or a draft discard).
function discardSubmission(submissionId) {
  try {
    var sh = getOrCreateLotSubmissionsSheet_();
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][LOTC.ID]) === String(submissionId)) {
        var fileId = String(data[i][LOTC.PHOTO_ID] || '');
        if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
        sh.deleteRow(i + 1);
        return { ok: true };
      }
    }
    return { ok: false, error: 'not found' };
  } catch (e) {
    Logger.log('discardSubmission failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}


// ============================================================================
// BATCH — fast parallel upload + serial chunked commit. No OCR here — rows
// without a barcode VIN land ocr_state='queued', which is the office's signal
// to run OCR (VIN Inbox → runInboxOcr, main Code.gs Section 32) after send.
// ============================================================================

// Batch step 1 (PARALLEL): save the photo to Drive only — NO sheet write, NO OCR.
// Independent files, so it parallelizes safely. Returns the Drive id for the commit step.
function uploadPhotoOnly(dealerKey, base64Image) {
  try {
    var config = getDealerConfig_(dealerKey);
    if (!config) return { ok: false, error: 'Unknown dealer.' };
    var dealerName = String(config[CFG.NAME] || dealerKey);
    var b64 = String(base64Image || '').replace(/^data:[^,]*,/, '');
    if (!b64) return { ok: false, error: 'No image received.' };
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg',
                 'lotvin_' + dealerKey + '_' + new Date().getTime() + '.jpg');
    var saved = saveBlobToDrive_(dealerName, blob);
    if (!saved.fileId) return { ok: false, error: 'Could not save photo.' };
    return { ok: true, fileId: saved.fileId, url: saved.url };
  } catch (e) {
    Logger.log('uploadPhotoOnly failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// Batch step 2 (SERIAL, chunked): write N queued draft rows in ONE execution via a single
// setValues under a brief lock. The client sends chunks one-at-a-time, so there are no
// concurrent appends — this is what makes a 50-photo batch land EVERY row (no loss).
// Sheet is opened INSIDE the lock so it reads the CURRENT last row (opening outside the
// lock cached a stale last row → concurrent appends overwrote each other → lost rows).
// Each item may carry a client-side (ZXing) barcode `vin` — when present it skips
// OCR entirely (validated + matched here, ocr_state='done' straight away); items without
// a vin keep today's behavior (blank VIN cols, ocr_state='queued' — office runs OCR later).
// IDEMPOTENT: if a commit succeeds but the response is lost, the client retries the same
// items — items whose fileId (unique per upload) already has a row are skipped, not
// re-inserted. The dedupe read happens INSIDE the lock so it can't race another commit.
function commitQueuedBatch(dealerKey, batchId, items) {
  try {
    if (!items || !items.length) return { ok: true, committed: 0, skipped: 0 };
    var config = getDealerConfig_(dealerKey);
    if (!config) return { ok: false, error: 'Unknown dealer.' };
    var dealerName = String(config[CFG.NAME] || dealerKey);
    saveLastSelectedDealer(dealerKey);
    var email = getActiveEmail_();
    var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');

    var vinMap = null;   // built once (outside the lock — it's the slow part), only if needed
    var hasVin = items.some(function (it) { return it && it.vin; });
    if (hasVin) vinMap = getDealerVinMap(dealerKey);

    function buildRow(it) {
      var vin = it && it.vin ? String(it.vin).toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
      if (!vin) {
        return [
          Utilities.getUuid(), ts, email, dealerKey, dealerName,
          (it && it.fileId) || '', (it && it.url) || '', '', '', 'FALSE', 'FALSE',
          '', '', '', '', '', 'draft', '', '', '', batchId || '', 'queued'
        ];
      }
      var valid = isValidVin_(vin);
      var v = valid ? (vinMap[vin] || null) : null;
      return [
        Utilities.getUuid(), ts, email, dealerKey, dealerName,
        (it && it.fileId) || '', (it && it.url) || '', vin, vin, valid ? 'TRUE' : 'FALSE', v ? 'TRUE' : 'FALSE',
        (v && v.year) || '', (v && v.make) || '', (v && v.model) || '', (v && v.type) || '', (v && v.stock) || '',
        'draft', '', '', '', batchId || '', 'done'
      ];
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(45000)) return { ok: false, error: 'busy' };
    try {
      var sh = getOrCreateLotSubmissionsSheet_();   // fresh read of the last row
      // Dedupe by photo_file_id — one single-column read, not the full sheet.
      var last = sh.getLastRow();
      var existing = {};
      if (last > 1) {
        sh.getRange(2, LOTC.PHOTO_ID + 1, last - 1, 1).getValues().forEach(function (r) {
          if (r[0]) existing[String(r[0])] = true;
        });
      }
      var fresh = items.filter(function (it) { return !(it && it.fileId && existing[String(it.fileId)]); });
      var skipped = items.length - fresh.length;
      if (!fresh.length) return { ok: true, committed: 0, skipped: skipped };
      var rows = fresh.map(buildRow);
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      SpreadsheetApp.flush();
      return { ok: true, committed: rows.length, skipped: skipped };
    } finally { try { lock.releaseLock(); } catch (eR) {} }
  } catch (e) {
    Logger.log('commitQueuedBatch failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ============================================================================
// DRAFTS — the submitter's own un-sent (status=draft) rows, grouped by batch.
// ============================================================================
function getMyDrafts() {
  try {
    var me = getActiveEmail_();
    var sh = getOrCreateLotSubmissionsSheet_();
    var data = sh.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (String(r[LOTC.EMAIL]) !== me) continue;
      if (String(r[LOTC.STATUS]) !== 'draft') continue;
      out.push({
        id: String(r[LOTC.ID]), batchId: String(r[LOTC.BATCH_ID] || ''),
        dealerKey: String(r[LOTC.DEALER_KEY] || ''), dealerName: String(r[LOTC.DEALER_NAME] || ''),
        photoUrl: String(r[LOTC.PHOTO_URL] || ''), photoFileId: String(r[LOTC.PHOTO_ID] || ''),
        vin: String(r[LOTC.VIN_FINAL] || ''), valid: isTrue_(r[LOTC.VALID]), matched: isTrue_(r[LOTC.MATCHED]),
        year: String(r[LOTC.YEAR] || ''), make: String(r[LOTC.MAKE] || ''), model: String(r[LOTC.MODEL] || ''),
        type: String(r[LOTC.TYPE] || ''), stock: String(r[LOTC.STOCK] || ''),
        ocrState: String(r[LOTC.OCR_STATE] || ''), ts: String(r[LOTC.TS] || '')
      });
    }
    return { ok: true, drafts: out };
  } catch (e) {
    Logger.log('getMyDrafts failed: ' + e.message);
    return { ok: false, drafts: [], error: e.message };
  }
}

// Delete a whole draft batch — trash every photo + remove every row (this user's drafts
// in that batch). Bottom-up row deletion keeps indices valid.
function discardBatch(batchId) {
  try {
    var me = getActiveEmail_();
    var sh = getOrCreateLotSubmissionsSheet_();
    var data = sh.getDataRange().getValues();
    var rowsToDelete = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][LOTC.EMAIL]) !== me) continue;
      if (String(data[i][LOTC.BATCH_ID]) !== String(batchId)) continue;
      if (String(data[i][LOTC.STATUS]) !== 'draft') continue;
      var fileId = String(data[i][LOTC.PHOTO_ID] || '');
      if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
      rowsToDelete.push(i + 1);
    }
    for (var j = rowsToDelete.length - 1; j >= 0; j--) sh.deleteRow(rowsToDelete[j]);
    return { ok: true, deleted: rowsToDelete.length };
  } catch (e) {
    Logger.log('discardBatch failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// Field "Send to office" — flip this user's draft rows in a batch to submitted.
function sendDraftBatch(batchId) {
  try {
    var me = getActiveEmail_();
    var sh = getOrCreateLotSubmissionsSheet_();
    var data = sh.getDataRange().getValues();
    var n = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][LOTC.EMAIL]) !== me) continue;
      if (String(data[i][LOTC.BATCH_ID]) !== String(batchId)) continue;
      if (String(data[i][LOTC.STATUS]) !== 'draft') continue;
      sh.getRange(i + 1, LOTC.STATUS + 1).setValue('submitted');
      n++;
    }
    return { ok: true, sent: n };
  } catch (e) {
    Logger.log('sendDraftBatch failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}


// ============================================================================
// DRIVE PHOTOS + SUBMISSIONS SHEET
// ============================================================================
function getDealerPhotoFolder_(dealerName) {
  var root = DriveApp.getFolderById(lotPhotosFolderId_());
  var safe = String(dealerName).replace(/[\/\\:*?"<>|]/g, '_').trim() || 'Unknown';
  var it = root.getFoldersByName(safe);
  return it.hasNext() ? it.next() : root.createFolder(safe);
}

// Save an image blob to the dealer's subfolder. Own try/catch — never blocks OCR.
function saveBlobToDrive_(dealerName, blob) {
  try {
    var file = getDealerPhotoFolder_(dealerName).createFile(blob);
    var id = file.getId();
    return { fileId: id, url: 'https://drive.google.com/file/d/' + id + '/view' };
  } catch (e) {
    Logger.log('saveBlobToDrive_ failed (non-fatal): ' + e.message);
    return { fileId: '', url: '' };
  }
}

function lotSubmissionsSheetId_() {
  var id = LOT_SUBMISSIONS_SHEET_ID ||
           PropertiesService.getScriptProperties().getProperty('LOT_SUBMISSIONS_SHEET_ID') || '';
  if (!id) throw new Error('LOT_SUBMISSIONS_SHEET_ID not set — run setupLotScannerResources() once.');
  return id;
}
function lotPhotosFolderId_() {
  var id = LOT_PHOTOS_FOLDER_ID ||
           PropertiesService.getScriptProperties().getProperty('LOT_PHOTOS_FOLDER_ID') || '';
  if (!id) throw new Error('LOT_PHOTOS_FOLDER_ID not set — run setupLotScannerResources() once.');
  return id;
}

function getOrCreateLotSubmissionsSheet_() {
  var ss = SpreadsheetApp.openById(lotSubmissionsSheetId_());
  var sh = ss.getSheetByName(LOT_SUBMISSIONS_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOT_SUBMISSIONS_TAB);
    sh.getRange(1, 1, 1, LOT_SUBMISSION_COLS.length).setValues([LOT_SUBMISSION_COLS]);
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < LOT_SUBMISSION_COLS.length) {
    // Upgrade an older (20-col) header to include batch_id / ocr_state.
    sh.getRange(1, 1, 1, LOT_SUBMISSION_COLS.length).setValues([LOT_SUBMISSION_COLS]);
  }
  return sh;
}

// Returns a submission photo as a data URL — bytes fetched server-side, which is reliable
// in the web-app sandbox where a drive.google.com thumbnail URL often won't load.
function getPhotoDataUrl(fileId) {
  try {
    if (!fileId) return { ok: false, error: 'no id' };
    var blob = DriveApp.getFileById(fileId).getBlob();
    return { ok: true, dataUrl: 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Update a row's VIN + match columns after a human correction (cols 8–16), and
// mark OCR resolved.
function updateLotSubmissionVin_(submissionId, vin, valid, matched, vehicle) {
  var sh = getOrCreateLotSubmissionsSheet_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][LOTC.ID]) === String(submissionId)) {
      var v = vehicle || {};
      // cols 9..16 (1-based) = vin_final, vin_valid, matched, year, make, model, type, stock
      sh.getRange(i + 1, LOTC.VIN_FINAL + 1, 1, 8).setValues([[
        vin, valid ? 'TRUE' : 'FALSE', matched ? 'TRUE' : 'FALSE',
        v.year || '', v.make || '', v.model || '', v.type || '', v.stock || ''
      ]]);
      sh.getRange(i + 1, LOTC.OCR_STATE + 1).setValue('done');   // human resolved
      return true;
    }
  }
  return false;
}


// ============================================================================
// ONE-TIME SETUP — creates the photos folder + submissions sheet, saves their
// IDs to ScriptProperties (so this app works immediately), and logs them.
// Paste LOT_SUBMISSIONS_SHEET_ID into the MAIN app's inbox constant, then move
// both into the Claude Sandbox Drive folder and share with the lot crew.
// ============================================================================
function setupLotScannerResources() {
  var props = PropertiesService.getScriptProperties();

  var folderId = LOT_PHOTOS_FOLDER_ID || props.getProperty('LOT_PHOTOS_FOLDER_ID');
  if (!folderId) {
    folderId = DriveApp.createFolder('SF Lot Submissions').getId();
    props.setProperty('LOT_PHOTOS_FOLDER_ID', folderId);
  }

  var sheetId = LOT_SUBMISSIONS_SHEET_ID || props.getProperty('LOT_SUBMISSIONS_SHEET_ID');
  if (!sheetId) {
    var ss = SpreadsheetApp.create('SF_LOT_SUBMISSIONS');
    var sh = ss.getSheets()[0];
    sh.setName(LOT_SUBMISSIONS_TAB);
    sh.getRange(1, 1, 1, LOT_SUBMISSION_COLS.length).setValues([LOT_SUBMISSION_COLS]);
    sh.setFrozenRows(1);
    sheetId = ss.getId();
    props.setProperty('LOT_SUBMISSIONS_SHEET_ID', sheetId);
  }

  var msg = 'Lot scanner resources ready.\n\n' +
            'LOT_PHOTOS_FOLDER_ID     = ' + folderId + '\n' +
            'LOT_SUBMISSIONS_SHEET_ID = ' + sheetId + '\n\n' +
            'Paste LOT_SUBMISSIONS_SHEET_ID into the MAIN app inbox constant, move both ' +
            'into the Claude Sandbox folder, and share with the lot crew.';
  Logger.log(msg);
  return msg;
}
