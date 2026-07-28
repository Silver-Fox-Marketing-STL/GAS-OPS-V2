---
paths:
  - "**/*.html"
---

# SPA / HtmlService — view invariants & traps

Loads only when working with `*.html` fragments. Mechanism/history in the Bridge
doc; full incident record in `docs/LEARNINGS.md`.

## App invariants

- `.view[hidden]{display:none !important}`; hidden views keep DOM + JS state;
  imports and runs are mutually exclusive via `AppBusy`; `ui.alert` fails via
  `google.script.run` — use the `*Core_`/`app*` split (server fn returns the
  message, client renders it).
- New view UI uses the canonical SharedUtils classes (`.btn-*`, `.pill`, `.tag`,
  `.table-u`) — never re-declare a per-view button/pill/tag/table dialect; class
  renames must keep the App.html Encarta/Luna override selectors matching.

## Recurring traps

- Every view root must declare `background: var(--bg); color: var(--text)` —
  SharedUtils pins `.view` to a HARDCODED WHITE readability guard that only an
  ID-scoped root rule overrides; omit the background and the view paints white
  in dark themes while its tokened content goes dark (EOM view, July 2026).
- All view fragments parse into ONE shared global JS scope — prefix per-view
  helpers (`ps*`/`tr*`/`pd*`); a duplicate top-level function silently clobbers.
- Include `SharedUtils` BEFORE views; element queries view-scoped
  (`view.querySelector`); `addEventListener`, never `window.onresize =`.
- `lot-scan/SharedUtils.html` is an OLD divergent copy (pre-unified-component-layer — no
  `.tag`/`.tone-*`); a class emitted in lot-scan HTML must exist in lot-scan's OWN files,
  not just the main app's.
- Never interpolate a dynamic string into an inline `onclick` — pass an integer
  index into a JS-side array (an apostrophe in the value kills the row silently).
- CSS Grid blockifies children and defaults to `stretch` — restore each child's
  pre-grid sizing (`justify-self:start` for content-width items). A portable
  injected widget defends its own box model with `!important` (view `* {padding:0}`
  resets outrank its class rules).
- iOS: re-parenting a `<select>` fires a spurious `change` (detach the inline
  `onchange` during DOM moves); pin `text-size-adjust:100%` on `:root` or identical
  px text renders at different sizes; no mobile console → toast the COMPUTED style
  on-device before theorizing. Decode big photos serially; parallelize only uploads.
