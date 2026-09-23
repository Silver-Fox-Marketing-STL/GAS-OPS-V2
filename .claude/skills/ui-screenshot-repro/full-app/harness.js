// In-page scenario driver. Runs after the App shell boot script. The puppeteer
// shooter calls HARNESS.run(name) and waits for the returned promise.
(function () {
  var F = window.MOCK_FIX;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function pick(sel, value) {
    sel.value = value;
    sel.dispatchEvent(new Event('change'));
    if (window.CustomSelect && CustomSelect.refresh) { try { CustomSelect.refresh(sel); } catch (e) {} }
  }
  function nav(id) { navTo(id); return sleep(120); }

  // Run view helpers
  async function runWithVins() {
    await nav('view-run');
    await sleep(80);
    pick($('userSelect'), 'nick');
    pick($('runDealerSelect'), F.D);
    await sleep(120);
    appendVins(F.ORDER_VINS);
    await sleep(350);   // debounce + data load
    // Type a feature on one CPO row and leave another blank (shows the required-text state)
    var inp = document.querySelector('#vinDataBody .rv-feat-input');
    if (inp) { inp.value = 'Leather, Nav, Panoramic Sunroof'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    // Blow one editable-column budget so the over-limit style shows
    var ed = document.querySelector('#vinDataBody .rv-edit-input');
    if (ed) { ed.value = 'SONATA SEL CONVENIENCE PKG'; ed.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  function fillAllFeatures() {
    document.querySelectorAll('#vinDataBody .rv-feat-input').forEach(function (i) {
      if (!i.value) { i.value = 'Heated seats, Backup camera'; i.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  }
  function noPendingCommits() { window.MOCK.getLatestOrderId = { latestOrderId: '44872', pendingCount: 0 }; }

  var S = {
    'home': async function () {
      await nav('view-home');
      await sleep(150);
      pick($('homeDealerSelect'), F.D);
      await sleep(150);
    },
    'run-empty': async function () { await nav('view-run'); await sleep(150); },
    'run-vins': async function () {
      await runWithVins();
      showCaoSummary(window.MOCK.getCaoVins().summary);
      await sleep(100);
    },
    'run-progress': async function () {
      await runWithVins(); fillAllFeatures(); noPendingCommits();
      window.MOCK.pasteVinsAndRun = function () { return window.MOCK_NEVER; };
      runSelected();
      await sleep(2200);   // first 1.5s poll tick lands
    },
    'run-finished': async function () {
      await runWithVins(); fillAllFeatures(); noPendingCommits();
      runSelected();
      await sleep(400);
    },
    'run-finalized': async function () {
      await runWithVins(); fillAllFeatures(); noPendingCommits();
      runSelected();
      await sleep(400);
      finalizeCard(0);
      await sleep(300);
    },
    'run-confirm-dialog': async function () {
      await runWithVins(); fillAllFeatures();   // pendingCount 1 → "Uncommitted runs" confirm
      runSelected();
      await sleep(300);
    },
    'run-cao-popover': async function () {
      await runWithVins();
      showCaoSummary(window.MOCK.getCaoVins().summary);
      await sleep(100);
      var b = document.querySelector('#view-run .rej-toggle'); if (b) b.click();
      await sleep(150);
    },
    'import': async function () {
      await nav('view-import'); await sleep(200);
      window.parsedFiles = [
        { name: 'bommarito_west_county_2026-09-23.csv', rows: [], rowCount: 418, matchedCount: 21, missing: [], ignored: ['Days On Lot'], valid: true, error: null },
        { name: 'auffenberg_hyundai_2026-09-23.csv', rows: [], rowCount: 314, matchedCount: 19, missing: ['MSRP', 'Fuel Type'], ignored: [], valid: true, error: null },
        { name: 'pappas_toyota_2026-09-23.csv', rows: [], rowCount: 0, matchedCount: 0, missing: [], ignored: [], valid: false, error: 'File appears empty or has no data rows.' }
      ];
      renderFileCards();
      await sleep(100);
    },
    'import-review': async function () {
      await nav('view-import'); await sleep(200);
      showReview(window.MOCK.importScraperData());
      await sleep(150);
    },
    'import-conflicts': async function () {
      await nav('view-import'); await sleep(200);
      var base = ['1C4RJFBG8KC654321', 'P9876A', 'PO', '2019', 'Jeep', 'Grand Cherokee', 'Limited', 'Bright White', 'ONLOT', '24995', 'SUV', 'Gasoline', '', '2026-08-30', '15736 Manchester Rd', 'Ellisville', '63011', 'MO', 'US', 'Bommarito West County', 'https://www.bommaritowestcounty.com/used/Jeep/2019-Jeep-Grand-Cherokee-def456.htm'];
      function variant(vin, changes) { var r = base.slice(); r[0] = vin; Object.keys(changes).forEach(function (k) { r[+k] = changes[k]; }); return r; }
      var conflicts = [
        { vin: '1C4RJFBG8KC654321', existing: { row: base, source: 'Existing data' }, incoming: { row: variant('1C4RJFBG8KC654321', { 9: '23995', 8: 'OFFLOT' }), source: 'bommarito_west_county_2026-09-23.csv' }, diffCols: [8, 9], variantCount: 2 },
        { vin: '2T1BURHE0JC034567', existing: { row: variant('2T1BURHE0JC034567', { 4: 'Toyota', 5: 'Corolla', 1: 'P9911' }), source: 'Existing data' }, incoming: { row: variant('2T1BURHE0JC034567', { 4: 'Toyota', 5: 'Corolla', 1: 'P9911A', 19: 'Pappas Toyota' }), source: 'pappas_toyota_2026-09-23.csv' }, diffCols: [1, 19], variantCount: 2 },
        { vin: 'KM8J3CA46LU998877', existing: { row: variant('KM8J3CA46LU998877', { 4: 'Hyundai', 5: 'Tucson', 2: 'CPO' }), source: 'Existing data' }, incoming: { row: variant('KM8J3CA46LU998877', { 4: 'Hyundai', 5: 'Tucson', 2: 'PO', 9: '19495' }), source: 'bommarito_west_county_2026-09-23.csv' }, diffCols: [2, 9], variantCount: 3 }
      ];
      showConflicts({ needsResolution: true, mode: 'merge', conflictsTotal: 3, duplicatesRemoved: 37, droppedOnImport: 5, existingRowCount: 4000, newRowCount: 732, token: '4000|2026/09/23 07:42:10', conflicts: conflicts });
      await sleep(150);
    },
    'import-current-data': async function () {
      await nav('view-import'); await sleep(200);
      showCurrentData();
      await sleep(200);
    },
    'vinlog-all': async function () { await nav('view-vinlog'); await sleep(400); },
    'vinlog-dealer': async function () {
      await nav('view-vinlog'); await sleep(250);
      pick($('vinlogDealerSelect'), F.D);
      await sleep(250);
      var row = document.querySelector('#runsTable tbody tr'); if (row) row.click();
      await sleep(100);
    },
    'vinlog-manual': async function () {
      await nav('view-vinlog'); await sleep(250);
      pick($('vinlogDealerSelect'), F.D);
      await sleep(250);
      toggleManualPanel();
      $('manualVins').value = F.ORDER_VINS.slice(0, 5).join('\n');
      updateVinlogVinCount();
      await sleep(100);
    },
    'vin-inbox': async function () {
      await nav('view-vin-inbox'); await sleep(300);
      var d = document.querySelector('#view-vin-inbox details'); if (d) d.open = true;
      await sleep(150);
    },
    'stack-cleanup': async function () {
      await nav('view-stack-cleanup'); await sleep(150);
      pick($('scDealerSelect'), F.D);
      await sleep(200);
    },
    'eom': async function () { await nav('view-end-of-month'); await sleep(300); },
    'eom-viewer': async function () { await nav('view-end-of-month'); await sleep(300); eomvView(0); await sleep(250); var ds = document.querySelectorAll('#eomViewerBody details'); if (ds[0]) ds[0].open = true; var inner = ds[0] ? ds[0].querySelectorAll('details') : []; if (inner[0]) inner[0].open = true; await sleep(100); },
    'eom-progress': async function () {
      await nav('view-end-of-month'); await sleep(300);
      window.MOCK.generateEomReport = function () { return window.MOCK_NEVER; };
      eomGenerate();
      await sleep(2000);
    },
    'utilities': async function () { await nav('view-utilities'); await sleep(150); },
    'ui-settings': async function () { await nav('view-ui-settings'); await sleep(150); },
    'rules-filter': async function () {
      await nav('view-rules'); await sleep(250);
      pick($('rulesDealerSelect'), F.D);
      await sleep(400);
    },
    'rules-pipedrive': async function () {
      await nav('view-rules'); await sleep(250);
      pick($('rulesDealerSelect'), F.D);
      await sleep(400);
      rulesTab('pipedrive');
      await sleep(300);
    },
    'norm': async function () { await nav('view-norm'); await sleep(250); },
    'datasources': async function () {
      await nav('view-datasources'); await sleep(250);
      pick($('dsDealer'), F.D); await sleep(200);
      pick($('dsSource'), 'Dealer internal CSV'); await sleep(250);
    },
    'pipedrive-settings': async function () { await nav('view-pipedrive-settings'); await sleep(400); },
    'pipedrive-settings-link': async function () {
      await nav('view-pipedrive-settings'); await sleep(400);
      psToggleLinkCard(); psScanDealerOrgs(); await sleep(300);
      $('psLinkCard').scrollIntoView({ block: 'start' }); await sleep(100);
    },
    'pipedrive-settings-install': async function () {
      await nav('view-pipedrive-settings'); await sleep(400);
      pdInstallToggle_(); await sleep(300);
      $('pdInstallCard').scrollIntoView({ block: 'start' }); await sleep(100);
    },
    'pipedrive-settings-rules': async function () {
      await nav('view-pipedrive-settings'); await sleep(400);
      psToggleRulesCard(); await sleep(300);
      $('psRulesBody').scrollIntoView({ block: 'start' }); await sleep(100);
    },
    'rules-filter-targeting': async function () {
      await nav('view-rules'); await sleep(250);
      pick($('rulesDealerSelect'), F.D); await sleep(400);
      $('targetingRulesWrap').scrollIntoView({ block: 'start' }); await sleep(100);
    },
    'rules-pipedrive-overrides': async function () {
      await nav('view-rules'); await sleep(250);
      pick($('rulesDealerSelect'), F.D); await sleep(400);
      rulesTab('pipedrive'); await sleep(300);
      var el = document.querySelector('#view-rules .pd-ovr-card, #view-rules [id*="vr"], #view-rules .pd-overrides');
      if (el) el.scrollIntoView({ block: 'start' }); await sleep(100);
    },
    'home-bottom': async function () {
      await nav('view-home'); await sleep(150);
      pick($('homeDealerSelect'), F.D); await sleep(150);
      $('homeAllTime').scrollIntoView({ block: 'end' }); await sleep(100);
    },
    'fieldcodes': async function () { await nav('view-fieldcodes'); await sleep(250); },
    'csvschemas': async function () { await nav('view-csvschemas'); await sleep(250); },
    'csvschemas-editor': async function () { await nav('view-csvschemas'); await sleep(250); csEnterEditIdx(0); await sleep(150); },
    'add-dealer': async function () {
      await nav('view-add-dealer'); await sleep(250);
      ndPrefill('Joe Machens Nissan', 'JOE_MACHENS_NISSAN');
      await sleep(150);
    },
    'add-dealer-checklist': async function () { await nav('view-add-dealer'); await sleep(250); ndResume(1); await sleep(300); },
    'theme-menu': async function () {
      await nav('view-home'); await sleep(150);
      $('themeBtn').click();
      await sleep(150);
    },
    'toast': async function () {
      await nav('view-home'); await sleep(150);
      toast('Removed 2 duplicate VINs from the order.', 'info');
      toast('Product catalog refreshed from Pipedrive.', 'success');
      toast('Could not load Install Cost config: HTTP 502', 'error');
      await sleep(200);
    }
  };

  window.HARNESS = {
    scenarios: Object.keys(S),
    run: async function (name) {
      window.MOCK_UNKNOWN.length = 0;
      window.HARNESS_ERRORS = [];
      if (!S[name]) throw new Error('unknown scenario ' + name);
      await S[name]();
      await sleep(150);
      return { unknown: window.MOCK_UNKNOWN.slice(), errors: window.HARNESS_ERRORS.slice() };
    }
  };
  window.addEventListener('error', function (e) { (window.HARNESS_ERRORS = window.HARNESS_ERRORS || []).push(String(e.message)); });

  // Theme from the query string (?theme=dark); default light.
  var m = /[?&]theme=([\w-]+)/.exec(location.search);
  if (m && window.Theme) Theme.apply(m[1], false);
  window.HARNESS_READY = true;
})();
