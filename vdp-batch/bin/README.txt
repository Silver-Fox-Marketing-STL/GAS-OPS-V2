qpdf goes here
==============

run-vdp-batch.ps1 merges the per-record PDFs with qpdf. Drop a portable
qpdf.exe into THIS folder (bin\qpdf.exe) and the wrapper finds it
automatically. If qpdf is already on your PATH, this folder can stay empty.

Get it: https://github.com/qpdf/qpdf/releases  ->  qpdf-<version>-mingw64.zip
Unzip and copy qpdf.exe (and, if present, the .dll files next to it) here.

The exe is intentionally NOT committed to the repo (binary). This note keeps
the folder in git so the path exists.
