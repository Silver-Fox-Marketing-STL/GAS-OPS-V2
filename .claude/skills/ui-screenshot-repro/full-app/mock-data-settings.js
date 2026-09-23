// Settings-side mock responses (Dealer Rules, Pipedrive Settings, Data Sources,
// EOM, Norm, Field Codes, CSV Schemas, Add Dealer). Extends window.MOCK.
(function () {
  var M = window.MOCK, F = window.MOCK_FIX, D = F.D;
  var DEALERS = F.DEALERS.map(function (d) { return { key: d.key, name: d.name }; });

  var SCHEMA = [
    ['vin', 'VIN', false], ['stock', 'Stock', false], ['type', 'Type', true], ['year', 'Year', false], ['make', 'Make', false],
    ['model', 'Model', false], ['trim', 'Trim', true], ['ext_color', 'Ext Color', false], ['status', 'Status', true], ['price', 'Price', true],
    ['body_style', 'Body Style', false], ['fuel_type', 'Fuel Type', false], ['msrp', 'MSRP', false], ['date_in_stock', 'Date In Stock', false],
    ['street_address', 'Street Address', false], ['locality', 'Locality', false], ['postal_code', 'Postal Code', false], ['region', 'Region', false],
    ['country', 'Country', false], ['location', 'Location', false], ['vehicle_url', 'Vechile URL', false]
  ].map(function (r, i) { return { index: i, key: r[0], label: r[1], normalized: r[2] }; });

  var DEAL_FIELDS = [
    { key: 'title', name: 'Title', field_type: 'varchar', options: [] },
    { key: 'a3f1c9e07b5d42e8a6c1f0b9d2e47a85c3b1d6f2', name: 'Duplicates', field_type: 'double', options: [] },
    { key: '7c2e9b41d0a85f36e1c47b92a0d5f8e3b6c1a947', name: 'Proof', field_type: 'enum', options: [{ id: 11, label: 'Required' }, { id: 12, label: 'Not Required' }] },
    { key: '4f8a1c6e9b2d07a35e8c1b4d9f6a20e7c3b5d812', name: 'Install Type', field_type: 'enum', options: [{ id: 41, label: 'Crew' }, { id: 42, label: 'Dealer' }] },
    { key: 'b2c7e1a94d0f36b85a2e7c1d9b4f08a63e5c2d17', name: 'Billing Cycle', field_type: 'enum', options: [{ id: 51, label: 'Monthly' }, { id: 52, label: 'Per Order' }] },
    { key: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0', name: 'PO Number', field_type: 'varchar', options: [] }
  ];
  var ORG_FIELDS = [
    { key: 'e81b4c7a2f9d03e56b1a8c4d7f20e9b35a6c1d84', name: 'Program Install Cost', field_type: 'enum', options: [{ id: 21, label: 'Installed' }, { id: 22, label: 'Not Installed' }] },
    { key: '5d9a2e7c1b84f03a6e2d9c7b1f45a08e3c6b2d91', name: 'Print Schedule', field_type: 'set', options: [{ id: 31, label: 'Monday' }, { id: 32, label: 'Tuesday' }, { id: 33, label: 'Wednesday' }, { id: 34, label: 'Thursday' }, { id: 35, label: 'Friday' }] },
    { key: '9e4b1d7c3a0f82e56d1b9a4c7e03f8d25b6a1c49', name: 'Account Manager', field_type: 'varchar', options: [] },
    { key: '3c9d2a7e1f4b08c65d2a9e7b1c3f40d86a5b2e19', name: 'Monthly Volume', field_type: 'double', options: [] }
  ];
  var RULES = [
    { id: 'r1', deal_field: 'a3f1c9e07b5d42e8a6c1f0b9d2e47a85c3b1d6f2', type: 'text', mode: 'copy', org_field: '9e4b1d7c3a0f82e56d1b9a4c7e03f8d25b6a1c49' },
    { id: 'r2', deal_field: '7c2e9b41d0a85f36e1c47b92a0d5f8e3b6c1a947', type: 'enum', mode: 'copy', org_field: 'e81b4c7a2f9d03e56b1a8c4d7f20e9b35a6c1d84', option_map: { '21': 11, '22': 12 } },
    { id: 'r3', deal_field: '4f8a1c6e9b2d07a35e8c1b4d9f6a20e7c3b5d812', type: 'enum', mode: 'constant', value: 42, if_empty: true },
    { id: 'r4', deal_field: 'b2c7e1a94d0f36b85a2e7c1d9b4f08a63e5c2d17', type: 'enum', mode: 'conditional',
      group: { match: 'any', children: [{ field: 'e81b4c7a2f9d03e56b1a8c4d7f20e9b35a6c1d84', op: 'in', values: ['21'] },
        { match: 'all', children: [{ field: '3c9d2a7e1f4b08c65d2a9e7b1c3f40d86a5b2e19', op: 'gte', values: [50] }] }] },
      then_value: 51, else_value: 52 }
  ];
  var PRODUCTS = [
    { id: 1043, name: 'Shortcut Pack — Bommarito', code: 'SC-BWC', prices: [{ price: 61, currency: 'USD' }], tax: 9.679, inactive: false, customerOrgId: '812' },
    { id: 1046, name: 'CPO Hang Tag — Bommarito', code: 'HT-BWC', prices: [{ price: 45, currency: 'USD' }], tax: 9.679, inactive: false, customerOrgId: '812' },
    { id: 1047, name: 'New Car Shortcut — Bommarito', code: 'NC-BWC', prices: [{ price: 58, currency: 'USD' }], tax: 9.679, inactive: false, customerOrgId: '812' },
    { id: 1051, name: 'Subprime Tag — Frank Leta', code: 'SP-FLH', prices: [{ price: 38, currency: 'USD' }], tax: 0, inactive: false, customerOrgId: '915' },
    { id: 1044, name: 'Design', code: 'DS-01', prices: [{ price: 85, currency: 'USD' }], tax: 0, inactive: false },
    { id: 1050, name: 'Install', code: 'IN-01', prices: [{ price: 0, currency: 'USD' }], tax: 0, inactive: false },
    { id: 998,  name: 'Retired Hang Tag', code: 'HT-OLD', prices: [{ price: 10, currency: 'USD' }], tax: 0, inactive: true, customerOrgId: '812' }
  ];
  var VARIATIONS = {
    1043: [{ id: 1043001, name: 'Standard', prices: [{ price: 61, currency: 'USD' }] }, { id: 1043002, name: 'No Charge', prices: [{ price: 0, currency: 'USD' }] }],
    1046: [{ id: 1046001, name: 'Standard', prices: [{ price: 45, currency: 'USD' }] }, { id: 1046002, name: 'Electric', prices: [{ price: 52, currency: 'USD' }] }],
    1047: [],
    1050: [{ id: 1050001, name: '15% Install', prices: [{ price: 0, currency: 'USD' }] }, { id: 1050002, name: 'No Install', prices: [{ price: 0, currency: 'USD' }] }, { id: 1050003, name: 'Default', prices: [{ price: 0, currency: 'USD' }] }],
    1044: [{ id: 1044001, name: 'Standard', prices: [{ price: 85, currency: 'USD' }] }, { id: 1044002, name: 'No Charge Design', prices: [{ price: 0, currency: 'USD' }] }]
  };
  var SCHEMAS = ['BOMM_WC_A', 'BOMM_WC_B', 'STANDARD_QR', 'HONDA_PRICE_TAG', 'SUBPRIME_TAG', 'SPRINTER_QR', 'VERSAWORKS_FEATURES'];

  var EOM_REPORTS = [
    { monthKey: '2026-08', monthLabel: 'August 2026', scope: 'stage', stageId: '44', generatedAt: '2026-09-01 08:14:22', folderUrl: 'https://drive.google.com/drive/folders/1AbC', ssUrl: 'https://docs.google.com/spreadsheets/d/1XyZ/edit', orgCount: '37', dealCount: '142', status: 'published', publishedAt: '2026-09-02 10:01:00', publishedBy: 'nvenable@sfoxmarketing.com' },
    { monthKey: '2026-07', monthLabel: 'July 2026', scope: 'full_billing', stageId: '', generatedAt: '2026-08-01 07:55:10', folderUrl: 'https://drive.google.com/drive/folders/1AbD', ssUrl: 'https://docs.google.com/spreadsheets/d/1XyW/edit', orgCount: '35', dealCount: '131', status: 'published', publishedAt: '2026-08-02 09:12:00', publishedBy: 'nvenable@sfoxmarketing.com' },
    { monthKey: '2026-06', monthLabel: 'June 2026', scope: 'stage', stageId: '44', generatedAt: '2026-07-01 08:03:41', folderUrl: 'https://drive.google.com/drive/folders/1AbE', ssUrl: 'https://docs.google.com/spreadsheets/d/1XyV/edit', orgCount: '36', dealCount: '128', status: 'generated', publishedAt: '', publishedBy: '' }
  ];
  var EOM_JSON = {
    meta: { monthLabel: 'August 2026', monthKey: '2026-08', scope: 'stage', stageId: '44', generatedAt: '2026-09-01 08:14:22', orgCount: 3, dealCount: 5,
      folderUrl: 'https://drive.google.com/drive/folders/1AbC', ssUrl: 'https://docs.google.com/spreadsheets/d/1XyZ/edit', dealBaseUrl: 'https://silverfoxmarketing.pipedrive.com/deal/', splitContacts: false },
    group: [
      { org: 'Bommarito West County', contacts: [
        { contact: 'Dana Whitfield', stats: { orders: 2, duplicates: 3, totalQty: 61, totalAmt: 3721 },
          summaryRows: [{ code: 'SC-BWC', name: 'Shortcut Pack', desc: 'Windshield shortcut + QR', vari: 'Standard', qty: 58, amt: 3538, notesStr: 'Rush' }, { code: 'DS-01', name: 'Design', desc: '', vari: 'No Charge Design', qty: 3, amt: 183, notesStr: '' }],
          deals: [
            { id: 48211, title: 'Bommarito West County 2026-08-04', created: '2026-08-04 09:12:00', owner: 'Nick Venable', contact: 'Dana Whitfield', duplicates: 2, dealValue: 2440, hasProducts: true,
              lines: [{ code: 'SC-BWC', name: 'Shortcut Pack', vari: 'Standard', qty: 40, price: 61, sum: 2440, tax: 9.679, desc: 'Windshield shortcut + QR', notes: 'Rush' }] },
            { id: 48307, title: 'Bommarito West County 2026-08-18', created: '2026-08-18 10:40:00', owner: 'Nick Venable', contact: 'Dana Whitfield', duplicates: 1, dealValue: 1281, hasProducts: true,
              lines: [{ code: 'SC-BWC', name: 'Shortcut Pack', vari: 'Standard', qty: 18, price: 61, sum: 1098, tax: 9.679, desc: '', notes: '' }, { code: 'DS-01', name: 'Design', vari: 'No Charge Design', qty: 3, price: 61, sum: 183, tax: 0, desc: '', notes: '' }] } ] } ] },
      { org: 'Frank Leta Honda', contacts: [
        { contact: 'Marcus Lee', stats: { orders: 2, duplicates: 0, totalQty: 44, totalAmt: 2552 },
          summaryRows: [{ code: 'SC-FLH', name: 'Shortcut Pack', desc: '', vari: 'Standard', qty: 44, amt: 2552, notesStr: '' }],
          deals: [
            { id: 48400, title: 'Frank Leta Honda 2026-08-20', created: '2026-08-20 08:00:00', owner: 'Nick Venable', contact: 'Marcus Lee', duplicates: 0, dealValue: 1276, hasProducts: true, lines: [{ code: 'SC-FLH', name: 'Shortcut Pack', vari: 'Standard', qty: 22, price: 58, sum: 1276, tax: 9.679, desc: '', notes: '' }] },
            { id: 48455, title: 'Frank Leta Honda 2026-08-27', created: '2026-08-27 08:10:00', owner: 'Nick Venable', contact: 'Marcus Lee', duplicates: 0, dealValue: 1276, hasProducts: true, lines: [{ code: 'SC-FLH', name: 'Shortcut Pack', vari: 'Standard', qty: 22, price: 58, sum: 1276, tax: 9.679, desc: '', notes: '' }] } ] } ] },
      { org: 'Pappas Toyota', contacts: [
        { contact: 'Unassigned', stats: { orders: 1, duplicates: 0, totalQty: 0, totalAmt: 0 }, summaryRows: [],
          deals: [{ id: 48470, title: 'Pappas Toyota 2026-08-29', created: '2026-08-29 08:00:00', owner: 'Nick Venable', contact: 'Unassigned', duplicates: 0, dealValue: 0, hasProducts: false, lines: [] }] } ] }
    ]
  };

  var FIELD_CODES = [
    ['YEAR', 1, 'Model year'], ['MAKE', 2, ''], ['MODEL', 3, ''], ['TRIM', 4, 'Normalized trim'], ['VIN', 5, ''], ['STOCK', 6, ''], ['TYPE', 7, 'New / PO / CPO'],
    ['PRICE_RAW', 8, 'Raw scraper price (text)'], ['@QR', 10, 'QR image path'], ['YEARMAKE', 11, ''], ['YEARMODEL', 12, ''], ['MAKE_MODEL_COMBINED', 13, ''],
    ['QRSTOCK', 14, ''], ['MISC', 15, 'Free text'], ['PRICE_FMT', 16, '$ formatted'], ['NEWYEARMAKE', 17, ''], ['TYPEVIN', 18, ''], ['YEARMODELSTOCK', 19, ''],
    ['PRICE_PLUS_2000', 20, ''], ['PRICE_TAGLINE', 21, 'Price with tagline']
  ].map(function (r) { return { fieldCode: r[0], col: r[1], colLetter: String.fromCharCode(64 + r[1]), description: r[2], source: 'builtin' }; })
   .concat([{ fieldCode: 'PRICE_MAINLINE', col: 22, colLetter: 'V', description: 'Main price line', source: 'config' },
            { fieldCode: 'FEATURES', col: 23, colLetter: 'W', description: 'Manual features text', source: 'builtin' },
            { fieldCode: 'MODELTRIM', col: 24, colLetter: 'X', description: 'Model + trim (VersaWorks)', source: 'override' },
            { fieldCode: 'MV_PRICE', col: 25, colLetter: 'Y', description: 'Market Value Price line', source: 'config' }]);

  var CS_SCHEMAS = [
    { key: 'BOMM_WC_A', description: 'Bommarito WC — template A (New)', columns: [
      { code: '@QR', header: null, edit: false, max: null, raw: '@QR' }, { code: 'YEARMODEL', header: 'YearModel', edit: false, max: null, raw: 'YEARMODEL:YearModel' },
      { code: 'MODELTRIM', header: 'ModelTrim', edit: true, max: 22, raw: 'MODELTRIM:ModelTrim:edit22' }, { code: 'STOCK', header: null, edit: true, max: null, raw: 'STOCK::edit' },
      { code: 'PRICE_TAGLINE', header: 'Tagline', edit: true, max: 28, raw: 'PRICE_TAGLINE:Tagline:edit28' }] },
    { key: 'BOMM_WC_B', description: 'Bommarito WC — template B (PO)', columns: [
      { code: '@QR', header: null, edit: false, max: null, raw: '@QR' }, { code: 'YEARMODEL', header: 'YearModel', edit: false, max: null, raw: 'YEARMODEL:YearModel' }, { code: 'PRICE_FMT', header: 'Price', edit: false, max: null, raw: 'PRICE_FMT:Price' }] },
    { key: 'STANDARD_QR', description: '', columns: [{ code: 'QRSTOCK', header: null, edit: false, max: null, raw: 'QRSTOCK' }, { code: 'YEARMAKE', header: null, edit: false, max: null, raw: 'YEARMAKE' }] },
    { key: 'HONDA_PRICE_TAG', description: 'Frank Leta price hang tag', columns: [{ code: 'YEARMODELSTOCK', header: null, edit: false, max: null, raw: 'YEARMODELSTOCK' }, { code: 'PRICE_MAINLINE', header: 'Main', edit: false, max: null, raw: 'PRICE_MAINLINE:Main' }, { code: 'MV_PRICE', header: 'MV', edit: false, max: null, raw: 'MV_PRICE:MV' }] },
    { key: 'SUBPRIME_TAG', description: 'Subprime (autoloanpro) tag', columns: [{ code: '@QR', header: null, edit: false, max: null, raw: '@QR' }, { code: 'VIN', header: null, edit: false, max: null, raw: 'VIN' }] },
    { key: 'SPRINTER_QR', description: 'MBCC Sprinter van', columns: [{ code: '@QR', header: null, edit: false, max: null, raw: '@QR' }, { code: 'TYPEVIN', header: null, edit: false, max: null, raw: 'TYPEVIN' }] },
    { key: 'VERSAWORKS_FEATURES', description: 'CPO with manual features', columns: [{ code: '@QR', header: null, edit: false, max: null, raw: '@QR' }, { code: 'FEATURES', header: 'Features', edit: false, max: null, raw: 'FEATURES:Features' }, { code: 'MISC', header: 'Misc', edit: true, max: 40, raw: 'MISC:Misc:edit40' }] }
  ];

  Object.assign(M, {
    // ── Dealer Rules ───────────────────────────────────────────────────────
    getRulesEditorBootstrap: { dealers: DEALERS, schemas: SCHEMAS, vehicleTypes: ['New', 'PO', 'CPO', 'CPO-EL', 'Demo'],
      filterFields: SCHEMA.map(function (c) { return { key: c.key, label: c.label }; }),
      filterOps: ['in', 'not_in', 'contains', 'not_contains', 'starts_with', 'not_starts_with', 'gte', 'lte', 'gt', 'lt'],
      filterActions: ['drop_on_import', 'exclude_cao', 'exclude_order'], filterNumericFields: ['price', 'msrp', 'year'] },
    getDealerRulesData: function (key) {
      var name = (F.DEALERS.filter(function (d) { return d.key === key; })[0] || {}).name || key;
      return { dealerName: name, typeRules: [], filteringRules: {
        allowed_types: ['New', 'PO', 'CPO'], exclude_status: ['OFFLOT'], require_stock: true, require_price: true, require_url: false,
        min_price: 5000, max_price: 150000, seasoning: [{ type: 'PO', days: 3 }, { type: 'CPO', days: 2 }],
        targeting_rules: [
          { action: 'exclude_order', group: { match: 'all', children: [{ field: 'type', op: 'in', values: ['PO'] },
            { match: 'any', children: [{ field: 'price', op: 'lt', values: [8000] }, { field: 'model', op: 'contains', values: ['Cargo', 'Chassis'] }] }] } },
          { action: 'drop_on_import', group: { match: 'all', children: [{ field: 'vehicle_url', op: 'contains', values: ['autoloanpro.com'] }] } },
          { action: 'exclude_cao', group: { match: 'any', children: [{ field: 'trim', op: 'starts_with', values: ['Fleet'] }] } } ],
        cao_exclude_types: ['CPO-EL'],
        source_split: { group_name: 'SUBPRIME', url_contains: 'autoloanpro.com' },
        billing_split: key === 'MB_CREVE_COEUR' ? { group_name: 'SPRINTER', deal_label: 'SPRINTER Deal ID', field: 'model', op: 'contains', values: ['Sprinter', 'Metris'] } : undefined } };
    },
    saveDealerFilterRules: { ok: true },
    removeVehicleType: { ok: true },
    getPipedriveStatus: { configured: true, domain: 'silverfoxmarketing', defaults: { pipelineId: '1', stageId: '2', currency: 'USD' } },
    getPipedriveConfigBootstrap: { configured: true, defaults: { pipelineId: '1', stageId: '2', currency: 'USD' }, products: PRODUCTS, dealFields: DEAL_FIELDS, orgFields: ORG_FIELDS, productOrgField: '0b7e3d1a9c4f28e65a1d0c9b7e32f4a8d6b1c057' },
    getPipedriveDealerEditorData: function (key) {
      var name = (F.DEALERS.filter(function (d) { return d.key === key; })[0] || {}).name || key;
      var split = key === 'MB_CREVE_COEUR';
      var saved = { PRIMARY: { dealerKey: key, group: 'PRIMARY', orgId: '812', orgName: name,
        productMap: { New: { product_id: 1047, schema: 'BOMM_WC_A', utm: '?utm_source=silverfox&utm_medium=qr&utm_campaign=new' },
                      PO: { product_id: 1043, variation_id: 1043001, schema: 'BOMM_WC_B', utm: '?utm_source=silverfox&utm_campaign=used' },
                      CPO: { product_id: 1046, variation_id: 1046001, schema: 'VERSAWORKS_FEATURES' },
                      'CPO-EL': { product_id: 1046, variation_id: 1046002, schema: 'STANDARD_QR' } },
        titleTemplate: '{dealer_name} {date}', pipelineId: '', stageId: '', currency: 'USD',
        fieldOverrides: { r1: { off: true }, r3: { deal_field: '4f8a1c6e9b2d07a35e8c1b4d9f6a20e7c3b5d812', type: 'enum', mode: 'constant', value: 41, if_empty: true } },
        active: true, sourceProductMap: { SUBPRIME: { PO: { product_id: 1051, schema: 'SUBPRIME_TAG' } } } } };
      if (split) saved.SPRINTER = { dealerKey: key, group: 'SPRINTER', orgId: '913', orgName: name + ' Sprinter', productMap: { New: { product_id: 1047, schema: 'SPRINTER_QR' } }, titleTemplate: '', pipelineId: '', stageId: '', currency: '', fieldOverrides: {}, active: true, sourceProductMap: {} };
      return { dealerKey: key, dealerName: name, groups: split ? ['PRIMARY', 'SPRINTER'] : ['PRIMARY'], types: ['New', 'PO', 'CPO', 'CPO-EL'], saved: saved,
        sourceSplit: { groupName: 'SUBPRIME', urlContains: 'autoloanpro.com' }, globalRules: RULES };
    },
    getProductVariations: function (id) { return VARIATIONS[id] || []; },
    searchPipedriveOrganizations: function (term) { return [{ id: 812, name: 'Bommarito West County' }, { id: 813, name: 'Bommarito Hyundai' }, { id: 913, name: 'Bommarito Sprinter' }]; },
    saveDealerPipedriveConfig: { ok: true },

    // ── Pipedrive Settings ─────────────────────────────────────────────────
    getPipedriveSettingsBootstrap: { configured: true, domain: 'silverfoxmarketing', defaults: { pipelineId: '1', stageId: '2', currency: 'USD' },
      dealFields: DEAL_FIELDS, orgFields: ORG_FIELDS,
      productFields: [{ key: '0b7e3d1a9c4f28e65a1d0c9b7e32f4a8d6b1c057', name: 'Customer', field_type: 'org' }, { key: '6a2d8f1c4e9b07a35c1e8d2b6f94a07c3e5b1d28', name: 'Print Size', field_type: 'enum' }],
      productOrgField: '0b7e3d1a9c4f28e65a1d0c9b7e32f4a8d6b1c057', rules: RULES },
    getPipedriveGlobalSettings: { rules: RULES },
    getPipedriveInstallCostConfig: { org_field_key: 'e81b4c7a2f9d03e56b1a8c4d7f20e9b35a6c1d84', install_product_id: 1050,
      options: { '21': { variation_id: 1050001, percent: 15 }, '22': { variation_id: 1050002, percent: null }, '': { variation_id: 1050003, percent: null } },
      design_product_id: 1044, design_no_charge_variation_id: 1044002 },
    savePipedriveProductOrgField: { ok: true },
    saveInstallCostConfig: { ok: true },
    saveDealerOrgLinks: { ok: true, saved: 8 },
    getDealerOrgLinkProposals: F.DEALERS.map(function (d, i) {
      var mt = ['exact', 'strong', 'weak', 'none'][i % 4];
      return { dealerKey: d.key, dealerName: d.name, currentOrgId: i < 4 ? String(800 + i) : '', currentOrgName: i < 4 ? d.name : '',
               proposedOrgId: mt === 'none' ? '' : String(800 + i), proposedOrgName: mt === 'none' ? '' : d.name, matchType: mt };
    }),

    // ── Data Sources ───────────────────────────────────────────────────────
    getDataSourcesBootstrap: { schema: SCHEMA, dealers: F.DEALERS },
    getSourcesForDealer: [{ name: 'Dealer internal CSV', headerCount: 18 }, { name: 'vAuto export', headerCount: 21 }],
    getSourceMapping: { map: { 'vehicle vin': 'vin', 'stock #': 'stock', 'new/used': 'type', 'internet price': 'price', 'vdp link': 'vehicle_url', 'yr': 'year', 'make': 'make', 'model': 'model', 'trim level': 'trim', 'lot status': 'status' },
      headers: [{ header: 'Vehicle VIN', key: 'vin' }, { header: 'Stock #', key: 'stock' }, { header: 'New/Used', key: 'type' }, { header: 'Yr', key: 'year' }, { header: 'Make', key: 'make' }, { header: 'Model', key: 'model' }, { header: 'Trim Level', key: 'trim' }, { header: 'Lot Status', key: 'status' }, { header: 'Internet Price', key: 'price' }, { header: 'VDP Link', key: 'vehicle_url' }] },
    saveSourceMapping: { ok: true },
    deleteSource: { ok: true },

    // ── End of Month ───────────────────────────────────────────────────────
    getEomBootstrap: { configured: true, pipelineId: 4, defaultStageId: 44, stages: [{ id: 43, name: 'Ordered', order_nr: 1 }, { id: 44, name: 'EOM Merge', order_nr: 2 }, { id: 45, name: 'Invoiced', order_nr: 3 }], reports: EOM_REPORTS },
    getEomReportsList: EOM_REPORTS,
    getEomProgress: function () { return window.MOCK_EOM_PROGRESS || { message: 'PDF 14 / 37 — Bommarito West County…', percent: 48, done: false, error: null }; },
    clearEomProgress: { ok: true },
    getEomReportJson: { ok: true, json: JSON.stringify(EOM_JSON) },
    getEomCurrentReport: { ok: true, json: JSON.stringify(Object.assign({}, EOM_JSON, { meta: Object.assign({}, EOM_JSON.meta, { current: true, stageName: 'EOM Merge', monthLabel: 'Current — EOM Merge' }) })) },
    generateEomReport: { ok: true, orgCount: 37, pdfCount: 37, dealCount: 142, monthLabel: 'September 2026', folderUrl: 'https://drive.google.com/drive/folders/1AbF', url: 'https://docs.google.com/spreadsheets/d/1XyU/edit' },
    finalizeEomReport: { ok: true },
    saveEomSettings: { ok: true },

    // ── Normalization ─────────────────────────────────────────────────────
    getNormEntries: function (map) {
      var sets = {
        type: [['Certified Pre-Owned', 'CPO'], ['Certified Used', 'CPO'], ['Pre-Owned', 'PO'], ['Used', 'PO'], ['new', 'New'], ['Certified Electric', 'CPO-EL'], ['Demo', 'Demo']],
        status: [['In Stock', 'ONLOT'], ['On Lot', 'ONLOT'], ['In Transit', 'OFFLOT'], ['Off Lot', 'OFFLOT'], ['Sold', 'OFFLOT']],
        trim: [['Limited Edition', 'Limited'], ['SEL Convenience', 'SEL'], ['Grand Touring', 'GT']],
        price: [['Call for Price', ''], ['$0', ''], ['TBD', '']],
        global: [['&amp;', '&'], ['  ', ' ']]
      };
      return (sets[map] || sets.type).map(function (r, i) { return { sheetRow: 5 + i, input: r[0], output: r[1] }; });
    },

    // ── Field Codes / CSV Schemas ─────────────────────────────────────────
    getFieldCodeMappings: { rows: FIELD_CODES, builtinCount: 23 },
    saveFieldCodeMapping: { ok: true },
    deleteFieldCodeMapping: { ok: true },
    getCsvSchemasEditorData: { schemas: CS_SCHEMAS, fieldCodes: FIELD_CODES.map(function (r) { return { fieldCode: r.fieldCode, colLetter: r.colLetter, description: r.description }; }),
      usedBy: { BOMM_WC_A: [D], BOMM_WC_B: [D], STANDARD_QR: [D, 'FRANK_LETA_HONDA', 'PAPPAS_TOYOTA'], HONDA_PRICE_TAG: ['FRANK_LETA_HONDA'], SUBPRIME_TAG: ['FRANK_LETA_HONDA'], SPRINTER_QR: ['MB_CREVE_COEUR'], VERSAWORKS_FEATURES: [D] } },
    saveCsvSchema: { ok: true },

    // ── Add Dealer ────────────────────────────────────────────────────────
    getAddDealerBootstrap: { existingKeys: F.DEALERS.map(function (d) { return d.key; }), inactiveDealers: [{ key: 'AUFFENBERG_HYUNDAI', name: 'Auffenberg Hyundai' }, { key: 'JOE_MACHENS_NISSAN', name: 'Joe Machens Nissan' }],
      scraperLocations: F.DEALERS.map(function (d) { return d.name; }).concat(['Joe Machens Nissan', 'Suntrup Kia South']),
      unconfiguredLocations: [{ location: 'Joe Machens Nissan', suggestedKey: 'JOE_MACHENS_NISSAN' }, { location: 'Suntrup Kia South', suggestedKey: 'SUNTRUP_KIA_SOUTH' }],
      nextOrdersCol: 'AP', container: { id: '1Qw3rTyUiOpAsDfGhJkL', name: 'SilverFox Output' } },
    getDealerChecklist: function (key) {
      return { dealerKey: key, dealerName: 'Joe Machens Nissan', active: false, canActivate: false, items: [
        { id: 'dealers_row', label: 'DEALERS config row', ok: true, blocking: true, detail: '', action: null },
        { id: 'orders_col', label: 'ORDERS column', ok: true, blocking: true, detail: 'Column AP', action: null },
        { id: 'vin_log', label: 'VIN log tab', ok: true, blocking: true, detail: '', action: null },
        { id: 'scraper_location', label: 'Scraper location matches inventory', ok: true, blocking: true, detail: '188 vehicles in the current inventory', action: null },
        { id: 'filtering_rules', label: 'Filtering rules', ok: true, blocking: true, detail: '', action: 'rules-filter' },
        { id: 'pipedrive_org', label: 'Pipedrive organization linked', ok: true, blocking: true, detail: 'Joe Machens Nissan', action: 'rules-pipedrive' },
        { id: 'product_map', label: 'Product map (product + schema per type)', ok: false, blocking: true, detail: 'Missing product or schema for: CPO', action: 'rules-pipedrive' },
        { id: 'qr_folder', label: 'QR Drive folder', ok: false, blocking: false, detail: "Not set — only needed if the dealer's schema prints QR codes", action: null } ] };
    },
    createDealer: function () { return { ok: true, steps: [{ label: 'DEALERS row', status: 'created', detail: '' }, { label: 'ORDERS column AP', status: 'created', detail: '' }, { label: 'VIN log tab', status: 'existing', detail: 'already present' }, { label: 'Output folder', status: 'created', detail: 'SilverFox Output / Joe Machens Nissan' }], checklist: M.getDealerChecklist('JOE_MACHENS_NISSAN') }; },
    activateDealer: { ok: true, message: 'Joe Machens Nissan is now active.', checklist: null }
  });
})();
