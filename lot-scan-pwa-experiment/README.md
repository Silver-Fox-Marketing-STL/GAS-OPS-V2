# Lot Scan PWA experiment — live VIN barcode + OCR

Throwaway field experiment (2026-09-22) answering two questions before any rebuild:

1. Does a page on **our own origin** (GitHub Pages) keep storage across a force-close
   when installed to the iOS home screen? (The Apps Script sandbox frame does not.)
2. How well does **live** VIN reading work on a real lot — barcode (ZXing) and text
   OCR (Tesseract.js) tried together, a read accepted only when the check digit
   passes and, with an inventory list pasted in, only when it matches the list?

Static, no backend, no build step. Served by GitHub Pages from `main`:
`https://silver-fox-marketing-stl.github.io/GAS-OPS-V2/lot-scan-pwa-experiment/`

Not Apps Script source — excluded from `clasp push` via `.claspignore`.
