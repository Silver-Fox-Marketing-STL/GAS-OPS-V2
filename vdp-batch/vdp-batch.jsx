#target illustrator
/**
 * vdp-batch.jsx — Variable Data Print batch engine for GAS ShortCut OPS.
 *
 * For each OPS-exported CSV: open the paired Illustrator template, fill every
 * record through the template's EXISTING variable bindings (no Variables-panel
 * import), auto-fit overflowing point text (shrink font size only), relink each
 * record's QR PNG, and export one PDF per record to a temp folder. The PowerShell
 * wrapper (run-vdp-batch.ps1) then merges those into one multi-page PDF per CSV
 * with qpdf.
 *
 * Data binding is variables-FREE: we read doc.variables[i] from the DOM
 *   .name     = the CSV column header this variable is fed from
 *   .kind     = VariableKind.TEXTUAL (bound text frame) | IMAGE (bound placed QR)
 *   .pageItems= the bound page item(s)
 * and push CSV values straight into the bound items. Zero template rework for data.
 *
 * Auto-fit (point text only, one-shot math): a hidden layer named FIT_BOUNDS holds
 * one rectangle named EXACTLY after the variable it constrains. If the rendered text
 * is wider than that rectangle:  newSize = origSize * (allowedWidth / renderedWidth),
 * clamped at a legibility floor (FLOOR_RATIO * origSize). Below the floor the row is
 * flagged in the run log and left at the floor — the batch continues. A variable with
 * no matching rectangle is NEVER resized (covers the one appearance-warped field).
 *
 * The #1 batch-fit bug is size ratcheting: font-size edits persist across records.
 * We snapshot every bound text frame's original size once after opening the template
 * and RESTORE it before every record, then fit. Same CSV twice => identical output.
 *
 * Launch: normally via run-vdp-batch.ps1 (writes a sidecar job file). Can also be run
 * standalone (File > Scripts > Other Script) for template testing — then it prompts for
 * CSVs itself and only fills/exports (no qpdf merge).
 *
 * ES3 ONLY (ExtendScript): no let/const, no arrow fns, no Array.forEach/map, no native
 * JSON (lib/json2.js supplies it), no String.trim.
 */

// ---- Tunables -------------------------------------------------------------
var FLOOR_RATIO  = 0.60;   // legibility floor: never shrink below 60% of a field's original size
var PDF_PRESET   = "";     // Illustrator PDF preset name for print output; "" = built-in defaults
var SIDECAR_NAME = "vdp-batch.job.txt";  // written by the .ps1 into Folder.temp
// ---------------------------------------------------------------------------

// Pull in JSON (json2.js sits next to this script). Under some external launchers
// $.fileName is empty; fall back to the temp folder copy the .ps1 can stage.
(function loadJson() {
    var here = $.fileName ? File($.fileName).parent : null;
    var candidates = [];
    if (here) { candidates.push(new File(here.fsName + "/lib/json2.js")); }
    candidates.push(new File(Folder.temp.fsName + "/vdp-batch.json2.js"));
    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].exists) { $.evalFile(candidates[i]); return; }
    }
})();

function main() {
    if (typeof JSON !== "object" || typeof JSON.parse !== "function") {
        alert("vdp-batch: could not load lib/json2.js — cannot parse the template map.");
        return;
    }

    var job = readSidecar();                 // { csvs:[paths], tempRoot, mapFile } or null
    var standalone = !job;
    if (standalone) {
        var picked = promptForCsvs();
        if (!picked || picked.length === 0) { return; }  // user cancelled
        job = { csvs: picked, tempRoot: Folder.temp.fsName + "/vdp-batch", mapFile: null };
    }

    var templateMap = loadTemplateMap(job.mapFile);
    var presets = flattenPresets(templateMap);   // [{label, path}]

    // One dialog: choose a template per CSV (manual pick — the primary path).
    var pairing = pickTemplates(job.csvs, presets);
    if (!pairing) { return; }                     // cancelled

    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

    var pdfOpts = buildPdfOptions();
    var summary = [];

    for (var c = 0; c < job.csvs.length; c++) {
        var csvPath = job.csvs[c];
        var tmplPath = pairing[csvPath];
        if (!tmplPath) { summary.push(baseName(csvPath) + ": SKIPPED (no template)"); continue; }
        var res = processCsv(csvPath, tmplPath, job.tempRoot, pdfOpts);
        summary.push(baseName(csvPath) + ": " + res.done + " page(s), " +
                     res.flagged + " flagged" + (res.error ? " — ERROR: " + res.error : ""));
    }

    app.userInteractionLevel = UserInteractionLevel.DISPLAYALERTS;

    if (standalone) {
        alert("VDP batch complete (standalone — no PDF merge):\n\n" + summary.join("\n") +
              "\n\nPer-record PDFs are under:\n" + job.tempRoot);
    }
    // When launched by the .ps1, staying silent lets the wrapper continue to the qpdf merge.
}

// ---- Per-CSV processing ---------------------------------------------------

function processCsv(csvPath, tmplPath, tempRoot, pdfOpts) {
    var out = { done: 0, flagged: 0, error: null };
    var log = [];
    var csvBase = sanitize(baseName(csvPath));
    var csvTempDir = new Folder(tempRoot + "/" + csvBase);
    // Start clean so a re-run's page count == row count (no stale PDFs from a prior run).
    emptyFolder(csvTempDir);
    if (!csvTempDir.exists) { csvTempDir.create(); }

    var doc = null;
    try {
        var csv = parseCsv(new File(csvPath));
        if (!csv || csv.rows.length === 0) { out.error = "no data rows"; return out; }

        var tmplFile = new File(tmplPath);
        if (!tmplFile.exists) { out.error = "template not found: " + tmplPath; return out; }

        doc = app.open(tmplFile);
        var binds = collectBindings(doc);           // [{name,kind,item,orig,rect}]
        if (binds.length === 0) { out.error = "template has no variable bindings"; }

        var colIndex = indexHeaders(csv.headers);   // header(lower) -> col

        for (var r = 0; r < csv.rows.length; r++) {
            var row = csv.rows[r];
            var rowFlags = applyRecord(binds, row, colIndex);
            for (var f = 0; f < rowFlags.length; f++) {
                out.flagged++;
                log.push("row " + (r + 1) + ": " + rowFlags[f]);
            }
            var pdfFile = new File(csvTempDir.fsName + "/rec_" + pad(r + 1, 4) + ".pdf");
            doc.saveAs(pdfFile, pdfOpts);
            out.done++;
        }
    } catch (e) {
        out.error = e.message + (e.line ? " (line " + e.line + ")" : "");
        log.push("FATAL: " + out.error);
    } finally {
        if (doc) { try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (eC) {} }
    }

    writeRunLog(csvTempDir, csvBase, out, log);
    return out;
}

// Collect the template's variable bindings and snapshot original text sizes + fit rects.
function collectBindings(doc) {
    var fitRects = readFitBounds(doc);   // varName -> PathItem
    var binds = [];
    for (var i = 0; i < doc.variables.length; i++) {
        var v = doc.variables[i];
        var items = null;
        try { items = v.pageItems; } catch (eP) { items = null; }
        if (!items || items.length === 0) { continue; }   // unbound variable — nothing to feed
        var b = { name: v.name, kind: v.kind, item: items[0], orig: null, rect: null };
        if (v.kind === VariableKind.TEXTUAL) {
            try { b.orig = b.item.textRange.characterAttributes.size; } catch (eS) {}
            b.rect = fitRects[v.name] || null;   // only text frames with a named rect get fit
        }
        binds.push(b);
    }
    return binds;
}

// Fill one record into the bound items. Returns an array of flag strings (may be empty).
function applyRecord(binds, row, colIndex) {
    var flags = [];
    for (var i = 0; i < binds.length; i++) {
        var b = binds[i];
        var col = colIndex[lower(b.name)];
        var value = (col === undefined) ? "" : trim(row[col] == null ? "" : String(row[col]));

        if (b.kind === VariableKind.TEXTUAL) {
            try {
                b.item.contents = value;
                if (b.orig !== null) {
                    // Restore-then-fit: baseline every record from the original size.
                    b.item.textRange.characterAttributes.size = b.orig;
                    if (b.rect) {
                        var msg = fitToRect(b, value);
                        if (msg) { flags.push(msg); }
                    }
                }
            } catch (eT) { flags.push("text set failed for '" + b.name + "': " + eT.message); }

        } else if (b.kind === VariableKind.IMAGE) {
            var f = value ? new File(value) : null;
            if (f && f.exists) {
                try { relinkImage(b.item, f); }
                catch (eR) { flags.push("QR relink failed for '" + b.name + "': " + eR.message); }
            } else {
                flags.push("QR missing for '" + b.name + "': " + value);
            }
        }
        // Other variable kinds (VISIBILITY/GRAPH) are left untouched.
    }
    return flags;
}

// Shrink-only fit for point text. Returns a flag string if it hit the floor, else null.
function fitToRect(b, value) {
    if (!value) { return null; }
    var allowed = b.rect.width;               // FIT_BOUNDS rectangle width (points)
    var rendered = b.item.width;              // point text width grows linearly with size
    if (rendered <= allowed) { return null; }
    var floor = b.orig * FLOOR_RATIO;
    var newSize = b.orig * (allowed / rendered);
    var flag = null;
    if (newSize < floor) { newSize = floor; flag = "below legibility floor: '" + b.name + "' = \"" + value + "\""; }
    try { b.item.textRange.characterAttributes.size = newSize; } catch (e) { flag = "resize failed: '" + b.name + "'"; }
    return flag;
}

// Replace the file behind a linked image. PlacedItem relinks in place; a RasterItem
// placeholder must be rebuilt as a fresh PlacedItem in the same parent (skill pattern).
function relinkImage(item, newFile) {
    if (item.typename === "PlacedItem") {
        var bounds = item.geometricBounds;
        item.file = newFile;
        item.geometricBounds = bounds;
        return;
    }
    if (item.typename === "RasterItem") {
        var pb = item.geometricBounds, parent = item.parent, nm = item.name;
        var fresh = parent.placedItems.add();
        fresh.file = newFile;
        fresh.geometricBounds = pb;
        if (nm) { try { fresh.name = nm; } catch (e) {} }
        fresh.move(item, ElementPlacement.PLACEBEFORE);
        item.remove();
        return;
    }
    throw new Error(item.typename + " is not a linkable image");
}

// ---- FIT_BOUNDS + template map -------------------------------------------

function readFitBounds(doc) {
    var byName = {};
    var layer = null;
    try { layer = doc.layers.getByName("FIT_BOUNDS"); } catch (e) { return byName; }
    for (var i = 0; i < layer.pathItems.length; i++) {
        var p = layer.pathItems[i];
        if (p.name) { byName[p.name] = p; }   // rectangle name == the variable it constrains
    }
    return byName;
}

function loadTemplateMap(mapFile) {
    var file = null;
    if (mapFile) { file = new File(mapFile); }
    if ((!file || !file.exists) && $.fileName) {
        file = new File(File($.fileName).parent.fsName + "/template-map.json");
    }
    if (!file || !file.exists) { return {}; }
    var text = readFile(file);
    try { return JSON.parse(text); } catch (e) { return {}; }
}

function flattenPresets(map) {
    var out = [];
    for (var dealer in map) {
        if (!map.hasOwnProperty(dealer) || dealer.charAt(0) === "_") { continue; }
        var types = map[dealer];
        if (typeof types !== "object") { continue; }
        for (var type in types) {
            if (!types.hasOwnProperty(type) || type.charAt(0) === "_") { continue; }
            out.push({ label: dealer + "  —  " + type, path: types[type] });
        }
    }
    return out;
}

// ---- UI -------------------------------------------------------------------

function promptForCsvs() {
    var files = File.openDialog("Select OPS CSV export(s)", "*.csv", true);
    if (!files) { return null; }
    if (files instanceof Array) { return pathsOf(files); }
    return [files.fsName];
}

function pathsOf(files) {
    var out = [];
    for (var i = 0; i < files.length; i++) { out.push(files[i].fsName); }
    return out;
}

// One dialog, one row per CSV: a preset dropdown ("Browse…" last) + the resolved path.
function pickTemplates(csvs, presets) {
    var dlg = new Window("dialog", "VDP Batch — choose a template per CSV");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.margins = 16;
    dlg.spacing = 10;

    var chosen = {};   // csvPath -> templatePath
    var rows = [];

    var listNames = [];
    for (var p = 0; p < presets.length; p++) { listNames.push(presets[p].label); }
    listNames.push("Browse…");

    for (var i = 0; i < csvs.length; i++) {
        var csvPath = csvs[i];
        var grp = dlg.add("panel", undefined, baseName(csvPath));
        grp.orientation = "column";
        grp.alignChildren = ["fill", "top"];
        grp.margins = 12;

        var line = grp.add("group");
        line.orientation = "row";
        line.alignChildren = ["left", "center"];
        line.add("statictext", undefined, "Template:");
        var dd = line.add("dropdownlist", undefined, listNames);
        dd.preferredSize.width = 320;
        var pathTxt = grp.add("statictext", undefined, "(none selected)");
        pathTxt.characters = 60;

        rows.push({ csvPath: csvPath, dd: dd, pathTxt: pathTxt });
        wireRow(rows[rows.length - 1], presets, chosen);
    }

    var btns = dlg.add("group");
    btns.alignment = "right";
    var cancel = btns.add("button", undefined, "Cancel", { name: "cancel" });
    var ok = btns.add("button", undefined, "Run batch", { name: "ok" });

    var result = null;
    ok.onClick = function () {
        for (var i = 0; i < rows.length; i++) {
            if (!chosen[rows[i].csvPath]) {
                alert("Pick a template for:\n" + baseName(rows[i].csvPath));
                return;
            }
        }
        result = chosen;
        dlg.close();
    };
    cancel.onClick = function () { result = null; dlg.close(); };

    dlg.show();
    return result;
}

// Bound in its own function so each row's closures capture the right row object.
function wireRow(row, presets, chosen) {
    row.dd.onChange = function () {
        var idx = row.dd.selection ? row.dd.selection.index : -1;
        if (idx < 0) { return; }
        if (idx < presets.length) {
            chosen[row.csvPath] = presets[idx].path;
            row.pathTxt.text = presets[idx].path;
        } else {
            var f = File.openDialog("Select Illustrator template (.ai)", "*.ai");
            if (f) {
                chosen[row.csvPath] = f.fsName;
                row.pathTxt.text = f.fsName;
            } else {
                row.dd.selection = null;
            }
        }
    };
}

// ---- CSV parsing ----------------------------------------------------------

// RFC-4180-ish parser: handles quoted fields, embedded commas/quotes/newlines,
// CRLF or LF, and a leading UTF-8 BOM. Returns { headers:[], rows:[[...]] }.
function parseCsv(file) {
    var text = readFile(file);
    if (text.length && text.charCodeAt(0) === 0xFEFF) { text = text.substring(1); }  // strip BOM
    var records = [];
    var field = "", record = [], inQuotes = false;
    var i = 0, n = text.length;
    while (i < n) {
        var ch = text.charAt(i);
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < n && text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += ch; i++; continue;
        }
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === ',') { record.push(field); field = ""; i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch === '\n') { record.push(field); records.push(record); field = ""; record = []; i++; continue; }
        field += ch; i++;
    }
    // Flush trailing field/record if the file didn't end in a newline.
    if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }

    if (records.length === 0) { return { headers: [], rows: [] }; }
    var headers = records[0];
    var rows = [];
    for (var r = 1; r < records.length; r++) {
        if (records[r].length === 1 && records[r][0] === "") { continue; }  // skip blank lines
        rows.push(records[r]);
    }
    return { headers: headers, rows: rows };
}

function indexHeaders(headers) {
    var map = {};
    for (var i = 0; i < headers.length; i++) { map[lower(trim(headers[i]))] = i; }
    return map;
}

// ---- Sidecar (launched by the .ps1) --------------------------------------

// Sidecar format (key=value, one per line; csv= may repeat):
//   csv=C:\path\one.csv
//   csv=C:\path\two.csv
//   tempdir=C:\...\_vdp_temp
//   mapfile=C:\...\vdp-batch\template-map.json
function readSidecar() {
    var f = new File(Folder.temp.fsName + "/" + SIDECAR_NAME);
    if (!f.exists) { return null; }
    var text = readFile(f);
    var lines = text.split(/\r?\n/);
    var csvs = [], tempRoot = null, mapFile = null;
    for (var i = 0; i < lines.length; i++) {
        var ln = trim(lines[i]);
        if (!ln) { continue; }
        var eq = ln.indexOf("=");
        if (eq < 0) { continue; }
        var key = lower(trim(ln.substring(0, eq)));
        var val = trim(ln.substring(eq + 1));
        if (key === "csv") { csvs.push(val); }
        else if (key === "tempdir") { tempRoot = val; }
        else if (key === "mapfile") { mapFile = val; }
    }
    if (csvs.length === 0) { return null; }
    if (!tempRoot) { tempRoot = Folder.temp.fsName + "/vdp-batch"; }
    return { csvs: csvs, tempRoot: tempRoot, mapFile: mapFile };
}

// ---- PDF options ----------------------------------------------------------

function buildPdfOptions() {
    var opts = new PDFSaveOptions();
    if (PDF_PRESET) {
        try { opts.pDFPreset = PDF_PRESET; return opts; } catch (e) { /* fall through to defaults */ }
    }
    opts.compatibility = PDFCompatibility.ACROBAT7;
    opts.preserveEditability = false;   // smaller print PDFs; we never reopen these to edit
    opts.viewAfterSaving = false;
    return opts;
}

// ---- Run log --------------------------------------------------------------

function writeRunLog(dir, csvBase, out, log) {
    try {
        var f = new File(dir.fsName + "/_runlog.txt");
        f.encoding = "UTF-8";
        if (!f.open("w")) { return; }
        f.writeln("VDP batch run log — " + csvBase);
        f.writeln("pages exported : " + out.done);
        f.writeln("rows flagged   : " + out.flagged);
        if (out.error) { f.writeln("error          : " + out.error); }
        f.writeln("");
        if (log.length) {
            f.writeln("Flags / notes:");
            for (var i = 0; i < log.length; i++) { f.writeln("  - " + log[i]); }
        } else {
            f.writeln("No flags — all rows fitted cleanly.");
        }
        f.close();
    } catch (e) {}
}

// ---- Small ES3 helpers ----------------------------------------------------

function readFile(file) {
    file.encoding = "UTF-8";
    if (!file.open("r")) { throw new Error("cannot open " + file.fsName); }
    var text = file.read();
    file.close();
    return text;
}

function emptyFolder(folder) {
    if (!folder.exists) { return; }
    var files = folder.getFiles();
    for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof File) { try { files[i].remove(); } catch (e) {} }
    }
}

function baseName(path) {
    var s = String(path).replace(/\\/g, "/");
    var slash = s.lastIndexOf("/");
    return slash >= 0 ? s.substring(slash + 1) : s;
}

function sanitize(name) {
    return String(name).replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "_");
}

function pad(num, width) {
    var s = String(num);
    while (s.length < width) { s = "0" + s; }
    return s;
}

function lower(s) { return String(s).toLowerCase(); }

function trim(s) { return String(s).replace(/^\s+/, "").replace(/\s+$/, ""); }

// ---- Entry point ----------------------------------------------------------

try {
    main();
} catch (err) {
    try { app.userInteractionLevel = UserInteractionLevel.DISPLAYALERTS; } catch (e) {}
    alert("vdp-batch fatal error: " + err.message + (err.line ? " (line " + err.line + ")" : ""));
}
