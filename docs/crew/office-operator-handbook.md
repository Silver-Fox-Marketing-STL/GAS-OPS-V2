# Office Operator Handbook — SilverFox App

This is the handbook for running dealer orders in the SilverFox app: turning a VIN list
into the printed-graphics files, logging the order, and getting it into billing.

The sidebar views you'll use: **Home**, **Run Order**, **VIN Inbox**, **VIN Logs**.
(**Import Data** has its own handbook.)

> **Hands off one area:** everything under **⚙ System Settings** (Dealer Rules,
> Pipedrive Settings, Normalization, etc.) is Nick's — don't change anything there.
> Every other button in this handbook is yours to use.

---

## 1 · Start your day

**When you do this:** first thing, to see what's due.

1. Open the app — you land on **Home**.
   [SCREENSHOT: Home view — print schedule band + system stats]
2. Check the status strip at the top: **"Last scraper import: …"** should be a green
   dot (today's data). Amber/stale or "No scraper import recorded yet." → run an
   import first (see the Import handbook) or check with Nick.
3. **Today's Print Schedule** shows every dealer scheduled today that hasn't been run
   yet. Each card has a **▶ Run Order** button that jumps straight to the Run page
   with that dealer selected. A **"N in inbox"** tag means lot-scan photos are waiting
   for that dealer — work the inbox first (Section 2b).
4. A **"📝 N drafts"** chip means you have unfinished orders saved — click it to
   resume from the Drafts strip (Section 7).
5. When the band says **"All scheduled orders printed. ✓"** — you're caught up.

**Which dealers work which way** — the routine per dealer:

| Dealer | How the order usually starts | Notes |
|---|---|---|
| [NICK: fill in] | CAO / Lot scan / Manual / Combo | |
| [NICK: fill in] | | |

*(Ask Nick if a dealer isn't in this table yet.)*

---

## 2 · Where the VINs come from — four ways an order starts

Every order ends up in the same place — the **Run Order** VIN box — but the VINs can
arrive four different ways. All four paths feed the same run flow (Section 3).

### 2a · CAO-only (the computer picks the vehicles)

**When:** dealers whose orders come straight from current inventory.

1. Go to **Run Order**. Set **Running as** to yourself and pick the **Dealer**.
2. Click **↺ Pre-fill from CAO**. The app pulls the dealer's live inventory, applies
   that dealer's filter rules, and drops the net-new VINs into the box.
3. Read the CAO summary card: **Total inventory → After filters → Already printed →
   Net new (pre-filled)**. Click **"Filtered out (N) ▾"** to see exactly why vehicles
   were excluded (missing price, not yet seasoned, type not allowed, and so on).
   [SCREENSHOT: CAO summary card with the Filtered out popover open]
4. Sanity-check the count. If it says **"No net-new vehicles found after filters and
   dedup."**, there's genuinely nothing new — or the inventory is stale (check Home).
5. Continue at Section 3.

### 2b · Lot scan → VIN Inbox (photos from the field)

**When:** the field crew scanned a lot and a batch is sitting in **VIN Inbox**.

1. Open **VIN Inbox**. Batches are grouped by dealer, newest info on the chips:
   **"N submissions"**, **"N/M read"**, **"N valid"**.
2. If the header shows **Run OCR (N queued)**, click it — that reads the VINs from
   the photos (up to 15 per click; click again until the queue is empty). Cards still
   waiting show a **"still processing…"** tag.
   [SCREENSHOT: VIN Inbox — one batch expanded with tags visible]
3. Review each card. The tags tell you everything:
   - **valid VIN** + **in inventory** → good to go (you'll see the Year Make Model line).
   - **invalid VIN** or **not in inventory** → click into the VIN field and fix it
     while looking at the photo. The tags re-check as you type — no save button needed.
   - Hopeless photo (unreadable, duplicate, not a VIN) → **Discard** that card.
4. When the batch looks right, click **Create order**. The batch's valid VINs jump
   into **Run Order** with the dealer preselected.
5. Continue at Section 3. After you finalize the run, the app offers to discard the
   batch — say yes so the inbox stays clean.

### 2c · Inbox + CAO combined

**When:** a dealer gets both — scanned vehicles the office can't see in the feed,
plus whatever CAO finds in inventory.

1. Do the inbox first: work the batch and click **Create order** (Section 2b). The
   inbox VINs are now in the Run Order box.
2. Now click **↺ Pre-fill from CAO**. CAO **appends** its net-new VINs to what's
   already in the box — it never wipes your list — and skips anything already entered
   or already printed. Any duplicates get removed automatically (you'll see
   "Removed N duplicate VINs from the order.").
3. One order, both sources. Continue at Section 3.

### 2d · Manual VIN list

**When:** the dealer (or Nick) hands you VINs directly — email, text, printed sheet.

1. **Run Order** → set **Running as** and the **Dealer**.
2. Paste the VINs into the big box — **one per line** (stock numbers work too).
3. Continue at Section 3.

---

## 3 · Run a dealer order — the common core

By now you have: **Running as** = you, a **Dealer**, and VINs in the box. Whatever
path they came from, the rest is identical.

1. Watch the match table fill in below the VIN box. The count line reads like
   **"12 VINs · 11 found · 1 not found"**. Every row shows Year / Make / Model /
   Type / Stock / VIN / Status.
   [SCREENSHOT: Run Order — inventory match table with a dupe row flagged]
2. Fix what the table flags:
   - **⚠ not in this dealer** — the VIN isn't in this dealer's inventory. Check for
     a typo; remove the row with **✕** if it doesn't belong.
   - A red row with **· ALREADY PRINTED** — this vehicle is already in the dealer's
     VIN log (it was printed on an earlier order). Reprinting is sometimes right
     (damaged banner, dealer request) — if that's not why it's here, click
     **Remove Duplicates (N)** to drop them all, or **✕** per row. Note: dupes that
     stay in the order still get billed.
3. **Features column** (only some dealers): if the table shows a **Features** column,
   type the feature text for every row — the run won't start without it (you'll see
   "Enter Features for N rows before running: …"). Some dealers also show extra
   editable columns; the pre-filled text is a suggestion you can overwrite.
4. **Bypass filtering rules** checkbox: use it only when a vehicle you *know* belongs
   in the order keeps getting filtered out. It skips the dealer's filter rules for
   this run — so don't leave it on by habit.
5. Click **Run Dealer**. The progress card walks through the steps (usually well
   under a minute). When the header says **"Done! <dealer> order complete — finalize
   or abandon below."**, move to Section 4.

**If something goes wrong:**
- **"A data import is in progress …"** — someone's mid-import; finish or cancel that
  first (Import handbook).
- The run stops with an **Error:** message about product mapping or configuration →
  screenshot it and tell Nick. That's a dealer-setup problem, not something you did.
- Almost everything filtered out unexpectedly → check the CAO summary reasons; if it
  still looks wrong, tell Nick before bypassing.

---

## 4 · Finalize the run

After a run, one or more **finalize cards** appear (a dealer with split billing gets
one card per billing account). **Nothing is logged or billed until you finalize.**

[SCREENSHOT: finalize card with the three method options]

1. On each card, check the count line ("N units / N ordered") looks right.
2. Pick the method — **this is the decision that matters:**

   > **Has someone already put this order into Pipedrive?**
   > - **Yes — a deal already exists** → choose **Existing**, paste the deal's ID
   >   into **"Existing Pipedrive Deal ID"**, then click **Finalize & Link**.
   > - **No — the order hasn't been started in Pipedrive** → choose **New Deal**,
   >   then click **Create deal & Finalize**. The app creates the deal, attaches
   >   the products, and attaches the billing sheet for you.
   > - **Practice / checking output only** → choose **Test order** → **Finalize
   >   (test)**. Test runs never touch Pipedrive and never bill.

3. Success looks like **"Logged ✓ (run log row N)"** and, for real orders,
   **"✓ Pushed to Pipedrive deal #N"**.
4. Ran it by mistake, or the card shouldn't exist? Click **Abandon** — nothing is
   logged, and (if it's the last card) the output files move to Drive trash.

**If something goes wrong:**
- **"Finalize failed — nothing was logged."** → safe to try again; nothing happened.
- The card finalized but the Pipedrive push failed → the order IS logged; just click
  **Retry** on the card (or later from VIN Logs → Push to Pipedrive). If the error
  mentions product mapping, tell Nick.
- Don't close the app with unfinalized cards — it will warn you ("run results that
  haven't been finalized or abandoned"). Finalize or Abandon each card first.

---

## 5 · Get the output files

**When you do this:** right after finalizing, to hand the order to printing.

1. Click **📁 Open Output Folder**. Everything the order produced is in this Drive
   folder:
   - the **output document** (the order spreadsheet),
   - ready-made **.csv file(s)** — one per template/schema, exported automatically,
   - the **QR code PNGs** (dealers that print QR codes).
2. Download the **QR PNGs** to your computer, into **your** configured QR folder —
   the local path that belongs to the user you picked in **Running as**. Illustrator
   looks for the images at that exact path; the wrong folder = broken image links
   at print time. Not sure what your path is? Ask Nick once and write it down.
3. Grab the **.csv** file(s) for Illustrator / VersaWorks.

**What good looks like:** CSV(s) and QRs on your machine, Illustrator finds every
linked image, no "missing file" warnings.

---

## 6 · Commit the VIN log

The VIN log is the dealer's permanent record of what's been printed — it powers the
ALREADY PRINTED warnings and billing dupe checks. **It is never written automatically.**
Finalizing does NOT commit it; committing is your explicit step, done after the order
has actually gone to print.

**Right after a run:** click **✓ Add to VIN Log** at the bottom of the Run page
(it lights up once at least one real — non-test — card is finalized). It commits all
finalized cards at once and locks to **"✓ Added N VINs"**.

**Later, or for cleanup:** open **VIN Logs**:
1. Pick the **Dealer** (or browse All Dealers), find the run in **Order Runs** —
   status shows **pending** / **committed** / **rolled_back**.
2. Select it → **Commit to VIN Log**.
   [SCREENSHOT: VIN Logs — run selected, action panel showing Commit]
3. Committed the wrong run? Select it → **Rollback**. That removes exactly that
   run's entries and marks it rolled_back (you can re-commit later).
4. **＋ Manually add VINs to log** covers work done outside the system: enter the
   order number and one VIN per line → **Add to VIN Log**.
5. **Show VINs** on any run pops up its full VIN list with a **Copy** button.

**Rules of thumb:** commit when the order prints, not before. Test runs can't be
committed (the app blocks them). If billing looks wrong because of a bad commit,
rollback, fix, re-commit — and tell Nick what happened.

---

## 7 · Order drafts — never lose a half-built order

The Run page auto-saves your work-in-progress (typed VINs, feature text, edits)
whenever you switch dealers or leave the page, and every 15 seconds while you type.
**💾 Save draft** saves on demand.

- Resume from the **Drafts** strip at the top of Run Order — each draft shows the
  dealer, "N VINs", how old it is, and a **Resume** button. The **📝 N drafts** chip
  on Home jumps you there.
- A draft deletes itself when you run the order successfully. Delete stale ones
  with **✕**.
- Drafts are per-person: yours don't appear for other operators.

---

## 8 · When a run goes wrong — quick reference

| You see | What it means | What to do |
|---|---|---|
| "Please select a user / dealer / at least one VIN." | Something required is missing | Fill it in |
| "Enter Features for N rows before running" | Features dealer, blank rows | Type features for the listed VINs |
| "A data import is in progress …" | Import running or stuck mid-conflict | Finish/cancel the import first |
| Error mentioning product mapping / configuration | Dealer setup problem | Screenshot → Nick. Not your fault |
| "No net-new vehicles found after filters and dedup." | CAO found nothing new | Usually fine; if suspicious, check Home import freshness |
| Red row · ALREADY PRINTED | Vehicle already in the VIN log | Keep only if a reprint is intended; it will bill |
| "Finalize failed — nothing was logged." | Finalize didn't take | Just try again |
| Pipedrive push failed (after "Logged ✓") | Order logged; billing push didn't | **Retry** on the card, or VIN Logs → Push to Pipedrive |
| "Could not load …" anywhere | Network/Google hiccup | ↺ Refresh; if it persists, tell Nick |

**Golden rules:** never finalize as **Test** to "skip Pipedrive" on a real order —
test runs can't be committed or billed. Never touch **⚙ System Settings**. When an
error names a rule, mapping, or config — that's Nick's, screenshot and send.
