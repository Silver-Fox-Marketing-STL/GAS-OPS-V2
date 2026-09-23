// Mock server responses for the SilverFox App UI audit harness.
// Shapes follow Code.gs (documented by the shape-audit agents, 2026-09-23).
(function () {
  var NOW = Date.now();
  var D = 'BOMMARITO_WEST_COUNTY';

  var DEALERS = [
    { key: 'AUFFENBERG_HYUNDAI',    name: 'Auffenberg Hyundai',            splitDealLabel: null },
    { key: 'BOMMARITO_WEST_COUNTY', name: 'Bommarito West County',         splitDealLabel: null },
    { key: 'CDJR_OF_COLUMBIA',      name: 'Joe Machens CDJR of Columbia',  splitDealLabel: null },
    { key: 'FRANK_LETA_HONDA',      name: 'Frank Leta Honda',              splitDealLabel: null },
    { key: 'GLENDALE_CDJR',         name: 'Glendale Chrysler Jeep',        splitDealLabel: null },
    { key: 'MB_CREVE_COEUR',        name: 'Mercedes-Benz of Creve Coeur',  splitDealLabel: 'SPRINTER Deal ID' },
    { key: 'PAPPAS_TOYOTA',         name: 'Pappas Toyota',                 splitDealLabel: null },
    { key: 'SUNTRUP_FORD_KIRKWOOD', name: 'Suntrup Ford Kirkwood',         splitDealLabel: null },
    { key: 'WEBER_CHEVROLET',       name: 'Weber Chevrolet Creve Coeur',   splitDealLabel: null },
    { key: 'WEST_COUNTY_VW',        name: 'West County Volkswagen',        splitDealLabel: null }
  ];

  // Inventory for the focus dealer (VIN → row).
  var INV = {
    '1C4RJFBG8KC654321': { year: '2019', make: 'Jeep',      model: 'Grand Cherokee', type: 'PO',  stock: 'P9876A', status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/used/Jeep/2019-Jeep-Grand-Cherokee-def456.htm' },
    '2T1BURHE0JC034567': { year: '2018', make: 'Toyota',    model: 'Corolla',        type: 'PO',  stock: 'P9911',  status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/used/Toyota/2018-Toyota-Corolla-a1b2c3.htm' },
    '5NPE34AF4KH812345': { year: '2024', make: 'Hyundai',   model: 'Sonata',         type: 'New', stock: 'H24812', status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/new/Hyundai/2024-Hyundai-Sonata-abc123.htm' },
    '3GNAXKEV5ML112233': { year: '2021', make: 'Chevrolet', model: 'Equinox',        type: 'CPO', stock: 'C21044', status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/certified/Chevrolet/2021-Chevrolet-Equinox-x9y8z7.htm' },
    '1FMCU9GD4LUA44556': { year: '2020', make: 'Ford',      model: 'Escape',         type: 'PO',  stock: 'P9950',  status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/used/Ford/2020-Ford-Escape-q1w2e3.htm' },
    'KM8J3CA46LU998877': { year: '2020', make: 'Hyundai',   model: 'Tucson',         type: 'CPO', stock: 'C20118', status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/certified/Hyundai/2020-Hyundai-Tucson-r4t5y6.htm' },
    '5NPEL4JA2MH556677': { year: '2025', make: 'Hyundai',   model: 'Sonata Hybrid',  type: 'New', stock: 'H25001', status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/new/Hyundai/2025-Hyundai-Sonata-Hybrid-u7i8o9.htm' },
    'KMHLM4AG9PU223344': { year: '2025', make: 'Hyundai',   model: 'Elantra',        type: 'New', stock: 'H25014', status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/new/Hyundai/2025-Hyundai-Elantra-p0o9i8.htm' },
    '1GCUYDED5MZ778899': { year: '2021', make: 'Chevrolet', model: 'Silverado 1500', type: 'PO',  stock: 'P9962',  status: 'OFFLOT', url: 'https://www.bommaritowestcounty.com/used/Chevrolet/2021-Chevrolet-Silverado-1500-l1k2j3.htm' },
    'WA1LAAF70KD001122': { year: '2019', make: 'Audi',      model: 'Q7',             type: 'PO',  stock: 'P9970',  status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/used/Audi/2019-Audi-Q7-h4g5f6.htm' },
    '5NMS3CAD1NH445566': { year: '2022', make: 'Hyundai',   model: 'Santa Fe',       type: 'CPO', stock: 'C22007', status: 'ONLOT', url: 'https://www.bommaritowestcounty.com/certified/Hyundai/2022-Hyundai-Santa-Fe-d7s8a9.htm' },
    'JTDKARFU8L3990011': { year: '2020', make: 'Toyota',    model: 'Prius',          type: 'PO',  stock: 'P9985',  status: 'ONLOT', url: '*' }
  };
  var ORDER_VINS = Object.keys(INV).concat(['1HGCV1F34LA000000']);   // last one: not in inventory

  var PENDING_RUN = {
    outputFolderUrl: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    dealerName: 'Bommarito West County', producedVinCount: 11,
    pendingRuns: [{
      groupKey: 'PRIMARY', pushModes: { test: true, newDeal: true, existing: true, reason: '' },
      label: 'Bommarito West County', dealLabel: 'Pipedrive Deal ID', totalOrdered: 13, totalMatched: 11,
      billing: { totalOrdered: 13, totalMatched: 11, totalDupes: 1, totalNew: 3, totalPO: 5, totalCPO: 3, totalCPOEL: 0,
                 newDupes: 0, poDupes: 1, cpoDupes: 0, cpoElDupes: 0,
                 byType: { New: { gross: 3, dupes: 0 }, PO: { gross: 5, dupes: 1 }, CPO: { gross: 3, dupes: 0 }, 'CPO-EL': { gross: 0, dupes: 0 } } },
      producedVins: Object.keys(INV).slice(0, 11), note: '', prefillDealId: '44872',
      outputDocId: '1xYzOutputDoc0123456789abcdefGHIJKL', qrFileIds: ['1qrA111', '1qrB222'], csvFileIds: ['1csvMain333'],
      durationSec: 42, errors: []
    }]
  };

  var RUNS = [
    { rowIndex: 845, dealerKey: D, dealerName: 'Bommarito West County', timestamp: '2026-09-23 09:14:02', dealId: '44872', vinCount: 11, status: 'pending',     note: '', producedVins: Object.keys(INV).slice(0, 11) },
    { rowIndex: 838, dealerKey: D, dealerName: 'Bommarito West County', timestamp: '2026-09-19 14:02:47', dealId: '44811', vinCount: 9,  status: 'committed',   note: '', producedVins: Object.keys(INV).slice(2, 11) },
    { rowIndex: 831, dealerKey: D, dealerName: 'Bommarito West County', timestamp: '2026-09-16 10:31:15', dealId: 'test',  vinCount: 4,  status: 'pending',     note: '', producedVins: Object.keys(INV).slice(0, 4) },
    { rowIndex: 822, dealerKey: D, dealerName: 'Bommarito West County', timestamp: '2026-09-12 08:55:03', dealId: '44760', vinCount: 17, status: 'committed',   note: '', producedVins: Object.keys(INV) },
    { rowIndex: 814, dealerKey: D, dealerName: 'Bommarito West County', timestamp: '2026-09-09 11:20:40', dealId: '44702', vinCount: 6,  status: 'rolled_back', note: '', producedVins: Object.keys(INV).slice(5, 11) },
    { rowIndex: 802, dealerKey: D, dealerName: 'Bommarito West County', timestamp: '2026-09-02 09:03:11', dealId: '44655', vinCount: 22, status: 'committed',   note: '', producedVins: Object.keys(INV) }
  ];
  var ALL_RUNS = RUNS.slice(0, 3).concat([
    { rowIndex: 844, dealerKey: 'MB_CREVE_COEUR', dealerName: 'Mercedes-Benz of Creve Coeur', timestamp: '2026-09-23 08:41:19', dealId: '44870', vinCount: 14, status: 'pending', note: 'SPLIT:PRIMARY', producedVins: [] },
    { rowIndex: 843, dealerKey: 'MB_CREVE_COEUR', dealerName: 'Mercedes-Benz of Creve Coeur', timestamp: '2026-09-23 08:41:19', dealId: '44871', vinCount: 3,  status: 'pending', note: 'SPLIT:SPRINTER', producedVins: [] },
    { rowIndex: 840, dealerKey: 'AUFFENBERG_HYUNDAI', dealerName: 'Auffenberg Hyundai', timestamp: '2026-09-22 15:12:00', dealId: '44860', vinCount: 8, status: 'committed', note: '', producedVins: [] }
  ]).concat(RUNS.slice(3));

  var SUBS = [];
  var subVins = ['1C4RJFBG8KC654321', '2T1BURHE0JC034567', 'KM8J3CA46LU998877', '1HGCV1F34LA000000', '5NMS3CAD1NH445566'];
  subVins.forEach(function (v, i) {
    var d = INV[v];
    SUBS.push({ id: 'sub_8f2a9' + i, ts: 'Wed Sep 23 2026 8:0' + i + ' AM', tsMs: NOW - 3600000 - i * 60000,
      email: 'crew@sfoxmarketing.com', dealerKey: D, dealerName: 'Bommarito West County',
      photoFileId: '1PhotoAbc' + i, photoUrl: 'https://drive.google.com/file/d/1PhotoAbc' + i + '/view',
      vinExtracted: v, vin: v, valid: v.length === 17, matched: !!d,
      year: d ? d.year : '', make: d ? d.make : '', model: d ? d.model : '', type: d ? d.type : '', stock: d ? d.stock : '',
      status: 'submitted', isDraft: false, ocrState: i === 3 ? 'queued' : 'done', batchId: 'b_0923a', notes: i === 0 ? 'Front row, by the service drive' : '' });
  });
  SUBS.push({ id: 'sub_7c1d0', ts: 'Tue Sep 22 2026 4:48 PM', tsMs: NOW - 86400000, email: 'field@sfoxmarketing.com',
    dealerKey: 'AUFFENBERG_HYUNDAI', dealerName: 'Auffenberg Hyundai', photoFileId: '1PhotoZ', photoUrl: 'https://drive.google.com/file/d/1PhotoZ/view',
    vinExtracted: '5NPE34AF4KH812345', vin: '5NPE34AF4KH812345', valid: true, matched: true, year: '2024', make: 'Hyundai', model: 'Sonata', type: 'New', stock: 'H24812',
    status: 'submitted', isDraft: false, ocrState: 'done', batchId: 'b_0922c', notes: '' });

  window.MOCK = {
    // ── shell / shared ──────────────────────────────────────────────────────
    getAppBootstrap: { dealers: DEALERS, users: { profiles: [{ key: 'nick', name: 'Nick' }, { key: 'sam', name: 'Sam' }, { key: 'jordan', name: 'Jordan' }], lastUser: 'nick' }, appTheme: '' },
    saveThemePreference: { ok: true },
    saveUiPref: { ok: true },

    // ── Home ────────────────────────────────────────────────────────────────
    getHomeHud: { lastImport: { date: '2026/09/23', time: '07:42:10' },
      today: { runs: 4, vins: 57, dealers: 3, dupes: 6 }, week: { runs: 15, vins: 212, dealers: 9, dupes: 21 },
      allTime: { runs: 842, vins: 11873, avgVinsPerRun: 14.1, committed: 801, pending: 38, rolledBack: 3 }, draftCount: 2 },
    getPrintSchedule: { ok: true, configured: true, day: 'Wednesday',
      upNext: [{ key: 'AUFFENBERG_HYUNDAI', name: 'Auffenberg Hyundai', pending: 1 }, { key: 'PAPPAS_TOYOTA', name: 'Pappas Toyota', pending: 0 }, { key: 'WEBER_CHEVROLET', name: 'Weber Chevrolet Creve Coeur', pending: 0 }],
      ranToday: [{ key: D, name: 'Bommarito West County', pending: 5, runs: 1, vins: 11, dupes: 1, scheduled: true },
                 { key: 'MB_CREVE_COEUR', name: 'Mercedes-Benz of Creve Coeur', pending: 0, runs: 2, vins: 17, dupes: 2, scheduled: true },
                 { key: 'FRANK_LETA_HONDA', name: 'Frank Leta Honda', pending: 0, runs: 1, vins: 29, dupes: 3, scheduled: false }],
      totals: { runs: 4, vins: 57, dupes: 6 } },
    getAppHomeStatus: { lastImportDate: '2026/09/23', lastImportTime: '07:42:10' },
    getDealerSummary: function (key) {
      return { dealerKey: key, dealerName: (DEALERS.filter(function (d) { return d.key === key; })[0] || {}).name,
        inventory: { byType: { New: 212, PO: 88, CPO: 14, 'CPO-EL': 0, Other: 0 }, total: 314, onlot: 301, offlot: 13, noPrice: 2, noStock: 0, asOf: '2026/09/23 07:42' },
        runStats: { runs: 61, vinsOrdered: 912, vinsProduced: 874, avgMatchPct: 95.8, byType: { new: 402, po: 355, cpo: 117, cpoEl: 0 } },
        lastRun: { ts: '2026/09/23 09:14', orderId: '44872', produced: 11, vinLogStatus: 'pending' },
        eomOrders: 7 };
    },

    // ── Run Order ───────────────────────────────────────────────────────────
    getDealerVinData: function (key) {
      if (key !== D) return { vinData: {}, featuresTypes: {}, editCodes: {}, editSeeds: {}, filtered: {} };
      var seeds = {};
      Object.keys(INV).forEach(function (v) { if (INV[v].type === 'New') seeds[v] = { MODELTRIM: (INV[v].model + ' SEL').toUpperCase() }; });
      return { vinData: INV, featuresTypes: { CPO: true }, editCodes: { New: [{ code: 'MODELTRIM', max: 22 }] }, editSeeds: seeds,
               filtered: { '1GCUYDED5MZ778899': 'status', 'JTDKARFU8L3990011': 'no URL' } };
    },
    getLoggedIdentifiers: function (key) { return { identifiers: key === D ? ['2T1BURHE0JC034567', 'P9950'] : [] }; },
    getLatestOrderId: function (key) { return { latestOrderId: key === D ? '44872' : '44860', pendingCount: key === D ? 1 : 0 }; },
    getMyRunDrafts: { ok: true, drafts: [
      { dealerKey: 'PAPPAS_TOYOTA', dealerName: 'Pappas Toyota', vinCount: 6, featCount: 0, updatedAt: NOW - 25 * 60000,
        payload: { dealerKey: 'PAPPAS_TOYOTA', dealerName: 'Pappas Toyota', vinText: 'JTDKARFU8L3990011\n2T1BURHE0JC034567', features: {}, edits: {}, bypassFilters: false, savedAt: NOW - 25 * 60000 } },
      { dealerKey: 'WEST_COUNTY_VW', dealerName: 'West County Volkswagen', vinCount: 14, featCount: 3, updatedAt: NOW - 26 * 3600000,
        payload: { dealerKey: 'WEST_COUNTY_VW', dealerName: 'West County Volkswagen', vinText: 'WA1LAAF70KD001122', features: { 'WA1LAAF70KD001122': 'Leather' }, edits: {}, bypassFilters: false, savedAt: NOW - 26 * 3600000 } }
    ] },
    saveRunDraft: { ok: true, savedAt: NOW },
    deleteRunDraft: { ok: true },
    getCaoVins: function () {
      return { vins: ['2T1BURHE0JC034567', '3GNAXKEV5ML112233', '1FMCU9GD4LUA44556'],
        summary: { totalInventory: 418, afterFiltering: 371, alreadyPrinted: 368, netNew: 3,
          rejectionBreakdown: { no_stock: 1, no_price: 5, type: 22, status: 8, price_low: 0, price_high: 0, seasoning: 9, 'rule:exclude_cao': 2 } } };
    },
    getRunProgress: function () { return window.MOCK_PROGRESS || { message: 'Generating 11 QR codes (parallel)...', percent: 64, done: false, error: null }; },
    clearRunProgress: { ok: true },
    pasteVinsAndRun: function () { return window.MOCK_RUN_RESULT || PENDING_RUN; },
    finalizeRun: { rowIndex: 846, vinCount: 11 },
    finalizeRunNewDeal: { ok: true, stage: 'done', dealId: '44873', rowIndex: 846, productsAttached: 3, fieldsSet: 4, billingCsvPending: false, vinCount: 11, message: 'Created deal 44873 (3 product lines).' },
    finalizeRunExisting: { ok: true, stage: 'done', dealId: '44811', rowIndex: 847, productsAttached: 2, fieldsSet: 3, billingCsvPending: false, vinCount: 9, message: 'Linked to deal 44811 (2 product lines).' },
    pushRunToPipedrive: { ok: true, stage: 'done', dealId: '44872', productsAttached: 3, fieldsSet: 4, billingCsvPending: false, message: 'Created deal 44872 (3 product lines).' },
    abandonRun: { ok: true },

    // ── Import ──────────────────────────────────────────────────────────────
    getCanonicalHeaders: ['VIN', 'Stock', 'Type', 'Year', 'Make', 'Model', 'Trim', 'Ext Color', 'Status', 'Price', 'Body Style', 'Fuel Type', 'MSRP', 'Date In Stock', 'Street Address', 'Locality', 'Postal Code', 'Region', 'Country', 'Location', 'Vechile URL'],
    getHeaderAliasMap: { 'stock number': 'Stock', 'vehicle type': 'Type', 'internet price': 'Price', 'vdp url': 'Vechile URL' },
    getVehicleTypes: ['New', 'PO', 'CPO', 'CPO-EL'],
    getInventorySnapshot: { headers: ['Location', 'New', 'PO', 'CPO', 'CPO-EL', 'Other', 'Total', 'ONLOT', 'OFFLOT', 'No Price / No Stock'],
      rows: [['Auffenberg Hyundai', '212', '88', '14', '0', '0', '314', '301', '13', '2 / 0'],
             ['Bommarito West County', '0', '396', '22', '0', '0', '418', '410', '8', '5 / 1'],
             ['Frank Leta Honda', '340', '150', '41', '0', '0', '531', '520', '11', '0 / 0'],
             ['Glendale Chrysler Jeep', '188', '97', '9', '0', '2', '296', '290', '6', '1 / 0'],
             ['Joe Machens Chrysler Dodge Jeep Ram', '402', '210', '33', '0', '0', '645', '640', '5', '3 / 2'],
             ['Mercedes-Benz of Creve Coeur', '154', '61', '38', '12', '0', '265', '260', '5', '0 / 0'],
             ['Pappas Toyota', '256', '142', '51', '0', '0', '449', '441', '8', '4 / 0'],
             ['Suntrup Ford Kirkwood', '301', '119', '27', '0', '0', '447', '440', '7', '2 / 1'],
             ['Weber Chevrolet Creve Coeur', '277', '104', '19', '0', '0', '400', '395', '5', '1 / 0'],
             ['West County Volkswagen', '133', '78', '24', '0', '0', '235', '230', '5', '0 / 0']],
      totals: ['TOTALS', '2263', '1445', '278', '12', '2', '4000', '3967', '73', ''] },
    getScraperDataPreview: function () {
      var rows = Object.keys(INV).map(function (v) { var d = INV[v]; return { vin: v, stock: d.stock, type: d.type, year: d.year, make: d.make, model: d.model, trim: 'Limited', status: d.status, price: '24995', location: 'Bommarito West County', url: d.url }; });
      return { rows: rows, totalCount: 418, cappedAt: 3000, locations: ['Auffenberg Hyundai', 'Bommarito West County', 'Pappas Toyota'], types: ['CPO', 'New', 'PO'] };
    },
    importScraperData: function () {
      return window.MOCK_IMPORT_RESULT || {
        rowCount: 4000, colCount: 21, mode: 'replace', duplicatesRemoved: 37, droppedOnImport: 5, conflictsResolved: 0, blankVinCount: 2, fileCount: 2,
        review: { total: 4000, typeCounts: { New: 2263, PO: 1445, CPO: 278, 'CPO-EL': 12, Demo: 2 }, statusCounts: { ONLOT: 3967, OFFLOT: 33 },
          locationTypeCounts: { 'Bommarito West County': { PO: 396, CPO: 22 }, 'Auffenberg Hyundai': { New: 212, PO: 88, CPO: 14 }, 'Pappas Toyota': { New: 256, PO: 142, CPO: 51 } },
          locationDetail: {
            'Auffenberg Hyundai':    { total: 314, new: 212, po: 88, cpo: 14, cpo_el: 0, other_types: 0, byType: { New: 212, PO: 88, CPO: 14 }, onlot: 301, offlot: 13, other_status: 0, no_price: 2, no_stock: 0 },
            'Bommarito West County': { total: 418, new: 0, po: 396, cpo: 22, cpo_el: 0, other_types: 0, byType: { PO: 396, CPO: 22 }, onlot: 410, offlot: 8, other_status: 0, no_price: 5, no_stock: 1 },
            'Pappas Toyota':         { total: 449, new: 256, po: 142, cpo: 51, cpo_el: 0, other_types: 0, byType: { New: 256, PO: 142, CPO: 51 }, onlot: 441, offlot: 8, other_status: 0, no_price: 4, no_stock: 0 } } },
        healthIssues: [{ location: 'Auffenberg Hyundai', severity: 'warning', message: 'Total inventory down 45% vs avg (avg: 570, now: 314)' },
                       { location: 'Glendale Chrysler Jeep', severity: 'error', message: 'Location missing from this import (was 296 last time)' }],
        unconfiguredLocations: [{ location: 'Joe Machens Nissan', suggestedKey: 'JOE_MACHENS_NISSAN' }] };
    },

    // ── VIN Logs ────────────────────────────────────────────────────────────
    getRunsForDealer: function (key) { return key ? RUNS.filter(function (r) { return r.dealerKey === key; }) : ALL_RUNS; },
    commitRunToVINLog: { ok: true, message: 'Committed 11 VINs.' },
    rollbackRunFromVINLog: { ok: true },
    deleteRun: { ok: true },

    // ── VIN Inbox ───────────────────────────────────────────────────────────
    getVinSubmissions: { ok: true, configured: true, submissions: SUBS },
    updateVinSubmissionStatus: { ok: true },
    updateVinSubmissionStatuses: { ok: true },

    // ── Stack Cleanup ───────────────────────────────────────────────────────
    getStackCleanupList: function () {
      var rows = Object.keys(INV).map(function (v) { var d = INV[v]; return { vin: v, stock: d.stock, year: d.year, make: d.make, model: d.model }; });
      rows.sort(function (a, b) { return a.vin.slice(-2) < b.vin.slice(-2) ? -1 : 1; });
      return { rows: rows, loggedCount: 1893, inventoryCount: 418 };
    }
  };

  window.MOCK_FIX = { DEALERS: DEALERS, INV: INV, ORDER_VINS: ORDER_VINS, PENDING_RUN: PENDING_RUN, RUNS: RUNS, D: D };
})();
