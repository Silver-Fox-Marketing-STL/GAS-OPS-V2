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

// Same single-open-per-execution pattern for the other two openById() targets.
// (getActiveSpreadsheet() call sites are deliberately NOT routed through these —
// see LEARNINGS on openById vs getActiveSpreadsheet write+read consistency.)
var _masterSS_  = null;
var _vinLogsSS_ = null;

function getMasterSS_() {
  if (!_masterSS_) _masterSS_ = SpreadsheetApp.openById(MASTER_SHEET_ID);
  return _masterSS_;
}

function getVinLogsSS_() {
  if (!_vinLogsSS_) _vinLogsSS_ = SpreadsheetApp.openById(VIN_LOGS_ID);
  return _vinLogsSS_;
}


// ── RECALC DELAY HELPER ───────────────────────────────────────────────────────
// Replaces the fixed Utilities.sleep() calls after ORDERMATCH and LINKBUILDER
// formula writes. Scales the wait time to the number of rows being evaluated
// rather than always sleeping the worst-case maximum.
//   rowCount  — number of data rows the formula must process
//   msPerRow  — estimated milliseconds per row
//   minMs     — floor (always wait at least this long for Sheets to register the write)
//   maxMs     — ceiling (never wait longer than this)
/**
 * Polls a readiness check every 250ms until it returns true or maxMs elapses.
 * Replaces fixed recalc sleeps: the typical case exits in 250–750ms instead of
 * always paying the worst-case cap; the worst case (e.g. a zero-match QUERY
 * that never populates) is unchanged — it waits exactly the old cap.
 */
function waitForRecalc_(maxMs, isReady) {
  var waited = 0;
  while (waited < maxMs) {
    Utilities.sleep(250);
    waited += 250;
    try { if (isReady()) return waited; } catch (e) { /* keep waiting */ }
  }
  return waited;
}

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
  menu.addItem('🚀 Open SilverFox', 'openApp');
  // Classic per-modal entry points kept as a fallback during App validation.
  // Remove this submenu (and Classic.html / openViewStandalone_) at sign-off.
  var classic = ui.createMenu('Classic menu (deprecated)');
  classic.addItem('Run Dealer...', 'promptRunDealer');
  classic.addSeparator();
  classic.addItem('Import Scraper Data...', 'openScraperImport');
  classic.addItem('Update Scraper Timestamp', 'fillScraperDateTime');
  classic.addSeparator();
  classic.addItem('Update VIN Log...', 'openVINLogUpdater');
  classic.addSeparator();
  classic.addItem('Clear QR Folders (all active dealers)', 'eraseAllQRFolders');
  classic.addItem('Clean Up Old Output Docs', 'cleanUpOutputDocs');
  classic.addSeparator();
  classic.addItem('View Run Log', 'openRunLog');
  classic.addSeparator();
  classic.addItem('Manage Normalization Maps...', 'openNormManager');
  classic.addItem('Refresh Norm/Field Reference', 'refreshNormReference');
  classic.addItem('Edit Dealer Rules...', 'openRulesEditor');
  menu.addSeparator();
  menu.addSubMenu(classic);
  menu.addToUi();
}

// All modals share one large uniform size; the browser viewport is the
// effective cap (GAS clamps/clips oversize dialogs), so smaller screens
// still get the largest dialog that fits.
var MODAL_WIDTH  = 1400;
var MODAL_HEIGHT = 900;

/**
 * Template include helper — returns a fragment file's raw content for
 * <?!= include_('ViewXxx') ?> scriptlets in App.html / Classic.html.
 * Trailing underscore keeps it off the google.script.run surface.
 */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Opens the SilverFox App — the single-modal SPA shell. Views are stitched
 * into App.html via include_() and switched client-side (no dialog swaps).
 */
function openApp() {
  var t = HtmlService.createTemplateFromFile('App');
  t.initialTheme = getThemePreference();   // '' when unset → head script follows the OS
  var html = t.evaluate()
    .setWidth(MODAL_WIDTH)
    .setHeight(MODAL_HEIGHT);
  SpreadsheetApp.getUi().showModalDialog(html, 'SilverFox');
}

/**
 * Serves one converted view fragment as a standalone dialog — powers the
 * "Classic menu" fallback during App validation with zero code duplication.
 */
function openViewStandalone_(fragmentName, title) {
  var t = HtmlService.createTemplateFromFile('Classic');
  t.fragment = fragmentName;
  t.initialTheme = getThemePreference();   // same persisted theme as the App
  var html = t.evaluate().setWidth(MODAL_WIDTH).setHeight(MODAL_HEIGHT);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

/**
 * Home-page status strip: last scraper import timestamp from the META tab
 * (written by fillScraperDateTime on every import).
 */
function getAppHomeStatus() {
  var ts = getTimestampMeta_(SpreadsheetApp.getActiveSpreadsheet());
  return { lastImportDate: ts.date, lastImportTime: ts.time };
}

// Returns the DASHBOARD tab as a 2D array of display strings for the Home
// view to render. getDisplayValues keeps it serializable (no Date objects) and
// reflects whatever refreshDashboard_ wrote plus the live formula-driven run
// sections (Run Log Summary / Most Recent Run / Runs By Dealer), so revisiting
// Home after finalizing a run shows current numbers without re-importing.
function getDashboardView() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DASHBOARD');
  if (!sh) return { rows: [], error: 'DASHBOARD sheet not found.' };
  var lastRow = sh.getLastRow();
  if (lastRow < 1) return { rows: [] };
  var lastCol = Math.min(sh.getLastColumn() || 1, 10);
  return { rows: sh.getRange(1, 1, lastRow, lastCol).getDisplayValues() };
}

// Returns the full set of VINs currently in SCRAPERDATA (col A, normalized
// upper/trim, deduped) plus the last-import timestamp. The Transcription view
// loads this once and checks typed VINs against it instantly client-side —
// the same "Found / Not Found" check as the TRANSCRIPTION sheet's ARRAYFORMULA,
// without a round trip per keystroke. Refresh re-pulls after a new import.
function getTranscriptionVins() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SCRAPERDATA');
  if (!sh) return { vins: [], count: 0, lastImport: '' };
  var out  = [];
  var seen = {};
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var vals = sh.getRange(2, 1, lastRow - 1, 1).getValues();  // col A only — one fast read
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i][0]).trim().toUpperCase();
      if (v && v !== '*' && seen[v] !== 1) { seen[v] = 1; out.push(v); }
    }
  }
  var ts = getTimestampMeta_(SpreadsheetApp.getActiveSpreadsheet());
  return { vins: out, count: out.length, lastImport: (ts.date + ' ' + ts.time).trim() };
}

// Classic fallback: serves the converted App fragment standalone.
function promptRunDealer() {
  openViewStandalone_('ViewRun', 'Run Dealer');
}

// Classic fallback: serves the converted App fragment standalone.
function openScraperImport() {
  openViewStandalone_('ViewImport', 'Import Scraper Data');
}

/**
 * Receives pre-mapped data from the ScraperImport modal, normalizes it,
 * deduplicates by VIN, and writes the final dataset to SCRAPERDATA.
 *
 * Two-phase protocol: when VIN conflicts are detected (same VIN, differing
 * data) and no resolutions are supplied, the function returns the conflict
 * list WITHOUT touching the sheet. The modal shows a resolution UI and calls
 * again with the same payload plus a resolutions map. The happy path (no
 * conflicts) writes in a single call. No mutation happens above the gate, so
 * a mid-pipeline error can never leave SCRAPERDATA half-written.
 *
 * @param {Array<Array<string>>} mappedData - 2D array already aligned to the
 *   21 SCRAPERDATA columns (all selected files concatenated, headers removed).
 * @param {string=}  mode        - 'replace' (default; clears existing data) or
 *   'merge' (combines with the current SCRAPERDATA contents).
 * @param {Object=}  resolutions - phase-2 only: { 'VIN': 'existing'|'new' }.
 * @param {Array=}   fileNames   - [{name, rowCount}] in concatenation order;
 *   used to label conflict sources by filename.
 * @param {string=}  token       - phase-2 only: echo of the phase-1 token,
 *   verified so a concurrent import between phases is detected.
 */
function importScraperData(mappedData, mode, resolutions, fileNames, token) {
  if (!mappedData || mappedData.length === 0) {
    throw new Error('No data received.');
  }
  mode = (mode === 'merge') ? 'merge' : 'replace';

  var ss    = getMasterSS_();
  var sheet = ss.getSheetByName('SCRAPERDATA');

  // Normalize incoming rows in place (type, trim, status, price + global
  // passes). Existing sheet rows are NOT re-normalized — they were normalized
  // at their own import time; if norm maps changed since, the difference
  // surfaces as an honest, user-visible conflict.
  normalizeScraperData_(mappedData);

  var baseRows     = (mode === 'merge') ? readExistingScraperRows_(sheet) : [];
  var currentToken = computeImportToken_(sheet);

  // Drop-on-import: remove rows a dealer flags for dropping (e.g. subprime cars
  // from a direct feed) BEFORE dedup, so they never enter SCRAPERDATA or flag a
  // conflict. Location-scoped per dealer.
  var dropResult = dropRowsOnImport_(mappedData, getImportDropLocations_());
  mappedData = dropResult.rows;

  // Dual-site dealers (source_split) auto-resolve same-VIN main-vs-secondary URL
  // collisions to the main listing — scoped to their Location only.
  var splitLocs = getSourceSplitLocations_();
  var d = dedupeScraperRows_(baseRows, mappedData, fileNames || [], splitLocs);

  // ── Phase 1 gate: conflicts found, no resolutions yet → return, write nothing.
  if (d.conflicts.length > 0 && !resolutions) {
    var MAX_CONFLICTS_RETURNED = 1000;
    // google.script.run cannot serialize Date objects (which getValues() can
    // return from non-@ columns), so the returned conflict rows are
    // display-stringified copies. Resolutions substitute the server-side
    // originals on the phase-2 re-run, so this is cosmetic-only.
    var conflictsOut = d.conflicts.slice(0, MAX_CONFLICTS_RETURNED).map(function(c) {
      return {
        vin:          c.vin,
        existing:     { row: c.existing.row.map(function(v) { return String(v); }), source: c.existing.source },
        incoming:     { row: c.incoming.row.map(function(v) { return String(v); }), source: c.incoming.source },
        diffCols:     c.diffCols,
        variantCount: c.variantCount
      };
    });
    return {
      needsResolution:   true,
      mode:              mode,
      conflicts:         conflictsOut,
      conflictsTotal:    d.conflicts.length,
      duplicatesRemoved: d.duplicatesRemoved,
      droppedOnImport:   dropResult.dropped,
      existingRowCount:  baseRows.length,
      newRowCount:       mappedData.length,
      token:             currentToken
    };
  }

  // ── Commit (single-call happy path, or phase 2 with resolutions).
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (eLock) {
    throw new Error('Another import is currently running — please wait a moment and try again.');
  }

  try {
    if (resolutions) {
      var freshToken = computeImportToken_(sheet);
      if (String(token || '') !== freshToken) {
        throw new Error('SCRAPERDATA changed since conflicts were detected — please re-run the import.');
      }
      applyConflictResolutions_(d, resolutions);
    }

    // Restore the location-contiguity invariant getDealerScraperData_ relies
    // on: bucket rows by exact Location string in first-seen order.
    var finalRows = groupRowsByLocation_(d.rows);

    // Review stats on the FINAL dataset (both modes) so IMPORT_STATS rows
    // always mean "full state of each location after this import" and the
    // health baselines stay consistent.
    var review = computeImportReview_(finalRows);

    // ── Mutations begin here ──
    var colN    = getSchemaColCount_();   // canonical width (21 until a column is added)
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, colN).clearContent();
    }

    // Force plain text on columns that Sheets auto-converts, causing QUERY
    // mixed-type issues. Set BEFORE setValues so the format applies at write
    // time, and AFTER as belt-and-suspenders.
    sheet.getRange(2, 1, finalRows.length, 2).setNumberFormat('@');  // VIN (col A) + Stock (col B)
    sheet.getRange(2, 10, finalRows.length, 1).setNumberFormat('@'); // Price (col J)
    sheet.getRange(2, 14, finalRows.length, 1).setNumberFormat('@'); // Date In Stock (col N)

    // Normalize every row to exactly colN wide — guards against a stale client
    // width after a schema column was added (new columns default to '*').
    finalRows = finalRows.map(function(r) {
      if (r.length === colN) return r;
      var row = r.slice(0, colN);
      while (row.length < colN) row.push('*');
      return row;
    });
    sheet.getRange(2, 1, finalRows.length, colN).setValues(finalRows);

    sheet.getRange(2, 1, finalRows.length, 2).setNumberFormat('@');
    sheet.getRange(2, 10, finalRows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 14, finalRows.length, 1).setNumberFormat('@');

    // Count how many columns actually had data (non-empty in at least one row)
    var colCount = 0;
    for (var c = 0; c < colN; c++) {
      for (var r = 0; r < finalRows.length; r++) {
        if (finalRows[r][c] !== '' && finalRows[r][c] !== '*') { colCount++; break; }
      }
    }

    fillScraperDateTime();

    var importTimestamp = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
    writeImportStats_(ss, importTimestamp, review.locationDetail);
    // Force the IMPORT_STATS append to land before the health read so
    // checkImportHealth_'s getLastRow()/tail-read deterministically see the
    // current import's just-written rows (which it then excludes by timestamp).
    // Without this, a stale getLastRow() can shift the HEALTH_TAIL_ROWS window.
    SpreadsheetApp.flush();
    var healthIssues = checkImportHealth_(ss, importTimestamp, review.locationDetail);
    refreshDashboard_(ss, importTimestamp, review.locationDetail);

    return {
      rowCount:          finalRows.length,
      colCount:          colCount,
      review:            review,
      healthIssues:      healthIssues,
      mode:              mode,
      duplicatesRemoved: d.duplicatesRemoved,
      droppedOnImport:   dropResult.dropped,
      conflictsResolved: resolutions ? d.conflicts.length : 0,
      blankVinCount:     d.blankVinCount,
      fileCount:         (fileNames || []).length
    };
  } finally {
    lock.releaseLock();
  }
}

/** Reads all existing SCRAPERDATA rows (canonical width) for merge mode. */
function readExistingScraperRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, getSchemaColCount_()).getValues();
}

/**
 * Optimistic-concurrency token for the two-phase import: changes whenever an
 * import writes (row count and/or the scraper timestamp change).
 */
function computeImportToken_(sheet) {
  var ts = getTimestampMeta_(sheet.getParent());
  return sheet.getLastRow() + '|' + ts.date + ' ' + ts.time;
}

/**
 * Tolerant cell equality for dedup comparisons. Existing sheet rows come back
 * from getValues() with numbers in non-@ columns (Year, MSRP, Postal Code...)
 * while incoming rows are strings — a naive string compare would flag a false
 * conflict on every merged row. Trim-string equal first, then a both-numeric
 * fallback (handles 2024 vs "2024" and "06234" vs 6234).
 */
function cellsEqual_(a, b) {
  var sa = String(a).trim();
  var sb = String(b).trim();
  if (sa === sb) return true;
  if (sa !== '' && sb !== '' && isFinite(sa) && isFinite(sb)) {
    return Number(sa) === Number(sb);
  }
  return false;
}

function rowsEqual_(a, b) {
  var n = getSchemaColCount_();
  for (var c = 0; c < n; c++) {
    if (!cellsEqual_(a[c], b[c])) return false;
  }
  return true;
}

function diffCols_(a, b) {
  var diffs = [], n = getSchemaColCount_();
  for (var c = 0; c < n; c++) {
    if (!cellsEqual_(a[c], b[c])) diffs.push(c);
  }
  return diffs;
}

/**
 * VIN-keyed dedup / conflict-detection engine for imports.
 *
 * Iteration order is fixed: existing sheet rows first (merge mode), then files
 * in selection order, rows in file order. The first row seen for a VIN is the
 * "incumbent"; an identical later row (per cellsEqual_, all 21 cols) is
 * silently dropped; a differing later row becomes — or replaces — the
 * "challenger" (latest distinct wins, variantCount tracks how many differing
 * versions appeared). The user always resolves a simple 2-way choice.
 *
 * Rows with a blank/'*' VIN are passed through untouched and never keyed —
 * keying on '*' would cross-conflict every blank-VIN row, and stock-matched
 * dealers still need those rows.
 *
 * @returns {{rows: Array, conflicts: Array, duplicatesRemoved: number, blankVinCount: number}}
 *   rows = ordered keep-list (incumbents in place); each conflict carries
 *   keptIndex so a 'new' resolution substitutes the challenger in position.
 */
function dedupeScraperRows_(baseRows, newRows, fileNames, splitLocs) {
  var kept              = [];
  var keyToKeptIdx      = {};
  var incumbentSource   = {};
  var conflictsByVin    = {};
  var conflictOrder     = [];
  var duplicatesRemoved = 0;
  var blankVinCount     = 0;
  splitLocs = splitLocs || {};
  var LOC_COL = 19, URL_COL = 20;  // SCRAPERDATA Location (T) + Vehicle URL (U)

  // Resolve which uploaded file the i-th concatenated new row came from.
  function sourceForNewRow(i) {
    var offset = 0;
    for (var f = 0; f < fileNames.length; f++) {
      var count = Number(fileNames[f].rowCount) || 0;
      if (i < offset + count) return String(fileNames[f].name || 'Uploaded file');
      offset += count;
    }
    return 'Uploaded file';
  }

  function processRow(row, source) {
    var key = String(row[0]).trim().toUpperCase();

    if (key === '' || key === '*') {
      blankVinCount++;
      kept.push(row);
      return;
    }

    if (!keyToKeptIdx.hasOwnProperty(key)) {
      keyToKeptIdx[key]    = kept.length;
      incumbentSource[key] = source;
      kept.push(row);
      return;
    }

    var incumbent = kept[keyToKeptIdx[key]];
    if (rowsEqual_(incumbent, row)) { duplicatesRemoved++; return; }

    // Dual-site URL priority (source_split): when the same VIN appears with a
    // secondary-site URL and a main-site URL within a configured dealer's
    // Location, keep the MAIN listing — automatically, no conflict, order-
    // independent. Scoped by Location so no other dealer is ever affected.
    var loc    = String(row[LOC_COL]).trim().toLowerCase();
    var marker = splitLocs[loc];
    if (marker && String(incumbent[LOC_COL]).trim().toLowerCase() === loc) {
      var incSec = String(incumbent[URL_COL]).toLowerCase().indexOf(marker) !== -1;
      var chSec  = String(row[URL_COL]).toLowerCase().indexOf(marker) !== -1;
      if (incSec !== chSec) {
        if (incSec && !chSec) {
          // challenger is the main listing → it wins; replace the incumbent.
          kept[keyToKeptIdx[key]] = row;
          incumbentSource[key]    = source;
          if (conflictsByVin[key]) {           // drop any conflict an earlier challenger formed
            delete conflictsByVin[key];
            var oi = conflictOrder.indexOf(key);
            if (oi !== -1) conflictOrder.splice(oi, 1);
          }
        }
        // (incumbent main, challenger secondary → keep incumbent; drop challenger)
        duplicatesRemoved++;
        return;
      }
    }

    var c = conflictsByVin[key];
    if (c && rowsEqual_(c.incoming.row, row)) { duplicatesRemoved++; return; }

    if (!c) {
      c = {
        vin:          key,
        existing:     { row: incumbent, source: incumbentSource[key] },
        incoming:     null,
        diffCols:     [],
        variantCount: 0,
        keptIndex:    keyToKeptIdx[key]
      };
      conflictsByVin[key] = c;
      conflictOrder.push(key);
    }
    c.incoming = { row: row, source: source };
    c.variantCount++;
    c.diffCols = diffCols_(incumbent, row);
  }

  for (var b = 0; b < baseRows.length; b++) processRow(baseRows[b], 'Existing data');
  for (var n = 0; n < newRows.length; n++)  processRow(newRows[n], sourceForNewRow(n));

  var conflicts = conflictOrder.map(function(k) { return conflictsByVin[k]; });
  return {
    rows:              kept,
    conflicts:         conflicts,
    duplicatesRemoved: duplicatesRemoved,
    blankVinCount:     blankVinCount
  };
}

/**
 * Applies the user's per-VIN conflict choices. 'new' substitutes the
 * challenger in the incumbent's position; 'existing' keeps the incumbent.
 * resolutions['*'] is the bulk fallback for any VIN without an explicit
 * choice (the returned conflict list is capped, so bulk buttons must be able
 * to cover conflicts the client never saw individually).
 */
function applyConflictResolutions_(d, resolutions) {
  var fallback = resolutions['*'];
  for (var i = 0; i < d.conflicts.length; i++) {
    var c      = d.conflicts[i];
    var choice = resolutions.hasOwnProperty(c.vin) ? resolutions[c.vin] : fallback;
    if (choice !== 'existing' && choice !== 'new') {
      throw new Error('Missing conflict resolution for VIN ' + c.vin + ' — please resolve all conflicts and try again.');
    }
    if (choice === 'new') {
      d.rows[c.keptIndex] = c.incoming.row;
    }
  }
}

/**
 * Buckets rows by Location (col T, index 19) in first-seen order and
 * concatenates — getDealerScraperData_'s two-pass read assumes each
 * location's rows are contiguous. O(n), order-stable within a location.
 */
function groupRowsByLocation_(rows) {
  var buckets = {};
  var order   = [];
  for (var i = 0; i < rows.length; i++) {
    var loc = String(rows[i][19]).trim();
    if (!buckets.hasOwnProperty(loc)) {
      buckets[loc] = [];
      order.push(loc);
    }
    buckets[loc].push(rows[i]);
  }
  // push.apply per bucket — `out = out.concat(...)` re-copied the accumulated
  // array once per location (O(n²) at 12k rows / 43 locations).
  var out = [];
  for (var j = 0; j < order.length; j++) {
    Array.prototype.push.apply(out, buckets[order[j]]);
  }
  return out;
}

/**
 * Single round-trip App bootstrap: the data Run Order and VIN Logs each
 * fetched in separate executions (dealers ×2 + user profiles = 3 cold starts).
 * The App fetches this once via the shared client-side AppData latch; both
 * reads share one getConfigSS_() open.
 */
function getAppBootstrap() {
  return {
    dealers:  getActiveDealersForUI(),
    users:    getUserProfilesForModal(),
    appTheme: getThemePreference()
  };
}

// Called by the sidebar to populate the dropdown
function getActiveDealersForUI() {
  var data = getConfigSS_()
    .getSheetByName('DEALERS').getDataRange().getValues();
  var dealers = [];
  for (var i = 1; i < data.length; i++) {
    if (isTrue_(data[i][CFG.ACTIVE])) {
      // splitDealLabel is non-null when the dealer has a billing_split configured
      // (filtering_rules col W) — tells the Run Dealer modal to require a second
      // deal ID. Computed here because this read already has the full config row.
      var split = getBillingSplit_(data[i]);
      dealers.push({
        key:            data[i][CFG.KEY],
        name:           data[i][CFG.NAME],
        splitDealLabel: split ? split.dealLabel : null
      });
    }
  }
  return dealers;
}

/**
 * Called by the Run Dealer modal. Writes VINs to ORDERS sheet then runs.
 * @param {string}      dealerKey
 * @param {Array}       vins
 * @param {string|null} dealId         - Pipedrive Deal ID. Optional — only pre-fills the
 *                                        post-run finalization card; RUN_LOG is written at
 *                                        finalization, never during the run.
 * @param {string|null} runId          - Progress tracking ID generated by modal (optional)
 * @param {boolean}     bypassFilters  - If true, skip filtering rules during run
 * @param {string}      userKey        - Key from USER_PROFILES tab; determines local QR base path
 * @param {string|null} splitDealId    - Second Pipedrive Deal ID for billing-split dealers.
 *                                        Optional — pre-fills the group finalization card.
 */
function pasteVinsAndRun(dealerKey, vins, dealId, runId, bypassFilters, userKey, splitDealId) {
  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);

  // Resolve QR base path from USER_PROFILES. Throw early so the user sees a
  // clear message before the run starts rather than getting a blank @QR column.
  if (!userKey || String(userKey).trim() === '') throw new Error('Please select a user before running.');
  var qrBasePath = getQRBasePathForUser_(String(userKey).trim());

  // Persist the selection so the dropdown pre-selects on next open.
  saveLastSelectedUser(userKey);

  // De-duplicate the ordered VINs (case-insensitive, order-preserving) so a VIN
  // can never be submitted twice — keeps ordered counts honest. The Run Order
  // modal also dedupes at submit; this guarantees it regardless of entry path.
  var seenVin_ = {};
  vins = (vins || []).filter(function(v) {
    var k = String(v).trim().toUpperCase();
    if (k === '' || k === '*' || seenVin_[k]) return false;
    seenVin_[k] = 1;
    return true;
  });

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
  return runDealer(dealerKey, dealId ? String(dealId).trim() : '', runId || null, bypassFilters === true,
                   qrBasePath, config, splitDealId ? String(splitDealId).trim() : '');
}

/**
 * Main entry point. Example: runDealer('AUFFENBERG_HYUNDAI', '44001')
 * @param {string}      dealerKey
 * @param {string}      dealId         - Pipedrive Deal ID. Pre-fill only — RUN_LOG is
 *                                        written at finalization (finalizeRun), not here.
 * @param {string|null} runId          - Progress tracking ID (optional; from modal)
 * @param {boolean}     bypassFilters  - If true, skip filtering rules for this run
 * @param {string}      qrBasePath     - Local folder path for QR PNGs (from USER_PROFILES)
 * @param {Array|null}  preloadedConfig - Config row already loaded by pasteVinsAndRun;
 *                                        skips a redundant getDealerConfig_ call when provided.
 * @param {string|null} splitDealId    - Second Pipedrive Deal ID for the billing-split
 *                                        group (e.g. Sprinter). Pre-fill only.
 * @return {Object|null} {outputFolderUrl, pendingRuns, dealerName, producedVinCount} —
 *                       pendingRuns entries are finalized or abandoned in the modal;
 *                       nothing is logged until finalizeRun runs.
 */
function runDealer(dealerKey, dealId, runId, bypassFilters, qrBasePath, preloadedConfig, splitDealId) {
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

    // 2. Load VINs from ORDERS sheet. (Type rules now come from the Pipedrive product map —
    //    built after matching; see step 9b.)
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
        var result = applyFilteringRules_([scraperRow], filterRules, 'run');
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
    // Poll for the QUERY spill instead of a fixed sleep — exits as soon as
    // results land. Cap matches the old delay (40ms/row, 1s floor, 3.5s cap).
    waitForRecalc_(calcRecalcDelay_(vins.length, 40, 1000, 3500), function() {
      return String(outputDoc.getSheetByName('ORDERMATCH').getRange('A2').getValue()) !== '';
    });
    var matchedRows = readOrderMatchResults_(outputDoc);
    Logger.log('Matched rows: ' + matchedRows.length);

    // 9b. The Pipedrive product map is now the SOLE per-type config (schema + UTM). Build the
    //     run's type rules from it, and BLOCK if any matched vehicle's type has no product or no
    //     schema — the user is prompted to set it in Dealer Rules → Pipedrive.
    var csvSourceSplit = getSourceSplit_(config);
    var csvProductMaps = getCsvProductMaps_(config[CFG.KEY], csvSourceSplit);
    var matchedTypes = {};
    matchedRows.forEach(function(r) { var t = String(r[6] || '').trim(); if (t) matchedTypes[t] = true; });
    var missingCfg = validateProductMapForRun_(Object.keys(matchedTypes), csvProductMaps.main);
    if (missingCfg.length) {
      throw new Error('Cannot run ' + config[CFG.NAME] + ' — no product/schema set for type(s): ' +
        missingCfg.join(', ') + '. Set them in Dealer Rules → Pipedrive.');
    }
    var typeRules = buildTypeRulesFromProductMap_(csvProductMaps.main);
    Logger.log('Type rules (from product map): ' + JSON.stringify(typeRules));

    // 10. Copy VIN log into LOG tab of output doc
    setProgress_(runId, 'Copying VIN log (' + matchedRows.length + ' matched)...', 50);
    copyVINLogToOutput_(outputDoc, dealerKey);

    // 11. Build LINKBUILDER, generate QR codes in parallel
    setProgress_(runId, 'Building link formulas...', 56);
    var links    = buildLinks_(outputDoc, config, typeRules);
    // Auto-clear the dealer's QR folder first: folders then only ever hold the
    // current run's PNGs (old ones go to Drive trash, 30-day recovery). Keeps
    // uploads fast, abandons cheap, and kills the duplicate-filename pileup.
    setProgress_(runId, 'Clearing old QR codes...', 60);
    var clearedOld = clearQRFolder_(config[CFG.QR_FOLDER_ID]);
    if (clearedOld > 0) Logger.log('Cleared ' + clearedOld + ' old QR PNGs before run.');

    setProgress_(runId, 'Generating ' + links.length + ' QR code' + (links.length === 1 ? '' : 's') + ' (parallel)...', 64);
    var qrFileIds = generateQRCodesParallel_(links, config[CFG.QR_FOLDER_ID], config[CFG.QR_PREFIX]);
    Logger.log('QR codes generated: ' + qrFileIds.length + ' of ' + links.length);

    // 12. Write QR paths into ORDERMATCH col J
    setProgress_(runId, links.length + ' QR codes complete. Writing paths...', 82);
    writeQRPaths_(outputDoc, config[CFG.QR_PREFIX], links.length, qrBasePath);

    // 13. Build CSV sheet(s) based on type rules. A dual-site dealer
    //     (source_split) additionally splits each CSV by URL domain
    //     (e.g. main vs AutoLoanPro) — one billing/deal, separate CSVs.
    setProgress_(runId, 'Building CSV output...', 88);
    buildCSVSheet_(outputDoc, typeRules, csvSourceSplit, csvProductMaps.main, csvProductMaps.secondary);

    // 14. Write BILLING sheet(s) from ORDERMATCH + LOG data. An optional
    //     billing_split in filtering_rules renders group vehicles (e.g. Sprinter
    //     vans) to a separate BILLING_<group> sheet — separate billing account,
    //     same run and same CSV.
    setProgress_(runId, 'Writing billing sheet...', 91);
    var billingSplit  = getBillingSplit_(config);
    var billingResult = writeBillingSheet_(outputDoc, billingSplit, getSourceSplit_(config));

    // 15. Read billing totals back from the sheet(s) we just wrote
    setProgress_(runId, 'Reading billing totals...', 93);
    SpreadsheetApp.flush();
    var billingTotals = readBillingTotals_(outputDoc);
    var groupTotals   = null;
    if (billingSplit && billingResult && billingResult.group) {
      groupTotals = readBillingTotals_(outputDoc, 'BILLING_' + billingSplit.groupName);
    }

    // 16. Read produced VINs from ORDERMATCH col E (VIN column) — the grand list
    //     across both billing groups; per-group lists come from billingResult.
    setProgress_(runId, 'Reading produced VINs...', 95);
    var omSheet     = outputDoc.getSheetByName('ORDERMATCH');
    var omLastRow   = omSheet.getLastRow();
    var producedVins = [];
    if (omLastRow >= 2) {
      producedVins = omSheet.getRange(2, 5, omLastRow - 1, 1).getValues()
        .map(function(r) { return String(r[0]).trim(); })
        .filter(function(v) { return v !== ''; });
    }

    // 17. Build prospective run-log entries — RUN_LOG/ORDER_STATS are written
    //     ONLY when the user finalizes each entry in the post-run panel
    //     (finalizeRun), never during the run. With a billing split that
    //     produced group units there are two entries (one per account); with
    //     zero group units there is one (the note records the empty group).
    //     Every entry is self-contained so finalizeRun can take it verbatim.
    setProgress_(runId, 'Preparing run summary...', 97);
    var duration     = Math.round((new Date() - startTime) / 1000);
    var outputDocId  = outputDoc.getId();
    var pendingRuns  = [];
    var groupMatched = (billingResult && billingResult.group)
                         ? billingResult.group.matchedCount : 0;

    if (billingSplit && billingResult && groupMatched > 0) {
      pendingRuns.push({
        groupKey:      'PRIMARY',
        pushModes:     getRunPushModes(dealerKey, 'PRIMARY'),
        label:         config[CFG.NAME],
        dealLabel:     'Pipedrive Deal ID',
        totalOrdered:  vins.length - groupMatched,
        totalMatched:  matchedRows.length - groupMatched,
        billing:       billingTotals,
        producedVins:  billingResult.primary.producedVins,
        note:          'SPLIT:PRIMARY',
        prefillDealId: dealId || '',
        outputDocId:   outputDocId,
        qrFileIds:     qrFileIds,
        durationSec:   duration,
        errors:        errors
      });
      pendingRuns.push({
        groupKey:      billingSplit.groupName,
        pushModes:     getRunPushModes(dealerKey, billingSplit.groupName),
        label:         billingSplit.groupName,
        dealLabel:     billingSplit.dealLabel,
        totalOrdered:  groupMatched,
        totalMatched:  groupMatched,
        billing:       groupTotals,
        producedVins:  billingResult.group.producedVins,
        note:          'SPLIT:' + billingSplit.groupName,
        prefillDealId: splitDealId || '',
        outputDocId:   outputDocId,
        qrFileIds:     qrFileIds,
        durationSec:   duration,
        errors:        errors
      });
    } else {
      pendingRuns.push({
        groupKey:      'PRIMARY',
        pushModes:     getRunPushModes(dealerKey, 'PRIMARY'),
        label:         config[CFG.NAME],
        dealLabel:     'Pipedrive Deal ID',
        totalOrdered:  vins.length,
        totalMatched:  matchedRows.length,
        billing:       billingTotals,
        producedVins:  producedVins,
        note:          (billingSplit && billingResult)
                         ? 'split: 0 ' + billingSplit.groupName + ' units' : '',
        prefillDealId: dealId || '',
        outputDocId:   outputDocId,
        qrFileIds:     qrFileIds,
        durationSec:   duration,
        errors:        errors
      });
    }

    // 18. Done
    setProgressDone_(runId, 'Complete! ' + producedVins.length + ' VIN' +
                     (producedVins.length === 1 ? '' : 's') + ' produced in ' + duration +
                     's. Finalize or abandon below to log this run.');

    return {
      outputFolderUrl:  'https://drive.google.com/drive/folders/' + outputFolderId,
      pendingRuns:      pendingRuns,
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
  var sheet   = getMasterSS_().getSheetByName('SCRAPERDATA');
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
  // Full canonical width so CAO/run filtering (applyFilteringRules_ /
  // evaluateCondition_) can read appended columns. pasteScraperData_ slices
  // back to the base 21 before writing the output doc (the template + ORDERMATCH
  // "SELECT … A:U" QUERY only use the first 21).
  var data = sheet.getRange(sheetFirstRow, 1, spanRows, getSchemaColCount_()).getValues();

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
    // Output doc only needs the base 21 (template + A:U QUERY) — slice off any
    // appended store-only columns the filtering read brought along.
    var cleanData = data.map(function(row) {
      var r = row.slice(0, 21);
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
  var VIN_COL      = 0;
  var STOCK_COL    = 1;
  var TYPE_COL     = 2;
  var STATUS_COL   = 8;
  var PRICE_COL    = 9;
  var LOCATION_COL = 19;

  var total              = 0;
  var typeCounts         = {};
  var statusCounts       = {};
  var locationTypeCounts = {};

  // Per-location detail map used by writeImportStats_ and checkImportHealth_
  // Structure: { locationName: { total, new, po, cpo, cpo_el, other_types,
  //                               onlot, offlot, other_status, no_price, no_stock } }
  var locationDetail = {};

  for (var i = 0; i < rows.length; i++) {
    var vin = String(rows[i][VIN_COL]).trim();
    if (vin === '' || vin === '*') continue;

    var stock    = String(rows[i][STOCK_COL]).trim();
    var type     = String(rows[i][TYPE_COL]).trim();
    var status   = String(rows[i][STATUS_COL]).trim();
    var price    = String(rows[i][PRICE_COL]).trim();
    var location = String(rows[i][LOCATION_COL]).trim();

    total++;
    typeCounts[type]     = (typeCounts[type]     || 0) + 1;
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (!locationTypeCounts[location]) locationTypeCounts[location] = {};
    locationTypeCounts[location][type] = (locationTypeCounts[location][type] || 0) + 1;

    // Build per-location detail
    if (!locationDetail[location]) {
      locationDetail[location] = {
        total: 0, new: 0, po: 0, cpo: 0, cpo_el: 0, other_types: 0,
        onlot: 0, offlot: 0, other_status: 0, no_price: 0, no_stock: 0
      };
    }
    var loc = locationDetail[location];
    loc.total++;

    // Type buckets
    if      (type === 'New')    loc.new++;
    else if (type === 'PO')     loc.po++;
    else if (type === 'CPO')    loc.cpo++;
    else if (type === 'CPO-EL') loc.cpo_el++;
    else                        loc.other_types++;

    // Status buckets
    if      (status === 'ONLOT')  loc.onlot++;
    else if (status === 'OFFLOT') loc.offlot++;
    else                          loc.other_status++;

    // Missing field flags
    var priceNum = parseFloat(price);
    if (price === '' || price === '*' || price === '0' || priceNum === 0) loc.no_price++;
    if (stock === '' || stock === '*') loc.no_stock++;
  }

  return {
    total:              total,
    typeCounts:         typeCounts,
    statusCounts:       statusCounts,
    locationTypeCounts: locationTypeCounts,
    locationDetail:     locationDetail
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
  var readCol = (config[CFG.LINKBUILDER_COL] === 'C') ? 3 : 2;
  // Poll until the LAST link formula has produced a URL — exits early on fast
  // recalcs. Cap matches the old fixed delay (30ms/row, 700ms floor, 2s cap);
  // rows without a URL fall back to waiting the full cap, same as before.
  waitForRecalc_(calcRecalcDelay_(numRows, 30, 700, 2000), function() {
    if (numRows === 0) return true;
    var v = String(outputDoc.getSheetByName('LINKBUILDER').getRange(numRows + 1, readCol).getValue());
    return v.indexOf('http') === 0;
  });

  var sheet   = outputDoc.getSheetByName('LINKBUILDER');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

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

/**
 * Generates QR PNGs (parallel download) and saves them to the dealer's Drive
 * folder via PARALLEL multipart uploads to the Drive REST API — the old
 * sequential DriveApp.createFile() loop cost ~120ms per file (6–24s per run).
 * Returns the created Drive file IDs (QR index order) so the finalization
 * panel can abandon exactly this run's files by ID. Any upload that fails
 * falls back to a one-off DriveApp.createFile for that file.
 */
function generateQRCodesParallel_(links, qrFolderId, qrPrefix) {
  if (!links || links.length === 0) return [];

  // 1. Download all QR PNGs in one parallel round (unchanged).
  var dlRequests = links.map(function(url) {
    return {
      url:                'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(url),
      method:             'GET',
      muteHttpExceptions: true
    };
  });
  var responses = UrlFetchApp.fetchAll(dlRequests);

  // 2. Build one multipart upload request per successful download.
  var token    = ScriptApp.getOAuthToken();
  var boundary = 'sfx_qr_upload_boundary';
  var uploads  = [];
  var qrIndex  = [];  // upload position → original QR index (for names/fallback)
  responses.forEach(function(response, i) {
    if (response.getResponseCode() !== 200) {
      Logger.log('QR download failed for index ' + (i + 1) + ': HTTP ' + response.getResponseCode());
      return;
    }
    var fileName = qrPrefix + '_QR_Code_' + (i + 1) + '.PNG';
    var body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name: fileName, parents: [qrFolderId] }) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: image/png\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      Utilities.base64Encode(response.getBlob().getBytes()) + '\r\n' +
      '--' + boundary + '--';
    uploads.push({
      url:                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      method:             'post',
      contentType:        'multipart/related; boundary=' + boundary,
      headers:            { Authorization: 'Bearer ' + token },
      payload:            body,
      muteHttpExceptions: true
    });
    qrIndex.push(i);
  });

  // 3. Fire uploads in parallel batches; collect file IDs in QR order.
  var qrFileIds = [];
  for (var b = 0; b < uploads.length; b += 50) {
    var batch = UrlFetchApp.fetchAll(uploads.slice(b, b + 50));
    batch.forEach(function(r, j) {
      var idx = qrIndex[b + j];
      if (r.getResponseCode() < 300) {
        qrFileIds.push(JSON.parse(r.getContentText()).id);
      } else {
        Logger.log('QR upload failed for index ' + (idx + 1) + ': HTTP ' +
                   r.getResponseCode() + ' — falling back to DriveApp.');
        try {
          var fn = qrPrefix + '_QR_Code_' + (idx + 1) + '.PNG';
          qrFileIds.push(DriveApp.getFolderById(qrFolderId)
            .createFile(responses[idx].getBlob().setName(fn).setContentType('image/png'))
            .getId());
        } catch (e) {
          Logger.log('QR fallback createFile failed for index ' + (idx + 1) + ': ' + e.message);
        }
      }
    });
  }
  return qrFileIds;
}

/**
 * Batch-trashes Drive files via the REST API — one parallel fetchAll round
 * per 100 files instead of a sequential DriveApp.setTrashed() per file
 * (~120ms each; hundreds of files = minutes — this was the "abandon hangs"
 * bottleneck). Token scope is already granted via the script's DriveApp use.
 */
function trashFilesParallel_(fileIds) {
  if (!fileIds || fileIds.length === 0) return 0;
  var token = ScriptApp.getOAuthToken();
  var requests = fileIds.map(function(id) {
    return {
      url:                'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id),
      method:             'patch',
      contentType:        'application/json',
      headers:            { Authorization: 'Bearer ' + token },
      payload:            JSON.stringify({ trashed: true }),
      muteHttpExceptions: true
    };
  });
  var ok = 0;
  for (var i = 0; i < requests.length; i += 100) {
    UrlFetchApp.fetchAll(requests.slice(i, i + 100)).forEach(function(r) {
      if (r.getResponseCode() < 300) ok++;
      else Logger.log('trashFilesParallel_: HTTP ' + r.getResponseCode());
    });
  }
  return ok;
}

// Clears a QR folder by collecting file IDs (cheap iteration) and batch-
// trashing them in parallel. Also called automatically at the start of every
// run so dealer QR folders only ever hold the current run's PNGs.
function clearQRFolder_(folderId) {
  var ids   = [];
  var files = DriveApp.getFolderById(folderId).getFiles();
  while (files.hasNext()) ids.push(files.next().getId());
  return trashFilesParallel_(ids);
}

// Core/wrapper split: ui.alert() FAILS when a function is invoked from a
// dialog via google.script.run, so the App calls app*() wrappers that return
// {message} for an in-app toast, while the classic menu keeps its alert.
function eraseAllQRFoldersCore_() {
  var data    = getConfigSS_()
    .getSheetByName('DEALERS').getDataRange().getValues();
  var cleared = 0;
  for (var i = 1; i < data.length; i++) {
    if (isTrue_(data[i][CFG.ACTIVE]) && data[i][CFG.QR_FOLDER_ID] !== '[QR_FOLDER_ID]') {
      try { clearQRFolder_(data[i][CFG.QR_FOLDER_ID]); cleared++; }
      catch(e) { Logger.log('QR folder clear failed: ' + data[i][CFG.KEY] + ' — ' + e.message); }
    }
  }
  return cleared;
}

function eraseAllQRFolders() {
  var cleared = eraseAllQRFoldersCore_();
  SpreadsheetApp.getUi().alert('Cleared QR folders for ' + cleared + ' active dealers.');
}

function appEraseAllQRFolders() {
  var cleared = eraseAllQRFoldersCore_();
  return { message: 'Cleared QR folders for ' + cleared + ' active dealers.' };
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
  'PRICE_PLUS_2000':    20,
  'PRICE_TAGLINE':      21
};

/**
 * Resolves the CSV schema for a type rule. The schema is DERIVED from the rule's product
 * (`productMap[type].schema`) when present, else falls back to the rule's own `csv_schema`.
 * A `*` catch-all rule has no single type → always the fallback. So the product the user
 * picks for billing also determines the CSV layout, with `csv_schema` as the safety net.
 */
function resolveRuleSchema_(rule, productMap) {
  var t = rule.match;
  if (t && t !== '*' && productMap && productMap[t] &&
      typeof productMap[t] === 'object' && productMap[t].schema) {
    return String(productMap[t].schema);
  }
  return rule.csv_schema;
}

/**
 * Groups a dealer's type rules into CSV OUTPUTS by their RESOLVED schema (product-derived,
 * or the rule's `csv_schema` fallback). Rules whose types resolve to the same schema merge
 * into one CSV. Sheet name is 'CSV' for a single schema, else 'CSV_<SCHEMA>'. Pure + testable.
 *
 * @param {Array}  typeRules  - [{match, csv_schema, utm, …}, …]
 * @param {Object} productMap - {type: {product_id, variation_id?, schema?}} (may be {})
 * @return {Object} { groups: [{key, schema, matches[], sheetBase}], matchToKey: {match→schema}, single: bool }
 */
function csvOutputGroups_(typeRules, productMap) {
  var order = [], byKey = {}, matchToKey = {};
  (typeRules || []).forEach(function(rule) {
    var schema = resolveRuleSchema_(rule, productMap) || 'SCP';
    if (!byKey[schema]) { byKey[schema] = { key: schema, schema: schema, matches: [] }; order.push(schema); }
    byKey[schema].matches.push(rule.match);
    matchToKey[rule.match] = schema;
  });
  var single = order.length === 1;
  var groups = order.map(function(k) {
    byKey[k].sheetBase = single ? 'CSV' : 'CSV_' + String(k).replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    return byKey[k];
  });
  return { groups: groups, matchToKey: matchToKey, single: single };
}

function buildCSVSheet_(outputDoc, typeRules, sourceSplit, mainProductMap, secondaryProductMap) {
  mainProductMap      = mainProductMap || {};
  secondaryProductMap = secondaryProductMap || {};
  var omSheet = outputDoc.getSheetByName('ORDERMATCH');
  var lastRow = omSheet.getLastRow();
  if (lastRow < 2) { Logger.log('No ORDERMATCH data for CSV.'); return; }

  var omData = omSheet.getRange(2, 1, lastRow - 1, 100).getValues()
    .filter(function(row) { return String(row[0]).trim() !== ''; });
  var URL_COL = 8;  // ORDERMATCH Vehicle URL (col I)

  // Renders one CSV sheet from a set of ORDERMATCH rows + a SCHEMA key.
  function writeGroup_(schemaKey, rows, sheetName) {
    var fieldCodes = getCsvSchema_(schemaKey) || getCsvSchema_('SCP');
    var dataRows = rows.map(function(row) {
      return fieldCodes.map(function(code) {
        var col = FIELD_TO_COL[code];
        return col ? row[col - 1] : '';
      });
    });
    writeCSVSheet_(outputDoc, sheetName, dedupFieldCodeHeaders_(fieldCodes), dataRows);
    Logger.log('CSV sheet "' + sheetName + '" written: ' + dataRows.length + ' rows, schema: ' + schemaKey);
  }

  // Groups one source partition's vehicles by their RESOLVED schema (via productMap) and
  // writes a CSV per schema. suffix '' for the main partition, '_<group>' for the secondary.
  function writePartition_(vehicles, productMap, suffix) {
    var og = csvOutputGroups_(typeRules, productMap);
    var rowsByKey = {};
    og.groups.forEach(function(g) { rowsByKey[g.key] = []; });
    vehicles.forEach(function(row) {
      var rule = matchRule_(String(row[6]), typeRules);
      var key  = og.matchToKey[rule.match];
      (rowsByKey[key] || (rowsByKey[key] = [])).push(row);
    });
    og.groups.forEach(function(g) {
      writeGroup_(g.schema, rowsByKey[g.key] || [], g.sheetBase + suffix);
    });
  }

  if (!sourceSplit) { writePartition_(omData, mainProductMap, ''); return; }

  // Dual-site source split: partition by URL FIRST, then group each side by its own resolved
  // schema. The main uses the dealer's product map; the secondary uses the source_product_map
  // (so the subprime site can use a different template/layout for the same vehicle type).
  // Both partitions are always written (secondary may be empty). Billing/deal/RUN_LOG unaffected.
  var main = [], secondary = [];
  omData.forEach(function(row) {
    if (String(row[URL_COL]).toLowerCase().indexOf(sourceSplit.urlContains) !== -1) secondary.push(row);
    else main.push(row);
  });
  writePartition_(main,      mainProductMap,      '');
  writePartition_(secondary, secondaryProductMap, '_' + sourceSplit.groupName);
}

/**
 * Reads the dealer's Pipedrive product maps for CSV schema resolution. Safe + cheap —
 * `getPipedriveDealerRows_` returns [] when Pipedrive isn't configured, so the caller simply
 * falls back to `type_rules.csv_schema`. Returns `{main, secondary}`:
 *   main      = merged product map across all billing groups (type → {…, schema?}; first wins)
 *   secondary = the `source_product_map` for a `source_split`'s group (type → entry), or {}
 */
function getCsvProductMaps_(dealerKey, sourceSplit) {
  var out = { main: {}, secondary: {} };
  var rows;
  try { rows = getPipedriveDealerRows_(dealerKey); } catch (e) { return out; }
  (rows || []).forEach(function(r) {
    var pm = r.productMap || {};
    Object.keys(pm).forEach(function(t) { if (!out.main[t]) out.main[t] = pm[t]; });
    if (sourceSplit && r.sourceProductMap && r.sourceProductMap[sourceSplit.groupName] &&
        !Object.keys(out.secondary).length) {
      out.secondary = r.sourceProductMap[sourceSplit.groupName];
    }
  });
  return out;
}

/**
 * Builds the run's type rules from the Pipedrive product map — the product map is the SOLE
 * per-type config. One synthetic rule per mapped type: `{match, csv_schema: entry.schema, utm:
 * entry.utm}`. Ordered **longest match first** so a substring type never shadows a longer one:
 * `matchRule_` is substring-based ("CPO" is a substring of "CPO-EL"), so "CPO-EL" must precede
 * "CPO". This is generic — any user-added type orders safely with no hardcoded list. Pure + testable.
 */
function buildTypeRulesFromProductMap_(productMap) {
  var keys = Object.keys(productMap || {});
  keys.sort(function(a, b) {
    if (b.length !== a.length) return b.length - a.length;   // longest first (substring safety)
    return a < b ? -1 : (a > b ? 1 : 0);                     // stable tie-break
  });
  return keys.map(function(t) {
    var e = productMap[t] || {};
    return { match: t, csv_schema: String(e.schema || ''), utm: String(e.utm || '') };
  });
}

/**
 * Returns the matched vehicle types that can't be produced because their product-map entry is
 * missing a product or a schema (the run blocks on a non-empty result — the user is prompted to
 * set it). A type with no entry, no `product_id`, or no `schema` is reported. Pure + testable.
 */
function validateProductMapForRun_(matchedTypes, productMap) {
  productMap = productMap || {};
  var missing = [];
  (matchedTypes || []).forEach(function(t) {
    var e = productMap[t];
    if (!e || typeof e !== 'object' || e.product_id == null || e.product_id === '' ||
        e.schema == null || String(e.schema).trim() === '') {
      missing.push(t);
    }
  });
  return missing;
}

/**
 * ONE-TIME MIGRATION — run manually from the Apps Script editor. Copies each dealer's per-type
 * schema + UTM from its legacy `type_rules` (DEALERS col O) into its PIPEDRIVE `product_map` /
 * `source_product_map` entries (the product map is now the sole per-type config). Only fills
 * entries that already have a product mapped; never overwrites an existing schema/utm. Logs a
 * per-dealer summary; idempotent. After this + finishing the product config, type_rules (col O)
 * is dormant.
 */
function migrateTypeRulesIntoProductMap() {
  var dealers = getConfigSS_().getSheetByName('DEALERS').getDataRange().getValues();
  var summary = [];

  function fillMap_(map, typeRules) {
    var n = 0;
    Object.keys(map || {}).forEach(function(t) {
      var rule = matchRule_(t, typeRules);
      if (!rule) return;
      if (rule.csv_schema && !map[t].schema) { map[t].schema = rule.csv_schema; n++; }
      if (rule.utm && !map[t].utm)           { map[t].utm    = rule.utm;        n++; }
    });
    return n;
  }

  for (var i = 1; i < dealers.length; i++) {
    var dealerKey = String(dealers[i][CFG.KEY] || '').trim();
    if (!dealerKey) continue;
    var typeRules = getTypeRules_(dealers[i]);   // legacy col O
    var rows = getPipedriveDealerRows_(dealerKey);
    if (!rows.length) continue;

    var touched = 0;
    rows.forEach(function(r) {
      touched += fillMap_(r.productMap, typeRules);
      Object.keys(r.sourceProductMap || {}).forEach(function(grp) {
        touched += fillMap_(r.sourceProductMap[grp], typeRules);
      });
    });
    if (touched > 0) { savePipedriveDealerConfig(dealerKey, rows); summary.push(dealerKey + ': ' + touched + ' field(s)'); }
  }
  var msg = 'migrateTypeRulesIntoProductMap: updated ' + summary.length + ' dealer(s).\n' + summary.join('\n');
  Logger.log(msg);
  return msg;
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
  var vinLogSS  = getVinLogsSS_();
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

function writeRunLog_(config, dealId, totalOrdered, totalMatched, billing, outputDocId, durationSec, errors, producedVins, note) {
  var ss              = SpreadsheetApp.getActiveSpreadsheet();
  var sheet           = ss.getSheetByName('RUN_LOG');
  var producedVinsCSV = Array.isArray(producedVins) ? producedVins.join(',') : '';
  var timestamp       = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
  var vinsProduced    = Array.isArray(producedVins) ? producedVins.length : 0;

  sheet.appendRow([
    timestamp,                     // A: run_timestamp
    config[CFG.KEY],               // B: dealer_key
    config[CFG.NAME],              // C: dealer_name
    dealId || '',                  // D: order_id (Pipedrive Deal ID)
    totalOrdered,                  // E: total_ordered
    totalMatched,                  // F: total_matched
    billing.totalNew    || 0,      // G: total_new
    billing.totalPO     || 0,      // H: total_po
    billing.totalCPO    || 0,      // I: total_cpo
    billing.totalCPOEL  || 0,      // J: total_cpo_el
    billing.newDupes    || 0,      // K: new_dupes
    billing.poDupes     || 0,      // L: po_dupes
    billing.cpoDupes    || 0,      // M: cpo_dupes
    billing.cpoElDupes  || 0,      // N: cpo_el_dupes
    billing.totalDupes  || 0,      // O: total_dupes
    totalMatched,                  // P: total_produced
    '',                            // Q: qr_codes_generated
    outputDocId,                   // R: output_doc_id
    durationSec,                   // S: run_duration_sec
    errors.join('; ') || '',       // T: errors
    note || '',                    // U: notes (e.g. 'SPLIT:PRIMARY' / 'SPLIT:<group>')
    producedVinsCSV,               // V: produced_vins
    ''                             // W: vin_log_status (blank = pending)
  ]);

  // Also append a clean analytics row to ORDER_STATS
  var matchRate = (totalOrdered > 0) ? (totalMatched / totalOrdered) : 0;
  try {
    var statsSheet = ss.getSheetByName('ORDER_STATS');
    if (statsSheet) {
      statsSheet.appendRow([
        timestamp,                 // A: timestamp
        config[CFG.KEY],           // B: dealer_key
        config[CFG.NAME],          // C: dealer_name
        dealId || '',              // D: order_id
        totalOrdered,              // E: vins_ordered
        totalMatched,              // F: vins_matched
        vinsProduced,              // G: vins_produced
        matchRate,                 // H: match_rate
        billing.totalNew   || 0,   // I: new
        billing.totalPO    || 0,   // J: po
        billing.totalCPO   || 0,   // K: cpo
        billing.totalCPOEL || 0    // L: cpo_el
      ]);
    }
  } catch (e) {
    Logger.log('writeRunLog_: ORDER_STATS append failed (non-fatal): ' + e.message);
  }

  return sheet.getLastRow();
}


/**
 * Writes the RUN_LOG (+ ORDER_STATS) row for one pending run entry from the
 * post-run finalization panel. Called once per finalized card.
 *
 * RUN_LOG invariant: no row is ever written without a deal ID — the user
 * enters "test" for test runs. Finalization NEVER touches the VIN log; that
 * stays an explicit, separate commit (Add to VIN Log / VIN Log Updater).
 *
 * @param {string} dealerKey
 * @param {Object} entry  - one pendingRuns element from runDealer's return
 * @param {string} dealId - non-blank deal ID entered/confirmed on the card
 * @return {Object} {rowIndex, vinCount}
 */
function finalizeRun(dealerKey, entry, dealId) {
  if (!dealId || String(dealId).trim() === '') {
    throw new Error('A Deal ID is required to finalize (use "test" for test runs).');
  }
  if (!entry || !entry.billing) throw new Error('Invalid run entry payload.');

  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);

  var rowIndex = writeRunLog_(config, String(dealId).trim(),
    entry.totalOrdered, entry.totalMatched, entry.billing, entry.outputDocId,
    entry.durationSec, entry.errors || [], entry.producedVins || [], entry.note || '');

  return { rowIndex: rowIndex, vinCount: (entry.producedVins || []).length };
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
 * Writes five sections to BILLING:
 *   Section 1 — Order Summary (ordered / matched / not found)
 *   Section 2 — Matched by Type, gross counts
 *   Section 3 — Duplicates by Type + totals
 *   Section 4 — Duplicate detail table (one row per dupe vehicle)
 *   Section 5 — Produced VIN list (one VIN per row, col B)
 *
 * When billingSplit is provided (see getBillingSplit_), matched vehicles in the
 * group render to a separate BILLING_<group_name> sheet (created on demand —
 * the template is intentionally untouched) and BILLING gets the rest. Ordered
 * identifiers not found in the scraper can't be classified, so they stay on the
 * primary sheet; sums across both sheets equal the unsplit totals.
 *
 * @param {Spreadsheet}  outputDoc
 * @param {Object|null}  billingSplit - parsed split config, or null for the
 *                                      classic single-sheet behavior
 * @return {Object|null} {primary: {matchedCount, producedVins},
 *                        group: {matchedCount, producedVins}|null}
 *                       or null if required sheets are missing
 */
function writeBillingSheet_(outputDoc, billingSplit, sourceSplit) {
  var billingSheet = outputDoc.getSheetByName('BILLING');
  var omSheet      = outputDoc.getSheetByName('ORDERMATCH');
  var logSheet     = outputDoc.getSheetByName('LOG');
  var orderSheet   = outputDoc.getSheetByName('ORDER');

  if (!billingSheet || !omSheet || !logSheet || !orderSheet) {
    Logger.log('writeBillingSheet_: missing required sheet(s), skipping.');
    return null;
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

  // ── 5. Partition by billing group and render ─────────────────────────────
  var primaryRows = omRows;
  var groupRows   = [];
  if (billingSplit) {
    primaryRows = [];
    omRows.forEach(function(v) {
      (isInBillingGroup_(v, billingSplit) ? groupRows : primaryRows).push(v);
    });
  }

  renderBillingSheet_(billingSheet, primaryRows, totalOrdered - groupRows.length,
                      notFoundList, logMap, sourceSplit);

  var vinOf = function(v) { return v.vin; };
  var nonBlank = function(v) { return v !== ''; };
  var result = {
    primary: {
      matchedCount: primaryRows.length,
      producedVins: primaryRows.map(vinOf).filter(nonBlank)
    },
    group: null
  };

  if (billingSplit) {
    var groupSheetName = 'BILLING_' + billingSplit.groupName;
    var groupSheet = outputDoc.getSheetByName(groupSheetName) || outputDoc.insertSheet(groupSheetName);
    renderBillingSheet_(groupSheet, groupRows, groupRows.length, [], logMap, sourceSplit);
    result.group = {
      matchedCount: groupRows.length,
      producedVins: groupRows.map(vinOf).filter(nonBlank)
    };
  }

  return result;
}

/**
 * Renders one billing sheet from scratch: type counts, duplicate detection
 * against the VIN log map, and the five fixed-layout sections. Layout matches
 * readBillingTotals_'s label map exactly — used for both the primary BILLING
 * sheet and the optional BILLING_<group> sheet.
 *
 * @param {Sheet}  sheet        - target sheet (cleared before writing)
 * @param {Array}  omRows       - parsed ORDERMATCH vehicle objects for this sheet
 * @param {number} totalOrdered - ordered count attributed to this sheet
 * @param {Array}  notFoundList - ordered identifiers not matched in the scraper
 * @param {Object} logMap       - identifier → [prior ORDER_IDs]
 */
function renderBillingSheet_(sheet, omRows, totalOrdered, notFoundList, logMap, sourceSplit) {
  // ── Classify vehicles and find duplicates ────────────────────────────────
  // Registry-driven: every registered type (built-ins + user-added) gets a fixed row;
  // a type in the data but NOT registered still surfaces via the "unexpected type" path.
  var TYPE_ORDER   = getCanonicalVehicleTypes_();
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

  // ── Compute summary totals ───────────────────────────────────────────────
  var totalMatched = omRows.length;
  var totalDupes   = 0;
  Object.keys(typeGroups).forEach(function(t) { totalDupes += typeGroups[t].dupes; });

  var unexpectedTypes = Object.keys(typeGroups).filter(function(t) {
    return TYPE_ORDER.indexOf(t) === -1;
  });

  // ── Build output rows ────────────────────────────────────────────────────
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

  // Section 2b — By Source (dual-site source_split only): per-type qty for each
  // website so the user can enter the correct quantity per SKU in Pipedrive.
  // Labels are source-prefixed (e.g. "Main Site — PO") so they never collide
  // with readBillingTotals_'s trimmed type labels (which feed the RUN_LOG).
  if (sourceSplit) {
    var SEC_LABEL  = sourceSplit.groupName;          // e.g. AUTOLOANPRO
    var MAIN_LABEL = 'Main Site';
    var marker     = String(sourceSplit.urlContains || '').toLowerCase();
    var bySource   = {};   // { 'Main Site': {type: n}, 'AUTOLOANPRO': {type: n} }
    bySource[MAIN_LABEL] = {}; bySource[SEC_LABEL] = {};
    var srcTotal = {}; srcTotal[MAIN_LABEL] = 0; srcTotal[SEC_LABEL] = 0;

    omRows.forEach(function(v) {
      var src = (String(v.url || '').toLowerCase().indexOf(marker) !== -1) ? SEC_LABEL : MAIN_LABEL;
      var t   = v.type || 'Unknown';
      bySource[src][t] = (bySource[src][t] || 0) + 1;
      srcTotal[src]++;
    });

    rows.push(['', '── BY SOURCE (QTY PER SKU) ──', '', '']);
    [MAIN_LABEL, SEC_LABEL].forEach(function(src) {
      var counts = bySource[src];
      // Known types first (only if present), then any unexpected types present.
      TYPE_ORDER.forEach(function(t) {
        if (counts[t]) rows.push(['', src + ' — ' + t, counts[t], '']);
      });
      Object.keys(counts).forEach(function(t) {
        if (TYPE_ORDER.indexOf(t) === -1) rows.push(['', src + ' — ' + t + ' ⚠', counts[t], '']);
      });
      rows.push(['', src + ' — TOTAL', srcTotal[src], '']);
    });
    rows.push(BLANK);
  }

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

  // ── Produced VINs ─────────────────────────────────────────────────────────
  // Every matched/produced vehicle's VIN (ORDERMATCH col E), one per row in col B.
  // Includes VIN-log duplicates, since those are still printed/produced.
  var producedVinList = omRows
    .map(function(v) { return v.vin; })
    .filter(function(v) { return v !== ''; });

  rows.push(['', '── PRODUCED VINS (' + producedVinList.length + ') ──', '', '']);
  if (producedVinList.length === 0) {
    rows.push(['', 'No vehicles produced.', '', '']);
  } else {
    producedVinList.forEach(function(vin) {
      rows.push(['', vin, '', '']);
    });
  }

  // ── Write to the target sheet ────────────────────────────────────────────
  sheet.clearContents();
  if (rows.length === 0) return;

  // Main summary block — always 4 cols wide (A–D)
  var paddedRows = rows.map(function(r) {
    var padded = r.slice();
    while (padded.length < 4) padded.push('');
    return padded;
  });
  sheet.getRange(1, 1, paddedRows.length, 4).setValues(paddedRows);

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
  sheet.getRange(1, 6, detailRows.length, 7).setValues(detailRows);

  Logger.log('renderBillingSheet_ [' + sheet.getName() + ']: ' + totalOrdered +
             ' ordered, ' + totalMatched + ' matched, ' + totalDupes + ' dupes.');
}

/**
 * Reads summary totals back from a billing sheet for the run log.
 * @param {Spreadsheet} outputDoc
 * @param {string}      sheetName - optional; defaults to 'BILLING'. Pass
 *                                  'BILLING_<group>' to read a split sheet.
 */
function readBillingTotals_(outputDoc, sheetName) {
  var sheet = outputDoc.getSheetByName(sheetName || 'BILLING');
  var types = getCanonicalVehicleTypes_();
  var defaults = { totalOrdered: 0, totalMatched: 0, totalDupes: 0,
                   totalNew: 0, totalPO: 0, totalCPO: 0, totalCPOEL: 0,
                   newDupes: 0, poDupes: 0, cpoDupes: 0, cpoElDupes: 0 };
  function emptyByType() {
    var bt = {};
    types.forEach(function(t) { bt[t] = { gross: 0, dupes: 0 }; });
    return bt;
  }
  function withDefaults(extra) {
    var r = {};
    Object.keys(defaults).forEach(function(k) { r[k] = defaults[k]; });
    r.byType = extra || emptyByType();
    return r;
  }
  if (!sheet) return withDefaults();
  try {
    var data = sheet.getDataRange().getValues();
    var summaryMap = {
      'Total Ordered':            'totalOrdered',
      'Total Matched in Scraper': 'totalMatched',
      'Total Duplicates':         'totalDupes'
    };
    // Per-type gross + dupes labels, built from the registry (a registered type renders a
    // clean "<type>" / "<type> Dupes" row; an unregistered one carries the "⚠" suffix and
    // is intentionally not read back here).
    var grossLabel = {}, dupesLabel = {};
    types.forEach(function(t) { grossLabel[t] = true; dupesLabel[t + ' Dupes'] = t; });

    var result = {}, byType = emptyByType();
    data.forEach(function(row) {
      var label = String(row[1] || '').trim();
      var val   = Number(row[2]) || 0;
      if (summaryMap[label] !== undefined)      result[summaryMap[label]] = val;
      else if (grossLabel[label])               byType[label].gross = val;
      else if (dupesLabel[label] !== undefined) byType[dupesLabel[label]].dupes = val;
    });

    // Derive the legacy canonical-type fields from byType so RUN_LOG (G–N) + ORDER_STATS
    // stay byte-identical; `byType` is the dynamic interface used by buildLineItems_.
    CANONICAL_TYPES.forEach(function(t) {
      var f = CANONICAL_BILLING_FIELDS[t];
      result[f.gross] = byType[t] ? byType[t].gross : 0;
      result[f.dupes] = byType[t] ? byType[t].dupes : 0;
    });
    Object.keys(defaults).forEach(function(k) { if (result[k] === undefined) result[k] = defaults[k]; });
    result.byType = byType;
    return result;
  } catch(e) {
    Logger.log('readBillingTotals_ error: ' + e.message);
    return withDefaults();
  }
}

/**
 * Reads the "BY SOURCE (QTY PER SKU)" section of a billing sheet (written only for
 * source_split dealers) into { '<sourceLabel>': { type: grossQty } }. Source labels
 * are 'Main Site' and the source_split groupName (e.g. AUTOLOANPRO). Quantities are
 * GROSS (VIN-log dupes included), matching the Pipedrive line-item quantity model.
 * Empty {} when the sheet or section is absent. Parsing is tolerant of dash variants.
 */
function readBillingBySource_(outputDoc, sheetName) {
  var sheet = outputDoc.getSheetByName(sheetName || 'BILLING');
  var out = {};
  if (!sheet) return out;
  try {
    var data = sheet.getDataRange().getValues();
    var inSection = false;
    for (var i = 0; i < data.length; i++) {
      var label = String(data[i][1] || '').trim();
      if (label.indexOf('BY SOURCE (QTY PER SKU)') !== -1) { inSection = true; continue; }
      if (!inSection) continue;
      if (label.indexOf('─') !== -1) break;                    // next "──" section header ends it
      var m = label.match(/^(.+?)\s+[—–-]\s+(.+)$/);      // "Source — Type"
      if (!m) continue;
      var src  = m[1].trim();
      var type = m[2].replace(/\s*⚠$/, '').trim();            // strip unexpected-type "⚠"
      if (type === 'TOTAL') continue;
      if (!out[src]) out[src] = {};
      out[src][type] = Number(data[i][2]) || 0;
    }
    return out;
  } catch (e) {
    Logger.log('readBillingBySource_ error: ' + e.message);
    return out;
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

function cleanUpOutputDocsCore_(daysOld) {
  daysOld = daysOld || 30;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  var files = DriveApp.getFolderById(OUTPUT_FOLDER_ID).getFiles();
  var count = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getLastUpdated() < cutoff) { f.setTrashed(true); count++; }
  }
  return { count: count, daysOld: daysOld };
}

function cleanUpOutputDocs(daysOld) {
  var r = cleanUpOutputDocsCore_(daysOld);
  SpreadsheetApp.getUi().alert('Trashed ' + r.count + ' output docs older than ' + r.daysOld + ' days.');
}

function appCleanUpOutputDocs() {
  var r = cleanUpOutputDocsCore_(30);
  return { message: 'Trashed ' + r.count + ' output docs older than ' + r.daysOld + ' days.' };
}

/**
 * Deletes a fully-abandoned run's artifacts: trashes the output doc and the
 * dealer's QR PNGs (Drive trash — recoverable for 30 days, not a hard delete).
 *
 * Called by the finalization panel ONLY when abandonment leaves no live cards
 * for the run (nothing finalized, nothing pending). A partially-abandoned
 * split run never reaches here — the finalized sibling still references the
 * shared output doc and QR batch.
 *
 * @param {string} dealerKey
 * @param {string} outputDocId - from the pending run entry
 * @return {Object} {trashedDoc, trashedQrs}
 */
function abandonRun(dealerKey, outputDocId, qrFileIds) {
  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);

  // Trash the output doc. Already-trashed or missing is non-fatal — the goal
  // state (doc gone) is already met.
  var trashedDoc = false;
  if (outputDocId && String(outputDocId).trim() !== '') {
    try {
      DriveApp.getFileById(String(outputDocId).trim()).setTrashed(true);
      trashedDoc = true;
    } catch (e) {
      Logger.log('abandonRun: output doc trash skipped (' + e.message + ')');
    }
  }

  // Trash this run's QR PNGs. Preferred path: the exact file IDs captured at
  // generation time (qrFileIds on the pendingRuns entry) batch-trashed in one
  // parallel round — O(this run), regardless of folder size. Fallback for
  // entries created before IDs were tracked: the old name-pattern folder scan.
  var trashedQrs = 0;
  try {
    if (qrFileIds && qrFileIds.length > 0) {
      trashedQrs = trashFilesParallel_(qrFileIds);
    } else {
      var prefix  = String(config[CFG.QR_PREFIX] || '').trim();
      var pattern = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                               '_QR_Code_\\d+\\.png$', 'i');
      if (prefix && config[CFG.QR_FOLDER_ID]) {
        var ids = [];
        var qrFiles = DriveApp.getFolderById(config[CFG.QR_FOLDER_ID]).getFiles();
        while (qrFiles.hasNext()) {
          var qf = qrFiles.next();
          if (pattern.test(qf.getName())) ids.push(qf.getId());
        }
        trashedQrs = trashFilesParallel_(ids);
      }
    }
  } catch (e) {
    Logger.log('abandonRun: QR cleanup skipped (' + e.message + ')');
  }

  Logger.log('abandonRun [' + dealerKey + ']: doc trashed=' + trashedDoc +
             ', QR PNGs trashed=' + trashedQrs);
  return { trashedDoc: trashedDoc, trashedQrs: trashedQrs };
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

// The scraper-import timestamp lives in a dedicated META tab (A1=date, B1=time),
// relocated from SCRAPERDATA!W1:X1 so appended schema columns (col V+) can grow
// without colliding with it. HELPERS A1:B1 keeps a secondary copy.
var META_TAB = 'META';

function getOrCreateMetaSheet_(ss) {
  var m = ss.getSheetByName(META_TAB);
  if (!m) {
    m = ss.insertSheet(META_TAB);
    m.getRange('A1:B1').setNumberFormat('@');
  }
  return m;
}

// Reads {date, time}. META first; falls back to the legacy SCRAPERDATA!W1:X1
// ONLY if the META tab doesn't exist yet (pre-migration safety).
function getTimestampMeta_(ss) {
  var m = ss.getSheetByName(META_TAB);
  if (m) {
    var v = m.getRange('A1:B1').getDisplayValues()[0];
    return { date: String(v[0] || ''), time: String(v[1] || '') };
  }
  var s = ss.getSheetByName('SCRAPERDATA').getRange('W1:X1').getDisplayValues()[0];
  return { date: String(s[0] || ''), time: String(s[1] || '') };
}

function fillScraperDateTime() {
  var ss  = getMasterSS_();
  var now = new Date();
  var d   = Utilities.formatDate(now, 'America/Chicago', 'yyyy/MM/dd');
  var t   = Utilities.formatDate(now, 'America/Chicago', 'HH:mm:ss');
  var m   = getOrCreateMetaSheet_(ss);
  m.getRange('A1').setValue(d);
  m.getRange('B1').setValue(t);
  ss.getSheetByName('HELPERS').getRange('A1').setValue(d);   // secondary backup
  ss.getSheetByName('HELPERS').getRange('B1').setValue(t);
  // Return for App callers (menu invocations ignore this).
  return { message: 'Scraper timestamp set to ' + d + ' ' + t + '.' };
}

// App wrapper for View Run Log: activates the tab (behind the modal).
function appOpenRunLog() {
  openRunLog();
  return { message: 'RUN_LOG tab opened behind this window.' };
}

// The scraper timestamp moved out of SCRAPERDATA W1:X1 into the isolated META
// tab (so schema columns can grow), so the old "restore W1:X1 if cleared" guard
// is obsolete. Kept as a no-op hook in case future onEdit logic is needed.
function onEdit(e) {
  return;
}

// Menu action: jump to the RUN_LOG tab. Must use getActiveSpreadsheet() —
// activate() on a sheet from a separate openById() handle doesn't move the UI
// (same openById vs getActiveSpreadsheet inconsistency noted in LEARNINGS).
function openRunLog() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
  if (sheet) sheet.activate();
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

// Classic fallback: serves the converted App fragment standalone.
function openNormManager() {
  openViewStandalone_('ViewNorm', 'Normalization Maps');
}

function getNormMapsSheet_() {
  return getConfigSS_().getSheetByName(NORM_MAPS_TAB);
}

// Columns enumerated by the on-demand reference (label -> SCRAPERDATA 0-based index).
// Covers the normalized columns (Type/Status/Trim) plus the fields most useful for
// authoring targeting conditions (Make/Model/Body Style/Fuel Type).
var NORM_REFERENCE_FIELDS = [
  { label: 'Type',       idx: 2  },
  { label: 'Make',       idx: 4  },
  { label: 'Model',      idx: 5  },
  { label: 'Trim',       idx: 6  },
  { label: 'Status',     idx: 8  },
  { label: 'Body Style', idx: 10 },
  { label: 'Fuel Type',  idx: 11 }
];

/**
 * On-demand replacement for the old NORM_MAPS cols E+ live UNIQUE() reference
 * formulas (removed June 2026 — full-column volatile formulas recalculating over a
 * 10k+ row SCRAPERDATA made programmatic access to SF_DEALER_CONFIG time out, while
 * the browser UI stayed fine — see LEARNINGS).
 *
 * Scans SCRAPERDATA once and writes a STATIC, sorted distinct-values list per column
 * into NORM_MAPS starting at col E. Zero ongoing recalc cost. Run from the menu when
 * you want a fresh snapshot to spot new raw values to normalize or to build targeting
 * conditions. The script still only reads NORM_MAPS cols A–C for rules — E+ is inert.
 */
function refreshNormReferenceCore_() {
  var master  = getMasterSS_().getSheetByName('SCRAPERDATA');
  var lastRow = master.getLastRow();
  if (lastRow < 2) return { ok: false, message: 'SCRAPERDATA is empty — nothing to reference.' };

  // Read the contiguous span covering every referenced column in one call (C..L).
  var minIdx = 2, maxIdx = 11;                       // 0-based: Type(2) .. Fuel Type(11)
  var data   = master.getRange(2, minIdx + 1, lastRow - 1, maxIdx - minIdx + 1).getValues();

  // Sorted distinct (case-insensitive) values per field, skipping blanks and '*'.
  var columns = NORM_REFERENCE_FIELDS.map(function(f) {
    var seen = {}, vals = [];
    for (var i = 0; i < data.length; i++) {
      var v = String(data[i][f.idx - minIdx]).trim();
      if (v === '' || v === '*') continue;
      var k = v.toLowerCase();
      if (!seen[k]) { seen[k] = true; vals.push(v); }
    }
    vals.sort(function(a, b) {
      var la = a.toLowerCase(), lb = b.toLowerCase();
      return la < lb ? -1 : (la > lb ? 1 : 0);
    });
    return vals;
  });

  var sheet    = getNormMapsSheet_();
  var startCol = 5;                                   // col E
  var nFields  = NORM_REFERENCE_FIELDS.length;
  var maxLen   = columns.reduce(function(m, c) { return Math.max(m, c.length); }, 0);

  // Ensure the sheet is big enough for headers + values and the timestamp column.
  var neededRows = maxLen + 1;
  if (sheet.getMaxRows() < neededRows) sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  var neededCols = startCol + nFields + 1;            // fields + a gap + timestamp
  if (sheet.getMaxColumns() < neededCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());

  // Clear the whole reference area, then write headers (with distinct counts) + values.
  sheet.getRange(1, startCol, sheet.getMaxRows(), nFields + 2).clearContent();

  var block = [NORM_REFERENCE_FIELDS.map(function(f, c) { return f.label + ' (' + columns[c].length + ')'; })];
  for (var r = 0; r < maxLen; r++) {
    var row = [];
    for (var c = 0; c < nFields; c++) row.push(r < columns[c].length ? columns[c][r] : '');
    block.push(row);
  }
  sheet.getRange(1, startCol, block.length, nFields).setValues(block);

  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  sheet.getRange(1, startCol + nFields + 1).setValue('Refreshed: ' + ts + ' (on-demand)');

  var doneMsg = 'Reference refreshed in SF_DEALER_CONFIG → NORM_MAPS cols E+ (' + (lastRow - 1) + ' rows scanned).';
  SpreadsheetApp.getActiveSpreadsheet().toast(doneMsg, 'SilverFox V2', 6);
  return { ok: true, message: doneMsg };
}

// Menu wrapper: alert on the empty-data path (ui.alert is menu-context only).
function refreshNormReference() {
  var r = refreshNormReferenceCore_();
  if (!r.ok) SpreadsheetApp.getUi().alert(r.message);
}

// App wrapper: returns {message} for the in-app toast.
function appRefreshNormReference() {
  return refreshNormReferenceCore_();
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

// Field key -> SCRAPERDATA 0-based column index. Derived dynamically from the
// data SCHEMA (getDataSchema_) so EVERY column — including ones added via the
// Data Sources screen — is targetable by a condition, and the Rules Editor field
// dropdown reads the same source. Cached per execution (invalidated with
// _dataSchema_ in addSchemaColumn). The base-21 keys/indices are identical to
// the old hard-coded map (type=2 … msrp=12), so it's fully backward-compatible.
var _filterFieldIndex_ = null;
function getFilterFieldIndex_() {
  if (_filterFieldIndex_) return _filterFieldIndex_;
  var m = {};
  getDataSchema_().forEach(function(c) { m[c.key] = c.index; });
  _filterFieldIndex_ = m;
  return m;
}
// Fields compared numerically (gte/lte/gt/lt). All others are string ops.
var FILTER_NUMERIC_FIELDS = { price: true, msrp: true, year: true };
// Condition operators usable in a targeting_rules predicate. (drop_on_import is no
// longer an op — "drop on import" is now a rule ACTION; see TARGETING_ACTIONS.)
var FILTER_OPS = ['in', 'not_in', 'contains', 'not_contains', 'gte', 'lte', 'gt', 'lt'];
// Rule actions: what to DO when a targeting rule's condition group matches.
var TARGETING_ACTIONS = ['drop_on_import', 'exclude_cao', 'exclude_order'];

function getDealerFilterRules_(config) {
  var defaults = {
    allowedTypes:    null,
    excludeStatus:   [],
    requireStock:    false,
    requirePrice:    false,
    requireUrl:      false,
    minPrice:        null,
    maxPrice:        null,
    seasoning:       [],
    targetingRules:  [],
    caoExcludeTypes: []
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
    allowedTypes:    Array.isArray(parsed.allowed_types)   ? parsed.allowed_types  : null,
    excludeStatus:   Array.isArray(parsed.exclude_status)  ? parsed.exclude_status : [],
    requireStock:    parsed.require_stock === true,
    requirePrice:    parsed.require_price === true,
    requireUrl:      parsed.require_url === true,
    minPrice:        (typeof parsed.min_price === 'number') ? parsed.min_price     : null,
    maxPrice:        (typeof parsed.max_price === 'number') ? parsed.max_price     : null,
    seasoning:       Array.isArray(parsed.seasoning)        ? parsed.seasoning         : [],
    targetingRules:  Array.isArray(parsed.targeting_rules)  ? parsed.targeting_rules   : [],
    caoExcludeTypes: Array.isArray(parsed.cao_exclude_types) ? parsed.cao_exclude_types : []
  };
}

// Fields a billing_split may classify on. These are keys of the parsed ORDERMATCH
// vehicle objects built in writeBillingSheet_ — NOT SCRAPERDATA indices — so this
// is intentionally separate from FILTER_FIELD_INDEX.
var BILLING_SPLIT_FIELDS = { model: true, make: true, trim: true, type: true };
var BILLING_SPLIT_OPS    = { contains: true, 'in': true };

/**
 * Parses the optional billing_split key from a dealer's filtering_rules (col W).
 * Splits one run's billing into two sheets / two RUN_LOG rows (separate accounts
 * sharing one scraper feed — e.g. MBCC cars vs Sprinter vans).
 *
 * Expected shape:
 *   "billing_split": { "group_name": "SPRINTER", "deal_label": "Sprinter Deal ID",
 *                      "field": "model", "op": "contains", "values": ["Sprinter", "Metris"] }
 *
 * Fail-safe: absent or malformed → returns null and the run behaves exactly as
 * a normal single-billing run (same convention as getDealerFilterRules_).
 *
 * @param {Array} config - dealer config row
 * @return {Object|null} {groupName, dealLabel, field, op, values} or null
 */
function getBillingSplit_(config) {
  var raw = config[CFG.FILTER_RULES];
  if (!raw || String(raw).trim() === '' || String(raw).trim() === '{}') return null;

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;  // parse failure already logged by getDealerFilterRules_
  }

  var bs = parsed.billing_split;
  if (!bs || typeof bs !== 'object') return null;

  var groupName = String(bs.group_name || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  var field     = String(bs.field || '').trim().toLowerCase();
  var op        = String(bs.op || '').trim().toLowerCase();
  var values    = Array.isArray(bs.values)
    ? bs.values.map(function(v) { return String(v).trim(); }).filter(function(v) { return v !== ''; })
    : [];

  if (!groupName || !BILLING_SPLIT_FIELDS[field] || !BILLING_SPLIT_OPS[op] || values.length === 0) {
    Logger.log('getBillingSplit_: invalid billing_split for ' + config[CFG.KEY] + ' — ignoring (fail-safe).');
    return null;
  }

  return {
    groupName: groupName,
    dealLabel: String(bs.deal_label || '').trim() || (groupName + ' Deal ID'),
    field:     field,
    op:        op,
    values:    values
  };
}

/**
 * Tests one parsed ORDERMATCH vehicle object against a billing split.
 * Case-insensitive; 'contains'/'in' match ANY listed value (OR).
 */
function isInBillingGroup_(vehicle, split) {
  if (!split) return false;
  var cell = String(vehicle[split.field] || '').toLowerCase();
  for (var i = 0; i < split.values.length; i++) {
    var v = split.values[i].toLowerCase();
    if (split.op === 'contains' ? cell.indexOf(v) !== -1 : cell === v) return true;
  }
  return false;
}

/**
 * Parses the optional `source_split` key from a dealer's filtering_rules (col W).
 * For a single-feed dealer whose inventory spans two websites (e.g. Frank Leta's
 * main site + the AutoLoanPro subprime site), it splits the MATCHED vehicles into
 * a second CSV by URL domain, while keeping ONE billing sheet and ONE deal. The
 * "main first, then secondary" waterfall is resolved at import time (see
 * getSourceSplitLocations_ / dedupeScraperRows_), so the run is a normal single
 * QUERY and this only routes the CSV output.
 * Fail-safe: absent/malformed → null (run behaves as a normal single-CSV run).
 *
 * @param {Array} config - dealer config row
 * @return {Object|null} {groupName, urlContains} or null
 */
function getSourceSplit_(config) {
  var raw = config[CFG.FILTER_RULES];
  if (!raw || String(raw).trim() === '' || String(raw).trim() === '{}') return null;
  var parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }

  var ss = parsed.source_split;
  if (!ss || typeof ss !== 'object') return null;

  var groupName   = String(ss.group_name || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  var urlContains = String(ss.url_contains || '').trim().toLowerCase();
  if (!groupName || !urlContains) {
    Logger.log('getSourceSplit_: invalid source_split for ' + config[CFG.KEY] + ' — ignoring (fail-safe).');
    return null;
  }
  return { groupName: groupName, urlContains: urlContains };
}

/**
 * Returns a map { scraper_location_name(lower) → url_contains(lower) } for every
 * dealer that has a valid source_split. The import dedup uses it to apply the
 * main-over-secondary URL priority ONLY within a configured dual-site dealer's
 * Location — so no other dealer's import is ever touched. Fail-safe → {}.
 */
function getSourceSplitLocations_() {
  var out = {};
  try {
    var data = getConfigSS_().getSheetByName('DEALERS').getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var loc = String(data[i][CFG.SCRAPER_LOCATION] || '').trim().toLowerCase();
      if (!loc) continue;
      var split = getSourceSplit_(data[i]);
      if (split) out[loc] = split.urlContains;
    }
  } catch (e) { Logger.log('getSourceSplitLocations_: ' + e.message); }
  return out;
}

/**
 * Returns a map { scraper_location_name(lower) → [rule, …] } of targeting_rules
 * whose action is "drop_on_import", for every dealer. Used by the import to drop
 * matching rows (e.g. subprime cars from a dealer's direct feed) BEFORE dedup,
 * scoped to that dealer's Location only. Fail-safe → {}.
 */
function getImportDropLocations_() {
  var out = {};
  try {
    var data = getConfigSS_().getSheetByName('DEALERS').getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var loc = String(data[i][CFG.SCRAPER_LOCATION] || '').trim().toLowerCase();
      if (!loc) continue;
      var fr = getDealerFilterRules_(data[i]);
      var drops = (fr.targetingRules || []).filter(function(rule) {
        return rule && String(rule.action).toLowerCase() === 'drop_on_import' && rule.group;
      });
      if (drops.length) out[loc] = (out[loc] || []).concat(drops);
    }
  } catch (e) { Logger.log('getImportDropLocations_: ' + e.message); }
  return out;
}

/**
 * Drops incoming rows that match any dealer's drop_on_import targeting rule
 * (Location-scoped, evaluated by the same nested-group engine the run path uses).
 * Returns {rows, dropped}. Runs before dedup so dropped rows never flag a conflict.
 * Rows are full canonical width here, so a newly-added column (e.g. "Subprime") is
 * readable via the schema index.
 */
function dropRowsOnImport_(rows, dropLocs) {
  if (!dropLocs || !Object.keys(dropLocs).length) return { rows: rows, dropped: 0 };
  var dropped = 0;
  var kept = rows.filter(function(row) {
    var rules = dropLocs[String(row[19] || '').trim().toLowerCase()];   // Location = index 19
    if (!rules) return true;
    for (var i = 0; i < rules.length; i++) {
      if (ruleMatches_(row, rules[i])) { dropped++; return false; }
    }
    return true;
  });
  return { rows: kept, dropped: dropped };
}

function applyFilteringRules_(vehicles, filterRules, phase) {
  if (!phase) phase = 'run';  // 'cao' = CAO pre-fill, 'run' = order run
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

    if (filterRules.requireUrl) {
      var url = String(row[20] || '').trim();   // Vehicle URL = col U (index 20)
      if (url === '' || url === '*') {
        rejected.push({ row: row, reason: 'no_url', detail: vin });
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

    // Targeting rules — action-on-match. A rule's nested condition group is
    // evaluated against the row; if it matches, the row is excluded. exclude_order
    // rules apply in BOTH phases; exclude_cao rules apply only during CAO pre-fill.
    // drop_on_import rules are handled at import time (dropRowsOnImport_), never
    // here. The Bypass checkbox is the per-run override (skips this whole call).
    if (Array.isArray(filterRules.targetingRules) && filterRules.targetingRules.length > 0) {
      var excludedByRule = false;
      for (var ti = 0; ti < filterRules.targetingRules.length; ti++) {
        var rule   = filterRules.targetingRules[ti];
        if (!rule) continue;
        var action = String(rule.action || '').toLowerCase();
        var applies = (action === 'exclude_order') ||
                      (action === 'exclude_cao' && phase === 'cao');
        if (!applies) continue;
        if (ruleMatches_(row, rule)) {
          rejected.push({ row: row, reason: 'rule:' + action, detail: describeRule_(rule) });
          excludedByRule = true;
          break;
        }
      }
      if (excludedByRule) return;
    }

    // CAO-only: "manual-only" types are skipped during auto-fill but still print
    // when entered manually (never applied at run time).
    if (phase === 'cao' && Array.isArray(filterRules.caoExcludeTypes) &&
        filterRules.caoExcludeTypes.length > 0) {
      var caoExcluded = filterRules.caoExcludeTypes.some(function(t) {
        return String(t).toLowerCase() === typeLower;
      });
      if (caoExcluded) {
        rejected.push({ row: row, reason: 'cao_excluded', detail: type });
        return;
      }
    }

    passed.push(row);
  });

  return { passed: passed, rejected: rejected };
}

// ── Targeting rule engine ────────────────────────────────────────────────────
// A targeting rule is { action, group }. A group is { match: 'all'|'any',
// children: [ condition | group, … ] }. A condition is { field, op, values }.
// The engine evaluates whether a row MATCHES a rule's group; the caller then
// performs the rule's action (drop_on_import / exclude_cao / exclude_order).
//
// Polarity note: unlike the old `conditions` (inclusion — "keep if it matches"),
// a rule fires an EXCLUSION when it matches. So every predicate here fails SAFE:
// any misconfiguration (unknown field/op, empty values, unparseable number, empty
// group) returns FALSE (no match → no action), so a config typo can never silently
// mass-exclude a dealer's inventory. (Opposite of evaluateCondition_'s fail-open,
// which was correct for inclusion.)

// Evaluates one condition leaf against a single SCRAPERDATA row. Returns bool.
function conditionMatches_(row, cond) {
  if (!cond || !cond.field || !cond.op) return false;

  var field   = String(cond.field).toLowerCase();
  var fieldIx = getFilterFieldIndex_();
  if (!fieldIx.hasOwnProperty(field)) {
    Logger.log('conditionMatches_: unknown field "' + cond.field + '" — no match (fail-safe).');
    return false;
  }

  var values = Array.isArray(cond.values) ? cond.values : [];
  if (values.length === 0) return false;  // empty values = no match

  var op   = String(cond.op).toLowerCase();
  var cell = String(row[fieldIx[field]] || '').trim();

  // Numeric operators — price-safe coercion (prices are stored as text; strip $ and ,).
  if (op === 'gte' || op === 'lte' || op === 'gt' || op === 'lt') {
    var num = parseFloat(cell.replace(/[$,]/g, ''));
    if (isNaN(num)) return false;  // missing/garbage number — no match (fail-safe)
    var threshold = parseFloat(String(values[0]).replace(/[$,]/g, ''));
    if (isNaN(threshold)) return false;
    if (op === 'gte') return num >= threshold;
    if (op === 'lte') return num <= threshold;
    if (op === 'gt')  return num >  threshold;
    return num < threshold;  // lt
  }

  // String operators — case-insensitive.
  var cellLower = cell.toLowerCase();
  var lowerVals = values.map(function(v) { return String(v).toLowerCase(); });

  switch (op) {
    case 'in':           return lowerVals.indexOf(cellLower) !== -1;
    case 'not_in':       return lowerVals.indexOf(cellLower) === -1;
    case 'contains':     return lowerVals.some(function(v) { return v !== '' && cellLower.indexOf(v) !== -1; });
    case 'not_contains': return lowerVals.every(function(v) { return v === '' || cellLower.indexOf(v) === -1; });
    default:
      Logger.log('conditionMatches_: unknown op "' + cond.op + '" — no match (fail-safe).');
      return false;
  }
}

// Evaluates a condition group recursively. 'all' = every child matches (AND),
// 'any' = some child matches (OR). Empty/invalid group → false (fail-safe).
// A child with a `children` array is a nested group; otherwise it's a condition.
function groupMatches_(row, group) {
  if (!group || !Array.isArray(group.children) || group.children.length === 0) return false;
  var any = String(group.match || 'all').toLowerCase() === 'any';
  for (var i = 0; i < group.children.length; i++) {
    var child = group.children[i];
    var m = (child && Array.isArray(child.children))
      ? groupMatches_(row, child)
      : conditionMatches_(row, child);
    if (any && m)  return true;    // ANY: first match wins
    if (!any && !m) return false;  // ALL: first miss fails
  }
  return !any;  // ANY with none matched → false; ALL with none missed → true
}

// A rule matches when its root group matches.
function ruleMatches_(row, rule) {
  if (!rule || !rule.group) return false;
  return groupMatches_(row, rule.group);
}

// Short human-readable description of a rule for the rejection-reason detail.
function describeRule_(rule) {
  if (!rule || !rule.group) return '';
  return describeGroup_(rule.group);
}
function describeGroup_(group) {
  if (!group || !Array.isArray(group.children) || !group.children.length) return '()';
  var joiner = (String(group.match || 'all').toLowerCase() === 'any') ? ' OR ' : ' AND ';
  var parts = group.children.map(function(child) {
    if (child && Array.isArray(child.children)) return '(' + describeGroup_(child) + ')';
    if (!child || !child.field) return '?';
    return child.field + ' ' + child.op + ' ' + JSON.stringify(child.values || []);
  });
  return parts.join(joiner);
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
  var filterResult = applyFilteringRules_(allVehicles, filterRules, 'cao');
  var filtered     = filterResult.passed;

  // Seed the legacy reasons (stable UI order), then count any reason dynamically
  // so new targeting reasons (cond:*, cao_excluded) flow through to the summary.
  var breakdown = { no_stock: 0, no_price: 0, type: 0, status: 0, price_low: 0, price_high: 0, seasoning: 0 };
  filterResult.rejected.forEach(function(r) {
    if (!breakdown.hasOwnProperty(r.reason)) breakdown[r.reason] = 0;
    breakdown[r.reason]++;
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
  var logSS  = getVinLogsSS_();
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

// Classic fallback: serves the converted App fragment standalone.
function openVINLogUpdater() {
  openViewStandalone_('ViewVinLog', 'Update VIN Log');
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
      note:         String(row[20]).trim(),  // U: notes (e.g. SPLIT:PRIMARY / SPLIT:SPRINTER)
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

  var logSS    = getVinLogsSS_();
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
  var logSS    = getVinLogsSS_();
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
  if (dealId.toLowerCase() === 'test') throw new Error('Test runs are not committed to the VIN log (debugging only).');

  var producedVins = producedVinsCSV
    ? producedVinsCSV.split(',').map(function(v) { return v.trim(); }).filter(Boolean)
    : [];

  if (producedVins.length === 0) throw new Error('No produced VINs found for this run.');
  if (!dealId)                   throw new Error('No Deal ID on this run log entry.');

  return commitRunToVINLog(dealerKey, runRowIndex, dealId, producedVins);
}

/**
 * Commits multiple RUN_LOG rows in one call — used by the post-run "Add to VIN
 * Log" button for billing-split runs, which write two rows (one per account).
 * Already-committed rows are skipped instead of throwing, so a retry after a
 * partial failure finishes the remaining row cleanly.
 *
 * @param {string} dealerKey
 * @param {Array}  rowIndexes - 1-based RUN_LOG row indexes
 * @return {Object} {committed: total VINs written, skippedCommitted: rows skipped}
 */
function commitRunRows(dealerKey, rowIndexes) {
  if (!Array.isArray(rowIndexes) || rowIndexes.length === 0) {
    throw new Error('No run log rows to commit.');
  }

  var sheet            = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
  var committed        = 0;
  var skippedCommitted = 0;
  var skippedTest      = 0;

  rowIndexes.forEach(function(rowIndex) {
    var rowVals = sheet.getRange(rowIndex, 1, 1, 23).getValues()[0];
    var status  = String(rowVals[22]).trim();    // W: vin_log_status
    var dealId  = String(rowVals[3]).trim();      // D: order_id / deal id
    if (status === 'committed') { skippedCommitted++; return; }
    if (dealId.toLowerCase() === 'test') { skippedTest++; return; }   // tests never enter the dedup log
    var result = commitLatestRun(dealerKey, rowIndex);
    committed += result.committed;
  });

  return { committed: committed, skippedCommitted: skippedCommitted, skippedTest: skippedTest };
}

function getCommittedAt(dealerKey, dealId) {
  var logSS    = getVinLogsSS_();
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
  var ss      = getVinLogsSS_();
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
  var logSS = getVinLogsSS_();
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

  var logSS  = getVinLogsSS_();
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

// Classic fallback: serves the converted App fragment standalone.
function openRulesEditor() {
  openViewStandalone_('ViewRules', 'Edit Dealer Rules');
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

  // Targeting-condition metadata. Field list is the full data SCHEMA (key+label)
  // so conditions can target EVERY column, including ones added via Data Sources.
  return {
    dealers: dealers,
    schemas: schemas,
    vehicleTypes:        getCanonicalVehicleTypes_(),   // built-ins + user-added — drives the type pills + seasoning
    filterFields:        getDataSchema_().map(function(c) { return { key: c.key, label: c.label }; }),
    filterOps:           FILTER_OPS,
    filterActions:       TARGETING_ACTIONS,
    filterNumericFields: Object.keys(FILTER_NUMERIC_FIELDS)
  };
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
// SECTION 30B: DATA SOURCES — configurable header mapping + canonical schema
// ============================================================================
//
// Lets scraper feeds with different header NAMES / column ORDER map onto the
// canonical SCRAPERDATA columns, configured per dealer in the Data Sources
// screen. The canonical column list lives in an OPTIONAL `SCHEMA` tab in
// SF_DEALER_CONFIG; when it's absent the code falls back to the hard-coded 21
// (today's exact behavior), so this is fully backward-compatible. Saved
// per-dealer mappings live in an OPTIONAL `SOURCE_MAPPINGS` tab, auto-created
// on first save. No sheet change is required to deploy this code safely.

var SCHEMA_TAB          = 'SCHEMA';
var SOURCE_MAPPINGS_TAB = 'SOURCE_MAPPINGS';

// The canonical 21 columns in SCRAPERDATA A–U order. `label` is matched against
// incoming file headers and intentionally mirrors the live scraper feeds —
// including the long-standing 'Vechile URL' spelling — so fallback behavior is
// byte-identical to the old hard-coded EXPECTED_HEADERS.
function dataSchemaFallback_() {
  var defs = [
    ['vin','VIN',false], ['stock','Stock',false], ['type','Type',true],
    ['year','Year',false], ['make','Make',false], ['model','Model',false],
    ['trim','Trim',true], ['ext_color','Ext Color',false], ['status','Status',true],
    ['price','Price',true], ['body_style','Body Style',false], ['fuel_type','Fuel Type',false],
    ['msrp','MSRP',false], ['date_in_stock','Date In Stock',false], ['street_address','Street Address',false],
    ['locality','Locality',false], ['postal_code','Postal Code',false], ['region','Region',false],
    ['country','Country',false], ['location','Location',false], ['vehicle_url','Vechile URL',false]
  ];
  return defs.map(function(d, i) { return { index: i, key: d[0], label: d[1], normalized: d[2] }; });
}

// Internal: the canonical schema — from the SCHEMA tab if present, else fallback.
// Cached for the lifetime of one execution (read by getSchemaColCount_ on the
// per-row dedup hot path). addSchemaColumn invalidates it after appending.
var _dataSchema_ = null;
function getDataSchema_() {
  if (_dataSchema_) return _dataSchema_;
  var result;
  try {
    var sh = getConfigSS_().getSheetByName(SCHEMA_TAB);
    if (!sh || sh.getLastRow() < 2) { _dataSchema_ = dataSchemaFallback_(); return _dataSchema_; }
    var data = sh.getDataRange().getValues();  // header + rows: col_index | field_key | header_label | normalized
    var cols = [];
    for (var i = 1; i < data.length; i++) {
      var key   = String(data[i][1] || '').trim();
      var label = String(data[i][2] || '').trim();
      if (!key || !label) continue;
      cols.push({ index: cols.length, key: key, label: label, normalized: isTrue_(data[i][3]) });
    }
    result = cols.length ? cols : dataSchemaFallback_();
  } catch (e) {
    Logger.log('getDataSchema_: falling back (' + e.message + ')');
    result = dataSchemaFallback_();
  }
  _dataSchema_ = result;
  return result;
}

// Internal: canonical column count — the single source of truth for SCRAPERDATA
// width. Equals 21 until a column is appended via addSchemaColumn. Cached.
function getSchemaColCount_() { return getDataSchema_().length; }

// Internal: ensure the SCHEMA tab exists and lists the current canonical columns,
// seeding it with today's set (the 21 fallback) the first time. Returns the sheet.
function getOrSeedSchemaSheet_() {
  var ss = getConfigSS_();
  var sh = ss.getSheetByName(SCHEMA_TAB);
  if (sh && sh.getLastRow() >= 2) return sh;
  if (!sh) sh = ss.insertSheet(SCHEMA_TAB);
  var cols = getDataSchema_();   // fallback 21 if the tab was empty/absent
  var rows = [['col_index', 'field_key', 'header_label', 'normalized']];
  cols.forEach(function(c, i) { rows.push([i, c.key, c.label, c.normalized ? 'TRUE' : 'FALSE']); });
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  _dataSchema_ = null; _filterFieldIndex_ = null;
  return sh;
}

// Public: append a brand-new canonical column (END only) and widen SCRAPERDATA.
// The column is STORE-ONLY — captured/compared/written by the import, but NOT
// surfaced in the ORDERMATCH QUERY / CSV / filters / stats until separately
// wired (the SELECT A:U QUERY, FIELD_TO_COL, FILTER_FIELD_INDEX are unchanged).
// Append-only keeps every fixed index (≤ col U) valid.
function addSchemaColumn(label) {
  label = String(label || '').trim();
  if (!label) throw new Error('Column name is required.');

  var sh       = getOrSeedSchemaSheet_();
  var existing = getDataSchema_();
  var lbl = label.toLowerCase();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].label.toLowerCase() === lbl) {
      throw new Error('A column named "' + label + '" already exists.');
    }
  }

  // Unique snake_case key from the label.
  var base = lbl.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col';
  var keys = {}; existing.forEach(function(c) { keys[c.key] = 1; });
  var key = base, n = 2;
  while (keys[key]) { key = base + '_' + n; n++; }

  var newIndex = existing.length;             // 0-based; also = old count
  sh.appendRow([newIndex, key, label, 'FALSE']);

  // Widen the master SCRAPERDATA grid and label the new column's header (row 1).
  var data = getMasterSS_().getSheetByName('SCRAPERDATA');
  var need = newIndex + 1;                     // 1-based column number for the new col
  if (data.getMaxColumns() < need) {
    data.insertColumnsAfter(data.getMaxColumns(), need - data.getMaxColumns());
  }
  data.getRange(1, need).setValue(label);

  _dataSchema_ = null; _filterFieldIndex_ = null;   // invalidate caches → next read sees the new column
  Logger.log('addSchemaColumn: "' + label + '" (key=' + key + ') at index ' + newIndex + '.');
  return { schema: getDataSchema_(), key: key, label: label };
}

// Public (client-callable): ordered canonical header labels — replaces the
// hard-coded EXPECTED_HEADERS in the import views.
function getCanonicalHeaders() {
  return getDataSchema_().map(function(c) { return c.label; });
}

// Public: single round-trip bootstrap for the Data Sources screen.
function getDataSourcesBootstrap() {
  return { schema: getDataSchema_(), dealers: getActiveDealersForUI() };
}

// SOURCE_MAPPINGS columns (0-indexed): dealer_key | source_name | source_header
// | canonical_field_key. A "source" is a named import FORMAT a dealer receives
// (e.g. "Dealer internal CSV") — a dealer can have several, each with its own
// header mapping, and they never clobber each other.
function getOrCreateSourceMappingsSheet_() {
  var ss = getConfigSS_();
  var sh = ss.getSheetByName(SOURCE_MAPPINGS_TAB);
  if (!sh) {
    sh = ss.insertSheet(SOURCE_MAPPINGS_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['dealer_key', 'source_name', 'source_header', 'canonical_field_key']]);
  }
  return sh;
}

// Public: one (dealer, source)'s saved mapping. Returns both the lowercased
// lookup (for pre-filling a file's headers) and the ordered original-case
// headers (so the screen can render the saved mapping with NO file uploaded).
function getSourceMapping(dealerKey, sourceName) {
  var byLower = {}, headers = [];
  sourceName = String(sourceName || '').trim();
  try {
    var sh = getConfigSS_().getSheetByName(SOURCE_MAPPINGS_TAB);
    if (!sh || sh.getLastRow() < 2) return { map: byLower, headers: headers };
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== String(dealerKey).trim()) continue;
      if (sourceName && String(data[i][1]).trim() !== sourceName) continue;
      var src = String(data[i][2] || '').trim();
      var key = String(data[i][3] || '').trim();
      if (src && key) { byLower[src.toLowerCase()] = key; headers.push({ header: src, key: key }); }
    }
  } catch (e) { Logger.log('getSourceMapping: ' + e.message); }
  return { map: byLower, headers: headers };
}

// Public: the named sources configured for a dealer → [{name, headerCount}].
function getSourcesForDealer(dealerKey) {
  var counts = {}, order = [];
  try {
    var sh = getConfigSS_().getSheetByName(SOURCE_MAPPINGS_TAB);
    if (!sh || sh.getLastRow() < 2) return [];
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== String(dealerKey).trim()) continue;
      var name = String(data[i][1] || '').trim();
      if (!name) continue;
      if (!counts.hasOwnProperty(name)) { counts[name] = 0; order.push(name); }
      counts[name]++;
    }
  } catch (e) { Logger.log('getSourcesForDealer: ' + e.message); }
  return order.map(function(n) { return { name: n, headerCount: counts[n] }; });
}

// Public: global header-alias lookup for the bulk importer →
// { sourceHeaderLower: canonicalHeaderLabel }. Union of EVERY saved mapping
// across all dealers and sources, so the normal Import screen resolves a renamed
// header to its canonical column without knowing the source. The scraper's
// headers are already canonical, so they're unaffected. Empty until mappings exist.
function getHeaderAliasMap() {
  var keyToLabel = {};
  getDataSchema_().forEach(function(c) { keyToLabel[c.key] = c.label; });
  var out = {};
  try {
    var sh = getConfigSS_().getSheetByName(SOURCE_MAPPINGS_TAB);
    if (!sh || sh.getLastRow() < 2) return out;
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var src = String(data[i][2] || '').trim();
      var key = String(data[i][3] || '').trim();
      if (src && keyToLabel[key]) out[src.toLowerCase()] = keyToLabel[key];
    }
  } catch (e) { Logger.log('getHeaderAliasMap: ' + e.message); }
  return out;
}

// Public: replace ONE (dealer, source) block — preserving every other dealer
// AND every other source of the same dealer. `mappingJson` = { sourceHeader: canonicalFieldKey }.
function saveSourceMapping(dealerKey, sourceName, mappingJson) {
  if (!dealerKey) throw new Error('No dealer selected.');
  sourceName = String(sourceName || '').trim();
  if (!sourceName) throw new Error('No source name.');
  var mapping;
  try { mapping = JSON.parse(mappingJson); }
  catch (e) { throw new Error('Invalid mapping JSON: ' + e.message); }

  var sh   = getOrCreateSourceMappingsSheet_();
  var data = sh.getDataRange().getValues();
  var kept = [];
  for (var i = 1; i < data.length; i++) {
    var dk = String(data[i][0]).trim(), sn = String(data[i][1]).trim();
    if (dk === '') continue;
    if (!(dk === String(dealerKey).trim() && sn === sourceName)) {   // keep all OTHER blocks
      kept.push([data[i][0], data[i][1], data[i][2], data[i][3]]);
    }
  }
  Object.keys(mapping).forEach(function(src) {
    var key = String(mapping[src] || '').trim();
    if (String(src).trim() && key) kept.push([dealerKey, sourceName, src, key]);
  });

  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, 4).setValues(kept);
  Logger.log('saveSourceMapping: ' + dealerKey + ' / ' + sourceName + ' → ' + Object.keys(mapping).length + ' header(s).');
  return { saved: Object.keys(mapping).length };
}

// Public: delete one (dealer, source) block entirely.
function deleteSource(dealerKey, sourceName) {
  sourceName = String(sourceName || '').trim();
  var sh = getConfigSS_().getSheetByName(SOURCE_MAPPINGS_TAB);
  if (!sh || sh.getLastRow() < 2) return { deleted: 0 };
  var data = sh.getDataRange().getValues();
  var kept = [], deleted = 0;
  for (var i = 1; i < data.length; i++) {
    var dk = String(data[i][0]).trim(), sn = String(data[i][1]).trim();
    if (dk === '') continue;
    if (dk === String(dealerKey).trim() && sn === sourceName) { deleted++; continue; }
    kept.push([data[i][0], data[i][1], data[i][2], data[i][3]]);
  }
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, 4).setValues(kept);
  Logger.log('deleteSource: ' + dealerKey + ' / ' + sourceName + ' → removed ' + deleted + ' row(s).');
  return { deleted: deleted };
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

/**
 * Returns the saved app theme for this Google account: 'light' | 'dark' | ''
 * ('' = no explicit choice yet → the client's head script follows the OS).
 * @returns {string}
 */
function getThemePreference() {
  var t = PropertiesService.getUserProperties().getProperty('app_theme');
  return (t === 'light' || t === 'dark') ? t : '';
}

/**
 * Persists the app theme choice. Ignores anything but 'light'/'dark' (fail-safe).
 * @param {string} theme
 */
function saveThemePreference(theme) {
  if (theme === 'light' || theme === 'dark') {
    PropertiesService.getUserProperties().setProperty('app_theme', theme);
  }
}

// ============================================================================
// SECTION 29: IMPORT HEALTH MONITORING
// ============================================================================
//
// writeImportStats_ — appends one row per scraper location to IMPORT_STATS
//   after every importScraperData() call.
//
// checkImportHealth_ — reads IMPORT_STATS history, computes per-location
//   rolling averages, and returns an array of issue objects for display in
//   the ScraperImport review panel and DASHBOARD sheet.
//
// Thresholds:
//   HARD errors (flagged regardless of history):
//     - total === 0 for a location that had data in a prior import
//     - no_stock > 20% of total
//     - no_price > 20% of total
//
//   Baseline warnings (require MIN_IMPORTS_FOR_BASELINE prior rows):
//     - total dropped more than DROP_THRESHOLD below rolling average
//     - new  dropped more than DROP_THRESHOLD below rolling average
//     - po   dropped more than DROP_THRESHOLD below rolling average
//     - unexpected type appeared (type that was 0 in all prior imports but >0 now)
//
// A location with fewer than MIN_IMPORTS_FOR_BASELINE prior rows returns
// severity 'info' / "Building baseline" — not a warning.
// ============================================================================

var MIN_IMPORTS_FOR_BASELINE = 5;
var DROP_THRESHOLD           = 0.40;  // 40% drop triggers a warning
var MISSING_FIELD_THRESHOLD  = 0.20;  // 20% missing triggers a hard error

/**
 * Appends one row per scraper location to the IMPORT_STATS sheet.
 * Called from importScraperData() after normalization and review computation.
 *
 * @param {Spreadsheet} ss              - SF_SYSTEM_MASTER spreadsheet object
 * @param {string}      timestamp       - formatted timestamp string
 * @param {Object}      locationDetail  - per-location detail map from computeImportReview_
 */
function writeImportStats_(ss, timestamp, locationDetail) {
  try {
    var sheet = ss.getSheetByName('IMPORT_STATS');
    if (!sheet) {
      Logger.log('writeImportStats_: IMPORT_STATS sheet not found, skipping.');
      return;
    }
    var locations = Object.keys(locationDetail);
    if (locations.length === 0) return;

    var rows = locations.map(function(loc) {
      var d = locationDetail[loc];
      return [
        timestamp,     // A: timestamp
        loc,           // B: scraper_location
        d.total,       // C: total
        d.new,         // D: new
        d.po,          // E: po
        d.cpo,         // F: cpo
        d.cpo_el,      // G: cpo_el
        d.other_types, // H: other_types
        d.onlot,       // I: onlot
        d.offlot,      // J: offlot
        d.other_status,// K: other_status
        d.no_price,    // L: no_price
        d.no_stock     // M: no_stock
      ];
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 13).setValues(rows);
    Logger.log('writeImportStats_: wrote ' + rows.length + ' location rows.');
  } catch (e) {
    Logger.log('writeImportStats_: failed (non-fatal): ' + e.message);
  }
}

/**
 * Reads IMPORT_STATS history and checks current import data for anomalies.
 * Returns an array of issue objects, empty if everything looks healthy.
 *
 * @param {Spreadsheet} ss              - SF_SYSTEM_MASTER spreadsheet object
 * @param {string}      currentTs       - timestamp of the current import (to exclude it from history)
 * @param {Object}      locationDetail  - per-location detail map from computeImportReview_
 * @returns {Array<{location, severity, message}>}
 *   severity: 'error' | 'warning' | 'info'
 */
function checkImportHealth_(ss, currentTs, locationDetail) {
  var issues = [];

  try {
    var sheet = ss.getSheetByName('IMPORT_STATS');
    if (!sheet) return issues;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return issues;  // No history yet at all

    // Tail read: rolling baselines only need recent history (MIN_IMPORTS_FOR_
    // BASELINE imports per location). 2,000 rows ≈ the last ~45 imports at 43
    // locations — far more than the baselines use, while keeping this read
    // constant-time as IMPORT_STATS (the fastest-growing log tab) accumulates.
    var HEALTH_TAIL_ROWS = 2000;
    var startRow = Math.max(2, lastRow - HEALTH_TAIL_ROWS + 1);
    var allData = sheet.getRange(startRow, 1, lastRow - startRow + 1, 13).getValues();

    // Build per-location history: { locationName: [ {total, new, po, cpo, cpo_el, no_price, no_stock}, ... ] }
    // Also track, per prior-import timestamp, which locations carried real
    // inventory (total > 0) — used below to detect a genuine same-name
    // disappearance without false-flagging a renamed/retired feed name.
    var history = {};
    var priorImportLocs = {};   // { timestamp: { locationName: true } }  (only total > 0)
    for (var i = 0; i < allData.length; i++) {
      var row = allData[i];
      var ts  = String(row[0]).trim();
      var loc = String(row[1]).trim();
      if (!loc || ts === currentTs) continue;  // skip blank rows and current import

      var totalForRow = Number(row[2]) || 0;

      if (!history[loc]) history[loc] = [];
      history[loc].push({
        total:      totalForRow,
        new:        Number(row[3])  || 0,
        po:         Number(row[4])  || 0,
        cpo:        Number(row[5])  || 0,
        cpo_el:     Number(row[6])  || 0,
        other_types:Number(row[7])  || 0,
        onlot:      Number(row[8])  || 0,
        offlot:     Number(row[9])  || 0,
        no_price:   Number(row[11]) || 0,
        no_stock:   Number(row[12]) || 0
      });

      if (totalForRow > 0 && ts) {
        if (!priorImportLocs[ts]) priorImportLocs[ts] = {};
        priorImportLocs[ts][loc] = true;
      }
    }

    // Evaluate each location in the current import
    var locations = Object.keys(locationDetail);
    locations.forEach(function(loc) {
      var cur  = locationDetail[loc];
      var hist = history[loc] || [];

      // ── HARD ERROR: total is zero ────────────────────────────────────────
      if (cur.total === 0) {
        if (hist.length > 0) {
          // Only flag if we've seen this location before with actual data
          var hadData = hist.some(function(h) { return h.total > 0; });
          if (hadData) {
            var lastAvg = avg_(hist, 'total');
            issues.push({
              location: loc,
              severity: 'error',
              message:  'Total inventory is ZERO (historical avg: ' + Math.round(lastAvg) + ')'
            });
          }
        }
        return;  // No further checks if zero
      }

      // ── HARD ERROR: missing stock > 20% ─────────────────────────────────
      var noStockPct = cur.no_stock / cur.total;
      if (noStockPct > MISSING_FIELD_THRESHOLD) {
        issues.push({
          location: loc,
          severity: 'error',
          message:  Math.round(noStockPct * 100) + '% of vehicles missing stock number (' + cur.no_stock + ' of ' + cur.total + ')'
        });
      }

      // ── HARD ERROR: missing price > 20% ─────────────────────────────────
      var noPricePct = cur.no_price / cur.total;
      if (noPricePct > MISSING_FIELD_THRESHOLD) {
        issues.push({
          location: loc,
          severity: 'error',
          message:  Math.round(noPricePct * 100) + '% of vehicles missing price (' + cur.no_price + ' of ' + cur.total + ')'
        });
      }

      // ── BASELINE CHECKS ─────────────────────────────────────────────────
      if (hist.length < MIN_IMPORTS_FOR_BASELINE) {
        // Not enough history yet — note this neutrally only if something looks off
        // (We intentionally don't flood the panel with info notices for every new location)
        return;
      }

      var avgTotal = avg_(hist, 'total');
      var avgNew   = avg_(hist, 'new');
      var avgPO    = avg_(hist, 'po');

      // Total drop warning
      if (avgTotal > 0) {
        var totalDrop = (avgTotal - cur.total) / avgTotal;
        if (totalDrop >= DROP_THRESHOLD) {
          issues.push({
            location: loc,
            severity: 'warning',
            message:  'Total inventory down ' + Math.round(totalDrop * 100) + '% vs avg (' +
                      'avg: ' + Math.round(avgTotal) + ', now: ' + cur.total + ')'
          });
        }
      }

      // New count drop warning (only if avg New was meaningful — >5)
      if (avgNew > 5) {
        var newDrop = (avgNew - cur.new) / avgNew;
        if (newDrop >= DROP_THRESHOLD) {
          issues.push({
            location: loc,
            severity: 'warning',
            message:  'New inventory down ' + Math.round(newDrop * 100) + '% vs avg (' +
                      'avg: ' + Math.round(avgNew) + ', now: ' + cur.new + ')'
          });
        }
      }

      // PO count drop warning (only if avg PO was meaningful — >5)
      if (avgPO > 5) {
        var poDrop = (avgPO - cur.po) / avgPO;
        if (poDrop >= DROP_THRESHOLD) {
          issues.push({
            location: loc,
            severity: 'warning',
            message:  'PO inventory down ' + Math.round(poDrop * 100) + '% vs avg (' +
                      'avg: ' + Math.round(avgPO) + ', now: ' + cur.po + ')'
          });
        }
      }

      // Unexpected type: a type that was consistently zero now has vehicles
      var avgOtherTypes = avg_(hist, 'other_types');
      if (avgOtherTypes === 0 && cur.other_types > 0) {
        issues.push({
          location: loc,
          severity: 'warning',
          message:  cur.other_types + ' vehicle' + (cur.other_types === 1 ? '' : 's') +
                    ' with unexpected/unnormalized type (historically zero)'
        });
      }
    });

    // Check for locations that were present in the MOST RECENT PRIOR import but
    // are now ABSENT from this one.
    //
    // We compare against only the immediately-preceding import — NOT the whole
    // history tail — so that a renamed/retired scraper location name ages out
    // after a single import. (The old exact-string compare against all of
    // `history` flagged a stale name "missing" forever, because current data
    // only ever carries the NEW name and the old name lingers in the 2,000-row
    // tail.) A genuine same-name disappearance (present last import, gone this
    // import) is still caught.
    var currentLocations = {};
    locations.forEach(function(l) { currentLocations[l] = true; });

    // Find the latest prior-import timestamp (< currentTs). Timestamps are
    // 'yyyy-MM-dd HH:mm:ss' display strings, which sort lexicographically.
    var priorTimestamps = Object.keys(priorImportLocs);
    var latestPriorTs = null;
    for (var p = 0; p < priorTimestamps.length; p++) {
      var t = priorTimestamps[p];
      if (t < currentTs && (latestPriorTs === null || t > latestPriorTs)) {
        latestPriorTs = t;
      }
    }

    if (latestPriorTs !== null) {
      var lastImportLocs = priorImportLocs[latestPriorTs];  // { loc: true }, total > 0 only
      Object.keys(lastImportLocs).forEach(function(loc) {
        if (currentLocations[loc]) return;  // still present in this import, skip
        // Present (with data) in the most-recent-prior import, absent now.
        var hist = history[loc] || [];
        issues.push({
          location: loc,
          severity: 'error',
          message:  'Location missing from this import entirely (historical avg: ' +
                    Math.round(avg_(hist, 'total')) + ' vehicles)'
        });
      });
    }

  } catch (e) {
    Logger.log('checkImportHealth_: failed (non-fatal): ' + e.message);
  }

  return issues;
}

/**
 * Computes the average of a numeric field across an array of history objects.
 * @param {Array}  arr   - array of history row objects
 * @param {string} field - key to average
 * @returns {number}
 */
function avg_(arr, field) {
  if (!arr || arr.length === 0) return 0;
  var sum = 0;
  arr.forEach(function(row) { sum += (row[field] || 0); });
  return sum / arr.length;
}


// ============================================================================
// SECTION 30: DASHBOARD REFRESH
// ============================================================================
//
// refreshDashboard_ — rewrites the per-location inventory table in the
//   DASHBOARD sheet (rows 6–47 + totals row 47) using the locationDetail
//   object from the current import. Called automatically at the end of
//   importScraperData() so the dashboard always reflects the latest import.
//
// Dashboard layout (fixed, must match sheet structure):
//   Row 1  — Title banner
//   Row 2  — Last import timestamp
//   Row 3  — Spacer
//   Row 4  — Section header: INVENTORY SNAPSHOT
//   Row 5  — Column headers (frozen)
//   Rows 6–(5+N) — One row per location, sorted alphabetically
//   Row (6+N) — TOTALS row
//   Row (7+N) — Spacer
//   Row (8+N) — RUN LOG SUMMARY section (formula-driven, not touched here)
// ============================================================================

var DASHBOARD_LOCATION_START_ROW = 6;   // first data row (1-indexed)
var DASHBOARD_MAX_LOCATIONS      = 60;  // maximum locations we'll ever write

/**
 * Rewrites the location table and timestamp in the DASHBOARD sheet.
 * Sorts locations alphabetically. Clears any stale rows beyond the
 * current location count. Non-fatal — a failure here never breaks an import.
 *
 * @param {Spreadsheet} ss              - SF_SYSTEM_MASTER spreadsheet object
 * @param {string}      importTimestamp - formatted timestamp string
 * @param {Object}      locationDetail  - per-location detail map from computeImportReview_
 */
function refreshDashboard_(ss, importTimestamp, locationDetail) {
  try {
    var dashboard = ss.getSheetByName('DASHBOARD');
    if (!dashboard) {
      Logger.log('refreshDashboard_: DASHBOARD sheet not found, skipping.');
      return;
    }

    // ── Color helpers ────────────────────────────────────────────────────────
    function bg(r, g, b) {
      return SpreadsheetApp.newColor().setRgbColor(
        '#' + ('0' + Math.round(r).toString(16)).slice(-2) +
              ('0' + Math.round(g).toString(16)).slice(-2) +
              ('0' + Math.round(b).toString(16)).slice(-2)
      ).build();
    }
    var C_DARK    = bg(38,  38,  38);
    var C_ORANGE  = bg(192, 101, 36);
    var C_ORANGE2 = bg(210, 120, 50);
    var C_DGRAY   = bg(80,  80,  80);
    var C_STRIPE  = bg(255, 248, 242);
    var C_WHITE   = bg(255, 255, 255);
    var C_LGRAY   = bg(245, 245, 245);

    // ── Row positions (1-indexed) ────────────────────────────────────────────
    var R_TITLE      = 1;
    var R_TIMESTAMP  = 2;
    var R_INV_HDR    = 4;
    var R_COL_HDR    = 5;
    var R_DATA_START = 6;

    var locations = Object.keys(locationDetail).sort(function(a, b) {
      return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
    });
    var n = locations.length;

    var R_TOTALS     = R_DATA_START + n;
    var R_RL_HDR     = R_TOTALS + 2;
    var R_RL_COLS    = R_RL_HDR  + 1;
    var R_RL_DATA    = R_RL_HDR  + 2;
    var R_MR_HDR     = R_RL_HDR  + 4;
    var R_MR_COLS    = R_MR_HDR  + 1;
    var R_MR_DATA    = R_MR_HDR  + 2;
    var R_RBD_HDR    = R_MR_HDR  + 4;
    var R_RBD_COLS   = R_RBD_HDR + 1;
    var R_RBD_DATA   = R_RBD_HDR + 2;

    // ── Clear everything from data start downward ────────────────────────────
    var clearRows = DASHBOARD_MAX_LOCATIONS + 30;
    dashboard.getRange(R_DATA_START, 1, clearRows, 10).clearContent();
    dashboard.getRange(R_DATA_START, 1, clearRows, 10).clearFormat();

    // ── Write timestamp ──────────────────────────────────────────────────────
    dashboard.getRange(R_TIMESTAMP, 2).setValue(importTimestamp);

    // ── Write column headers ─────────────────────────────────────────────────
    dashboard.getRange(R_COL_HDR, 1, 1, 10).setValues([[
      'Location', 'New', 'PO', 'CPO', 'CPO-EL', 'Other', 'Total', 'ONLOT', 'OFFLOT', 'No Price / No Stock'
    ]]);

    // ── Write location data rows ─────────────────────────────────────────────
    var dataRows = locations.map(function(loc) {
      var d = locationDetail[loc];
      return [loc, d.new, d.po, d.cpo, d.cpo_el, d.other_types, d.total, d.onlot, d.offlot, d.no_price + ' / ' + d.no_stock];
    });
    if (n > 0) dashboard.getRange(R_DATA_START, 1, n, 10).setValues(dataRows);

    // ── Compute and write totals ─────────────────────────────────────────────
    var tot = locations.reduce(function(acc, loc) {
      var d = locationDetail[loc];
      acc.new += d.new; acc.po += d.po; acc.cpo += d.cpo; acc.cpo_el += d.cpo_el;
      acc.other += d.other_types; acc.total += d.total; acc.onlot += d.onlot; acc.offlot += d.offlot;
      return acc;
    }, { new:0, po:0, cpo:0, cpo_el:0, other:0, total:0, onlot:0, offlot:0 });
    dashboard.getRange(R_TOTALS, 1, 1, 10).setValues([[
      'TOTALS', tot.new, tot.po, tot.cpo, tot.cpo_el, tot.other, tot.total, tot.onlot, tot.offlot, ''
    ]]);

    // ── Write Run Log section content ────────────────────────────────────────
    dashboard.getRange(R_RL_HDR,  1).setValue('RUN LOG SUMMARY');
    dashboard.getRange(R_RL_COLS, 1, 1, 6).setValues([[
      'Total Runs', 'Total VINs Produced', 'Avg VINs / Run', 'Committed Runs', 'Pending Commits', 'Rolled Back'
    ]]);
    dashboard.getRange(R_RL_DATA, 1, 1, 6).setFormulas([[
      '=COUNTA(RUN_LOG!B2:B)',
      '=SUMPRODUCT(IFERROR(VALUE(RUN_LOG!P2:P1000),0))',
      '=IFERROR(IF(A' + R_RL_DATA + '=0,"",ROUND(B' + R_RL_DATA + '/A' + R_RL_DATA + ',1)),"")',
      '=COUNTIF(RUN_LOG!W2:W,"committed")',
      '=COUNTIF(RUN_LOG!W2:W,"")',
      '=COUNTIF(RUN_LOG!W2:W,"rolled_back")'
    ]]);

    dashboard.getRange(R_MR_HDR,  1).setValue('MOST RECENT RUN');
    dashboard.getRange(R_MR_COLS, 1, 1, 7).setValues([[
      'Date', 'Dealer', 'Order ID', 'VINs Ordered', 'VINs Produced', 'Duration (sec)', 'VIN Log Status'
    ]]);
    dashboard.getRange(R_MR_DATA, 1, 1, 7).setFormulas([[
      '=IFERROR(TEXT(INDEX(RUN_LOG!A:A,COUNTA(RUN_LOG!A:A)),"M/D/YYYY"),"")',
      '=IFERROR(INDEX(RUN_LOG!C:C,COUNTA(RUN_LOG!A:A)),"")',
      '=IFERROR(INDEX(RUN_LOG!D:D,COUNTA(RUN_LOG!A:A)),"")',
      '=IFERROR(INDEX(RUN_LOG!E:E,COUNTA(RUN_LOG!A:A)),"")',
      '=IFERROR(INDEX(RUN_LOG!P:P,COUNTA(RUN_LOG!A:A)),"")',
      '=IFERROR(INDEX(RUN_LOG!S:S,COUNTA(RUN_LOG!A:A)),"")',
      '=IFERROR(IF(INDEX(RUN_LOG!W:W,COUNTA(RUN_LOG!A:A))="","Pending",INDEX(RUN_LOG!W:W,COUNTA(RUN_LOG!A:A))),"")'
    ]]);

    dashboard.getRange(R_RBD_HDR,  1).setValue('RUNS BY DEALER');
    dashboard.getRange(R_RBD_COLS, 1, 1, 9).setValues([[
      'Dealer', 'Runs', 'VINs Ordered', 'VINs Produced', 'New', 'PO', 'CPO', 'CPO-EL', 'Avg Match Rate'
    ]]);
    dashboard.getRange(R_RBD_DATA, 1).setFormula(
      '=IFERROR(QUERY(RUN_LOG!A:W,"SELECT C, COUNT(A), SUM(E), SUM(P), SUM(G), SUM(H), SUM(I), SUM(J) WHERE C <> \'\' GROUP BY C ORDER BY COUNT(A) DESC LABEL C \'\', COUNT(A) \'\', SUM(E) \'\', SUM(P) \'\', SUM(G) \'\', SUM(H) \'\', SUM(I) \'\', SUM(J) \'\'",1),"No data")'
    );

    // ── Apply formatting ─────────────────────────────────────────────────────
    // Helper: apply background + text style to a range
    function fmt(rng, bgColor, bold, fontSize, fontColor, align) {
      var f = rng.setBackground(null);
      if (bgColor)   f.setBackgroundObject(bgColor);
      if (bold !== null) f.setFontWeight(bold ? 'bold' : 'normal');
      if (fontSize)  f.setFontSize(fontSize);
      if (fontColor) f.setFontColor(fontColor);
      if (align)     f.setHorizontalAlignment(align);
    }

    // Title (rows 1-3 already formatted from sheet creation, just ensure timestamp)
    dashboard.getRange(R_TIMESTAMP, 2).setNumberFormat('@');  // plain text timestamp

    // Inventory section banner
    var invHdrRange = dashboard.getRange(R_INV_HDR, 1, 1, 10);
    invHdrRange.setBackgroundObject(C_ORANGE).setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);

    // Column headers
    var colHdrRange = dashboard.getRange(R_COL_HDR, 1, 1, 10);
    colHdrRange.setBackgroundObject(C_ORANGE2).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)
               .setHorizontalAlignment('center');
    dashboard.getRange(R_COL_HDR, 1).setHorizontalAlignment('left');

    // Data rows — alternating stripes, numbers centered, location left.
    // Block-formatted: the old per-row loop issued ~12 range ops per location
    // (~500 calls per refresh ≈ 1.5–2.5s); this does the same in 7 calls.
    if (n > 0) {
      var bgMatrix = [];
      for (var i = 0; i < n; i++) {
        var rowBg = (i % 2 === 0) ? C_WHITE : C_STRIPE;
        var bgRow = [];
        for (var bc = 0; bc < 10; bc++) bgRow.push(rowBg);
        bgMatrix.push(bgRow);
      }
      dashboard.getRange(R_DATA_START, 1, n, 10)
        .setBackgroundObjects(bgMatrix).setFontSize(10)
        .setHorizontalAlignment('center').setNumberFormat('#,##0');
      dashboard.getRange(R_DATA_START, 1, n, 1)
        .setHorizontalAlignment('left').setNumberFormat('@');
      dashboard.getRange(R_DATA_START, 10, n, 1)
        .setHorizontalAlignment('center').setNumberFormat('@');
    }

    // Totals row
    var totRange = dashboard.getRange(R_TOTALS, 1, 1, 10);
    totRange.setBackgroundObject(C_DARK).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)
            .setHorizontalAlignment('center').setNumberFormat('#,##0');
    dashboard.getRange(R_TOTALS, 1).setHorizontalAlignment('left');

    // Run Log section banners
    dashboard.getRange(R_RL_HDR, 1, 1, 10).setBackgroundObject(C_DGRAY).setFontColor('#ffffff')
             .setFontWeight('bold').setFontSize(11);
    dashboard.getRange(R_MR_HDR, 1, 1, 10).setBackgroundObject(C_DGRAY).setFontColor('#ffffff')
             .setFontWeight('bold').setFontSize(10);
    dashboard.getRange(R_RBD_HDR, 1, 1, 10).setBackgroundObject(C_DGRAY).setFontColor('#ffffff')
             .setFontWeight('bold').setFontSize(10);

    // Run Log column headers
    [R_RL_COLS, R_MR_COLS, R_RBD_COLS].forEach(function(r) {
      dashboard.getRange(r, 1, 1, 10).setBackgroundObject(C_ORANGE2).setFontColor('#ffffff')
               .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
      dashboard.getRange(r, 1).setHorizontalAlignment('left');
    });

    // Run Log KPI data row
    dashboard.getRange(R_RL_DATA, 1, 1, 10).setBackgroundObject(C_STRIPE).setFontWeight('bold')
             .setFontSize(11).setHorizontalAlignment('center').setNumberFormat('#,##0.#');

    // Most Recent Run data row
    dashboard.getRange(R_MR_DATA, 1, 1, 10).setBackgroundObject(C_STRIPE).setFontSize(10)
             .setHorizontalAlignment('center');
    dashboard.getRange(R_MR_DATA, 1).setHorizontalAlignment('left');

    // Column widths + frozen rows never change between refreshes — only set
    // them when the sheet hasn't been laid out yet (8 ops saved per import).
    if (dashboard.getFrozenRows() !== R_COL_HDR) {
      dashboard.setColumnWidth(1, 260);
      for (var c = 2; c <= 7; c++) dashboard.setColumnWidth(c, 72);
      dashboard.setColumnWidth(8, 80);
      dashboard.setColumnWidth(9, 80);
      dashboard.setColumnWidth(10, 130);
      dashboard.setFrozenRows(R_COL_HDR);
    }

    Logger.log('refreshDashboard_: complete. ' + n + ' locations, totals at row ' + R_TOTALS + ', run log at ' + R_RL_HDR + '.');
  } catch (e) {
    Logger.log('refreshDashboard_: failed (non-fatal): ' + e.message);
  }
}


// ============================================================================
// SECTION 31: PIPEDRIVE INTEGRATION — CLIENT, CONFIG, LINE ITEMS
// ============================================================================
//
// Pushes finalized runs into Pipedrive as deals with line-item products.
//   - Secrets (API token, company domain, defaults) live in ScriptProperties,
//     never in the repo or a sheet. pdGetSecrets_() reads them.
//   - Per-(dealer_key, group) config (org, product map, field map) lives in the
//     PIPEDRIVE tab of SF_DEALER_CONFIG.
//   - Every API call is isolated: pdFetch_ NEVER throws — it returns
//     {ok,status,data,error}. Callers surface failures as messages.
// See the Pipedrive plan + CLAUDE.md to-do #5. The actual deal push is P2.

var PD_PROP = {
  TOKEN:    'PD_API_TOKEN',
  DOMAIN:   'PD_COMPANY_DOMAIN',
  PIPELINE: 'PD_DEFAULT_PIPELINE_ID',
  STAGE:    'PD_DEFAULT_STAGE_ID',
  CURRENCY: 'PD_DEFAULT_CURRENCY'
};

var PIPEDRIVE_TAB = 'PIPEDRIVE';

// 0-based column indices for the PIPEDRIVE tab (A–K). Per (dealer_key, group):
// org + product map (now {type:{product_id,variation_id?}}) + deal defaults +
// FIELD_OVERRIDES (col J) — per-dealer overrides of the GLOBAL deal-field rules.
var PDCFG = {
  DEALER_KEY: 0, GROUP: 1, ORG_ID: 2, ORG_NAME: 3, PRODUCT_MAP: 4,
  TITLE_TEMPLATE: 5, PIPELINE_ID: 6, STAGE_ID: 7, CURRENCY: 8,
  FIELD_OVERRIDES: 9, ACTIVE: 10, SOURCE_PRODUCT_MAP: 11
};
var PIPEDRIVE_HEADERS = ['dealer_key', 'group', 'org_id', 'org_name', 'product_map',
  'deal_title_template', 'pipeline_id', 'stage_id', 'currency', 'field_overrides', 'active',
  'source_product_map'];

// Global Pipedrive settings (deal-field rules, product→org field) live in their
// own key/value tab.
var PIPEDRIVE_SETTINGS_TAB = 'PIPEDRIVE_SETTINGS';
var PD_RULES_KEY = 'deal_field_rules';
var PD_PRODUCT_ORG_FIELD_KEY = 'product_org_field';   // product custom-field KEY linking a product to its org
var PD_INSTALL_COST_KEY = 'install_cost_config';      // install line item + design no-charge variation config
var PD_VEHICLE_TYPES_KEY = 'vehicle_types';           // JSON array of user-added vehicle types (extends the built-ins)

// The four built-in vehicle types — always present, protected (non-removable), and the
// basis for the legacy per-type RUN_LOG / ORDER_STATS billing columns. User-added types
// extend this list via the registry (getCanonicalVehicleTypes_), so adding one propagates
// everywhere that enumerates types (pills, product picker, billing, line items, dashboard).
var CANONICAL_TYPES = ['New', 'PO', 'CPO', 'CPO-EL'];

// Canonical type → legacy billing-totals field names (gross + dupes). Kept so RUN_LOG
// cols G–N and ORDER_STATS stay byte-identical, while readBillingTotals_ also exposes a
// dynamic `byType` map covering EVERY registered type (incl. user-added ones).
var CANONICAL_BILLING_FIELDS = {
  'New':    { gross: 'totalNew',   dupes: 'newDupes'   },
  'PO':     { gross: 'totalPO',    dupes: 'poDupes'    },
  'CPO':    { gross: 'totalCPO',   dupes: 'cpoDupes'   },
  'CPO-EL': { gross: 'totalCPOEL', dupes: 'cpoElDupes' }
};

// ── Secrets / connection ──────────────────────────────────────────────────

/** Reads PD secrets from ScriptProperties; null if token or domain missing. */
function pdGetSecrets_() {
  var p = PropertiesService.getScriptProperties();
  var token  = (p.getProperty(PD_PROP.TOKEN)  || '').trim();
  var domain = (p.getProperty(PD_PROP.DOMAIN) || '').trim();
  if (!token || !domain) return null;
  domain = pdNormalizeDomain_(domain);
  return {
    token:    token,
    domain:   domain,
    baseV1:   'https://' + domain + '.pipedrive.com/api/v1',
    baseV2:   'https://' + domain + '.pipedrive.com/api/v2',
    pipeline: (p.getProperty(PD_PROP.PIPELINE) || '').trim(),
    stage:    (p.getProperty(PD_PROP.STAGE)    || '').trim(),
    currency: (p.getProperty(PD_PROP.CURRENCY) || 'USD').trim()
  };
}

/** Accepts a bare subdomain ("acme") or a full host/URL — returns the subdomain. */
function pdNormalizeDomain_(domain) {
  return String(domain || '').trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.pipedrive\.com.*$/i, '')
    .replace(/\/.*$/, '');
}

/**
 * Client-callable. Validates token+domain via a live GET /users/me, then saves
 * the secrets. Returns {ok, message, user?}. Nothing is persisted on failure.
 */
function setupPipedriveSecrets(token, domain, pipelineId, stageId, currency) {
  token  = String(token  || '').trim();
  domain = pdNormalizeDomain_(domain);
  if (!token)  return { ok: false, message: 'API token is required.' };
  if (!domain) return { ok: false, message: 'Company domain is required (e.g. "acme" from acme.pipedrive.com).' };

  var url = 'https://' + domain + '.pipedrive.com/api/v1/users/me?api_token=' + encodeURIComponent(token);
  var resp;
  try { resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true }); }
  catch (e) { return { ok: false, message: 'Could not reach Pipedrive: ' + e.message }; }

  var code = resp.getResponseCode();
  if (code === 401 || code === 403) return { ok: false, message: 'Pipedrive rejected the token (HTTP ' + code + ').' };
  if (code >= 300)                  return { ok: false, message: 'Validation failed (HTTP ' + code + ') — check the company domain.' };
  var body;
  try { body = JSON.parse(resp.getContentText()); } catch (e) { return { ok: false, message: 'Unexpected response from Pipedrive.' }; }
  if (!body || !body.success || !body.data) return { ok: false, message: 'Pipedrive did not confirm the credentials.' };

  var p = PropertiesService.getScriptProperties();
  p.setProperty(PD_PROP.TOKEN,    token);
  p.setProperty(PD_PROP.DOMAIN,   domain);
  p.setProperty(PD_PROP.PIPELINE, String(pipelineId || '').trim());
  p.setProperty(PD_PROP.STAGE,    String(stageId    || '').trim());
  p.setProperty(PD_PROP.CURRENCY, String(currency   || 'USD').trim());

  return { ok: true, message: 'Connected to Pipedrive as ' + (body.data.name || 'user') + '.', user: body.data.name || '' };
}

/** Client-callable. Connection state for the config UI. NEVER returns the token. */
function getPipedriveStatus() {
  var s = pdGetSecrets_();
  if (!s) return { configured: false };
  return {
    configured: true,
    domain:     s.domain,
    defaults:   { pipelineId: s.pipeline, stageId: s.stage, currency: s.currency }
  };
}

// ── Low-level fetch (never throws) ─────────────────────────────────────────

/**
 * Core Pipedrive request. Returns {ok,status,data,error,additional,raw}.
 * @param {string} method  'get'|'post'|'put'|'delete'
 * @param {string} path    e.g. '/deals' or '/organizations/5?custom_fields=ab'
 * @param {Object} payload optional JSON body
 * @param {Object} opts    optional { version:'v2' }
 */
function pdFetch_(method, path, payload, opts) {
  var s = pdGetSecrets_();
  if (!s) return { ok: false, status: 0, data: null, error: 'Pipedrive is not configured.' };
  opts = opts || {};
  var base = (opts.version === 'v2') ? s.baseV2 : s.baseV1;
  var sep  = (path.indexOf('?') === -1) ? '?' : '&';
  var url  = base + path + sep + 'api_token=' + encodeURIComponent(s.token);

  var options = { method: method || 'get', muteHttpExceptions: true };
  if (payload) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }

  for (var attempt = 0; attempt < 2; attempt++) {
    var resp;
    try { resp = UrlFetchApp.fetch(url, options); }
    catch (e) { return { ok: false, status: 0, data: null, error: 'Network error: ' + e.message }; }
    var code = resp.getResponseCode();

    if (code === 429 && attempt === 0) {
      var hdrs = resp.getAllHeaders();
      var ra = hdrs['Retry-After'] || hdrs['retry-after'] || hdrs['x-ratelimit-reset'];
      var waitMs = 1500;
      if (ra) { var n = parseInt(ra, 10); if (!isNaN(n)) waitMs = Math.min(2000, Math.max(500, n * 1000)); }
      Utilities.sleep(waitMs);
      continue;
    }

    var body = null;
    try { body = JSON.parse(resp.getContentText()); } catch (e) { body = null; }
    // v1 responses carry `success:true`; v2 OMITS `success` and signals errors via
    // HTTP status only. Treat as ok unless HTTP error, no body, or an EXPLICIT
    // `success:false` — so both v1 AND v2 calls (org custom-field reads, product
    // variations) parse correctly.
    if (code >= 300 || !body || body.success === false) {
      var msg = (body && (body.error || body.error_info)) ? (body.error || body.error_info) : ('HTTP ' + code);
      return { ok: false, status: code, data: (body && body.data) || null, error: msg, raw: body };
    }
    return { ok: true, status: code, data: body.data, additional: body.additional_data || null, raw: body };
  }
  return { ok: false, status: 429, data: null, error: 'Pipedrive rate limit — try again shortly.' };
}

/** GET a v1 collection, following pagination. Returns the concatenated array. */
function pdListAllV1_(path) {
  var out = [], start = 0, limit = 500, guard = 0;
  while (guard++ < 40) {
    var sep = (path.indexOf('?') === -1) ? '?' : '&';
    var r = pdFetch_('get', path + sep + 'start=' + start + '&limit=' + limit);
    if (!r.ok) break;
    if (r.data && r.data.length) out = out.concat(r.data);
    var pg = r.additional && r.additional.pagination;
    if (pg && pg.more_items_in_collection && pg.next_start != null) start = pg.next_start;
    else break;
  }
  return out;
}

/** GET a v2 collection, following cursor pagination. Returns the concatenated array. */
function pdListAllV2_(path) {
  var out = [], cursor = '', guard = 0;
  do {
    var sep = (path.indexOf('?') === -1) ? '?' : '&';
    var r = pdFetch_('get', path + sep + 'limit=500' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
                     null, { version: 'v2' });
    if (!r.ok) break;
    if (r.data && r.data.length) out = out.concat(r.data);
    cursor = (r.additional && r.additional.next_cursor) ? r.additional.next_cursor : '';
  } while (cursor && guard++ < 40);
  return out;
}

// ── Read endpoints (config UI) ─────────────────────────────────────────────

function pdListProducts_() {
  // Scope key = the product's Organization-type custom field ("Customer"), either
  // explicitly chosen or AUTO-DETECTED. When set, surface each product's linked
  // org id (customerOrgId) so the per-dealer picker can scope to that dealer's org.
  var orgFieldKey = getEffectiveProductOrgField_();
  if (!orgFieldKey) {
    return pdListAllV1_('/products').map(function(p) {
      return { id: p.id, name: p.name, code: p.code || '', prices: p.prices || [],
               inactive: (p.selectable === false || p.active_flag === false) };
    });
  }
  // Fetch via v2 with custom_fields — v2 reliably returns the custom-field value
  // (under custom_fields[<key>]); for an Organization field that value is the org id.
  return pdListAllV2_('/products?custom_fields=' + encodeURIComponent(orgFieldKey)).map(function(p) {
    var out = { id: p.id, name: p.name, code: p.code || '', prices: p.prices || [],
                inactive: (p.is_linkable === false) };  // v2: not linkable to deals = deactivated
    var cf = p.custom_fields || {};
    var cid = pdExtractOrgId_(cf[orgFieldKey]);
    if (cid) out.customerOrgId = cid;
    return out;
  });
}

/**
 * Normalizes an Organization-type product custom-field value to a string org id.
 * Handles a scalar id, or an object ({value} or {id}); '' when empty/absent.
 */
function pdExtractOrgId_(raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  var v = (typeof raw === 'object') ? (raw.value !== undefined ? raw.value : raw.id) : raw;
  return (v === undefined || v === null || v === '') ? '' : String(v);
}

/** Product custom-field definitions, for the "product → org" field picker. */
function pdListProductFields_() {
  return pdListAllV1_('/productFields').map(function(f) {
    return { key: f.key, name: f.name, field_type: f.field_type };
  });
}

/** Client-callable: product fields for the Pipedrive Settings picker. */
function getPipedriveProductFields() {
  return pdListProductFields_();
}

function pdListDealFields_() {
  return pdListAllV1_('/dealFields').map(function(f) {
    return { key: f.key, name: f.name, field_type: f.field_type, options: f.options || [] };
  });
}

function pdListOrganizationFields_() {
  return pdListAllV1_('/organizationFields').map(function(f) {
    return { key: f.key, name: f.name, field_type: f.field_type, options: f.options || [] };
  });
}

/** Client-callable org search for the config picker. Returns [{id,name}]. */
function searchPipedriveOrganizations(term) {
  term = String(term || '').trim();
  if (term.length < 2) return [];
  var r = pdFetch_('get', '/organizations/search?term=' + encodeURIComponent(term) + '&fields=name&limit=30');
  if (!r.ok || !r.data || !r.data.items) return [];
  return r.data.items.map(function(it) { return { id: it.item.id, name: it.item.name }; });
}

/** Reads one org with the requested custom-field values (v2). */
function pdGetOrgWithCustomFields_(orgId, fieldKeys) {
  if (!orgId) return null;
  var path = '/organizations/' + orgId;
  if (fieldKeys && fieldKeys.length) path += '?custom_fields=' + fieldKeys.join(',');
  var r = pdFetch_('get', path, null, { version: 'v2' });
  if (!r.ok || !r.data) return null;
  return { id: r.data.id, name: r.data.name, custom_fields: r.data.custom_fields || {} };
}

/**
 * Client-callable single round-trip for the config editor: the live PD catalog
 * (products + field defs) plus connection defaults. Cached ~10 min; pass
 * refresh=true to bypass.
 */
function getPipedriveConfigBootstrap(refresh) {
  var status = getPipedriveStatus();
  if (!status.configured) return { configured: false };

  var cache = CacheService.getScriptCache();
  var KEY = 'pd_catalog_v2';   // v2: products now carry customerOrgId — bumped so stale v1 caches are ignored
  if (!refresh) {
    var hit = cache.get(KEY);
    if (hit) {
      try {
        var c = JSON.parse(hit);
        c.configured = true; c.defaults = status.defaults;
        c.productOrgField = getEffectiveProductOrgField_();   // live (explicit or auto-detected)
        return c;
      } catch (e) {}
    }
  }
  var out = {
    configured: true,
    defaults:   status.defaults,
    products:   pdListProducts_(),     // each product carries customerOrgId when an org field is in effect
    dealFields: pdListDealFields_(),
    orgFields:  pdListOrganizationFields_(),
    productOrgField: getEffectiveProductOrgField_()
  };
  try {
    cache.put(KEY, JSON.stringify({ products: out.products, dealFields: out.dealFields, orgFields: out.orgFields }), 600);
  } catch (e) { /* over cache size limit — just refetch next time */ }
  return out;
}

// ── PIPEDRIVE config tab (per dealer_key + group) ──────────────────────────

function getPipedriveSheet_() {
  return getConfigSS_().getSheetByName(PIPEDRIVE_TAB);
}

function getOrCreatePipedriveSheet_() {
  var ss = getConfigSS_();
  var sh = ss.getSheetByName(PIPEDRIVE_TAB);
  if (!sh) {
    sh = ss.insertSheet(PIPEDRIVE_TAB);
    sh.getRange(1, 1, 1, PIPEDRIVE_HEADERS.length).setValues([PIPEDRIVE_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function pdParseJson_(raw, fallback) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function pdRowToConfig_(row) {
  return {
    dealerKey:     String(row[PDCFG.DEALER_KEY] || ''),
    group:         String(row[PDCFG.GROUP] || 'PRIMARY').toUpperCase(),
    orgId:         row[PDCFG.ORG_ID] === '' ? null : String(row[PDCFG.ORG_ID]).trim(),
    orgName:       String(row[PDCFG.ORG_NAME] || ''),
    productMap:    pdParseJson_(row[PDCFG.PRODUCT_MAP], {}),
    titleTemplate: String(row[PDCFG.TITLE_TEMPLATE] || ''),
    pipelineId:    String(row[PDCFG.PIPELINE_ID] || '').trim(),
    stageId:       String(row[PDCFG.STAGE_ID] || '').trim(),
    currency:      String(row[PDCFG.CURRENCY] || '').trim(),
    fieldOverrides: pdParseJson_(row[PDCFG.FIELD_OVERRIDES], {}),
    active:        isTrue_(row[PDCFG.ACTIVE]),
    sourceProductMap: pdParseJson_(row[PDCFG.SOURCE_PRODUCT_MAP], {})  // {sourceGroup: {type: entry}}
  };
}

/** Parsed PIPEDRIVE config for one (dealer_key, group); null if missing/inactive. */
function getPipedriveDealerConfig_(dealerKey, group) {
  var sh = getPipedriveSheet_();
  if (!sh) return null;
  group = String(group || 'PRIMARY').toUpperCase();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][PDCFG.DEALER_KEY]) === dealerKey &&
        String(data[i][PDCFG.GROUP] || 'PRIMARY').toUpperCase() === group) {
      var cfg = pdRowToConfig_(data[i]);
      return cfg.active ? cfg : null;
    }
  }
  return null;
}

/** All PIPEDRIVE rows for a dealer (active or not), for the editor. */
function getPipedriveDealerRows_(dealerKey) {
  var sh = getPipedriveSheet_();
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][PDCFG.DEALER_KEY]) === dealerKey) rows.push(pdRowToConfig_(data[i]));
  }
  return rows;
}

/**
 * Client-callable. Editor payload for one dealer: the billing groups (PRIMARY +
 * any billing_split group), the canonical types, and any saved PIPEDRIVE rows.
 */
function getPipedriveDealerEditorData(dealerKey) {
  var config = getDealerConfig_(dealerKey);
  if (!config) throw new Error('Dealer key not found: ' + dealerKey);
  var groups = ['PRIMARY'];
  var split = getBillingSplit_(config);
  if (split && split.groupName) groups.push(String(split.groupName).toUpperCase());

  var saved = {};
  getPipedriveDealerRows_(dealerKey).forEach(function(r) { saved[r.group] = r; });

  return {
    dealerKey:  dealerKey,
    dealerName: config[CFG.NAME],
    groups:     groups,
    types:      getCanonicalVehicleTypes_(),   // built-ins + user-added (the picker is filtered to allowed_types client-side)
    saved:      saved,
    sourceSplit: getSourceSplit_(config),     // {groupName,...}|null — drives the per-source product grid
    globalRules: getPipedriveGlobalRules_()   // so the panel can list overridable rules
  };
}

/**
 * Client-callable. Replaces all PIPEDRIVE rows for a dealer with the supplied
 * per-group rows. rows = [{group, orgId, orgName, productMap, titleTemplate,
 * pipelineId, stageId, currency, fieldOverrides, active}]. `productMap` values
 * are {product_id, variation_id?}; `fieldOverrides` is keyed by global rule id.
 */
function savePipedriveDealerConfig(dealerKey, rows) {
  if (!dealerKey) throw new Error('dealerKey required.');
  rows = rows || [];
  var sh = getOrCreatePipedriveSheet_();
  var data = sh.getDataRange().getValues();

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][PDCFG.DEALER_KEY]) === dealerKey) sh.deleteRow(i + 1);
  }

  var toWrite = rows.map(function(r) {
    var line = [];
    line[PDCFG.DEALER_KEY]     = dealerKey;
    line[PDCFG.GROUP]          = String(r.group || 'PRIMARY').toUpperCase();
    line[PDCFG.ORG_ID]         = (r.orgId == null) ? '' : String(r.orgId);
    line[PDCFG.ORG_NAME]       = r.orgName || '';
    line[PDCFG.PRODUCT_MAP]    = JSON.stringify(r.productMap || {});
    line[PDCFG.TITLE_TEMPLATE] = r.titleTemplate || '';
    line[PDCFG.PIPELINE_ID]    = r.pipelineId || '';
    line[PDCFG.STAGE_ID]       = r.stageId || '';
    line[PDCFG.CURRENCY]       = r.currency || '';
    line[PDCFG.FIELD_OVERRIDES] = JSON.stringify(r.fieldOverrides || {});
    line[PDCFG.ACTIVE]         = (r.active === false) ? false : true;
    line[PDCFG.SOURCE_PRODUCT_MAP] = JSON.stringify(r.sourceProductMap || {});
    return line;
  });
  if (toWrite.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toWrite.length, PIPEDRIVE_HEADERS.length).setValues(toWrite);
  }
  return { ok: true, saved: toWrite.length };
}

// ── Bulk dealer → organization linking (one-time setup helper) ─────────────

/** All Pipedrive organizations (id + name), for name-matching against dealers. */
function pdListAllOrganizations_() {
  return pdListAllV1_('/organizations').map(function(o) { return { id: o.id, name: o.name }; });
}

/** Normalizes a name for fuzzy matching: lowercase, strip punctuation + filler words. */
function normalizeOrgName_(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(of|the|inc|llc|co|group|automotive|auto)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Best org match for a dealer name: exact-normalized > token overlap. Null if nothing shares a token. */
function matchOrg_(dealerName, normIndex) {
  var dn = normalizeOrgName_(dealerName);
  if (!dn) return null;
  var dTokens = dn.split(' ').filter(Boolean);
  var best = null, bestScore = 0;
  for (var i = 0; i < normIndex.length; i++) {
    var o = normIndex[i];
    if (o.norm === dn) return { id: o.id, name: o.name, matchType: 'exact' };
    var oTokens = o.norm.split(' ').filter(Boolean);
    var shared = 0;
    for (var k = 0; k < dTokens.length; k++) if (oTokens.indexOf(dTokens[k]) !== -1) shared++;
    var score = shared / Math.max(dTokens.length, 1);
    if (score > bestScore) { bestScore = score; best = o; }
  }
  if (!best || bestScore === 0) return null;
  return { id: best.id, name: best.name, matchType: bestScore >= 0.6 ? 'strong' : 'weak' };
}

/**
 * Client-callable, READ-ONLY. For every active dealer, returns its current PRIMARY
 * org link (if any) and a proposed Pipedrive org matched by name — for the user to
 * review before any write. `[{dealerKey, dealerName, currentOrgId, currentOrgName,
 * proposedOrgId, proposedOrgName, matchType}]`.
 */
function getDealerOrgLinkProposals() {
  var configSS = getConfigSS_();
  var dealers = configSS.getSheetByName('DEALERS').getDataRange().getValues();
  var active = [];
  for (var i = 1; i < dealers.length; i++) {
    if (isTrue_(dealers[i][CFG.ACTIVE])) active.push({ key: String(dealers[i][CFG.KEY]), name: String(dealers[i][CFG.NAME]) });
  }

  var existing = {};
  var pdSheet = getPipedriveSheet_();
  if (pdSheet) {
    var pdData = pdSheet.getDataRange().getValues();
    for (var r = 1; r < pdData.length; r++) {
      if (String(pdData[r][PDCFG.GROUP] || 'PRIMARY').toUpperCase() === 'PRIMARY') {
        existing[String(pdData[r][PDCFG.DEALER_KEY])] = {
          orgId:   pdData[r][PDCFG.ORG_ID] === '' ? '' : String(pdData[r][PDCFG.ORG_ID]),
          orgName: String(pdData[r][PDCFG.ORG_NAME] || '')
        };
      }
    }
  }

  var normIndex = pdListAllOrganizations_().map(function(o) { return { id: o.id, name: o.name, norm: normalizeOrgName_(o.name) }; });

  return active.map(function(d) {
    var cur = existing[d.key] || {};
    var prop = matchOrg_(d.name, normIndex);
    return {
      dealerKey:       d.key,
      dealerName:      d.name,
      currentOrgId:    cur.orgId || '',
      currentOrgName:  cur.orgName || '',
      proposedOrgId:   prop ? String(prop.id) : '',
      proposedOrgName: prop ? prop.name : '',
      matchType:       prop ? prop.matchType : 'none'
    };
  });
}

/**
 * Client-callable. Writes the user-confirmed dealer→org links to the PIPEDRIVE tab —
 * upserting each dealer's PRIMARY row (preserves product_map / field_overrides on an
 * existing row; creates a new row with empty maps otherwise). Org only — never touches
 * product mappings. links = [{dealerKey, orgId, orgName}].
 */
function saveDealerOrgLinks(links) {
  links = links || [];
  var sh = getOrCreatePipedriveSheet_();
  var data = sh.getDataRange().getValues();
  var rowByKey = {};
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][PDCFG.GROUP] || 'PRIMARY').toUpperCase() === 'PRIMARY') rowByKey[String(data[i][PDCFG.DEALER_KEY])] = i + 1;
  }

  var updated = 0, appended = 0;
  links.forEach(function(l) {
    if (!l || !l.dealerKey || l.orgId === undefined || l.orgId === null || String(l.orgId).trim() === '') return;
    var rn = rowByKey[String(l.dealerKey)];
    if (rn) {
      sh.getRange(rn, PDCFG.ORG_ID + 1).setValue(String(l.orgId));
      sh.getRange(rn, PDCFG.ORG_NAME + 1).setValue(l.orgName || '');
      updated++;
    } else {
      var line = [];
      for (var c = 0; c < PIPEDRIVE_HEADERS.length; c++) line[c] = '';
      line[PDCFG.DEALER_KEY]      = l.dealerKey;
      line[PDCFG.GROUP]           = 'PRIMARY';
      line[PDCFG.ORG_ID]          = String(l.orgId);
      line[PDCFG.ORG_NAME]        = l.orgName || '';
      line[PDCFG.PRODUCT_MAP]     = '{}';
      line[PDCFG.FIELD_OVERRIDES] = '{}';
      line[PDCFG.ACTIVE]          = true;
      sh.getRange(sh.getLastRow() + 1, 1, 1, PIPEDRIVE_HEADERS.length).setValues([line]);
      appended++;
    }
  });
  return { ok: true, updated: updated, appended: appended };
}

// ── Global deal-field rules (PIPEDRIVE_SETTINGS tab) ───────────────────────

function getOrCreatePipedriveSettingsSheet_() {
  var ss = getConfigSS_();
  var sh = ss.getSheetByName(PIPEDRIVE_SETTINGS_TAB);
  if (!sh) {
    sh = ss.insertSheet(PIPEDRIVE_SETTINGS_TAB);
    sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Reads a single value from the PIPEDRIVE_SETTINGS key/value tab ('' if absent). */
function getPipedriveSettingValue_(key) {
  var sh = getConfigSS_().getSheetByName(PIPEDRIVE_SETTINGS_TAB);
  if (!sh) return '';
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) return String(data[i][1] || '');
  }
  return '';
}

/** Upserts a single value into the PIPEDRIVE_SETTINGS key/value tab. */
function setPipedriveSettingValue_(key, value) {
  var sh = getOrCreatePipedriveSettingsSheet_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[key, value]]);
}

// ── Vehicle-type registry ──────────────────────────────────────────────────
// Single source of truth for the canonical vehicle types (built-ins + user-added).
// Stored as a JSON array in the PIPEDRIVE_SETTINGS 'vehicle_types' row. Every place that
// enumerates types reads getCanonicalVehicleTypes_(), so adding a type propagates to the
// Rules-editor pills, the Pipedrive product picker, the billing sheet, line items, and the
// dashboard. A new type is INERT until vehicles normalize to it (a NORM_MAPS rule, or the
// feed already uses the label) — that assignment stays in Manage Normalization.

var _vehicleTypes_ = null;   // per-execution cache

/**
 * The full canonical type list: built-in CANONICAL_TYPES (first, in order) unioned with any
 * user-added extras from the registry, de-duplicated case-insensitively. The built-ins are
 * always present even if the stored value is missing/malformed — a fail-safe for the
 * billing/normalization assumptions. Cached per execution.
 */
function getCanonicalVehicleTypes_() {
  if (_vehicleTypes_) return _vehicleTypes_.slice();
  var extras = pdParseJson_(getPipedriveSettingValue_(PD_VEHICLE_TYPES_KEY), []);
  if (!Array.isArray(extras)) extras = [];
  var seen = {}, out = [];
  CANONICAL_TYPES.concat(extras).forEach(function(t) {
    var label = String(t == null ? '' : t).trim();
    if (label === '') return;
    var k = label.toLowerCase();
    if (seen[k]) return;
    seen[k] = true;
    out.push(label);
  });
  _vehicleTypes_ = out;
  return out.slice();
}

/** The user-added types only (everything past the protected built-ins). */
function getExtraVehicleTypes_() {
  return getCanonicalVehicleTypes_().filter(function(t) { return !isCanonicalType_(t); });
}

/** True if `label` (case-insensitive) is a built-in type that can never be removed. */
function isCanonicalType_(label) {
  var k = String(label || '').trim().toLowerCase();
  return CANONICAL_TYPES.some(function(t) { return t.toLowerCase() === k; });
}

/**
 * Client-callable. Registers a new vehicle type. Validates (non-blank; ≤40 chars; not a
 * case-insensitive duplicate of an existing type), appends to the extras, busts the cache,
 * and returns the full updated type list. Throws on invalid input.
 */
function addVehicleType(label) {
  var clean = String(label == null ? '' : label).trim();
  if (clean === '') throw new Error('Type label cannot be blank.');
  if (clean.length > 40) throw new Error('Type label is too long (40 characters max).');
  var dup = getCanonicalVehicleTypes_().some(function(t) { return t.toLowerCase() === clean.toLowerCase(); });
  if (dup) throw new Error('Type "' + clean + '" already exists.');
  var extras = getExtraVehicleTypes_();
  extras.push(clean);
  setPipedriveSettingValue_(PD_VEHICLE_TYPES_KEY, JSON.stringify(extras));
  _vehicleTypes_ = null;
  return getCanonicalVehicleTypes_();
}

/**
 * Client-callable. Removes a user-added vehicle type. Refuses a built-in, and refuses a
 * type still referenced by any dealer (allowed_types / cao_exclude_types / seasoning /
 * product_map / source_product_map) — returning the blocking dealer names so the UI can
 * explain. On success busts the cache and returns the updated list.
 * @return {{ok:boolean, types?:string[], blockedBy?:string[], message?:string}}
 */
function removeVehicleType(label) {
  var clean = String(label == null ? '' : label).trim();
  if (clean === '') return { ok: false, message: 'No type specified.' };
  if (isCanonicalType_(clean)) {
    return { ok: false, message: '"' + clean + '" is a built-in type and cannot be removed.' };
  }
  var blockedBy = dealersUsingType_(clean);
  if (blockedBy.length) {
    return { ok: false, blockedBy: blockedBy,
             message: '"' + clean + '" is still used by: ' + blockedBy.join(', ') +
                      '. Remove it from those dealers (Allowed Types / product map) first.' };
  }
  var extras = getExtraVehicleTypes_().filter(function(t) { return t.toLowerCase() !== clean.toLowerCase(); });
  setPipedriveSettingValue_(PD_VEHICLE_TYPES_KEY, JSON.stringify(extras));
  _vehicleTypes_ = null;
  return { ok: true, types: getCanonicalVehicleTypes_() };
}

/**
 * Read-only. Names of dealers that still reference `type` anywhere in their config —
 * filtering_rules (allowed_types / cao_exclude_types / seasoning[].type) or a PIPEDRIVE row
 * (product_map / source_product_map). Case-insensitive. Backs the remove guard.
 */
function dealersUsingType_(type) {
  var target = String(type || '').trim().toLowerCase();
  if (target === '') return [];
  var configSS = getConfigSS_();
  var out = [], nameByKey = {};

  var dealerData = configSS.getSheetByName('DEALERS').getDataRange().getValues();
  for (var i = 1; i < dealerData.length; i++) {
    var key = String(dealerData[i][CFG.KEY] || '');
    if (!key) continue;
    nameByKey[key] = String(dealerData[i][CFG.NAME] || key);
    var fr = pdParseJson_(dealerData[i][CFG.FILTER_RULES], null);
    if (fr && filterRulesUseType_(fr, target)) out.push(nameByKey[key]);
  }

  var sh = getPipedriveSheet_();
  if (sh) {
    var pd = sh.getDataRange().getValues();
    for (var j = 1; j < pd.length; j++) {
      var dk = String(pd[j][PDCFG.DEALER_KEY] || '');
      if (!dk) continue;
      var name = nameByKey[dk] || dk;
      if (out.indexOf(name) !== -1) continue;
      if (pdRowUsesType_(pd[j], target)) out.push(name);
    }
  }
  return out;
}

/** True if a parsed filtering_rules object references `targetLower` in any type field. */
function filterRulesUseType_(fr, targetLower) {
  function hasIn(arr) {
    return Array.isArray(arr) && arr.some(function(v) { return String(v).trim().toLowerCase() === targetLower; });
  }
  if (hasIn(fr.allowed_types) || hasIn(fr.cao_exclude_types)) return true;
  return Array.isArray(fr.seasoning) && fr.seasoning.some(function(s) {
    return s && String(s.type).trim().toLowerCase() === targetLower;
  });
}

/** True if a raw PIPEDRIVE row's product_map / source_product_map keys include `targetLower`. */
function pdRowUsesType_(row, targetLower) {
  function mapHasType(map) {
    return map && typeof map === 'object' &&
      Object.keys(map).some(function(t) { return String(t).trim().toLowerCase() === targetLower; });
  }
  if (mapHasType(pdParseJson_(row[PDCFG.PRODUCT_MAP], {}))) return true;
  var spm = pdParseJson_(row[PDCFG.SOURCE_PRODUCT_MAP], {});
  return spm && typeof spm === 'object' &&
    Object.keys(spm).some(function(g) { return mapHasType(spm[g]); });
}

/** The EXPLICITLY chosen product→org field key ('' if unset). */
function getPipedriveProductOrgField_() {
  return getPipedriveSettingValue_(PD_PRODUCT_ORG_FIELD_KEY);
}

/**
 * The product field used to scope products to an org: the explicit setting if
 * chosen, otherwise AUTO-DETECTED as the first Organization-type product custom
 * field (the common "we have one 'Customer' org field" case needs no config).
 * '' when none exists.
 */
function getEffectiveProductOrgField_() {
  var explicit = getPipedriveProductOrgField_();
  if (explicit) return explicit;
  var fields = pdListProductFields_();
  for (var i = 0; i < fields.length; i++) {
    var t = String(fields[i].field_type || '').toLowerCase();
    if (t === 'org' || t === 'organization') return fields[i].key;
  }
  return '';
}

/** Client-callable. Saves the product→org field key (blank clears it → catalog unscoped). */
function savePipedriveProductOrgField(fieldKey) {
  setPipedriveSettingValue_(PD_PRODUCT_ORG_FIELD_KEY, String(fieldKey || '').trim());
  // The cached catalog embeds each product's customerOrgId from this field — bust it
  // so the next fetch re-enriches products with the newly chosen field.
  try { CacheService.getScriptCache().remove('pd_catalog_v2'); } catch (e) {}
  return { ok: true };
}

/** Reads the global deal-field rules array from the PIPEDRIVE_SETTINGS tab ([] if absent). */
function getPipedriveGlobalRules_() {
  var sh = getConfigSS_().getSheetByName(PIPEDRIVE_SETTINGS_TAB);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === PD_RULES_KEY) {
      var rules = pdParseJson_(data[i][1], []);
      return Array.isArray(rules) ? rules : [];
    }
  }
  return [];
}

/** Client-callable. Returns the global deal-field rules. */
function getPipedriveGlobalSettings() {
  return { rules: getPipedriveGlobalRules_() };
}

/**
 * Client-callable. Persists the global deal-field rules. Assigns a stable id to
 * any rule missing one (preserving existing ids) so per-dealer overrides keep
 * referencing the right rule.
 */
function savePipedriveGlobalSettings(rules) {
  rules = Array.isArray(rules) ? rules : [];
  var maxN = 0;
  rules.forEach(function(r) {
    if (r && r.id) { var m = /^r(\d+)$/.exec(String(r.id)); if (m) maxN = Math.max(maxN, parseInt(m[1], 10)); }
  });
  rules.forEach(function(r) { if (r && !r.id) r.id = 'r' + (++maxN); });

  var sh = getOrCreatePipedriveSettingsSheet_();
  var data = sh.getDataRange().getValues();
  var rowNum = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === PD_RULES_KEY) { rowNum = i + 1; break; }
  }
  var json = JSON.stringify(rules);
  if (rowNum > 0) sh.getRange(rowNum, 2).setValue(json);
  else            sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[PD_RULES_KEY, json]]);
  return { ok: true, count: rules.length };
}

/**
 * Client-callable bootstrap for the global Pipedrive Settings screen:
 * connection status + live deal/org field defs (for the rule builder) + the
 * saved global rules. Reuses the cached catalog from getPipedriveConfigBootstrap.
 */
function getPipedriveSettingsBootstrap(refresh) {
  var status = getPipedriveStatus();
  if (!status.configured) return { configured: false };
  var cat = getPipedriveConfigBootstrap(refresh);
  return {
    configured:      true,
    defaults:        status.defaults,
    dealFields:      cat.dealFields || [],
    orgFields:       cat.orgFields || [],
    productFields:   pdListProductFields_(),          // for the product→org field picker
    productOrgField: getEffectiveProductOrgField_(),  // effective (explicit or auto-detected) product→org field key
    rules:           getPipedriveGlobalRules_()
  };
}

// ── Product variations (lazy, per product) ─────────────────────────────────

// Product variations are a v2-ONLY endpoint (GET /api/v2/products/{id}/variations,
// cursor pagination) — they do NOT exist on v1. Hitting the v1 base returned an
// error → empty list → the blank/greyed variation dropdown.
function pdListProductVariations_(productId) {
  if (!productId) return [];
  var out = [], cursor = '', guard = 0;
  do {
    var path = '/products/' + productId + '/variations?limit=500' +
               (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    var r = pdFetch_('get', path, null, { version: 'v2' });
    if (!r.ok) break;
    if (r.data && r.data.length) out = out.concat(r.data);
    cursor = (r.additional && r.additional.next_cursor) ? r.additional.next_cursor : '';
  } while (cursor && guard++ < 20);
  return out.map(function(v) { return { id: v.id, name: v.name, prices: v.prices || [] }; });
}

/** Client-callable: a product's variations, for the per-dealer product grid. */
function getProductVariations(productId) {
  return pdListProductVariations_(productId);
}

// ── Line items from billing totals × the group's product map ───────────────

/**
 * Builds PD deal line items. Quantity per type = GROSS (VIN-log dupes included — a
 * re-printed VIN is still produced & billed). Iterates the product map's mapped types
 * (incl. user-added ones), reading each gross count from billing.byType[type].
 * Same product+variation across types are summed; different variations stay
 * distinct lines. Returns [{product_id, quantity, item_price, name,
 * product_variation_id?}].
 * @param {Object} billing             readBillingTotals_ result (uses .byType)
 * @param {Object} productMap          {type: {product_id, variation_id?}} (a bare id is tolerated)
 * @param {Array}  products            pdListProducts_ result (price + name lookup)
 * @param {string} currency            target currency for item_price
 * @param {Object} variationsByProduct {productId: [{id,name,prices}]} for products with a chosen variation
 */
function buildLineItems_(billing, productMap, products, currency, variationsByProduct) {
  if (!billing || !productMap) return [];
  var byId = {};
  (products || []).forEach(function(p) { byId[String(p.id)] = p; });
  variationsByProduct = variationsByProduct || {};
  currency = (currency || 'USD').toUpperCase();

  function priceFrom(prices) {
    prices = prices || [];
    for (var i = 0; i < prices.length; i++) {
      if (String(prices[i].currency).toUpperCase() === currency) return Number(prices[i].price) || 0;
    }
    return prices.length ? (Number(prices[0].price) || 0) : 0;
  }
  function variationOf(pid, vid) {
    var list = variationsByProduct[String(pid)] || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(vid)) return list[i];
    return null;
  }

  var agg = {};
  var byType = (billing && billing.byType) || {};
  Object.keys(productMap || {}).forEach(function(type) {
    var entry = productMap[type];
    if (entry === undefined || entry === null || entry === '') return;
    var pid, vid = null;
    if (typeof entry === 'object') { pid = entry.product_id; vid = entry.variation_id || null; }
    else { pid = entry; }   // bare id (tolerated)
    if (pid === undefined || pid === null || pid === '') return;
    var qty = byType[type] ? (Number(byType[type].gross) || 0) : 0;   // GROSS — VIN-log dupes are still produced & billed
    if (qty <= 0) return;

    var key = String(pid) + '|' + (vid || '');
    if (!agg[key]) {
      var prod = byId[String(pid)], name = prod ? (prod.name || '') : '', price = 0;
      if (vid) {
        var v = variationOf(pid, vid);
        price = v ? priceFrom(v.prices) : (prod ? priceFrom(prod.prices) : 0);
        if (v && v.name) name = name ? (name + ' — ' + v.name) : v.name;
      } else {
        price = prod ? priceFrom(prod.prices) : 0;
      }
      var li = { product_id: pid, quantity: 0, item_price: price, name: name,
                 inactive: prod ? (prod.inactive === true) : true };  // not in catalog = treat unavailable
      if (vid) li.product_variation_id = vid;
      agg[key] = li;
    }
    agg[key].quantity += qty;
  });

  return Object.keys(agg).map(function(k) { return agg[k]; });
}

/** Converts a per-source {type: qty} map into the byType billing shape buildLineItems_ reads. */
function bySourceToBilling_(typeCounts) {
  typeCounts = typeCounts || {};
  var byType = {};
  Object.keys(typeCounts).forEach(function(type) {
    byType[type] = { gross: Number(typeCounts[type]) || 0, dupes: 0 };
  });
  return { byType: byType };
}

/**
 * Merges line items by product+variation (summing quantity), so a SKU used by more
 * than one source collapses into one deal line. Preserves price/name + inactive flag.
 */
function mergeLineItems_(items) {
  var agg = {};
  (items || []).forEach(function(li) {
    var key = String(li.product_id) + '|' + (li.product_variation_id || '');
    if (!agg[key]) {
      agg[key] = { product_id: li.product_id, quantity: 0, item_price: li.item_price, name: li.name, inactive: !!li.inactive };
      if (li.product_variation_id) agg[key].product_variation_id = li.product_variation_id;
    }
    agg[key].quantity += (Number(li.quantity) || 0);
    if (li.inactive) agg[key].inactive = true;
  });
  return Object.keys(agg).map(function(k) { return agg[k]; });
}

// ── Deal push (P2) — create/link, attach products, set fields ───────────────

function pdCreateDeal_(params) {
  var r = pdFetch_('post', '/deals', params);
  if (!r.ok || !r.data || !r.data.id) return { ok: false, error: r.error || 'Deal creation failed.' };
  return { ok: true, dealId: r.data.id };
}

function pdGetDeal_(dealId) {
  var r = pdFetch_('get', '/deals/' + dealId);
  if (!r.ok || !r.data) return { ok: false, error: r.error || ('Deal ' + dealId + ' not found.') };
  return { ok: true, deal: r.data };
}

function pdUpdateDeal_(dealId, fields) {
  var r = pdFetch_('put', '/deals/' + dealId, fields);
  if (!r.ok) return { ok: false, error: r.error || 'Deal update failed.' };
  return { ok: true };
}

function pdListDealProducts_(dealId) {
  var r = pdFetch_('get', '/deals/' + dealId + '/products');
  if (!r.ok || !r.data) return [];
  return r.data;
}

/**
 * Attaches line items to a deal, skipping products already on it — so a retry
 * never double-attaches. Returns {ok, attached, skipped, error}.
 */
function pdAttachProducts_(dealId, lineItems) {
  if (!lineItems || !lineItems.length) return { ok: true, attached: 0, skipped: 0 };
  var existing = {};
  pdListDealProducts_(dealId).forEach(function(p) {
    existing[String(p.product_id) + '|' + (p.product_variation_id || '')] = true;
  });

  var attached = 0, skipped = 0, errs = [];
  for (var i = 0; i < lineItems.length; i++) {
    var li = lineItems[i];
    var k = String(li.product_id) + '|' + (li.product_variation_id || '');
    if (existing[k]) { skipped++; continue; }
    var body = { product_id: Number(li.product_id), item_price: Number(li.item_price) || 0, quantity: Number(li.quantity) || 0 };
    if (li.product_variation_id) body.product_variation_id = Number(li.product_variation_id);
    var r = pdFetch_('post', '/deals/' + dealId + '/products', body);
    if (r.ok) attached++; else errs.push('product ' + li.product_id + ': ' + r.error);
  }
  if (errs.length) return { ok: false, attached: attached, skipped: skipped, error: errs.join('; ') };
  return { ok: true, attached: attached, skipped: skipped };
}

// ── Install cost: an extra Install line item + the Design no-charge variation ──
// Generic, config-driven (PIPEDRIVE_SETTINGS `install_cost_config`); inert until set.

/** Updates one existing deal line item. PUT /deals/{id}/products/{attachmentId}. */
function pdUpdateDealProduct_(dealId, attachmentId, body) {
  var r = pdFetch_('put', '/deals/' + dealId + '/products/' + attachmentId, body);
  if (!r.ok) return { ok: false, error: r.error || 'Line-item update failed.' };
  return { ok: true };
}

/** Adds one product line item to a deal (no dedup — the caller owns idempotency). */
function pdAddDealProduct_(dealId, item) {
  var b = { product_id: Number(item.product_id), item_price: Number(item.item_price) || 0, quantity: Number(item.quantity) || 1 };
  if (item.product_variation_id) b.product_variation_id = Number(item.product_variation_id);
  var r = pdFetch_('post', '/deals/' + dealId + '/products', b);
  if (!r.ok) return { ok: false, error: r.error || 'Line-item add failed.' };
  return { ok: true };
}

/** Install-cost config from PIPEDRIVE_SETTINGS ({} if unset). */
function getInstallCostConfig_() {
  return pdParseJson_(getPipedriveSettingValue_(PD_INSTALL_COST_KEY), {});
}
/** Client-callable: read the install-cost config for the settings UI. */
function getPipedriveInstallCostConfig() { return getInstallCostConfig_(); }
/** Client-callable: persist the install-cost config. */
function saveInstallCostConfig(cfg) {
  setPipedriveSettingValue_(PD_INSTALL_COST_KEY, JSON.stringify(cfg || {}));
  return { ok: true };
}

/**
 * Adds/updates the Install line item per the org's "Program Install Cost" option:
 * variation + price from the configured {variation_id, percent} — percent>0 → percent
 * of the deal's OTHER line items (excl. design + install, item_price × quantity), rounded
 * to cents; else price 0. Idempotent (updates an existing Install row). No-op (fail-safe)
 * until configured, or if the org's option isn't mapped. Returns {ok, applied, price?, error?}.
 */
function pdApplyInstallCost_(dealId, pdCfg) {
  var cfg = getInstallCostConfig_();
  if (!cfg || !cfg.org_field_key || !cfg.install_product_id) return { ok: true, applied: false };

  var org = pdGetOrgWithCustomFields_(pdCfg.orgId, [cfg.org_field_key]);
  var optRaw = org ? pdOrgFieldValue_(org.custom_fields, cfg.org_field_key) : undefined;
  if (optRaw === undefined || optRaw === null || optRaw === '') return { ok: true, applied: false };
  var rule = (cfg.options && cfg.options[String(optRaw)]) ? cfg.options[String(optRaw)] : null;
  if (!rule) return { ok: true, applied: false };   // unmapped option → skip (fail-safe)

  var rows = pdListDealProducts_(dealId);

  var price = 0, pct = Number(rule.percent) || 0;
  if (pct > 0) {
    var exclude = [String(cfg.install_product_id)];
    if (cfg.design_product_id) exclude.push(String(cfg.design_product_id));
    var subtotal = 0;
    rows.forEach(function(p) {
      if (exclude.indexOf(String(p.product_id)) !== -1) return;
      subtotal += (Number(p.item_price) || 0) * (Number(p.quantity) || 0);
    });
    price = Math.round(subtotal * pct) / 100;   // subtotal × pct/100, rounded to cents
  }

  var varId = rule.variation_id ? Number(rule.variation_id) : null;
  var existing = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].product_id) === String(cfg.install_product_id)) { existing = rows[i]; break; }
  }
  var res;
  if (existing) {
    res = pdUpdateDealProduct_(dealId, existing.id,
            { item_price: price, quantity: Number(existing.quantity) || 1, product_variation_id: varId });
  } else {
    var add = { product_id: cfg.install_product_id, item_price: price, quantity: 1 };
    if (varId) add.product_variation_id = varId;
    res = pdAddDealProduct_(dealId, add);
  }
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, applied: true, price: price };
}

/**
 * Sets the auto-added Design line item's variation to "No Charge Design" — but ONLY when
 * its variation is currently empty (a template-request deal already has a charged Design →
 * left alone). The Design line is added by a Pipedrive automation a few seconds after deal
 * creation, so it's polled for. Best-effort: if it hasn't appeared, returns
 * {applied:false, designPending:true} (the push still succeeds; a re-push sets it).
 */
function pdApplyDesignVariation_(dealId) {
  var cfg = getInstallCostConfig_();
  if (!cfg || !cfg.design_product_id || !cfg.design_no_charge_variation_id) return { ok: true, applied: false };

  var found = null;
  for (var a = 0; a < 8 && !found; a++) {
    if (a > 0) Utilities.sleep(2000);   // ~14s max over 8 polls — automation fires a few sec post-create
    var rows = pdListDealProducts_(dealId);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].product_id) === String(cfg.design_product_id)) { found = rows[i]; break; }
    }
  }
  if (!found) return { ok: true, applied: false, designPending: true };
  if (!pdFieldEmpty_(found.product_variation_id)) return { ok: true, applied: false, alreadySet: true };

  var u = pdUpdateDealProduct_(dealId, found.id, { product_variation_id: Number(cfg.design_no_charge_variation_id) });
  if (!u.ok) return { ok: false, error: u.error };
  return { ok: true, applied: true };
}

// ── Org-condition engine (mirror of the targeting engine, on org fields) ────
// Parallel to conditionMatches_/groupMatches_ — those are left UNTOUCHED. Here
// the "row" is an org's custom_fields object keyed by Pipedrive org-field key.

var PD_NUMERIC_OPS = { gte: true, lte: true, gt: true, lt: true };

/** Pulls a comparable scalar from an org custom-field value (scalar | {id} | {value}). */
function pdOrgFieldValue_(orgFields, key) {
  var v = (orgFields && key) ? orgFields[key] : undefined;
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object') {
    if (v.value !== undefined && v.value !== null) return v.value;
    if (v.id !== undefined && v.id !== null) return v.id;
    return undefined;
  }
  return v;
}

/** One condition leaf against an org's fields. Fails SAFE (false) on any misconfig. */
function pdOrgConditionMatches_(orgFields, cond) {
  if (!cond || !cond.field || !cond.op) return false;
  var vals = cond.values;
  if (!vals || !vals.length) return false;
  var raw = pdOrgFieldValue_(orgFields, cond.field);
  if (raw === undefined) return false;   // org doesn't have the field → no match
  var op = String(cond.op).toLowerCase();

  if (PD_NUMERIC_OPS[op]) {
    var n = parseFloat(String(raw).replace(/[$,]/g, ''));
    var t = parseFloat(String(vals[0]).replace(/[$,]/g, ''));
    if (isNaN(n) || isNaN(t)) return false;
    if (op === 'gte') return n >= t;
    if (op === 'lte') return n <= t;
    if (op === 'gt')  return n > t;
    return n < t;
  }
  var cell = String(raw).toLowerCase();
  var list = vals.map(function(x) { return String(x).toLowerCase(); });
  if (op === 'is')           return cell === list[0];               // exact equals (single value)
  if (op === 'is_not')       return cell !== list[0];               // exact not-equals (single value)
  if (op === 'in')           return list.indexOf(cell) !== -1;
  if (op === 'not_in')       return list.indexOf(cell) === -1;
  if (op === 'contains')     { for (var i = 0; i < list.length; i++) if (cell.indexOf(list[i]) !== -1) return true; return false; }
  if (op === 'not_contains') { for (var j = 0; j < list.length; j++) if (cell.indexOf(list[j]) !== -1) return false; return true; }
  return false;   // unknown op → no match
}

/** Recursive AND/OR over an org's fields. Empty group → false (fail-safe). */
function pdOrgGroupMatches_(orgFields, group) {
  if (!group || !group.children || !group.children.length) return false;
  var all = String(group.match || 'all').toLowerCase() !== 'any';
  for (var i = 0; i < group.children.length; i++) {
    var ch = group.children[i];
    var m = (ch && ch.children) ? pdOrgGroupMatches_(orgFields, ch) : pdOrgConditionMatches_(orgFields, ch);
    if (all && !m) return false;
    if (!all && m) return true;
  }
  return all;   // AND: none failed → true. OR: none matched → false.
}

/** Writes a resolved value into the deal-update map, honoring type (monetary companion). */
// Pipedrive enforces INTEGER ids for enum/set option ids + monetary amounts (its
// /deals/{id}/products endpoint likewise rejects a string product_id with
// "must be integer"). Coerce a numeric string to a Number; leave anything
// non-numeric (real text) untouched.
function pdOptionId_(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return v;
  var n = Number(v);
  return isNaN(n) ? v : n;
}

function pdSetDealField_(out, dealField, type, value, currency) {
  if (!dealField || value === undefined || value === null || value === '') return;
  if (type === 'monetary') {
    if (typeof value === 'object') {
      if (value.value === undefined || value.value === null || value.value === '') return;
      out[dealField] = pdOptionId_(value.value);
      out[dealField + '_currency'] = value.currency || currency || 'USD';
    } else {
      out[dealField] = pdOptionId_(value);
      out[dealField + '_currency'] = currency || 'USD';
    }
  } else {
    var v = (typeof value === 'object' && value.id !== undefined) ? value.id : value;
    if (type === 'enum' || type === 'set') v = pdOptionId_(v);   // option ids must be integers
    out[dealField] = v;
  }
}

/** All org-field keys referenced by a set of rules (copy org_field + conditional condition fields). */
function pdCollectOrgKeys_(rules) {
  var keys = {};
  function walk(group) {
    if (!group || !group.children) return;
    group.children.forEach(function(ch) {
      if (ch && ch.children) walk(ch);
      else if (ch && ch.field) keys[ch.field] = true;
    });
  }
  rules.forEach(function(r) {
    if (!r) return;
    if (r.mode === 'conditional') walk(r.group);
    else if (r.org_field) keys[r.org_field] = true;   // copy (default mode)
  });
  return Object.keys(keys);
}

/**
 * Resolves the effective deal-field map for one push: global rules with
 * per-(dealer,group) overrides applied, evaluated against the org's fields.
 * Returns a flat {dealFieldKey: value} map (v1 top-level shape, incl. monetary
 * `_currency`). Pure given its inputs — the caller passes the global rules and
 * the override object so it stays unit-testable.
 *
 * @param {string} orgId
 * @param {Array}  globalRules  getPipedriveGlobalRules_()
 * @param {Object} overrides    per-(dealer,group) field_overrides: {ruleId: {off:true} | <replacement rule>}
 * @param {string} currency
 */
/** True when a deal field value is unset/blank (scalar empty, or {value}/{id} empty, or {}). */
function pdFieldEmpty_(v) {
  if (v === undefined || v === null || v === '') return true;
  if (typeof v === 'object') {
    if (v.value !== undefined) return v.value === null || v.value === '';
    if (v.id !== undefined)    return v.id === null || v.id === '';
    return Object.keys(v).length === 0;
  }
  return false;
}

/** True if any effective rule (after overrides) is a constant rule with if_empty set. */
function pdHasIfEmptyConstant_(globalRules, overrides) {
  overrides = overrides || {};
  return (globalRules || []).some(function(rule) {
    if (!rule || !rule.deal_field) return false;
    var ov = rule.id ? overrides[rule.id] : null;
    var eff = ov ? (ov.off === true ? null : ov) : rule;
    return !!(eff && eff.mode === 'constant' && eff.if_empty);
  });
}

/**
 * Resolves the deal-field map for one push. Rule modes:
 *  - constant: set deal_field to a fixed `value` (no org needed). With `if_empty`, set
 *    only when the field is empty — a NEW deal is treated as empty (always set); a LINK
 *    reads `existingDealFields` (skip if already set, or if unreadable → never clobber).
 *  - copy / conditional: read the org's custom fields (behavior unchanged).
 * @param {boolean} isNewDeal           true for a freshly-created deal (create path)
 * @param {Object}  existingDealFields  a linked deal's current top-level field map, or null
 */
function pdResolveDealFields_(orgId, globalRules, overrides, currency, isNewDeal, existingDealFields) {
  if (!globalRules || !globalRules.length) return {};
  overrides = overrides || {};

  var effective = [];
  globalRules.forEach(function(rule) {
    if (!rule || !rule.deal_field) return;
    var ov = rule.id ? overrides[rule.id] : null;
    if (ov) {
      if (ov.off === true) return;          // disabled for this dealer
      effective.push(ov);                   // full replacement (copy|conditional|constant)
    } else {
      effective.push(rule);
    }
  });
  if (!effective.length) return {};

  var out = {};

  // 1. Constant rules — a fixed value, no org needed.
  effective.forEach(function(rule) {
    if (rule.mode !== 'constant') return;
    if (rule.value === undefined || rule.value === null || rule.value === '') return;
    if (rule.if_empty && !isNewDeal) {
      if (!existingDealFields) return;                                  // unreadable → don't clobber
      if (!pdFieldEmpty_(existingDealFields[rule.deal_field])) return;  // already set → leave alone
    }
    pdSetDealField_(out, rule.deal_field, rule.type, rule.value, currency);
  });

  // 2. Copy / conditional rules — need the org's custom fields. Fetch only when present;
  //    on failure the constant results above still stand (not dropped).
  var orgRules = effective.filter(function(r) { return r.mode !== 'constant'; });
  if (!orgRules.length || !orgId) return out;

  var org = pdGetOrgWithCustomFields_(orgId, pdCollectOrgKeys_(orgRules));
  if (!org || !org.custom_fields) return out;
  var cf = org.custom_fields;

  orgRules.forEach(function(rule) {
    if (rule.mode === 'conditional') {
      var picked = pdOrgGroupMatches_(cf, rule.group) ? rule.then_value : rule.else_value;
      pdSetDealField_(out, rule.deal_field, rule.type, picked, currency);
    } else {   // copy (default)
      if (!rule.org_field) return;
      var raw = cf[rule.org_field];
      if (raw === undefined || raw === null || raw === '') return;
      var id = (raw && raw.id !== undefined) ? raw.id : raw;
      if ((rule.type === 'enum' || rule.type === 'set') && rule.option_map) {
        var mapped = rule.option_map[String(id)];
        if (mapped !== undefined) out[rule.deal_field] = pdOptionId_(mapped);   // option id → integer
      } else if (rule.type === 'enum' || rule.type === 'set') {
        out[rule.deal_field] = pdOptionId_(id);                                  // option id → integer
      } else if (rule.type === 'monetary') {
        out[rule.deal_field] = pdOptionId_((raw && raw.value !== undefined) ? raw.value : raw);
        out[rule.deal_field + '_currency'] = (raw && raw.currency) ? raw.currency : (currency || 'USD');
      } else {
        out[rule.deal_field] = (raw && raw.value !== undefined) ? raw.value
                              : ((raw && raw.id !== undefined) ? raw.id : raw);   // text/varchar: leave as-is
      }
    }
  });
  return out;
}

function buildDealTitle_(template, ctx) {
  var t = (template && String(template).trim() !== '')
    ? template
    : ('{dealer_name} {date}' + (ctx.group && ctx.group !== 'PRIMARY' ? ' ({group})' : ''));
  return t.replace(/\{dealer_name\}/g, ctx.dealerName || '')
          .replace(/\{date\}/g, ctx.date || '')
          .replace(/\{group\}/g, ctx.group || '')
          .replace(/\{count\}/g, String(ctx.count != null ? ctx.count : ''))
          .replace(/\s+/g, ' ').trim();
}

// Idempotency state lives in ScriptProperties (cross-execution), keyed by row.
function pdPushStateGet_(rowIndex) {
  var raw = PropertiesService.getScriptProperties().getProperty('pd_push_' + rowIndex);
  if (!raw) return { dealId: '', productsDone: false, fieldsDone: false };
  try { return JSON.parse(raw); } catch (e) { return { dealId: '', productsDone: false, fieldsDone: false }; }
}
function pdPushStateSet_(rowIndex, state) {
  PropertiesService.getScriptProperties().setProperty('pd_push_' + rowIndex, JSON.stringify(state));
}
function pdPushStateClear_(rowIndex) {
  PropertiesService.getScriptProperties().deleteProperty('pd_push_' + rowIndex);
}

// New-Deal token cache: bridges the window where a deal is created BEFORE the
// RUN_LOG row exists (so the numeric-col-D anchor isn't available yet). Keyed by a
// stable run token (outputDocId|group) — a retry adopts the cached deal id instead
// of creating a second deal. Cleared on success.
function pdNewDealCacheGet_(token) {
  var raw = PropertiesService.getScriptProperties().getProperty('pd_new_' + token);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}
function pdNewDealCacheSet_(token, obj) {
  PropertiesService.getScriptProperties().setProperty('pd_new_' + token, JSON.stringify(obj || {}));
}
function pdNewDealCacheMerge_(token, patch) {
  var cur = pdNewDealCacheGet_(token);
  Object.keys(patch || {}).forEach(function(k) { cur[k] = patch[k]; });
  pdNewDealCacheSet_(token, cur);
}
function pdNewDealCacheClear_(token) {
  PropertiesService.getScriptProperties().deleteProperty('pd_new_' + token);
}

/**
 * Client-callable. Pushes a FINALIZED run (one RUN_LOG row) to Pipedrive:
 * create a new deal or link an existing one, attach per-type products, set
 * mapped deal fields. Idempotent — the deal ID is written to RUN_LOG col D the
 * instant PD returns it, so a retry never creates a duplicate (a numeric col D
 * is treated as an already-created deal); product/field steps resume.
 *
 * @param {string} dealerKey
 * @param {number} runRowIndex    1-based RUN_LOG row
 * @param {string} mode           'create' | 'link'
 * @param {string} existingDealId required when mode === 'link'
 * @return {Object} {ok, stage, dealId, productsAttached, fieldsSet, message, retryable}
 */
function pushRunToPipedrive(dealerKey, runRowIndex, mode, existingDealId) {
  try {
    if (!getPipedriveStatus().configured) {
      return { ok: false, stage: 'config', message: 'Pipedrive is not configured. Set it up in Dealer Rules → Pipedrive.', retryable: false };
    }
    var logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
    if (!logSheet || runRowIndex < 2 || runRowIndex > logSheet.getLastRow()) {
      return { ok: false, stage: 'gate', message: 'Run not found — finalize the run first.', retryable: false };
    }
    var row = logSheet.getRange(runRowIndex, 1, 1, 23).getValues()[0];
    if (String(row[1]).trim() !== dealerKey) {
      return { ok: false, stage: 'gate', message: 'Run does not belong to this dealer.', retryable: false };
    }
    var existingColD = String(row[3]).trim();   // D: order_id / deal id
    var outputDocId  = String(row[17]).trim();  // R: output_doc_id
    var note         = String(row[20]).trim();  // U: notes
    var group        = (note.indexOf('SPLIT:') === 0) ? note.substring(6).toUpperCase() : 'PRIMARY';

    // finalizeRun always writes a deal id to col D — a blank means never finalized.
    if (!existingColD) {
      return { ok: false, stage: 'gate', message: 'This run has no Deal ID yet — finalize it before pushing.', retryable: false };
    }

    var ctx = pdResolveRunContext_(dealerKey, group, outputDocId);
    if (!ctx.ok) return ctx;
    var pdCfg = ctx.pdCfg, currency = ctx.currency, lineItems = ctx.lineItems;

    var state  = pdPushStateGet_(runRowIndex);
    var dealId = state.dealId || '';

    // Preempt deactivated products BEFORE creating/linking a deal (skipped once
    // products are attached — a field-only retry).
    if (!state.productsDone) {
      var blocked = pdCheckInactiveProducts_(lineItems, dealerKey, group);
      if (blocked) return blocked;
    }

    // Dup guard: a numeric col D = a real PD deal already exists for this run
    // (we wrote it post-create, or it was pre-created) — never create a second.
    if (!dealId && mode === 'create' && /^\d+$/.test(existingColD)) {
      dealId = existingColD;
      state.dealId = dealId;
      pdPushStateSet_(runRowIndex, state);
    }

    // Resolve the deal; write col D the instant we have an id.
    if (!dealId) {
      var rd = pdResolveDealId_(mode, existingDealId, pdCfg, currency,
                 { lineItems: lineItems, group: group, dealerName: row[2] || dealerKey, secrets: ctx.secrets });
      if (!rd.ok) return rd;
      dealId = rd.dealId;
      state.dealId = dealId;
      pdPushStateSet_(runRowIndex, state);
      logSheet.getRange(runRowIndex, 4).setValue(dealId);  // D — idempotency anchor
      SpreadsheetApp.flush();
    }

    var applied = pdApplyDealContents_(dealId, lineItems, pdCfg, currency, state,
                    function(s) { pdPushStateSet_(runRowIndex, s); }, (mode === 'create'),
                    { outputDocId: outputDocId, group: group, dealerName: row[2] || dealerKey });
    if (!applied.ok) return applied;

    pdPushStateClear_(runRowIndex);
    return {
      ok: true, stage: 'done', dealId: dealId,
      productsAttached: lineItems.length, fieldsSet: applied.fieldsSet,
      billingPdfPending: applied.billingPdfPending,
      message: (mode === 'link' ? 'Linked to deal ' : 'Created deal ') + dealId +
               ' (' + lineItems.length + ' product line' + (lineItems.length === 1 ? '' : 's') + ').' +
               (applied.billingPdfPending ? ' (billing PDF will attach on a re-push)' : '')
    };
  } catch (e) {
    return { ok: false, stage: 'error', message: 'Unexpected error: ' + e.message, retryable: true };
  }
}

// ── Push helpers (shared by pushRunToPipedrive + the finalize orchestrators) ──

/**
 * Read-only: resolves a run's Pipedrive context — config/org gate, currency, and
 * the deal line items (incl. source_split per-source). No deal creation, no col-D
 * write. Returns {ok, pdCfg, currency, secrets, lineItems} or a failure shape.
 */
function pdResolveRunContext_(dealerKey, group, outputDocId) {
  var pdCfg = getPipedriveDealerConfig_(dealerKey, group);
  if (!pdCfg)       return { ok: false, stage: 'config', message: 'No active Pipedrive config for ' + dealerKey + ' / ' + group + '.', retryable: false };
  if (!pdCfg.orgId) return { ok: false, stage: 'config', message: 'No organization set for ' + dealerKey + ' / ' + group + '.', retryable: false };

  var secrets  = pdGetSecrets_();
  var currency = pdCfg.currency || (secrets && secrets.currency) || 'USD';

  if (!outputDocId) return { ok: false, stage: 'resolve', message: 'Run has no output document on record.', retryable: false };
  var outputDoc;
  try { outputDoc = SpreadsheetApp.openById(outputDocId); }
  catch (e) { return { ok: false, stage: 'resolve', message: 'Could not open the run output doc: ' + e.message, retryable: false }; }
  var sheetName = (group === 'PRIMARY') ? 'BILLING' : ('BILLING_' + group);
  var billing   = readBillingTotals_(outputDoc, sheetName);
  var products  = pdListProducts_();

  // Source split (dual-site): the secondary output (e.g. AUTOLOANPRO) maps to its OWN
  // products as extra line items on the SAME deal. Active only once a secondary product
  // map is configured — until then the run pushes normally (main map × all vehicles), so
  // enabling source_split never silently drops the secondary cars before they're mapped.
  var dealerCfg   = getDealerConfig_(dealerKey);
  var sourceSplit = dealerCfg ? getSourceSplit_(dealerCfg) : null;
  var secMap      = (sourceSplit && pdCfg.sourceProductMap) ? (pdCfg.sourceProductMap[sourceSplit.groupName] || {}) : {};
  var useSourceSplit = !!(sourceSplit && Object.keys(secMap).length);

  // Fetch variations for every product (main + secondary) that pins a variation_id.
  var variationsByProduct = {};
  [pdCfg.productMap, (useSourceSplit ? secMap : null)].forEach(function(map) {
    if (!map) return;
    Object.keys(map).forEach(function(type) {
      var e = map[type];
      if (e && typeof e === 'object' && e.product_id && e.variation_id && !variationsByProduct[String(e.product_id)]) {
        variationsByProduct[String(e.product_id)] = pdListProductVariations_(e.product_id);
      }
    });
  });

  var lineItems;
  if (useSourceSplit) {
    var bySource  = readBillingBySource_(outputDoc, sheetName);
    var mainItems = buildLineItems_(bySourceToBilling_(bySource['Main Site']), pdCfg.productMap, products, currency, variationsByProduct);
    var secItems  = buildLineItems_(bySourceToBilling_(bySource[sourceSplit.groupName]), secMap, products, currency, variationsByProduct);
    lineItems = mergeLineItems_(mainItems.concat(secItems));
  } else {
    lineItems = buildLineItems_(billing, pdCfg.productMap, products, currency, variationsByProduct);
  }

  return { ok: true, pdCfg: pdCfg, currency: currency, secrets: secrets, lineItems: lineItems };
}

/** Returns the inactive_product failure if any line item's product is deactivated, else null. */
function pdCheckInactiveProducts_(lineItems, dealerKey, group) {
  var blockedItems = (lineItems || []).filter(function(li) { return li.inactive; });
  if (!blockedItems.length) return null;
  var blockedNames = blockedItems.map(function(li) {
    return (li.name || ('Product #' + li.product_id)) + ' (#' + li.product_id + ')';
  }).join(', ');
  return { ok: false, stage: 'inactive_product', retryable: false,
           message: 'Cannot push — ' + blockedNames + (blockedItems.length === 1 ? ' is' : ' are') +
                    ' deactivated in Pipedrive and can\'t be added to a deal. Update the product ' +
                    'mapping for ' + dealerKey + ' / ' + group + ' in Dealer Rules → Pipedrive ' +
                    '(choose an active product), then push again.' };
}

/**
 * Creates a new deal (mode 'create') or validates an existing one (mode 'link').
 * Returns {ok, dealId} or a failure shape. Does NOT persist anything — the caller
 * owns the col-D write / RUN_LOG row. ctx = {lineItems, group, dealerName, secrets}.
 */
function pdResolveDealId_(mode, existingDealId, pdCfg, currency, ctx) {
  ctx = ctx || {};
  if (mode === 'link') {
    var idToLink = String(existingDealId || '').trim();
    if (!idToLink) return { ok: false, stage: 'deal', message: 'Enter the existing Deal ID to link.', retryable: false };
    var got = pdGetDeal_(idToLink);
    if (!got.ok) return { ok: false, stage: 'deal', message: 'Could not find deal ' + idToLink + ' in Pipedrive: ' + got.error, retryable: true };
    return { ok: true, dealId: idToLink };
  }
  var secrets = ctx.secrets || pdGetSecrets_();
  var title = buildDealTitle_(pdCfg.titleTemplate, {
    dealerName: pdCfg.orgName || ctx.dealerName || '',
    date:       Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd'),
    group:      ctx.group,
    count:      (ctx.lineItems || []).reduce(function(s, li) { return s + li.quantity; }, 0)
  });
  var dealParams = { title: title, org_id: Number(pdCfg.orgId) };
  var pipeline = pdCfg.pipelineId || (secrets && secrets.pipeline);
  var stage    = pdCfg.stageId    || (secrets && secrets.stage);
  if (pipeline) dealParams.pipeline_id = Number(pipeline);
  if (stage)    dealParams.stage_id    = Number(stage);
  if (currency) dealParams.currency    = currency;
  var created = pdCreateDeal_(dealParams);
  if (!created.ok) return { ok: false, stage: 'deal', message: 'Deal creation failed: ' + created.error, retryable: true };
  return { ok: true, dealId: created.dealId };
}

/**
 * Attaches the line-item products and sets the mapped deal fields on `dealId`,
 * idempotently via `state` (productsDone/fieldsDone). `persist(state)` is invoked
 * after each step flips so a retry resumes. Returns {ok, fieldsSet} or a failure
 * shape (carrying dealId) for the products/fields stage.
 */
function pdApplyDealContents_(dealId, lineItems, pdCfg, currency, state, persist, isNewDeal, runCtx) {
  if (!state.productsDone) {
    var att = pdAttachProducts_(dealId, lineItems);
    if (!att.ok) {
      return { ok: false, stage: 'products', dealId: dealId, retryable: true,
               message: 'Deal ' + dealId + ' is set, but attaching products failed: ' + att.error + ' — retry to finish.' };
    }
    state.productsDone = true;
    persist(state);
  }
  // v1 deals API takes custom fields as TOP-LEVEL keys (40-char hashes), not nested
  // under a custom_fields object (v2). pdResolveDealFields_ returns a flat {key:value}
  // map (incl. the `<key>_currency` companion for monetary fields) — pass it directly.
  var fieldsSet = 0;
  if (!state.fieldsDone) {
    var rules = getPipedriveGlobalRules_();
    // For a LINK (existing deal) with a constant if_empty rule, read the deal's current
    // fields once so an already-set value (e.g. a required Proof) is never overwritten.
    // New deals are treated as empty (no read). Fetch failure → null → if_empty rules skip.
    var existingDealFields = null;
    if (!isNewDeal && pdHasIfEmptyConstant_(rules, pdCfg.fieldOverrides)) {
      var dg = pdGetDeal_(dealId);
      existingDealFields = dg.ok ? dg.deal : null;
    }
    var custom = pdResolveDealFields_(pdCfg.orgId, rules, pdCfg.fieldOverrides, currency, !!isNewDeal, existingDealFields);
    var ckeys = Object.keys(custom);
    if (ckeys.length) {
      var upd = pdUpdateDeal_(dealId, custom);
      if (!upd.ok) {
        return { ok: false, stage: 'fields', dealId: dealId, retryable: true,
                 message: 'Deal ' + dealId + ' built, but setting deal fields failed: ' + upd.error + ' — retry to finish.' };
      }
      fieldsSet = ckeys.length;
    }
    state.fieldsDone = true;
    persist(state);
  }

  // ── Install line item — add/update per the org's Program Install Cost option. Idempotent. ──
  if (!state.installDone) {
    var ic = pdApplyInstallCost_(dealId, pdCfg);
    if (!ic.ok) {
      return { ok: false, stage: 'install', dealId: dealId, retryable: true,
               message: 'Deal ' + dealId + ' built, but the install line item failed: ' + ic.error + ' — retry to finish.' };
    }
    state.installDone = true;
    persist(state);
  }

  // ── Design no-charge variation — set on the auto-added Design line if its variation is
  //    empty (template-request deals keep their charged Design). Best-effort (polls). ──
  var designPending = false;
  if (!state.designDone) {
    var dv = pdApplyDesignVariation_(dealId);
    if (!dv.ok) {
      return { ok: false, stage: 'design', dealId: dealId, retryable: true,
               message: 'Deal ' + dealId + ' built, but the design variation failed: ' + dv.error + ' — retry to finish.' };
    }
    if (dv.designPending) { designPending = true; }   // automation hadn't fired — a re-push will set it
    else { state.designDone = true; persist(state); }
  }

  // ── Billing PDF — generate a formatted PDF of the run's billing sheet and attach it to the
  //    deal. Best-effort / non-fatal: a failure flags billingPdfPending (a re-push retries);
  //    idempotent (skips if a billing PDF is already on the deal). Never fails the push. ──
  var billingPdfPending = false;
  if (!state.billingPdfDone && runCtx && runCtx.outputDocId) {
    try {
      var bp = attachBillingPdfToDeal_(dealId, runCtx.outputDocId, runCtx.group || 'PRIMARY',
                 { dealerName: runCtx.dealerName || pdCfg.orgName || '' });
      if (bp.ok) { state.billingPdfDone = true; persist(state); }
      else { billingPdfPending = true; Logger.log('billing PDF attach failed: ' + bp.error); }
    } catch (e) { billingPdfPending = true; Logger.log('billing PDF attach threw: ' + e.message); }
  }

  return { ok: true, fieldsSet: fieldsSet, designPending: designPending, billingPdfPending: billingPdfPending };
}

/**
 * Client-callable. "New Deal" finalize: creates a brand-new Pipedrive deal, then
 * finalizes the run with that real deal id (so no RUN_LOG row ever holds a
 * placeholder), then attaches products + sets fields. Retry-safe across the reorder
 * via a token cache (pd_new_<outputDocId|group>): a created deal id is cached the
 * instant PD returns it, so a failure before/after finalize never makes a 2nd deal.
 * The deactivated-product preempt runs BEFORE any deal is created.
 */
function finalizeRunNewDeal(dealerKey, entry) {
  try {
    if (!entry || !entry.billing) return { ok: false, stage: 'gate', message: 'Invalid run entry payload.', retryable: false };
    if (!getPipedriveStatus().configured) {
      return { ok: false, stage: 'config', message: 'Pipedrive is not configured. Set it up in Dealer Rules → Pipedrive.', retryable: false };
    }
    var note        = String(entry.note || '');
    var group       = (note.indexOf('SPLIT:') === 0) ? note.substring(6).toUpperCase() : 'PRIMARY';
    var outputDocId = String(entry.outputDocId || '').trim();

    var ctx = pdResolveRunContext_(dealerKey, group, outputDocId);
    if (!ctx.ok) return ctx;

    var blocked = pdCheckInactiveProducts_(ctx.lineItems, dealerKey, group);
    if (blocked) return blocked;   // nothing created or logged

    var token = outputDocId + '|' + group;
    var cache = pdNewDealCacheGet_(token);
    var dealId = cache.dealId || '';
    if (!dealId) {
      var config = getDealerConfig_(dealerKey);
      var rd = pdResolveDealId_('create', null, ctx.pdCfg, ctx.currency,
                 { lineItems: ctx.lineItems, group: group, dealerName: (config && config[CFG.NAME]) || dealerKey, secrets: ctx.secrets });
      if (!rd.ok) return rd;
      dealId = rd.dealId;
      pdNewDealCacheSet_(token, { dealId: dealId });   // cache immediately — retry adopts, never re-creates
    }

    var rowIndex = cache.rowIndex || 0;
    if (!rowIndex) {
      var fin = finalizeRun(dealerKey, entry, dealId);   // real numeric id → invariant holds
      rowIndex = fin.rowIndex;
      pdNewDealCacheMerge_(token, { rowIndex: rowIndex });
      pdPushStateSet_(rowIndex, { dealId: dealId, productsDone: false, fieldsDone: false });
    }

    var state = pdPushStateGet_(rowIndex);
    if (!state.dealId) state.dealId = dealId;
    var applied = pdApplyDealContents_(dealId, ctx.lineItems, ctx.pdCfg, ctx.currency, state,
                    function(s) { pdPushStateSet_(rowIndex, s); pdNewDealCacheMerge_(token, { rowIndex: rowIndex }); }, true,
                    { outputDocId: outputDocId, group: group, dealerName: ctx.pdCfg.orgName || dealerKey });
    if (!applied.ok) { applied.rowIndex = rowIndex; applied.dealId = dealId; return applied; }

    pdPushStateClear_(rowIndex);
    pdNewDealCacheClear_(token);
    return {
      ok: true, stage: 'done', dealId: dealId, rowIndex: rowIndex,
      productsAttached: ctx.lineItems.length, fieldsSet: applied.fieldsSet,
      billingPdfPending: applied.billingPdfPending,
      vinCount: (entry.producedVins || []).length,
      message: 'Created deal ' + dealId + ' (' + ctx.lineItems.length + ' product line' +
               (ctx.lineItems.length === 1 ? '' : 's') + ').' +
               (applied.billingPdfPending ? ' (billing PDF will attach on a re-push)' : '')
    };
  } catch (e) {
    return { ok: false, stage: 'error', message: 'Unexpected error: ' + e.message, retryable: true };
  }
}

/**
 * Client-callable. "Existing" finalize: validates the supplied deal id exists FIRST
 * (so no RUN_LOG row is written for a bad id), finalizes the run with it, then links
 * the run's products to that deal via pushRunToPipedrive('link'). Returns the push
 * result with rowIndex attached (so the card stays committable + retryable).
 */
function finalizeRunExisting(dealerKey, entry, existingDealId) {
  try {
    var id = String(existingDealId || '').trim();
    if (!id) return { ok: false, stage: 'gate', message: 'Enter the existing Deal ID to link.', retryable: false };
    if (!entry || !entry.billing) return { ok: false, stage: 'gate', message: 'Invalid run entry payload.', retryable: false };
    if (!getPipedriveStatus().configured) {
      return { ok: false, stage: 'config', message: 'Pipedrive is not configured. Set it up in Dealer Rules → Pipedrive.', retryable: false };
    }
    var got = pdGetDeal_(id);
    if (!got.ok) return { ok: false, stage: 'deal', message: 'Could not find deal ' + id + ' in Pipedrive: ' + got.error, retryable: true };

    var fin = finalizeRun(dealerKey, entry, id);   // col D = id
    var res = pushRunToPipedrive(dealerKey, fin.rowIndex, 'link', id);
    res.rowIndex = fin.rowIndex;
    if (res.ok) res.vinCount = (entry.producedVins || []).length;
    return res;
  } catch (e) {
    return { ok: false, stage: 'error', message: 'Unexpected error: ' + e.message, retryable: true };
  }
}

/**
 * Client-callable. Which finalize methods a run card should offer for a dealer/group.
 * Test is always available; New Deal + Existing require an active Pipedrive org config.
 * @return {Object} {test, newDeal, existing, reason}
 */
function getRunPushModes(dealerKey, group) {
  var modes = { test: true, newDeal: false, existing: false, reason: '' };
  try {
    if (!getPipedriveStatus().configured) { modes.reason = 'Pipedrive is not connected.'; return modes; }
    var cfg = getPipedriveDealerConfig_(dealerKey, group || 'PRIMARY');
    if (!cfg)       { modes.reason = 'No Pipedrive config for this dealer/group.'; return modes; }
    if (!cfg.orgId) { modes.reason = 'No Pipedrive organization set for this dealer/group.'; return modes; }
    modes.newDeal = true; modes.existing = true;
  } catch (e) { modes.reason = 'Pipedrive check failed: ' + e.message; }
  return modes;
}


// ── Billing PDF: generate a formatted PDF of the run's BILLING sheet + attach to the deal ──
//
// A best-effort, idempotent supplement to the push. The working BILLING sheet
// (renderBillingSheet_) is left untouched — this READS it, lays the data out fresh in a
// temp tab with full formatting, exports that tab to PDF, deletes the temp tab, and
// attaches the PDF to the Pipedrive deal. A failure never fails the push (the deal +
// products + fields are the critical parts); it flags billingPdfPending and a re-push
// retries (the GET /files dup check keeps it to one per deal).

var BILLING_PDF_TMP_TAB = '_BILLING_PDF';

/** Filesystem-safe, DATE-FREE billing PDF filename for a deal/group (so idempotency matches). */
function billingPdfFilename_(dealerName, group) {
  var clean = String(dealerName || 'Order').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  var name = 'Billing - ' + (clean || 'Order');
  if (group && group !== 'PRIMARY') name += ' (' + group + ')';
  return name + '.pdf';
}

/**
 * Parses an already-rendered BILLING / BILLING_<group> sheet into a structured object.
 * Mirrors renderBillingSheet_'s layout: section markers in col B; values col C; the
 * not-found list col D; the duplicate-detail table at col F (Year/Make/Model/Stock/VIN/
 * URL/Prior Orders); produced VINs one-per-row in col B under the PRODUCED VINS header.
 * @return {Object|null} {summary, byType, bySource, duplicates, dupDetail, producedVins, producedCount}
 */
function readBillingForPdf_(outputDoc, sheetName) {
  var sheet = outputDoc.getSheetByName(sheetName || 'BILLING');
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;
  var vals = sheet.getRange(1, 1, lastRow, 12).getValues();   // A–L

  var data = {
    summary:      { ordered: '', matched: '', notFoundCount: '', notFoundList: '' },
    byType:       [],
    bySource:     [],
    duplicates:   { byType: [], total: '' },
    dupDetail:    { hasRows: false, rows: [] },
    producedVins: [],
    producedCount: 0
  };

  var section = '';
  for (var r = 0; r < vals.length; r++) {
    var b = String(vals[r][1] == null ? '' : vals[r][1]).trim();   // col B
    var c = vals[r][2];                                            // col C
    var d = vals[r][3];                                            // col D
    if (b.indexOf('──') === 0) {
      // Check DUPLICATES before BY TYPE — "── DUPLICATES BY TYPE ──" contains "BY TYPE".
      if      (b.indexOf('ORDER SUMMARY')      !== -1) section = 'summary';
      else if (b.indexOf('DUPLICATES')         !== -1) section = 'dupes';
      else if (b.indexOf('BY SOURCE')          !== -1) section = 'bysource';
      else if (b.indexOf('BY TYPE')            !== -1) section = 'bytype';
      else if (b.indexOf('PRODUCED VINS')      !== -1) {
        section = 'vins';
        var m = b.match(/\((\d+)\)/); data.producedCount = m ? Number(m[1]) : 0;
      } else section = '';
      continue;
    }
    if (!b) continue;   // blank spacer
    if (section === 'summary') {
      if      (b === 'Total Ordered')            data.summary.ordered = c;
      else if (b === 'Total Matched in Scraper') data.summary.matched = c;
      else if (b === 'Not Found in Scraper')   { data.summary.notFoundCount = c; data.summary.notFoundList = String(d == null ? '' : d); }
    } else if (section === 'bytype') {
      if (b.indexOf('Total Matched (check)') !== 0) data.byType.push({ label: b, count: c });
    } else if (section === 'bysource') {
      data.bySource.push({ label: b, count: c });
    } else if (section === 'dupes') {
      if (b === 'Total Duplicates') data.duplicates.total = c;
      else data.duplicates.byType.push({ label: b, count: c });
    } else if (section === 'vins') {
      if (b !== 'No vehicles produced.') data.producedVins.push(b);
    }
  }

  // Duplicate-detail table at col F (index 5): a marker row, then either a 'Year…' header
  // + detail rows, or 'No duplicates in this order.'. URL (col K) is dropped for the PDF.
  for (var r2 = 0; r2 < vals.length; r2++) {
    var f = String(vals[r2][5] == null ? '' : vals[r2][5]).trim();
    if (!f || f.indexOf('── DUPLICATE DETAIL') !== -1 || f === 'Year') continue;
    if (f.indexOf('No duplicates') !== -1) break;
    data.dupDetail.hasRows = true;
    data.dupDetail.rows.push([
      String(vals[r2][5]  == null ? '' : vals[r2][5]),    // Year  (F)
      String(vals[r2][6]  == null ? '' : vals[r2][6]),    // Make  (G)
      String(vals[r2][7]  == null ? '' : vals[r2][7]),    // Model (H)
      String(vals[r2][8]  == null ? '' : vals[r2][8]),    // Stock (I)
      String(vals[r2][9]  == null ? '' : vals[r2][9]),    // VIN   (J)
      String(vals[r2][11] == null ? '' : vals[r2][11])    // Prior Order #s (L)
    ]);
  }
  return data;
}

/**
 * Lays produced VINs out column-major into a grid `cols` wide: fill the first column
 * top-to-bottom to a generous height (≥ MIN_PER_COL) before wrapping into the next column —
 * there's ample vertical space, so prefer tall columns over many short ones. Column height
 * grows past the minimum only when there are more than MIN_PER_COL × cols VINs (which caps
 * the grid at `cols` columns for page width). Returns a 2D array (gridHeight × cols).
 */
function billingVinGrid_(vins, cols) {
  var MIN_PER_COL = 15;
  var n = vins.length;
  if (n === 0) return [];
  var perCol  = Math.max(MIN_PER_COL, Math.ceil(n / cols));   // column height
  var numCols = Math.ceil(n / perCol);
  var gridH   = (numCols >= 2) ? perCol : n;                  // single column: exactly n rows, no trailing blanks
  var grid = [];
  for (var rr = 0; rr < gridH; rr++) {
    var line = [];
    for (var cc = 0; cc < cols; cc++) {
      var idx = cc * perCol + rr;   // column-major: fill col 0 fully, then col 1, …
      line.push(idx < n ? vins[idx] : '');
    }
    grid.push(line);
  }
  return grid;
}

/**
 * Builds a polished, formatted layout of the billing data in a temp tab and returns it.
 * Vertical sections (summary, by-type, by-source, duplicates + detail, produced VINs);
 * the produced VINs are laid out in a compact column-major multi-column grid (fill the
 * first column top-to-bottom, then wrap into the next column). Backgrounds/fonts/borders
 * are applied as batched matrices (runs once per push). Caller exports + deletes it.
 */
function buildBillingPdfTab_(outputDoc, data, meta) {
  var existing = outputDoc.getSheetByName(BILLING_PDF_TMP_TAB);
  if (existing) outputDoc.deleteSheet(existing);
  var sheet = outputDoc.insertSheet(BILLING_PDF_TMP_TAB);

  var W = 6;
  var NAVY = '#1f3864', SECT = '#305496', SUBH = '#d9e1f2', BAND = '#eef3fb',
      WHITE = '#ffffff', GREY = '#595959', INK = '#1b1b1b', LINE = '#8ea9db';

  var values = [], bgs = [], colors = [], weights = [], sizes = [];
  var mergeRows = [], rightCells = [], borderBlocks = [];

  function row(cells, st) {
    st = st || {};
    var v = cells.slice(); while (v.length < W) v.push('');
    var bg = st.bg || WHITE, fc = st.fc || INK, fw = st.fw || 'normal', fs = st.fs || 10;
    values.push(v);
    var br = [], cr = [], wr = [], sr = [];
    for (var i = 0; i < W; i++) { br.push(bg); cr.push(fc); wr.push(fw); sr.push(fs); }
    bgs.push(br); colors.push(cr); weights.push(wr); sizes.push(sr);
    return values.length;   // 1-based row number
  }
  function blank() { return row(['']); }
  function section(title) { var r = row([title], { bg: SECT, fc: WHITE, fw: 'bold', fs: 11 }); mergeRows.push(r); return r; }
  function subHeader(c1, c2) { var v = ['', '', '', '', '', '']; v[0] = c1; v[W - 1] = c2; return row(v, { bg: SUBH, fw: 'bold', fs: 10 }); }
  function countRow(label, count, idx) {
    var r = row([label, '', '', '', '', count], { bg: (idx % 2 === 0 ? WHITE : BAND), fs: 10 });
    rightCells.push({ row: r, col: W });
    return r;
  }

  // ── Title + subtitle ──
  var rTitle = row(['BILLING SUMMARY'], { bg: NAVY, fc: WHITE, fw: 'bold', fs: 18 }); mergeRows.push(rTitle);
  var sub = [];
  if (meta && meta.dealerName) sub.push(meta.dealerName);
  if (meta && meta.dealId)     sub.push('Deal #' + meta.dealId);
  if (meta && meta.group && meta.group !== 'PRIMARY') sub.push(meta.group);
  sub.push(Utilities.formatDate(new Date(), 'America/Chicago', 'MMMM d, yyyy'));
  var rSub = row([sub.join('   •   ')], { fc: GREY, fs: 10 }); mergeRows.push(rSub);
  blank();

  // ── Order Summary ──
  section('ORDER SUMMARY');
  var sumStart = values.length + 1;
  var sumPairs = [['Total Ordered', data.summary.ordered], ['Total Matched', data.summary.matched], ['Not Found', data.summary.notFoundCount]];
  sumPairs.forEach(function(p, i) { var r = row([p[0], p[1]], { bg: (i % 2 === 0 ? WHITE : BAND), fs: 10 }); weights[r - 1][0] = 'bold'; });
  if (data.summary.notFoundList && data.summary.notFoundList !== '—' && data.summary.notFoundList !== '') {
    var rn = row(['Not Found VINs', data.summary.notFoundList], { bg: BAND, fs: 9 }); weights[rn - 1][0] = 'bold';
  }
  borderBlocks.push({ top: sumStart, bottom: values.length });
  blank();

  // ── By Type (gross) ──
  section('BY TYPE (GROSS)');
  var bth = subHeader('Type', 'Quantity');
  data.byType.forEach(function(t, i) { countRow(t.label, t.count, i); });
  borderBlocks.push({ top: bth, bottom: values.length });
  blank();

  // ── By Source (source_split only) ──
  if (data.bySource && data.bySource.length) {
    section('BY SOURCE (QTY PER SKU)');
    var bsh = subHeader('Source — Type', 'Quantity');
    data.bySource.forEach(function(t, i) { countRow(t.label, t.count, i); });
    borderBlocks.push({ top: bsh, bottom: values.length });
    blank();
  }

  // ── Duplicates by type ──
  section('DUPLICATES BY TYPE');
  var dh = subHeader('Type', 'Duplicates');
  data.duplicates.byType.forEach(function(t, i) { countRow(t.label, t.count, i); });
  var rTot = countRow('Total Duplicates', data.duplicates.total, data.duplicates.byType.length);
  weights[rTot - 1][0] = 'bold'; weights[rTot - 1][W - 1] = 'bold';
  borderBlocks.push({ top: dh, bottom: values.length });
  blank();

  // ── Duplicate detail (only when there are dupes) ──
  if (data.dupDetail.hasRows && data.dupDetail.rows.length) {
    section('DUPLICATE DETAIL');
    var ddh = row(['Year', 'Make', 'Model', 'Stock', 'VIN', 'Prior Orders'], { bg: SUBH, fw: 'bold', fs: 9 });
    data.dupDetail.rows.forEach(function(rw, i) { row(rw, { bg: (i % 2 === 0 ? WHITE : BAND), fs: 9 }); });
    borderBlocks.push({ top: ddh, bottom: values.length });
    blank();
  }

  // ── Produced VINs — compact column-major multi-column grid ──
  section('PRODUCED VINS (' + data.producedCount + ')');
  var vins = data.producedVins || [];
  if (!vins.length) {
    row(['No vehicles produced.'], { fs: 10 });
  } else {
    // Banded only (no outer border) so a narrow grid of full columns doesn't draw a
    // wide mostly-empty box; the alternating row shading carries the structure.
    billingVinGrid_(vins, W).forEach(function(line, rr) {
      row(line, { bg: (rr % 2 === 0 ? WHITE : BAND), fs: 9 });
    });
  }

  // ── Apply (batched) ──
  var n = values.length;
  var rng = sheet.getRange(1, 1, n, W);
  rng.setValues(values);
  rng.setBackgrounds(bgs);
  rng.setFontColors(colors);
  rng.setFontWeights(weights);
  rng.setFontSizes(sizes);
  rng.setFontFamily('Arial');
  rng.setVerticalAlignment('middle');

  mergeRows.forEach(function(r) { sheet.getRange(r, 1, 1, W).merge(); });
  sheet.getRange(rTitle, 1, 1, W).setHorizontalAlignment('center');
  sheet.getRange(rSub,   1, 1, W).setHorizontalAlignment('center');
  sheet.setRowHeight(rTitle, 34);
  rightCells.forEach(function(rc) { sheet.getRange(rc.row, rc.col).setHorizontalAlignment('right'); });
  borderBlocks.forEach(function(b) {
    sheet.getRange(b.top, 1, b.bottom - b.top + 1, W)
         .setBorder(true, true, true, true, false, false, LINE, SpreadsheetApp.BorderStyle.SOLID);
  });

  sheet.setColumnWidth(1, 160);
  for (var col = 2; col <= W; col++) sheet.setColumnWidth(col, 108);

  SpreadsheetApp.flush();
  return sheet;
}

/** Exports one sheet (by gid) of a spreadsheet to a PDF Blob. Returns {ok, blob} or {ok:false, error}. */
function exportSheetPdf_(spreadsheetId, gid) {
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?' + [
    'format=pdf', 'gid=' + gid,
    'portrait=true', 'fitw=true', 'size=letter',
    'gridlines=false', 'sheetnames=false', 'printtitle=false', 'pagenumbers=false', 'fzr=false',
    'top_margin=0.40', 'bottom_margin=0.40', 'left_margin=0.40', 'right_margin=0.40'
  ].join('&');
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  } catch (e) { return { ok: false, error: 'export fetch: ' + e.message }; }
  if (resp.getResponseCode() !== 200) return { ok: false, error: 'export HTTP ' + resp.getResponseCode() };
  return { ok: true, blob: resp.getBlob() };
}

/**
 * Opens the run output doc, reads the billing sheet, builds the formatted temp tab,
 * exports it to PDF, deletes the temp tab, and returns {ok, blob, filename}.
 * The temp tab is always removed (even on export failure).
 */
function generateBillingPdf_(outputDocId, sheetName, meta) {
  var doc;
  try { doc = SpreadsheetApp.openById(outputDocId); }
  catch (e) { return { ok: false, error: 'open output doc: ' + e.message }; }
  var data = readBillingForPdf_(doc, sheetName);
  if (!data) return { ok: false, error: 'billing sheet "' + sheetName + '" not found' };

  var filename = (meta && meta.filename) || billingPdfFilename_(meta && meta.dealerName, meta && meta.group);
  var sheet = null;
  try {
    sheet = buildBillingPdfTab_(doc, data, meta);
    SpreadsheetApp.flush();
    var exp = exportSheetPdf_(outputDocId, sheet.getSheetId());
    try { doc.deleteSheet(sheet); } catch (e2) {}
    if (!exp.ok) return { ok: false, error: exp.error };
    return { ok: true, blob: exp.blob.setName(filename), filename: filename };
  } catch (e) {
    if (sheet) { try { doc.deleteSheet(sheet); } catch (e3) {} }
    return { ok: false, error: 'build/export: ' + e.message };
  }
}

/** True if a billing PDF (by filename) is already attached to the deal. Best-effort (false on error). */
function pdDealHasBillingPdf_(dealId, filename) {
  try {
    var res = pdFetch_('get', '/files?deal_id=' + encodeURIComponent(dealId));
    if (!res.ok || !res.data || !res.data.length) return false;
    for (var i = 0; i < res.data.length; i++) {
      var n = String(res.data[i].name || res.data[i].clean_name || '');
      if (n === filename) return true;
    }
    return false;
  } catch (e) { return false; }
}

/**
 * Uploads a PDF Blob to Pipedrive and associates it with the deal (POST /files,
 * multipart/form-data — GAS auto-builds the body from a Blob payload field; pdFetch_
 * is JSON-only so this is a raw fetch). Returns {ok} or {ok:false, error}.
 */
function pdAttachFileToDeal_(dealId, blob, filename) {
  try {
    var s = pdGetSecrets_();
    if (!s) return { ok: false, error: 'Pipedrive is not configured' };
    var url = s.baseV1 + '/files?api_token=' + encodeURIComponent(s.token);
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: { deal_id: String(dealId), file: blob.setName(filename) },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true };
    return { ok: false, error: 'files HTTP ' + code + ': ' + String(resp.getContentText() || '').slice(0, 200) };
  } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * Generates the billing PDF for a run and attaches it to the deal. Idempotent — skips if a
 * billing PDF (same filename) is already on the deal. Returns {ok} | {ok, skipped} | {ok:false, error}.
 */
function attachBillingPdfToDeal_(dealId, outputDocId, group, meta) {
  var sheetName = (group === 'PRIMARY') ? 'BILLING' : ('BILLING_' + group);
  var filename  = billingPdfFilename_(meta && meta.dealerName, group);
  if (pdDealHasBillingPdf_(dealId, filename)) return { ok: true, skipped: true };
  var gen = generateBillingPdf_(outputDocId, sheetName, {
    dealerName: (meta && meta.dealerName) || '', dealId: dealId, group: group, filename: filename
  });
  if (!gen.ok) return { ok: false, error: gen.error };
  var att = pdAttachFileToDeal_(dealId, gen.blob, gen.filename);
  return att.ok ? { ok: true } : { ok: false, error: att.error };
}

// ============================================================================
// END OF SCRIPT
// ============================================================================