<#
    run-vdp-batch.ps1 - one-click wrapper for the VDP batch pilot.

    Flow:
      1. Operator picks one or more OPS-exported CSVs.
      2. PRE-FLIGHT: scan each CSV for QR / linked-image paths and confirm every
         one exists on disk. Missing links are the #1 silent batch killer, so we
         catch them HERE, before Illustrator ever opens.
      3. Stage a sidecar job file + json2.js into %TEMP% and launch Illustrator via
         COM, running vdp-batch.jsx (it shows the manual template-picker dialog,
         fills every record, auto-fits, and exports one PDF per record to %TEMP%).
      4. MERGE: qpdf concatenates each CSV's per-record PDFs into one multi-page
         print PDF, dropped (with its run log) into a _VDP_OUTPUT folder next to
         the CSVs. The output folder opens when done.

    Requires: Adobe Illustrator (Windows, COM) + qpdf.exe (in .\bin\ or on PATH).
    PowerShell 5.1 compatible.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$JsxPath   = Join-Path $ScriptDir 'vdp-batch.jsx'
$Json2Path = Join-Path $ScriptDir 'lib\json2.js'
$MapPath   = Join-Path $ScriptDir 'template-map.json'
$TempRoot  = Join-Path $env:TEMP 'vdp-batch'
$Sidecar   = Join-Path $env:TEMP 'vdp-batch.job.txt'

# Image/link extensions we treat as "must exist before running".
$LinkExtensions = 'png','jpg','jpeg','tif','tiff','pdf','eps','ai'

function Resolve-Qpdf {
    $local = Join-Path $ScriptDir 'bin\qpdf.exe'
    if (Test-Path $local) { return $local }
    $onPath = Get-Command qpdf.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

# Match the .jsx sanitize(): strip extension, replace non [A-Za-z0-9._-] with _.
function Get-CsvBase([string]$path) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($path)
    return ($name -replace '[^A-Za-z0-9._-]+', '_')
}

function Select-Csvs {
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = 'Select OPS CSV export(s) for the VDP batch'
    $dlg.Filter = 'CSV files (*.csv)|*.csv|All files (*.*)|*.*'
    $dlg.Multiselect = $true
    if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return @() }
    return @($dlg.FileNames)
}

# Scan raw CSV text for absolute local / UNC image paths, regardless of column.
function Get-LinkPaths([string]$csvPath) {
    $text = Get-Content -LiteralPath $csvPath -Raw -Encoding UTF8
    $extAlt = ($LinkExtensions -join '|')
    $pattern = '(?:[A-Za-z]:\\|\\\\)[^",\r\n]+?\.(?:' + $extAlt + ')'
    $found = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($m in [regex]::Matches($text, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        [void]$found.Add($m.Value.Trim())
    }
    return $found
}

function Invoke-PreFlight([string[]]$csvs) {
    $missing = New-Object System.Collections.Generic.List[string]
    $totalLinks = 0
    foreach ($csv in $csvs) {
        $links = Get-LinkPaths $csv
        $totalLinks += $links.Count
        foreach ($p in $links) {
            if (-not (Test-Path -LiteralPath $p)) { $missing.Add($p) }
        }
    }
    Write-Host ("Pre-flight: {0} linked path(s) referenced, {1} missing." -f $totalLinks, $missing.Count)
    if ($missing.Count -gt 0) {
        Write-Warning 'Missing linked files (these would stall Illustrator mid-batch):'
        $missing | Select-Object -First 20 | ForEach-Object { Write-Host "   $_" }
        if ($missing.Count -gt 20) { Write-Host ("   ...and {0} more." -f ($missing.Count - 20)) }
        $ans = Read-Host 'Continue anyway? Those records will be flagged & skipped for QR (y/N)'
        if ($ans -notmatch '^(y|yes)$') { return $false }
    }
    return $true
}

function Write-Sidecar([string[]]$csvs) {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($csv in $csvs) { $lines.Add("csv=$csv") }
    $lines.Add("tempdir=$TempRoot")
    $lines.Add("mapfile=$MapPath")
    Set-Content -LiteralPath $Sidecar -Value $lines -Encoding UTF8
    # Stage json2.js where the .jsx can find it even when $.fileName is empty under COM.
    Copy-Item -LiteralPath $Json2Path -Destination (Join-Path $env:TEMP 'vdp-batch.json2.js') -Force
}

function Invoke-Illustrator {
    Write-Host 'Launching Illustrator (COM) - answer the template-picker dialog when it appears...'
    $ai = $null
    try {
        $ai = New-Object -ComObject Illustrator.Application
    } catch {
        throw "Could not start Illustrator via COM. Is Illustrator installed? ($($_.Exception.Message))"
    }
    try {
        # Blocks until the .jsx (including its dialog) returns.
        $null = $ai.DoJavaScriptFile($JsxPath)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ai) | Out-Null
    }
}

function Merge-Outputs([string[]]$csvs, [string]$qpdf) {
    # Output folder sits next to the first CSV.
    $outDir = Join-Path (Split-Path -Parent $csvs[0]) '_VDP_OUTPUT'
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $produced = @()

    foreach ($csv in $csvs) {
        $base = Get-CsvBase $csv
        $dir  = Join-Path $TempRoot $base
        if (-not (Test-Path $dir)) {
            Write-Warning "No output folder for '$base' - the .jsx may have skipped it. Skipping merge."
            continue
        }
        $pdfs = Get-ChildItem -LiteralPath $dir -Filter 'rec_*.pdf' | Sort-Object Name
        if ($pdfs.Count -eq 0) {
            Write-Warning "No per-record PDFs for '$base'. Skipping merge."
            continue
        }
        $outPdf = Join-Path $outDir ("{0}_{1}.pdf" -f $base, $stamp)
        $qargs = @('--empty', '--pages') + ($pdfs | ForEach-Object { $_.FullName }) + @('--', $outPdf)
        & $qpdf @qargs
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3) {
            # qpdf exit 3 = warnings (non-fatal); anything else is a real failure.
            Write-Warning "qpdf failed for '$base' (exit $LASTEXITCODE)."
            continue
        }
        # Surface the run log next to the merged PDF.
        $runlog = Join-Path $dir '_runlog.txt'
        if (Test-Path $runlog) {
            Copy-Item -LiteralPath $runlog -Destination (Join-Path $outDir ("{0}_{1}_runlog.txt" -f $base, $stamp)) -Force
        }
        Write-Host ("Merged {0} page(s) -> {1}" -f $pdfs.Count, $outPdf)
        $produced += $outPdf
    }
    return @{ Dir = $outDir; Files = $produced }
}

# ---- Main -----------------------------------------------------------------

try {
    if (-not (Test-Path $JsxPath)) { throw "vdp-batch.jsx not found next to this script." }

    $qpdf = Resolve-Qpdf
    if (-not $qpdf) {
        throw "qpdf.exe not found. Put a portable qpdf.exe in '$ScriptDir\bin\' or on PATH. See bin\README.txt."
    }

    $csvs = Select-Csvs
    if ($csvs.Count -eq 0) { Write-Host 'No CSVs selected - cancelled.'; return }
    Write-Host ("Selected {0} CSV(s)." -f $csvs.Count)

    if (-not (Invoke-PreFlight $csvs)) { Write-Host 'Aborted at pre-flight.'; return }

    if (Test-Path $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $TempRoot | Out-Null

    Write-Sidecar $csvs
    Invoke-Illustrator

    $result = Merge-Outputs $csvs $qpdf

    if ($result.Files.Count -gt 0) {
        Write-Host ("`nDone. {0} print PDF(s) in: {1}" -f $result.Files.Count, $result.Dir) -ForegroundColor Green
        Invoke-Item $result.Dir
    } else {
        Write-Warning ("No merged PDFs were produced. Check the run logs under: {0}" -f $TempRoot)
    }
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    if (Test-Path $Sidecar) { Remove-Item -LiteralPath $Sidecar -Force -ErrorAction SilentlyContinue }
}
