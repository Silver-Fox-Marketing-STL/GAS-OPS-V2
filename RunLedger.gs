// ============================================================================
// RUN LEDGER — the one owner of RUN_LOG rows and SF_VIN_LOGS batches.
// ============================================================================
// Vocabulary: GLOSSARY.md (run, run ledger, run fingerprint, batch, commit,
// rollback, manual entry). Why identity + batches are shaped this way:
// docs/adr/0001-run-identity-and-vin-log-batches.md.
//
// Shape:
//   - CODEC (pure): one place that knows the RUN_LOG column layout (A–W, 23
//     cols) and the VIN-log layout (A–E, 5 cols), the status vocabulary, test-
//     run detection, the SPLIT: group note, the produced-VINs CSV, and the run
//     fingerprint / run_ref tag. Nothing outside this file should index a
//     RUN_LOG or VIN-log row by number.
//   - STORE SEAM: everything the ledger does to the two books goes through a
//     store object. rlSheetStore_() is the real adapter (Sheets + LockService);
//     test/ledger-fake-store.js is the in-memory adapter the harness plugs in.
//     Ledger internals take the store as their first argument; the public
//     google.script.run endpoints (steps 2–3) are one-line wrappers that pass
//     rlSheetStore_().
//
// Load order: this file defines only functions and literal constants, so it
// does not depend on Code.gs being evaluated first (Apps Script's flat
// namespace resolves cross-file names at call time).
//
// Build status (feat/run-ledger): steps 1–2 = codec, store seam, and the
// guarded commit / rollback / delete / manual entry the views call. Finalize
// (step 3) and the remaining RUN_LOG readers (step 4) move in next.
// ============================================================================

// ── RUN_LOG layout (0-based indices into a getValues() row) ────────────────
var RL_COL = {
  TIMESTAMP:      0,   // A run_timestamp
  DEALER_KEY:     1,   // B dealer_key
  DEALER_NAME:    2,   // C dealer_name
  DEAL_ID:        3,   // D order_id (Pipedrive deal id; 'test' = test run)
  TOTAL_ORDERED:  4,   // E
  TOTAL_MATCHED:  5,   // F
  TOTAL_NEW:      6,   // G  ┐
  TOTAL_PO:       7,   // H  │ canonical-four per-type counts —
  TOTAL_CPO:      8,   // I  │ never widened (new types go to
  TOTAL_CPO_EL:   9,   // J  │ ORDER_TYPE_STATS)
  NEW_DUPES:      10,  // K  │
  PO_DUPES:       11,  // L  │
  CPO_DUPES:      12,  // M  │
  CPO_EL_DUPES:   13,  // N  ┘
  TOTAL_DUPES:    14,  // O
  TOTAL_PRODUCED: 15,  // P
  QR_CODES:       16,  // Q qr_codes_generated
  OUTPUT_DOC_ID:  17,  // R
  DURATION_SEC:   18,  // S run_duration_sec
  ERRORS:         19,  // T
  NOTES:          20,  // U notes ('SPLIT:<GROUP>' on billing-split runs)
  PRODUCED_VINS:  21,  // V produced_vins (comma-separated)
  STATUS:         22   // W vin_log_status (blank = pending)
};
var RL_WIDTH = 23;

// Values stored in col W. A blank cell reads as PENDING.
var RL_STATUS = {
  PENDING:     'pending',
  COMMITTED:   'committed',
  ROLLED_BACK: 'rolled_back',
  DELETED:     'deleted'
};

// ── VIN-log tab layout (one tab per dealer_key in SF_VIN_LOGS) ──────────────
var VL_COL = {
  ORDER_ID:     0,  // A deal id / order number
  VIN:          1,  // B
  COMMITTED_AT: 2,  // C when the batch was committed
  ORDER_DATE:   3,  // D when the order happened (run time); blank on legacy rows
  RUN_REF:      4   // E which run the batch belongs to; 'manual' for manual entry; blank on legacy rows
};
var VL_WIDTH   = 5;
var VL_HEADERS = ['ORDER_ID', 'VIN', 'committed_at', 'order_date', 'run_ref'];
var VL_MANUAL_REF = 'manual';

var RL_TZ        = 'America/Chicago';
var RL_TS_FORMAT = 'yyyy-MM-dd HH:mm:ss';


// ============================================================================
// CODEC — pure
// ============================================================================

/** Canonical text for a sheet timestamp cell: Dates are formatted, text is trimmed. */
function rlFormatTs_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, RL_TZ, RL_TS_FORMAT);
  return String(v === null || v === undefined ? '' : v).trim();
}

/** True when a deal id marks a test run (exact 'test', any case — 'test2' is NOT a test). */
function rlIsTestDealId_(dealId) {
  return String(dealId === null || dealId === undefined ? '' : dealId).trim().toLowerCase() === 'test';
}

/** Billing group from the notes cell: 'SPLIT:sprinter' → 'SPRINTER'; anything else → 'PRIMARY'. */
function rlSplitGroup_(note) {
  var n = String(note || '').trim();
  return n.indexOf('SPLIT:') === 0 ? n.substring(6).trim().toUpperCase() : 'PRIMARY';
}

/** True when the notes cell marks one half of a billing-split run. */
function rlIsSplit_(note) {
  return String(note || '').trim().indexOf('SPLIT:') === 0;
}

/** Produced-VINs CSV → trimmed, non-empty list (order kept, case kept). */
function rlParseVinsCsv_(csv) {
  var s = String(csv === null || csv === undefined ? '' : csv).trim();
  if (!s) return [];
  return s.split(',').map(function (v) { return v.trim(); }).filter(function (v) { return v !== ''; });
}

/** Number-or-zero for the count columns (blank / text → 0). */
function rlNum_(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * One RUN_LOG row (a getValues() array) → a run record. rowIndex is the
 * 1-based sheet row. Short rows (fewer than 23 cells) decode with blanks.
 */
function rlDecodeRow_(row, rowIndex) {
  var r = row || [];
  function cell(i) { return r.length > i ? r[i] : ''; }
  function str(i)  { var v = cell(i); return String(v === null || v === undefined ? '' : v).trim(); }

  var note   = str(RL_COL.NOTES);
  var status = str(RL_COL.STATUS);
  var dealId = str(RL_COL.DEAL_ID);
  return {
    rowIndex:      rowIndex,
    timestamp:     rlFormatTs_(cell(RL_COL.TIMESTAMP)),
    dealerKey:     str(RL_COL.DEALER_KEY),
    dealerName:    str(RL_COL.DEALER_NAME),
    dealId:        dealId,
    isTest:        rlIsTestDealId_(dealId),
    totalOrdered:  rlNum_(cell(RL_COL.TOTAL_ORDERED)),
    totalMatched:  rlNum_(cell(RL_COL.TOTAL_MATCHED)),
    billing: {
      totalNew:   rlNum_(cell(RL_COL.TOTAL_NEW)),
      totalPO:    rlNum_(cell(RL_COL.TOTAL_PO)),
      totalCPO:   rlNum_(cell(RL_COL.TOTAL_CPO)),
      totalCPOEL: rlNum_(cell(RL_COL.TOTAL_CPO_EL)),
      newDupes:   rlNum_(cell(RL_COL.NEW_DUPES)),
      poDupes:    rlNum_(cell(RL_COL.PO_DUPES)),
      cpoDupes:   rlNum_(cell(RL_COL.CPO_DUPES)),
      cpoElDupes: rlNum_(cell(RL_COL.CPO_EL_DUPES)),
      totalDupes: rlNum_(cell(RL_COL.TOTAL_DUPES))
    },
    totalProduced: rlNum_(cell(RL_COL.TOTAL_PRODUCED)),
    qrCodes:       str(RL_COL.QR_CODES),
    outputDocId:   str(RL_COL.OUTPUT_DOC_ID),
    durationSec:   rlNum_(cell(RL_COL.DURATION_SEC)),
    errors:        str(RL_COL.ERRORS),
    note:          note,
    isSplit:       rlIsSplit_(note),
    group:         rlSplitGroup_(note),
    producedVins:  rlParseVinsCsv_(cell(RL_COL.PRODUCED_VINS)),
    status:        status || RL_STATUS.PENDING
  };
}

/**
 * A run record → a 23-cell RUN_LOG row, the exact layout writeRunLog_ appends.
 * `timestamp` must already be canonical text; status PENDING writes a blank W.
 */
function rlEncodeRecord_(rec) {
  var b   = rec.billing || {};
  var row = new Array(RL_WIDTH);
  row[RL_COL.TIMESTAMP]      = rec.timestamp || '';
  row[RL_COL.DEALER_KEY]     = rec.dealerKey || '';
  row[RL_COL.DEALER_NAME]    = rec.dealerName || '';
  row[RL_COL.DEAL_ID]        = rec.dealId || '';
  row[RL_COL.TOTAL_ORDERED]  = rec.totalOrdered;
  row[RL_COL.TOTAL_MATCHED]  = rec.totalMatched;
  row[RL_COL.TOTAL_NEW]      = b.totalNew   || 0;
  row[RL_COL.TOTAL_PO]       = b.totalPO    || 0;
  row[RL_COL.TOTAL_CPO]      = b.totalCPO   || 0;
  row[RL_COL.TOTAL_CPO_EL]   = b.totalCPOEL || 0;
  row[RL_COL.NEW_DUPES]      = b.newDupes   || 0;
  row[RL_COL.PO_DUPES]       = b.poDupes    || 0;
  row[RL_COL.CPO_DUPES]      = b.cpoDupes   || 0;
  row[RL_COL.CPO_EL_DUPES]   = b.cpoElDupes || 0;
  row[RL_COL.TOTAL_DUPES]    = b.totalDupes || 0;
  row[RL_COL.TOTAL_PRODUCED] = rec.totalProduced;
  row[RL_COL.QR_CODES]       = rec.qrCodes || '';
  row[RL_COL.OUTPUT_DOC_ID]  = rec.outputDocId || '';
  row[RL_COL.DURATION_SEC]   = rec.durationSec;
  row[RL_COL.ERRORS]         = rec.errors || '';
  row[RL_COL.NOTES]          = rec.note || '';
  row[RL_COL.PRODUCED_VINS]  = (rec.producedVins || []).join(',');
  row[RL_COL.STATUS]         = (!rec.status || rec.status === RL_STATUS.PENDING) ? '' : rec.status;
  return row;
}

/** The run fingerprint the views hand back: dealer + run time + deal id. */
function rlFingerprint_(rec) {
  return { dealerKey: rec.dealerKey, timestamp: rec.timestamp, dealId: rec.dealId };
}

/**
 * True when a decoded record is the run a view's fingerprint names. All three
 * parts must match; timestamps compare as canonical text (rlFormatTs_ on both
 * sides), so a Date cell and its formatted string agree.
 */
function rlFingerprintMatches_(rec, fp) {
  if (!rec || !fp) return false;
  return rec.dealerKey === String(fp.dealerKey || '').trim() &&
         rec.dealId    === String(fp.dealId === null || fp.dealId === undefined ? '' : fp.dealId).trim() &&
         rec.timestamp === rlFormatTs_(fp.timestamp);
}

/**
 * The run_ref tag written in VIN-log col E for this run's batch: the run time,
 * plus '|<GROUP>' on billing-split runs (the two halves share a run time and
 * must never share a tag). The tab is the dealer and col A is the deal id, so
 * tab + deal id + run_ref names exactly one run.
 */
function rlRunRef_(rec) {
  return rec.isSplit ? rec.timestamp + '|' + rec.group : rec.timestamp;
}

/** One VIN-log tab row (getValues() array) → a batch-row record. rowIndex is 1-based. */
function rlDecodeVinLogRow_(row, rowIndex) {
  var r = row || [];
  function str(i) { var v = r.length > i ? r[i] : ''; return v instanceof Date ? rlFormatTs_(v) : String(v === null || v === undefined ? '' : v).trim(); }
  return {
    rowIndex:    rowIndex,
    orderId:     str(VL_COL.ORDER_ID),
    vin:         str(VL_COL.VIN),
    committedAt: str(VL_COL.COMMITTED_AT),
    orderDate:   str(VL_COL.ORDER_DATE),
    runRef:      str(VL_COL.RUN_REF)
  };
}

/** A batch-row record → a 5-cell VIN-log row. Ids and VINs are forced to text. */
function rlEncodeVinLogRow_(b) {
  return [
    String(b.orderId === null || b.orderId === undefined ? '' : b.orderId).trim(),
    String(b.vin || '').trim(),
    b.committedAt || '',
    b.orderDate || '',
    b.runRef || ''
  ];
}


// ============================================================================
// STORE SEAM — the real adapter (Sheets + LockService)
// ============================================================================
//
// The store's interface (the fake in test/ledger-fake-store.js satisfies the
// same one — keep them in step):
//
//   withLock(fn)                 run fn while holding the ledger lock; returns fn's result.
//                                Throws 'Another change is in progress — try again.' if
//                                the lock can't be had in ~10 s. Every write below must
//                                happen inside withLock.
//   now()                        canonical 'yyyy-MM-dd HH:mm:ss' (America/Chicago).
//
//   readRuns()                   all RUN_LOG data rows as getValues() arrays (width 23,
//                                index 0 = sheet row 2). [] when empty.
//   readRun(rowIndex)            one row (width 23), or null past the last row.
//   appendRun(row)               append a 23-cell row; returns its 1-based row index.
//   setRunCell(rowIndex, col, v) write one cell; col is an RL_COL index.
//
//   hasVinLog(dealerKey)         true when the dealer's VIN-log tab exists.
//   readVinLog(dealerKey)        all data rows (width 5, index 0 = sheet row 2). [] when empty.
//   appendVinLog(dealerKey, rows) append 5-cell rows (cols A–B stored as text; writes the
//                                col-E header if missing). Throws if the tab is missing.
//   deleteVinLogRows(dealerKey, rowIndexes) delete these 1-based rows (any order).

/** Real store over the bound RUN_LOG and SF_VIN_LOGS. Sheets are opened at call time (inside the lock). */
function rlSheetStore_() {
  var held = false;

  function runLog_() {
    // ONE accessor for RUN_LOG everywhere: getActiveSpreadsheet (what every
    // existing RUN_LOG read/write uses). Mixing in openById would split caches.
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
    if (!sh) throw new Error('RUN_LOG tab not found.');
    return sh;
  }
  function vinTab_(dealerKey) {
    return getVinLogsSS_().getSheetByName(dealerKey);
  }
  function requireLock_(what) {
    if (!held) throw new Error('Run ledger: ' + what + ' outside withLock');
  }

  return {
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      try { lock.waitLock(10000); }
      catch (e) { throw new Error('Another change is in progress — try again.'); }
      held = true;
      try {
        var out = fn();
        SpreadsheetApp.flush();   // land every write before another execution can read
        return out;
      } finally {
        held = false;
        lock.releaseLock();
      }
    },

    now: function () { return Utilities.formatDate(new Date(), RL_TZ, RL_TS_FORMAT); },

    readRuns: function () {
      var sh = runLog_(), last = sh.getLastRow();
      return last < 2 ? [] : sh.getRange(2, 1, last - 1, RL_WIDTH).getValues();
    },
    readRun: function (rowIndex) {
      var sh = runLog_();
      if (!(rowIndex >= 2) || rowIndex > sh.getLastRow()) return null;
      return sh.getRange(rowIndex, 1, 1, RL_WIDTH).getValues()[0];
    },
    appendRun: function (row) {
      requireLock_('appendRun');
      var sh = runLog_(), at = sh.getLastRow() + 1;
      sh.getRange(at, 1, 1, RL_WIDTH).setValues([row]);
      return at;
    },
    setRunCell: function (rowIndex, col, v) {
      requireLock_('setRunCell');
      runLog_().getRange(rowIndex, col + 1).setValue(v);
    },

    hasVinLog: function (dealerKey) { return !!vinTab_(dealerKey); },
    readVinLog: function (dealerKey) {
      var sh = vinTab_(dealerKey);
      if (!sh) return [];
      var last = sh.getLastRow();
      if (last < 2) return [];
      // A tab trimmed narrower than 5 columns can't be read at width 5 — read what exists, pad.
      var w = Math.min(VL_WIDTH, sh.getMaxColumns());
      return sh.getRange(2, 1, last - 1, w).getValues().map(function (r) {
        while (r.length < VL_WIDTH) r.push('');
        return r;
      });
    },
    appendVinLog: function (dealerKey, rows) {
      requireLock_('appendVinLog');
      var sh = vinTab_(dealerKey);
      if (!sh) throw new Error('No VIN log tab found for: ' + dealerKey);
      if (!rows || !rows.length) return;
      if (sh.getMaxColumns() < VL_WIDTH) sh.insertColumnsAfter(sh.getMaxColumns(), VL_WIDTH - sh.getMaxColumns());
      if (String(sh.getRange(1, VL_COL.RUN_REF + 1).getValue()).trim() === '') {
        sh.getRange(1, VL_COL.RUN_REF + 1).setValue(VL_HEADERS[VL_COL.RUN_REF]);
      }
      var at  = sh.getLastRow() + 1;
      var rng = sh.getRange(at, 1, rows.length, VL_WIDTH);
      // Order id + VIN are text BEFORE and AFTER the write (the QUERY mixed-type rule).
      sh.getRange(at, 1, rows.length, 2).setNumberFormat('@');
      rng.setValues(rows.map(function (r) {
        var c = r.slice(0, VL_WIDTH);
        c[VL_COL.ORDER_ID] = String(c[VL_COL.ORDER_ID]);
        c[VL_COL.VIN]      = String(c[VL_COL.VIN]);
        return c;
      }));
      sh.getRange(at, 1, rows.length, 2).setNumberFormat('@');
    },
    deleteVinLogRows: function (dealerKey, rowIndexes) {
      requireLock_('deleteVinLogRows');
      var sh = vinTab_(dealerKey);
      if (!sh) throw new Error('No VIN log tab found for: ' + dealerKey);
      rlContiguousBlocks_(rowIndexes).forEach(function (blk) {   // bottom-up, so earlier rows don't shift
        sh.deleteRows(blk.start, blk.count);
      });
    }
  };
}

/**
 * 1-based row numbers → contiguous blocks, highest first, so deleting them in
 * order never shifts a block still to come. [7,3,4,5,9] → [{9,1},{7,1},{3,3}].
 */
function rlContiguousBlocks_(rowIndexes) {
  var rows = (rowIndexes || []).map(Number).filter(function (n) { return n >= 1; });
  rows = rows.filter(function (n, i) { return rows.indexOf(n) === i; }).sort(function (a, b) { return b - a; });
  var blocks = [];
  rows.forEach(function (n) {
    var top = blocks[blocks.length - 1];
    if (top && top.start - 1 === n) { top.start = n; top.count++; }
    else blocks.push({ start: n, count: 1 });
  });
  return blocks;
}


// ============================================================================
// DECISIONS — pure (records in, plan out; no store calls)
// ============================================================================

/** Decode every RUN_LOG data row (store.readRuns() → run records with their sheet rows). */
function rlDecodeAll_(rows) {
  return (rows || []).map(function (r, i) { return rlDecodeRow_(r, i + 2); });
}

/** Decode every VIN-log data row (store.readVinLog() → batch-row records with their sheet rows). */
function rlDecodeVinLog_(rows) {
  return (rows || []).map(function (r, i) { return rlDecodeVinLogRow_(r, i + 2); });
}

/**
 * Which run a view means. Two kinds of reference:
 *   - by fingerprint (VIN Logs view): { rowIndex, dealerKey, timestamp, dealId }
 *     — the row at rowIndex must still carry that fingerprint;
 *   - by output (Run view, straight after finalize): { dealerKey, outputDocId, note }
 *     — the one non-deleted row for that output doc + billing group.
 * Returns the run record, or throws a message the user can act on.
 */
function rlResolveRef_(recs, ref) {
  if (!ref) throw new Error('No run given.');
  var dealerKey = String(ref.dealerKey || '').trim();
  if (ref.outputDocId) {
    var doc = String(ref.outputDocId).trim(), group = rlSplitGroup_(ref.note);
    var hits = recs.filter(function (r) {
      return r.dealerKey === dealerKey && r.outputDocId === doc && r.group === group && r.status !== RL_STATUS.DELETED;
    });
    if (hits.length === 0) throw new Error('This run is not in the run log yet — reload and try again.');
    if (hits.length > 1)   throw new Error('This run has ' + hits.length + ' rows in the run log — commit it from the VIN Logs page instead.');
    return hits[0];
  }
  var rec = null;
  for (var i = 0; i < recs.length; i++) if (recs[i].rowIndex === Number(ref.rowIndex)) { rec = recs[i]; break; }
  if (!rec || !rlFingerprintMatches_(rec, ref)) {
    throw new Error('The run log row no longer matches this run — reload and try again.');
  }
  return rec;
}

/**
 * Which VIN-log rows are this run's batch (for rollback / delete).
 *   - Tagged: rows whose deal id and run_ref are this run's. Exact.
 *   - Legacy (committed before run_ref existed): untagged rows under this deal
 *     id are this run's ONLY when the match is unambiguous — exactly one
 *     untagged batch (one committed_at) under the deal, and this is the only
 *     committed run on the deal whose batch isn't tagged. Otherwise refuse.
 * Returns { rows: [1-based row numbers], mode: 'tagged'|'legacy'|'none' } or
 * { refused: '<message>' }.
 */
function rlFindBatch_(vinRecs, recs, rec) {
  var ref = rlRunRef_(rec);
  var tagged = vinRecs.filter(function (v) { return v.orderId === rec.dealId && v.runRef === ref; });
  if (tagged.length) return { rows: tagged.map(function (v) { return v.rowIndex; }), mode: 'tagged' };

  var untagged = vinRecs.filter(function (v) { return v.orderId === rec.dealId && v.runRef === ''; });
  if (!untagged.length) return { rows: [], mode: 'none' };

  var batches = {};
  untagged.forEach(function (v) { batches[v.committedAt] = true; });
  var competitors = recs.filter(function (r) {
    if (r.rowIndex === rec.rowIndex) return false;
    if (r.dealerKey !== rec.dealerKey || r.dealId !== rec.dealId) return false;
    if (r.status !== RL_STATUS.COMMITTED || r.isTest) return false;
    var otherRef = rlRunRef_(r);
    return !vinRecs.some(function (v) { return v.orderId === r.dealId && v.runRef === otherRef; });
  });
  if (Object.keys(batches).length === 1 && competitors.length === 0) {
    return { rows: untagged.map(function (v) { return v.rowIndex; }), mode: 'legacy' };
  }
  return {
    refused: 'Deal ' + rec.dealId + ' has more than one batch in the ' + rec.dealerKey +
             ' VIN log from before batches were tagged, so the app can\'t tell which rows are this run\'s. ' +
             'Roll it back by hand in SF_VIN_LOGS, then mark the run rolled_back.'
  };
}

/**
 * What committing one run should do. Returns one of:
 *   { skip: 'committed' | 'test' }
 *   { finishOnly: n }      this run's tagged batch is already in the log (a half-finished
 *                          earlier commit) — only the status needs writing
 *   { append: [rows] }     5-cell VIN-log rows to add, then set the status
 * Throws for runs that can't be committed.
 */
function rlPlanCommit_(rec, vinRecs, now) {
  if (rec.isTest) return { skip: 'test' };
  if (rec.status === RL_STATUS.COMMITTED) return { skip: 'committed' };
  if (rec.status === RL_STATUS.DELETED) throw new Error('This run was deleted, so it can\'t be committed.');
  if (!rec.dealId) throw new Error('This run has no Deal ID. Cannot commit without a Deal ID.');
  if (!rec.producedVins.length) throw new Error('No produced VINs found for this run.');

  var ref = rlRunRef_(rec);
  var already = vinRecs.filter(function (v) { return v.orderId === rec.dealId && v.runRef === ref; });
  if (already.length) return { finishOnly: already.length };

  return {
    append: rec.producedVins.map(function (vin) {
      // order_date = when the run happened, not when it was committed (a late commit keeps its date).
      return rlEncodeVinLogRow_({ orderId: rec.dealId, vin: vin, committedAt: now, orderDate: rec.timestamp, runRef: ref });
    })
  };
}

/** Manual-entry VINs: trimmed, upper-cased, de-duplicated, blanks dropped. */
function rlCleanManualVins_(vins) {
  var seen = {}, out = [];
  (vins || []).forEach(function (v) {
    var u = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
    if (u && !seen[u]) { seen[u] = true; out.push(u); }
  });
  return out;
}


// ============================================================================
// OPERATIONS — store-first internals (tests call these with the fake store)
// ============================================================================

/** Commit runs to their dealers' VIN logs. Test runs and already-committed runs are skipped. */
function rlCommitRuns_(store, refs) {
  if (!Array.isArray(refs) || !refs.length) throw new Error('No runs to commit.');
  return store.withLock(function () {
    var recs = rlDecodeAll_(store.readRuns());
    var targets = refs.map(function (ref) { return rlResolveRef_(recs, ref); });
    var out = { committed: 0, skippedCommitted: 0, skippedTest: 0 };
    targets.forEach(function (rec) {
      if (!rec.isTest && rec.status !== RL_STATUS.COMMITTED && !store.hasVinLog(rec.dealerKey)) {
        throw new Error('No VIN log tab found for: ' + rec.dealerKey);
      }
      var plan = rlPlanCommit_(rec, rlDecodeVinLog_(store.readVinLog(rec.dealerKey)), store.now());
      if (plan.skip === 'test')      { out.skippedTest++; return; }
      if (plan.skip === 'committed') { out.skippedCommitted++; return; }
      if (plan.append) store.appendVinLog(rec.dealerKey, plan.append);
      store.setRunCell(rec.rowIndex, RL_COL.STATUS, RL_STATUS.COMMITTED);
      rec.status = RL_STATUS.COMMITTED;        // a second ref to the same run in this call skips
      out.committed += plan.append ? plan.append.length : plan.finishOnly;
    });
    return out;
  });
}

/** Remove one committed run's batch from its VIN log (inside an open lock). */
function rlRollbackRec_(store, recs, rec) {
  if (rec.status !== RL_STATUS.COMMITTED) throw new Error('This run isn\'t committed, so there is nothing to roll back.');
  var found = rlFindBatch_(rlDecodeVinLog_(store.readVinLog(rec.dealerKey)), recs, rec);
  if (found.refused) throw new Error(found.refused);
  if (found.rows.length) store.deleteVinLogRows(rec.dealerKey, found.rows);
  store.setRunCell(rec.rowIndex, RL_COL.STATUS, RL_STATUS.ROLLED_BACK);
  return found.rows.length;
}

/** Roll back one committed run (by fingerprint). */
function rlRollbackRun_(store, ref) {
  return store.withLock(function () {
    var recs = rlDecodeAll_(store.readRuns());
    return { removed: rlRollbackRec_(store, recs, rlResolveRef_(recs, ref)) };
  });
}

/** Soft-delete one run (col W = deleted); a committed run's batch is rolled back first. */
function rlDeleteRun_(store, ref) {
  return store.withLock(function () {
    var recs = rlDecodeAll_(store.readRuns());
    var rec  = rlResolveRef_(recs, ref);
    if (rec.status === RL_STATUS.DELETED) return { removed: 0 };
    var removed = (rec.status === RL_STATUS.COMMITTED) ? rlRollbackRec_(store, recs, rec) : 0;
    store.setRunCell(rec.rowIndex, RL_COL.STATUS, RL_STATUS.DELETED);
    return { removed: removed };
  });
}

/** Manual entry: VINs typed straight into a dealer's VIN log under an order number (no run behind them). */
function rlManualEntry_(store, dealerKey, orderId, vins) {
  dealerKey = String(dealerKey || '').trim();
  orderId   = String(orderId === null || orderId === undefined ? '' : orderId).trim();
  if (!dealerKey) throw new Error('No dealer key provided.');
  if (!orderId)   throw new Error('Order number is required.');
  if (!vins || !vins.length) throw new Error('No VINs provided.');
  var cleaned = rlCleanManualVins_(vins);
  if (!cleaned.length) throw new Error('No valid VINs after deduplication.');
  return store.withLock(function () {
    if (!store.hasVinLog(dealerKey)) throw new Error('No VIN log tab found for: ' + dealerKey);
    var now = store.now();   // typed in near order time — order_date = now
    store.appendVinLog(dealerKey, cleaned.map(function (vin) {
      return rlEncodeVinLogRow_({ orderId: orderId, vin: vin, committedAt: now, orderDate: now, runRef: VL_MANUAL_REF });
    }));
    return { committed: cleaned.length };
  });
}


// ============================================================================
// PUBLIC ENDPOINTS — google.script.run (one line each: real store in, result out)
// ============================================================================
// Views name a run by reference (see rlResolveRef_) and never send VINs, deal
// ids or dates for the server to trust.

/** Commit runs to the VIN log. refs: [{rowIndex, dealerKey, timestamp, dealId}] or [{dealerKey, outputDocId, note}]. */
function ledgerCommitRuns(refs) { return rlCommitRuns_(rlSheetStore_(), refs); }

/** Roll back one committed run. ref: {rowIndex, dealerKey, timestamp, dealId}. */
function ledgerRollbackRun(ref) { return rlRollbackRun_(rlSheetStore_(), ref); }

/** Soft-delete one run (rolling back its batch first if committed). ref: {rowIndex, dealerKey, timestamp, dealId}. */
function ledgerDeleteRun(ref) { return rlDeleteRun_(rlSheetStore_(), ref); }

/** Manual entry into a dealer's VIN log. */
function ledgerManualEntry(dealerKey, orderId, vins) { return rlManualEntry_(rlSheetStore_(), dealerKey, orderId, vins); }
