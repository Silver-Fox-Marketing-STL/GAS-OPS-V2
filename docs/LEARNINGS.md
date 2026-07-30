# LEARNINGS — hard-won gotchas (GAS, Sheets, Git, MCP)

Accumulated from V2 development. Check here before debugging "impossible" behavior.

## Google Apps Script

- **6-minute execution limit.** Anything per-vehicle and network-bound must be
  batched: QR generation uses `UrlFetchApp.fetchAll()` (one parallel batch —
  ~3–5s for 50 vehicles vs 100s+ sequential).
- **`google.script.run` fails silently** on non-existent or underscore-suffixed
  (private) function names — no error, the spinner just hangs. Verify names exactly.
- **Modal iframes ignore CSS flex height.** `height: 100%` / `min-height: 0`
  don't propagate; calculate explicit pixel heights in JS (see `sizeTable()` in
  NormManager). Sidebars are hard-capped at 300px — use modals.
- **PropertiesService is cross-execution.** ScriptProperties writes from one
  running execution are visible to concurrent ones — this is what makes the
  progress-bar polling pattern work (`run_progress_{runId}`, polled every 1.5s).
- **`openById` vs `getActiveSpreadsheet()` cache inconsistency.** Writing with
  one handle and immediately reading with the other can miss data even after
  `flush()` ("No VINs found"). Use the same accessor for write+read pairs, and
  the module-level `getConfigSS_()` cache for SF_DEALER_CONFIG (one `openById`
  per execution instead of 13).
- **Fixed sleeps waste time.** After writing QUERY/ARRAYFORMULA, wait with
  `calcRecalcDelay_(rows, msPerRow, min, max)` instead of `Utilities.sleep(3000)`.
- **Large reads time out.** 5,000+ row SCRAPERDATA: never `getRange` the full
  21-column sheet from a modal call. Two-pass: read the Location column only,
  find the matching row span, read just that span.
- **Per-file DriveApp calls in loops are the easiest way to accidentally build
  a minutes-long operation.** `createFile`/`setTrashed` cost ~120ms EACH; a few
  hundred files = a perceived hang. Batch via `UrlFetchApp.fetchAll` against
  the Drive REST API with `ScriptApp.getOAuthToken()` (multipart upload for
  creates, `PATCH {trashed:true}` for trashes — see `trashFilesParallel_` /
  `generateQRCodesParallel_`). Related: folders that only ever accumulate
  (the QR folders did, with duplicate filenames) make every later folder
  operation slower — clear at the start of the producing operation.
- **Export ONE sheet (a single gid) to a formatting-preserving PDF via the Sheets
  `…/export` URL — not DriveApp's `getAs`.** `…/spreadsheets/d/<id>/export?format=pdf&gid=<gid>&fitw=true&portrait=true&size=letter&gridlines=false&sheetnames=false&printtitle=false` fetched with
  `Authorization: Bearer ScriptApp.getOAuthToken()` returns a PDF Blob of just that
  one tab **with its cell formatting intact** (banding, fonts, borders, alignment) —
  `fitw=true` scales it to the page width so wide tables don't clip. (DriveApp's
  blob conversion exports the whole spreadsheet and ignores the per-sheet print
  options.) Pattern: render the formatted content into a **temp tab**, export by its
  `getSheetId()`, then **always delete the temp tab** (even on export failure).
  (`exportSheetPdf_` / `generateBillingPdf_`, for the Pipedrive billing-PDF.)
  Confirmed working live: portrait, `fitw=true`, `gridlines=false`, letter size.
  (functions removed July 2026 — the same export-endpoint + getSheetId + OAuth-token
  pattern lives on in exportSheetCsv_.)
- **A comparison table inside a narrow, `overflow:hidden` card silently drops
  trailing columns.** The import conflict panel put cards in a 2-col grid
  (wide-canvas rework); each half-width card had `overflow:hidden`, and the
  inner `table-layout:auto` table with a fixed-width first column over-allocated
  width to the middle column and pushed the third ("New") column past the
  clipped edge — so it just wasn't visible, while the DOM still contained it.
  For any side-by-side comparison table use `table-layout: fixed` (+ `width:100%`
  and `word-break`) so every column gets allocated width and content wraps;
  don't rely on a fixed-width card to fit an auto table.
- **Growing a fixed-width sheet schema: append-only + relocate the edge marker.**
  SCRAPERDATA was a hard-coded 21 columns (A–U) with the scraper timestamp parked
  just past it at `W1:X1`. To let new columns be added at runtime: (1) move the
  timestamp OUT to an isolated `META` tab first (a marker adjacent to the data
  area blocks growth and gets clobbered once columns reach it); (2) make the width
  a single dynamic source of truth (`getSchemaColCount_()` reading a `SCHEMA`
  config tab, **cached per execution** — it's on the per-row dedup hot path);
  (3) **only append** (col V+) — never insert/reorder, so every fixed index
  (`NORM_COL`, `FILTER_FIELD_INDEX`, Location=19, URL=20, the `SELECT A:U` QUERY)
  stays valid; (4) keep the *run* path (output template + QUERY) at the base 21 —
  only the *master import* path goes dynamic; a new column is store-only until
  separately wired downstream. Normalize row width right before `setValues` so a
  stale client width can't throw.
- **Formatting calls in loops are ~12× more expensive than block formatting.**
  The DASHBOARD's per-row stripe loop issued ~500 range ops per import; one
  `setBackgroundObjects(matrix)` + column-scoped alignment calls do the same
  work in 7 ops. Build matrices in memory; touch ranges once.
- **`SpreadsheetApp.getUi().alert()` FAILS when invoked via `google.script.run`**
  (no UI context in client-invoked executions). Server functions that need to
  report to a dialog must RETURN a message for the client to render; keep the
  alert only in menu-invoked wrappers (see the `*Core_` / `app*` split).
  `Spreadsheet.toast()` works from any context.
- **SPA-in-a-modal conversion lessons (App shell, June 2026):**
  hidden views (`[hidden]` + show/hide nav) retain full DOM + JS state —
  polling intervals, pending panels, dirty flags all survive navigation, so
  per-view state machines need no rework. But: (1) author `display:flex` on a
  view root DEFEATS the UA `[hidden]` rule — ship
  `.view[hidden]{display:none !important}`; (2) include shared-utils fragments
  BEFORE view fragments — views register guards/inits at parse time;
  (3) height math must measure the view container, never `window.innerHeight`,
  and element queries must be view-scoped (`view.querySelector('.top-bar')` —
  a global query matches other views in the shared DOM); (4) never assign
  `window.onresize` from a fragment (single-owner slot) — use
  `addEventListener`; (5) operations that were implicitly exclusive when each
  modal was its own dialog (import vs run) need explicit mutual exclusion
  (`AppBusy`) once they share one page.
- **The `[hidden]`-defeated-by-an-author-`display`-rule trap is NOT limited to
  `.view`.** ANY component class that sets its own `display` — `.tag {
  display:inline-block }`, `.rv-drafts-band { display:flex }` — outranks the UA
  `[hidden]{display:none}` rule (an author declaration beats a UA one), so an
  element toggled purely by the `hidden` attribute stays visible. Symptom: a
  "0 DRAFTS" chip and an empty Drafts band both painted despite `hidden=true`
  (found from a prod screenshot, July 2026 — the same latent bug the `.view`
  guard was written for, re-hit on two new component classes). Fix idiom: ship a
  matching `<selector>[hidden] { display:none !important }` rule beside ANY
  display-setting component class you also toggle via the `hidden` attribute
  (`#homeDraftsChip[hidden]` / `.rv-drafts-band[hidden]`). Rule of thumb: if you
  set `display` on a class AND ever set its `hidden` attribute, you owe it a
  `[hidden]` override.
- **The HtmlService SPA parses ALL view fragments into ONE shared global JS
  scope.** Every `<?!= include_('ViewXxx') ?>` fragment's `<script>` is concatenated
  into the same window, so a duplicate **top-level** `function name()` in two
  fragments silently clobbers — last-loaded wins, breaking whichever view defined
  the other one (no error; the function just isn't what that view expects). Defenses:
  (1) **prefix per-view helpers** by view (the codebase uses `ps*` / `tr*` / `pd*`)
  or (2) factor ONE shared implementation and call it from both (e.g. the
  context-parameterized `psRenderRuleCard_`/`psSerializeOneRule_`/`psDeserializeOneRule_`/`psRegisterRuleCtx_`
  reused by ViewRules and ViewPipedriveSettings). **Nested** functions are
  function-scoped and safe — only top-level declarations collide. `App.html` and
  `Classic.html` are separate entry points (never co-loaded), so a name shared
  between those two shells is fine. Caught by a cross-fragment function-name
  collision audit — run one when adding a view.
- **Interpolating dynamic text into an inline `onclick` breaks on an apostrophe
  (or any quote/backslash) — pass an INDEX, not the value.** Rendering a list where
  each item's handler carries the item's own data as a string —
  `'<li onclick="pick(\'' + name + '\')">'` — looks fine until a value contains a
  `'` (e.g. the org **"Serra Honda O'Fallon"**). The browser HTML-decodes the
  attribute (`&#39;` → a bare `'`) *before* the JS parses, so the apostrophe closes
  the string argument early and the click throws a SyntaxError — the row is simply
  dead. Escaping for HTML (`escHtml`) does **not** fix it: it's the JS-string
  boundary inside the attribute that breaks, not the HTML. Fix pattern: **stash the
  row objects in a JS array and pass only their integer index** to the handler
  (`onclick="pick(i, j)"`), look the value up there, and render the visible text via
  `escHtml`. No user-controlled string is ever placed inside a handler's argument
  list. (Applied to both Pipedrive org pickers: `pdPickOrg(gid, j)` via
  `pdOrgResultsByGid` in `ViewRules.html`, and `psLinkPickOrg(i, j)` via
  `psLinkOrgResultsByRow` in `ViewPipedriveSettings.html`.) The same hazard exists
  for any value rendered into an inline handler — names, file paths, free-text notes.
- **Composable theme axes without breaking the single-pick model: key reusable
  structural CSS on independent `data-*` attributes, reflected FROM a theme's metadata,
  not on the theme id itself — and reflect them PRE-PAINT.** The theme system stayed a
  single curated pick (one persisted `data-theme` slug), but a theme needed to reshape
  *layout + elements*, not just colors. Hardcoding that per theme (`[data-theme="x"]
  #sidebar{…}` copied for every palette that wants a top rail) is N×M CSS. Instead each
  theme declares optional **axes** in its `Theme.themes` metadata (`shell`/`density`/
  `shape`/`nav`/`arrange`) and `Theme.reflectAxes(id)` writes each onto `<html>` as
  `data-shell`/`data-density`/`data-shape`/`data-nav`/`data-arrange`; the reusable structural
  CSS keys on those axis attributes, so one rule serves every palette and a pure palette ×
  axis recombination needs **zero** new CSS. **An omitted axis is REMOVED → its default**
  (so a theme only opts into the structure it wants, and the floor is the base layout).
  **Page rearrangement rides the same axis via CSS-Grid skeletons:** a view's top-level
  layout parent is `display:grid` with named `grid-template-areas` whose **default template
  reproduces today's layout exactly (a no-op)** and each section gets a `grid-area`; a theme
  then redefines the template under `[data-arrange="…"] #view-xxx` (reusable) or
  `[data-theme="id"] #view-xxx` (bespoke) — so moving the Run Order rail to the left for
  Luna is **one CSS line** (`grid-template-areas:"rail table vin"`), no markup or JS change.
  Apply the skeleton only to views with a fixed section set; leave **linear / height-calc-JS
  views** (Norm/Utilities/FieldCodes) on flex — they've nothing to rearrange and the grid
  blockify (next bullet) would only risk regressions. Two load-bearing details: (1) **reflect
  pre-paint** — the `reflectAxes(current())` call sits at the end of the shell-included shared
  script (`App.html` includes `SharedUtils` before `#appRoot`), so the chosen layout paints
  right the first frame (no FOUC); doing it in a view's init runs too late and flashes.
  (2) **Watch for attribute-name collisions** — `data-layout` was already taken (on each
  `.view` root for the responsive width tier), so the shell axis is `data-shell` **and** the
  page-arrange axis is `data-arrange` (NOT `data-layout`); namespace deliberately or two
  unrelated systems silently fight over one attribute. Persistence stays one slug; axes never
  touch view JS or `google.script.run`, so a theme still can't break a backend link. (Same
  family as the "re-key the config source without rewriting consumers" lesson — here the
  consumers are CSS selectors and the new source is per-theme metadata.)
- **When a structural axis moves from theme metadata to a user pref, keep the dead axis
  name in the registry's axis list.** `reflectAxes(id)` is the only thing that CLEARS a
  stale `data-*` attribute (an axis the current theme doesn't declare is removed, not just
  left unset) — it runs BEFORE the pref layer (`UiPrefs.applyOverrides()`) re-applies its
  own choice on top. When `shell`/`nav` stopped being theme-declarable (nav layout moved
  entirely into UI Settings, July 2026), `Theme._axes` still lists `'shell'` and `'nav'`
  even though no theme metadata sets them anymore — dropping them from `_axes` would mean
  `reflectAxes` never removes a previously-set `data-shell`/`data-nav`, leaving it stuck on
  `<html>` from whatever the last theme with that axis wrote. Same pattern for any axis/attr
  that migrates ownership from one layer to another: the clearing pass must still know the
  attribute exists, even after nothing on its "old" side sets it anymore.
- **Converting a flex container to CSS Grid is NOT automatically a visual no-op.** Grid
  *blockifies* its items (an `inline-flex`/`inline-block` child becomes `flex`/`block`) and
  `justify-self`/`align-items` default to **`stretch`** — so a content-width element (a pill
  laid out `display:inline-flex`) **balloons to the full column width** the moment it's a grid
  item. When gridifying a layout for theme-driven rearrangement (the grid-skeleton pattern
  above), audit each child's prior sizing and carry it over: a content-width inline element
  needs **`justify-self:start`** to stay its own width, and the old `align-items` must be
  re-expressed (`flex-start` → grid `align-items:start`). Caught in review on the ViewHome
  status pill (`#view-home .home-status { justify-self:start }`). The reusable pattern:
  theme-driven page rearrangement = a default-preserving `grid-template-areas` skeleton on a
  view + a metadata-reflected `data-arrange` axis; the linear/height-calc-JS views are
  excluded, and every gridified child gets its pre-grid sizing restored so the default
  template is a true no-op.
- **A portable widget injected into arbitrary host views must defend its own box model with
  `!important`.** The app-wide `CustomSelect` enhancer injects its themed dropdown DOM
  (`.cs-btn` / `.cs-menu li`) **into** whatever view holds the native `<select>` — and five
  view scopes carry a wildcard `#view-xxx * { padding:0 }` reset. That reset's specificity
  (1,0,0) **beats** the widget's class rules (≤ 0,1,1), so it silently **zeroed the widget's
  padding** → cramped "tiny options" (chased through several wrong guesses — enhancement,
  width, font-size — before the real cause). Scoping the host reset to exclude the injected
  subtree isn't safely feasible: it needs an L4 `:not(.x *)`, and on a browser without complex
  `:not()` support the **whole** reset is dropped → the view's own layout breaks. So the
  portable widget **self-defends** — it sets its own padding `!important`. Same family as the
  Encarta `!important` "legitimate top layer of intent" note: a self-contained component that
  must look right inside any host owns its own box model, loudly.
- **An HTML `<!-- -->` comment inside a `<style>` block is a silent CSS parse hazard — it
  isn't a CSS comment.** Every view fragment's `<style>` block lives inside an `.html` file,
  so it's easy to reach for the familiar `<!-- note -->` out of muscle memory; a real browser
  CSS parser doesn't recognize `<!--`/`-->` as a comment token, so at best the annotation
  becomes dead/invalid text that gets silently dropped, and at worst it swallows or corrupts
  adjacent rules depending on what follows. In-style annotations — including ponytail
  `ponytail:` markers — must use real CSS comment syntax, `/* ... */`.
- **Per-view CSS dialects for the same UI primitive drift silently — the fix is
  ONE unscoped canonical layer + a delete-the-dialect migration, not a linter rule.**
  By July 2026 the 12 views had accreted **6 different button-class dialects**
  (`util-btn`, `ds-btn`, `ps-btn-*`, `eom-btn-*`, `vi-badge`, ad hoc), **3 pill
  border-radii**, **4 table header recipes**, and **3 focus-ring variants** — every
  view had independently reinvented the same primitive because each one was
  `#view-xxx`-scoped and therefore invisible to the others; nothing *broke*, so
  nothing forced convergence. Fix pattern: (1) define ONE **unscoped** class layer
  in `SharedUtils.html` (`.btn-primary/-secondary/-ghost/-danger`, `.pill`, `.tag` +
  `.tone-*`, `.table-u`) — unscoped is load-bearing, an `#view-xxx` dialect rule
  always out-specifies a bare class, so the shared layer is a no-op until each
  view's dialect CSS is **deleted**, not just left alongside it; (2) migrate view by
  view, renaming markup classes and **removing** the old scoped block in the same
  commit (a leftover dialect rule silently wins by specificity and the migration
  looks done but isn't); (3) run a **theme-coupling audit** as the last step — any
  hardcoded theme override (Encarta/Luna in `App.html`) that targeted an old class
  name by string (`.pill`, `#view-run #vinDataTable th`) now points at nothing and
  silently stops reskinning that element. A theme's `!important` override block is
  a **second, independent coupling point to the same class name** that a class
  rename must update in the same change — grep `App.html` for the renamed selector
  before calling a rename done.
- **A per-view ELEMENT-selector dialect (`#view-xxx table/th/td`) out-specifies the
  canonical CLASS layer just as badly as a per-view class dialect does — dropping
  `.table-u` into a view with one of these needs an explicit restore, not just the
  class.** ViewImport's new Inventory Snapshot table (July 10, 2026 HUD rework) used
  `.table-u`, but the view already carried a **generic `#view-import th`/`td` header
  recipe** left over from the file-card tables (specificity 1,0,1 beats `.table-u
  th`'s 0,1,1), which silently stripped the sticky inverted header. Fix pattern
  (same shape as the CSS-dialect entry above, but for tag selectors instead of
  classes): an **ID-scoped restore block** — `#view-import #invSnapshot .table-u th
  { … }` — re-asserts the canonical look for just that table, rather than trying to
  narrow the view's older element-selector dialect (other tables in the same view
  still rely on it). General trap: before dropping a canonical `.table-u`/`.tag`/
  `.pill`/etc into an existing view, grep that view's `<style>` block for bare
  element selectors scoped to the view id — they silently outrank the unscoped
  canonical class.
- **iOS Safari fires a `change` event when a `<select>` is RE-PARENTED** — so a progressive
  enhancer that moves the select into a wrapper trips its own inline `onchange` mid-surgery.
  `CustomSelect.enhance()` does `insert wrapper → move select into it`; on iOS that DOM move
  emits a spurious `change`, and an inline `onchange` handler then ran **before its view was
  initialized**, threw, and the `try/catch` reverted the enhancement (selects stayed native on
  mobile while working fine on desktop). Fix: **detach the inline `onchange` attribute during
  the DOM move and restore it after.** Watch for the same on any framework/enhancer that
  re-parents form controls on iOS.
- **iOS "text size adjust" (font boosting) scales identical `px` text DIFFERENTLY per
  container** unless you pin `text-size-adjust:100%` (`-webkit-` + standard) on `:root`.
  Identical dropdowns rendered at visibly different sizes on iPhone until it was set — a
  silent, container-dependent zoom that no amount of explicit `font-size` overrides on its
  own, because the boost is applied *after* your sizing.
- **Copying a select's computed flex onto its wrapper: `flex:1` resolves to flex-basis `0%` —
  turn that into `0 0 0%` and the control COLLAPSES.** To make the enhanced wrapper fill the
  *same* slot as the native select, the enhancer reads the select's computed flex. A grow-flex
  select (`flex:1`) computes to grow=1 / basis `0%`; naively serializing the basis as a fixed
  `0 0 0%` removed the grow and shrank the button to nothing (the "smaller dropdown" bug). A
  **grow-flex control must keep growing** — branch on `flex-grow`: `>0` → `1 1 <basis|0%>`,
  only a real fixed basis (`px`/non-zero `%`) → `0 0 <basis>`, else `width:100%`. Don't copy a
  computed `0%` basis as if it were a fixed size.
- **No console on mobile → print computed styles to an on-screen toast from the device.** The
  padding-override root cause above was only isolated by rendering the offending element's
  *computed* `padding` into a transient on-screen toast on the actual phone — after several
  wrong theories (enhancement failing, width, font-size). Lesson: when you can't open devtools
  on the device, **measure the computed value on-device first**, then theorize; a guess about
  why mobile renders differently is usually wrong until the real number is in hand.
- **Native Google Drive OCR is the free, no-egress OCR for this stack — and the resource
  `mimeType` must be the IMAGE content-type, NOT the Google-Doc type.**
  `Drive.Files.insert({title, mimeType: blob.getContentType()}, blob, {ocr:true, ocrLanguage:'en'})`
  (Advanced Drive Service **v2**) converts the uploaded image to a Google Doc whose recognized
  text you read via `DocumentApp.openById(id).getBody().getText()` — then **always trash the temp
  Doc**. Found live: setting `mimeType` to the Google-Doc type produced **empty** text; using the
  image content-type is the working recipe (`ocr:true` does the conversion). Free, no API key, no
  third-party egress. Requires enabling the Drive API advanced service — if it's off, `Drive` is
  undefined (guard with `typeof Drive`). (`extractVinFromImage_`, Lot Scanner.)
- **Drive OCR has a low PER-USER rate limit — never fire a batch's OCR calls at once.** Bursting a
  gallery batch through OCR threw "User rate limit exceeded for OCR". Mitigate by OCRing in the
  background a few at a time with a bounded backoff-retry, paced by a 1-minute trigger (~8/run
  here) — not all at once.
- **A time-driven trigger works in a `USER_ACCESSING` web app and runs AS the accessing user** —
  so a per-user `drainOcrQueue` trigger OCRs that user's own rows under their own OCR quota and can
  `MailApp` them the summary. Make it **self-deleting when the queue drains** (and recreated by the
  next batch) to respect the 20-trigger/user limit + daily runtime quota. Adding Mail + Trigger
  scopes forces re-authorization on the next open. (Lot Scanner batch engine.)
- **Concurrent sheet appends LOSE rows even "under a lock" if you open the sheet OUTSIDE the lock.**
  Parallel executions each cached a stale last-row, so their `appendRow`s overwrote each other — a
  23-photo batch deterministically landed **9**. The robust fix used here: **don't append
  concurrently at all** — parallelize the slow Drive upload (`uploadPhotoOnly`, 5 at once) but write
  the rows through a **single serialized, chunked committer** (`commitQueuedBatch` — one execution
  `setValues`-es N rows). (If you must append per call, open the sheet **inside** the lock so it
  reads the current last row, and `flush()` before releasing — that's how the real-time single
  submit `appendVinSubmission_` does it.)
- **Mobile Safari OOMs decoding several ~12MP photos at once — decode SERIALLY, parallelize only
  the upload.** A 5-wide `<img>`/canvas decode pool failed `img.onload` for ~14 of 23 photos
  ("image decode failed"), while one-at-a-time decoded all of them. The decode (image into memory +
  canvas) is the memory-heavy step, not the network upload — so keep one image in memory at a time
  and run the *uploads* in parallel. (Lot Scanner gallery batch.)
- **A `drive.google.com/thumbnail?id=…` (or `/file/d/…/view`) URL won't load inside the
  HtmlService web-app sandbox** — auth / cross-origin, it silently 403s or blanks. Fetch the bytes
  **server-side** and return a data URL (`getPhotoDataUrl` → `DriveApp.getFileById(id).getBlob()` →
  base64) to show a Drive photo reliably in-app. (A *just-captured* local image shows fine as a
  client-side object URL — iOS Safari can even render HEIC in an `<img>` — it's only the
  already-on-Drive photo that needs the server fetch.)
- **Client-side barcode / Data-Matrix decode (ZXing) beats OCR when the label carries a code.** CDK
  windshield labels print a small VIN but also encode it in a 2D **Data Matrix** (or a 1D Code
  39/128). Decode **2D formats first then 1D**, and **validate every decode as a real 17-char VIN**
  (a stock-number barcode just fails the check digit → fall back to OCR). Loaded from a CDN
  (blocking), with graceful OCR fallback when nothing decodes. (`vpTryBarcode`, Lot Scanner.)
- **The VIN ISO-3779 check digit is the reliability lever for OCR** — validate 17 chars (no
  I/O/Q) **plus** the position-9 check digit; force the VIN-illegal O/I/Q to 0/1/0; prefer
  exact-valid 17-char tokens, and only THEN attempt bounded single-char OCR-confusion repairs
  (0↔O, 8↔B, 5↔S, 2↔Z, …) — the check digit rejects almost all of the noise (a stray window passes
  it only ~1/11, and the human confirms anyway). (`isValidVin_`/`extractVinCandidates_`, Lot
  Scanner.)
- **`getUserMedia` is policy-blocked inside a GAS HtmlService iframe — there is no live-camera
  preview.** A web app served by `HtmlService` runs in a sandboxed cross-origin iframe whose
  Permissions-Policy denies `camera`; `navigator.mediaDevices.getUserMedia` rejects (or is
  absent) with **no permission prompt** — so a scan-through-a-viewfinder UI is simply not
  attainable there. The ceiling is a **`<label>` wrapping
  `<input type="file" accept="image/*" capture="environment">`** — the OS camera opens as a
  native picker and hands back a still. Don't spend time on a getUserMedia gate/probe in a GAS
  iframe; go straight to the file-input tap-loop. (Lot Scanner capture.)
- **A programmatic `.click()` on a file input from *async* JS is silently ignored on iOS
  Safari.** iOS opens the file/camera picker only when the `.click()` (or native label
  activation) fires **synchronously inside the user-gesture task**; calling `input.click()` from
  a `.then()`/`await`/`setTimeout` continuation (e.g. "decode this photo, THEN auto-open the
  camera for the next") does nothing — **no error, no picker**. The reliable pattern is a plain
  wrapping **`<label>`** the user taps for every shot (the tap itself is the gesture) — no
  JS-driven advance to the next capture. (Lot Scanner tap-loop.)
- **A `USER_ACCESSING` web app writes as the *accessing* user — every resource it touches needs
  THAT user granted write, and "works for the owner" is the tell it doesn't.** Deployed
  `executeAs: USER_ACCESSING`, all Drive/Sheets calls run under the caller's identity, not the
  deploying owner's. A folder/sheet the owner can write but a crew member only reads → the crew
  member's write throws (or the file lands in *their* Drive instead). If a flow works when you
  (the owner) test it but fails for a field user, suspect a **missing per-user grant** on a
  sheet/folder before you suspect the code. Grant every user editor / Content-Manager on each
  written resource. (Lot Scanner submissions sheet + photos folder.)
- **A user can authorize a `USER_ACCESSING` web app with only SOME of its scopes — Google's
  granular consent has per-scope checkboxes — and every call needing an unchecked scope then
  throws `You do not have permission to call DriveApp.X`.** Each user grants scopes themselves
  at first `/exec` access; the consent screen lets them uncheck individual permissions and still
  "Allow". Field signature: the app loads and Sheets-backed features work (dealer list, drafts)
  but every `DriveApp` call fails, for exactly one user, 100% of the time — while their
  Shared-Drive/sheet sharing grants are verifiably correct (sharing grants can't compensate for
  a missing OAuth scope; they're different layers). The real error is only visible in the
  script's **Executions log** (never let a client-facing catch reduce it to a generic string —
  that hid this for a full debugging round). Fix is on the USER'S account, not the script:
  `myaccount.google.com/connections` → remove the app's access → reopen `/exec` → re-consent
  with **all** checkboxes checked. An existing partial grant never re-prompts on its own.
  Related trap from the same incident: iOS Safari multi-login (`/u/N` slots, Google/Gmail apps
  silently re-adding accounts) can block `/exec` access outright or bind the session to the
  wrong identity — the capture header's "Signed in as …" line (`Session.getActiveUser()`)
  makes the executing identity visible in the field. (Lot Scanner crew-member
  100%-upload-failure incident, July 2026.)
- **A retired `google.script.run` server function must be stubbed to THROW, not to return
  `{ok:false}`.** A soft-failure object reads as **success** in any caller that doesn't inspect
  `.ok` — a stale client pinned to the old endpoint would silently "submit" into a black hole.
  Replace the body with `throw new Error('Old app version — pull down to refresh.')` so a stale
  client fails **loudly**. (Don't fully delete the name while a deployed client still calls it —
  `google.script.run` fails silently on a *missing* name too, so a throwing stub is the louder
  interim state.) (`submitVinPhoto` deprecation stub, Lot Scanner.)
- **`LockService` is per-SCRIPT-PROJECT — two Apps Script projects sharing one sheet can't lock
  each other out, so a slow loop must re-verify row identity before every write.** The office
  OCR runner (main app) reads N queued rows, then writes results back by **row number** over
  several seconds; meanwhile the scanner (a *separate* script project) can `deleteRow` a
  discarded submission, **shifting every row below it up by one** — and no lock the office takes
  is visible to the scanner. Cached row numbers then point at the **wrong** rows (orphan-row
  corruption). Fix: carry a **stable id** (`submission_id`) and, immediately before each write,
  **re-read the id cell at the cached row and re-locate by id (or skip) if it moved**. Any
  cross-project row-index write over a nonzero window needs this. (`runInboxOcr`.)
- **Drive trash is OWNER-ONLY for a *My Drive* file — an editor can't trash what someone else
  owns; a Shared Drive (org-owned, role-based trash) is the fix.** The office couldn't trash a
  discarded/processed photo because a `USER_ACCESSING` upload had made the **crew member** the
  owner (My-Drive semantics), and `setTrashed(true)` from a non-owner throws. Moving the photos
  folder to a **Shared Drive** makes files **org-owned**, where trash is **role-based** — anyone
  with **Content Manager** can trash regardless of who uploaded. (Keep the trash
  best-effort/counted anyway: legacy My-Drive photos from before the move still can't be
  office-trashed.) (`LOT_PHOTOS_FOLDER_ID` → Shared Drive; `trashLotPhoto_`/`sweepLotPhotos`.)
- **A find-or-create of a shared Drive folder RACES under a parallel upload pool — one order
  created two subfolders.** The client uploads 5-wide; on a dealer's first-ever photos every one
  of the 5 concurrent executions saw "no subfolder" and each ran `createFolder`, so one order
  produced two identically-named subfolders. Fix = **double-checked locking**: a **lock-free fast
  path** (`getFoldersByName().hasNext()` → return it) for the common case, and only on the create
  path take a **script lock and re-check inside it** before creating — with a best-effort
  `waitLock` so an upload never *fails* on lock contention. (`getDealerPhotoFolder_`.)
- **A custom-select facade over a native `<select>` does NOT repaint when code changes the
  select's `.value` — its `MutationObserver` is childList-only, and the refresh must run AFTER
  re-enabling.** The `CustomSelect` widget mirrors the native value into its own button/label
  DOM, but it observes only option **childList** changes, not a programmatic `.value` assignment
  — so `sel.value = dealerKey` (resuming an order into a locked dealer) left the facade showing
  the *old* label. Fix: call the facade's explicit **`refresh()`** after the value write — and do
  it **after** you re-enable the select, so the same call also clears the stale `aria-disabled`.
  Any thin facade over a native control needs a manual repaint on model-side value writes.
  (`CustomSelect.refresh` in `vpBeginShooting` / order-end, Lot Scanner.)
- **`CustomSelect` has NO value observer — a programmatic `select.value = x` (even with a
  dispatched `change` event) leaves the facade's button/label stale until you call
  `CustomSelect.refresh(sel)` explicitly.** A dispatched `change` fires listeners bound to
  the native element, but the widget only repaints on option-childList mutation or its own
  click handler — it never watches `.value`. Confirmed again in the VIN-Inbox-to-Run-Order
  cross-view jump (`runPrefillFromInbox`, `ViewRun.html`): `sel.value = dealerKey;
  sel.dispatchEvent(new Event('change'))` runs the real dealer-select handler (data loads,
  guards fire) but the enhanced dropdown kept showing the old label until `CustomSelect.refresh(sel)`
  was added right after. **Known latent gap:** `vinlogPreselectDealer` (`ViewVinLog.html`,
  the older Run-Order-→-VIN-Log jump this pattern was modeled on) still sets `.value` +
  dispatches `change` with no `refresh()` call — same stale-facade bug, not yet hit/fixed.
  Any future `select.value =` write needs the same follow-up refresh call.
- **`lot-scan/SharedUtils.html` is an OLD, DIVERGENT copy of the main app's — a class you emit in
  lot-scan HTML must exist in *lot-scan's own* files.** The scanner's `SharedUtils.html` was
  copied before the July 2026 unified-component layer, so it has **no `.tag` / `.tone-*`**
  classes; markup written from muscle memory against the main app's current SharedUtils renders
  unstyled in the scanner. A drafts status chip written as `.tag` showed as plain text until it
  was reworked to a **local `ls-chip`** class defined in the scanner's own files. Grep the
  *lot-scan* copy for any class before using it there — the two SharedUtils are not kept in sync.
  (Lot Scanner drafts chip.)

## External APIs (Pipedrive)

- **Pipedrive enforces INTEGER ids on writes — coerce string-stored ids before sending.**
  Ids live as strings in our config (`product_id:"188"`, enum option id `"58"`), but the
  Pipedrive API rejects them (`body/product_id must be integer`; same for deal enum/set option
  ids). The push then *creates the deal fine* but the product-attach / field-set calls fail —
  "deal created, nothing attached." Coerce numeric ids to `Number` on the way out:
  `product_id`/`variation_id`/`item_price`/`quantity` in `pdAttachProducts_`, and enum/set option
  ids + monetary amounts in the deal-field map (`pdOptionId_`). **Coerce by TYPE, never blanket** —
  leave `text`/`varchar` fields as strings, or a numeric-looking text value (a stock number, a
  phone) gets mangled. The tell: `org_id` was already `Number()`-coerced at deal creation, so the
  deal created while everything keyed on string ids silently failed.
- **Pipedrive v1 deal custom fields are TOP-LEVEL hash keys, not a
  `custom_fields` object.** The `{custom_fields: {...}}` wrapper is a **v2**
  convention; the v1 `/deals` create/update API takes each custom field as a
  top-level key (the 40-char field hash), and a **monetary** field needs both
  `<key>` (the amount) and `<key>_currency`. Passing the v2 nested shape to a v1
  endpoint silently **no-ops** the fields — the call succeeds, the values just
  don't land. (`pdResolveDealFields_` returns a flat `{key:value}` map, incl. the
  `_currency` companion, precisely so it can be passed straight to `pdUpdateDeal_`.)
- **Pipedrive does NOT auto-copy a product's catalog tax onto a deal line — only
  the UI does. The API push must send `tax` + `tax_method` explicitly.** A product
  in the catalog carries a `tax` percentage ("Tax %"), and adding it to a deal *in
  the Pipedrive UI* copies that rate onto the line. But `POST /deals/{id}/products`
  via the API defaults the line to **0% tax** unless you pass `tax` (and
  `tax_method`) yourself — so system-pushed products billed no tax while manually
  added ones did. Fix: read `tax` off the catalog product (`pdListProducts_`), carry
  it through `buildLineItems_`/`mergeLineItems_`, and send `tax` + `tax_method:
  'exclusive'` in `pdAttachProducts_`/`pdAddDealProduct_` (SilverFox never includes
  tax in the price → always exclusive). **Confirmed-live trap that made this hard to
  diagnose: the v1 GET `/deals/{id}/products` UNDER-REPORTS `tax` as `0` even when
  the line genuinely has tax** — the first probe read tax:0 on a known-good manual
  deal and looked like manual-add didn't set tax either. The deal's *summary* settled
  it (Subtotal $124.80 → Total-with-tax $134.87 = exactly 9.679% on the two taxed
  $104 of lines), and the **v2** GET reports the line `tax` correctly. So: confirm
  tax behavior via the **deal total or v2**, not the v1 line read; and the POST
  *response echo* is the reliable check that the API accepted your `tax` param.
  (Same family as the v1/v2 `success` / `is_linkable` shape traps — don't trust one
  endpoint's representation; verify against live data.) Caveat: `pdAttachProducts_`'s
  dup-guard skips a product already on the deal, so a line attached at 0% by an
  earlier push isn't retro-fixed on re-push — only fresh attaches get tax.
- **Idempotency for "create" external calls: write the external ID to a durable
  LOCAL record the INSTANT the API returns it, and treat that ID's presence as
  "already created."** The Pipedrive push writes the new Deal ID to RUN_LOG col D
  immediately after creation, then treats a numeric col D as a dup guard — so a
  retry after a mid-push failure can never create a second deal. Track multi-step
  progress (products attached? fields set?) in **ScriptProperties** (cross-execution)
  so a retry resumes instead of repeating completed steps. The local write must
  happen *before* the later, failure-prone steps — not at the end.
- **When the durable idempotency anchor only exists AFTER a row is written, but you
  must create the external resource BEFORE the row, bridge the gap with a
  token-keyed cache.** The method-first finalize flow has to *reorder*: create the
  Pipedrive deal FIRST (so the RUN_LOG row gets the real deal id and never a
  placeholder), then write the row. But the usual dup guard (a numeric Deal ID in
  RUN_LOG col D) doesn't exist yet during that window — a retry that died between
  "deal created" and "row written" would otherwise create a *second* deal. Fix:
  `finalizeRunNewDeal` caches the created deal id (then the resulting `rowIndex`) in
  ScriptProperties under a **stable run token** (`pd_new_<outputDocId|group>`) the
  instant Pipedrive returns it; the next attempt reads the cache and **adopts** the
  existing id/row instead of re-creating. Pick a token that's derivable from the
  same inputs on every retry (here outputDocId + billing group — not a per-attempt
  value). **Clear it on success alongside the row-keyed state** (`pd_push_<row>`),
  so the two anchors hand off cleanly: the token cache covers create-before-row, the
  numeric-col-D guard covers everything once the row exists (link/retry). Same
  underlying rule as the bullet above (anchor the instant the id returns, before the
  failure-prone steps) — the cache is just the anchor for the pre-row interval.
- **"On create = always; on link = set-if-empty" collapses to ONE fixed-value rule
  when you treat a brand-new resource as empty — and the safe direction when you
  can't read the current value is to SKIP, not overwrite.** The Pipedrive deal-field
  rules needed to set a single-select (`Proof`) to a default ("No Proof Required") on
  every *new* deal, but on an *existing* (linked) deal only if it isn't already set
  (a template-request deal that already requires a proof must be left alone). The
  instinct is two code paths (or a `Proof`-specific branch); instead it's **one
  `mode:"constant"` rule with an `if_empty` flag** plus an `isNewDeal` signal —
  treat a freshly-created deal as empty (so `if_empty` always fires on create) and,
  on a link, read the deal's current value and set only when it's blank. The
  load-bearing fail-safe: when that current value **can't be read** (`pdGetDeal_`
  failed → `existingDealFields` is null), the resolver **does nothing for that rule**
  rather than writing the default — so a transient read failure can never clobber a
  value a human deliberately set. (`pdResolveDealFields_` gained `isNewDeal` +
  `existingDealFields`; constants resolve **without** the org, and an org-fetch
  failure returns the constant results, not `{}`, so adding a constant rule can't
  regress copy/conditional output.) Same family as the gross-quantity and
  fail-direction lessons: **pick the no-op/skip branch by what it protects (a value
  the user set), not by a fixed return.**
- **External-API secrets live in ScriptProperties, never the repo or a config
  sheet** — and are **validated before they're saved** (`setupPipedriveSecrets`
  does a live `GET /users/me` first; nothing persists on failure). A status/echo
  endpoint exposed to the UI must **never return the token** (`getPipedriveStatus`
  returns domain + defaults only).
- **A never-throw fetch wrapper is the same isolation discipline as the non-fatal
  stats/dashboard writes.** `pdFetch_` returns `{ok, status, data, error}` instead
  of throwing, with one bounded 429 backoff, so an API hiccup surfaces as a
  retryable message — it can **never** fail the run it's attached to. Same rule as
  "non-critical writes get their own try/catch": an integration bolted onto a
  production run must isolate every failure mode at the boundary.
- **GAS auto-builds `multipart/form-data` from a `UrlFetchApp` payload OBJECT whose
  field is a Blob — no manual boundary needed.** To upload a file to a REST endpoint
  that wants `multipart/form-data` (Pipedrive `POST /api/v1/files` to attach a file to
  a deal), pass `payload: { deal_id: '123', file: blob }` to `UrlFetchApp.fetch` — when
  any payload field is a Blob, GAS builds the multipart body, boundary, and per-part
  headers for you. This is **different from** the hand-rolled `multipart/related` body
  (explicit boundary string + `Content-Type` line) used for the Drive REST multipart
  upload in `generateQRCodesParallel_` — that one is a different content type the helper
  doesn't assemble. It also can't go through `pdFetch_` (which is JSON-only — it
  `JSON.stringify`s the payload), so the upload is a raw `UrlFetchApp.fetch` with the
  token on the query string. (`pdAttachFileToDeal_` — the first file upload in the
  codebase.) Rule of thumb: **a Blob field in a plain payload object → let GAS do the
  multipart;** only hand-roll the body when you need a non-form multipart type.
- **Pipedrive product variations live behind a SEPARATE, v2-ONLY endpoint.** A
  product's variations come from `GET /api/v2/products/{id}/variations` (cursor
  pagination) — they do **not** exist on v1 and are *not* embedded in the `/products`
  list payload. Hitting the v1 base returned an error → empty list → a blank/greyed
  variation dropdown in the UI. Fetch them **lazily, per product**, only for the
  products that actually pin a `variation_id` (`pdListProductVariations_`). A
  variation carries its own `prices[]`, so resolve `item_price` from the variation
  first (product prices as fallback), and key line-item idempotency by **product +
  variation** (`product_id|variation_id`), not product alone — otherwise two
  variations of one product collapse into a single line.
- **Pipedrive API v2 OMITS the `success` field that v1 returns.** v1 success
  responses are `{success:true, data, additional_data}`; v2 leaned out the envelope
  and signals errors via HTTP status only (it also swapped `start`/`limit` for
  cursor pagination). A fetch wrapper that gates on `body.success === true` silently
  rejects **every** v2 call — which here would have broken both product variations
  and the org custom-field reads that conditional deal-field rules depend on. Make
  the wrapper version-agnostic: treat a response as ok unless it's an HTTP error or
  carries an explicit `success:false` (`pdFetch_`).
- **A Pipedrive product's "deactivated / can't-be-added-to-a-deal" state is v2
  `is_linkable: false` (v1's `selectable`) — NOT `is_deleted`.** `is_deleted` is a
  soft-DELETE flag and stays `false` for a product that is merely *deactivated*
  (confirmed against live data: `BMWCOMO_VDPSCP_01` returned `is_deleted:false`
  while deactivated). The v2 product object also has **no** `active_flag` /
  `selectable` / `is_active` field — `is_linkable` is the one that means "can be
  put on a deal," which is exactly the gate Pipedrive enforces when attaching
  products (`pdListProducts_` reads it; the picker hides inactive products and the
  push preempts on them — see the Bridge doc "Deactivated products" note). Watch
  out: the Pipedrive docs/migration guide conflate "`active_flag` → `is_deleted`,"
  which is misleading — `active_flag` (the v1 selectability flag) maps to
  `is_linkable`, not to soft-delete. Same recurring lesson as the `success`-field
  and inline-custom-fields traps: **don't guess a v2 response shape from v1 or the
  migration guide — confirm the field against live data.**
- **Pipedrive has NO line-item update until you `PUT /deals/{id}/products/{attachmentId}`
  with the deal-product ATTACHMENT id — which is distinct from `product_id`.** Attaching
  a product (`POST /deals/{id}/products`) returns a *deal-product attachment* row whose
  own `id` identifies that line on that deal; editing the line (price, quantity,
  variation) is a `PUT` against `/deals/{id}/products/{that-attachment-id}`, NOT against
  the product or the deal. (`pdUpdateDealProduct_` — the first line-item UPDATE in the
  codebase; `pdListDealProducts_` rows carry both `id` (attachment) and `product_id`.)
  Confirm the row shape against a live deal before relying on it — a temporary
  `pdDebugDealProducts(dealId)` logged `Object.keys` + a sample for exactly this. To make
  a line idempotent, look it up by `product_id` among the deal's current rows and PUT the
  existing attachment `id` if found, else POST a new one (`pdApplyInstallCost_`).
- **To set a value on a line item that a THIRD-PARTY AUTOMATION adds asynchronously,
  POLL for it — don't read immediately — and update ONLY-IF-EMPTY so you never clobber a
  real value.** A Pipedrive automation adds the "Design" line a few seconds *after* deal
  creation, so reading the deal's products right after create finds no Design row at all.
  `pdApplyDesignVariation_` polls (~8 × 2s) for the row, then sets the No-Charge variation
  **only if its variation is currently empty** (`pdFieldEmpty_`) — a deal that already
  carries a meaningful value (a template-request deal with a charged Design) is left
  untouched. Make it **best-effort**: if the automation hasn't fired within the poll
  window, return a `…Pending` flag and let the push still succeed (a later re-push sets
  it) rather than failing the run or blocking forever. Same family as the constant-rule
  `if_empty` policy and the org-engine fail-safe: when another system may own the value,
  read-then-set-if-empty, never blind-write.

## Google Sheets behavior

- **QUERY silently drops mixed-type minority values.** Purely numeric stock
  numbers get auto-converted to numbers; alphanumeric ones stay strings; QUERY
  then drops one side. Fix: `String()` conversion + `@` number format set
  **before and after** `setValues()` on VIN and Stock.
- **QUERY `MATCHES` doesn't reliably honor `(?i)`** — use explicit-case patterns.
- **Substring traps in type matching.** `SEARCH("CPO", "CPO-EL")` matches.
  Order checks CPO-EL → CPO → New → fallback, in formulas and in `type_rules`.
- **Section-marker parsing has the SAME substring trap as type matching — order
  the longer/more-specific marker first.** Parsing a sheet back into structure by
  matching its section-header rows (`── ORDER SUMMARY ──`, `── BY TYPE ──`,
  `── DUPLICATES BY TYPE ──`, …) with `indexOf` hits the exact CPO/CPO-EL problem:
  `── DUPLICATES BY TYPE ──` **contains** the substring `BY TYPE`, so a naive
  `if BY TYPE … else if DUPLICATES …` chain mis-buckets every duplicate row under
  By-Type. Check **`DUPLICATES` before `BY TYPE`** (the more-specific marker first),
  exactly as type checks do CPO-EL before CPO. (`readBillingForPdf_`, which parses
  the rendered BILLING sheet for the Pipedrive billing-PDF — caught by a unit test.)
  Same lesson as the type substring trap: when one marker string is a substring of
  another, the longer one must be tested first. (function removed July 2026 with the
  billing-PDF pivot to CSV.)
- **`getValues()` returns real booleans** for TRUE/FALSE cells — compare with
  the `isTrue_()` helper, not string equality.
- **`getValues()` returns numbers (and Dates) from non-`@` columns.** SCRAPERDATA
  only forces text on VIN/Stock/Price/Date-In-Stock; Year, MSRP, Postal Code etc.
  come back as numbers (`2024`, `6234` for `"06234"`). Comparing sheet data
  against incoming string data needs a tolerant comparator (trim-string equal OR
  both-numeric equal — `cellsEqual_`), or merge-mode imports false-conflict on
  every row. Also: **`google.script.run` cannot serialize Date objects** — any
  sheet rows returned to a modal must be display-stringified first.
- **`PRICE_RAW` (ORDERMATCH col H) is stored as text, not a number.** `ISNUMBER(H2:H)`
  is FALSE for it, so any formula guarding on `ISNUMBER` blanks every row (this is
  exactly how the first `PRICE_TAGLINE` formula failed). Arithmetic (`H2:H+2000` in
  `PRICE_PLUS_2000`) works because `+` coerces text→number, but **comparisons don't
  coerce** — and Sheets sorts any text *above* any number, so `H2:H>=15000` is TRUE
  for every text price. For numeric comparison on a price, convert first:
  `IFERROR(IF(VALUE(H2:H)>=15000, …), "")`.
- **Merged cells break programmatic repositioning** — the DASHBOARD is written
  with zero merged cells for exactly this reason. `setRgbColor()` via
  `SpreadsheetApp.newColor()` handles hex backgrounds without Advanced Services.
- **Volatile full-column formulas in a config sheet can make it unreachable to
  code while the browser stays fine.** SF_DEALER_CONFIG's NORM_MAPS cols E+ held
  live `UNIQUE(SCRAPERDATA!…)` reference formulas. They were cheap for years, but
  once SCRAPERDATA passed ~10k rows (and a large import invalidated them all at
  once), recalculation made *programmatic* access — Apps Script `openById`/`getValues`
  AND the Sheets REST API — fail with `Service Spreadsheets failed` after a ~100s
  timeout, taking down every config-reading modal and `importScraperData`. The
  interactive web UI never blocks on recalc, so it kept opening fine — which is the
  tell that it's a recalc/serving cost, not an outage or a code bug. Fix: replace
  volatile reference formulas with an **on-demand static writer** (`refreshNormReference()`)
  that computes uniques in code and writes plain values — zero standing recalc cost.
  Diagnosis tip: a 503/timeout on ONE spreadsheet via the API while another reads
  fine, plus the browser working, points at that document's serving cost, not your code.

## Git / GitHub (incl. GitHub MCP)

- `create_or_update_file` needs an explicit `branch` and a **fresh SHA** fetched
  immediately before the write — stale SHAs fail; omitted branch fails silently.
- `Code.gs` (~124KB) exceeds the MCP push limit — handle it via local `git push`
  or hand the file over for a local commit. `push_files` is unreliable for large
  single files; prefer `create_or_update_file` per file.
- Verify pushes by comparing blob SHAs, not by re-reading content. Pushing
  identical content to two branches yields matching blob SHAs (no merge conflicts).
- Always pull fresh from GitHub before editing — local copies and project-knowledge
  copies of `Code.gs` go stale fast.
- **clasp: a STANDALONE sub-project inside an existing repo needs two guards.** Creating the Lot
  Scanner (`lot-scan/`, its own Apps Script project) inside the main repo hit both: (1) `clasp
  create` walks **up** the tree and finds the parent `.clasp.json` ("Project file already exists")
  → create it in a **sibling temp dir** instead, then copy its `.clasp.json` into the subfolder;
  (2) `clasp push` from the repo root scoops the sub-project's files into the **main** script
  (clasp's namespace is flat → `Code`/`SharedUtils` collisions) → add the subfolder to the main
  project's **`.claspignore`**. Also seen once: a stray self-referencing **library** entry in the
  remote manifest ("You do not have access to library … used by your script") — clear it by
  re-pushing the clean local `appsscript.json`.
- **`git status` can lie after a same-size, mtime-preserving copy — and `git checkout -- <file>`
  then silently no-ops.** The 2026-07-14 lot-scan promote left `lot-scan/.clasp.json` pointing at
  the **PROD** scanner while `git status` reported a clean tree: PowerShell's `Copy-Item` preserves
  the SOURCE file's LastWriteTime, and the two clasp jsons are the same byte size, so the swapped
  file matched the index's cached stat (size + mtime) exactly — git never re-hashed it, and the
  promote script's `finally` restore (`git checkout -- .clasp.json`) trusted the same stat cache
  and rewrote nothing. The next plain `clasp push` would have shipped a feature branch to prod.
  Detection: compare `git hash-object <file>` against `git rev-parse HEAD:<file>` (content truth,
  no stat cache). Fix in both promote scripts: **delete the file before the restoring checkout**
  (`Remove-Item` + `git checkout --`) — a missing file always forces a real rewrite. General rule:
  after any script swaps a tracked file and restores it, verify by blob hash, never by `git status`.

## Sheets MCP

- `get_sheet_data` can return empty for QUERY spill ranges (read-timing);
  verify QUERY output another way before concluding it's broken.
- API quota is 60 reads/min/user — batch with `get_multiple_sheet_data` /
  `get_multiple_spreadsheet_summary`, and back off on 429s.
- `batch_update` quirks: `unmergeCells` must precede any `repeatCell` in the same
  request array; column deletions must run right-to-left (highest index first);
  `deleteDimension` is 0-indexed and needs the numeric `sheetId`, not the name.
- `update_cells` rejects values starting with `=` — use `--- SECTION ---`
  delimiters in documentation cells, never `=== SECTION ===`.
- `find_in_spreadsheet` with an exact string is the fast way to locate a known
  bad value in a large sheet.

## System design lessons

- Hardcoded column indices are fragile: the RUN_LOG 19→23 expansion silently
  broke `getRunsForDealer` until its read width was updated. When widening any
  sheet schema, grep for every read of that sheet in the same change.
- Config keys the code doesn't read are landmines (`model_trim_split` sat inert
  in Glendale's `data_transforms`) — when adding config, wire it up or don't add it.
- Explicit JSON config per dealer beats implicit defaults — every dealer's
  `type_rules`/`filtering_rules` is fully written out, so a blank cell is a bug,
  not a default.
- **The PRODUCT is the output unit — make it the SOLE per-type config, and BLOCK on a
  gap rather than fall through to a catch-all.** A type's CSV **schema ≠ the print
  template**: the actual Illustrator template identity lives with the Pipedrive
  **product** the user already picks for billing, so a separate `csv_schema` on the
  type rule was a second source of truth that could disagree (and an earlier
  `output`-label idea would have been a *third*). The change landed in **two steps —
  note the second**: first the schema/grouping were *derived* from
  `product_map[type].schema` with `type_rules.csv_schema` kept as a **fallback**; then
  (v2.12) the **fallback was removed** and the product map became the **sole** per-type
  config — each `product_map[type]` carries `{product_id, variation_id?, schema?, utm?}`
  (schema + UTM), `runDealer` builds *synthetic* type rules from it
  (`buildTypeRulesFromProductMap_`, **CPO-EL before CPO** — substring trap), and a
  matched type with **no product or no schema makes the run THROW**
  (`validateProductMapForRun_` → a clear "set it in Dealer Rules → Pipedrive" error)
  instead of silently using a `*` catch-all. `type_rules` (col O) is now **dormant**
  (kept only for the one-time `migrateTypeRulesIntoProductMap()` backfill). The lesson:
  once one mapping is authoritative, an unmapped case is a **configuration error to
  surface loudly**, not a hole to paper over with a default — the loud failure is what
  forces the product map to actually be complete. Two safeguards that carried over:
  (1) `schema`/`utm` are **optional + ignored where irrelevant** (`buildLineItems_`
  never reads them), so they can't regress the billing push; (2) the synthetic rules
  feed `buildLinks_`/`buildUtmFormula_` (UTM) and `buildCSVSheet_`/`csvOutputGroups_`/
  `resolveRuleSchema_` (schema/grouping) **unchanged** — only the *source* of the rules
  changed. Watch the blast radius both times: the grouping *key* is the resolved schema
  (renaming/merging output sheets is a behavior change, not a no-op — enumerate the
  affected dealers), and removing the fallback means **every dealer now needs a
  complete product map before it can run at all** (even test runs) — a prerequisite,
  not a silent default.
- **Billed quantity is GROSS — a VIN-log "duplicate" is still produced and billed.**
  A VIN already in the VIN log isn't dropped from a run; it's re-printed (the log
  only flags it). So the Pipedrive line-item quantity is the gross per-type count,
  **not** net of dupes — `buildLineItems_` reads `totalNew`/`totalPO`/… straight
  from `readBillingTotals_` with no dupe subtraction. Don't let "dupe" terminology
  in the billing sheet trick a downstream count into subtracting it.
- Non-critical writes (stats, dashboard) get their own try/catch so they can
  never fail a production run; the same isolation rule applies to the planned
  Pipedrive push.
- **A rule engine's safe-failure direction follows its polarity — keep the
  vehicle either way.** The original `filtering_rules` `conditions` were *inclusion*
  filters ("keep only if it matches") and so failed **OPEN** — `evaluateCondition_`
  *passed* the vehicle on any misconfig (unknown field/op, empty values, bad number).
  The June 2026 `targeting_rules` rewrite flipped to *exclusion-on-match* ("if it
  matches, ACT") — so the predicate (`conditionMatches_`/`groupMatches_`) now fails
  **SAFE = no-match** (returns false, plus empty group → false). Opposite boolean,
  **same real-world outcome: a non-programmer's typo can never silently empty a
  dealer's inventory.** The lesson is to pick the failure value by what it *does*
  (keep the car), not by a fixed "always return true." Inverting an inclusion config
  to an exclusion one also inverts every op (`not_contains`↔`contains`, `gte`↔`lt`,
  `lte`↔`gt`) — which is why `gt`/`lt` had to be added alongside `gte`/`lte`.
- **Make/Model are RAW (un-normalized) in SCRAPERDATA** (only Type/Trim/Status/
  Price are normalized). For targeting on make/model, prefer `contains` and list
  keyword variants (`F-250` *and* `F250`) — exact-match (`in`) is brittle against
  feed inconsistency. Numeric ops on price must strip `$`/`,` first (prices are text).
- **One field→column map, surfaced to the UI.** The cached, schema-driven
  `getFilterFieldIndex_()` (which replaced the static `FILTER_FIELD_INDEX`) is the
  single source of truth for condition fields; `getRulesEditorBootstrap` returns the
  schema fields + ops + actions so the Rules Editor dropdowns can't drift from the
  engine. Duplicating the list in HTML would be a latent divergence bug.
- **To repoint a pipeline's CONFIG SOURCE without rewriting the pipeline, synthesize
  its existing input shape.** The per-type output config moved from `type_rules`
  (DEALERS col O) to the Pipedrive product map — but the whole run pipeline
  (`buildLinks_`/`buildUtmFormula_` for QR UTM, `buildCSVSheet_`/`csvOutputGroups_`/
  `resolveRuleSchema_` for CSV schema + grouping, `matchRule_` for per-vehicle type
  matching) was built around a `typeRules` array of `{match, csv_schema, utm}`. Rather
  than thread the product map through all of it, `buildTypeRulesFromProductMap_` emits
  exactly that array **from** the product map (one synthetic rule per mapped type) and
  hands it to the unchanged pipeline — so only the *source* of the rules changed, not
  a single consumer. The synthetic rule's `csv_schema` IS the product's schema, which
  is also why there's no longer any run-time "fallback to col O": the fallback field is
  populated from the new source. **The substring-ordering safety is load-bearing in the
  synthesis:** because `matchRule_` is a substring search (`"CPO"` ⊂ `"CPO-EL"`, `"PO"`
  ⊂ `"CPO"`), the synthetic rules must be emitted **CPO-EL before CPO** (the builder
  sorts to a fixed `['CPO-EL','CPO','New','PO']` order) — feed them in object-key order
  and a CPO-EL vehicle would match the `CPO` rule first and get the wrong schema/UTM.
  Same CPO/CPO-EL substring trap as the type-rule formulas and the billing-PDF parser.
- **Removing a fallback turns "config is optional" into "config is REQUIRED" — gate it
  with a clear, surfaced block, not a silent default.** When the product map became the
  *sole* per-type source (no `type_rules` fallback, no `*` catch-all), a dealer with a
  matched type that has no product/schema would otherwise silently produce wrong/empty
  output. `validateProductMapForRun_` instead returns the offending types and
  `runDealer` **throws** a specific message ("set them in Dealer Rules → Pipedrive")
  that rides the existing run try/catch → `setProgressError_` → the run modal. Failing
  loud at the gate (with the fix location named) beats a quiet fall-through once the
  safety net is gone — and a one-time idempotent migration
  (`migrateTypeRulesIntoProductMap`, never-overwrite) backfills the new source from the
  old before the old one goes dormant, so existing dealers don't all start blocking.
- **Never clear a sheet before the pipeline that refills it has finished.** The old
  `importScraperData` cleared SCRAPERDATA first, then normalized/wrote — any throw
  mid-pipeline left the sheet empty. Destructive writes belong at the END, after all
  computation succeeds (the two-phase import keeps every mutation below the
  conflict gate for the same reason).
- **CSV uploads from the wild need a BOM strip and a mid-file header guard.** A
  UTF-8 BOM makes the first header read as `\uFEFF` +"VIN" and silently fail
  exact-match mapping; concatenated exports hide header rows mid-data (caught by
  VIN cell == literal "vin"). Strip `^\uFEFF` per file before parsing.
- **Pipedrive products are a GLOBAL catalog with NO native product\u2194organization
  link.** Products aren't owned by an org, so there's no API field to filter
  "products for org X". To scope a product list to an org, add a product **custom
  field** of type *Organization* (it stores the org id) and filter on it yourself \u2014
  and the catalog read **must include that custom field**: v1 `/products` returns
  custom fields **inline at the product top level** (`product[<40-char key>]`), but
  v2 omits them unless you ask (`/api/v2/products?custom_fields=<key>`, value at
  `custom_fields[key]`). Normalize the value defensively \u2014 an Organization field can
  come back as a scalar id or as `{value}`/`{id}`.
- **Persist every external-API reference by ID/stable key, never by name \u2014 and keep
  a UI control that preserves an already-saved id.** All Pipedrive mappings key on
  ids/40-char field keys/option ids (not display names), so renaming a product, org,
  field, or option in Pipedrive never breaks a saved mapping \u2014 and the supported
  product-revision workflow (edit the **original** to keep its id, deactivate the
  duplicate) is safe by construction. The matching UI rule: a dropdown that filters or
  hides options (e.g. org-scoping/deactivation) must **always keep the already-saved
  value selected** (render it as "\u2026 (saved)" if it's filtered out), or a save will
  silently drop a mapping the user never intended to change.
- **A SINGLE-SOURCE-OF-TRUTH list with a guaranteed floor: union the protected defaults
  FIRST, so a malformed stored value can only ADD, never drop/reorder them.** The vehicle
  type was a hardcoded four in ~14 places; making it user-extensible meant a stored list
  could be missing, partial, or garbage \u2014 and the billing/normalization code assumes the
  four built-ins exist. `getCanonicalVehicleTypes_()` returns the de-duped union of
  `CANONICAL_TYPES` (always first, in order) **+** the stored extras, so the built-ins are
  present no matter what the stored value is, and a stored value can only *append* a type \u2014
  never delete or reorder a protected one. That fail-safe is also what makes the whole
  feature **inert until used**: with no `vehicle_types` row the union is exactly the
  canonical four, so behavior is byte-identical to before. Same shape as the "config is
  required, gate it loudly" lesson inverted:
  here the safe default is a *guaranteed floor*, not a loud failure, because a missing
  type list must degrade to the old behavior, not block.
- **Per-type (or per-anything-unbounded) analytics belong in LONG-FORMAT rows, not WIDE
  per-type columns \u2014 and only a regenerated-each-time view can safely go fully dynamic.**
  Once vehicle types became user-extensible, the instinct is to add a column per type to
  the existing stats tabs \u2014 but RUN_LOG / ORDER_STATS / IMPORT_STATS have **fixed,
  documented, code-read schemas** (the RUN_LOG 19\u219223 widening already taught how that
  silently breaks readers), and a wide table can't grow with an unbounded set anyway. So
  per-type history went into a **new long-format `ORDER_TYPE_STATS` tab** (one row per
  `(run, type)` \u2014 `\u2026|type|produced|dupes`), which scales to any type and ports 1:1 to a
  Postgres table; the fixed tabs kept their canonical-four columns (a new type folds into
  "Other"/existing totals there). The DASHBOARD, by contrast, **could** go fully dynamic
  (a column per registered type + a RUNS-BY-TYPE section) precisely because it is
  **rewritten from scratch every import \u2014 no readers, no history, no schema contract**.
  The rule: an append-only log table with code/formula readers can't change shape lightly;
  a throwaway rendered view can. (When a dashboard formula's criterion is a user-entered
  label, reference the cell holding it \u2014 `COUNTIF(\u2026,A7)` not `COUNTIF(\u2026,"CPO-EL")` \u2014 so a
  quote/comma in the label can't break the formula.)
- **Generic substring-safety = sort LONGEST-MATCH-FIRST, not a hardcoded order array.**
  `matchRule_` is `indexOf`-based, so `"CPO"` \u2282 `"CPO-EL"` and a `CPO` rule placed first
  shadows every CPO-EL vehicle (the recurring CPO/CPO-EL trap). The fixed
  `['CPO-EL','CPO','New','PO']` order in `buildTypeRulesFromProductMap_` encoded that by
  hand \u2014 fine for exactly four known types, useless the moment types are user-added. Sorting
  the mapped types **by length descending** (stable tie-break) is the *generic* form: it
  yields the same order for the canonical four AND orders any new type safely, with no list
  to maintain. Whenever a hardcoded ordering array exists only to keep a longer string
  ahead of a substring of it, a longest-first sort is the drop-in that survives new values.
  (Generalizes the existing "synthesize the pipeline's input shape" + CPO-EL-before-CPO
  lessons; same trap as the type-rule formulas and the billing-PDF section parser.)
- **A remove/delete guard must enumerate EVERY place the thing can be referenced \u2014 list
  them exhaustively, because the easy-to-forget sites are exactly the live ones.** A
  vehicle type can be referenced in **7** spots: `filtering_rules`
  (`allowed_types`, `cao_exclude_types`, `seasoning[].type`, `billing_split(field:"type")`,
  and `targeting_rules` `{field:"type"}` conditions \u2014 **incl. nested AND/OR groups**) plus a
  PIPEDRIVE row's `product_map` + `source_product_map` keys. The first cut of
  `dealersUsingType_` checked only the obvious three (`allowed_types`/`cao_exclude_types`/
  `seasoning`) and **missed `targeting_rules` and `billing_split`** \u2014 and those are the ones
  live dealers (Bommarito / Pundmann / Dave Sinclair St. Peters) actually use, so an in-use
  type could have been deleted, leaving a dangling `{field:"type"}` condition. A config
  review caught it. When you write a usage/remove guard, **list every config site the value
  can live in** (grep the schema), and recurse nested structures \u2014 a guard that scans 5 of
  7 places is a guard that fails on the 2 that matter. Mirror of the inert-config-key
  landmine lesson: there it was an *unread* key, here it's an *unscanned* reference.
- **A filtered re-render preserves hidden entries for FREE when serialization reads the
  MODEL, not the DOM.** The Pipedrive product picker filters its rows to the dealer's
  Allowed Types (`pdEffectiveTypes()`), so a type that's currently excluded isn't rendered \u2014
  but its product mapping must not be lost on save. It isn't, with zero extra bookkeeping,
  because `buildProductMap_` serializes the in-memory model (`pdSelections[group].productMap`)
  rather than scraping the rendered `<tr>`s; filtering only changes what
  `pdRenderProductRows_` draws, never the source of truth that gets saved. The general rule:
  if a UI hides/filters editable items, **persist from the model, not the DOM**, and a
  hidden item round-trips untouched \u2014 same end as the "always keep the already-saved value
  selected" backstop, but achieved by where you read on save instead of a special case.
- **Making a hardcoded set dynamic has a blast radius beyond the code — audit
  TEMPLATE / SHEET formulas too.** The type registry made types dynamic in `Code.gs`, but the
  printed field codes `TYPESTOCK` / `TYPEVIN` are **ARRAYFORMULAs baked into the template**
  (SF_UNIVERSAL_TEMPLATE ORDERMATCH N2/R2), not script-written — a hardcoded
  `IF(SEARCH("CPO-EL"…),…,"USED - ")` cascade that defaulted **every** unrecognized type to
  "USED", so a new custom type printed as USED even though the code handled it everywhere else.
  The fix lived in the sheet, not the repo: exact match (`UPPER(TRIM(G))="…"`) with an else of
  `UPPER(TRIM(G))&" - "` (canonical `New`/`PO`→USED/`CPO`/`CPO-EL` unchanged; a custom type
  prints its own name). Two bugs in one — the hardcoded set **and** substring `SEARCH`, which is
  unsafe for arbitrary names ("Deposit" contains "po", "Renewal" contains "new"); exact match
  kills both (same CPO/CPO-EL substring-trap family). So: grep the **template / spreadsheet
  formulas** for the old hardcoded values, and prefer exact-match over substring once the
  matched set is user-extensible. *(Sheets MCP: `update_cells` rejects a leading `=`;
  `batch_update_cells` writes real formulas — probe a scratch cell to confirm, then clean it up.)*
