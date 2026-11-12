// ============================================================================
// In-memory adapter for the run ledger's store seam (RunLedger.gs).
// ============================================================================
// Satisfies the same interface as rlSheetStore_() — see the STORE SEAM
// comment block in RunLedger.gs; keep the two in step. It is deliberately
// STRICT where the real books are unforgiving:
//   - any write outside withLock() throws (the real adapter does too);
//   - rows behave like sheet rows: 1-based, row 1 is the header, deletes shift
//     everything below up;
//   - reads return copies padded to the sheet width, so a caller can't mutate
//     the "sheet" by accident.
// Seed it with arrays of row arrays (no header row — data rows only).
// ============================================================================
'use strict';

var RL_WIDTH = 23;
var VL_WIDTH = 5;

function pad_(row, width) {
  var out = (row || []).slice(0, width);
  while (out.length < width) out.push('');
  return out;
}

/**
 * @param {Object} seed
 *   runLog:   [[...23 cells], ...]       RUN_LOG data rows (sheet rows 2..)
 *   vinLogs:  { DEALER_KEY: [[...]], ...} VIN-log data rows per tab
 *   now:      'yyyy-MM-dd HH:mm:ss'       what now() returns (default fixed)
 *   lockBusy: true                        withLock() fails like a held lock
 */
function makeFakeLedgerStore(seed) {
  seed = seed || {};
  var runLog  = (seed.runLog || []).map(function (r) { return pad_(r, RL_WIDTH); });
  var vinLogs = {};
  var headers = {};
  Object.keys(seed.vinLogs || {}).forEach(function (k) {
    vinLogs[k] = seed.vinLogs[k].map(function (r) { return pad_(r, VL_WIDTH); });
    headers[k] = ['ORDER_ID', 'VIN', 'committed_at', 'order_date', ''];   // legacy tabs: no E header yet
  });
  var held = false;
  var nowValue = seed.now || '2026-11-12 10:00:00';
  var stats = { locks: 0, writes: 0 };

  function requireLock_(what) {
    if (!held) throw new Error('Run ledger: ' + what + ' outside withLock');
    stats.writes++;
  }
  function tab_(dealerKey) {
    if (!Object.prototype.hasOwnProperty.call(vinLogs, dealerKey)) throw new Error('No VIN log tab found for: ' + dealerKey);
    return vinLogs[dealerKey];
  }

  return {
    withLock: function (fn) {
      if (seed.lockBusy) throw new Error('Another change is in progress — try again.');
      if (held) throw new Error('Run ledger: withLock is not re-entrant');
      held = true; stats.locks++;
      try { return fn(); } finally { held = false; }
    },
    now: function () { return nowValue; },

    readRuns: function () { return runLog.map(function (r) { return r.slice(); }); },
    readRun: function (rowIndex) {
      var r = runLog[rowIndex - 2];
      return (rowIndex >= 2 && r) ? r.slice() : null;
    },
    appendRun: function (row) {
      requireLock_('appendRun');
      runLog.push(pad_(row, RL_WIDTH));
      return runLog.length + 1;
    },
    setRunCell: function (rowIndex, col, v) {
      requireLock_('setRunCell');
      var r = runLog[rowIndex - 2];
      if (!r) throw new Error('setRunCell: no row ' + rowIndex);
      r[col] = v;
    },

    hasVinLog: function (dealerKey) { return Object.prototype.hasOwnProperty.call(vinLogs, dealerKey); },
    readVinLog: function (dealerKey) {
      if (!Object.prototype.hasOwnProperty.call(vinLogs, dealerKey)) return [];
      return vinLogs[dealerKey].map(function (r) { return r.slice(); });
    },
    appendVinLog: function (dealerKey, rows) {
      requireLock_('appendVinLog');
      var t = tab_(dealerKey);
      if (!rows || !rows.length) return;
      if (!headers[dealerKey][4]) headers[dealerKey][4] = 'run_ref';
      rows.forEach(function (r) {
        var c = pad_(r, VL_WIDTH);
        c[0] = String(c[0]); c[1] = String(c[1]);   // cols A–B are text in the real adapter
        t.push(c);
      });
    },
    deleteVinLogRows: function (dealerKey, rowIndexes) {
      requireLock_('deleteVinLogRows');
      var t = tab_(dealerKey);
      var rows = rowIndexes.slice().sort(function (a, b) { return b - a; });
      rows.forEach(function (n, i) {
        if (i > 0 && rows[i - 1] === n) return;
        if (!t[n - 2]) throw new Error('deleteVinLogRows: no row ' + n);
        t.splice(n - 2, 1);
      });
    },

    // ── test-only inspection (not part of the store interface) ──────────────
    _runLog:  function () { return runLog; },
    _vinLog:  function (k) { return vinLogs[k]; },
    _header:  function (k) { return headers[k]; },
    _stats:   function () { return stats; },
    _setNow:  function (v) { nowValue = v; }
  };
}

module.exports = { makeFakeLedgerStore: makeFakeLedgerStore };
