// ============================================================================
// SILVERfox MARKETING — VEHICLE GRAPHIC PRODUCTION SYSTEM V2
// Universal Apps Script — Bound to SF_SYSTEM_MASTER
// ============================================================================
//
// ARCHITECTURE OVERVIEW:
//   This single script replaces ~42 near-identical dealer functions.
//   All dealer-specific config lives in SF_DEALER_CONFIG (external spreadsheet).
//   One universal function — runDealer(dealerKey) — handles every dealer.
//
// KEY IMPROVEMENTS OVER V1:
//   1. Data-driven config (no more copy-pasting functions per dealer)
//   2. Parallel QR code generation via UrlFetchApp.fetchAll() — dramatically faster
//   3. Dynamic CSV column building from schema config (no per-dealer templates)
//   4. Run log written automatically after each run
//   5. Output doc cleanup utility included
//   6. Rollback-safe VIN log appending with confirmation prompt
//
// HOW TO USE:
//   - Open SF_SYSTEM_MASTER in Google Sheets
//   - Go to Extensions > Apps Script
//   - Paste this entire file into the editor (replace existing Code.gs)
//   - Reload the sheet to install the custom menu
//   - Use the "SilverFox V2" menu in the sheet to run dealers
//
// ============================================================================


// ============================================================================
// SECTION 1: GLOBAL CONSTANTS
// ============================================================================

var MASTER_SHEET_ID    = '1G_wrlXVmcUDJ37xr3bDwDHUGUy9ULIbNufq_Xk9xVes';  // SF_SYSTEM_MASTER
var CONFIG_SHEET_ID    = '1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8';   // SF_DEALER_CONFIG
var TEMPLATE_ID        = '14Nk1FL-dfffIoWh9o8Q_EFCNlMXN3jUnlzzZ750QVTc';   // SF_UNIVERSAL_TEMPLATE
var OUTPUT_FOLDER_ID   = '1iRDDlqgQPn9R67AEIUJcF8JmyiOyn8DI';              // Output docs folder
var VIN_LOGS_ID        = '12Xf6dyZXWXp4JwbytGo6lRUShwuGeN0yS3zhbco4-Lk';  // SF_VIN_LOGS (master)
var QR_LOCAL_BASE_PATH = 'C:\\Users\\Nick_Workstation\\Documents\\QRS\\';

// Column indices in the DEALERS tab of SF_DEALER_CONFIG (0-indexed)
var CFG = {
  KEY:               0,
  NAME:              1,
  ORDERS_COL:        2,
  QR_FOLDER_ID:      3,
  OUTPUT_FOLDER:     4,
  USE_STOCK:         5,
  LINKBUILDER_COL:   6,
  UTM_BASE_URL:      7,
  TRANSFORMS:        8,
  SCRAPER_LOCATION:  9,
  QR_PREFIX:         10,
  ACTIVE:            11,
  NOTES:             12,
  PIPEDRIVE_PREFIX:  13,
  TYPE_RULES:        14,
  FILTER_RULES:      22
};

var NORM_COL = { TYPE: 2, TRIM: 6, STATUS: 8, PRICE: 9 };

var NORMALIZATION_MAPS = {
  global: [
    ['&amp;',     '&'],
    ['undefined', '*'],
    ['N/A',       '*']
  ],
  type: [
    ['Certified Used',      'CPO'],
    ['Certified Pre-Owned', 'CPO'],
    ['Certified',           'CPO'],
    ['Pre-Owned',           'PO'],
    ['Used',                'PO'],
    ['new',                 'New']
  ],
  status: [
    ['On-Lot',                     'ONLOT'],
    ['In-Lot',                     'ONLOT'],
    ['InStock',                    'ONLOT'],
    ['In Stock',                   'ONLOT'],
    ['On Lot',                     'ONLOT'],
    ['On The Lot',                 'ONLOT'],
    ['Available',                  'ONLOT'],
    ['Available at Retailer',      'ONLOT'],
    ['In-Transit',                 'OFFLOT'],
    ['In Transit',                 'OFFLOT'],
    ['In Transit to U.S.',         'OFFLOT'],
    ['Allocated',                  'OFFLOT'],
    ['In-Build-Phase',             'OFFLOT'],
    ['Arriving Soon',              'OFFLOT'],
    ['In Production',              'OFFLOT'],
    ['Build Phase',                'OFFLOT'],
    ['Being Built',                'OFFLOT'],
    ['Courtesy Vehicle',           'OFFLOT'],
    ['In-Service Courtesy Vehicle','OFFLOT'],
    ['In-Service FCTP',            'OFFLOT'],
    ['In-service',                 'OFFLOT'],
    ['Dealer Ordered',             'OFFLOT']
  ],
  price: [
    ['<span class="callforprice">Please call for price</span>', 'callforprice']
  ],
  trim: [
    ['4dr Sdn Auto i Touring',                                'Auto i Touring'],
    ['4dr Auto S',                                            'Auto S'],
    ['4dr Sdn Auto',                                          'Auto'],
    ['4dr Sdn Custom',                                        'Custom'],
    ['4dr Sdn 3.0L Luxury RWD',                               '3.0L Luxury'],
    ['FWD 4dr 4-cyl 4-Spd AT',                                'AT'],
    ['AWD 4dr',                                               'AWD'],
    ['4dr Sdn LT w/1LT',                                      'LT w/1LT'],
    ['FWD 4dr Platinum',                                      'Platinum'],
    ['4WD Crew Cab 143.5" SLE',                               'Crew Cab SLE'],
    ['SEL 2.4L Auto AWD',                                     'SEL 2.4L AWD'],
    ['AWD 4dr SL',                                            'AWD SL'],
    ['FWD 4dr SL',                                            'SL'],
    ['4WD Crew Cab 169" Tradesman',                           'Crew Cab Tradesman'],
    ['3.6L V6 SE 4MOTION',                                    'SE 4MOTION'],
    ['4WD Crew Cab 140.5" Big Horn',                          '4WD Big Horn'],
    ['FWD 4dr Luxury',                                        'Luxury'],
    ['2dr Roadster sDrive35i',                                'Roadster sDrive35i'],
    ['2.0T SE w/Technology FWD',                              '2.0T SE w/Tech'],
    ['Sedan 35t Prestige AWD',                                '35t Prestige AWD'],
    ['Premium Plus 45 TFSI quattro',                          'Prem Plus 45 TFSI quattro'],
    ['C 300 4MATIC\u00ae Sedan',                              'C 300 4MATIC\u00ae'],
    ['SH-AWD 7-Passenger w/Technology Pkg',                   'SH-AWD w/Tech Pkg'],
    ['4x4 Gas Crew Cab SL',                                   '4x4 Crew Cab SL'],
    ['4WD Crew Cab 143.5" SLT',                               '4WD Crew Cab SLT'],
    ['2.5 S Premium Package AWD',                             '2.5 S Prem Pkg AWD'],
    ['2.5 Turbo Premium Plus Package AWD',                    '2.5 Turbo Prem Plus AWD'],
    ['2.5 Turbo Premium Plus AWD',                            '2.5 Turbo Prem Plus AWD'],
    ['4WD Crew Cab 147" SLT',                                 '4WD SLT'],
    ['2.5 Turbo Meridian Edition AWD',                        '2.5 Turbo Meridian AWD'],
    ['Premium Plus 55 TFSI quattro',                          'Prem Plus 55 TFSI quattro'],
    ['S line Premium Plus 45 TFSI quattro',                   'S line Prem Plus quattro'],
    ['2.5 S Premium Plus Package AWD',                        '2.5 S Prem Plus Pkg AWD'],
    ["XL 4WD SuperCrew 5.5' Box",                             'XL 4WD SuperCrew'],
    ["Limited 4x4 Crew Cab 5'7\" Box",                        'Limited 4x4 Crew Cab'],
    ['Premium Plus 3.0 TFSI quattro',                         'Prem Plus 3.0 TFSI quattro'],
    ['Premium Plus 4.0 TFSI quattro',                         'Prem Plus 4.0 TFSI quattro'],
    ["STX 4WD SuperCrew 5.5' Box",                            'STX 4WD SuperCrew'],
    ['S line Premium Plus 55 TFSI e quattro',                 'S line Prem Plus e quattro'],
    ['4WD Crew Cab 147" Denali',                              '4WD Crew Cab Denali'],
    ['4WD Crew Cab 159" Denali',                              '4WD Crew Cab Denali'],
    ['4WD 4dr AT4',                                           '4WD AT4'],
    ['4WD 4dr Z71',                                           '4WD Z71'],
    ['4WD 4dr LT',                                            '4WD LT'],
    ['4WD Crew Cab 159" Denali Ultimate',                     '4WD Crew Cab Denali Ultimate'],
    ['4WD Crew Cab 147" Denali Ultimate',                     '4WD Crew Cab Denali Ultimate'],
    ['4WD Crew Cab 159" SLT',                                 '4WD Crew Cab SLT'],
    ['4WD Crew Cab 147" LT',                                  '4WD Crew Cab LT'],
    ['4WD Crew Cab 147" LTZ',                                 '4WD Crew Cab LTZ'],
    ['4WD Crew Cab 147" AT4',                                 '4WD Crew Cab AT4'],
    ['4WD Crew Cab 147" Custom',                              '4WD Crew Cab Custom'],
    ['4WD Crew Cab 159" LT',                                  '4WD Crew Cab LT'],
    ['4WD Crew Cab 159" LTZ',                                 '4WD Crew Cab LTZ'],
    ['4WD Crew Cab 143.5" LT w/2LT',                         '4WD Crew Cab LT w/2LT'],
    ['4WD 4dr Denali Ultimate',                               '4WD Denali Ultimate'],
    ["4WD SuperCab 6.5' Box",                                 '4WD SuperCab'],
    ['2.5 Turbo Premium Plus Package w/Premium Plus Package', '2.5 Turbo Premium Plus'],
    ['2.5 S Preferred Package AWD',                           '2.5 S Preferred AWD'],
    ['2.5 S Select Package AWD',                              '2.5 S Select AWD'],
    ["BIG HORN CREW CAB 4X4 5'7 BOX",                        'BIG HORN CREW CAB 4X4'],
    ["BIG HORN CREW CAB 4X4 6'4 BOX",                        'BIG HORN CREW CAB 4X4'],
    ["BIG HORN CREW CAB 4X4 8' BOX",                         'BIG HORN CREW CAB 4X4'],
    ["BIG HORN CREW CAB 4X2 5'7 BOX",                        'BIG HORN CREW CAB 4X2'],
    ["LARAMIE CREW CAB 4X4 5'7 BOX",                         'LARAMIE CREW CAB 4X4'],
    ["LARAMIE CREW CAB 4X4 6'4 BOX",                         'LARAMIE CREW CAB 4X4'],
    ["LARAMIE CREW CAB 4X4 8' BOX",                          'LARAMIE CREW CAB 4X4'],
    ["LIMITED CREW CAB 4X4 5'7 BOX",                         'LIMITED CREW CAB 4X4'],
    ["LIMITED LONGHORN CREW CAB 4X4 6'4 BOX",                'LIMITED LONGHORN CREW CAB 4X4'],
    ["REBEL CREW CAB 4X4 5'7 BOX",                           'REBEL CREW CAB 4X4'],
    ["REBEL CREW CAB 4X4 6'4 BOX",                           'REBEL CREW CAB 4X4'],
    ["TRADESMAN CREW CAB 4X4 5'7 BOX",                       'TRADESMAN CREW CAB 4X4'],
    ["TRADESMAN CREW CAB 4X4 6'4 BOX",                       'TRADESMAN CREW CAB 4X4'],
    ["TRADESMAN CREW CAB 4X4 8' BOX",                        'TRADESMAN CREW CAB 4X4'],
    ["TRADESMAN QUAD CAB 4X4 6'4 BOX",                       'TRADESMAN QUAD CAB 4X4'],
    ["TRADESMAN REGULAR CAB 4X4 8' BOX",                     'TRADESMAN REGULAR CAB 4X4'],
    ["TRADESMAN  CREW  4X4 60' CA",                           'TRADESMAN CREW 4X4'],
    ["Tradesman 4x4 Crew Cab 8' Box",                         'Tradesman 4x4 Crew Cab'],
    ['Tradesman Crew Cab 4x4 8 Box',                          'Tradesman Crew Cab 4x4'],
    ["EXPRESS CREW CAB 4X4 5'7 BOX",                         'EXPRESS CREW CAB 4X4'],
    ["BLACK EXPRESS CREW CAB 4X4 6'4 BOX",                   'BLACK EXPRESS CREW CAB 4X4'],
    ["WARLOCK CREW CAB 4X4 5'7 BOX",                         'WARLOCK CREW CAB 4X4'],
    ["RHO CREW CAB 4X4 5'7 BOX",                             'RHO CREW CAB 4X4'],
    ["4-DOOR WILLYS '41",                                     "WILLYS '41"],
    ['4-DOOR RUBICON',                                        'RUBICON'],
    ["PROMASTER 1500 TRADESMAN CARGO VAN LOW ROOF 118' W",   '1500 TRADESMAN CARGO VAN'],
    ["PROMASTER 1500 TRADESMAN CARGO VAN HIGH ROOF 136'",    'PROMASTER 1500 TRADESMAN HIGH ROOF'],
    ["PROMASTER 2500 TRADESMAN CARGO VAN HIGH ROOF 159'",    '2500 TRADESMAN CARGO VAN'],
    ["PROMASTER 2500 SLT CARGO VAN HIGH ROOF 159' WB",       'PROMASTER 2500 SLT HIGH ROOF'],
    ["PROMASTER 3500 TRADESMAN CARGO VAN HIGH ROOF 159'",    '3500 TRADESMAN CARGO VAN'],
    ['PROMASTER 3500 TRADESMAN CARGO VAN SUPER HIGH ROOF',   '3500 TRADESMAN CARGO VAN'],
    ['PROMASTER EV SUPER HIGH ROOF 159\u00e2 WB EXT',        'EV SUPER HIGH ROOF'],
    ['T-250 148" Med Rf 9070 GVWR RWD',                      'T-250 MED ROOF 9070 GVWR'],
    ['T-250 148" EL Hi Rf 9070 GVWR RWD',                    'T-250 EL HI ROOF 9070 GVWR'],
    ['T-250 148" Med Rf 9150 GVWR RWD',                      'T-250'],
    ['T-250 130" Low Rf 9000 GVWR Swing-Out RH Dr',          'T-250 130" Low Rf'],
    ['T-350 148" Low Rf 9950 GVWR RWD',                      'T-350 LOW ROOF 9950 GVWR'],
    ['T-350 148" Med Roof XLT RWD',                           'T-350 Med Roof XLT RWD'],
    ['Transit Passenger Wagon',                               'Transit'],
    ['4WD XLT w/HD Payload Pkg SuperCrew',                   '4WD XLT SuperCrew'],
    ["XLT 4WD SuperCrew 5.5' Box",                            'XLT 4WD SuperCrew'],
    ["LARIAT 4WD SuperCrew 5.5' Box",                         'LARIAT 4WD SuperCrew'],
    ["Platinum 4WD SuperCrew 5.5' Box",                       'Platinum 4WD SuperCrew'],
    ["Tremor 4WD SuperCrew 5.5' Box",                         'Tremor 4WD SuperCrew'],
    ["Limited 4WD SuperCrew 5.5' Box",                        'Limited 4WD SuperCrew'],
    ["XL 4WD Crew Cab 6.75' Box",                             'XL 4WD Crew Cab'],
    ["XLT 4WD Crew Cab 6.75' Box",                            'XLT 4WD Crew Cab'],
    ["XLT 4WD Crew Cab 8' Box",                               'XLT 4WD Crew Cab'],
    ["LARIAT 4WD Crew Cab 6.75' Box",                         'LARIAT 4WD Crew Cab'],
    ["Platinum 4WD Crew Cab 6.75' Box",                       'Platinum 4WD Crew Cab'],
    ["King Ranch 4WD Crew Cab 8' Box",                        'King Ranch 4WD Crew Cab'],
    ["LARIAT 2WD SuperCab 6.5' Box",                          'LARIAT 2WD SuperCab'],
    ["XL 4WD Reg Cab 6.5' Box",                               'XL 4WD Reg Cab'],
    ['XL 4WD Reg Cab 193" WB 108" CA',                       'XL 4WD Reg Cab'],
    ["XL 2WD Reg Cab 6.5' Box",                               'XL 2WD Reg Cab'],
    ['XL 2WD Reg Cab 169" WB 84" CA',                        'XL 2WD Reg Cab'],
    ['XLT 4WD Reg Cab 145" WB 60" CA',                       'XLT 4WD Reg Cab'],
    ['4WD Ext Cab 128" Work Truck',                           '4WD Ext Cab Work Truck'],
    ['Work Truck w/Knapheide Bed Conversion',                 'Work Truck w/Knapheide'],
    ['w/Knapheide Bed Conversion',                            'w/Knapheide'],
    ['Pro w/Knapheide Bed Conversion',                        'Pro w/Knapheide'],
    ["SR5 Double Cab 5' Bed V6 4x4 AT (Natl)",               'SR5 Double Cab 4x4 AT'],
    ["SR5 CrewMax 5.5' Bed 5.7L (Natl)",                     'SR5 CrewMax 5.7L (Natl)'],
    ['AWD 4dr V6 Limited Platinum (Natl)',                    'AWD Limited Platinum'],
    ['Cooper Hardtop 4 Door',                                 'Cooper Hardtop'],
    ['Civic Sdn',                                             'Civic'],
    ['Civic Hatchback Hybrid',                                'Civic Hybrid'],
    ['Civic Sedan Hybrid',                                    'Civic Hybrid'],
    ['3.6L V6 SEL Premium R-Line',                            'SEL Premium R-Line'],
    ['3.6L V6 SE w/Technology',                               'SE w/Technology'],
    ['3.6L V6 SE w/Technology R-Line',                        'SE w/Technology R-Line'],
    ['Latitude w/Sun/Wheel Pkg',                              'Latitude'],
    ['4dr Sdn SEL FWD',                                       'SEL FWD'],
    ['4dr Sdn Platinum V-sport AWD',                          'Platinum V-sport AWD'],
    ['Big Horn%2FLone Star',                                  'Big Horn/Lone Star'],
    ["Big Horn/Lone Star 4x4 Crew Cab 5'7\" Box",            'Big Horn/Lone Star 4x4 Crew Cab'],
    ['Plaid Tri Motor All-Wheel Drive',                       'Plaid Tri Motor AWD']
  ]
};


// ============================================================================
// SECTION 2: BOOLEAN HELPER
// ============================================================================

function isTrue_(val) {
  return val === true || String(val).toUpperCase() === 'TRUE';
}


// ============================================================================
// SECTION 3: ENTRY POINTS & MENU
// ============================================================================

function onOpen() {
  var ui   = SpreadsheetApp.getUi();
  var menu = ui.createMenu('SilverFox V2');
  menu.addItem('Run Dealer...', 'promptRunDealer');
  menu.addSeparator();
  menu.addItem('Import Scraper Data...', 'openScraperImport');
  menu.addItem('Update Scraper Timestamp', 'fillScraperDateTime');
  menu.addSeparator();
  menu.addItem('Update VIN Log...', 'openVINLogUpdater');
  menu.addSeparator();
  menu.addItem('Clear QR Folders (all active dealers)', 'eraseAllQRFolders');
  menu.addItem('Clean Up Old Output Docs', 'cleanUpOutputDocs');
  menu.addSeparator();
  menu.addItem('View Run Log', 'openRunLog');
  menu.addSeparator();
  menu.addItem('Manage Normalization Maps...', 'openNormManager');
  menu.addToUi();
}

function promptRunDealer() {
  var html = HtmlService.createHtmlOutputFromFile('DealerSelector')
    .setWidth(580)
    .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Run Dealer');
}

function openScraperImport() {
  var html = HtmlService.createHtmlOutputFromFile('ScraperImport')
    .setTitle('Import Scraper Data')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

function importScraperData(mappedData) {
  if (!mappedData || mappedData.length === 0) {
    throw new Error('No data received.');
  }

  var ss    = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName('SCRAPERDATA');

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 21).clearContent();
  }

  normalizeScraperData_(mappedData);
  var review = computeImportReview_(mappedData);

  sheet.getRange(2, 1, mappedData.length, 2).setNumberFormat('@');
  sheet.getRange(2, 10, mappedData.length, 1).setNumberFormat('@');
  sheet.getRange(2, 14, mappedData.length, 1).setNumberFormat('@');

  sheet.getRange(2, 1, mappedData.length, 21).setValues(mappedData);

  sheet.getRange(2, 1, mappedData.length, 2).setNumberFormat('@');
  sheet.getRange(2, 10, mappedData.length, 1).setNumberFormat('@');
  sheet.getRange(2, 14, mappedData.length, 1).setNumberFormat('@');

  var colCount = 0;
  for (var c = 0; c < 21; c++) {
    for (var r = 0; r < mappedData.length; r++) {
      if (mappedData[r][c] !== '') { colCount++; break; }
    }
  }

  fillScraperDateTime();
  return { rowCount: mappedData.length, colCount: colCount, review: review };
}

function getActiveDealersForUI() {
  var data = SpreadsheetApp.openById(CONFIG_SHEET_ID)
    .getSheetByName('DEALERS').getDataRange().getValues();
  var dealers = [];
  for (var i = 1; i < data.length; i++) {
    if (isTrue_(data[i][CFG.ACTIVE])) {
      dealers.push({ key: data[i][CFG.KEY], name: data[i][CFG.NAME] });
    }
  }
  return dealers;
}

function pasteVinsAndRun(dealerKey, vins, dealId, runId, bypassFilters) {
  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);
  if (!dealId || String(dealId).trim() === '') throw new Error('Pipedrive Deal ID is required.');

  var colLetter = config[CFG.ORDERS_COL];
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ORDERS');

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(colLetter + '2:' + colLetter + lastRow).clearContent();
  }

  var writeData = vins.map(function(v) { return [v]; });
  var range = sheet.getRange(colLetter + '2:' + colLetter + (vins.length + 1));
  range.setValues(writeData);
  range.setNumberFormat('@');
  SpreadsheetApp.flush();

  return runDealer(dealerKey, String(dealId).trim(), runId || null, bypassFilters === true);
}

function runDealer(dealerKey, dealId, runId, bypassFilters) {
  var startTime = new Date();
  var errors    = [];

  try {
    setProgress_(runId, 'Loading dealer config...', 5);
    var config = getDealerConfig_(dealerKey);
    if (!config) throw new Error('Dealer key not found: ' + dealerKey);
    if (!isTrue_(config[CFG.ACTIVE])) throw new Error('Dealer is marked inactive: ' + dealerKey);
    Logger.log('Starting run for: ' + config[CFG.NAME]);

    var typeRules = getTypeRules_(config);
    Logger.log('Type rules: ' + JSON.stringify(typeRules));

    var vins = getOrderVINs_(config[CFG.ORDERS_COL]);
    if (!vins || vins.length === 0) throw new Error('No VINs found in ORDERS column ' + config[CFG.ORDERS_COL]);
    Logger.log('VINs to process: ' + vins.length);

    setProgress_(runId, 'Copying output template...', 10);
    var outputFolderId = config[CFG.OUTPUT_FOLDER] || OUTPUT_FOLDER_ID;
    var outputDoc = copyTemplateToFolder_(TEMPLATE_ID, outputFolderId);
    var outputDocName = config[CFG.NAME] + ' ' + Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd') + ' Order';
    outputDoc.rename(outputDocName);
    Logger.log('Output doc created: ' + outputDoc.getId());

    writeConfigCache_(outputDoc, config);

    setProgress_(runId, 'Pasting ' + vins.length + ' VIN' + (vins.length === 1 ? '' : 's') + ' into order...', 18);
    pasteOrderVINs_(outputDoc, vins);

    setProgress_(runId, 'Loading scraper data for ' + config[CFG.NAME] + '...', 24);
    var scraperData = getDealerScraperData_(config[CFG.SCRAPER_LOCATION]);
    setProgress_(runId, 'Pasting ' + scraperData.length + ' inventory rows...', 30);
    pasteScraperData_(outputDoc, scraperData);

    if (config[CFG.TRANSFORMS]) {
      setProgress_(runId, 'Applying data transforms...', 34);
      applyDataTransforms_(outputDoc, config[CFG.TRANSFORMS]);
    }

    if (!bypassFilters) {
      var filterRules = getDealerFilterRules_(config);
      var scraperLookup = {};
      scraperData.forEach(function(row) {
        var v = String(row[0]).trim();
        var s = String(row[1]).trim();
        if (v) scraperLookup[v] = row;
        if (s) scraperLookup[s] = row;
      });

      var passedVins   = [];
      var rejectedVins = [];

      vins.forEach(function(identifier) {
        var scraperRow = scraperLookup[String(identifier).trim()];
        if (!scraperRow) { passedVins.push(identifier); return; }
        var result = applyFilteringRules_([scraperRow], filterRules);
        if (result.passed.length > 0) {
          passedVins.push(identifier);
        } else {
          rejectedVins.push(identifier + ' (' + result.rejected[0].reason + ')');
        }
      });

      if (rejectedVins.length > 0) {
        Logger.log('Output filter removed ' + rejectedVins.length + ' VIN(s): ' + rejectedVins.join(', '));
        setProgress_(runId, 'Filtered out ' + rejectedVins.length + ' vehicle' +
          (rejectedVins.length === 1 ? '' : 's') + ' with missing data...', 37);
      }

      vins = passedVins;

      if (vins.length === 0) {
        throw new Error('All ' + rejectedVins.length + ' vehicle' +
          (rejectedVins.length === 1 ? '' : 's') +
          ' were removed by filtering rules (' + rejectedVins.join('; ') + '). ' +
          'Check filtering rules or enable "Bypass filtering rules" in the Run Dealer modal.');
      }
    } else {
      Logger.log('Filtering rules bypassed for this run.');
    }

    setProgress_(runId, 'Running ORDERMATCH query...', 38);
    writeOrderMatchFormula_(outputDoc, vins, isTrue_(config[CFG.USE_STOCK]));
    SpreadsheetApp.flush();
    Utilities.sleep(3000);
    var matchedRows = readOrderMatchResults_(outputDoc);
    Logger.log('Matched rows: ' + matchedRows.length);

    setProgress_(runId, 'Copying VIN log (' + matchedRows.length + ' matched)...', 50);
    copyVINLogToOutput_(outputDoc, dealerKey);

    setProgress_(runId, 'Building link formulas...', 56);
    var links    = buildLinks_(outputDoc, config, typeRules);
    setProgress_(runId, 'Generating ' + links.length + ' QR code' + (links.length === 1 ? '' : 's') + ' (parallel)...', 64);
    var qrFolder = DriveApp.getFolderById(config[CFG.QR_FOLDER_ID]);
    generateQRCodesParallel_(links, qrFolder, config[CFG.QR_PREFIX]);
    Logger.log('QR codes generated: ' + links.length);

    setProgress_(runId, links.length + ' QR codes complete. Writing paths...', 82);
    writeQRPaths_(outputDoc, config[CFG.QR_PREFIX], links.length);

    setProgress_(runId, 'Building CSV output...', 88);
    buildCSVSheet_(outputDoc, typeRules);

    // 14. Write BILLING sheet from ORDERMATCH + LOG data
    setProgress_(runId, 'Writing billing sheet...', 91);
    writeBillingSheet_(outputDoc);

    // 15. Read billing totals back from the sheet we just wrote
    setProgress_(runId, 'Reading billing totals...', 93);
    SpreadsheetApp.flush();
    var billingTotals = readBillingTotals_(outputDoc);

    setProgress_(runId, 'Reading produced VINs...', 95);
    var omSheet     = outputDoc.getSheetByName('ORDERMATCH');
    var omLastRow   = omSheet.getLastRow();
    var producedVins = [];
    if (omLastRow >= 2) {
      producedVins = omSheet.getRange(2, 5, omLastRow - 1, 1).getValues()
        .map(function(r) { return String(r[0]).trim(); })
        .filter(function(v) { return v !== ''; });
    }

    setProgress_(runId, 'Writing run log...', 97);
    var duration       = Math.round((new Date() - startTime) / 1000);
    var runLogRowIndex = writeRunLog_(config, dealId, vins.length, matchedRows.length,
                                     billingTotals, outputDoc.getId(), duration, errors, producedVins);

    setProgressDone_(runId, 'Complete! ' + producedVins.length + ' VIN' +
                     (producedVins.length === 1 ? '' : 's') + ' produced in ' + duration + 's.');

    return {
      outputFolderUrl:  'https://drive.google.com/drive/folders/' + outputFolderId,
      runLogRowIndex:   runLogRowIndex,
      dealerName:       config[CFG.NAME],
      producedVinCount: producedVins.length
    };

  } catch (e) {
    setProgressError_(runId, e.message);
    handleError_(e);
    errors.push(e.message);
    return null;
  }
}


// ============================================================================
// SECTION 4: CONFIG LOADER
// ============================================================================

function getDealerConfig_(dealerKey) {
  var data = SpreadsheetApp.openById(CONFIG_SHEET_ID)
    .getSheetByName('DEALERS').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][CFG.KEY] === dealerKey) return data[i];
  }
  return null;
}

function getActiveDealerKeys_() {
  var data = SpreadsheetApp.openById(CONFIG_SHEET_ID)
    .getSheetByName('DEALERS').getDataRange().getValues();
  return data.slice(1)
    .filter(function(r) { return isTrue_(r[CFG.ACTIVE]); })
    .map(function(r)    { return r[CFG.KEY]; });
}

function getCsvSchema_(schemaKey) {
  var data = SpreadsheetApp.openById(CONFIG_SHEET_ID)
    .getSheetByName('CSV_SCHEMAS').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === schemaKey) {
      return data[i].slice(2).filter(function(v) { return v !== ''; });
    }
  }
  return null;
}


// ============================================================================
// SECTION 5: ORDER & SCRAPER DATA
// ============================================================================

function getOrderVINs_(colLetter) {
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ORDERS');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(colLetter + '2:' + colLetter + lastRow).getValues()
    .map(function(r)    { return String(r[0]).trim(); })
    .filter(function(v) { return v !== '' && v !== 'undefined'; });
}

function getDealerScraperData_(scraperLocationName) {
  var sheet   = SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName('SCRAPERDATA');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var locationCol = sheet.getRange(2, 20, lastRow - 1, 1).getValues();
  var firstMatch = -1;
  var lastMatch  = -1;
  for (var i = 0; i < locationCol.length; i++) {
    if (String(locationCol[i][0]).trim() === scraperLocationName) {
      if (firstMatch === -1) firstMatch = i;
      lastMatch = i;
    }
  }

  if (firstMatch === -1) return [];

  var sheetFirstRow = firstMatch + 2;
  var spanRows      = lastMatch - firstMatch + 1;
  var data = sheet.getRange(sheetFirstRow, 1, spanRows, 21).getValues();

  return data.filter(function(row) {
    return String(row[19]).trim() === scraperLocationName;
  });
}

function pasteOrderVINs_(outputDoc, vins) {
  var sheet = outputDoc.getSheetByName('ORDER');
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).clearContent();
  var range = sheet.getRange(2, 1, vins.length, 1);
  range.setValues(vins.map(function(v) { return [v]; }));
  range.setNumberFormat('@');
}

function pasteScraperData_(outputDoc, data) {
  var sheet = outputDoc.getSheetByName('SCRAPERDATA');
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 21).clearContent();
  if (data.length > 0) {
    var cleanData = data.map(function(row) {
      var r = row.slice();
      r[0] = String(r[0]);
      r[1] = String(r[1]);
      return r;
    });
    sheet.getRange(2, 1, cleanData.length, 2).setNumberFormat('@');
    sheet.getRange(2, 1, cleanData.length, 21).setValues(cleanData);
    sheet.getRange(2, 1, cleanData.length, 2).setNumberFormat('@');
    sheet.getRange(2, 10, cleanData.length, 1).setNumberFormat('@');
    sheet.getRange(2, 14, cleanData.length, 1).setNumberFormat('@');
  }
}


// ============================================================================
// SECTION 5.5: SCRAPER DATA NORMALIZATION
// ============================================================================

function normalizeCell_(value, map) {
  var str   = String(value).trim();
  var lower = str.toLowerCase();
  for (var i = 0; i < map.length; i++) {
    if (lower === map[i][0].toLowerCase()) return map[i][1];
  }
  return str;
}

function normalizeScraperData_(rows) {
  var maps      = loadNormalizationMaps_();
  var globalMap = maps.global;
  var colMaps   = {};
  colMaps[NORM_COL.TYPE]   = maps.type;
  colMaps[NORM_COL.TRIM]   = maps.trim;
  colMaps[NORM_COL.STATUS] = maps.status;
  colMaps[NORM_COL.PRICE]  = maps.price;

  for (var r = 0; r < rows.length; r++) {
    for (var c = 0; c < rows[r].length; c++) {
      var val = normalizeCell_(rows[r][c], globalMap);
      if (colMaps[c]) val = normalizeCell_(val, colMaps[c]);
      rows[r][c] = (val === '') ? '*' : val;
    }
  }
  return rows;
}

function computeImportReview_(rows) {
  var TYPE_COL = 2, STATUS_COL = 8, LOCATION_COL = 19;
  var total = 0, typeCounts = {}, statusCounts = {}, locationTypeCounts = {};

  for (var i = 0; i < rows.length; i++) {
    var vin = String(rows[i][0]).trim();
    if (vin === '' || vin === '*') continue;
    var type     = String(rows[i][TYPE_COL]).trim();
    var status   = String(rows[i][STATUS_COL]).trim();
    var location = String(rows[i][LOCATION_COL]).trim();
    total++;
    typeCounts[type]     = (typeCounts[type]     || 0) + 1;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (!locationTypeCounts[location]) locationTypeCounts[location] = {};
    locationTypeCounts[location][type] = (locationTypeCounts[location][type] || 0) + 1;
  }

  return { total: total, typeCounts: typeCounts, statusCounts: statusCounts, locationTypeCounts: locationTypeCounts };
}


// ============================================================================
// SECTION 6: DATA TRANSFORMS
// ============================================================================

function applyDataTransforms_(outputDoc, transformsJson) {
  if (!transformsJson || transformsJson.trim() === '') return;
  var rules;
  try { rules = JSON.parse(transformsJson); } catch(e) { Logger.log('Transform parse error: ' + e.message); return; }

  var sheet   = outputDoc.getSheetByName('SCRAPERDATA');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var MODEL_COL = 6, TRIM_COL = 7;
  var models = sheet.getRange(2, MODEL_COL, lastRow - 1, 1).getValues();
  var trims  = sheet.getRange(2, TRIM_COL,  lastRow - 1, 1).getValues();

  (rules.replacements || []).forEach(function(rule) {
    for (var i = 0; i < models.length; i++) {
      if (rule.col === 'model' && rule.find && String(models[i][0]) === rule.find) {
        if (rule.model_replace) models[i][0] = rule.model_replace;
        if (rule.trim_prepend)  trims[i][0]  = rule.trim_prepend + ' ' + String(trims[i][0]);
      }
      if (rule.col === 'trim' && rule.remove) {
        rule.remove.forEach(function(s) { trims[i][0] = String(trims[i][0]).replace(s, '').trim(); });
      }
    }
  });

  sheet.getRange(2, MODEL_COL, lastRow - 1, 1).setValues(models);
  sheet.getRange(2, TRIM_COL,  lastRow - 1, 1).setValues(trims);
}


// ============================================================================
// SECTION 7: ORDERMATCH FORMULA
// ============================================================================

function writeOrderMatchFormula_(outputDoc, vins, useStock) {
  var sheet    = outputDoc.getSheetByName('ORDERMATCH');
  var matchCol = useStock ? 'B' : 'A';
  var pattern  = vins.map(function(v) { return v.replace(/'/g, "\\'"); }).join('|');
  var query    = "SELECT D, E, F, G, A, B, C, J, U WHERE " + matchCol + " MATCHES '" + pattern + "'";
  sheet.getRange('A2').setFormula('=IFERROR(QUERY(SCRAPERDATA!$A:$U,"' + query + '",0),"")');
}

function readOrderMatchResults_(outputDoc) {
  var sheet   = outputDoc.getSheetByName('ORDERMATCH');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 18).getValues()
    .filter(function(row) { return String(row[0]).trim() !== ''; });
}


// ============================================================================
// SECTION 8: LINK BUILDING
// ============================================================================

function buildLinks_(outputDoc, config, typeRules) {
  writeLinkBuilderFormulas_(outputDoc, config, typeRules);
  SpreadsheetApp.flush();
  Utilities.sleep(2000);

  var sheet   = outputDoc.getSheetByName('LINKBUILDER');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var readCol = (config[CFG.LINKBUILDER_COL] === 'C') ? 3 : 2;
  return sheet.getRange(2, readCol, lastRow - 1, 1).getValues()
    .map(function(r)    { return String(r[0]).trim(); })
    .filter(function(v) { return v !== '' && v.indexOf('http') === 0; });
}

function writeLinkBuilderFormulas_(outputDoc, config, typeRules) {
  var lbSheet = outputDoc.getSheetByName('LINKBUILDER');
  var omSheet = outputDoc.getSheetByName('ORDERMATCH');
  var lastRow = omSheet.getLastRow();
  if (lastRow < 2) return;

  var numRows       = lastRow - 1;
  var baseOverride  = config[CFG.UTM_BASE_URL];
  var isSingleRule  = typeRules.length === 1;

  if (lbSheet.getLastRow() > 1) lbSheet.getRange(2, 1, lbSheet.getLastRow() - 1, 3).clearContent();

  var formulasA = [], formulasB = [];
  for (var i = 0; i < numRows; i++) {
    var omRow   = i + 2;
    var linkRef = 'A' + (i + 2);
    var typeRef = 'ORDERMATCH!G' + omRow;

    formulasA.push(['=IFERROR(ORDERMATCH!I' + omRow + ',"")']);

    if (baseOverride && baseOverride !== '') {
      formulasB.push(['=IF(' + linkRef + '="","","' + baseOverride + '"&ORDERMATCH!E' + omRow + ')']);
    } else if (isSingleRule) {
      var utm = typeRules[0].utm;
      formulasB.push(['=IF(' + linkRef + '="","",' + linkRef + '&"?utm_source=SilverFox&utm_medium=' + utm + '")']);
    } else {
      formulasB.push([buildUtmFormula_(linkRef, typeRef, typeRules)]);
    }
  }

  lbSheet.getRange(2, 1, numRows, 1).setFormulas(formulasA);
  lbSheet.getRange(2, 2, numRows, 1).setFormulas(formulasB);
}


// ============================================================================
// SECTION 9: QR CODE GENERATION (PARALLEL)
// ============================================================================

function generateQRCodesParallel_(links, qrFolder, qrPrefix) {
  if (!links || links.length === 0) return;

  var requests = links.map(function(url) {
    return {
      url:                'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(url),
      method:             'GET',
      muteHttpExceptions: true
    };
  });

  var responses = UrlFetchApp.fetchAll(requests);

  responses.forEach(function(response, i) {
    if (response.getResponseCode() === 200) {
      var fileName = qrPrefix + '_QR_Code_' + (i + 1) + '.PNG';
      qrFolder.createFile(response.getBlob().setName(fileName).setContentType('image/png'));
    } else {
      Logger.log('QR failed for index ' + (i + 1) + ': HTTP ' + response.getResponseCode());
    }
  });
}

function clearQRFolder_(folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var files  = folder.getFiles();
  while (files.hasNext()) files.next().setTrashed(true);
}

function eraseAllQRFolders() {
  var data    = SpreadsheetApp.openById(CONFIG_SHEET_ID)
    .getSheetByName('DEALERS').getDataRange().getValues();
  var cleared = 0;
  for (var i = 1; i < data.length; i++) {
    if (isTrue_(data[i][CFG.ACTIVE]) && data[i][CFG.QR_FOLDER_ID] !== '[QR_FOLDER_ID]') {
      try { clearQRFolder_(data[i][CFG.QR_FOLDER_ID]); cleared++; }
      catch(e) { Logger.log('QR folder clear failed: ' + data[i][CFG.KEY] + ' — ' + e.message); }
    }
  }
  SpreadsheetApp.getUi().alert('Cleared QR folders for ' + cleared + ' active dealers.');
}


// ============================================================================
// SECTION 10: QR PATH WRITING
// ============================================================================

function writeQRPaths_(outputDoc, qrPrefix, count) {
  var sheet = outputDoc.getSheetByName('ORDERMATCH');
  var paths = [];
  for (var i = 1; i <= count; i++) {
    paths.push([QR_LOCAL_BASE_PATH + qrPrefix + '_QR_Code_' + i + '.PNG']);
  }
  if (paths.length > 0) {
    var range = sheet.getRange(2, 10, paths.length, 1);
    range.setValues(paths);
    range.setNumberFormat('@');
  }
}


// ============================================================================
// SECTION 11: TYPE RULES ENGINE
// ============================================================================

function getTypeRules_(config) {
  var raw = config[CFG.TYPE_RULES];
  if (raw && String(raw).trim() !== '') {
    try { return JSON.parse(raw); } catch(e) { Logger.log('type_rules parse error: ' + e.message); }
  }
  Logger.log('WARNING: No valid type_rules for ' + config[CFG.KEY] + '. Using SCP default.');
  return [{ match: '*', csv_schema: 'SCP', utm: 'VDP_ShortCut' }];
}

function matchRule_(vehicleType, rules) {
  var type = String(vehicleType).toLowerCase();
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].match === '*') return rules[i];
    if (type.indexOf(String(rules[i].match).toLowerCase()) !== -1) return rules[i];
  }
  return rules[rules.length - 1];
}

function buildUtmFormula_(linkRef, typeRef, rules) {
  var base        = '?utm_source=SilverFox&utm_medium=';
  var defaultRule = rules[rules.length - 1];
  var defaultExpr = linkRef + '&"' + base + defaultRule.utm + '"';
  var inner       = defaultExpr;

  for (var i = rules.length - 2; i >= 0; i--) {
    var rule = rules[i];
    if (rule.match === '*') continue;
    var condition = 'ISNUMBER(SEARCH("' + rule.match + '",' + typeRef + '))';
    var trueExpr  = linkRef + '&"' + base + rule.utm + '"';
    inner = 'IF(' + condition + ',' + trueExpr + ',' + inner + ')';
  }

  return '=IF(' + linkRef + '="","",'+  inner + ')';
}


// ============================================================================
// SECTION 12: DYNAMIC CSV BUILDER
// ============================================================================

var FIELD_TO_COL = {
  'YEAR':               1,  'MAKE':               2,  'MODEL':              3,
  'TRIM':               4,  'VIN':                5,  'STOCK':              6,
  'TYPE':               7,  'PRICE_RAW':          8,  '@QR':                10,
  '@QR2':               10, 'YEARMAKE':           11, 'YEARMODEL':          12,
  'QRYEARMODEL':        12, 'MAKE_MODEL_COMBINED':13, 'QRSTOCK':            14,
  'MISC':               15, 'PRICE_FMT':          16, 'NEWYEARMAKE':        17,
  'TYPEVIN':            18, 'YEARMODELSTOCK':     19, 'PRICE_PLUS_2000':    20
};

function buildCSVSheet_(outputDoc, typeRules) {
  var omSheet = outputDoc.getSheetByName('ORDERMATCH');
  var lastRow = omSheet.getLastRow();
  if (lastRow < 2) { Logger.log('No ORDERMATCH data for CSV.'); return; }

  var omData = omSheet.getRange(2, 1, lastRow - 1, 100).getValues()
    .filter(function(row) { return String(row[0]).trim() !== ''; });

  var isSingleRule = typeRules.length === 1;
  var groups = {};
  typeRules.forEach(function(rule) { groups[rule.match] = []; });

  omData.forEach(function(row) {
    var rule = matchRule_(String(row[6]), typeRules);
    groups[rule.match].push(row);
  });

  typeRules.forEach(function(rule) {
    var rows        = groups[rule.match] || [];
    var fieldCodes  = getCsvSchema_(rule.csv_schema) || getCsvSchema_('SCP');
    var sheetName   = isSingleRule ? 'CSV' : 'CSV_' + String(rule.match).replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    var dataRows    = rows.map(function(row) {
      return fieldCodes.map(function(code) {
        var col = FIELD_TO_COL[code];
        return col ? row[col - 1] : '';
      });
    });
    var displayHeaders = dedupFieldCodeHeaders_(fieldCodes);
    writeCSVSheet_(outputDoc, sheetName, displayHeaders, dataRows);
    Logger.log('CSV sheet "' + sheetName + '" written: ' + dataRows.length + ' rows, schema: ' + rule.csv_schema);
  });
}

/**
 * Takes an array of field code names (as they appear in the schema) and returns
 * a parallel array of display header names for the CSV sheet.
 *
 * Duplicate field codes are suffixed with an incrementing number starting at 2.
 * Example: ['YEARMODELSTOCK', 'TYPEVIN', 'YEARMODELSTOCK', 'TYPEVIN', 'YEARMODELSTOCK']
 *       -> ['YEARMODELSTOCK', 'TYPEVIN', 'YEARMODELSTOCK2', 'TYPEVIN2', 'YEARMODELSTOCK3']
 *
 * The data lookup (FIELD_TO_COL) always uses the original field code names,
 * so data values are unaffected — only the header row in the output sheet changes.
 */
function dedupFieldCodeHeaders_(fieldCodes) {
  var seen    = {};
  var headers = [];
  for (var i = 0; i < fieldCodes.length; i++) {
    var code = fieldCodes[i];
    if (!seen[code]) {
      seen[code] = 1;
      headers.push(code);
    } else {
      seen[code]++;
      headers.push(code + seen[code]);
    }
  }
  return headers;
}

function writeCSVSheet_(outputDoc, sheetName, headers, rows) {
  var sheet = outputDoc.getSheetByName(sheetName) || outputDoc.insertSheet(sheetName);
  sheet.clearContents();
  if (headers.length > 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(1, 1, rows.length + 1, headers.length).setNumberFormat('@');
  }
}


// ============================================================================
// SECTION 13: VIN LOG HANDLING
// ============================================================================

function copyVINLogToOutput_(outputDoc, dealerKey) {
  var vinLogSS  = SpreadsheetApp.openById(VIN_LOGS_ID);
  var logSheet  = vinLogSS.getSheetByName(dealerKey);
  if (!logSheet) { Logger.log('No VIN log tab found for: ' + dealerKey); return; }
  var lastRow   = logSheet.getLastRow();
  if (lastRow < 1) return;
  var data      = logSheet.getRange(1, 1, lastRow, 2).getValues();
  var target    = outputDoc.getSheetByName('LOG');
  target.clearContents();
  target.getRange(1, 1, data.length, 2).setValues(data);
}


// ============================================================================
// SECTION 14: RUN LOG
// ============================================================================

function writeRunLog_(config, dealId, totalOrdered, totalMatched, billing, outputDocId, durationSec, errors, producedVins) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
  var producedVinsCSV = Array.isArray(producedVins) ? producedVins.join(',') : '';
  sheet.appendRow([
    Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss'),
    config[CFG.KEY], config[CFG.NAME], dealId || '',
    totalOrdered, totalMatched,
    billing.totalNew      || 0, billing.totalUsed     || 0,
    billing.newDupes      || 0, billing.usedDupes     || 0,
    billing.totalDupes    || 0, billing.totalProduced || 0,
    '', outputDocId, durationSec,
    errors.join('; ') || '', '', producedVinsCSV, ''
  ]);
  return sheet.getLastRow();
}


// ============================================================================
// SECTION 15: BILLING SHEET WRITER + READER
// ============================================================================

/**
 * Builds the BILLING sheet in the output doc from scratch.
 *
 * CHANGELOG (this session):
 *   - Sections 2 & 3 are now STATIC: all four canonical types (New, PO, CPO,
 *     CPO-EL) always get a row. Types with zero matches show 0. Row positions
 *     are consistent across every run regardless of what types appear.
 *   - Row padding fix: all rows are padded to maxCols before setValues() to
 *     prevent "data has N but range has M" errors when duplicate detail rows
 *     (8 cols) coexist with summary rows (4 cols).
 */
function writeBillingSheet_(outputDoc) {
  var billingSheet = outputDoc.getSheetByName('BILLING');
  var omSheet      = outputDoc.getSheetByName('ORDERMATCH');
  var logSheet     = outputDoc.getSheetByName('LOG');
  var orderSheet   = outputDoc.getSheetByName('ORDER');

  if (!billingSheet || !omSheet || !logSheet || !orderSheet) {
    Logger.log('writeBillingSheet_: missing required sheet(s), skipping.');
    return;
  }

  // ── 1. Read ORDER tab ────────────────────────────────────────────────────
  var orderVals = orderSheet.getRange('A2:A').getValues()
    .map(function(r) { return String(r[0] || '').trim().toUpperCase(); })
    .filter(function(v) { return v !== ''; });
  var totalOrdered = orderVals.length;

  // ── 2. Read ORDERMATCH ───────────────────────────────────────────────────
  var omAll  = omSheet.getDataRange().getValues();
  var omRows = [];
  for (var i = 1; i < omAll.length; i++) {
    var r = omAll[i];
    if (r[0] === '' || r[0] === null || r[0] === undefined) break;
    omRows.push({
      year:  r[0],
      make:  String(r[1] || '').trim(),
      model: String(r[2] || '').trim(),
      trim:  String(r[3] || '').trim(),
      vin:   String(r[4] || '').trim().toUpperCase(),
      stock: String(r[5] || '').trim().toUpperCase(),
      type:  String(r[6] || '').trim(),
      url:   String(r[8] || '').trim()
    });
  }

  // ── 3. Not found ─────────────────────────────────────────────────────────
  var matchedVins = {}, matchedStocks = {};
  omRows.forEach(function(v) { matchedVins[v.vin] = true; matchedStocks[v.stock] = true; });
  var notFoundList = orderVals.filter(function(id) { return !matchedVins[id] && !matchedStocks[id]; });

  // ── 4. Read LOG → dupe map ───────────────────────────────────────────────
  var logAll = logSheet.getDataRange().getValues();
  var logMap = {};
  for (var j = 1; j < logAll.length; j++) {
    var orderId    = String(logAll[j][0] || '').trim();
    var identifier = String(logAll[j][1] || '').trim().toUpperCase();
    if (!orderId || !identifier) continue;
    if (!logMap[identifier]) logMap[identifier] = [];
    if (logMap[identifier].indexOf(orderId) === -1) logMap[identifier].push(orderId);
  }

  // ── 5. Classify vehicles + find dupes ────────────────────────────────────
  var TYPE_ORDER  = ['New', 'PO', 'CPO', 'CPO-EL'];
  var typeGroups  = {};
  var dupeDetails = [];

  omRows.forEach(function(vehicle) {
    var type = vehicle.type || 'Unknown';
    if (!typeGroups[type]) typeGroups[type] = { total: 0, dupes: 0 };
    typeGroups[type].total++;

    var allOrders = [];
    (logMap[vehicle.vin] || []).concat(logMap[vehicle.stock] || []).forEach(function(o) {
      if (allOrders.indexOf(o) === -1) allOrders.push(o);
    });

    if (allOrders.length > 0) {
      typeGroups[type].dupes++;
      dupeDetails.push({
        year: vehicle.year, make: vehicle.make, model: vehicle.model,
        stock: vehicle.stock, vin: vehicle.vin, url: vehicle.url,
        orderNums: allOrders.join(', ')
      });
    }
  });

  // ── 6. Totals ────────────────────────────────────────────────────────────
  var totalMatched = omRows.length;
  var totalDupes   = 0;
  Object.keys(typeGroups).forEach(function(t) { totalDupes += typeGroups[t].dupes; });
  var totalNetNew  = totalMatched - totalDupes;

  var unexpectedTypes = Object.keys(typeGroups).filter(function(t) {
    return TYPE_ORDER.indexOf(t) === -1;
  });

  // ── 7. Build rows ────────────────────────────────────────────────────────
  var BLANK = ['', '', '', ''];
  var rows  = [];

  // Section 1 — Order Summary
  rows.push(['', '── ORDER SUMMARY ──', '', '']);
  rows.push(['', 'Total Ordered',            totalOrdered, '']);
  rows.push(['', 'Total Matched in Scraper', totalMatched, '']);
  rows.push(['', 'Not Found in Scraper',     notFoundList.length,
             notFoundList.length > 0 ? notFoundList.join(', ') : '—']);
  rows.push(BLANK);

  // Section 2 — Matched by Type (gross) — STATIC: always all 4 types, 0 if absent
  rows.push(['', '── BY TYPE (GROSS) ──', '', '']);
  var typeCheckSum = 0;
  TYPE_ORDER.forEach(function(t) {
    var total = typeGroups[t] ? typeGroups[t].total : 0;
    rows.push(['', t, total, '']);
    typeCheckSum += total;
  });
  unexpectedTypes.forEach(function(t) {
    rows.push(['', t + ' ⚠ (unexpected type)', typeGroups[t].total, 'Check NORM_MAPS']);
    typeCheckSum += typeGroups[t].total;
  });
  rows.push(['', 'Total Matched (check)', typeCheckSum,
             typeCheckSum === totalMatched ? '✓' : '⚠ mismatch — check ORDERMATCH']);
  rows.push(BLANK);

  // Section 3 — Duplicates by Type — STATIC: always all 4 types, 0 if absent
  rows.push(['', '── DUPLICATES BY TYPE ──', '', '']);
  TYPE_ORDER.forEach(function(t) {
    var dupes = typeGroups[t] ? typeGroups[t].dupes : 0;
    rows.push(['', t + ' Dupes', dupes, '']);
  });
  unexpectedTypes.forEach(function(t) {
    if (typeGroups[t] && typeGroups[t].dupes > 0) {
      rows.push(['', t + ' Dupes ⚠', typeGroups[t].dupes, '']);
    }
  });
  rows.push(['', 'Total Duplicates',        totalDupes,  '']);
  rows.push(['', 'Total Produced (Net New)', totalNetNew, '']);
  rows.push(BLANK);

  // Section 4 — Duplicate Detail Table
  if (dupeDetails.length > 0) {
    rows.push(['', '── DUPLICATE DETAIL ──', '', '', '', '', '', '']);
    rows.push(['', 'Year', 'Make', 'Model', 'Stock', 'VIN', 'URL', 'Prior Order #s']);
    dupeDetails.forEach(function(d) {
      rows.push(['', d.year, d.make, d.model, d.stock, d.vin, d.url, d.orderNums]);
    });
  } else {
    rows.push(['', '── DUPLICATE DETAIL ──', '', '']);
    rows.push(['', 'No duplicates in this order.', '', '']);
  }

  // ── 8. Write — pad all rows to maxCols first ─────────────────────────────
  billingSheet.clearContents();
  if (rows.length === 0) return;

  var maxCols = 4;
  rows.forEach(function(r) { if (r.length > maxCols) maxCols = r.length; });

  var paddedRows = rows.map(function(r) {
    var padded = r.slice();
    while (padded.length < maxCols) padded.push('');
    return padded;
  });

  billingSheet.getRange(1, 1, paddedRows.length, maxCols).setValues(paddedRows);

  Logger.log('writeBillingSheet_: ' + totalOrdered + ' ordered, ' +
             totalMatched + ' matched, ' + totalDupes + ' dupes.');
}

/**
 * Reads summary totals from BILLING by label (not hard-coded cell addresses).
 */
function readBillingTotals_(outputDoc) {
  var sheet    = outputDoc.getSheetByName('BILLING');
  var defaults = { totalOrdered: 0, totalMatched: 0, totalNew: 0, totalUsed: 0,
                   newDupes: 0, usedDupes: 0, totalDupes: 0, totalProduced: 0 };
  try {
    var data     = sheet.getDataRange().getValues();
    var result   = {};
    var labelMap = {
      'Total Ordered':            'totalOrdered',
      'Total Matched in Scraper': 'totalMatched',
      'New':                      'totalNew',
      'PO':                       'totalUsed',
      'New Dupes':                'newDupes',
      'PO Dupes':                 'usedDupes',
      'Total Duplicates':         'totalDupes',
      'Total Produced (Net New)': 'totalProduced'
    };
    data.forEach(function(row) {
      var label = String(row[1] || '').trim();
      if (labelMap[label] !== undefined) result[labelMap[label]] = Number(row[2]) || 0;
    });
    Object.keys(defaults).forEach(function(k) { if (result[k] === undefined) result[k] = defaults[k]; });
    return result;
  } catch(e) {
    Logger.log('readBillingTotals_ error: ' + e.message);
    return defaults;
  }
}


// ============================================================================
// SECTION 16: TEMPLATE & OUTPUT FOLDER UTILITIES
// ============================================================================

function copyTemplateToFolder_(templateId, folderId) {
  var copy   = DriveApp.getFileById(templateId).makeCopy(DriveApp.getFolderById(folderId));
  var rootIt = DriveApp.getRootFolder().getFilesByName(copy.getName());
  while (rootIt.hasNext()) {
    var f = rootIt.next();
    if (f.getId() === copy.getId()) DriveApp.getRootFolder().removeFile(f);
  }
  return SpreadsheetApp.openById(copy.getId());
}

function cleanUpOutputDocs(daysOld) {
  daysOld = daysOld || 30;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  var files = DriveApp.getFolderById(OUTPUT_FOLDER_ID).getFiles();
  var count = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getLastUpdated() < cutoff) { f.setTrashed(true); count++; }
  }
  SpreadsheetApp.getUi().alert('Trashed ' + count + ' output docs older than ' + daysOld + ' days.');
}


// ============================================================================
// SECTION 17: CONFIG CACHE
// ============================================================================

function writeConfigCache_(outputDoc, config) {
  var sheet = outputDoc.getSheetByName('_CONFIG_CACHE');
  if (!sheet) return;
  sheet.getRange('A6:H6').setValues([[
    'dealer_key', 'dealer_name', 'use_stock_not_vin', 'linkbuilder_col',
    'type_rules', 'data_transforms', 'utm_base_url_override', 'run_timestamp'
  ]]);
  sheet.getRange('A7:H7').setValues([[
    config[CFG.KEY], config[CFG.NAME], config[CFG.USE_STOCK], config[CFG.LINKBUILDER_COL],
    config[CFG.TYPE_RULES], config[CFG.TRANSFORMS], config[CFG.UTM_BASE_URL],
    Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss')
  ]]);
}


// ============================================================================
// SECTION 18: UTILITIES
// ============================================================================

function fillScraperDateTime() {
  var ss  = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var now = new Date();
  var d   = Utilities.formatDate(now, 'America/Chicago', 'yyyy/MM/dd');
  var t   = Utilities.formatDate(now, 'America/Chicago', 'HH:mm:ss');
  ss.getSheetByName('SCRAPERDATA').getRange('W1').setValue(d);
  ss.getSheetByName('SCRAPERDATA').getRange('X1').setValue(t);
  ss.getSheetByName('HELPERS').getRange('A1').setValue(d);
  ss.getSheetByName('HELPERS').getRange('B1').setValue(t);
}

function onEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== 'SCRAPERDATA') return;
  if (e.range.getRow() !== 1) return;
  var col = e.range.getColumn();
  if (col !== 23 && col !== 24) return;
  if (e.range.getValue() !== '') return;
  var helpers = e.source.getSheetByName('HELPERS');
  sheet.getRange('W1').setValue(helpers.getRange('A1').getValue());
  sheet.getRange('X1').setValue(helpers.getRange('B1').getValue());
}

function openRunLog() {
  SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName('RUN_LOG').activate();
}

function handleError_(e) {
  Logger.log('ERROR: ' + e.message + '\nSTACK: ' + e.stack);
  try { SpreadsheetApp.getUi().alert('Error: ' + e.message + '\n\nSee View > Logs for details.'); } catch(u) {}
}


// ============================================================================
// SECTION 19: AUDIT
// ============================================================================

function auditConfigPlaceholders() {
  var data = SpreadsheetApp.openById(CONFIG_SHEET_ID)
    .getSheetByName('DEALERS').getDataRange().getValues();
  var incomplete = [];
  for (var i = 1; i < data.length; i++) {
    if (!isTrue_(data[i][CFG.ACTIVE])) continue;
    var missing = [];
    if (!data[i][CFG.QR_FOLDER_ID]     || data[i][CFG.QR_FOLDER_ID]     === '[QR_FOLDER_ID]') missing.push('qr_folder_id');
    if (!data[i][CFG.SCRAPER_LOCATION]  || data[i][CFG.SCRAPER_LOCATION]  === '')              missing.push('scraper_location_name');
    if (!data[i][CFG.TYPE_RULES]        || data[i][CFG.TYPE_RULES]        === '')              missing.push('type_rules');
    if (!data[i][CFG.FILTER_RULES]      || data[i][CFG.FILTER_RULES]      === '')              missing.push('filtering_rules');
    if (missing.length > 0) incomplete.push(data[i][CFG.KEY] + ': ' + missing.join(', '));
  }
  var msg = incomplete.length === 0
    ? 'All active dealers configured. Ready to go!'
    : incomplete.length + ' dealers need attention:\n\n' + incomplete.join('\n');
  SpreadsheetApp.getUi().alert(msg);
}


// ============================================================================
// SECTION 20: NORMALIZATION MAP MANAGER
// ============================================================================

var NORM_MAPS_TAB = 'NORM_MAPS';

function openNormManager() {
  var html = HtmlService.createHtmlOutputFromFile('NormManager')
    .setWidth(740)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Normalization Maps');
}

function getNormMapsSheet_() {
  return SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName(NORM_MAPS_TAB);
}

function loadNormalizationMaps_() {
  var sheet = getNormMapsSheet_();
  if (!sheet) return NORMALIZATION_MAPS;

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return NORMALIZATION_MAPS;

  var maps = { global: [], type: [], trim: [], status: [], price: [] };

  for (var i = 1; i < data.length; i++) {
    var mapName = String(data[i][0]).trim().toLowerCase();
    var input   = String(data[i][1]);
    var output  = String(data[i][2]);
    if (!mapName || input === '') continue;
    if (!maps[mapName]) maps[mapName] = [];
    maps[mapName].push([input, output]);
  }

  Object.keys(NORMALIZATION_MAPS).forEach(function(key) {
    if (!maps[key] || maps[key].length === 0) maps[key] = NORMALIZATION_MAPS[key];
  });

  return maps;
}

function getNormEntries(mapName) {
  var sheet = getNormMapsSheet_();
  if (!sheet) return [];
  var data    = sheet.getDataRange().getValues();
  var entries = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === mapName.toLowerCase()) {
      entries.push({ sheetRow: i + 1, input: String(data[i][1]), output: String(data[i][2]) });
    }
  }
  return entries;
}

function addNormEntry(mapName, rawVal, normVal) {
  rawVal  = String(rawVal).trim();
  normVal = String(normVal).trim();
  if (!rawVal || !normVal) throw new Error('Both raw and normalized values are required.');
  var sheet = getNormMapsSheet_();
  if (!sheet) throw new Error('NORM_MAPS tab not found.');
  var data    = sheet.getDataRange().getValues();
  var lastRow = 1;
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim().toLowerCase() === mapName.toLowerCase()) { lastRow = i + 1; break; }
  }
  sheet.insertRowAfter(lastRow);
  sheet.getRange(lastRow + 1, 1, 1, 3).setValues([[mapName, rawVal, normVal]]);
  return getNormEntries(mapName);
}

function updateNormEntry(sheetRow, newInput, newOutput) {
  newInput  = String(newInput).trim();
  newOutput = String(newOutput).trim();
  if (!newInput || !newOutput) throw new Error('Both values are required.');
  var sheet   = getNormMapsSheet_();
  if (!sheet) throw new Error('NORM_MAPS tab not found.');
  var mapName = String(sheet.getRange(sheetRow, 1).getValue()).trim().toLowerCase();
  sheet.getRange(sheetRow, 2, 1, 2).setValues([[newInput, newOutput]]);
  return getNormEntries(mapName);
}

function deleteNormEntry(sheetRow) {
  var sheet = getNormMapsSheet_();
  if (!sheet) throw new Error('NORM_MAPS tab not found.');
  var mapName = String(sheet.getRange(sheetRow, 1).getValue()).trim().toLowerCase();
  sheet.deleteRow(sheetRow);
  return getNormEntries(mapName);
}

function moveNormEntry(sheetRow, direction) {
  var sheet   = getNormMapsSheet_();
  if (!sheet) throw new Error('NORM_MAPS tab not found.');
  var mapName = String(sheet.getRange(sheetRow, 1).getValue()).trim().toLowerCase();
  var entries = getNormEntries(mapName);
  var idx     = -1;
  for (var i = 0; i < entries.length; i++) { if (entries[i].sheetRow === sheetRow) { idx = i; break; } }
  if (idx === -1) throw new Error('Entry not found.');
  var targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= entries.length) return entries;
  var targetRow  = entries[targetIdx].sheetRow;
  var thisVals   = sheet.getRange(sheetRow,  2, 1, 2).getValues();
  var targetVals = sheet.getRange(targetRow, 2, 1, 2).getValues();
  sheet.getRange(sheetRow,  2, 1, 2).setValues(targetVals);
  sheet.getRange(targetRow, 2, 1, 2).setValues(thisVals);
  return getNormEntries(mapName);
}


// ============================================================================
// SECTION 21: FILTERING RULES ENGINE
// ============================================================================

function getDealerFilterRules_(config) {
  var defaults = { allowedTypes: null, excludeStatus: [], requireStock: false,
                   requirePrice: false, minPrice: null, maxPrice: null, seasoning: [] };
  var raw = config[CFG.FILTER_RULES];
  if (!raw || String(raw).trim() === '' || String(raw).trim() === '{}') return defaults;
  var parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { Logger.log('filtering_rules parse error for ' + config[CFG.KEY] + ': ' + e.message); return defaults; }
  return {
    allowedTypes:  Array.isArray(parsed.allowed_types)   ? parsed.allowed_types  : null,
    excludeStatus: Array.isArray(parsed.exclude_status)  ? parsed.exclude_status : [],
    requireStock:  parsed.require_stock === true,
    requirePrice:  parsed.require_price === true,
    minPrice:      (typeof parsed.min_price === 'number') ? parsed.min_price     : null,
    maxPrice:      (typeof parsed.max_price === 'number') ? parsed.max_price     : null,
    seasoning:     Array.isArray(parsed.seasoning)       ? parsed.seasoning      : []
  };
}

function applyFilteringRules_(vehicles, filterRules) {
  var passed = [], rejected = [];
  var today  = new Date();
  today.setHours(0, 0, 0, 0);

  var seasoningMap = {};
  filterRules.seasoning.forEach(function(rule) {
    seasoningMap[String(rule.type).toLowerCase()] = Number(rule.days) || 0;
  });

  vehicles.forEach(function(row) {
    var vin    = String(row[0]).trim();
    var stock  = String(row[1]).trim();
    var type   = String(row[2]).trim();
    var status = String(row[8]).trim();
    var price  = parseFloat(row[9]);
    var dateIn = row[13];

    if (filterRules.requireStock && (stock === '' || stock === '*')) {
      rejected.push({ row: row, reason: 'no_stock', detail: vin }); return;
    }
    if (filterRules.requirePrice && (isNaN(price) || price <= 0)) {
      rejected.push({ row: row, reason: 'no_price', detail: vin }); return;
    }
    if (filterRules.allowedTypes !== null) {
      var typeAllowed = filterRules.allowedTypes.some(function(t) {
        return String(t).toLowerCase() === type.toLowerCase();
      });
      if (!typeAllowed) { rejected.push({ row: row, reason: 'type', detail: type }); return; }
    }
    if (filterRules.excludeStatus.length > 0) {
      var statusExcluded = filterRules.excludeStatus.some(function(s) {
        return String(s).toLowerCase() === status.toLowerCase();
      });
      if (statusExcluded) { rejected.push({ row: row, reason: 'status', detail: status }); return; }
    }
    if (filterRules.minPrice !== null && !isNaN(price) && price < filterRules.minPrice) {
      rejected.push({ row: row, reason: 'price_low', detail: '$' + price }); return;
    }
    if (filterRules.maxPrice !== null && !isNaN(price) && price > filterRules.maxPrice) {
      rejected.push({ row: row, reason: 'price_high', detail: '$' + price }); return;
    }

    var typeLower = type.toLowerCase(), requiredDays = null;
    if (seasoningMap.hasOwnProperty(typeLower)) {
      requiredDays = seasoningMap[typeLower];
    } else {
      Object.keys(seasoningMap).forEach(function(rt) {
        if (typeLower.indexOf(rt) !== -1) requiredDays = seasoningMap[rt];
      });
    }
    if (requiredDays !== null && requiredDays > 0) {
      var dateObj = parseDateInStock_(dateIn);
      if (dateObj !== null) {
        var daysOnLot = Math.floor((today - dateObj) / 86400000);
        if (daysOnLot < requiredDays) {
          rejected.push({ row: row, reason: 'seasoning',
            detail: daysOnLot + ' day' + (daysOnLot === 1 ? '' : 's') + ' on lot, need ' + requiredDays });
          return;
        }
      }
    }

    passed.push(row);
  });

  return { passed: passed, rejected: rejected };
}

function parseDateInStock_(val) {
  if (!val || val === '*' || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  var str = String(val).trim();
  if (str === '' || str === '*') return null;
  var d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  var parts = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (parts) {
    d = new Date(parseInt(parts[3]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}


// ============================================================================
// SECTION 22: CAO PRE-FILL
// ============================================================================

function getCaoVins(dealerKey) {
  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);
  var locationName = config[CFG.SCRAPER_LOCATION];
  if (!locationName || String(locationName).trim() === '') {
    throw new Error('No scraper_location_name configured for ' + dealerKey + '.');
  }

  var allVehicles    = getDealerScraperData_(locationName);
  var totalInventory = allVehicles.length;
  var emptyBreakdown = { no_stock: 0, no_price: 0, type: 0, status: 0, price_low: 0, price_high: 0, seasoning: 0 };

  if (totalInventory === 0) {
    return { vins: [], summary: { totalInventory: 0, afterFiltering: 0, alreadyPrinted: 0, netNew: 0, rejectionBreakdown: emptyBreakdown } };
  }

  var filterRules  = getDealerFilterRules_(config);
  var filterResult = applyFilteringRules_(allVehicles, filterRules);
  var filtered     = filterResult.passed;

  var breakdown = { no_stock: 0, no_price: 0, type: 0, status: 0, price_low: 0, price_high: 0, seasoning: 0 };
  filterResult.rejected.forEach(function(r) { if (breakdown.hasOwnProperty(r.reason)) breakdown[r.reason]++; });

  var loggedVins = getLoggedVins_(dealerKey);
  var useStock   = isTrue_(config[CFG.USE_STOCK]);
  var netNew     = [], printedCount = 0;

  filtered.forEach(function(row) {
    var vin = String(row[0]).trim(), stock = String(row[1]).trim();
    if (loggedVins[vin] || loggedVins[stock]) { printedCount++; }
    else { netNew.push(useStock ? stock : vin); }
  });

  return {
    vins: netNew,
    summary: { totalInventory: totalInventory, afterFiltering: filtered.length,
               alreadyPrinted: printedCount, netNew: netNew.length, rejectionBreakdown: breakdown }
  };
}

function getLoggedVins_(dealerKey) {
  var logSS  = SpreadsheetApp.openById(VIN_LOGS_ID);
  var sheet  = logSS.getSheetByName(dealerKey);
  var logged = {};
  if (!sheet) { Logger.log('No VIN log tab found for: ' + dealerKey + '. Treating as empty log.'); return logged; }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return logged;
  sheet.getRange(2, 2, lastRow - 1, 1).getValues().forEach(function(r) {
    var v = String(r[0]).trim();
    if (v !== '') logged[v] = true;
  });
  return logged;
}


// ============================================================================
// SECTION 23: VIN LOG — COMMIT / ROLLBACK
// ============================================================================

function openVINLogUpdater() {
  var html = HtmlService.createHtmlOutputFromFile('VINLogUpdater')
    .setWidth(660)
    .setHeight(540);
  SpreadsheetApp.getUi().showModalDialog(html, 'Update VIN Log');
}

function getRunsForDealer(dealerKey) {
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, 19).getValues();
  var runs = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[1]).trim() !== dealerKey) continue;
    var rawTimestamp    = row[0];
    var dealId          = String(row[3]).trim();
    var producedVinsCSV = String(row[17]).trim();
    var status          = String(row[18]).trim();
    var vins = producedVinsCSV
      ? producedVinsCSV.split(',').map(function(v) { return v.trim(); }).filter(function(v) { return v !== ''; })
      : [];
    var timestampStr = rawTimestamp instanceof Date
      ? Utilities.formatDate(rawTimestamp, 'America/Chicago', 'yyyy-MM-dd HH:mm:ss')
      : String(rawTimestamp).trim();
    runs.push({ rowIndex: i + 2, timestamp: timestampStr, dealId: dealId,
                vinCount: vins.length, status: status || 'pending', producedVins: vins });
  }
  runs.reverse();
  return runs;
}

function commitRunToVINLog(dealerKey, runRowIndex, dealId, producedVins) {
  if (!producedVins || producedVins.length === 0) throw new Error('No VINs to commit for this run.');
  var logSS    = SpreadsheetApp.openById(VIN_LOGS_ID);
  var logSheet = logSS.getSheetByName(dealerKey);
  if (!logSheet) throw new Error('No VIN log tab found for: ' + dealerKey);
  var committedAt = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
  var appendData  = producedVins.map(function(vin) { return [dealId, vin, committedAt]; });
  logSheet.getRange(logSheet.getLastRow() + 1, 1, appendData.length, 3).setValues(appendData);
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG').getRange(runRowIndex, 19).setValue('committed');
  return { committed: producedVins.length };
}

function rollbackRunFromVINLog(dealerKey, runRowIndex, dealId, committedAt) {
  var logSS    = SpreadsheetApp.openById(VIN_LOGS_ID);
  var logSheet = logSS.getSheetByName(dealerKey);
  if (!logSheet) throw new Error('No VIN log tab found for: ' + dealerKey);
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return { removed: 0 };
  var data = logSheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var toDelete = [];
  for (var i = 0; i < data.length; i++) {
    var rowDealId = String(data[i][0]).trim();
    var rowCAt    = data[i][2] instanceof Date
      ? Utilities.formatDate(data[i][2], 'America/Chicago', 'yyyy-MM-dd HH:mm:ss')
      : String(data[i][2]).trim();
    if (rowDealId === String(dealId).trim() && rowCAt === String(committedAt).trim()) toDelete.push(i + 2);
  }
  for (var d = toDelete.length - 1; d >= 0; d--) logSheet.deleteRow(toDelete[d]);
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG').getRange(runRowIndex, 19).setValue('rolled_back');
  return { removed: toDelete.length };
}

function commitLatestRun(dealerKey, runRowIndex) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
  var row   = sheet.getRange(runRowIndex, 1, 1, 19).getValues()[0];
  var dealId          = String(row[3]).trim();
  var producedVinsCSV = String(row[17]).trim();
  var status          = String(row[18]).trim();
  if (status === 'committed') throw new Error('This run has already been committed to the VIN log.');
  var producedVins = producedVinsCSV
    ? producedVinsCSV.split(',').map(function(v) { return v.trim(); }).filter(Boolean)
    : [];
  if (producedVins.length === 0) throw new Error('No produced VINs found for this run.');
  if (!dealId)                   throw new Error('No Deal ID on this run log entry.');
  return commitRunToVINLog(dealerKey, runRowIndex, dealId, producedVins);
}

function getCommittedAt(dealerKey, dealId) {
  var logSS    = SpreadsheetApp.openById(VIN_LOGS_ID);
  var logSheet = logSS.getSheetByName(dealerKey);
  if (!logSheet) return null;
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return null;
  var data = logSheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]).trim() === String(dealId).trim()) {
      var ts = data[i][2];
      return ts instanceof Date
        ? Utilities.formatDate(ts, 'America/Chicago', 'yyyy-MM-dd HH:mm:ss')
        : String(ts).trim() || null;
    }
  }
  return null;
}


// ============================================================================
// SECTION 24: ONE-TIME SETUP
// ============================================================================

function addCommittedAtHeaders() {
  var ss = SpreadsheetApp.openById(VIN_LOGS_ID), sheets = ss.getSheets(), skip = ['README', 'Sheet1'], updated = 0;
  sheets.forEach(function(sheet) {
    var name = sheet.getName();
    if (skip.indexOf(name) !== -1 || name.charAt(0) === '_') return;
    sheet.getRange('C1').setValue('committed_at');
    updated++;
  });
  SpreadsheetApp.getUi().alert('Done. Added committed_at header to ' + updated + ' VIN log tabs.');
}


// ============================================================================
// SECTION 25: RUN PROGRESS TRACKING
// ============================================================================

function setProgress_(runId, message, percent) {
  if (!runId) return;
  PropertiesService.getScriptProperties().setProperty(
    'run_progress_' + runId,
    JSON.stringify({ message: message, percent: percent, done: false, error: null })
  );
}

function setProgressDone_(runId, message) {
  if (!runId) return;
  PropertiesService.getScriptProperties().setProperty(
    'run_progress_' + runId,
    JSON.stringify({ message: message, percent: 100, done: true, error: null })
  );
}

function setProgressError_(runId, errorMessage) {
  if (!runId) return;
  PropertiesService.getScriptProperties().setProperty(
    'run_progress_' + runId,
    JSON.stringify({ message: 'Error: ' + errorMessage, percent: 0, done: true, error: errorMessage })
  );
}

function getRunProgress(runId) {
  var raw = PropertiesService.getScriptProperties().getProperty('run_progress_' + runId);
  if (!raw) return { message: 'Starting...', percent: 0, done: false, error: null };
  try { return JSON.parse(raw); }
  catch(e) { return { message: 'Starting...', percent: 0, done: false, error: null }; }
}

function clearRunProgress(runId) {
  if (!runId) return;
  PropertiesService.getScriptProperties().deleteProperty('run_progress_' + runId);
}


// ============================================================================
// SECTION 26: VIN LOG — MANUAL ENTRY & LATEST ORDER LOOKUP
// ============================================================================

/**
 * Returns the most recent ORDER_ID from col A of the dealer's VIN log.
 * Reads the log directly — not the RUN_LOG — so manually-submitted orders
 * are always reflected immediately.
 *
 * @param {string} dealerKey
 * @returns {{ latestOrderId: string|null }}
 */
function getLatestOrderId(dealerKey) {
  var logSS = SpreadsheetApp.openById(VIN_LOGS_ID);
  var sheet = logSS.getSheetByName(dealerKey);
  if (!sheet) return { latestOrderId: null };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { latestOrderId: null };
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var val = String(values[i][0]).trim();
    if (val !== '' && val !== 'ORDER_ID') return { latestOrderId: val };
  }
  return { latestOrderId: null };
}

/**
 * Manually appends VINs to a dealer's VIN log without touching the RUN_LOG.
 * Writes: col A = orderId, col B = VIN (uppercased), col C = committed_at timestamp.
 *
 * @param {string}   dealerKey
 * @param {string}   orderId
 * @param {string[]} vins
 * @returns {{ committed: number }}
 */
function manualCommitToVINLog(dealerKey, orderId, vins) {
  if (!dealerKey) throw new Error('No dealer key provided.');
  if (!orderId || String(orderId).trim() === '') throw new Error('Order number is required.');
  if (!vins || vins.length === 0) throw new Error('No VINs provided.');
  var logSS  = SpreadsheetApp.openById(VIN_LOGS_ID);
  var sheet  = logSS.getSheetByName(dealerKey);
  if (!sheet) throw new Error('No VIN log tab found for: ' + dealerKey);
  var seen = {}, cleaned = [];
  vins.forEach(function(v) {
    var upper = String(v).trim().toUpperCase();
    if (upper !== '' && !seen[upper]) { seen[upper] = true; cleaned.push(upper); }
  });
  if (cleaned.length === 0) throw new Error('No valid VINs after deduplication.');
  var committedAt = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
  var appendData  = cleaned.map(function(vin) { return [String(orderId).trim(), vin, committedAt]; });
  sheet.getRange(sheet.getLastRow() + 1, 1, appendData.length, 3).setValues(appendData);
  Logger.log('manualCommitToVINLog: wrote ' + cleaned.length + ' VINs to ' + dealerKey + ' under order ' + orderId);
  return { committed: cleaned.length };
}


// ============================================================================
// SECTION 27: DEALER RULES EDITOR
// ============================================================================

function openRulesEditor() {
  var html = HtmlService.createHtmlOutputFromFile('RulesEditor')
    .setWidth(680)
    .setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, 'Edit Dealer Rules');
}

function getRulesEditorBootstrap() {
  var configSS   = SpreadsheetApp.openById(CONFIG_SHEET_ID);
  var dealerData = configSS.getSheetByName('DEALERS').getDataRange().getValues();
  var dealers    = [];
  for (var i = 1; i < dealerData.length; i++) {
    if (isTrue_(dealerData[i][CFG.ACTIVE])) dealers.push({ key: dealerData[i][CFG.KEY], name: dealerData[i][CFG.NAME] });
  }
  var schemaData = configSS.getSheetByName('CSV_SCHEMAS').getDataRange().getValues();
  var schemas    = [];
  for (var j = 1; j < schemaData.length; j++) {
    var key = String(schemaData[j][0]).trim();
    if (key !== '') schemas.push(key);
  }
  return { dealers: dealers, schemas: schemas };
}

function getDealerRulesData(dealerKey) {
  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);
  var typeRules = [];
  if (config[CFG.TYPE_RULES] && String(config[CFG.TYPE_RULES]).trim() !== '') {
    try { typeRules = JSON.parse(config[CFG.TYPE_RULES]); } catch(e) {}
  }
  var filteringRules = {};
  var rawFilter = config[CFG.FILTER_RULES];
  if (rawFilter && String(rawFilter).trim() !== '' && String(rawFilter).trim() !== '{}') {
    try { filteringRules = JSON.parse(rawFilter); } catch(e) {}
  }
  return { dealerName: config[CFG.NAME], typeRules: typeRules, filteringRules: filteringRules };
}

function saveDealerTypeRules(dealerKey, typeRulesJson) {
  try { JSON.parse(typeRulesJson); } catch(e) { throw new Error('Invalid type_rules JSON: ' + e.message); }
  var sheet = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName('DEALERS');
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][CFG.KEY] === dealerKey) {
      sheet.getRange(i + 1, CFG.TYPE_RULES + 1).setValue(typeRulesJson);
      Logger.log('saveDealerTypeRules: wrote type_rules for ' + dealerKey);
      return;
    }
  }
  throw new Error('Dealer key not found in DEALERS tab: ' + dealerKey);
}

function saveDealerFilterRules(dealerKey, filteringRulesJson) {
  try { JSON.parse(filteringRulesJson); } catch(e) { throw new Error('Invalid filtering_rules JSON: ' + e.message); }
  var sheet = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName('DEALERS');
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][CFG.KEY] === dealerKey) {
      sheet.getRange(i + 1, CFG.FILTER_RULES + 1).setValue(filteringRulesJson);
      Logger.log('saveDealerFilterRules: wrote filtering_rules for ' + dealerKey);
      return;
    }
  }
  throw new Error('Dealer key not found in DEALERS tab: ' + dealerKey);
}


// ============================================================================
// SECTION 28: USER PROFILES
// ============================================================================
//
// Manages the USER_PROFILES tab in SF_DEALER_CONFIG.
// Tab columns: A=user_key, B=display_name, C=qr_local_base_path
// To add a user: append a row. No code changes required.
// ============================================================================

var USER_PROFILES_TAB = 'USER_PROFILES';

function getUserProfiles() {
  var sheet = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName(USER_PROFILES_TAB);
  if (!sheet) throw new Error('USER_PROFILES tab not found in SF_DEALER_CONFIG.');
  var rows = sheet.getDataRange().getValues();
  var profiles = [];
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][0]).trim(), name = String(rows[i][1]).trim();
    if (key !== '') profiles.push({ key: key, name: name });
  }
  return profiles;
}

function getUserProfilesForModal() {
  return { profiles: getUserProfiles(), lastUser: getLastSelectedUser() };
}

function getQRBasePathForUser_(userKey) {
  var sheet = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName(USER_PROFILES_TAB);
  if (!sheet) throw new Error('USER_PROFILES tab not found in SF_DEALER_CONFIG.');
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === userKey) {
      var path = String(rows[i][2]).trim();
      if (!path) throw new Error('User "' + userKey + '" has no qr_local_base_path set.');
      if (path.slice(-1) !== '\\' && path.slice(-1) !== '/') {
        path = path + (path.indexOf('\\') !== -1 ? '\\' : '/');
      }
      return path;
    }
  }
  throw new Error('User key "' + userKey + '" not found in USER_PROFILES tab.');
}

function getLastSelectedUser() {
  return PropertiesService.getUserProperties().getProperty('last_selected_user') || '';
}

function saveLastSelectedUser(userKey) {
  if (userKey && String(userKey).trim() !== '') {
    PropertiesService.getUserProperties().setProperty('last_selected_user', String(userKey).trim());
  }
}


// ============================================================================
// END OF SCRIPT
// ============================================================================