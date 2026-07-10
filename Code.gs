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
// Per-execution cache for the resolved field-code → ORDERMATCH-column map
// (constant FIELD_TO_COL overlaid with the FIELD_CODES `ordermatch_col` config).
// Reset to null by the field-code CRUD writers so a save is reflected immediately.
var _fieldToCol_ = null;

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
  var uiPrefs_ = getUiPrefs();
  t.initialNavLayout = uiPrefs_.navLayout;             // 'sidebar' | 'icons' | 'top-rail' | 'bottom-rail' | 'start-menu'
  t.appMode = 'modal';                     // vs 'webapp' (doGet); App.html hides the Close item in webapp
  var html = t.evaluate()
    .setWidth(MODAL_WIDTH)
    .setHeight(MODAL_HEIGHT);
  SpreadsheetApp.getUi().showModalDialog(html, 'SilverFox');
}

/**
 * Web App entry — serves the SilverFox App full-screen in a browser tab at the
 * deployment's /exec URL (no modal, full viewport). Mirrors openApp's template
 * setup, so it reuses App.html + every view + google.script.run UNCHANGED.
 * Additive: the menu/modal (openApp) still works. Deployed as a Web App,
 * "execute as user accessing" — see appsscript.json "webapp". Each user runs as
 * themselves, so getUserProperties (theme, last-user) and getActiveSpreadsheet
 * (the bound SF_SYSTEM_MASTER) resolve per-person, as in the modal.
 */
function doGet(e) {
  var t = HtmlService.createTemplateFromFile('App');
  t.initialTheme = getThemePreference();
  var uiPrefs_ = getUiPrefs();
  t.initialNavLayout = uiPrefs_.navLayout;             // 'sidebar' | 'icons' | 'top-rail' | 'bottom-rail' | 'start-menu'
  t.appMode = 'webapp';
  return t.evaluate()
    .setTitle('SilverFox')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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

// getDashboardView (whole-DASHBOARD-grid read for the old Home renderer) was
// retired when Home became a HUD (Section 34 endpoints); the DASHBOARD sheet
// itself remains — refreshDashboard_ still writes it (human-viewable in Sheets,
// and getInventorySnapshot slices its inventory block for the Import view).

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

/**
 * Pure: projects SCRAPERDATA rows → a VIN-keyed map of the 7 display fields.
 * Skips rows with a blank/`*` VIN. Keys are upper-cased + trimmed VINs.
 */
function buildVinDataMap_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var vin = String(r[0] == null ? '' : r[0]).trim();
    if (vin === '' || vin === '*') continue;
    map[vin.toUpperCase()] = {
      year:   String(r[3]  == null ? '' : r[3]).trim(),
      make:   String(r[4]  == null ? '' : r[4]).trim(),
      model:  String(r[5]  == null ? '' : r[5]).trim(),
      type:   String(r[2]  == null ? '' : r[2]).trim(),
      stock:  String(r[1]  == null ? '' : r[1]).trim(),
      status: String(r[8]  == null ? '' : r[8]).trim(),
      url:    String(r[20] == null ? '' : r[20]).trim()
    };
  }
  return map;
}

/**
 * Client-callable. Returns the selected dealer's inventory as a VIN→data map
 * for the Run Order live table. Fail-safe: returns {} on any error / unknown
 * dealer (the table then shows entered VINs as "not found" rather than break).
 */
function getDealerVinData(dealerKey) {
  try {
    var config = getDealerConfig_(dealerKey);
    if (!config) return {};
    var loc = config[CFG.SCRAPER_LOCATION];
    if (!loc) return {};
    var rows = getDealerScraperData_(loc) || [];
    return buildVinDataMap_(rows);
  } catch (e) {
    Logger.log('getDealerVinData failed for ' + dealerKey + ': ' + e.message);
    return {};
  }
}

/**
 * Client-callable. Returns a preview of SCRAPERDATA for the Import screen's
 * "Current Data" table — filtered by optional locationFilter and typeFilter,
 * capped at 500 rows. Also returns the full sorted list of locations and types
 * present in the data (unfiltered) for populating the filter dropdowns.
 */
function getScraperDataPreview(locationFilter, typeFilter) {
  // Max rows returned to the client. SCRAPERDATA is the COMBINED all-dealer feed
  // (10k+ rows), so this caps the unfiltered "All Locations" view for payload/render
  // safety; a single dealer (≤ ~1000 vehicles) is never truncated by it.
  var CAP = 3000;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('SCRAPERDATA');
    if (!sheet) return { rows: [], totalCount: 0, cappedAt: CAP, locations: [], types: [] };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { rows: [], totalCount: 0, cappedAt: CAP, locations: [], types: [] };
    var data = sheet.getRange(2, 1, lastRow - 1, 21).getValues();
    var locSet = {}, typeSet = {}, filtered = [];
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var loc  = String(r[19] == null ? '' : r[19]).trim();
      var type = String(r[2]  == null ? '' : r[2]).trim();
      if (loc  && loc  !== '*') locSet[loc]   = true;
      if (type && type !== '*') typeSet[type]  = true;
      if (locationFilter && loc  !== locationFilter) continue;
      if (typeFilter     && type !== typeFilter)     continue;
      filtered.push(r);
    }
    return {
      rows: filtered.slice(0, CAP).map(function(r) {
        return {
          vin:      String(r[0]  == null ? '' : r[0]).trim(),
          stock:    String(r[1]  == null ? '' : r[1]).trim(),
          type:     String(r[2]  == null ? '' : r[2]).trim(),
          year:     String(r[3]  == null ? '' : r[3]).trim(),
          make:     String(r[4]  == null ? '' : r[4]).trim(),
          model:    String(r[5]  == null ? '' : r[5]).trim(),
          trim:     String(r[6]  == null ? '' : r[6]).trim(),
          status:   String(r[8]  == null ? '' : r[8]).trim(),
          price:    String(r[9]  == null ? '' : r[9]).trim(),
          location: String(r[19] == null ? '' : r[19]).trim(),
          url:      String(r[20] == null ? '' : r[20]).trim()
        };
      }),
      totalCount: filtered.length,
      cappedAt:   CAP,
      locations:  Object.keys(locSet).sort(),
      types:      Object.keys(typeSet).sort()
    };
  } catch (e) {
    Logger.log('getScraperDataPreview failed: ' + e.message);
    return { rows: [], totalCount: 0, cappedAt: CAP, locations: [], types: [] };
  }
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
        byType: {},
        onlot: 0, offlot: 0, other_status: 0, no_price: 0, no_stock: 0
      };
    }
    var loc = locationDetail[location];
    loc.total++;

    // Type buckets — the canonical four feed the fixed IMPORT_STATS columns; the dynamic
    // per-type tally (keyed by the actual type) feeds the live dashboard's per-type columns.
    if      (type === 'New')    loc.new++;
    else if (type === 'PO')     loc.po++;
    else if (type === 'CPO')    loc.cpo++;
    else if (type === 'CPO-EL') loc.cpo_el++;
    else                        loc.other_types++;
    if (type !== '' && type !== '*') loc.byType[type] = (loc.byType[type] || 0) + 1;

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

// Name of the optional config column (in the FIELD_CODES tab of SF_DEALER_CONFIG)
// that maps a field code to its 1-based ORDERMATCH column. Matched case-insensitively.
var FIELD_CODES_TAB        = 'FIELD_CODES';
var FIELD_CODE_COL_HEADER  = 'ordermatch_col';

/**
 * Parses a value that may be a 1-based column NUMBER (e.g. 22) or an A1 column
 * LETTER string (e.g. "V" / "v") into a 1-based integer in 1..100. Returns null for
 * anything blank, non-numeric/non-letter, or out of range. Pure helper — reused by
 * getFieldToCol_() (reading the config) and saveFieldCodeMapping (validating input).
 */
function normalizeOrderMatchCol_(input) {
  if (input === null || input === undefined) return null;
  var s = String(input).trim();
  if (s === '') return null;

  // All-letters → base-26 A1 column (A=1, Z=26, AA=27, …).
  if (/^[A-Za-z]+$/.test(s)) {
    var up = s.toUpperCase(), n = 0;
    for (var i = 0; i < up.length; i++) {
      n = n * 26 + (up.charCodeAt(i) - 64);  // 'A'.charCodeAt = 65
    }
    return (n >= 1 && n <= 100) ? n : null;
  }

  // Otherwise treat as a number (rejecting non-integers like "3.5" or "1a").
  if (!/^[0-9]+$/.test(s)) return null;
  var num = parseInt(s, 10);
  if (isNaN(num) || num < 1 || num > 100) return null;
  return num;
}

/**
 * Resolves the effective field-code → ORDERMATCH-column map: the hard-coded
 * FIELD_TO_COL constant (the protected fallback FLOOR) overlaid with any
 * `ordermatch_col` overrides/additions from the FIELD_CODES config tab.
 *
 * This is the config-driven replacement for reading FIELD_TO_COL directly (mirrors
 * how getFilterFieldIndex_ replaced the static FILTER_FIELD_INDEX). It is FAIL-SAFE:
 * the whole config read is wrapped so it can NEVER throw into a run — on any error it
 * returns the constant clone. With no FIELD_CODES tab, no `ordermatch_col` header, or
 * an empty column, the result equals FIELD_TO_COL EXACTLY (byte-identical behavior).
 * Cached per execution; reset by the field-code CRUD writers.
 */
function getFieldToCol_() {
  if (_fieldToCol_) return _fieldToCol_;

  // Clone the constant — the guaranteed floor.
  var map = {};
  for (var k in FIELD_TO_COL) {
    if (FIELD_TO_COL.hasOwnProperty(k)) map[k] = FIELD_TO_COL[k];
  }

  try {
    var sheet = getConfigSS_().getSheetByName(FIELD_CODES_TAB);
    if (sheet && sheet.getLastRow() >= 2) {
      var data = sheet.getDataRange().getValues();
      var header = data[0] || [];

      // Find the ordermatch_col header (case-insensitive, trimmed).
      var colIdx = -1;
      for (var h = 0; h < header.length; h++) {
        if (String(header[h]).trim().toLowerCase() === FIELD_CODE_COL_HEADER) { colIdx = h; break; }
      }

      // No such header → leave the constant untouched (inert config).
      if (colIdx !== -1) {
        for (var r = 1; r < data.length; r++) {
          var fieldCode = String(data[r][0]).trim();   // col A = field_code
          if (!fieldCode) continue;
          var num = normalizeOrderMatchCol_(data[r][colIdx]);
          if (num !== null) map[fieldCode] = num;       // overlay (override or add)
          // blank/invalid ordermatch_col cells are ignored — existing doc rows stay inert
        }
      }
    }
  } catch (e) {
    Logger.log('getFieldToCol_ config read failed (using FIELD_TO_COL constant): ' + e.message);
  }

  _fieldToCol_ = map;
  return map;
}

/**
 * Ensures the FIELD_CODES tab has an `ordermatch_col` header, appending it as a new
 * header in the next empty cell of row 1 if missing. Returns its 1-based column index.
 * Used by the field-code save/delete writers.
 */
function ensureFieldCodesOrderMatchColumn_() {
  var ss    = getConfigSS_();
  var sheet = ss.getSheetByName(FIELD_CODES_TAB);
  if (!sheet) {
    // The tab already exists in production, but create-if-missing keeps the CRUD safe.
    sheet = ss.insertSheet(FIELD_CODES_TAB);
    sheet.getRange(1, 1, 1, 1).setValues([['field_code']]);
    sheet.setFrozenRows(1);
  }

  var lastCol = sheet.getLastColumn();
  var header  = lastCol >= 1 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  for (var i = 0; i < header.length; i++) {
    if (String(header[i]).trim().toLowerCase() === FIELD_CODE_COL_HEADER) return i + 1;
  }

  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(FIELD_CODE_COL_HEADER);
  return newCol;
}

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
  var fieldToCol = getFieldToCol_();  // FIELD_TO_COL constant overlaid with FIELD_CODES config

  // Renders one CSV sheet from a set of ORDERMATCH rows + a SCHEMA key.
  function writeGroup_(schemaKey, rows, sheetName) {
    var fieldCodes = getCsvSchema_(schemaKey) || getCsvSchema_('SCP');
    var dataRows = rows.map(function(row) {
      return fieldCodes.map(function(code) {
        var col = fieldToCol[code];
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

  // Also append per-type rows to ORDER_TYPE_STATS — long-format, one row per type present
  // in this run (gross or dupes > 0). Lets the dashboard + reports break a run down by ANY
  // type (incl. user-added ones) without touching the fixed RUN_LOG / ORDER_STATS schemas.
  try {
    var byType = (billing && billing.byType) || {};
    var typeRows = [];
    Object.keys(byType).forEach(function(t) {
      var gross = Number(byType[t].gross) || 0;
      var dupes = Number(byType[t].dupes) || 0;
      if (gross > 0 || dupes > 0) {
        typeRows.push([timestamp, config[CFG.KEY], config[CFG.NAME], dealId || '', t, gross, dupes]);
      }
    });
    if (typeRows.length) {
      var otsSheet = ss.getSheetByName('ORDER_TYPE_STATS') || createOrderTypeStatsSheet_(ss);
      if (otsSheet) otsSheet.getRange(otsSheet.getLastRow() + 1, 1, typeRows.length, 7).setValues(typeRows);
    }
  } catch (e) {
    Logger.log('writeRunLog_: ORDER_TYPE_STATS append failed (non-fatal): ' + e.message);
  }

  return sheet.getLastRow();
}

/** Creates the ORDER_TYPE_STATS tab (long-format per-type run history) with its header row. */
function createOrderTypeStatsSheet_(ss) {
  try {
    var sh = ss.insertSheet('ORDER_TYPE_STATS');
    sh.getRange(1, 1, 1, 7).setValues([['timestamp', 'dealer_key', 'dealer_name', 'order_id', 'type', 'produced', 'dupes']]);
    sh.setFrozenRows(1);
    return sh;
  } catch (e) {
    Logger.log('createOrderTypeStatsSheet_ failed (non-fatal): ' + e.message);
    return ss.getSheetByName('ORDER_TYPE_STATS');   // a concurrent create may have won the race
  }
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
// SECTION 20b: FIELD CODE → ORDERMATCH COLUMN MANAGER
// ============================================================================
//
// Config-driven CRUD over the field-code → ORDERMATCH-column mapping. The hard-coded
// FIELD_TO_COL constant is the protected floor; the FIELD_CODES tab's `ordermatch_col`
// column overlays it (override an existing code's column, or add a brand-new code).
// getFieldToCol_() resolves the effective map (fail-safe); these functions edit the
// config and reset the cache. A frontend "Field Codes" view calls these by these
// exact names — do not rename them or change their return shapes.

// Classic fallback: serves the converted App fragment standalone.
function openFieldCodes() {
  openViewStandalone_('ViewFieldCodes', 'Field Codes');
}

// Converts a 1-based column number to its A1 letter (1 -> 'A', 27 -> 'AA').
function colNumberToLetter_(num) {
  var n = num, s = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Reads the FIELD_CODES tab into {byCode, descByCode} where byCode maps a trimmed
 * field_code (col A) to its parsed ordermatch_col (or null) and descByCode to its
 * description (col B). Returns nulls/empties safely if the tab/column is absent.
 */
function readFieldCodesConfig_() {
  var out = { byCode: {}, descByCode: {} };
  var sheet = getConfigSS_().getSheetByName(FIELD_CODES_TAB);
  if (!sheet || sheet.getLastRow() < 2) return out;

  var data   = sheet.getDataRange().getValues();
  var header = data[0] || [];
  var colIdx = -1;
  for (var h = 0; h < header.length; h++) {
    if (String(header[h]).trim().toLowerCase() === FIELD_CODE_COL_HEADER) { colIdx = h; break; }
  }
  for (var r = 1; r < data.length; r++) {
    var code = String(data[r][0]).trim();
    if (!code) continue;
    out.descByCode[code] = String(data[r][1] || '').trim();
    out.byCode[code]     = (colIdx !== -1) ? normalizeOrderMatchCol_(data[r][colIdx]) : null;
  }
  return out;
}

/**
 * Returns the EFFECTIVE merged field-code mapping list for the Field Codes screen.
 *   { rows: [{fieldCode, col, colLetter, description, source}], builtinCount }
 * source ∈ 'builtin' (constant only), 'override' (constant + config column),
 * 'config' (config only — not in the constant). Sorted by col asc, then fieldCode.
 */
function getFieldCodeMappings() {
  var cfg     = readFieldCodesConfig_();
  var effective = getFieldToCol_();   // constant overlaid with config (fail-safe)

  var rows = [];
  for (var code in effective) {
    if (!effective.hasOwnProperty(code)) continue;
    var isBuiltin   = FIELD_TO_COL.hasOwnProperty(code);
    var hasConfigCol = (cfg.byCode[code] !== undefined && cfg.byCode[code] !== null);
    var source = isBuiltin ? (hasConfigCol ? 'override' : 'builtin') : 'config';
    var col = effective[code];
    rows.push({
      fieldCode:   code,
      col:         col,
      colLetter:   colNumberToLetter_(col),
      description: cfg.descByCode[code] || '',
      source:      source
    });
  }

  rows.sort(function(a, b) {
    if (a.col !== b.col) return a.col - b.col;
    return a.fieldCode < b.fieldCode ? -1 : (a.fieldCode > b.fieldCode ? 1 : 0);
  });

  var builtinCount = 0;
  for (var k in FIELD_TO_COL) { if (FIELD_TO_COL.hasOwnProperty(k)) builtinCount++; }

  return { rows: rows, builtinCount: builtinCount };
}

/**
 * Upserts a field-code → ORDERMATCH-column mapping into the FIELD_CODES config tab.
 * Validates the code (@/letters/digits/underscore) and the column (1..100, number or
 * A1 letter). Writes the column (and an optional description) into the row matching
 * field_code in col A — creating the row if absent. Resets the cache and returns the
 * refreshed mapping list. Throws a clear Error on invalid input.
 */
function saveFieldCodeMapping(fieldCode, colInput, description) {
  fieldCode = String(fieldCode == null ? '' : fieldCode).trim();
  if (!fieldCode) throw new Error('Field code is required.');
  if (!/^[@A-Za-z0-9_]+$/.test(fieldCode)) {
    throw new Error('Field code "' + fieldCode + '" is invalid — use only @, letters, digits, and underscores.');
  }

  var col = normalizeOrderMatchCol_(colInput);
  if (col === null) {
    throw new Error('ORDERMATCH column "' + colInput + '" is invalid — enter a number 1–100 or a column letter (A–CV).');
  }

  description = String(description == null ? '' : description).trim();

  var colNum = ensureFieldCodesOrderMatchColumn_();
  var sheet  = getConfigSS_().getSheetByName(FIELD_CODES_TAB);
  var data   = sheet.getDataRange().getValues();

  // Find an existing row by exact field_code match (col A).
  var foundRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === fieldCode) { foundRow = i + 1; break; }
  }

  if (foundRow !== -1) {
    sheet.getRange(foundRow, colNum).setValue(col);
    if (description) sheet.getRange(foundRow, 2).setValue(description);  // col B = description
  } else {
    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1).setValue(fieldCode);              // col A
    if (description) sheet.getRange(newRow, 2).setValue(description);  // col B
    sheet.getRange(newRow, colNum).setValue(col);              // ordermatch_col
  }

  _fieldToCol_ = null;  // invalidate cache so the next resolve reflects the save
  return getFieldCodeMappings();
}

/**
 * "Deletes" a field-code mapping. For a constant builtin this only clears the config
 * override (the code reverts to its FIELD_TO_COL value — a builtin can never be removed
 * from the resolved map). For a config-only code, clears the ordermatch_col cell and
 * removes the whole row if it carries no other meaningful data. Resets the cache and
 * returns the refreshed mapping list.
 */
function deleteFieldCodeMapping(fieldCode) {
  fieldCode = String(fieldCode == null ? '' : fieldCode).trim();
  if (!fieldCode) throw new Error('Field code is required.');

  var sheet = getConfigSS_().getSheetByName(FIELD_CODES_TAB);
  if (sheet && sheet.getLastRow() >= 2) {
    var data   = sheet.getDataRange().getValues();
    var header = data[0] || [];
    var colIdx = -1;
    for (var h = 0; h < header.length; h++) {
      if (String(header[h]).trim().toLowerCase() === FIELD_CODE_COL_HEADER) { colIdx = h; break; }
    }

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]).trim() !== fieldCode) continue;

      var isBuiltin = FIELD_TO_COL.hasOwnProperty(fieldCode);

      // Determine whether the row has any meaningful data OTHER than the field_code
      // (col A) and the ordermatch_col cell — if not, a config-only row can be removed.
      var hasOther = false;
      for (var c = 1; c < data[r].length; c++) {      // skip col A
        if (c === colIdx) continue;                   // skip ordermatch_col
        if (String(data[r][c]).trim() !== '') { hasOther = true; break; }
      }

      if (colIdx !== -1) sheet.getRange(r + 1, colIdx + 1).clearContent();

      if (!isBuiltin && !hasOther) {
        sheet.deleteRow(r + 1);  // config-only row with nothing else → drop it
      }
      break;
    }
  }

  _fieldToCol_ = null;  // invalidate cache
  return getFieldCodeMappings();
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
  // Empty/absent dealerKey = ALL dealers (the VIN Logs page's default view).
  var wantAll = !dealerKey;
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 23).getValues();
  var runs = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!wantAll && String(row[1]).trim() !== dealerKey) continue;

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
      dealerKey:    String(row[1]).trim(),   // per-row identity — the All-Dealers
      dealerName:   String(row[2]).trim(),   // table mixes dealers, actions need it
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
 * Theme slug shape — the trust boundary for what we persist. The client registry
 * (SharedUtils `Theme.themes`) is the real source of valid ids; a well-formed but
 * unregistered id is harmless (the client falls back to Light at apply time).
 * @param {*} t
 * @returns {boolean}
 */
function isThemeSlug_(t) {
  return typeof t === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(t);
}

/**
 * Returns the saved app theme id for this Google account, or '' if unset
 * ('' = no explicit choice yet → the client's head script follows the OS).
 * @returns {string}
 */
function getThemePreference() {
  var t = PropertiesService.getUserProperties().getProperty('app_theme');
  // Retired themes (deleted July 2026) — remap to preserve light/dark intent.
  if (t === 'top-rail') t = 'light';
  if (t === 'top-rail-dark') t = 'dark';
  return isThemeSlug_(t) ? t : '';
}

/**
 * Persists the app theme choice. Accepts any well-formed theme slug (fail-safe).
 * @param {string} theme
 */
function saveThemePreference(theme) {
  if (isThemeSlug_(theme)) {
    PropertiesService.getUserProperties().setProperty('app_theme', theme);
  }
}

// Allowed nav layouts — the trust boundary for ui_nav_layout (mirrors isThemeSlug_'s spirit).
var UI_NAV_LAYOUTS_ = ['sidebar', 'icons', 'top-rail', 'bottom-rail', 'start-menu'];

/**
 * Per-user UI preferences the frontend layers on top of the theme.
 * Fail-safe: an unrecognized stored nav layout (incl. the retired 'auto')
 * falls back to 'sidebar'.
 * @returns {{navLayout: string}}
 */
function getUiPrefs() {
  var nav = PropertiesService.getUserProperties().getProperty('ui_nav_layout');
  return {
    navLayout: UI_NAV_LAYOUTS_.indexOf(nav) !== -1 ? nav : 'sidebar'
  };
}

/**
 * Persists one UI preference. Ignores anything off-shape (fail-safe, like
 * saveThemePreference). Client-callable; both args are strings.
 * @param {string} key   'nav_layout'
 * @param {string} value
 */
function saveUiPref(key, value) {
  if (key === 'nav_layout' && UI_NAV_LAYOUTS_.indexOf(value) !== -1) {
    PropertiesService.getUserProperties().setProperty('ui_nav_layout', value);
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

    // Registry-driven inventory columns (built-ins + user-added). INV_W = Location + one
    // column per type + Other + Total + ONLOT + OFFLOT + No-Price/No-Stock.
    var TYPES = getCanonicalVehicleTypes_();
    var INV_W = TYPES.length + 6;
    var BANNER_W = Math.max(INV_W, 10);   // full-width section bars

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
    // RUNS BY TYPE — fixed height (one row per registered type) so RUNS BY DEALER (a
    // spilling QUERY) can still sit last.
    var R_RBT_HDR    = R_MR_HDR  + 4;
    var R_RBT_COLS   = R_RBT_HDR + 1;
    var R_RBT_DATA   = R_RBT_HDR + 2;
    var R_RBD_HDR    = R_RBT_DATA + Math.max(TYPES.length, 1) + 1;
    var R_RBD_COLS   = R_RBD_HDR + 1;
    var R_RBD_DATA   = R_RBD_HDR + 2;

    // ── Clear everything from data start downward ────────────────────────────
    var clearRows = DASHBOARD_MAX_LOCATIONS + 50;   // headroom for the added RUNS BY TYPE block + the spilling RUNS BY DEALER query
    var clearCols = 26;   // generous — covers the dynamic inventory width + any prior, wider layout
    dashboard.getRange(R_DATA_START, 1, clearRows, clearCols).clearContent();
    dashboard.getRange(R_DATA_START, 1, clearRows, clearCols).clearFormat();

    // ── Write timestamp ──────────────────────────────────────────────────────
    dashboard.getRange(R_TIMESTAMP, 2).setValue(importTimestamp);

    // ── Write column headers (one column per registered type) ────────────────
    var invHeader = ['Location'].concat(TYPES, ['Other', 'Total', 'ONLOT', 'OFFLOT', 'No Price / No Stock']);
    dashboard.getRange(R_COL_HDR, 1, 1, INV_W).setValues([invHeader]);

    // ── Write location data rows ─────────────────────────────────────────────
    // Per registered type from the dynamic byType tally; "Other" = vehicles whose type isn't registered.
    var dataRows = locations.map(function(loc) {
      var d = locationDetail[loc], bt = d.byType || {}, typed = 0;
      var row = [loc];
      TYPES.forEach(function(t) { var c = bt[t] || 0; typed += c; row.push(c); });
      row.push(Math.max(d.total - typed, 0), d.total, d.onlot, d.offlot, d.no_price + ' / ' + d.no_stock);
      return row;
    });
    if (n > 0) dashboard.getRange(R_DATA_START, 1, n, INV_W).setValues(dataRows);

    // ── Compute and write totals ─────────────────────────────────────────────
    var totByType = {}; TYPES.forEach(function(t) { totByType[t] = 0; });
    var totOther = 0, totTotal = 0, totOnlot = 0, totOfflot = 0;
    locations.forEach(function(loc) {
      var d = locationDetail[loc], bt = d.byType || {}, typed = 0;
      TYPES.forEach(function(t) { var c = bt[t] || 0; totByType[t] += c; typed += c; });
      totOther += Math.max(d.total - typed, 0);
      totTotal += d.total; totOnlot += d.onlot; totOfflot += d.offlot;
    });
    var totalsRow = ['TOTALS'].concat(TYPES.map(function(t) { return totByType[t]; }),
                                      [totOther, totTotal, totOnlot, totOfflot, '']);
    dashboard.getRange(R_TOTALS, 1, 1, INV_W).setValues([totalsRow]);

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

    // RUNS BY TYPE — one row per registered type, summed from ORDER_TYPE_STATS (IFERROR so a
    // not-yet-created tab shows zeros). The criterion references the type cell (col A) so a
    // label containing a quote can't break the formula.
    dashboard.getRange(R_RBT_HDR, 1).setValue('RUNS BY TYPE');
    dashboard.getRange(R_RBT_COLS, 1, 1, 4).setValues([['Type', 'Runs', 'VINs Produced', 'Dupes']]);
    if (TYPES.length) {
      dashboard.getRange(R_RBT_DATA, 1, TYPES.length, 1).setValues(TYPES.map(function(t) { return [t]; }));
      dashboard.getRange(R_RBT_DATA, 2, TYPES.length, 3).setFormulas(TYPES.map(function(t, i) {
        var r = R_RBT_DATA + i;
        return [
          '=IFERROR(COUNTIF(ORDER_TYPE_STATS!E:E,A' + r + '),0)',
          '=IFERROR(SUMIF(ORDER_TYPE_STATS!E:E,A' + r + ',ORDER_TYPE_STATS!F:F),0)',
          '=IFERROR(SUMIF(ORDER_TYPE_STATS!E:E,A' + r + ',ORDER_TYPE_STATS!G:G),0)'
        ];
      }));
    }

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
    var invHdrRange = dashboard.getRange(R_INV_HDR, 1, 1, BANNER_W);
    invHdrRange.setBackgroundObject(C_ORANGE).setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);

    // Column headers
    var colHdrRange = dashboard.getRange(R_COL_HDR, 1, 1, INV_W);
    colHdrRange.setBackgroundObject(C_ORANGE2).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)
               .setHorizontalAlignment('center');
    dashboard.getRange(R_COL_HDR, 1).setHorizontalAlignment('left');

    // Data rows — alternating stripes, numbers centered, location left (block-formatted).
    if (n > 0) {
      var bgMatrix = [];
      for (var i = 0; i < n; i++) {
        var rowBg = (i % 2 === 0) ? C_WHITE : C_STRIPE;
        var bgRow = [];
        for (var bc = 0; bc < INV_W; bc++) bgRow.push(rowBg);
        bgMatrix.push(bgRow);
      }
      dashboard.getRange(R_DATA_START, 1, n, INV_W)
        .setBackgroundObjects(bgMatrix).setFontSize(10)
        .setHorizontalAlignment('center').setNumberFormat('#,##0');
      dashboard.getRange(R_DATA_START, 1, n, 1)
        .setHorizontalAlignment('left').setNumberFormat('@');
      dashboard.getRange(R_DATA_START, INV_W, n, 1)
        .setHorizontalAlignment('center').setNumberFormat('@');
    }

    // Totals row
    var totRange = dashboard.getRange(R_TOTALS, 1, 1, INV_W);
    totRange.setBackgroundObject(C_DARK).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)
            .setHorizontalAlignment('center').setNumberFormat('#,##0');
    dashboard.getRange(R_TOTALS, 1).setHorizontalAlignment('left');

    // Section banners (full table width) — Run Log Summary, Most Recent, Runs By Type, Runs By Dealer
    dashboard.getRange(R_RL_HDR, 1, 1, BANNER_W).setBackgroundObject(C_DGRAY).setFontColor('#ffffff')
             .setFontWeight('bold').setFontSize(11);
    [R_MR_HDR, R_RBT_HDR, R_RBD_HDR].forEach(function(r) {
      dashboard.getRange(r, 1, 1, BANNER_W).setBackgroundObject(C_DGRAY).setFontColor('#ffffff')
               .setFontWeight('bold').setFontSize(10);
    });

    // Section column headers
    [R_RL_COLS, R_MR_COLS, R_RBT_COLS, R_RBD_COLS].forEach(function(r) {
      dashboard.getRange(r, 1, 1, BANNER_W).setBackgroundObject(C_ORANGE2).setFontColor('#ffffff')
               .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
      dashboard.getRange(r, 1).setHorizontalAlignment('left');
    });

    // Run Log KPI data row
    dashboard.getRange(R_RL_DATA, 1, 1, BANNER_W).setBackgroundObject(C_STRIPE).setFontWeight('bold')
             .setFontSize(11).setHorizontalAlignment('center').setNumberFormat('#,##0.#');

    // Most Recent Run data row
    dashboard.getRange(R_MR_DATA, 1, 1, BANNER_W).setBackgroundObject(C_STRIPE).setFontSize(10)
             .setHorizontalAlignment('center');
    dashboard.getRange(R_MR_DATA, 1).setHorizontalAlignment('left');

    // Runs By Type data rows — type left, the three formula columns centered
    if (TYPES.length) {
      dashboard.getRange(R_RBT_DATA, 1, TYPES.length, 4).setBackgroundObject(C_STRIPE)
               .setFontSize(10).setHorizontalAlignment('center').setNumberFormat('#,##0');
      dashboard.getRange(R_RBT_DATA, 1, TYPES.length, 1).setHorizontalAlignment('left').setNumberFormat('@');
    }

    // Column widths + frozen rows — only set on first layout (kept in sync with INV_W).
    if (dashboard.getFrozenRows() !== R_COL_HDR) {
      dashboard.setColumnWidth(1, 260);
      for (var c = 2; c < INV_W; c++) dashboard.setColumnWidth(c, 76);
      dashboard.setColumnWidth(INV_W, 130);
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
               tax: Number(p.tax) || 0,
               inactive: (p.selectable === false || p.active_flag === false) };
    });
  }
  // Fetch via v2 with custom_fields — v2 reliably returns the custom-field value
  // (under custom_fields[<key>]); for an Organization field that value is the org id.
  return pdListAllV2_('/products?custom_fields=' + encodeURIComponent(orgFieldKey)).map(function(p) {
    var out = { id: p.id, name: p.name, code: p.code || '', prices: p.prices || [],
                tax: Number(p.tax) || 0,
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

/** Client-callable: the current vehicle-type list (built-ins + user-added). */
function getVehicleTypes() { return getCanonicalVehicleTypes_(); }

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
  // Reserved billing-sheet labels — a type named one of these (or ending in " Dupes")
  // would collide with readBillingTotals_'s row parsing.
  var reserved = ['total ordered', 'total matched in scraper', 'total matched (check)', 'total duplicates'];
  if (reserved.indexOf(clean.toLowerCase()) !== -1 || /\sdupes$/i.test(clean)) {
    throw new Error('"' + clean + '" is a reserved label — choose a different type name.');
  }
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

/** True if a parsed filtering_rules object references `targetLower` in any type field —
 *  allowed_types / cao_exclude_types / seasoning[].type / billing_split(field:type) /
 *  targeting_rules conditions (recursing nested AND/OR groups for a {field:"type"} leaf). */
function filterRulesUseType_(fr, targetLower) {
  function hasIn(arr) {
    return Array.isArray(arr) && arr.some(function(v) { return String(v).trim().toLowerCase() === targetLower; });
  }
  if (hasIn(fr.allowed_types) || hasIn(fr.cao_exclude_types)) return true;
  if (Array.isArray(fr.seasoning) && fr.seasoning.some(function(s) {
    return s && String(s.type).trim().toLowerCase() === targetLower;
  })) return true;
  // billing_split with field "type"
  var bs = fr.billing_split;
  if (bs && String(bs.field).trim().toLowerCase() === 'type' && hasIn(bs.values)) return true;
  // targeting_rules — recurse the AND/OR groups for a {field:"type"} leaf referencing the type
  function groupUsesType(group) {
    if (!group || !Array.isArray(group.children)) return false;
    return group.children.some(function(child) {
      if (child && Array.isArray(child.children)) return groupUsesType(child);                     // nested group
      return child && String(child.field).trim().toLowerCase() === 'type' && hasIn(child.values);  // leaf condition
    });
  }
  return Array.isArray(fr.targeting_rules) && fr.targeting_rules.some(function(rule) {
    return rule && groupUsesType(rule.group);
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
    domain:          status.domain,                  // so the "Connected to <domain>" label resolves (was showing "(unknown domain)")
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
 * distinct lines. Returns [{product_id, quantity, item_price, name, tax,
 * product_variation_id?}] — tax = the product's catalog "Tax %" (sent exclusive on attach).
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
                 tax: prod ? (Number(prod.tax) || 0) : 0,   // product's catalog "Tax %" — applied exclusive on attach
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
      agg[key] = { product_id: li.product_id, quantity: 0, item_price: li.item_price, name: li.name,
                   tax: Number(li.tax) || 0, inactive: !!li.inactive };
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
    var body = { product_id: Number(li.product_id), item_price: Number(li.item_price) || 0, quantity: Number(li.quantity) || 0,
                 tax: Number(li.tax) || 0, tax_method: 'exclusive' };   // mirror a manual add: product's catalog Tax %, exclusive
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
  var b = { product_id: Number(item.product_id), item_price: Number(item.item_price) || 0, quantity: Number(item.quantity) || 1,
            tax: Number(item.tax) || 0, tax_method: item.tax_method || 'exclusive' };
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
// SECTION 32: VIN INBOX — lot-scanner submissions (read / process)
// ----------------------------------------------------------------------------
// The standalone Lot Scanner app (a SEPARATE Apps Script project) writes one row
// per photographed VIN to the shared SF_LOT_SUBMISSIONS sheet + a Drive photos
// folder. This section is the office-side inbox the ViewVinInbox view reads:
// review/correct the OCR'd VIN, mark processed/discarded, and copy a dealer's
// confirmed VINs into Run Order. Connection is by ID only — no shared runtime.
// ============================================================================

// Paste the SF_LOT_SUBMISSIONS id logged by the scanner's setupLotScannerResources().
var LOT_SUBMISSIONS_SHEET_ID = '1zs-Ycj64LTwIYJt84kC_-qY_EhsWgB1Pa5pQlsG-N1M';
var LOT_SUBMISSIONS_TAB = 'SUBMISSIONS';
// 0-based column map — MUST match the scanner's LOT_SUBMISSION_COLS order.
var LOT_SUB = {
  ID: 0, TS: 1, EMAIL: 2, DEALER_KEY: 3, DEALER_NAME: 4, PHOTO_ID: 5, PHOTO_URL: 6,
  VIN_EXTRACTED: 7, VIN_FINAL: 8, VALID: 9, MATCHED: 10,
  YEAR: 11, MAKE: 12, MODEL: 13, TYPE: 14, STOCK: 15, STATUS: 16, PROCESSED_TS: 17, PROCESSED_BY: 18, NOTES: 19,
  BATCH_ID: 20, OCR_STATE: 21
};
// Human lifecycle: draft (field still owns) | submitted (field-sent / real-time) | processed | discarded.
var LOT_SUB_STATUSES = ['draft', 'submitted', 'processed', 'discarded'];

function getLotSubmissionsSheet_() {
  if (!LOT_SUBMISSIONS_SHEET_ID) return null;
  return SpreadsheetApp.openById(LOT_SUBMISSIONS_SHEET_ID).getSheetByName(LOT_SUBMISSIONS_TAB);
}

// Best-effort trash of a submission's Drive photo. Deliberately swallows errors:
// a crew-owned My-Drive file can't be trashed by the office user (only the owner
// can), so a failure here surfaces a role/membership mistake instead of failing
// the discard. No new OAuth scope — DriveApp is already used in this file.
function trashLotPhoto_(fileId) {
  if (!fileId) return false;
  try { DriveApp.getFileById(String(fileId)).setTrashed(true); return true; }
  catch (e) { Logger.log('trashLotPhoto_ ' + fileId + ': ' + e.message); return false; }
}

// ── VIN validation (ISO 3779) — re-validates a corrected VIN in the inbox ──
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
// OCR (office-side manual runner) — COPIED from the standalone Lot Scanner's
// lot-scan/Code.gs (that project's per-user drainOcrQueue trigger stalled in the
// field: batches sent to the office before OCR drained sat at ocr_state='queued'
// forever). The scanner still uploads/batches/sends and does client-side barcode
// (ZXing) matching; anything without a barcode lands here queued for the office
// to OCR on demand via runInboxOcr. Logic below is byte-faithful to the scanner
// version except: isValidVin_ is NOT duplicated (already defined above), and the
// vinMap fallback reuses this file's getDealerConfig_ / getDealerScraperData_ /
// buildVinDataMap_ (the same trio updateVinSubmissionStatus's correction path
// uses below) instead of the scanner's own getDealerVinMap.
// ============================================================================

// Bidirectional OCR-confusion map within the VIN-legal charset (bounded common
// pairs). ponytail: the check digit filters false hits, so a small set suffices.
var VIN_CONFUSE = {
  '0': ['D', '8'], 'D': ['0'], '8': ['B', '0'], 'B': ['8'],
  '5': ['S'], 'S': ['5'], '2': ['Z'], 'Z': ['2'],
  '6': ['G'], 'G': ['6'], '1': ['7'], '7': ['1', 'T'], 'T': ['7'],
  '4': ['A'], 'A': ['4']
};

// Returns valid VIN candidates from raw OCR text, best-first. Forces the
// VIN-illegal O/I/Q to their look-alikes (0/1/0), scans 17-char windows, and for
// windows that fail the check digit tries single-character confusion repairs.
// Falls back to the longest raw window so the human always has something to fix.
function extractVinCandidates_(ocrText) {
  if (!ocrText) return [];
  // O/I/Q are illegal in VINs → force them to their numeric look-alikes first.
  var forced = String(ocrText).toUpperCase().replace(/O/g, '0').replace(/I/g, '1').replace(/Q/g, '0');
  var seen = {}, results = [];
  function add(v) { if (v && !seen[v]) { seen[v] = 1; results.push(v); } }

  var tokens = forced.match(/[A-Z0-9]+/g) || [];

  // Pass A/B — exact-valid 17-char tokens (the strong signal: a VIN is normally its
  // own token), then exact-valid windows inside longer tokens. The check digit gates.
  for (var t = 0; t < tokens.length; t++) {
    var tok = tokens[t];
    if (tok.length === 17) { if (isValidVin_(tok)) add(tok); }
    else if (tok.length > 17) {
      for (var s = 0; s + 17 <= tok.length; s++) { var w = tok.substr(s, 17); if (isValidVin_(w)) add(w); }
    }
  }
  if (results.length) return results;

  // Pass C (last resort — VIN was split across tokens / a char was misread). De-space
  // the whole string, then try exact windows, then bounded single-char confusion repairs.
  // ponytail: noisier (a stray window can pass the check digit ~1/11), so it ONLY runs
  // when no clean token matched — and the human confirms the result anyway.
  var flat = forced.replace(/[^A-Z0-9]/g, '');
  for (var i = 0; i + 17 <= flat.length; i++) { var win = flat.substr(i, 17); if (isValidVin_(win)) add(win); }
  if (!results.length) {
    for (var j = 0; j + 17 <= flat.length && results.length < 8; j++) {
      var ww = flat.substr(j, 17);
      for (var p = 0; p < 17; p++) {
        var alts = VIN_CONFUSE[ww.charAt(p)];
        if (!alts) continue;
        for (var a = 0; a < alts.length; a++) {
          var cand = ww.substr(0, p) + alts[a] + ww.substr(p + 1);
          if (isValidVin_(cand)) add(cand);
        }
      }
    }
  }
  if (results.length) return results;

  // Fallback — surface the longest token (clipped to 17) so the human always has
  // something to correct, even when nothing passed the check digit.
  var longest = '';
  for (var k = 0; k < tokens.length; k++) if (tokens[k].length > longest.length) longest = tokens[k];
  return longest.length >= 17 ? [longest.substr(0, 17)] : [];
}

// OCR — native Google Drive OCR (Advanced Drive Service v2). Never throws.
// Returns { text, error }. Inserts the image with OCR, reads the resulting Google
// Doc, trashes it. The resource mimeType is the IMAGE content-type (the established
// Drive v2 OCR recipe) — `ocr:true` converts it to a Doc holding the recognized text.
function extractVinFromImage_(blob) {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    return { text: '', error: 'Drive advanced service not enabled' };
  }
  // Drive OCR has a low per-user rate limit; on a burst, back off and retry.
  for (var attempt = 0; attempt < 3; attempt++) {
    var fileId = null;
    try {
      var res = Drive.Files.insert(
        { title: '_vinocr_' + new Date().getTime(), mimeType: blob.getContentType() },
        blob,
        { ocr: true, ocrLanguage: 'en' }
      );
      fileId = res && res.id;
      if (!fileId) return { text: '', error: 'insert returned no file id' };
      var text = DocumentApp.openById(fileId).getBody().getText() || '';
      try { Drive.Files.remove(fileId); } catch (e2) {}
      return { text: text, error: '' };
    } catch (e) {
      var msg = String((e && e.message) || e);
      if (fileId) { try { Drive.Files.remove(fileId); } catch (e3) {} }
      if (attempt < 2 && /rate limit/i.test(msg)) { Utilities.sleep(2000 * (attempt + 1)); continue; }
      Logger.log('extractVinFromImage_ failed: ' + msg);
      return { text: '', error: msg };
    }
  }
  return { text: '', error: 'OCR rate limit (after retries)' };
}

// Analyze an already-stored Drive photo: OCR → candidate VIN → match. Pass a
// pre-built vinMap to avoid re-reading SCRAPERDATA per row in a batch (vinMap
// defaults to {} — every caller here builds one per dealer before looping).
function analyzeDriveFile_(fileId, dealerKey, vinMap) {
  var ocrText = '';
  if (fileId) {
    var blob = null;
    try { blob = DriveApp.getFileById(fileId).getBlob(); } catch (e) { Logger.log('analyze get blob: ' + e.message); }
    if (blob) { ocrText = extractVinFromImage_(blob).text; }
  }
  var cands = extractVinCandidates_(ocrText);
  var vin = cands.length ? cands[0] : '';
  var valid = isValidVin_(vin);
  var map = vinMap || {};
  var vehicle = vin ? (map[vin.toUpperCase()] || null) : null;
  return { vin: vin, valid: valid, matched: !!vehicle, vehicle: vehicle, ocrText: ocrText };
}

/**
 * Client-callable. Office-side manual OCR runner — replaces the scanner's
 * per-user drainOcrQueue trigger (field finding: batches sent to the office
 * before OCR drained left rows stuck at ocr_state='queued' forever). Processes
 * up to `limit` rows with ocr_state='queued' AND status='submitted' (drafts are
 * OCR'd only after the crew sends the batch — a draft's queued rows wait), OCRing
 * each photo and matching it against the dealer's inventory, writing the same
 * 9 result columns + ocr_state the scanner's old drainOcrQueue wrote. No
 * LockService (it can't coordinate with the scanner project anyway); instead
 * each write re-verifies the row's ID first and re-locates by ID if scanner-side
 * discards shifted rows mid-run. Default limit 10, hard cap 15 — Drive OCR runs
 * ~1-2s/photo + rate-limit retries, so this call stays well under the 6-min cap.
 * @returns {{ok:boolean, processed?:number, remaining?:number, matched?:number, failed?:number, error?:string}}
 */
function runInboxOcr(limit) {
  try {
    var sh = getLotSubmissionsSheet_();
    if (!sh) return { ok: false, error: 'Submissions sheet not configured.' };
    var n = parseInt(limit, 10);
    if (isNaN(n) || n < 1) n = 10;
    if (n > 15) n = 15;

    var data = sh.getDataRange().getValues();
    var queuedRows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][LOT_SUB.OCR_STATE]) !== 'queued') continue;
      if (String(data[i][LOT_SUB.STATUS] || 'submitted') !== 'submitted') continue;   // blank = legacy submitted (mirror getVinSubmissions default) so client count and this pass agree
      queuedRows.push(i);
    }

    var vinMaps = {};   // per-dealer cache for this run
    var processed = 0, matched = 0, failed = 0;

    for (var q = 0; q < queuedRows.length && processed < n; q++) {
      var rowIdx = queuedRows[q];
      var row = data[rowIdx];
      var dealerKey = String(row[LOT_SUB.DEALER_KEY] || '');
      if (!vinMaps.hasOwnProperty(dealerKey)) {
        var map = {};
        try {
          var cfg = getDealerConfig_(dealerKey);
          if (cfg && cfg[CFG.SCRAPER_LOCATION]) {
            map = buildVinDataMap_(getDealerScraperData_(cfg[CFG.SCRAPER_LOCATION]) || []);
          }
        } catch (eMap) { Logger.log('runInboxOcr vin map failed for ' + dealerKey + ': ' + eMap.message); }
        vinMaps[dealerKey] = map;
      }

      var out = analyzeDriveFile_(String(row[LOT_SUB.PHOTO_ID] || ''), dealerKey, vinMaps[dealerKey]);
      var v = out.vehicle || {};

      // Rows can shift mid-run: the scanner project deleteRow()s on discard, and
      // LockService can't coordinate across the two scripts. Re-verify the ID at
      // the snapshot position right before writing; re-locate by ID if it moved,
      // skip if it's gone (discarded while we were OCRing).
      var id = String(row[LOT_SUB.ID]);
      var rowNum = rowIdx + 1;
      if (String(sh.getRange(rowNum, LOT_SUB.ID + 1).getValue()) !== id) {
        rowNum = 0;
        var ids = sh.getRange(1, LOT_SUB.ID + 1, sh.getLastRow(), 1).getValues();
        for (var r = 1; r < ids.length; r++) {
          if (String(ids[r][0]) === id) { rowNum = r + 1; break; }
        }
        if (!rowNum) { processed++; continue; }
      }

      // cols 8..16 (1-based) = vin_extracted, vin_final, vin_valid, matched, year, make, model, type, stock
      sh.getRange(rowNum, LOT_SUB.VIN_EXTRACTED + 1, 1, 9).setValues([[
        out.vin, out.vin, out.valid ? 'TRUE' : 'FALSE', out.matched ? 'TRUE' : 'FALSE',
        v.year || '', v.make || '', v.model || '', v.type || '', v.stock || ''
      ]]);
      sh.getRange(rowNum, LOT_SUB.OCR_STATE + 1).setValue(out.valid ? 'done' : 'failed');

      if (!out.valid) failed++;
      else if (out.matched) matched++;
      processed++;
    }

    return { ok: true, processed: processed, remaining: queuedRows.length - processed, matched: matched, failed: failed };
  } catch (e) {
    Logger.log('runInboxOcr failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Client-callable. Returns lot-scanner submission rows as objects.
 * @param {{status?:string, dealerKey?:string}} filter  no status = SENT work only (status='submitted'); a status = exact match.
 * @returns {{ok:boolean, configured:boolean, submissions:Array, error?:string}}
 */
function getVinSubmissions(filter) {
  try {
    var sh = getLotSubmissionsSheet_();
    if (!sh) return { ok: true, configured: false, submissions: [] };
    filter = filter || {};
    var wantStatus = filter.status || '';      // '' = SENT work only (submitted); else exact match
    var wantDealer = filter.dealerKey || '';
    var CAP = 1000;
    var data = sh.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < data.length && out.length < CAP; i++) {
      var r = data[i];
      if (!r[LOT_SUB.ID]) continue;
      var status = String(r[LOT_SUB.STATUS] || 'submitted');
      if (wantStatus) { if (status !== wantStatus) continue; }
      else if (status !== 'submitted') continue;   // default: sent work only
      if (wantDealer && String(r[LOT_SUB.DEALER_KEY]) !== wantDealer) continue;
      var tsCell = r[LOT_SUB.TS];
      var tsIsDate = tsCell instanceof Date;   // Sheets coerces the scanner's timestamp strings to Dates
      out.push({
        id: String(r[LOT_SUB.ID]),
        ts: tsIsDate ? Utilities.formatDate(tsCell, Session.getScriptTimeZone(), 'EEE MMM dd yyyy h:mm a') : String(tsCell || ''),
        tsMs: tsIsDate ? tsCell.getTime() : 0,   // client sorts on this, not on parsing ts
        email: String(r[LOT_SUB.EMAIL] || ''),
        dealerKey: String(r[LOT_SUB.DEALER_KEY] || ''), dealerName: String(r[LOT_SUB.DEALER_NAME] || ''),
        photoFileId: String(r[LOT_SUB.PHOTO_ID] || ''), photoUrl: String(r[LOT_SUB.PHOTO_URL] || ''),
        vinExtracted: String(r[LOT_SUB.VIN_EXTRACTED] || ''), vin: String(r[LOT_SUB.VIN_FINAL] || ''),
        valid: isTrue_(r[LOT_SUB.VALID]), matched: isTrue_(r[LOT_SUB.MATCHED]),
        year: String(r[LOT_SUB.YEAR] || ''), make: String(r[LOT_SUB.MAKE] || ''), model: String(r[LOT_SUB.MODEL] || ''),
        type: String(r[LOT_SUB.TYPE] || ''), stock: String(r[LOT_SUB.STOCK] || ''),
        status: status, isDraft: (status === 'draft'),
        ocrState: String(r[LOT_SUB.OCR_STATE] || ''), batchId: String(r[LOT_SUB.BATCH_ID] || ''),
        notes: String(r[LOT_SUB.NOTES] || '')
      });
    }
    return { ok: true, configured: true, submissions: out };
  } catch (e) {
    Logger.log('getVinSubmissions failed: ' + e.message);
    return { ok: false, configured: true, submissions: [], error: e.message };
  }
}

/**
 * Client-callable. Updates one submission's status (allow-listed) and, if a
 * corrected VIN is supplied, re-validates + re-matches it against the dealer's
 * inventory and rewrites the VIN/vehicle columns.
 * @returns {{ok:boolean, valid?:boolean, matched?:boolean, photoTrashed?:boolean, error?:string}}
 */
function updateVinSubmissionStatus(submissionId, status, correctedVin) {
  try {
    var sh = getLotSubmissionsSheet_();
    if (!sh) return { ok: false, error: 'Submissions sheet not configured.' };
    if (LOT_SUB_STATUSES.indexOf(status) === -1) return { ok: false, error: 'Invalid status.' };
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][LOT_SUB.ID]) !== String(submissionId)) continue;
      var rowNum = i + 1;
      var resultValid, resultMatched;

      var corrected = String(correctedVin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (corrected) {
        resultValid = isValidVin_(corrected);
        var vehicle = null;
        try {
          var cfg = getDealerConfig_(String(data[i][LOT_SUB.DEALER_KEY]));
          if (cfg && cfg[CFG.SCRAPER_LOCATION]) {
            var map = buildVinDataMap_(getDealerScraperData_(cfg[CFG.SCRAPER_LOCATION]) || []);
            vehicle = map[corrected] || null;
          }
        } catch (e) { Logger.log('inbox re-match failed (non-fatal): ' + e.message); }
        resultMatched = !!vehicle;
        var v = vehicle || {};
        // cols 9..16 (1-based): vin_final, vin_valid, matched, year, make, model, type, stock
        sh.getRange(rowNum, LOT_SUB.VIN_FINAL + 1, 1, 8).setValues([[
          corrected, resultValid ? 'TRUE' : 'FALSE', resultMatched ? 'TRUE' : 'FALSE',
          v.year || '', v.make || '', v.model || '', v.type || '', v.stock || ''
        ]]);
      }

      var by = '';
      try { by = Session.getActiveUser().getEmail() || ''; } catch (e2) {}
      var ts = (status === 'processed' || status === 'discarded')
        ? Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss')
        : '';
      // cols 17..19 (1-based): status, processed_ts, processed_by
      sh.getRange(rowNum, LOT_SUB.STATUS + 1, 1, 3).setValues([[status, ts, by]]);
      // Discard/processed rows render nowhere again — trash the photo (best-effort).
      var photoTrashed = null;
      if (status === 'discarded' || status === 'processed') {
        photoTrashed = trashLotPhoto_(data[i][LOT_SUB.PHOTO_ID]);
      }
      return { ok: true, valid: resultValid, matched: resultMatched, photoTrashed: photoTrashed };
    }
    return { ok: false, error: 'Submission not found.' };
  } catch (e) {
    Logger.log('updateVinSubmissionStatus failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Client-callable. Bulk status update (no VIN correction — corrections stay per-row
 * via updateVinSubmissionStatus). Same status/timestamp/by stamping as the single-row fn.
 * @returns {{ok:boolean, updated?:number, missing?:number, photosTrashed?:number, photosFailed?:number, error?:string}}
 */
// ponytail: per-row narrow writes in one execution — batch a single setValues pass if inbox batches outgrow ~100 rows
function updateVinSubmissionStatuses(submissionIds, status) {
  try {
    var sh = getLotSubmissionsSheet_();
    if (!sh) return { ok: false, error: 'Submissions sheet not configured.' };
    if (LOT_SUB_STATUSES.indexOf(status) === -1) return { ok: false, error: 'Invalid status.' };
    var ids = (submissionIds || []).map(String);
    var data = sh.getDataRange().getValues();
    var rowById = {};
    for (var i = 1; i < data.length; i++) rowById[String(data[i][LOT_SUB.ID])] = i + 1;

    var by = '';
    try { by = Session.getActiveUser().getEmail() || ''; } catch (e2) {}
    var ts = (status === 'processed' || status === 'discarded')
      ? Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss')
      : '';

    var doTrash = (status === 'discarded' || status === 'processed');
    var updated = 0, missing = 0, photosTrashed = 0, photosFailed = 0;
    ids.forEach(function (id) {
      var rowNum = rowById[id];
      if (!rowNum) { missing++; return; }
      // cols 17..19 (1-based): status, processed_ts, processed_by
      sh.getRange(rowNum, LOT_SUB.STATUS + 1, 1, 3).setValues([[status, ts, by]]);
      updated++;
      // ponytail: per-file trash in the loop — fine to ~100 rows; batch/queue if it outgrows that
      if (doTrash) {
        if (trashLotPhoto_(data[rowNum - 1][LOT_SUB.PHOTO_ID])) photosTrashed++;
        else photosFailed++;
      }
    });
    return { ok: true, updated: updated, missing: missing, photosTrashed: photosTrashed, photosFailed: photosFailed };
  } catch (e) {
    Logger.log('updateVinSubmissionStatuses failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Editor-run backlog sweep (NOT client-callable). Trashes the Drive photo of
 * every row already marked discarded/processed. Idempotent — setTrashed on an
 * already-trashed file is a no-op; crew-owned files the office can't trash just
 * log/count as failed. Rows are retained (never deleteRow'd).
 * @returns {string} 'sweepLotPhotos: scanned=N trashed=N failed=N'
 */
function sweepLotPhotos() {
  var sh = getLotSubmissionsSheet_();
  if (!sh) { var m0 = 'sweepLotPhotos: submissions sheet not configured.'; Logger.log(m0); return m0; }
  var data = sh.getDataRange().getValues();
  var scanned = 0, trashed = 0, failed = 0;
  for (var i = 1; i < data.length; i++) {
    var st = String(data[i][LOT_SUB.STATUS] || '');
    if (st !== 'discarded' && st !== 'processed') continue;
    scanned++;
    if (trashLotPhoto_(data[i][LOT_SUB.PHOTO_ID])) trashed++;
    else failed++;
  }
  var msg = 'sweepLotPhotos: scanned=' + scanned + ' trashed=' + trashed + ' failed=' + failed;
  Logger.log(msg);
  return msg;
}


// ============================================================================
// SECTION 33: EOM BILLING REPORT
// ----------------------------------------------------------------------------
// Ported from the standalone "Silver Fox / BillingDashboard" Apps Script project.
// Pulls deals from Pipedrive BY PIPELINE STAGE (not by date — staff move deals
// into the "EOM Merge" stage, then run), flattens each deal's products into a
// flat 28-col audit table, then builds one formatted tab PER ORGANIZATION
// (product summary + per-deal line-item breakdown).
//
// Reuses the Section-31 Pipedrive layer: pdGetSecrets_ (auth — NO separate
// token), pdFetch_ / pdListAllV1_ (deal listing + pagination), pdListDealFields_
// (the "Duplicates" custom-field key). The one net-new fetch is the PARALLEL
// per-deal products call (UrlFetchApp.fetchAll) — sequential pdListDealProducts_
// over hundreds of deals would blow the 6-min cap.
//
// Output is a NEW dated spreadsheet per run (in an "EOM Reports" Drive folder),
// so nothing is ever written into SF_SYSTEM_MASTER and there is no destructive
// "delete other tabs" step. Per-org tabs are built from the in-memory rows, not
// by re-reading the sheet (avoids the getSheets()[0] / openById cache traps).
// ============================================================================

// Config lives in PIPEDRIVE_SETTINGS (key/value). Defaults make the feature work
// out of the box; the EOM view surfaces both for editing.
var PD_EOM_PIPELINE_KEY = 'eom_billing_pipeline_id'; // billing pipeline whose stages the report can pull from
var PD_EOM_STAGE_KEY    = 'eom_default_stage_id';    // stage selected by default in the EOM view
var PD_EOM_FOLDER_KEY   = 'eom_reports_folder_id';   // Drive folder that holds generated report files (created once)
var EOM_DEFAULT_PIPELINE_ID = 4;   // "Billing" pipeline
var EOM_DEFAULT_STAGE_ID    = 44;  // "EOM Merge" stage

// Report index (SF_EOM_REPORTS): one row per month; the in-app Reports card AND
// the standalone eom-viewer both read it. Created once by setupEomReportsIndex()
// — paste the logged id into EOM_INDEX_SHEET_ID here AND into eom-viewer/Code.gs.
// (Its own spreadsheet — SF_SYSTEM_MASTER is never written.) All cells are text:
// Sheets date-parses "2026-07"/"July 2026", and google.script.run can't serialize
// the resulting Date objects, so the whole grid is @-formatted and every write is
// String()-converted with pre-formatted string timestamps.
var EOM_INDEX_SHEET_ID = '1p28o2IbGFrHOqKVs_DUpAtyzM6LFYyAKUpsBB7NwFxg';   // set after running setupEomReportsIndex()
var EOM_INDEX_TAB = 'REPORTS';
var EOM_INDEX_HEADERS = ['month_key', 'month_label', 'scope', 'stage_id', 'generated_at',
  'json_file_id', 'folder_url', 'ss_url', 'org_count', 'deal_count', 'status',
  'published_at', 'published_by', 'published_json_file_id'];
var EOMIDX = { MONTH_KEY: 0, MONTH_LABEL: 1, SCOPE: 2, STAGE_ID: 3, GENERATED_AT: 4,
  JSON_FILE_ID: 5, FOLDER_URL: 6, SS_URL: 7, ORG_COUNT: 8, DEAL_COUNT: 9, STATUS: 10,
  PUBLISHED_AT: 11, PUBLISHED_BY: 12, PUBLISHED_JSON_FILE_ID: 13 };

// Flat audit-table schema (mirrors the standalone RowBuilder.COLUMNS exactly).
var EOM_COLUMNS = [
  'processed_at', 'deal_id', 'deal_title', 'deal_created_at', 'org_name',
  'person_name', 'deal_owner', 'deal_value', 'currency', 'pipeline', 'stage',
  'duplicates', 'product_id', 'product_code', 'product_name', 'product_description',
  'product_tax_percent', 'deal_tax_percent', 'variation', 'quantity', 'item_price',
  'discount', 'sum', 'billing_frequency', 'billing_start_date', 'product_notes',
  'product_added_at', 'product_last_edited'
];

// ── Config accessors ────────────────────────────────────────────────────────

function eomGetPipelineId_() {
  var n = parseInt(getPipedriveSettingValue_(PD_EOM_PIPELINE_KEY), 10);
  return isNaN(n) ? EOM_DEFAULT_PIPELINE_ID : n;
}
function eomGetDefaultStageId_() {
  var n = parseInt(getPipedriveSettingValue_(PD_EOM_STAGE_KEY), 10);
  return isNaN(n) ? EOM_DEFAULT_STAGE_ID : n;
}

/** The Drive folder for generated reports — created once inside the output-docs
 * folder and remembered. Falls back to the output-docs folder itself. */
function eomGetReportsFolder_() {
  var id = getPipedriveSettingValue_(PD_EOM_FOLDER_KEY);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var parent = null;
  try { parent = DriveApp.getFolderById(OUTPUT_FOLDER_ID); } catch (e) {}
  var folder;
  try { folder = parent ? parent.createFolder('EOM Reports') : DriveApp.createFolder('EOM Reports'); }
  catch (e) { return parent; }
  setPipedriveSettingValue_(PD_EOM_FOLDER_KEY, folder.getId());
  return folder;
}

// ── Pipedrive reads (reuse Section 31) ──────────────────────────────────────

/** Stages of a pipeline, sorted by order — powers the run-screen stage picker. */
function pdEomListStages_(pipelineId) {
  var r = pdFetch_('get', '/stages?pipeline_id=' + encodeURIComponent(pipelineId));
  if (!r.ok || !r.data) return [];
  return r.data.map(function (s) { return { id: s.id, name: s.name, order_nr: s.order_nr || 0 }; })
    .sort(function (a, b) { return a.order_nr - b.order_nr; });
}

/** Deals for a scope. 'full_billing' = all open deals in the configured pipeline;
 * otherwise all not-deleted deals in the given stage (defaults to the EOM stage). */
function eomListDeals_(scope, stageId) {
  if (scope === 'full_billing') {
    var pid = eomGetPipelineId_();
    return pdListAllV1_('/deals?status=open').filter(function (d) { return d.pipeline_id === pid; });
  }
  var sid = parseInt(stageId, 10);
  if (isNaN(sid)) sid = eomGetDefaultStageId_();
  return pdListAllV1_('/deals?stage_id=' + sid + '&status=all_not_deleted');
}

/** Products for many deals in ONE parallel batch. Returns {dealId:[dealProduct,…]}.
 * Never throws — a failed deal yields an empty product list. */
function pdEomFetchProductsForDeals_(dealIds) {
  var out = {};
  var s = pdGetSecrets_();
  if (!s) { dealIds.forEach(function (id) { out[id] = []; }); return out; }
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

// Per-execution name caches (pipeline/stage/dealField), mirroring the standalone.
var _eomPipelineNames_ = {};
var _eomStageNames_ = {};
var _eomDupKey_ = null;

function eomPipelineName_(id) {
  if (!id) return '';
  if (_eomPipelineNames_[id] !== undefined) return _eomPipelineNames_[id];
  var r = pdFetch_('get', '/pipelines/' + id);
  return (_eomPipelineNames_[id] = (r.ok && r.data && r.data.name) ? r.data.name : '');
}
function eomStageName_(id) {
  if (!id) return '';
  if (_eomStageNames_[id] !== undefined) return _eomStageNames_[id];
  var r = pdFetch_('get', '/stages/' + id);
  return (_eomStageNames_[id] = (r.ok && r.data && r.data.name) ? r.data.name : '');
}
/** The 40-char key of the "Duplicates" custom deal field ('' if none). */
function eomDuplicatesFieldKey_() {
  if (_eomDupKey_ !== null) return _eomDupKey_;
  _eomDupKey_ = '';
  try {
    pdListDealFields_().forEach(function (f) { if (f.name === 'Duplicates' && f.key) _eomDupKey_ = f.key; });
  } catch (e) {}
  return _eomDupKey_;
}

// ── Row building (ports TextCleaner + RowBuilder) ───────────────────────────

/** Pipedrive rich-text HTML → clean plain text (ports TextCleaner.cleanHtml). */
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

/** One deal (+ its products) → flat rows in EOM_COLUMNS order. A deal with no
 * products still emits one row so it isn't lost (ports RowBuilder.build). */
function eomBuildRows_(deal, products) {
  var dupKey = eomDuplicatesFieldKey_();
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
    pipeline: eomPipelineName_(deal.pipeline_id),
    stage: eomStageName_(deal.stage_id),
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

// ── Report writing (ports SheetWriter + BillingDashboard) ───────────────────

// ── PDF output (per-dealer, one page per contact) ───────────────────────────

/** HTML-escape dynamic text for the PDF builder. */
function eomEscHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Format a number as USD, no Intl dependency (GAS V8 Intl is unreliable). */
function eomMoney_(n) {
  var v = Math.round((Number(n) || 0) * 100) / 100;
  var neg = v < 0; v = Math.abs(v);
  var parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + parts.join('.');
}

/** Wraps SVG inner markup in an <svg> document and returns a base64 data URI.
 *  The raw HTML->PDF converter paints NO background fills behind HTML text
 *  (CSS or bgcolor — confirmed by the live fill probe), but it DOES render
 *  data-URI images, including SVG with text baked in. So every colored band
 *  is an SVG image; selectable body text stays HTML. */
function eomSvgUri_(w, h, inner) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' + inner + '</svg>';
  return 'data:image/svg+xml;base64,' + Utilities.base64Encode(svg, Utilities.Charset.UTF_8);
}

/** The full HTML document for one dealer's PDF. Fed a MERGED group by default
 *  (one continuous flow, contact shown per deal card); with splitContacts each
 *  contact section gets its own page. TABLE-BASED (the converter drops
 *  display:flex); colored bands/pills are baked SVG images (see eomSvgUri_);
 *  line items stay selectable HTML text. */
function eomDealerPdfHtml_(orgGroup, monthLabel, dealBase) {
  var css = ''
    + '@page{size:letter;margin:0.5in;}'
    + 'body{margin:0;color:#1a2733;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.4;}'
    + 'table{border-collapse:collapse;}'
    + '.contact-page{page-break-before:always;}'
    + '.dealer{font-size:20px;font-weight:800;} .contact{color:#5b6b7a;} .mo{font-size:13px;font-weight:700;color:#1a3a5c;}'
    + '.muted{color:#5b6b7a;font-size:11px;} .var{color:#5b6b7a;font-weight:600;}'
    + '.seclabel{font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#2d6a9f;margin:16px 0 6px;}'
    + 'table.sum{width:100%;} .sum th{text-align:left;font-size:10.5px;text-transform:uppercase;color:#5b6b7a;border-bottom:1px solid #dce4ec;padding:5px 8px;}'
    + '.sum td{padding:5px 8px;border-bottom:1px solid #dce4ec;} .sum .r{text-align:right;}'
    + '.sum .tot td{font-weight:800;border-top:2px solid #1a3a5c;border-bottom:none;}';

  var esc = eomEscHtml_, money = eomMoney_;
  var BAND_W = 714;   // letter minus 0.5in margins ~= 720px content; card borders eat a few

  // A rounded stat pill as a baked SVG image: "3 orders" / "total $3,660.00".
  function chipImg(boldText, label, boldFirst) {
    var full = boldFirst ? (boldText + ' ' + label) : (label + ' ' + boldText);
    var w = Math.round(24 + full.length * 6.2);
    var bold = '<tspan font-weight="bold" fill="#1a2733">' + esc(boldText) + '</tspan>';
    var rest = '<tspan>' + (boldFirst ? (' ' + esc(label)) : (esc(label) + ' ')) + '</tspan>';
    var inner = '<rect width="' + w + '" height="22" rx="11" fill="#eef3f9"/>'
      + '<text x="' + Math.round(w / 2) + '" y="15" text-anchor="middle" font-family="Arial" font-size="11" fill="#5b6b7a">'
      + (boldFirst ? bold + rest : rest + bold) + '</text>';
    return '<img src="' + eomSvgUri_(w, 22, inner) + '" width="' + w + '" height="22">';
  }

  // The deal header band (blue fill + title/value/meta) as one baked SVG image.
  function bandImg(title, value, meta) {
    var t = title.length > 64 ? title.slice(0, 62) + '…' : title;
    var inner = '<rect width="' + BAND_W + '" height="42" fill="#eef3f9"/>'
      + '<text x="12" y="18" font-family="Arial" font-size="13" font-weight="bold" fill="#2d6a9f">' + esc(t) + '</text>'
      + '<text x="' + (BAND_W - 12) + '" y="18" text-anchor="end" font-family="Arial" font-size="13" font-weight="bold" fill="#1a2733">' + esc(value) + '</text>'
      + '<text x="12" y="35" font-family="Arial" font-size="11" fill="#5b6b7a">' + esc(meta) + '</text>';
    return '<img src="' + eomSvgUri_(BAND_W, 42, inner) + '" width="' + BAND_W + '" height="42" style="display:block;">';
  }

  var pages = orgGroup.contacts.map(function (ct, i) {
    var header = '<table width="100%"><tr>'
      + '<td style="padding-bottom:8px;border-bottom:2px solid #1a3a5c;"><div class="dealer">' + esc(orgGroup.org)
      + '</div>' + (ct.contact ? '<div class="contact">Contact: ' + esc(ct.contact) + '</div>' : '') + '</td>'
      + '<td align="right" valign="bottom" style="padding-bottom:8px;border-bottom:2px solid #1a3a5c;"><span class="mo">EOM &mdash; '
      + esc(monthLabel) + '</span></td></tr></table>';

    var chips = '<p style="margin:10px 0 4px;">'
      + chipImg(String(ct.stats.orders), 'orders', true) + ' '
      + chipImg(String(ct.stats.duplicates), 'duplicates', true) + ' '
      + chipImg(money(ct.stats.totalAmt), 'total', false)
      + '</p>';

    var sum = '<div class="seclabel">Product summary</div><table class="sum">'
      + '<tr><th>Code</th><th>Product</th><th class="r">Qty</th><th class="r">Total value</th></tr>';
    ct.summaryRows.forEach(function (p, i) {
      var bg = (i % 2) ? ' bgcolor="#f6f8fa"' : '';
      sum += '<tr><td' + bg + '>' + esc(p.code) + '</td><td' + bg + '><b>' + esc(p.name) + '</b>'
        + (p.vari ? ' <span class="var">&middot; ' + esc(p.vari) + '</span>' : '')
        + '</td><td' + bg + ' class="r">' + p.qty + '</td><td' + bg + ' class="r">' + money(p.amt) + '</td></tr>';
    });
    sum += '<tr class="tot"><td></td><td>TOTAL</td><td class="r">' + ct.stats.totalQty + '</td><td class="r">' + money(ct.stats.totalAmt) + '</td></tr></table>';

    var deals = '<div class="seclabel">Deals</div>';
    ct.deals.forEach(function (d) {
      var created = d.created ? String(d.created).substring(0, 10) : '';
      var dupTxt = d.duplicates + ' duplicate' + (d.duplicates === 1 ? '' : 's');
      var body;
      if (!d.hasProducts) {
        body = '<tr><td colspan="2" style="color:#5b6b7a;font-size:11px;padding:6px 12px 8px;">No products on this deal.</td></tr>';
      } else {
        body = d.lines.map(function (l) {
          var name = esc(l.name || l.code) + (l.vari ? ' <span class="var">&middot; ' + esc(l.vari) + '</span>' : '');
          var descTxt = [l.desc, l.notes].filter(function (s) { return s && String(s).trim(); }).map(esc).join(' &mdash; ');
          return '<tr><td style="padding:6px 12px;border-top:1px solid #dce4ec;"><b>' + name + '</b>'
            + (descTxt ? '<div class="muted" style="max-width:360px;">' + descTxt + '</div>' : '') + '</td>'
            + '<td align="right" valign="top" style="padding:6px 12px;border-top:1px solid #dce4ec;white-space:nowrap;">'
            + '<span class="muted">' + l.qty + ' &times; ' + money(l.price) + '</span><br><b>' + money(l.sum) + '</b></td></tr>';
        }).join('');
      }
      // The whole header block (title/value + meta) is ONE baked SVG band image,
      // wrapped in the deal link. Body line rows stay selectable HTML text.
      var title = '#' + d.id + ' · ' + (d.title || ('Deal ' + d.id));
      var meta = 'Owner: ' + d.owner + (created ? ' · Created: ' + created : '') + ' · ' + dupTxt
        + (ct.merged && d.contact ? ' · Contact: ' + d.contact : '');
      if (meta.length > 105) meta = meta.slice(0, 103) + '…';   // fixed 714px band — don't overflow the SVG text run
      deals += '<table width="100%" cellspacing="0" style="border:1px solid #dce4ec;border-left:3px solid #2d6a9f;margin-top:10px;page-break-inside:avoid;">'
        + '<tr><td colspan="2" style="padding:0;font-size:0;line-height:0;"><a href="' + dealBase + d.id + '">'
        + bandImg(title, money(d.dealValue), meta) + '</a></td></tr>'
        + body + '</table>';
    });

    var foot = '<table width="100%" style="border-top:1px solid #dce4ec;margin-top:14px;"><tr>'
      + '<td style="color:#5b6b7a;font-size:10px;padding-top:6px;">Silver Fox Marketing &middot; EOM Billing</td>'
      + '<td align="right" style="color:#5b6b7a;font-size:10px;padding-top:6px;">' + esc(orgGroup.org) + (ct.contact ? ' &middot; ' + esc(ct.contact) : '') + '</td></tr></table>';

    return '<div class="contact-page"' + (i > 0 ? ' style="page-break-before:always;"' : '') + '>'
      + header + chips + sum + deals + foot + '</div>';
  }).join('\n');

  return '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + pages + '</body></html>';
}

/** HTML string -> named PDF Blob (the raw converter: crisp typography/borders;
 *  background fills are the open question the fill probe answers). */
function eomHtmlToPdf_(html, filename) {
  return Utilities.newBlob(html, 'text/html', filename).getAs('application/pdf').setName(filename);
}

/** TEMPORARY de-risk spike — renders one sample dealer PDF into the EOM folder.
 *  Public (no trailing _) so it shows in the editor Run dropdown; removed in the
 *  final task once fidelity is confirmed. Run from the Apps Script editor. */
function eomPdfSpike() {
  var g = { org: 'Bommarito Automotive Group', contacts: [
    { contact: 'Sarah Chen', stats: { orders: 3, duplicates: 2, totalQty: 60, totalAmt: 3660 },
      summaryRows: [
        { code: 'SCP-STD', name: 'Standard Shortcut Pack', desc: '', vari: '', qty: 45, amt: 2250, notesStr: '' },
        { code: 'SCP-PREM', name: 'Premium Shortcut Pack', desc: '', vari: 'Large', qty: 12, amt: 960, notesStr: '' },
        { code: 'INSTALL', name: 'Installation', desc: '', vari: '', qty: 3, amt: 450, notesStr: '' } ],
      deals: [
        { id: 10432, title: 'June New Vehicle Order', owner: 'Mike R.', created: '2026-06-03T10:00:00Z', duplicates: 1, dealValue: 1540, hasProducts: true,
          lines: [
            { code: 'SCP-STD', name: 'Standard Shortcut Pack', vari: '', qty: 20, price: 50, sum: 1000, desc: 'Front windshield banners, gloss laminate', notes: '' },
            { code: 'SCP-PREM', name: 'Premium Shortcut Pack', vari: 'Large', qty: 6, price: 80, sum: 480, desc: 'Includes custom dealer logo + QR to VDP; extended weatherproofing for outdoor lot display', notes: '' },
            { code: 'INSTALL', name: 'Installation', vari: '', qty: 1, price: 60, sum: 60, desc: '', notes: '' } ] },
        { id: 10460, title: 'Empty test deal', owner: 'Ann P.', created: '2026-06-20T00:00:00Z', duplicates: 0, dealValue: 0, hasProducts: false, lines: [] } ] },
    { contact: 'David Ruiz', stats: { orders: 1, duplicates: 0, totalQty: 10, totalAmt: 500 },
      summaryRows: [ { code: 'SCP-STD', name: 'Standard Shortcut Pack', desc: '', vari: '', qty: 10, amt: 500, notesStr: '' } ],
      deals: [ { id: 10501, title: 'June Fleet', owner: 'Mike R.', created: '2026-06-11T00:00:00Z', duplicates: 0, dealValue: 500, hasProducts: true,
        lines: [ { code: 'SCP-STD', name: 'Standard Shortcut Pack', vari: '', qty: 10, price: 50, sum: 500, desc: '', notes: '' } ] } ] }
  ] };
  // Render the production DEFAULT (merged contacts) — also exercises the merge
  // helper live. Pass g directly instead to preview the split-contacts layout.
  var html = eomDealerPdfHtml_(eomMergeContactGroups_([g])[0], 'June 2026', 'https://silverfoxmarketing.pipedrive.com/deal/');
  var pdf = eomHtmlToPdf_(html, 'EOM PDF SPIKE.pdf');
  var folder = eomGetReportsFolder_();
  var old = folder.getFilesByName('EOM PDF SPIKE.pdf');   // trash prior runs so you never open a stale copy
  while (old.hasNext()) old.next().setTrashed(true);
  var file = folder.createFile(pdf);
  Logger.log('SPIKE PDF (open THIS url): ' + file.getUrl());
  return file.getUrl();
}

function eomColIndex_() {
  var m = {};
  EOM_COLUMNS.forEach(function (c, i) { m[c] = i; });
  return m;
}

/** Groups flat rows -> [{org, contacts:[{contact, stats, summaryRows, deals}]}].
 *  Single source of truth for BOTH the spreadsheet org tabs and the PDFs. */
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
        // tax = the line's actual Tax % on the deal, falling back to the product
        // catalog rate (pre-tax-fix deals have 0 on the line but a real catalog rate)
        dealMap[id].lines.push({ code: String(r[C.product_code] || '').trim(), name: String(r[C.product_name] || '').trim(), vari: String(r[C.variation] || '').trim(), qty: Number(r[C.quantity]) || 0, price: Number(r[C.item_price]) || 0, sum: Number(r[C.sum]) || 0, tax: Number(r[C.deal_tax_percent]) || Number(r[C.product_tax_percent]) || 0, desc: String(r[C.product_description] || '').trim(), notes: String(r[C.product_notes] || '').trim() });
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

/** Collapses each org's contact sections into ONE pseudo-contact
 *  ({contact:'', merged:true}): deals concatenated (each attributed with its
 *  source contact), stats summed, summary rows merged by code+variation.
 *  MIRRORS the client-side eomrMergeGroup_ in EomReportRenderer.html — keep the
 *  two in sync (a parity test in the Node self-checks guards this). The default
 *  (splitContacts=false) generation feeds THIS shape to the PDF/org-tab
 *  builders; report.json always keeps the split shape. Input is never mutated. */
function eomMergeContactGroups_(group) {
  return (group || []).map(function (og) {
    var stats = { orders: 0, duplicates: 0, totalQty: 0, totalAmt: 0 };
    var deals = [], sumMap = {}, sumKeys = [];
    (og.contacts || []).forEach(function (ct) {
      var s = ct.stats || {};
      stats.orders += Number(s.orders) || 0;
      stats.duplicates += Number(s.duplicates) || 0;
      stats.totalQty += Number(s.totalQty) || 0;
      stats.totalAmt += Number(s.totalAmt) || 0;
      (ct.deals || []).forEach(function (d) {
        var copy = {}, k;
        for (k in d) copy[k] = d[k];
        if (!copy.contact) copy.contact = ct.contact;   // pre-v2.14 groups lack .contact
        deals.push(copy);
      });
      (ct.summaryRows || []).forEach(function (p) {
        var key = String(p.code || '') + '|||' + String(p.vari || '');
        var row = sumMap[key];
        if (!row) { row = { code: p.code, name: p.name, desc: p.desc, vari: p.vari, qty: 0, amt: 0, notes: [] }; sumMap[key] = row; sumKeys.push(key); }
        row.qty += Number(p.qty) || 0;
        row.amt += Number(p.amt) || 0;
        String(p.notesStr || '').split(' | ').forEach(function (n) {
          if (n && row.notes.indexOf(n) === -1) row.notes.push(n);
        });
      });
    });
    var summaryRows = sumKeys.map(function (k) {
      var r = sumMap[k];
      return { code: r.code, name: r.name, desc: r.desc, vari: r.vari, qty: r.qty, amt: r.amt, notesStr: r.notes.join(' | ') };
    }).sort(function (a, b) {
      return a.code < b.code ? -1 : a.code > b.code ? 1 : a.vari < b.vari ? -1 : a.vari > b.vari ? 1 : 0;
    });
    deals.sort(function (a, b) { return a.id - b.id; });
    return { org: og.org, contacts: [{ contact: '', merged: true, stats: stats, summaryRows: summaryRows, deals: deals }] };
  });
}

/** "July 2026" in the script timezone — the default report-month label. */
function eomCurrentMonthLabel_() {
  var tz = Session.getScriptTimeZone() || 'America/Chicago';
  return Utilities.formatDate(new Date(), tz, 'MMMM yyyy');
}

/** Finds/creates "<monthLabel> EOM Reports" inside the reports folder. */
function eomGetMonthFolder_(monthLabel) {
  var parent = eomGetReportsFolder_();
  var name = monthLabel + ' EOM Reports';
  if (parent) {
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }
  return DriveApp.createFolder(name);
}

/** Replace-by-name: trash any same-name file in the folder, then create. */
function eomPutFile_(folder, blob, name) {
  var it = folder.getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);
  return folder.createFile(blob.setName(name));
}

// ── Report index + report.json (feed the in-app + standalone viewers) ────────

/** Sortable month key: "July 2026" -> "2026-07". '' on unparseable input. */
function eomMonthKey_(label) {
  var names = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
                july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  var m = String(label || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return '';
  var mm = names[m[1].toLowerCase()];
  return mm ? (m[2] + '-' + mm) : '';
}

/** The report payload the viewers render: grouped data + meta, NO flat rows
 *  (those live in the spreadsheet DATA tab). Returns a JSON string. */
function eomBuildReportJson_(group, meta) {
  return JSON.stringify({ meta: meta, group: group });
}

/** One-time setup — creates the SF_EOM_REPORTS index spreadsheet, all-text, and
 *  logs its id (paste into EOM_INDEX_SHEET_ID here AND eom-viewer/Code.gs). */
function setupEomReportsIndex() {
  var ss = SpreadsheetApp.create('SF_EOM_REPORTS');
  var sh = ss.getSheets()[0];
  sh.setName(EOM_INDEX_TAB);
  sh.getRange(1, 1, sh.getMaxRows(), EOM_INDEX_HEADERS.length).setNumberFormat('@');   // all-text (invariant 2)
  sh.getRange(1, 1, 1, EOM_INDEX_HEADERS.length).setValues([EOM_INDEX_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  try { var f = eomGetReportsFolder_(); if (f) DriveApp.getFileById(ss.getId()).moveTo(f); } catch (e) {}
  Logger.log('SF_EOM_REPORTS created. Paste this id into EOM_INDEX_SHEET_ID (Code.gs) AND eom-viewer/Code.gs:\n' + ss.getId());
  return ss.getId();
}

/** The REPORTS sheet, or null if the index isn't configured/openable. */
function eomOpenIndex_() {
  if (!EOM_INDEX_SHEET_ID) return null;
  try {
    var ss = SpreadsheetApp.openById(EOM_INDEX_SHEET_ID);
    return ss.getSheetByName(EOM_INDEX_TAB) || ss.getSheets()[0];
  } catch (e) { Logger.log('EOM index open failed: ' + e.message); return null; }
}

/** Upsert the GENERATION columns of a month's row (status -> 'generated'),
 *  leaving the published_* snapshot columns untouched so a re-run never mutates
 *  what the invoice person sees. All-text writes (@-format each target range). */
function eomIndexUpsert_(rec) {
  var sh = eomOpenIndex_();
  if (!sh) return false;
  var gen = [
    String(rec.monthKey), String(rec.monthLabel), String(rec.scope),
    String(rec.stageId == null ? '' : rec.stageId), String(rec.generatedAt),
    String(rec.jsonFileId || ''), String(rec.folderUrl || ''), String(rec.ssUrl || ''),
    String(rec.orgCount == null ? '' : rec.orgCount), String(rec.dealCount == null ? '' : rec.dealCount),
    'generated'
  ];   // columns 0..10 (month_key..status)
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][EOMIDX.MONTH_KEY]) === String(rec.monthKey)) {
      sh.getRange(i + 1, 1, 1, gen.length).setNumberFormat('@');
      sh.getRange(i + 1, 1, 1, gen.length).setValues([gen]);
      return true;
    }
  }
  var row = sh.getLastRow() + 1, full = gen.concat(['', '', '']);   // published_* blank
  sh.getRange(row, 1, 1, full.length).setNumberFormat('@');
  sh.getRange(row, 1, 1, full.length).setValues([full]);
  return true;
}

/** All index rows as plain strings, newest month first. (Main-app use — includes
 *  Nick-only folder/spreadsheet URLs; the standalone viewer has its own reader.) */
function eomIndexList_() {
  var sh = eomOpenIndex_();
  if (!sh) return [];
  var data = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!String(r[EOMIDX.MONTH_KEY]).trim()) continue;
    out.push({
      monthKey: String(r[EOMIDX.MONTH_KEY]), monthLabel: String(r[EOMIDX.MONTH_LABEL]),
      scope: String(r[EOMIDX.SCOPE]), stageId: String(r[EOMIDX.STAGE_ID]),
      generatedAt: String(r[EOMIDX.GENERATED_AT]), folderUrl: String(r[EOMIDX.FOLDER_URL]),
      ssUrl: String(r[EOMIDX.SS_URL]), orgCount: String(r[EOMIDX.ORG_COUNT]),
      dealCount: String(r[EOMIDX.DEAL_COUNT]), status: String(r[EOMIDX.STATUS]),
      publishedAt: String(r[EOMIDX.PUBLISHED_AT]), publishedBy: String(r[EOMIDX.PUBLISHED_BY])
    });
  }
  out.sort(function (a, b) { return a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0; });
  return out;
}

/** Raw index row for a month key: {sheet, rowNum (1-based), row}, or null.
 *  Used by the review/finalize endpoints which need the file-id columns. */
function eomIndexGetRow_(monthKey) {
  var sh = eomOpenIndex_();
  if (!sh) return null;
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][EOMIDX.MONTH_KEY]) === String(monthKey)) return { sheet: sh, rowNum: i + 1, row: data[i] };
  }
  return null;
}

/** Orchestrates the whole report bundle into the month folder: the spreadsheet
 *  (flat audit tab + per-org tabs, unchanged content) plus one PDF per dealer,
 *  plus report.json (grouped data + meta) for the viewers. A single dealer's PDF
 *  failure is non-fatal (logged, run continues). splitContacts=false (the
 *  default) merges contact sections in the PDFs/org tabs; report.json ALWAYS
 *  keeps the split shape (the viewers merge at render time). */
function eomWriteReport_(rows, scope, monthLabel, runId, stageId, splitContacts) {
  var tz = Session.getScriptTimeZone() || 'America/Chicago';
  var dateStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var fileName = 'EOM Report ' + dateStr + ' (' + (scope === 'full_billing' ? 'Full Billing' : 'EOM') + ')';

  var group = eomGroupForReport_(rows);
  var pubGroup = splitContacts ? group : eomMergeContactGroups_(group);
  var folder = null;
  try { folder = eomGetMonthFolder_(monthLabel); }
  catch (e) { Logger.log('EOM: month folder failed (non-fatal): ' + e.message); }

  // Spreadsheet -> month folder (replace-by-name so re-runs stay clean).
  var ss = SpreadsheetApp.create(fileName);
  var dataSheet = ss.getSheets()[0];
  dataSheet.setName('DATA ' + dateStr);
  eomWriteFlatTab_(dataSheet, rows);
  var orgCount = eomBuildOrgTabs_(ss, pubGroup);
  ss.setActiveSheet(dataSheet);
  ss.moveActiveSheet(1);   // keep the flat data tab first
  SpreadsheetApp.flush();
  try {
    if (folder) {
      var itSS = folder.getFilesByName(fileName);
      while (itSS.hasNext()) itSS.next().setTrashed(true);
      DriveApp.getFileById(ss.getId()).moveTo(folder);
    }
  } catch (e) { Logger.log('EOM: move spreadsheet failed (non-fatal): ' + e.message); }

  // One PDF per dealer.
  var dealBase = eomDealBaseUrl_(), pdfCount = 0;
  if (folder) {
    for (var i = 0; i < pubGroup.length; i++) {
      var og = pubGroup[i];
      if (runId) eomSetProgress_(runId, { message: 'PDF ' + (i + 1) + ' / ' + pubGroup.length + ' — ' + og.org + '…', percent: 65 + Math.round(30 * (i / pubGroup.length)), done: false, error: null });
      try {
        var html = eomDealerPdfHtml_(og, monthLabel, dealBase);
        var pdfName = og.org.replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() + ' — ' + monthLabel + ' EOM.pdf';
        eomPutFile_(folder, eomHtmlToPdf_(html, pdfName), pdfName);
        pdfCount++;
      } catch (e) { Logger.log('EOM: PDF failed for ' + og.org + ' (non-fatal): ' + e.message); }
    }
  }

  // report.json (grouped data + meta) for the in-app + standalone viewers.
  var monthKey = eomMonthKey_(monthLabel), jsonFileId = '', dealCount = 0;
  group.forEach(function (og) { og.contacts.forEach(function (ct) { dealCount += ct.deals.length; }); });
  if (folder) {
    try {
      var meta = {
        monthLabel: monthLabel, monthKey: monthKey, scope: scope,
        stageId: (stageId == null ? '' : String(stageId)),
        generatedAt: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'),
        orgCount: orgCount, dealCount: dealCount,
        folderUrl: folder.getUrl(), ssUrl: ss.getUrl(), dealBaseUrl: dealBase,
        splitContacts: !!splitContacts
      };
      var jf = eomPutFile_(folder, Utilities.newBlob(eomBuildReportJson_(group, meta), 'application/json', 'report.json'), 'report.json');
      jsonFileId = jf.getId();
    } catch (e) { Logger.log('EOM: report.json write failed (non-fatal): ' + e.message); }
  }

  return { url: ss.getUrl(), folderUrl: folder ? folder.getUrl() : ss.getUrl(), name: fileName, orgCount: orgCount, pdfCount: pdfCount, jsonFileId: jsonFileId, monthKey: monthKey, dealCount: dealCount };
}

/** The flat 28-col audit tab (ports SheetWriter.writeReport). */
function eomWriteFlatTab_(sheet, rows) {
  var values = [EOM_COLUMNS].concat(rows);
  sheet.getRange(1, 1, values.length, EOM_COLUMNS.length).setValues(values);
  sheet.getRange(1, 1, 1, EOM_COLUMNS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  for (var c = 1; c <= EOM_COLUMNS.length; c++) sheet.autoResizeColumn(c);
}

function eomDealBaseUrl_() {
  var s = pdGetSecrets_();
  return 'https://' + (s ? s.domain : 'silverfoxmarketing') + '.pipedrive.com/deal/';
}

/** Trims an org name to a legal, unique tab title (ports makeSafeTabName). */
function eomSafeTabName_(name, usedNames) {
  var stripped = String(name).replace(/[:\\\/\?\*\[\]]/g, '').trim();
  var base = stripped.substring(0, 31), candidate = base, counter = 2;
  while (usedNames[candidate.toLowerCase()]) {
    var suffix = ' ' + counter;
    base = stripped.substring(0, 31 - suffix.length);
    candidate = base + suffix; counter++;
  }
  usedNames[candidate.toLowerCase()] = true;
  return candidate;
}

function eomBuildFullLabel_(name, desc, vari, notes) {
  var parts = [name, desc];
  if (vari) parts.push(vari);
  if (notes) parts.push(notes);
  return parts.filter(function (p) { return p && String(p).trim(); }).join(' - ');
}

// Applies the collected formatting ops after a single bulk setValues, so we never
// pay per-cell setValue costs (the standalone issued thousands of them per tab).
function eomApplyOps_(sheet, ops) {
  var SOLID = SpreadsheetApp.BorderStyle.SOLID;
  ops.forEach(function (op) {
    var rng = sheet.getRange(op.r, op.c, op.nr || 1, op.nc || 1);
    if (op.merge) rng.merge();
    if (op.bg) rng.setBackground(op.bg);
    if (op.fg) rng.setFontColor(op.fg);
    if (op.bold) rng.setFontWeight('bold');
    if (op.size) rng.setFontSize(op.size);
    if (op.italic) rng.setFontStyle('italic');
    if (op.align) rng.setHorizontalAlignment(op.align);
    rng.setVerticalAlignment(op.valign || 'middle');
    if (op.wrap) rng.setWrap(true);
    if (op.numfmt) rng.setNumberFormat(op.numfmt);
    if (op.border) rng.setBorder(op.border[0], op.border[1], op.border[2], op.border[3], false, false, op.bc || null, SOLID);
  });
}

/** Builds one formatted tab per organization from the SHARED grouped data
 * (eomGroupForReport_ — same source feeds the PDFs). Ports
 * BillingDashboard.buildDashboard's layout (org header → per contact: stats,
 * product summary + TOTAL, per-deal line items with a Pipedrive hyperlink),
 * writing values in a single setValues per tab and formatting in blocks.
 * Returns the org-tab count. */
function eomBuildOrgTabs_(ss, group) {
  var dealBase = eomDealBaseUrl_();
  var S = {
    darkBg: '#1a3a5c', darkFg: '#ffffff', midBg: '#2d6a9f', midFg: '#ffffff',
    contactBg: '#3a3a6c', contactFg: '#ffffff', statsBg: '#dce8f5', totalsBg: '#c8d8f0',
    dealBg: '#e8f0e0', dealFg: '#1a3a1a', dealFieldHdrBg: '#b8d4b8', dealFieldHdrFg: '#1a3a1a',
    dealColHdrBg: '#c8dfc8', dealColHdrFg: '#1a3a1a', altBg: '#f4f8fd', altDealBg: '#f2f7ee',
    border: '#b0c8e8', dealBorder: '#8ab88a'
  };
  var SUMMARY_COLS = 8, DEAL_COLS = 7, TOTAL_COLS = 8, EMPTY = '—';
  var MONEY = '$#,##0.00';
  var used = {};

  group.forEach(function (og) {
    var org = og.org;
    var sheet = ss.insertSheet(eomSafeTabName_(org, used));
    [150, 180, 220, 110, 70, 100, 100, 320].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

    var matrix = [], ops = [];
    function row8(a) { var r = a.slice(0, 8); while (r.length < 8) r.push(''); matrix.push(r); return matrix.length; }

    var rOrg = row8([org]);
    ops.push({ r: rOrg, c: 1, nc: TOTAL_COLS, merge: true, bg: S.darkBg, fg: S.darkFg, bold: true, size: 16, align: 'center', border: [true, true, true, true], bc: S.border });
    row8([]);

    og.contacts.forEach(function (ct) {
      var orderCount = ct.stats.orders, totalDups = ct.stats.duplicates;
      var summaryRows = ct.summaryRows;
      var totalQty = ct.stats.totalQty, totalAmt = ct.stats.totalAmt;
      var deals = ct.deals;

      // Contact header (omitted for a merged pseudo-contact — the contact then
      // rides on each deal row instead)
      if (!ct.merged) {
        var rc = row8(['Contact: ' + ct.contact]);
        ops.push({ r: rc, c: 1, nc: TOTAL_COLS, merge: true, bg: S.contactBg, fg: S.contactFg, bold: true, size: 11, align: 'center', border: [true, true, true, true], bc: S.border });
      }
      // Stats row
      var rs = row8(['Orders (unique deals):', orderCount, '', 'Total duplicates:', totalDups]);
      ops.push({ r: rs, c: 1, nc: TOTAL_COLS, bg: S.statsBg, size: 10, border: [false, true, true, true], bc: S.border });
      row8([]);

      // Summary label + headers
      var rSl = row8(['Overall product summary']);
      ops.push({ r: rSl, c: 1, nc: SUMMARY_COLS, merge: true, bg: S.midBg, fg: S.midFg, bold: true, size: 13, align: 'center', border: [true, true, true, true], bc: S.border });
      var rSh = row8(['Product Code', 'Product Name', 'Description', 'Variation', 'Qty', 'Total Value', 'Notes', 'Full Label']);
      ops.push({ r: rSh, c: 1, nc: SUMMARY_COLS, bg: S.darkBg, fg: S.darkFg, bold: true, size: 10, align: 'center', border: [true, true, true, true], bc: S.border });
      summaryRows.forEach(function (p, i) {
        var rr = row8([p.code, p.name, p.desc, p.vari || EMPTY, p.qty, p.amt, p.notesStr, eomBuildFullLabel_(p.name, p.desc, p.vari, p.notesStr)]);
        ops.push({ r: rr, c: 1, nc: SUMMARY_COLS, bg: i % 2 === 0 ? '#ffffff' : S.altBg, size: 10, wrap: true, align: 'center', border: [false, true, false, true], bc: S.border });
        ops.push({ r: rr, c: 6, numfmt: MONEY });
      });
      // Totals row
      var rT = row8(['TOTAL', '', '', '', totalQty, totalAmt, '', '']);
      ops.push({ r: rT, c: 1, nc: 4, merge: true, bold: true, size: 10, align: 'center' });
      ops.push({ r: rT, c: 5, bold: true, size: 10, align: 'center' });
      ops.push({ r: rT, c: 6, bold: true, size: 10, align: 'center', numfmt: MONEY });
      ops.push({ r: rT, c: 7, nc: 2, merge: true, align: 'center' });
      ops.push({ r: rT, c: 1, nc: SUMMARY_COLS, bg: S.totalsBg, border: [true, true, true, true], bc: S.border });
      row8([]);

      // Per-deal breakdown
      var rPd = row8(['Per-deal breakdown']);
      ops.push({ r: rPd, c: 1, nc: DEAL_COLS, merge: true, bg: S.dealBg, fg: S.dealFg, bold: true, size: 16, align: 'center', border: [true, true, true, true], bc: S.dealBorder });
      deals.forEach(function (deal) {
        var url = dealBase + deal.id;
        var safeTitle = (deal.title || ('Deal ' + deal.id)).replace(/"/g, '""');
        var createdDate = deal.created ? deal.created.substring(0, 10) : '';
        // Deal field labels (col 6 = Contact — always shown; the value is the
        // deal's own contact, load-bearing when the contact header is merged away)
        var rDl = row8(['Deal', 'Owner', 'Created', 'Duplicates', 'Deal Value', 'Contact', '']);
        ops.push({ r: rDl, c: 1, nc: DEAL_COLS, bg: S.dealFieldHdrBg, fg: S.dealFieldHdrFg, bold: true, size: 9, italic: true, align: 'center', border: [true, true, false, true], bc: S.dealBorder });
        // Deal data (col 1 is a HYPERLINK formula written via setValues)
        var rDd = row8(['=HYPERLINK("' + url + '","' + safeTitle + '")', deal.owner, createdDate, deal.duplicates, deal.dealValue, deal.contact || ct.contact || '', '']);
        ops.push({ r: rDd, c: 1, nc: DEAL_COLS, bg: S.dealBg, fg: S.dealFg, bold: true, size: 12, align: 'center', border: [false, true, true, true], bc: S.dealBorder });
        ops.push({ r: rDd, c: 5, numfmt: MONEY });
        // Product headers
        var rPh = row8(['Product Code', 'Product Name', 'Variation', 'Quantity', 'Unit Price', 'Amount', 'Description']);
        ops.push({ r: rPh, c: 1, nc: DEAL_COLS, bg: S.dealColHdrBg, fg: S.dealColHdrFg, bold: true, size: 9, align: 'center', border: [false, true, true, true], bc: S.dealBorder });
        // Line items
        var lastLineRow = rPh;
        deal.lines.forEach(function (line, i) {
          var descNotes = [line.desc, line.notes].filter(function (s) { return s && s.trim(); }).join(' - ');
          var rL = row8([line.code, line.name, line.vari || EMPTY, line.qty, line.price, line.sum, descNotes]);
          ops.push({ r: rL, c: 1, nc: DEAL_COLS, bg: i % 2 === 0 ? '#ffffff' : S.altDealBg, size: 10, wrap: true, align: 'center', border: [false, true, false, true], bc: S.dealBorder });
          ops.push({ r: rL, c: 5, numfmt: MONEY });
          ops.push({ r: rL, c: 6, numfmt: MONEY });
          lastLineRow = rL;
        });
        ops.push({ r: lastLineRow, c: 1, nc: DEAL_COLS, border: [false, true, true, true], bc: S.dealBorder }); // close the deal block
        row8([]);
      });
      row8([]); row8([]);
    });

    sheet.getRange(1, 1, matrix.length, 8).setValues(matrix);
    eomApplyOps_(sheet, ops);
  });

  return group.length;
}

// ── Progress (cross-execution, mirrors the run-progress pattern) ─────────────

function eomSetProgress_(runId, obj) {
  try { PropertiesService.getScriptProperties().setProperty('eom_progress_' + runId, JSON.stringify(obj)); } catch (e) {}
}
/** Client-callable: poll for report progress. */
function getEomProgress(runId) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('eom_progress_' + runId) || '{}'); }
  catch (e) { return {}; }
}
/** Client-callable: clear a finished run's progress. */
function clearEomProgress(runId) {
  try { PropertiesService.getScriptProperties().deleteProperty('eom_progress_' + runId); } catch (e) {}
  return { ok: true };
}

// ── Client-callable entry points ────────────────────────────────────────────

/** Bootstrap for the EOM view: connection state, pipeline, default stage, stages,
 *  and the reports index list. The reports list is present even when Pipedrive
 *  isn't configured (viewing/finalizing existing reports needs no Pipedrive). */
function getEomBootstrap() {
  var reports = eomIndexList_();
  var status = getPipedriveStatus();
  if (!status.configured) return { configured: false, reports: reports };
  var pipelineId = eomGetPipelineId_();
  return {
    configured: true,
    pipelineId: pipelineId,
    defaultStageId: eomGetDefaultStageId_(),
    stages: pdEomListStages_(pipelineId),
    reports: reports
  };
}

/** Client-callable: persist the EOM pipeline + default stage. */
function saveEomSettings(pipelineId, defaultStageId) {
  var pid = parseInt(pipelineId, 10);
  var sid = parseInt(defaultStageId, 10);
  setPipedriveSettingValue_(PD_EOM_PIPELINE_KEY, isNaN(pid) ? '' : String(pid));
  setPipedriveSettingValue_(PD_EOM_STAGE_KEY, isNaN(sid) ? '' : String(sid));
  return { ok: true, pipelineId: eomGetPipelineId_(), defaultStageId: eomGetDefaultStageId_(), stages: pdEomListStages_(eomGetPipelineId_()) };
}

/** Client-callable: the reports index (newest month first) for the in-app card. */
function getEomReportsList() { return eomIndexList_(); }

/** Client-callable: the report.json payload for a month, as a STRING (client
 *  JSON.parses it — dodges Date-serialization; faster for large payloads). This
 *  is the MAIN-APP review endpoint (any generated report); the standalone viewer
 *  has its own published-only reader. */
function getEomReportJson(monthLabel) {
  var found = eomIndexGetRow_(eomMonthKey_(monthLabel));
  if (!found) return { ok: false, error: 'No report found for ' + monthLabel + '.' };
  var fileId = String(found.row[EOMIDX.JSON_FILE_ID] || '');
  if (!fileId) return { ok: false, error: 'That report has no data file.' };
  try { return { ok: true, json: DriveApp.getFileById(fileId).getBlob().getDataAsString() }; }
  catch (e) { return { ok: false, error: 'Could not read report data: ' + e.message }; }
}

/** Client-callable: LIVE pull of the default EOM stage → the same {group, meta}
 *  JSON shape as report.json, so the in-app viewer renders it exactly like an
 *  archived month (mirrors the standalone viewer's getCurrentReport — keep the
 *  meta shape in sync). Read-only: GETs only; writes nothing (no Drive file,
 *  no index row). */
function getEomCurrentReport() {
  try {
    if (!getPipedriveStatus().configured) return { ok: false, error: 'Pipedrive is not connected.' };
    var stageId = eomGetDefaultStageId_();
    var deals = eomListDeals_('stage', stageId);
    var rows = [], CHUNK = 100;
    for (var i = 0; i < deals.length; i += CHUNK) {
      var batch = deals.slice(i, i + CHUNK);
      var productsByDeal = pdEomFetchProductsForDeals_(batch.map(function (d) { return d.id; }));
      batch.forEach(function (deal) { rows = rows.concat(eomBuildRows_(deal, productsByDeal[deal.id] || [])); });
      if (i + CHUNK < deals.length) Utilities.sleep(800);
    }
    var group = eomGroupForReport_(rows);
    var meta = {
      current: true, stageId: String(stageId), stageName: eomStageName_(stageId),
      monthLabel: 'Current — EOM Merge',
      generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss'),
      orgCount: group.length, dealCount: deals.length,
      dealBaseUrl: eomDealBaseUrl_(),
      splitContacts: false
    };
    return { ok: true, json: JSON.stringify({ group: group, meta: meta }) };
  } catch (e) {
    return { ok: false, error: 'Current pull failed: ' + e.message };
  }
}

/** Client-callable: publish a month. Snapshots report.json -> published.json in
 *  the month folder (a SEPARATE file — invariant 1: later re-runs overwrite
 *  report.json but never the snapshot) and flips the index row to published. */
function finalizeEomReport(monthLabel) {
  var found = eomIndexGetRow_(eomMonthKey_(monthLabel));
  if (!found) return { ok: false, error: 'No report found for ' + monthLabel + '.' };
  var fileId = String(found.row[EOMIDX.JSON_FILE_ID] || '');
  if (!fileId) return { ok: false, error: 'Nothing generated to publish yet.' };

  var pubId;
  try {
    var src = DriveApp.getFileById(fileId);
    var parents = src.getParents(), folder = parents.hasNext() ? parents.next() : null;
    var blob = Utilities.newBlob(src.getBlob().getDataAsString(), 'application/json', 'published.json');
    pubId = (folder ? eomPutFile_(folder, blob, 'published.json') : DriveApp.createFile(blob)).getId();
  } catch (e) { return { ok: false, error: 'Snapshot failed: ' + e.message }; }

  var tz = Session.getScriptTimeZone() || 'America/Chicago';
  var at = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var by = ''; try { by = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  var sh = found.sheet, rowNum = found.rowNum;
  sh.getRange(rowNum, EOMIDX.STATUS + 1, 1, 1).setNumberFormat('@');
  sh.getRange(rowNum, EOMIDX.STATUS + 1, 1, 1).setValue('published');
  sh.getRange(rowNum, EOMIDX.PUBLISHED_AT + 1, 1, 3).setNumberFormat('@');
  sh.getRange(rowNum, EOMIDX.PUBLISHED_AT + 1, 1, 3).setValues([[at, String(by), String(pubId)]]);
  return { ok: true, monthLabel: monthLabel, publishedAt: at, publishedBy: by };
}

/**
 * Client-callable: pull deals for the scope/stage, fetch products in parallel
 * batches, and build a NEW dated report file. Emits progress under runId.
 * @returns {{ok:boolean, url?, name?, orgCount?, dealCount?, rowCount?, error?}}
 */
function generateEomReport(scope, stageId, runId, monthLabel, splitContacts) {
  runId = String(runId || 'eom');
  monthLabel = String(monthLabel || '').trim() || eomCurrentMonthLabel_();
  splitContacts = splitContacts === true;   // default OFF: merged PDFs/org tabs
  try {
    if (!pdGetSecrets_()) { eomSetProgress_(runId, { message: 'Pipedrive not connected.', percent: 100, done: true, error: 'Pipedrive is not configured.' }); return { ok: false, error: 'Pipedrive is not configured.' }; }
    eomSetProgress_(runId, { message: 'Fetching deals…', percent: 5, done: false, error: null });
    var deals = eomListDeals_(scope, stageId);
    if (!deals.length) {
      var none = 'No deals found for the selected ' + (scope === 'full_billing' ? 'billing pipeline.' : 'stage.');
      eomSetProgress_(runId, { message: none, percent: 100, done: true, error: none });
      return { ok: false, error: none };
    }

    var allRows = [], CHUNK = 100;
    for (var i = 0; i < deals.length; i += CHUNK) {
      var batch = deals.slice(i, i + CHUNK);
      eomSetProgress_(runId, { message: 'Fetching products ' + Math.min(i + CHUNK, deals.length) + ' / ' + deals.length + '…', percent: 5 + Math.round(45 * (i / deals.length)), done: false, error: null });
      var productsByDeal = pdEomFetchProductsForDeals_(batch.map(function (d) { return d.id; }));
      batch.forEach(function (deal) { allRows = allRows.concat(eomBuildRows_(deal, productsByDeal[deal.id] || [])); });
      if (i + CHUNK < deals.length) Utilities.sleep(800);
    }

    eomSetProgress_(runId, { message: 'Building spreadsheet…', percent: 60, done: false, error: null });
    var result = eomWriteReport_(allRows, scope, monthLabel, runId, stageId, splitContacts);

    // Index this generation (leaves any published snapshot untouched — invariant 1).
    if (result.jsonFileId) {
      try {
        eomIndexUpsert_({
          monthKey: result.monthKey, monthLabel: monthLabel, scope: scope, stageId: stageId,
          generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HH:mm:ss'),
          jsonFileId: result.jsonFileId, folderUrl: result.folderUrl, ssUrl: result.url,
          orgCount: result.orgCount, dealCount: result.dealCount
        });
      } catch (e) { Logger.log('EOM: index upsert failed (non-fatal): ' + e.message); }
    }

    eomSetProgress_(runId, { message: 'Done — ' + result.orgCount + ' org tab(s), ' + result.pdfCount + ' PDF(s).', percent: 100, done: true, error: null, url: result.folderUrl });
    return { ok: true, url: result.url, folderUrl: result.folderUrl, name: result.name, orgCount: result.orgCount, pdfCount: result.pdfCount, dealCount: deals.length, rowCount: allRows.length, monthLabel: monthLabel };
  } catch (e) {
    eomSetProgress_(runId, { message: 'Error: ' + e.message, percent: 100, done: true, error: e.message });
    return { ok: false, error: e.message };
  }
}


// ============================================================================
// SECTION 34: HOME DASHBOARD ENDPOINTS
// ============================================================================
//
// Read-only feeds for the reworked Home view. Three client-invoked endpoints
// (google.script.run surface) + tiny private helpers. No writes anywhere.
// Pipedrive/EOM lookups are best-effort and can never throw into the caller
// (pdFetch_ philosophy). NEVER SpreadsheetApp.getUi() here — client-invoked.
// These replaced the old whole-grid getDashboardView() read (retired).
// ============================================================================

/** RUN_LOG rows (23 cols A–W) minus test runs, in append order. ONE read. */
function readRunLog_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RUN_LOG');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 23).getValues()
    .filter(function(r) { return String(r[3]).trim().toLowerCase() !== 'test'; });
}

/** Log-sheet timestamp cell → 'yyyy-MM-dd HH:mm:ss' string (cells occasionally
 *  coerce to Date; same idiom as getRunsForDealer). */
function runLogTs_(v) {
  return v instanceof Date
    ? Utilities.formatDate(v, 'America/Chicago', 'yyyy-MM-dd HH:mm:ss')
    : String(v || '').trim();
}

/** 'yyyy-MM-dd HH:mm[:ss]' → 'EEE MMM dd yyyy h:mm a' (VIN Inbox display
 *  convention); malformed input passes through unchanged. */
function homeDisplayTs_(ts) {
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(ts || ''));
  if (!m) return String(ts || '');
  // new Date(parts) builds in the script timezone (America/Chicago) — same zone
  // the RUN_LOG/IMPORT_STATS strings were written in.
  var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Chicago', 'EEE MMM dd yyyy h:mm a');
}

/**
 * Client-callable. Home HUD stats from ONE RUN_LOG read (test runs excluded).
 * Rows with malformed/blank timestamps are skipped from today/week but still
 * count all-time.
 * @returns {{lastImport:{date:string,time:string},
 *            today:{runs:number,vins:number,dealers:number,dupes:number},
 *            week:{runs:number,vins:number,dealers:number,dupes:number},
 *            allTime:{runs:number,vins:number,avgVinsPerRun:number,
 *                     committed:number,pending:number,rolledBack:number}}}
 */
function getHomeHud() {
  var rows = readRunLog_();
  var tz = 'America/Chicago';
  var now = new Date();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };   // days since Monday
  var offset = DOW[Utilities.formatDate(now, tz, 'EEE')] || 0;
  // ponytail: minus N*24h drifts an hour across a DST boundary — only wrong
  // within an hour of midnight, and only for the week bucket. Fine for a HUD.
  var mondayStr = Utilities.formatDate(new Date(now.getTime() - offset * 86400000), tz, 'yyyy-MM-dd');

  function bucket() { return { runs: 0, vins: 0, dupes: 0, _dealers: {} }; }
  function add(b, r) {
    b.runs++;
    b.vins  += Number(r[15]) || 0;   // P: total_produced
    b.dupes += Number(r[14]) || 0;   // O: total_dupes
    b._dealers[String(r[1])] = true;
  }
  function pack(b) { return { runs: b.runs, vins: b.vins, dealers: Object.keys(b._dealers).length, dupes: b.dupes }; }

  var today = bucket(), week = bucket();
  var allTime = { runs: rows.length, vins: 0, avgVinsPerRun: 0, committed: 0, pending: 0, rolledBack: 0 };

  rows.forEach(function(r) {
    allTime.vins += Number(r[15]) || 0;
    var st = String(r[22]).trim();                 // W: vin_log_status
    if (st === 'committed') allTime.committed++;
    else if (st === 'rolled_back') allTime.rolledBack++;
    else allTime.pending++;

    var day = runLogTs_(r[0]).slice(0, 10);        // string prefix compare is safe
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;  // malformed ts → all-time only
    if (day === todayStr) add(today, r);
    if (day >= mondayStr && day <= todayStr) add(week, r);
  });

  allTime.avgVinsPerRun = allTime.runs ? Math.round(allTime.vins / allTime.runs * 10) / 10 : 0;

  var st = getAppHomeStatus();
  return {
    lastImport: { date: st.lastImportDate, time: st.lastImportTime },
    today:      pack(today),
    week:       pack(week),
    allTime:    allTime
  };
}

/**
 * {orgId → deal count} for the default EOM stage, cached 10 min in the script
 * cache (key 'eom_org_counts_v1'). GET requests only. Returns null on ANY
 * failure or when Pipedrive isn't configured — an EOM/Pipedrive problem can
 * never break getDealerSummary (pdFetch_ philosophy).
 */
function getEomOrgCountsCached_() {
  try {
    if (!getPipedriveStatus().configured) return null;
    var cache = CacheService.getScriptCache();
    var hit = cache.get('eom_org_counts_v1');
    if (hit) return JSON.parse(hit);

    // Same stage resolution as getEomCurrentReport: configured default EOM stage.
    var deals = eomListDeals_('stage', eomGetDefaultStageId_());
    var counts = {};
    deals.forEach(function(d) {
      var o = d.org_id;   // v1 list shape: object {name, value, …} (or a bare id)
      var id = Number(o && typeof o === 'object' ? o.value : o);
      if (!id) return;
      counts[id] = (counts[id] || 0) + 1;
    });
    try { cache.put('eom_org_counts_v1', JSON.stringify(counts), 600); } catch (e) {}
    return counts;
  } catch (e) {
    return null;
  }
}

/**
 * Client-callable. Per-dealer roll-up for the Home dashboard drill-in.
 * inventory is null when the dealer's scraper location is absent from the
 * newest import; eomOrders is null when Pipedrive is unconfigured/unreachable
 * or the dealer has no linked org.
 * @param {string} dealerKey
 * @returns {{dealerName:string,
 *            inventory:?{byType:Object<string,number>,total:number,onlot:number,
 *                        offlot:number,noPrice:number,noStock:number,asOf:string},
 *            runStats:{runs:number,vinsOrdered:number,vinsProduced:number,
 *                      avgMatchPct:number,byType:{new:number,po:number,cpo:number,cpoEl:number}},
 *            lastRun:?{ts:string,orderId:string,ordered:number,produced:number,
 *                      durationSec:number,vinLogStatus:string},
 *            eomOrders:?number} | {error:string}}
 */
function getDealerSummary(dealerKey) {
  var config = getDealerConfig_(dealerKey);
  if (!config) return { error: 'Unknown dealer' };

  // ── Inventory: this dealer's row in the NEWEST import (IMPORT_STATS tail) ──
  var inventory = null;
  try {
    var loc = String(config[CFG.SCRAPER_LOCATION] || '').trim();
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IMPORT_STATS');
    var lastRow = sh ? sh.getLastRow() : 0;
    if (loc && lastRow >= 2) {
      var TAIL = 2000;   // same constant-time tail as checkImportHealth_
      var start = Math.max(2, lastRow - TAIL + 1);
      var data = sh.getRange(start, 1, lastRow - start + 1, 13).getValues();
      var newest = '';
      data.forEach(function(r) { var t = runLogTs_(r[0]); if (t > newest) newest = t; });
      for (var i = data.length - 1; i >= 0; i--) {
        var r = data[i];
        if (runLogTs_(r[0]) !== newest || String(r[1]).trim() !== loc) continue;
        inventory = {
          byType: {
            'New':    Number(r[3]) || 0,
            'PO':     Number(r[4]) || 0,
            'CPO':    Number(r[5]) || 0,
            'CPO-EL': Number(r[6]) || 0,
            'Other':  Number(r[7]) || 0
          },
          total:   Number(r[2])  || 0,
          onlot:   Number(r[8])  || 0,
          offlot:  Number(r[9])  || 0,
          noPrice: Number(r[11]) || 0,
          noStock: Number(r[12]) || 0,
          asOf:    homeDisplayTs_(newest)
        };
        break;
      }
    }
  } catch (e) {
    inventory = null;   // no inventory data ≠ a broken summary
  }

  // ── Run stats + last run (RUN_LOG, test runs already excluded) ─────────────
  var runs = readRunLog_().filter(function(r) { return String(r[1]).trim() === dealerKey; });
  var runStats = {
    runs: runs.length, vinsOrdered: 0, vinsProduced: 0, avgMatchPct: 0,
    byType: { new: 0, po: 0, cpo: 0, cpoEl: 0 }
  };
  var matched = 0;
  runs.forEach(function(r) {
    runStats.vinsOrdered  += Number(r[4])  || 0;   // E: total_ordered
    matched               += Number(r[5])  || 0;   // F: total_matched
    runStats.vinsProduced += Number(r[15]) || 0;   // P: total_produced
    runStats.byType.new   += Number(r[6])  || 0;   // G–J: per-type gross
    runStats.byType.po    += Number(r[7])  || 0;
    runStats.byType.cpo   += Number(r[8])  || 0;
    runStats.byType.cpoEl += Number(r[9])  || 0;
  });
  runStats.avgMatchPct = runStats.vinsOrdered
    ? Math.round(1000 * matched / runStats.vinsOrdered) / 10 : 0;

  var lastRun = null;
  if (runs.length) {
    var last = runs[runs.length - 1];   // append order → last = newest
    lastRun = {
      ts:           homeDisplayTs_(runLogTs_(last[0])),
      orderId:      String(last[3]).trim(),
      ordered:      Number(last[4])  || 0,
      produced:     Number(last[15]) || 0,
      durationSec:  Number(last[18]) || 0,
      vinLogStatus: String(last[22]).trim() || 'pending'   // '' = pending, same as getRunsForDealer
    };
  }

  // ── EOM open orders: sum cached per-org counts over this dealer's org(s) ───
  var eomOrders = null;
  try {
    var counts = getEomOrgCountsCached_();
    if (counts) {
      var seen = {};
      getPipedriveDealerRows_(dealerKey).forEach(function(row) {
        var id = Number(row.orgId);
        if (!id || seen[id]) return;   // numeric keys — the string-vs-number id trap
        seen[id] = true;
        eomOrders = (eomOrders || 0) + (Number(counts[id]) || 0);
      });
    }
  } catch (e) {
    eomOrders = null;
  }

  return {
    dealerName: String(config[CFG.NAME] || dealerKey),
    inventory:  inventory,
    runStats:   runStats,
    lastRun:    lastRun,
    eomOrders:  eomOrders
  };
}

/**
 * Client-callable. The DASHBOARD 'INVENTORY SNAPSHOT' section as display
 * strings for the Home view: banner → header row → per-location rows →
 * TOTALS row. Fail-soft: missing sheet/section returns empty arrays + an
 * error message, never throws.
 * @returns {{headers:Array<string>, rows:Array<Array<string>>,
 *            totals:?Array<string>, error:(string|undefined)}}
 */
function getInventorySnapshot() {
  function empty() { return { headers: [], rows: [], totals: null, error: 'No snapshot — run an import' }; }
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DASHBOARD');
    if (!sh || sh.getLastRow() < 1) return empty();
    var grid = sh.getDataRange().getDisplayValues();

    // Banner row = exactly one filled cell STARTING WITH 'INVENTORY SNAPSHOT'
    // (the live sheet reads 'INVENTORY SNAPSHOT — BREAKDOWN BY LOCATION';
    // exact-match missed it — the sheet-resident banner text can drift).
    var banner = -1;
    for (var i = 0; i < grid.length; i++) {
      var filled = grid[i].filter(function(c) { return String(c).trim() !== ''; });
      if (filled.length === 1 && filled[0].trim().toUpperCase().indexOf('INVENTORY SNAPSHOT') === 0) { banner = i; break; }
    }
    if (banner === -1 || banner + 2 >= grid.length) return empty();

    var headerRow = grid[banner + 1];
    var width = headerRow.length;
    while (width > 0 && String(headerRow[width - 1]).trim() === '') width--;
    if (!width) return empty();
    function slice(row) { return row.slice(0, width).map(String); }

    var rows = [], totals = null;
    for (var r = banner + 2; r < grid.length; r++) {
      var first = String(grid[r][0]).trim();
      if (first.toUpperCase() === 'TOTALS') { totals = slice(grid[r]); break; }
      if (!first) break;   // spacer = section ended without a TOTALS row
      rows.push(slice(grid[r]));
    }
    if (!rows.length && !totals) return empty();
    return { headers: slice(headerRow), rows: rows, totals: totals };
  } catch (e) {
    return { headers: [], rows: [], totals: null, error: 'Snapshot read failed: ' + e.message };
  }
}


// ============================================================================
// END OF SCRIPT
// ============================================================================