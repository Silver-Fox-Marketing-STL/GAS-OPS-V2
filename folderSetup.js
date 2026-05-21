// =============================================================================
// FOLDER SETUP — ONE-TIME USE
// Paste into a new Apps Script file called FolderSetup.gs
// Run setupRemainingFoldersAndWriteConfig() once from the editor.
// Safe to delete this file after it runs successfully.
// =============================================================================

function setupRemainingFoldersAndWriteConfig() {

  var OUTPUT_FOLDER_ID = '1iRDDlqgQPn9R67AEIUJcF8JmyiOyn8DI';
  var CONFIG_ID        = '1csQdjcNey_mgcVqY99GOJ2PNCGRTyoZTbaUyJ3IZkJ8';

  // ── Dealers already created by Claude (folders exist, IDs hardcoded) ────────
  var completed = [
    { key: 'JOE_MACHENS_NISSAN',     outputId: '1s4_lvwXvlKo2J1E2ArTO654ocr2iaaoU',  qrId: '1K9SyGaNY9iRTlZbiwfbB2iw9R1Zmo_6x'  },
    { key: 'JOE_MACHENS_CDJR',       outputId: '1Icf2IuS-ZGGsVYTNlCADTzFbPx5a1FSR',  qrId: '13WMSGmzAz1GNSk59-OZpPMF7orfU0sr4'  },
    { key: 'JOE_MACHENS_HYUNDAI',    outputId: '1sVJ_t3hgaBTSCQymEEbcE_xl76KkrCjn',  qrId: '1Fz32xFLWoMVosze-P14okxKpFYMOlATg'  },
    { key: 'KIA_OF_COLUMBIA',        outputId: '18UPSp1LUC4geQFzM8cYIvMp6Bcu6g-U6',  qrId: '1BsZcmFrE3_oa0vRQDdhW-sxQiOqHRKB3'  },
    { key: 'AUFFENBERG_HYUNDAI',     outputId: '1SLpoGqFX_cxZVaKVCSQf4TPIcWc8_bzS',  qrId: '19tOEjzpFhb6y0sCPKpxjDdISinEOpAe9'  },
    { key: 'HONDA_OF_FRONTENAC',     outputId: '1NAf5cOQU3kgRjA8dPnyavqCZQFg9E_na',  qrId: '1HIRFUvzPlEiOQlfSGx6L1UWTORx-cieJ'  },
    { key: 'PORSCHE_STL',            outputId: '1ldp-xIaHk-knBjL1lbsvqh3z4xvD1_fv',  qrId: '1Dbnp7Xtcs0ZLl9VGbLvzlwzB5BvtFq1A'  },
    { key: 'PAPPAS_TOYOTA',          outputId: '1MBYbypq0iLY3_6ybGNOz0_QxWQZHE8KJ',  qrId: '1l17b1k-4LGZLetwq1AuZEziMcqq4c72W'  },
    { key: 'TWIN_CITY_TOYOTA',       outputId: '1Msk-2pvrJrns74BG4uQe1Ur_1NDzkZ-T',  qrId: '1m0T-ybPzaUiR8TsiMMZP-iwpPaV16xl2'  },
    { key: 'BOMMARITO_CADILLAC',     outputId: '1MMjhhd1ulfShNRQc_2LdccR72wOE-Wh7',  qrId: '1WArJeac_JA4pD8KibJp4nwYCJhTHl40c'  },
    { key: 'SERRA_HONDA',            outputId: '1UVK54pt-45u0vzJT5bBBJIMhHhJMHOCB',  qrId: '1Nsz85jbpcukK9Q-vzgSK_A9_LK8nO50W'  },
    { key: 'SOCO_DCJR',             outputId: '1-H-PWwP-b9_IKN_KPK1iqWy6_GnAk8D3',  qrId: '1M0WoIKFBB6zseWi9a97M1dLZefPx_n5o'  },
    { key: 'GLENDALE_CDJR',         outputId: '1KiV8y02KdtWdqeMI1Zdu9nkpCvRHJBzT',  qrId: '1y5e_Cn85UwcrT05WZ7bQHdgbM6e0Uyu0'  },
    { key: 'DAVE_SINCLAIR_LINCOLN',  outputId: '1OP9Bcs0gJ2yuEZa_T60Ff1vyWhYgBqIu',  qrId: '16-vjf1Lga6D5JD2pTTlzxvikdxqRaxR7'  },
    { key: 'SUNTRUP_KIA_SOUTH',      outputId: '1IBkj2BQkLWTDGI73Pb84BF8DaotbxtVS',  qrId: '1rLZM4tu5KLvE5gWLn4jIxdyd_1uZgaZi'  },
    { key: 'RUSTY_DREWING_CHEVY',    outputId: '1YSCrN-1JS5V6UwnYdFfMog1YthyIjcb0',  qrId: '1jl0drqqjzCZ0hVJxjXZ2rpxUTdldb8YN'  },
    { key: 'PUNDMANN_FORD',          outputId: '1CKw4tzvDhF4WdC0dCrv2yOV8iHBgQP1x',  qrId: '1XXf-CVgJDjzL3lfVSswmso8RJRmoMNv4'  },
    { key: 'BMW_OF_COLUMBIA',        outputId: '1ZO64G9gmpgyfcQAcuhVN2XSP_ID3d82O',  qrId: '1hB5f_PFBXDcpfi-hyZ3yeJn7sr8E06JB'  },
    { key: 'TOM_STEHOUWER',          outputId: '1WQ-9cPnW7elPLOqsvglzaE-DRX4FfYqs',  qrId: '1JmmRVQThPIkL538ChHIvxldP6f-e8vHM'  },
    { key: 'RUSTY_DREWING_CADILLAC', outputId: '1w1_ITtTQnBilVa5K9ljTC_WPe5P5UUEm',  qrId: '1DRkY5dKFwIjbOw6f4gUS0UoMVan33gHt'  },
    { key: 'JOE_MACHENS_TOYOTA',     outputId: '1nxKBqZ9SYmvhCpBSsg6pwvHz2_i1IHgi',  qrId: '1yOSp72h8jaFo5gm1TxRnyJWJkIHHerrx'  },
    { key: 'LAND_ROVER_RANCHO',      outputId: '1wA-A-epO0YlEzdFoyGbiD8cybYsAAaqm',  qrId: '1yodOCz7QzHWCVr1P4tryGF1T4l7z63sL'  },
    { key: 'AUDI_RANCHO',            outputId: '11Nw1zysEecznnTTXMkv3b20qT4srjDC5',  qrId: '1bkZ2FIyf26nuy48cJxtIhUPopBARirTA'  },
    { key: 'INDIGO_AUTO',            outputId: '1Pm3hfSvaXjgZvTzqRmseKseU-sVQ5GM-',  qrId: '13Ri9KK_hok7pcruGJZn3y9iWxTC6DjvS'  },
    { key: 'JAGUAR_RANCHO',          outputId: '1O_uZYk8d3IqdUMKTwBzpeaPDr8vvTJx0',  qrId: '1qP5Cgy694Y5QsVcvGNxyM0iTid8xqFIc'  },
  ];

  // ── Dealers still needing folders created ────────────────────────────────────
  var remaining = [
    { key: 'SUNTRUP_HYUNDAI_SOUTH',   name: 'Suntrup Hyundai South'            },
    { key: 'VOLVO_WEST_COUNTY',        name: 'Volvo Cars West County'            },
    { key: 'THOROUGHBRED_FORD',        name: 'Thoroughbred Ford'                 },
    { key: 'DAVE_SINCLAIR_ST_PETERS',  name: 'Dave Sinclair Lincoln St. Peters'  },
    { key: 'SUNTRUP_BUICK_GMC',        name: 'Suntrup Buick GMC'                 },
    { key: 'COLUMBIA_HONDA',           name: 'Columbia Honda'                    },
    { key: 'SUNTRUP_FORD_WESTPORT',    name: 'Suntrup Ford Westport'             },
    { key: 'HW_KIA',                   name: 'HW Kia of West County'             },
    { key: 'FRANK_LETA_HONDA',         name: 'Frank Leta Honda'                  },
    { key: 'BMW_WEST_STL',             name: 'BMW of West St. Louis'             },
    { key: 'SUNTRUP_FORD_KIRKWOOD',    name: 'Suntrup Ford Kirkwood'             },
    { key: 'MERCEDES_CREVE_COEUR',     name: 'Mercedes-Benz of Creve Coeur'     },
    { key: 'AUTOLOANPRO',              name: 'AutoLoanPRO'                       },
    { key: 'NISSAN_JEFFERSON_CITY',    name: 'Nissan of Jefferson City'          },
    { key: 'HYUNDAI_JEFFERSON_CITY',   name: 'Hyundai of Jefferson City'         },
    { key: 'HONDA_JEFFERSON_CITY',     name: 'Honda of Jefferson City'           },
  ];

  // Create folders for remaining dealers
  var outputParent = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  var newlyCreated = [];

  remaining.forEach(function(dealer) {
    try {
      var dealerFolder = outputParent.createFolder(dealer.name);
      var qrFolder     = dealerFolder.createFolder('QR Codes');
      newlyCreated.push({
        key:      dealer.key,
        outputId: dealerFolder.getId(),
        qrId:     qrFolder.getId()
      });
      Logger.log('Created: ' + dealer.name + ' | output: ' + dealerFolder.getId() + ' | QR: ' + qrFolder.getId());
    } catch(e) {
      Logger.log('ERROR creating folders for ' + dealer.key + ': ' + e.message);
    }
  });

  // Combine all dealers
  var allDealers = completed.concat(newlyCreated);

  // Build a lookup map: dealer_key -> {outputId, qrId}
  var lookup = {};
  allDealers.forEach(function(d) { lookup[d.key] = d; });

  // Read the config sheet to find each dealer's row
  var configSS    = SpreadsheetApp.openById(CONFIG_ID);
  var dealerSheet = configSS.getSheetByName('DEALERS');
  var data        = dealerSheet.getDataRange().getValues();

  // Col G = qr_folder_id (index 6, 1-based col 7)
  // Col H = output_folder_id (index 7, 1-based col 8)
  var updates = 0;
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    if (lookup[key]) {
      var rowNum = i + 1; // 1-indexed
      dealerSheet.getRange(rowNum, 7).setValue(lookup[key].qrId);      // Col G
      dealerSheet.getRange(rowNum, 8).setValue(lookup[key].outputId);  // Col H
      updates++;
    }
  }

  Logger.log('Done! Wrote folder IDs for ' + updates + ' dealers to SF_DEALER_CONFIG.');
}