# Import Handbook — Scraper Data

The **Import Data** view loads the scraper's inventory CSV files into the system.
Everything else — CAO pre-fills, inventory matching, the Home dashboard — runs off
this data, so a bad or stale import shows up everywhere. Import first, run orders
second.

---

## 1 · Import scraper CSVs

**When you do this:** whenever fresh scraper files arrive — normally before the
day's orders.

**Before you start:** have the CSV file(s) downloaded, and make sure nobody is
mid-run (the app will block with "A dealer run is in progress — wait for it to
finish before importing.").

1. Open **Import Data** in the sidebar.
   [SCREENSHOT: Import Data view — mode cards + file picker]
2. Pick the mode:
   - **Main Import (Replace)** — the normal choice. Clears the old snapshot and
     loads the new files as the current dataset.
   - **Merge with Existing** — adds files on top of what's there. Use for a late
     extra file. Merge never removes sold vehicles, so don't run on Merge forever —
     do a Replace regularly.
3. Click **Select CSV File(s)** and pick one or more files. Each file gets a card
   showing **"N rows · N/21 columns matched"**:
   - **"✓ All 21 columns matched"** — perfect.
   - **"Missing (will be blank): …"** — those fields import blank. A missing minor
     column is fine; missing Price or Stock on a whole file is worth a question.
   - A red **✗** error ("No VIN column found — this file cannot be imported.",
     "File appears empty…") — that file won't import; deselect or fix it.
4. When the totals line says **"N files ready · N total rows"**, click **Import Data**.
5. If the **Resolve N Conflicting VINs** panel appears, work it (Section 2). Otherwise
   the review panel appears — read the health check (Section 3).

**What good looks like:** **✓ Import Complete**, a vehicle total in the right
ballpark for the number of files, and **"✓ Data Health: No issues detected"**.

---

## 2 · Resolve same-VIN conflicts

**When you see this:** the same VIN appeared more than once with *different* data
(identical duplicates are removed automatically). **Nothing has been written yet** —
the import is paused waiting on your choices, and **Cancel** abandons it harmlessly.

[SCREENSHOT: conflict panel — diff table with keep-existing / keep-new radios]

1. Each conflict card shows the VIN and a field-by-field diff: **Existing** vs
   **New**, with only the differing fields listed.
2. Pick a side per VIN — **Keep existing** or **Keep new**. Usual logic: the newer
   file is usually right (price drops, status changes); keep existing only when the
   new data is obviously worse (blanked-out fields).
3. Lots of conflicts? **Keep All Existing** / **Keep All New** applies one choice to
   everything — including any overflow conflicts not shown on screen.
4. Click **Apply & Import** (it stays disabled until every conflict has a choice).

---

## 3 · Read the review + health check

The **Import Complete** panel is your receipt. Give it 30 seconds — it catches
scraper problems before they become order problems.

1. **Import Summary** badges: files, mode, duplicates removed, dropped on import,
   conflicts resolved, rows without VIN. A handful of "rows without VIN" is normal
   junk; hundreds is not.
2. **Vehicle Types** / **Status Values**: types should be the usual New / PO / CPO
   (/ CPO-EL); an unexpected type gets a warning color — mention it to Nick.
3. **Breakdown by Location**: every dealer location the scraper covers should have a
   sane count.
4. **Health check** — the important part:
   - **"✓ Data Health: No issues detected"** → done.
   - **"⚠ Data Health: N issues detected"** → read each line:
     - 🟡 **warning** (count dropped vs. the usual, new type appeared) — proceed,
       but tell Nick if it looks odd.
     - 🔴 **error** (a location dropped to zero, or huge missing-stock/missing-price
       percentages) — **stop and tell Nick before running orders** for the affected
       dealers. A zeroed location usually means the scraper broke, and CAO for that
       dealer would order nothing.
   [SCREENSHOT: review panel — health check with one warning row]
5. **Browse Current Data** (or the **Inventory Snapshot** card) lets you spot-check
   what's actually loaded, filtered by location and type.

**If something goes wrong:**
- **"Import cancelled — nothing was written."** — exactly what it says; the old data
  is untouched. Fix and retry.
- An **"Error: …"** mid-import — screenshot it and tell Nick before retrying.
- Imported the wrong file on **Replace**? The old snapshot is gone — re-run the
  import with the right file(s), then tell Nick what happened.
