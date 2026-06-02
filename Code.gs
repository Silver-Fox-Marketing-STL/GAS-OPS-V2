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
// QR local base paths are now per-user. See USER_PROFILES tab in SF_DEALER_CONFIG
// and Section 28 (User Profiles) below. QR_LOCAL_BASE_PATH global has been removed.

// Column indices in the DEALERS tab of SF_DEALER_CONFIG (0-indexed)
// Current layout (23 columns, A–W):
// A=dealer_key, B=dealer_name, C=orders_col, D=qr_folder_id, E=output_folder_id,
// F=use_stock_not_vin, G=linkbuilder_col, H=utm_base_url_override, I=data_transforms,
// J=scraper_location_name, K=qr_local_prefix, L=active, M=notes,
// N=pipedrive_prefix, O=type_rules, [P–V unused/deprecated], W=filtering_rules
var CFG = {
  KEY:               0,   // dealer_key
  NAME:              1,   // dealer_name
  ORDERS_COL:        2,   // orders_col (A, B, C, ... AO)
  QR_FOLDER_ID:      3,   // qr_folder_id
  OUTPUT_FOLDER:     4,   // output_folder_id (per-dealer override; falls back to OUTPUT_FOLDER_ID)
  USE_STOCK:         5,   // use_stock_not_vin (boolean)
  LINKBUILDER_COL:   6,   // linkbuilder_col (B or C)
  UTM_BASE_URL:      7,   // utm_base_url_override (Serra Honda style fixed base URL)
  TRANSFORMS:        8,   // data_transforms (JSON string or empty)
  SCRAPER_LOCATION:  9,   // scraper_location_name (exact value in SCRAPERDATA Location col)
  QR_PREFIX:         10,  // qr_local_prefix (e.g. "Auffenberg_Hyundai")
  ACTIVE:            11,  // active (boolean)
  NOTES:             12,  // notes
  PIPEDRIVE_PREFIX:  13,  // pipedrive_prefix ("PIPEDRIVE" or blank)
  TYPE_RULES:        14,  // type_rules (JSON array — primary output config)
  FILTER_RULES:      22   // filtering_rules (JSON object — col W)
};

// ── NORMALIZATION ─────────────────────────────────────────────────────────────

// Column indices for normalization (0-indexed, matching SCRAPERDATA columns A–U)
var NORM_COL = { TYPE: 2, TRIM: 6, STATUS: 8, PRICE: 9 };

// Normalization maps: ordered arrays of [input, output] pairs.
// NOTE: These are fallback values only. The live source of truth is the
// NORM_MAPS tab in SF_DEALER_CONFIG, managed via SilverFox V2 → Manage
// Normalization Maps. These hardcoded values are only used if that sheet
// tab is missing or a specific map within it has no entries.
//   global  — runs on every column before column-specific maps.
//   type    — col C (index 2). ORDER SENSITIVE: specific strings before substrings.
//   trim    — col G (index 6).
//   status  — col I (index 8).
//   price   — col J (index 9).
// Matching is case-insensitive exact (full cell value). Cells with no match
// are returned trimmed but otherwise unchanged.
var NORMALIZATION_MAPS = {
  global: [
    ['&amp;',     '&'],
    ['undefined', '*'],
    ['N/A',       '*']
  ],
  type: [
    // Order matters: longer/more-specific strings must appear before substrings.
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


// ── CONFIG SPREADSHEET CACHE ─────────────────────────────────────────────────
// SF_DEALER_CONFIG is opened independently by getDealerConfig_, getCsvSchema_,
// getActiveDealersForUI, getQRBasePathForUser_, getUserProfiles, and several
// other functions — each call to SpreadsheetApp.openById() is a network round
// trip. This cache holds the Spreadsheet object for the lifetime of one script
// execution so every call after the first is free.
var _configSS_ = null;

function getConfigSS_() {
  if (!_configSS_) _configSS_ = SpreadsheetApp.openById(CONFIG_SHEET_ID);
  return _configSS_;
}


// ── RECALC DELAY HELPER ───────────────────────────────────────────────────────
// Replaces the fixed Utilities.sleep() calls after ORDERMATCH and LINKBUILDER
// formula writes. Scales the wait time to the number of rows being evaluated
// rather than always sleeping the worst-case maximum.
//   rowCount  — number of data rows the formula must process
//   msPerRow  — estimated milliseconds per row
//   minMs     — floor (always wait at least this long for Sheets to register the write)
//   maxMs     — ceiling (never wait longer than this)
function calcRecalcDelay_(rowCount, msPerRow, minMs, maxMs) {
  return Math.max(minMs, Math.min(maxMs, rowCount * msPerRow));
}


// ============================================================================
// SECTION 2: BOOLEAN HELPER
// ============================================================================

/**
 * Safely evaluates a config value as boolean.
 * Handles Google Sheets returning true/false as actual booleans instead of
 * strings when the cell contains TRUE/FALSE.
 *
 * @param {*} val - Value from getValues() — may be boolean true/false or string 'TRUE'/'FALSE'
 * @returns {boolean}
 */
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
  menu.addItem('Edit Dealer Rules...', 'openRulesEditor');
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
    .setWidth(620)
    .setHeight(580);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import Scraper Data');
}

/**
 * Receives pre-mapped data from the ScraperImport sidebar, normalizes it,
 * and writes it into SCRAPERDATA, replacing all existing data.
 *
 * @param {Array<Array<string>>} mappedData - 2D array already aligned to the
 *   21 SCRAPERDATA columns. Unmatched columns contain empty strings.
 * @returns {{rowCount: number, colCount: number}}
 */
function importScraperData(mappedData) {
  if (!mappedData || mappedData.length === 0) {
    throw new Error('No data received.');
  }

  var ss    = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName('SCRAPERDATA');

  // Clear all existing data below the header row
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 21).clearContent();
  }

  // Normalize scraper data (type, trim, status, price + global passes)
  normalizeScraperData_(mappedData);

  // Compute review stats from normalized data before writing to sheet
  var review = computeImportReview_(mappedData);

  // Force plain text on columns that Sheets auto-converts, causing QUERY
  // mixed-type issues. Must be set BEFORE setValues so the format is
  // applied at write time, preventing numeric-looking strings from being
  // stored as numbers.
  sheet.getRange(2, 1, mappedData.length, 2).setNumberFormat('@');  // VIN (col A) + Stock (col B)
  sheet.getRange(2, 10, mappedData.length, 1).setNumberFormat('@'); // Price (col J)
  sheet.getRange(2, 14, mappedData.length, 1).setNumberFormat('@'); // Date In Stock (col N)

  // Write new data starting at row 2
  sheet.getRange(2, 1, mappedData.length, 21).setValues(mappedData);

  // Re-apply text format after setValues — belt-and-suspenders for numeric-looking values
  sheet.getRange(2, 1, mappedData.length, 2).setNumberFormat('@');  // VIN + Stock
  sheet.getRange(2, 10, mappedData.length, 1).setNumberFormat('@'); // Price
  sheet.getRange(2, 14, mappedData.length, 1).setNumberFormat('@'); // Date In Stock

  // Count how many columns actually had data (non-empty in at least one row)
  var colCount = 0;
  for (var c = 0; c < 21; c++) {
    for (var r = 0; r < mappedData.length; r++) {
      if (mappedData[r][c] !== '') { colCount++; break; }
    }
  }

  // Update the scraper timestamp
  fillScraperDateTime();

  return { rowCount: mappedData.length, colCount: colCount, review: review };
}

// Called by the sidebar to populate the dropdown
function getActiveDealersForUI() {
  var data = getConfigSS_()
    .getSheetByName('DEALERS').getDataRange().getValues();
  var dealers = [];
  for (var i = 1; i < data.length; i++) {
    if (isTrue_(data[i][CFG.ACTIVE])) {
      dealers.push({ key: data[i][CFG.KEY], name: data[i][CFG.NAME] });
    }
  }
  return dealers;
}

/**
 * Called by the Run Dealer modal. Writes VINs to ORDERS sheet then runs.
 * @param {string}      dealerKey
 * @param {Array}       vins
 * @param {string}      dealId         - Pipedrive Deal ID (required)
 * @param {string|null} runId          - Progress tracking ID generated by modal (optional)
 * @param {boolean}     bypassFilters  - If true, skip filtering rules during run
 * @param {string}      userKey        - Key from USER_PROFILES tab; determines local QR base path
 */
function pasteVinsAndRun(dealerKey, vins, dealId, runId, bypassFilters, userKey) {
  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);
  if (!dealId || String(dealId).trim() === '') throw new Error('Pipedrive Deal ID is required.');

  // Resolve QR base path from USER_PROFILES. Throw early so the user sees a
  // clear message before the run starts rather than getting a blank @QR column.
  if (!userKey || String(userKey).trim() === '') throw new Error('Please select a user before running.');
  var qrBasePath = getQRBasePathForUser_(String(userKey).trim());

  // Persist the selection so the dropdown pre-selects on next open.
  saveLastSelectedUser(userKey);

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

  // Pass the already-resolved config so runDealer doesn't re-open SF_DEALER_CONFIG.
  return runDealer(dealerKey, String(dealId).trim(), runId || null, bypassFilters === true, qrBasePath, config);
}

/**
 * Main entry point. Example: runDealer('AUFFENBERG_HYUNDAI', '44001')
 * @param {string}      dealerKey
 * @param {string}      dealId         - Pipedrive Deal ID
 * @param {string|null} runId          - Progress tracking ID (optional; from modal)
 * @param {boolean}     bypassFilters  - If true, skip filtering rules for this run
 * @param {string}      qrBasePath     - Local folder path for QR PNGs (from USER_PROFILES)
 * @param {Array|null}  preloadedConfig - Config row already loaded by pasteVinsAndRun;
 *                                        skips a redundant getDealerConfig_ call when provided.
 */
function runDealer(dealerKey, dealId, runId, bypassFilters, qrBasePath, preloadedConfig) {
  var startTime = new Date();
  var errors    = [];

  try {
    // 1. Load dealer config (use preloaded if available — avoids re-opening SF_DEALER_CONFIG
    //    when called from pasteVinsAndRun, which already resolved config for the ORDERS write)
    setProgress_(runId, 'Loading dealer config...', 5);
    var config = preloadedConfig || getDealerConfig_(dealerKey);
    if (!config) throw new Error('Dealer key not found: ' + dealerKey);
    if (!isTrue_(config[CFG.ACTIVE])) throw new Error('Dealer is marked inactive: ' + dealerKey);
    Logger.log('Starting run for: ' + config[CFG.NAME]);

    // 2. Load type rules
    var typeRules = getTypeRules_(config);
    Logger.log('Type rules: ' + JSON.stringify(typeRules));

    // 3. Load VINs from ORDERS sheet
    var vins = getOrderVINs_(config[CFG.ORDERS_COL]);
    if (!vins || vins.length === 0) throw new Error('No VINs found in ORDERS column ' + config[CFG.ORDERS_COL]);
    Logger.log('VINs to process: ' + vins.length);

    // 4. Copy universal template to output folder
    setProgress_(runId, 'Copying output template...', 10);
    var outputFolderId = config[CFG.OUTPUT_FOLDER] || OUTPUT_FOLDER_ID;
    var outputDoc = copyTemplateToFolder_(TEMPLATE_ID, outputFolderId);
    var outputDocName = config[CFG.NAME] + ' ' + Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd') + ' Order';
    outputDoc.rename(outputDocName);
    Logger.log('Output doc created: ' + outputDoc.getId());

    // 5. Write config cache to output doc
    writeConfigCache_(outputDoc, config);

    // 6. Paste VINs into ORDER tab of output doc
    setProgress_(runId, 'Pasting ' + vins.length + ' VIN' + (vins.length === 1 ? '' : 's') + ' into order...', 18);
    pasteOrderVINs_(outputDoc, vins);

    // 7. Paste dealer's scraper data into SCRAPERDATA tab of output doc
    setProgress_(runId, 'Loading scraper data for ' + config[CFG.NAME] + '...', 24);
    var scraperData = getDealerScraperData_(config[CFG.SCRAPER_LOCATION]);
    setProgress_(runId, 'Pasting ' + scraperData.length + ' inventory rows...', 30);
    pasteScraperData_(outputDoc, scraperData);

    // 8. Apply data transforms if configured
    if (config[CFG.TRANSFORMS]) {
      setProgress_(runId, 'Applying data transforms...', 34);
      applyDataTransforms_(outputDoc, config[CFG.TRANSFORMS]);
    }

    // 8.5 Apply filtering rules to VIN list (skipped if bypassFilters is true)
    if (!bypassFilters) {
      var filterRules = getDealerFilterRules_(config);
      var useStock_   = isTrue_(config[CFG.USE_STOCK]);

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
        if (!scraperRow) {
          passedVins.push(identifier);
          return;
        }
        var result = applyFilteringRules_([scraperRow], filterRules);
        if (result.passed.length > 0) {
          passedVins.push(identifier);
        } else {
          rejectedVins.push(identifier + ' (' + result.rejected[0].reason + ')');
        }
      });

      if (rejectedVins.length > 0) {
        Logger.log('Output filter removed ' + rejectedVins.length + ' VIN(s): ' + rejectedVins.join(', '));
        setProgress_(runId,
          'Filtered out ' + rejectedVins.length + ' vehicle' +
          (rejectedVins.length === 1 ? '' : 's') + ' with missing data...', 37);
      }

      vins = passedVins;

      if (vins.length === 0) {
        throw new Error(
          'All ' + rejectedVins.length + ' vehicle' +
          (rejectedVins.length === 1 ? '' : 's') +
          ' were removed by filtering rules (' +
          rejectedVins.join('; ') + '). ' +
          'Check filtering rules or enable "Bypass filtering rules" in the Run Dealer modal.'
        );
      }
    } else {
      Logger.log('Filtering rules bypassed for this run.');
    }

    // 9. Write ORDERMATCH QUERY formula, then wait for recalculation
    setProgress_(runId, 'Running ORDERMATCH query...', 38);
    writeOrderMatchFormula_(outputDoc, vins, isTrue_(config[CFG.USE_STOCK]));
    SpreadsheetApp.flush();
    // Wait scales with order size: ~40ms/row, 1000ms floor, 3500ms ceiling.
    // A 10-VIN order waits ~1s instead of the previous fixed 3s.
    Utilities.sleep(calcRecalcDelay_(vins.length, 40, 1000, 3500));
    var matchedRows = readOrderMatchResults_(outputDoc);
    Logger.log('Matched rows: ' + matchedRows.length);

    // 10. Copy VIN log into LOG tab of output doc
    setProgress_(runId, 'Copying VIN log (' + matchedRows.length + ' matched)...', 50);
    copyVINLogToOutput_(outputDoc, dealerKey);

    // 11. Build LINKBUILDER, generate QR codes in parallel
    setProgress_(runId, 'Building link formulas...', 56);
    var links    = buildLinks_(outputDoc, config, typeRules);
    setProgress_(runId, 'Generating ' + links.length + ' QR code' + (links.length === 1 ? '' : 's') + ' (parallel)...', 64);
    var qrFolder = DriveApp.getFolderById(config[CFG.QR_FOLDER_ID]);
    generateQRCodesParallel_(links, qrFolder, config[CFG.QR_PREFIX]);
    Logger.log('QR codes generated: ' + links.length);

    // 12. Write QR paths into ORDERMATCH col J
    setProgress_(runId, links.length + ' QR codes complete. Writing paths...', 82);
    writeQRPaths_(outputDoc, config[CFG.QR_PREFIX], links.length, qrBasePath);

    // 13. Build CSV sheet(s) based on type rules
    setProgress_(runId, 'Building CSV output...', 88);
    buildCSVSheet_(outputDoc, typeRules);

    // 14. Write BILLING sheet from ORDERMATCH + LOG data
    setProgress_(runId, 'Writing billing sheet...', 91);
    writeBillingSheet_(outputDoc);

    // 15. Read billing totals back from the sheet we just wrote
    setProgress_(runId, 'Reading billing totals...', 93);
    SpreadsheetApp.flush();
    var billingTotals = readBillingTotals_(outputDoc);

    // 16. Read produced VINs from ORDERMATCH col E (VIN column)
    setProgress_(runId, 'Reading produced VINs...', 95);
    var omSheet     = outputDoc.getSheetByName('ORDERMATCH');
    var omLastRow   = omSheet.getLastRow();
    var producedVins = [];
    if (omLastRow >= 2) {
      producedVins = omSheet.getRange(2, 5, omLastRow - 1, 1).getValues()
        .map(function(r) { return String(r[0]).trim(); })
        .filter(function(v) { return v !== ''; });
    }

    // 17. Write run log entry
    setProgress_(runId, 'Writing run log...', 97);
    var duration       = Math.round((new Date() - startTime) / 1000);
    var runLogRowIndex = writeRunLog_(config, dealId, vins.length, matchedRows.length,
                                     billingTotals, outputDoc.getId(), duration, errors, producedVins);

    // 18. Done
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
  var data = getConfigSS_()
    .getSheetByName('DEALERS').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][CFG.KEY] === dealerKey) return data[i];
  }
  return null;
}

function getActiveDealerKeys_() {
  var data = getConfigSS_()
    .getSheetByName('DEALERS').getDataRange().getValues();
  return data.slice(1)
    .filter(function(r) { return isTrue_(r[CFG.ACTIVE]); })
    .map(function(r)    { return r[CFG.KEY]; });
}

function getCsvSchema_(schemaKey) {
  var data = getConfigSS_()
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

/**
 * Returns SCRAPERDATA rows matching scraperLocationName (col T, index 19).
 * Two-pass approach: read col T only first to find the matching row span,
 * then do one contiguous read of exactly those rows.
 */
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
      r[0] = String(r[0]); // VIN
      r[1] = String(r[1]); // Stock
      return r;
    });
    sheet.getRange(2, 1, cleanData.length, 2).setNumberFormat('@');
    sheet.getRange(2, 1, cleanData.length, 21).setValues(cleanData);
    sheet.getRange(2, 1, cleanData.length, 2).setNumberFormat('@');
    sheet.getRange(2, 10, cleanData.length, 1).setNumberFormat('@'); // Price
    sheet.getRange(2, 14, cleanData.length, 1).setNumberFormat('@'); // Date In Stock
  }
}


// ============================================================================
// SECTION 5.5: SCRAPER DATA NORMALIZATION
// ============================================================================

/**
 * Builds a case-insensitive lookup object from a norm map array.
 * Called once per map at the top of normalizeScraperData_ so we pay the
 * O(n) setup cost once rather than O(n) per cell lookup.
 *
 * @param {Array<Array<string>>} map - array of [input, output] pairs
 * @returns {Object} lowercase-keyed lookup: { 'raw value': 'normalized value' }
 */
function buildNormLookup_(map) {
  var lookup = {};
  map.forEach(function(pair) {
    lookup[String(pair[0]).toLowerCase()] = pair[1];
  });
  return lookup;
}

/**
 * Normalizes a single cell value against a pre-built lookup object.
 * O(1) vs. the previous O(n) linear scan.
 *
 * @param {*}      value  - raw cell value
 * @param {Object} lookup - built by buildNormLookup_
 * @returns {string}
 */
function normalizeCell_(value, lookup) {
  var str = String(value).trim();
  var key = str.toLowerCase();
  return lookup.hasOwnProperty(key) ? lookup[key] : str;
}

function normalizeScraperData_(rows) {
  var maps = loadNormalizationMaps_();

  // Build lookup objects once — O(map_size) — instead of scanning arrays per cell.
  var globalLookup = buildNormLookup_(maps.global);
  var colLookups   = {};
  colLookups[NORM_COL.TYPE]   = buildNormLookup_(maps.type);
  colLookups[NORM_COL.TRIM]   = buildNormLookup_(maps.trim);
  colLookups[NORM_COL.STATUS] = buildNormLookup_(maps.status);
  colLookups[NORM_COL.PRICE]  = buildNormLookup_(maps.price);

  for (var r = 0; r < rows.length; r++) {
    for (var c = 0; c < rows[r].length; c++) {
      var val = normalizeCell_(rows[r][c], globalLookup);
      if (colLookups[c]) {
        val = normalizeCell_(val, colLookups[c]);
      }
      rows[r][c] = (val === '') ? '*' : val;
    }
  }
  return rows;
}

function computeImportReview_(rows) {
  var TYPE_COL     = 2;
  var STATUS_COL   = 8;
  var LOCATION_COL = 19;

  var total              = 0;
  var typeCounts         = {};
  var statusCounts       = {};
  var locationTypeCounts = {};

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

  return {
    total:              total,
    typeCounts:         typeCounts,
    statusCounts:       statusCounts,
    locationTypeCounts: locationTypeCounts
  };
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

  var MODEL_COL = 6; var TRIM_COL = 7;
  // Read model (col 6) and trim (col 7) together in a single API call.
  var modelAndTrim = sheet.getRange(2, MODEL_COL, lastRow - 1, 2).getValues();

  (rules.replacements || []).forEach(function(rule) {
    for (var i = 0; i < modelAndTrim.length; i++) {
      if (rule.col === 'model' && rule.find && String(modelAndTrim[i][0]) === rule.find) {
        if (rule.model_replace) modelAndTrim[i][0] = rule.model_replace;
        if (rule.trim_prepend)  modelAndTrim[i][1]  = rule.trim_prepend + ' ' + String(modelAndTrim[i][1]);
      }
      if (rule.col === 'trim' && rule.remove) {
        rule.remove.forEach(function(s) { modelAndTrim[i][1] = String(modelAndTrim[i][1]).replace(s, '').trim(); });
      }
    }
  });

  // Write both columns back in a single API call.
  sheet.getRange(2, MODEL_COL, lastRow - 1, 2).setValues(modelAndTrim);
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
  // Capture matched row count before writing formulas so we can scale the sleep.
  var omSheet = outputDoc.getSheetByName('ORDERMATCH');
  var numRows = Math.max(0, omSheet.getLastRow() - 1);

  writeLinkBuilderFormulas_(outputDoc, config, typeRules);
  SpreadsheetApp.flush();
  // Wait scales with row count: ~30ms/row, 700ms floor, 2000ms ceiling.
  Utilities.sleep(calcRecalcDelay_(numRows, 30, 700, 2000));

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
  var data    = getConfigSS_()
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

function writeQRPaths_(outputDoc, qrPrefix, count, basePath) {
  var sheet = outputDoc.getSheetByName('ORDERMATCH');
  var paths = [];
  for (var i = 1; i <= count; i++) {
    paths.push([basePath + qrPrefix + '_QR_Code_' + i + '.PNG']);
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
  var base = '?utm_source=SilverFox&utm_medium=';

  var defaultRule = rules[rules.length - 1];
  var defaultExpr = linkRef + '&"' + base + defaultRule.utm + '"';

  var inner = defaultExpr;
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
  'YEAR':               1,
  'MAKE':               2,
  'MODEL':              3,
  'TRIM':               4,
  'VIN':                5,
  'STOCK':              6,
  'TYPE':               7,
  'PRICE_RAW':          8,
  '@QR':                10,
  '@QR2':               10,
  'YEARMAKE':           11,
  'YEARMODEL':          12,
  'QRYEARMODEL':        12,
  'MAKE_MODEL_COMBINED':13,
  'QRSTOCK':            14,
  'MISC':               15,
  'PRICE_FMT':          16,
  'NEWYEARMAKE':        17,
  'TYPEVIN':            18,
  'YEARMODELSTOCK':     19,
  'PRICE_PLUS_2000':    20
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
    var vehicleType = String(row[6]);
    var rule = matchRule_(vehicleType, typeRules);
    groups[rule.match].push(row);
  });

  typeRules.forEach(function(rule) {
    var rows        = groups[rule.match] || [];
    var fieldCodes  = getCsvSchema_(rule.csv_schema) || getCsvSchema_('SCP');
    var sheetName   = isSingleRule
      ? 'CSV'
      : 'CSV_' + String(rule.match).replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();

    var dataRows = rows.map(function(row) {
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
    Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss'),  // A: run_timestamp
    config[CFG.KEY],              // B: dealer_key
    config[CFG.NAME],             // C: dealer_name
    dealId || '',                 // D: order_id (Pipedrive Deal ID)
    totalOrdered,                 // E: total_ordered
    totalMatched,                 // F: total_matched
    billing.totalNew    || 0,     // G: total_new
    billing.totalPO     || 0,     // H: total_po
    billing.totalCPO    || 0,     // I: total_cpo
    billing.totalCPOEL  || 0,     // J: total_cpo_el
    billing.newDupes    || 0,     // K: new_dupes
    billing.poDupes     || 0,     // L: po_dupes
    billing.cpoDupes    || 0,     // M: cpo_dupes
    billing.cpoElDupes  || 0,     // N: cpo_el_dupes
    billing.totalDupes  || 0,     // O: total_dupes
    totalMatched,                 // P: total_produced
    '',                           // Q: qr_codes_generated
    outputDocId,                  // R: output_doc_id
    durationSec,                  // S: run_duration_sec
    errors.join('; ') || '',      // T: errors
    '',                           // U: notes
    producedVinsCSV,              // V: produced_vins
    ''                            // W: vin_log_status (blank = pending)
  ]);
  return sheet.getLastRow();
}


// ============================================================================
// SECTION 15: BILLING SHEET WRITER + READER
// ============================================================================

/**
 * Builds the BILLING sheet in the output doc from scratch.
 * Called during runDealer() after buildCSVSheet_(), before readBillingTotals_().
 *
 * Reads:
 *   ORDER tab    — col A rows 2+ (what was submitted)
 *   ORDERMATCH   — cols A–I rows 2+ (what was matched + vehicle details)
 *   LOG          — cols A–B rows 2+ (VIN log history for dupe detection)
 *
 * Writes four sections to BILLING:
 *   Section 1 — Order Summary (ordered / matched / not found)
 *   Section 2 — Matched by Type, gross counts
 *   Section 3 — Duplicates by Type + totals
 *   Section 4 — Duplicate detail table (one row per dupe vehicle)
 *
 * @param {Spreadsheet} outputDoc
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

  // ── 1. Read ORDER tab (col A, rows 2+) ──────────────────────────────────
  var orderVals = orderSheet.getRange('A2:A').getValues()
    .map(function(r) { return String(r[0] || '').trim().toUpperCase(); })
    .filter(function(v) { return v !== ''; });
  var totalOrdered = orderVals.length;

  // ── 2. Read ORDERMATCH (cols A–I, rows 2+) ───────────────────────────────
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

  // ── 3. Identify "not found" identifiers ─────────────────────────────────
  var matchedVins   = {};
  var matchedStocks = {};
  omRows.forEach(function(v) {
    matchedVins[v.vin]     = true;
    matchedStocks[v.stock] = true;
  });
  var notFoundList = orderVals.filter(function(id) {
    return !matchedVins[id] && !matchedStocks[id];
  });

  // ── 4. Read LOG (cols A–B, rows 2+) → map identifier → [ORDER_IDs] ──────
  var logAll = logSheet.getDataRange().getValues();
  var logMap = {};
  for (var j = 1; j < logAll.length; j++) {
    var orderId    = String(logAll[j][0] || '').trim();
    var identifier = String(logAll[j][1] || '').trim().toUpperCase();
    if (!orderId || !identifier) continue;
    if (!logMap[identifier]) logMap[identifier] = [];
    if (logMap[identifier].indexOf(orderId) === -1) logMap[identifier].push(orderId);
  }

  // ── 5. Classify vehicles and find duplicates ─────────────────────────────
  var TYPE_ORDER   = ['New', 'PO', 'CPO', 'CPO-EL'];
  var typeGroups   = {};
  var dupeDetails  = [];

  omRows.forEach(function(vehicle) {
    var type = vehicle.type || 'Unknown';
    if (!typeGroups[type]) typeGroups[type] = { total: 0, dupes: 0 };
    typeGroups[type].total++;

    var vinOrders   = logMap[vehicle.vin]   || [];
    var stockOrders = logMap[vehicle.stock] || [];
    var allOrders   = [];
    vinOrders.concat(stockOrders).forEach(function(o) {
      if (allOrders.indexOf(o) === -1) allOrders.push(o);
    });

    if (allOrders.length > 0) {
      typeGroups[type].dupes++;
      dupeDetails.push({
        year:      vehicle.year,
        make:      vehicle.make,
        model:     vehicle.model,
        stock:     vehicle.stock,
        vin:       vehicle.vin,
        url:       vehicle.url,
        orderNums: allOrders.join(', ')
      });
    }
  });

  // ── 6. Compute summary totals ────────────────────────────────────────────
  var totalMatched = omRows.length;
  var totalDupes   = 0;
  Object.keys(typeGroups).forEach(function(t) { totalDupes += typeGroups[t].dupes; });

  var unexpectedTypes = Object.keys(typeGroups).filter(function(t) {
    return TYPE_ORDER.indexOf(t) === -1;
  });

  // ── 7. Build output rows ─────────────────────────────────────────────────
  var BLANK = ['', '', '', ''];
  var rows  = [];

  // Section 1 — Order Summary
  rows.push(['', '── ORDER SUMMARY ──', '', '']);
  rows.push(['', 'Total Ordered',            totalOrdered,          '']);
  rows.push(['', 'Total Matched in Scraper', totalMatched,          '']);
  rows.push(['', 'Not Found in Scraper',     notFoundList.length,
             notFoundList.length > 0 ? notFoundList.join(', ') : '—']);
  rows.push(BLANK);

  // Section 2 — Matched by Type (gross)
  // Always write a row for every known type, even if count is 0 — keeps layout fixed.
  rows.push(['', '── BY TYPE (GROSS) ──', '', '']);
  var typeCheckSum = 0;
  TYPE_ORDER.forEach(function(t) {
    var count = typeGroups[t] ? typeGroups[t].total : 0;
    rows.push(['', t, count, '']);
    typeCheckSum += count;
  });
  unexpectedTypes.forEach(function(t) {
    rows.push(['', t + ' ⚠ (unexpected type)', typeGroups[t].total, 'Check NORM_MAPS']);
    typeCheckSum += typeGroups[t].total;
  });
  rows.push(['', 'Total Matched (check)', typeCheckSum,
             typeCheckSum === totalMatched ? '✓' : '⚠ mismatch — check ORDERMATCH']);
  rows.push(BLANK);

  // Section 3 — Duplicates by Type
  // Always write a row for every known type, even if dupes is 0 — keeps layout fixed.
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
  rows.push(['', 'Total Duplicates', totalDupes, '']);
  rows.push(BLANK);

  // ── 8. Write to BILLING ──────────────────────────────────────────────────
  billingSheet.clearContents();
  if (rows.length === 0) return;

  // Main summary block — always 4 cols wide (A–D)
  var paddedRows = rows.map(function(r) {
    var padded = r.slice();
    while (padded.length < 4) padded.push('');
    return padded;
  });
  billingSheet.getRange(1, 1, paddedRows.length, 4).setValues(paddedRows);

  // Section 4 — Duplicate Detail Table at col F (col 6), row 1
  var detailRows = [];
  if (dupeDetails.length > 0) {
    detailRows.push(['── DUPLICATE DETAIL ──', '', '', '', '', '', '']);
    detailRows.push(['Year', 'Make', 'Model', 'Stock', 'VIN', 'URL', 'Prior Order #s']);
    dupeDetails.forEach(function(d) {
      detailRows.push([d.year, d.make, d.model, d.stock, d.vin, d.url, d.orderNums]);
    });
  } else {
    detailRows.push(['── DUPLICATE DETAIL ──', '', '', '', '', '', '']);
    detailRows.push(['No duplicates in this order.', '', '', '', '', '', '']);
  }
  billingSheet.getRange(1, 6, detailRows.length, 7).setValues(detailRows);

  Logger.log('writeBillingSheet_: ' + totalOrdered + ' ordered, ' +
             totalMatched + ' matched, ' + totalDupes + ' dupes.');
}

/**
 * Reads summary totals back from the BILLING sheet for the run log.
 */
function readBillingTotals_(outputDoc) {
  var sheet = outputDoc.getSheetByName('BILLING');
  var defaults = { totalOrdered: 0, totalMatched: 0,
                   totalNew: 0, totalPO: 0, totalCPO: 0, totalCPOEL: 0,
                   newDupes: 0, poDupes: 0, cpoDupes: 0, cpoElDupes: 0,
                   totalDupes: 0 };
  try {
    var data = sheet.getDataRange().getValues();
    var result = {};
    var labelMap = {
      'Total Ordered':            'totalOrdered',
      'Total Matched in Scraper': 'totalMatched',
      'New':                      'totalNew',
      'PO':                       'totalPO',
      'CPO':                      'totalCPO',
      'CPO-EL':                   'totalCPOEL',
      'New Dupes':                'newDupes',
      'PO Dupes':                 'poDupes',
      'CPO Dupes':                'cpoDupes',
      'CPO-EL Dupes':             'cpoElDupes',
      'Total Duplicates':         'totalDupes'
    };
    data.forEach(function(row) {
      var label = String(row[1] || '').trim();
      if (labelMap[label] !== undefined) {
        result[labelMap[label]] = Number(row[2]) || 0;
      }
    });
    Object.keys(defaults).forEach(function(k) {
      if (result[k] === undefined) result[k] = defaults[k];
    });
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
    config[CFG.KEY],
    config[CFG.NAME],
    config[CFG.USE_STOCK],
    config[CFG.LINKBUILDER_COL],
    config[CFG.TYPE_RULES],
    config[CFG.TRANSFORMS],
    config[CFG.UTM_BASE_URL],
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
  var data = getConfigSS_()
    .getSheetByName('DEALERS').getDataRange().getValues();
  var incomplete = [];
  for (var i = 1; i < data.length; i++) {
    if (!isTrue_(data[i][CFG.ACTIVE])) continue;
    var missing = [];
    if (!data[i][CFG.QR_FOLDER_ID]    || data[i][CFG.QR_FOLDER_ID]    === '[QR_FOLDER_ID]')  missing.push('qr_folder_id');
    if (!data[i][CFG.SCRAPER_LOCATION] || data[i][CFG.SCRAPER_LOCATION] === '')               missing.push('scraper_location_name');
    if (!data[i][CFG.TYPE_RULES]       || data[i][CFG.TYPE_RULES]       === '')               missing.push('type_rules');
    if (!data[i][CFG.FILTER_RULES]     || data[i][CFG.FILTER_RULES]     === '')               missing.push('filtering_rules');
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
  return getConfigSS_().getSheetByName(NORM_MAPS_TAB);
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
    if (!maps[key] || maps[key].length === 0) {
      maps[key] = NORMALIZATION_MAPS[key];
    }
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
      entries.push({
        sheetRow: i + 1,
        input:    String(data[i][1]),
        output:   String(data[i][2])
      });
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
    if (String(data[i][0]).trim().toLowerCase() === mapName.toLowerCase()) {
      lastRow = i + 1;
      break;
    }
  }

  sheet.insertRowAfter(lastRow);
  sheet.getRange(lastRow + 1, 1, 1, 3).setValues([[mapName, rawVal, normVal]]);
  return getNormEntries(mapName);
}

function updateNormEntry(sheetRow, newInput, newOutput) {
  newInput  = String(newInput).trim();
  newOutput = String(newOutput).trim();
  if (!newInput || !newOutput) throw new Error('Both values are required.');
  var sheet = getNormMapsSheet_();
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

  var idx = -1;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].sheetRow === sheetRow) { idx = i; break; }
  }
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
  var defaults = {
    allowedTypes:  null,
    excludeStatus: [],
    requireStock:  false,
    requirePrice:  false,
    minPrice:      null,
    maxPrice:      null,
    seasoning:     []
  };

  var raw = config[CFG.FILTER_RULES];
  if (!raw || String(raw).trim() === '' || String(raw).trim() === '{}') return defaults;

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    Logger.log('filtering_rules parse error for ' + config[CFG.KEY] + ': ' + e.message);
    return defaults;
  }

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
  var passed   = [];
  var rejected = [];
  var today    = new Date();
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

    if (filterRules.requireStock) {
      if (stock === '' || stock === '*') {
        rejected.push({ row: row, reason: 'no_stock', detail: vin });
        return;
      }
    }

    if (filterRules.requirePrice) {
      if (isNaN(price) || price <= 0) {
        rejected.push({ row: row, reason: 'no_price', detail: vin });
        return;
      }
    }

    if (filterRules.allowedTypes !== null) {
      var typeAllowed = filterRules.allowedTypes.some(function(t) {
        return String(t).toLowerCase() === type.toLowerCase();
      });
      if (!typeAllowed) {
        rejected.push({ row: row, reason: 'type', detail: type });
        return;
      }
    }

    if (filterRules.excludeStatus.length > 0) {
      var statusExcluded = filterRules.excludeStatus.some(function(s) {
        return String(s).toLowerCase() === status.toLowerCase();
      });
      if (statusExcluded) {
        rejected.push({ row: row, reason: 'status', detail: status });
        return;
      }
    }

    if (filterRules.minPrice !== null && !isNaN(price)) {
      if (price < filterRules.minPrice) {
        rejected.push({ row: row, reason: 'price_low', detail: '$' + price + ' < $' + filterRules.minPrice });
        return;
      }
    }

    if (filterRules.maxPrice !== null && !isNaN(price)) {
      if (price > filterRules.maxPrice) {
        rejected.push({ row: row, reason: 'price_high', detail: '$' + price + ' > $' + filterRules.maxPrice });
        return;
      }
    }

    var typeLower    = type.toLowerCase();
    var requiredDays = null;
    if (seasoningMap.hasOwnProperty(typeLower)) {
      requiredDays = seasoningMap[typeLower];
    } else {
      Object.keys(seasoningMap).forEach(function(ruleType) {
        if (typeLower.indexOf(ruleType) !== -1) requiredDays = seasoningMap[ruleType];
      });
    }

    if (requiredDays !== null && requiredDays > 0) {
      var dateObj = parseDateInStock_(dateIn);
      if (dateObj !== null) {
        var daysOnLot = Math.floor((today - dateObj) / 86400000);
        if (daysOnLot < requiredDays) {
          rejected.push({
            row:    row,
            reason: 'seasoning',
            detail: daysOnLot + ' day' + (daysOnLot === 1 ? '' : 's') + ' on lot, need ' + requiredDays
          });
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
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
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
    return {
      vins: [],
      summary: {
        totalInventory: 0, afterFiltering: 0,
        alreadyPrinted: 0, netNew: 0,
        rejectionBreakdown: emptyBreakdown
      }
    };
  }

  var filterRules  = getDealerFilterRules_(config);
  var filterResult = applyFilteringRules_(allVehicles, filterRules);
  var filtered     = filterResult.passed;

  var breakdown = { no_stock: 0, no_price: 0, type: 0, status: 0, price_low: 0, price_high: 0, seasoning: 0 };
  filterResult.rejected.forEach(function(r) {
    if (breakdown.hasOwnProperty(r.reason)) breakdown[r.reason]++;
  });

  var loggedVins   = getLoggedVins_(dealerKey);
  var useStock     = isTrue_(config[CFG.USE_STOCK]);
  var netNew       = [];
  var printedCount = 0;

  filtered.forEach(function(row) {
    var vin   = String(row[0]).trim();
    var stock = String(row[1]).trim();
    if (loggedVins[vin] || loggedVins[stock]) {
      printedCount++;
    } else {
      netNew.push(useStock ? stock : vin);
    }
  });

  return {
    vins: netNew,
    summary: {
      totalInventory:     totalInventory,
      afterFiltering:     filtered.length,
      alreadyPrinted:     printedCount,
      netNew:             netNew.length,
      rejectionBreakdown: breakdown
    }
  };
}

function getLoggedVins_(dealerKey) {
  var logSS  = SpreadsheetApp.openById(VIN_LOGS_ID);
  var sheet  = logSS.getSheetByName(dealerKey);
  var logged = {};

  if (!sheet) {
    Logger.log('No VIN log tab found for: ' + dealerKey + '. Treating as empty log.');
    return logged;
  }

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

  var data = sheet.getRange(2, 1, lastRow - 1, 23).getValues();
  var runs = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[1]).trim() !== dealerKey) continue;

    var rawTimestamp    = row[0];
    var dealId          = String(row[3]).trim();
    var producedVinsCSV = String(row[21]).trim();  // V: produced_vins
    var status          = String(row[22]).trim();  // W: vin_log_status

    var vins = producedVinsCSV
      ? producedVinsCSV.split(',').map(function(v) { return v.trim(); }).filter(function(v) { return v !== ''; })
      : [];

    var timestampStr = rawTimestamp instanceof Date
      ? Utilities.formatDate(rawTimestamp, 'America/Chicago', 'yyyy-MM-dd HH:mm:ss')
      : String(rawTimestamp).trim();

    runs.push({
      rowIndex:     i + 2,
      timestamp:    timestampStr,
      dealId:       dealId,
      vinCount:     vins.length,
      status:       status || 'pending',
      producedVins: vins
    });
  }

  runs.reverse();
  return runs;
}

function commitRunToVINLog(dealerKey, runRowIndex, dealId, producedVins) {
  if (!producedVins || producedVins.length === 0) {
    throw new Error('No VINs to commit for this run.');
  }

  var logSS    = SpreadsheetApp.openById(VIN_LOGS_ID);
  var logSheet = logSS.getSheetByName(dealerKey);
  if (!logSheet) throw new Error('No VIN log tab found for: ' + dealerKey);

  var committedAt = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
  var appendData  = producedVins.map(function(vin) {
    return [dealId, vin, committedAt];
  });

  logSheet.getRange(logSheet.getLastRow() + 1, 1, appendData.length, 3).setValues(appendData);

  SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('RUN_LOG')
    .getRange(runRowIndex, 23)
    .setValue('committed');

  return { committed: producedVins.length };
}

function rollbackRunFromVINLog(dealerKey, runRowIndex, dealId, committedAt) {
  var logSS    = SpreadsheetApp.openById(VIN_LOGS_ID);
  var logSheet = logSS.getSheetByName(dealerKey);
  if (!logSheet) throw new Error('No VIN log tab found for: ' + dealerKey);

  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return { removed: 0 };

  var data     = logSheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var toDelete = [];

  for (var i = 0; i < data.length; i++) {
    var rowDealId      = String(data[i][0]).trim();
    var rowCommittedAt = String(data[i][2]).trim();
    if (data[i][2] instanceof Date) {
      rowCommittedAt = Utilities.formatDate(data[i][2], 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
    }
    if (rowDealId === String(dealId).trim() && rowCommittedAt === String(committedAt).trim()) {
      toDelete.push(i + 2);
    }
  }

  for (var d = toDelete.length - 1; d >= 0; d--) {
    logSheet.deleteRow(toDelete[d]);
  }

  SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('RUN_LOG')
    .getRange(runRowIndex, 23)
    .setValue('rolled_back');

  return { removed: toDelete.length };
}

function commitLatestRun(dealerKey, runRowIndex) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
  var row   = sheet.getRange(runRowIndex, 1, 1, 23).getValues()[0];

  var dealId          = String(row[3]).trim();
  var producedVinsCSV = String(row[21]).trim();  // V: produced_vins
  var status          = String(row[22]).trim();  // W: vin_log_status

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
    var rowDealId = String(data[i][0]).trim();
    if (rowDealId === String(dealId).trim()) {
      var ts = data[i][2];
      if (ts instanceof Date) {
        return Utilities.formatDate(ts, 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
      }
      return String(ts).trim() || null;
    }
  }
  return null;
}


// ============================================================================
// SECTION 24: ONE-TIME SETUP
// ============================================================================

function addCommittedAtHeaders() {
  var ss      = SpreadsheetApp.openById(VIN_LOGS_ID);
  var sheets  = ss.getSheets();
  var skip    = ['README', 'Sheet1'];
  var updated = 0;

  sheets.forEach(function(sheet) {
    var name = sheet.getName();
    if (skip.indexOf(name) !== -1) return;
    if (name.charAt(0) === '_') return;
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
 * Returns the most recent order ID from the dealer's VIN log tab.
 * Reads col A (ORDER_ID) directly — not the RUN_LOG — so manually-submitted
 * orders are always reflected here immediately after writing.
 *
 * @param {string} dealerKey - must match a tab name in SF_VIN_LOGS exactly
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
    if (val !== '' && val !== 'ORDER_ID') {
      return { latestOrderId: val };
    }
  }

  return { latestOrderId: null };
}


/**
 * Manually appends a list of VINs/stock numbers to a dealer's VIN log.
 * Used by the VINLogUpdater modal's manual entry panel.
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

  var seen    = {};
  var cleaned = [];
  vins.forEach(function(v) {
    var upper = String(v).trim().toUpperCase();
    if (upper !== '' && !seen[upper]) {
      seen[upper] = true;
      cleaned.push(upper);
    }
  });

  if (cleaned.length === 0) throw new Error('No valid VINs after deduplication.');

  var committedAt = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
  var appendData  = cleaned.map(function(vin) {
    return [String(orderId).trim(), vin, committedAt];
  });

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, appendData.length, 3).setValues(appendData);

  Logger.log('manualCommitToVINLog: wrote ' + cleaned.length + ' VINs to ' +
             dealerKey + ' under order ' + orderId);

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

/**
 * Bootstrap call — loads everything the modal needs in a single round trip.
 * @returns {{ dealers: Array<{key:string, name:string}>, schemas: string[] }}
 */
function getRulesEditorBootstrap() {
  var configSS = getConfigSS_();

  var dealerData = configSS.getSheetByName('DEALERS').getDataRange().getValues();
  var dealers = [];
  for (var i = 1; i < dealerData.length; i++) {
    if (isTrue_(dealerData[i][CFG.ACTIVE])) {
      dealers.push({ key: dealerData[i][CFG.KEY], name: dealerData[i][CFG.NAME] });
    }
  }

  var schemaData = configSS.getSheetByName('CSV_SCHEMAS').getDataRange().getValues();
  var schemas = [];
  for (var j = 1; j < schemaData.length; j++) {
    var key = String(schemaData[j][0]).trim();
    if (key !== '') schemas.push(key);
  }

  return { dealers: dealers, schemas: schemas };
}

/**
 * Loads the current type_rules and filtering_rules for a given dealer.
 * @param   {string} dealerKey
 * @returns {{ dealerName:string, typeRules:Array, filteringRules:Object }}
 */
function getDealerRulesData(dealerKey) {
  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);

  var rawType = config[CFG.TYPE_RULES];
  var typeRules = [];
  if (rawType && String(rawType).trim() !== '') {
    try { typeRules = JSON.parse(rawType); }
    catch (e) { Logger.log('getDealerRulesData: type_rules parse error for ' + dealerKey + ': ' + e.message); }
  }

  var rawFilter = config[CFG.FILTER_RULES];
  var filteringRules = {};
  if (rawFilter && String(rawFilter).trim() !== '' && String(rawFilter).trim() !== '{}') {
    try { filteringRules = JSON.parse(rawFilter); }
    catch (e) { Logger.log('getDealerRulesData: filtering_rules parse error for ' + dealerKey + ': ' + e.message); }
  }

  return {
    dealerName:     config[CFG.NAME],
    typeRules:      typeRules,
    filteringRules: filteringRules
  };
}

/**
 * Writes a new type_rules JSON string to col O of the dealer's DEALERS row.
 * @param {string} dealerKey
 * @param {string} typeRulesJson
 */
function saveDealerTypeRules(dealerKey, typeRulesJson) {
  try { JSON.parse(typeRulesJson); }
  catch (e) { throw new Error('Invalid type_rules JSON: ' + e.message); }

  var sheet = getConfigSS_()
    .getSheetByName('DEALERS');
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

/**
 * Writes a new filtering_rules JSON string to col W of the dealer's DEALERS row.
 * @param {string} dealerKey
 * @param {string} filteringRulesJson
 */
function saveDealerFilterRules(dealerKey, filteringRulesJson) {
  try { JSON.parse(filteringRulesJson); }
  catch (e) { throw new Error('Invalid filtering_rules JSON: ' + e.message); }

  var sheet = getConfigSS_()
    .getSheetByName('DEALERS');
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
// Tab layout (1-indexed columns):
//   A = user_key       (e.g. "nick")
//   B = display_name   (e.g. "Nick")
//   C = qr_local_base_path  (e.g. "C:\Users\Nick_Workstation\Documents\QRS\")
//
// To add a new user: append a row to the USER_PROFILES tab.
// No code changes required.
// ============================================================================

var USER_PROFILES_TAB = 'USER_PROFILES';

/**
 * Returns all rows from the USER_PROFILES tab as an array of objects.
 * Called by DealerSelector.html to populate the "Running as:" dropdown.
 *
 * @returns {Array<{key:string, name:string}>}
 */
function getUserProfiles() {
  var data = getConfigSS_()
    .getSheetByName(USER_PROFILES_TAB);
  if (!data) throw new Error('USER_PROFILES tab not found in SF_DEALER_CONFIG.');

  var rows = data.getDataRange().getValues();
  var profiles = [];
  for (var i = 1; i < rows.length; i++) {  // skip header row
    var key  = String(rows[i][0]).trim();
    var name = String(rows[i][1]).trim();
    if (key !== '') profiles.push({ key: key, name: name });
  }
  return profiles;
}

/**
 * Combined bootstrap call for the Run Dealer modal.
 * @returns {{ profiles: Array<{key:string, name:string}>, lastUser: string }}
 */
function getUserProfilesForModal() {
  return {
    profiles: getUserProfiles(),
    lastUser: getLastSelectedUser()
  };
}

/**
 * Looks up the qr_local_base_path for a given user_key.
 * @param   {string} userKey
 * @returns {string}
 */
function getQRBasePathForUser_(userKey) {
  var sheet = getConfigSS_()
    .getSheetByName(USER_PROFILES_TAB);
  if (!sheet) throw new Error('USER_PROFILES tab not found in SF_DEALER_CONFIG.');

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === userKey) {
      var path = String(rows[i][2]).trim();
      if (!path) throw new Error('User "' + userKey + '" has no qr_local_base_path set in USER_PROFILES.');
      if (path.slice(-1) !== '\\' && path.slice(-1) !== '/') {
        path = path + (path.indexOf('\\') !== -1 ? '\\' : '/');
      }
      return path;
    }
  }
  throw new Error('User key "' + userKey + '" not found in USER_PROFILES tab.');
}

/**
 * Returns the user_key last used on this Google account.
 * @returns {string}
 */
function getLastSelectedUser() {
  return PropertiesService.getUserProperties().getProperty('last_selected_user') || '';
}

/**
 * Persists the user_key selection.
 * @param {string} userKey
 */
function saveLastSelectedUser(userKey) {
  if (userKey && String(userKey).trim() !== '') {
    PropertiesService.getUserProperties().setProperty('last_selected_user', String(userKey).trim());
  }
}

// ============================================================================
// END OF SCRIPT
// ============================================================================