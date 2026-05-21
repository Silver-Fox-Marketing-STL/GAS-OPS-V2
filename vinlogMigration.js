// =============================================================================
// SECTION 18: MIGRATION / AUDIT HELPER
// =============================================================================

/**
 * Flags active dealers still missing placeholder IDs in SF_DEALER_CONFIG.
 * Run from the script editor once all IDs have been filled in to verify.
 */
function auditConfigPlaceholders() {
  var data = SpreadsheetApp.openById(CONFIG_SHEET_ID)
    .getSheetByName('DEALERS').getDataRange().getValues();
  var incomplete = [];
  for (var i = 1; i < data.length; i++) {
    if (!isTrue_(data[i][CFG.ACTIVE])) continue;
    var missing = [];
    if (data[i][CFG.VIN_LOG_ID]    === '[VIN_LOG_ID]')       missing.push('vin_log_id');
    if (data[i][CFG.QR_FOLDER_ID]  === '[QR_FOLDER_ID]')     missing.push('qr_folder_id');
    if (data[i][CFG.OUTPUT_FOLDER] === '[OUTPUT_FOLDER_ID]') missing.push('output_folder_id');
    if (missing.length > 0) incomplete.push(data[i][CFG.KEY] + ': ' + missing.join(', '));
  }
  var msg = incomplete.length === 0
    ? 'All active dealers configured. Ready to go!'
    : incomplete.length + ' dealers need IDs:\n\n' + incomplete.join('\n');
  SpreadsheetApp.getUi().alert(msg);
}

// =============================================================================
// SECTION 19: VIN LOG MIGRATION (ONE-TIME USE)
// =============================================================================

/**
 * Migrates all legacy per-dealer VIN log spreadsheets into SF_VIN_LOGS.
 * Creates one tab per dealer named by dealer_key.
 * Run ONCE from the script editor. Safe to re-run — overwrites existing tabs.
 *
 * Special cases handled:
 *   - BOMMARITO_CADILLAC: VIN in corrupted header row captured as data row
 *   - DAVE_SINCLAIR_LINCOLN: Two VIN columns (SoCo col B + Manchester col E) merged
 *   - All others: col A (ORDER_ID) and col B (VIN) only
 */
function migrateVINLogs() {
  // Map of dealer_key -> {id: spreadsheetId, special: optional handler}
  var LOGS = [
    { key: 'JOE_MACHENS_NISSAN',      id: '1UCbMbj2mYha228z-ISqFu-IabhPBOTRy-4JBUG3jKeY' },
    { key: 'JOE_MACHENS_CDJR',        id: '1dUSJZ5lXTpC3OYJkqdz6EU1oe9Nr2M4al9E0-0oNPFY' },
    { key: 'JOE_MACHENS_HYUNDAI',     id: '1yRyDl6XfhOl2R3uuPhkM3JBVTO6LvpppShguOwtFK0E' },
    { key: 'KIA_OF_COLUMBIA',         id: '1DiKiiHXRCwEW9qLmuINOmPngydcPFboa3EKidYAE2uQ' },
    { key: 'AUFFENBERG_HYUNDAI',      id: '1zRLGL2K3SmTjeLwbZ9L6uQqOSKpI-S63Nuv8NTp_dtA' },
    { key: 'HONDA_OF_FRONTENAC',      id: '1CNG87KOIhgCfriYbLJt9CEyeFtQk1CQBUZiDH39ah2c' },
    { key: 'PORSCHE_STL',             id: '1uHdDwmcRCklT1b53rbyqoY9yxckkcUfQytZARgnj3bA' },
    { key: 'PAPPAS_TOYOTA',           id: '1OHG9RfI5E6E5uMIxnnrSx3zB7w2vv5HBJT7r3oCvVlQ' },
    { key: 'TWIN_CITY_TOYOTA',        id: '1ZAQTh_oOTK4j-lNLHxaCKHtA-IiYu9vN-MvzbXY7518' },
    { key: 'BOMMARITO_CADILLAC',      id: '1Jl936TfGeGiFv9FogkVgwYQn8zLKoNWzfBj_Q0MIGK4', special: 'BOMM_HEADER_VIN' },
    { key: 'SERRA_HONDA',             id: '1wTBdt8AHXr5QcYX9AJMCRo4qTbnj-2ewW-AXcUs7SeU' },
    { key: 'SOCO_DCJR',              id: '1FPg6heCUvGlj4TN1sEqO12GCrQ1gQYB_5nS3AqbmSKE' },
    { key: 'GLENDALE_CDJR',          id: '1E_Obyjx-IMTjgl7A7Y0XAUV3sSP1a19iSHVr_O8dZSQ' },
    { key: 'DAVE_SINCLAIR_LINCOLN',   id: '1R-jv9LjSWQ8SIqmKS1EJkLDJOpiPYzhAqmJ_iJNZbFM', special: 'DS_TWO_COLS' },
    { key: 'SUNTRUP_KIA_SOUTH',       id: '1Xnzu1szrnbHQN6k1jBBEuohMqEc1HXbj8oeafVkxuV0' },
    { key: 'RUSTY_DREWING_CHEVY',     id: '1hBBSHUTqW_y8Vv-qIcV9UvXFTNwrxaMxtJJ8rm9SllA' },
    { key: 'PUNDMANN_FORD',           id: '1O6xRWpWjbhI3-yc7L1erR22wl1ooaxZIjiB1W0LzGrQ' },
    { key: 'BMW_OF_COLUMBIA',         id: '1fBcegfzKlgG8vA4ReO6lCIw_0QczyyEJ0cdIij4wuqQ' },
    { key: 'TOM_STEHOUWER',           id: '1hwtZ0tYipHcXsWlAt0OVlWg2_k5kF-2OPC8jsPnNPxI' },
    { key: 'RUSTY_DREWING_CADILLAC',  id: '1j3gHZlLqYNXvNUsEHsbYEioO-H1RbWkFH661XgStIck' },
    { key: 'JOE_MACHENS_TOYOTA',      id: '1UaZ1JJEYZNmJdiCyma6_OP_enPRln2pq_7AX3oEuuv4' },
    { key: 'LAND_ROVER_RANCHO',       id: '1If0sEdObx5Mqd8SflHxebC3M3BA7ub0pPOOqfNbW9Bo' },
    { key: 'AUDI_RANCHO',             id: '13j6or4dVkHONly1M3ckU_mIEN174_YSg_HrYB7HNueI' },
    { key: 'INDIGO_AUTO',             id: '1HdaLkUKQRIMtdlcK6_uOIpzX8eFMgqGRFnjR36ZClyw' },
    { key: 'JAGUAR_RANCHO',           id: '1EGQFYCcm46u5ZLFptLlsQzLmPkPjKyPOVrhnXn9ZqlU' },
    { key: 'SUNTRUP_HYUNDAI_SOUTH',   id: '1TRD5DxYA7fBkSjOkwBKIV7FYRMEpGNFXzBdAy_OIDak' },
    { key: 'VOLVO_WEST_COUNTY',       id: '1Q-jKOze-_SSdD4MwdYbdBGc6DYgKHx-d_-Cz6YSE_Bc' },
    { key: 'THOROUGHBRED_FORD',       id: '1YGGweShcymGaO9xHUFZv1S5ELqQGxj73CTAsXub_1TQ' },
    { key: 'DAVE_SINCLAIR_ST_PETERS', id: '1pBjRgETH3706ANNvL4IuMROU6lHrH7ZPI6iKUggFyvk' },
    { key: 'SUNTRUP_BUICK_GMC',       id: '1sPmI3A0ev0j1dK6jgVthsvWQ1mURSVrvOXffeEUM8wA' },
    { key: 'COLUMBIA_HONDA',          id: '1CohBJZMIHGgvLSYu6VE_D7nc9DPdYfdJuXH9wbq9z_w' },
    { key: 'SUNTRUP_FORD_WESTPORT',   id: '1HkNGQx1SI-nDs5hL9gt-CD68XowiyzV3zO4YJNHFtrQ' },
    { key: 'HW_KIA',                  id: '1rbuN56tGbFfS_YNmv-5p6ssTDb3hibFutEZtaqRH9AQ' },
    { key: 'FRANK_LETA_HONDA',        id: '1ThEmQztGDUOOcoWPBm2z2c0-_Tqocw-MilWVzpCspqw' },
    { key: 'BMW_WEST_STL',            id: '1v_1WNH1GgAywKvJgtHeIRYdj0Bhu1yRxjdtKhfnS_eg' },
    { key: 'SUNTRUP_FORD_KIRKWOOD',   id: '1ylF_pRhVRjAlSoxXT2CH_xCHqsVQmD0xFJ92QgLyo3A' },
    { key: 'MERCEDES_CREVE_COEUR',    id: '19xcPt4GIgMjfVtJrV_5X9hsor_FL76puTvvX0zKOoGY' },
    { key: 'AUTOLOANPRO',             id: '1ivc7ERypKlXVr1iCRk1AU2GuqlM2_vNcUAlnks-HHcg' },
    { key: 'NISSAN_JEFFERSON_CITY',   id: '1nUsRBE2GinnFANr2Pkc8c-WKjnAsI7gUOfBpr-d5YJk' },
    { key: 'HYUNDAI_JEFFERSON_CITY',  id: '1Ay2L8xxuI71G7UKyqAryNd5dmvSQorI3F19CpgpxvoU' },
    { key: 'HONDA_JEFFERSON_CITY',    id: '1qh6zWldbYgJa94SDIx-_VuvjeiglmSGsu5kRAGy7ark' },
    // Extra logs not in V2 config — migrated for reference
    { key: '_WEBER',                  id: '1G7PHEJbi2uZYA8BigRadw9IEaIm2ZiVZW23k7hZ4qEM' },
    { key: '_BOMM_WCPO',              id: '190CqBR0He2xz26wWafnGu2ejbyFpQt7FLluaJI6C7-A' },
    { key: '_MINI_ST_LOUIS',          id: '1hCnN7z_gR7vWY9If2Xfpc3NybAkko6vDdof_fbpae3A' },
    { key: '_SPIRIT_LEXUS',           id: '1FxzIi-6pT2S61kgK6x8XjCZ5m-lZp0M1WmjSNcFCrfI' }
  ];

  var masterSS = SpreadsheetApp.openById(VIN_LOGS_ID);
  var succeeded = 0;
  var failed    = [];

  LOGS.forEach(function(entry) {
    try {
      var sourceSS    = SpreadsheetApp.openById(entry.id);
      var sourceSheet = sourceSS.getSheetByName('LOG') || sourceSS.getSheets()[0];
      var lastRow     = sourceSheet.getLastRow();

      // Get or create the target tab named by dealer_key
      var targetSheet = masterSS.getSheetByName(entry.key);
      if (!targetSheet) {
        targetSheet = masterSS.insertSheet(entry.key);
      } else {
        targetSheet.clearContents();
      }

      // Write standardized header
      targetSheet.getRange('A1:B1').setValues([['ORDER_ID', 'VIN']]);

      if (lastRow < 1) {
        // Empty log — header only
        succeeded++;
        return;
      }

      var data = sourceSheet.getDataRange().getValues();

      if (entry.special === 'BOMM_HEADER_VIN') {
        // Bommarito Cadillac: col A row 1 contains a VIN (corrupted header)
        // Capture it as a data row, then read col B for the rest
        var rows = [['', data[0][0]]]; // header VIN, no order ID
        for (var i = 1; i < data.length; i++) {
          if (data[i][1] && String(data[i][1]).trim() !== '') {
            rows.push([data[i][0], data[i][1]]);
          }
        }
        if (rows.length > 0) {
          targetSheet.getRange(2, 1, rows.length, 2).setValues(rows);
        }

      } else if (entry.special === 'DS_TWO_COLS') {
        // Dave Sinclair Lincoln: VINs in col B (SoCo) and col E (Manchester)
        // Merge both into a single column with order IDs from col A and D
        var rows = [];
        for (var i = 1; i < data.length; i++) {
          var vinB = String(data[i][1] || '').trim();
          var vinE = String(data[i][4] || '').trim();
          if (vinB !== '') rows.push([data[i][0], vinB]);
          if (vinE !== '') rows.push([data[i][3] || data[i][0], vinE]);
        }
        if (rows.length > 0) {
          targetSheet.getRange(2, 1, rows.length, 2).setValues(rows);
        }

      } else {
        // Standard: col A = order ID, col B = VIN, skip header row
        var rows = [];
        var startRow = 1; // skip row 0 (header)
        for (var i = startRow; i < data.length; i++) {
          var vin = String(data[i][1] || '').trim();
          if (vin !== '') {
            rows.push([data[i][0], vin]);
          }
        }
        if (rows.length > 0) {
          targetSheet.getRange(2, 1, rows.length, 2).setValues(rows);
        }
      }

      // Format col B as plain text to prevent VIN mangling
      if (targetSheet.getLastRow() > 1) {
        targetSheet.getRange(2, 2, targetSheet.getLastRow() - 1, 1).setNumberFormat('@');
      }

      succeeded++;
      Utilities.sleep(300); // gentle rate limiting between reads

    } catch(e) {
      Logger.log('Failed: ' + entry.key + ' — ' + e.message);
      failed.push(entry.key + ': ' + e.message);
    }
  });

  // Write README tab
  buildVINLogREADME_(masterSS);

  var msg = 'Migration complete.\nSucceeded: ' + succeeded + '\nFailed: ' + failed.length;
  if (failed.length > 0) msg += '\n\nFailed dealers:\n' + failed.join('\n');
  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Writes a README tab to SF_VIN_LOGS explaining the structure.
 */
function buildVINLogREADME_(ss) {
  var sheet = ss.getSheetByName('README') || ss.insertSheet('README');
  sheet.clearContents();
  var content = [
    ['SF_VIN_LOGS — Master VIN Log'],
    [''],
    ['One tab per dealer, named by dealer_key (e.g. AUFFENBERG_HYUNDAI).'],
    ['Tabs prefixed with _ are legacy dealers not in the active V2 config.'],
    [''],
    ['=== COLUMN STRUCTURE ==='],
    ['A: ORDER_ID — The order number or Pipedrive deal ID for that run'],
    ['B: VIN — The vehicle VIN (or stock number for stock-based dealers)'],
    [''],
    ['=== HOW THE SCRIPT USES THIS FILE ==='],
    ['copyVINLogToOutput_(): Copies the dealer tab into the LOG sheet of the output doc for duplicate detection.'],
    ['appendToVINLog(): Appends newly produced VINs to the correct tab after order confirmed.'],
    [''],
    ['=== HOW TO APPEND AFTER AN ORDER ==='],
    ['Run appendToVINLog(dealerKey, orderId) from the Apps Script editor.'],
    ['Example: appendToVINLog("AUFFENBERG_HYUNDAI", "44001")'],
    ['The function will prompt you for the output doc ID and confirm before writing.'],
    [''],
    ['=== ADDING A NEW DEALER ==='],
    ['1. Add a row to SF_DEALER_CONFIG DEALERS tab.'],
    ['2. Create a new tab here named by the dealer_key.'],
    ['3. Add headers: ORDER_ID | VIN'],
    ['4. The script handles the rest automatically.']
  ];
  sheet.getRange(1, 1, content.length, 1).setValues(content);
  sheet.getRange('A1').setFontSize(14).setFontWeight('bold');
  // Move README to first position
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);
}


function testConfigLoad() {
  var ss    = SpreadsheetApp.openById(CONFIG_SHEET_ID);
  var sheet = ss.getSheetByName('DEALERS');
  var data  = sheet.getDataRange().getValues();
  Logger.log('Total rows: ' + data.length);
  Logger.log('First dealer row: ' + data[1]);
  Logger.log('Active value type: ' + typeof data[1][CFG.ACTIVE] + ' = ' + data[1][CFG.ACTIVE]);
  Logger.log('isTrue_ result: ' + isTrue_(data[1][CFG.ACTIVE]));
}


// =============================================================================
// END OF SCRIPT
// =============================================================================
//
// DEPLOYMENT CHECKLIST:
//   [ ] MASTER_SHEET_ID, CONFIG_SHEET_ID, TEMPLATE_ID, OUTPUT_FOLDER_ID set above
//   [ ] Fill all [VIN_LOG_ID], [QR_FOLDER_ID], [OUTPUT_FOLDER_ID] in SF_DEALER_CONFIG
//   [ ] Reload SF_SYSTEM_MASTER to install the custom menu
//   [ ] Install onEdit as an INSTALLABLE trigger via Triggers panel
//   [ ] Run auditConfigPlaceholders() to confirm all active dealers are ready
//   [ ] Test with one small order before going live
//
// =============================================================================