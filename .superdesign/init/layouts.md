# Layouts — SilverFox V2

This is a Google Apps Script HtmlService **single-page app**: there is exactly ONE shell
(`App.html`). All 13 views are stitched into `#appContent` server-side via
`<?!= include_('ViewXxx') ?>` scriptlets and switched client-side by `navTo(viewId)`
(show/hide, no reload). A legacy `Classic.html` wrapper serves any single view fragment as a
standalone modal dialog.

Shell anatomy (`App.html`):
- `#appRoot` — flex row (direction/axis re-composed per `data-shell`)
  - `nav#sidebar` — brand + nav items + collapsible "System Settings" group + theme picker + footer
  - `#appMain` — `#appHeader` (title + right meta) over `#appContent` (all `.view` fragments)
  - `#startBar` — bottom taskbar, rendered only under `data-shell="start-menu"` (and on mobile)

Structural axes (attributes on `<html>`, set pre-paint):
- `data-shell`: default sidebar | `right-rail` | `top-rail` | `bottom-rail` | `start-menu`
- `data-nav="icons"`: VS Code-style collapsed icon rail, expands on hover
- `data-viewport="mobile"` (≤760px): forces start-menu shell, single-column view stacking
- `data-arrange="desktop"`: Home cards become desktop icons (luna)
- Width-gated measure: `.view[data-layout="form|form-wide|data"] > .app-measure` caps content
  at 880/1280/1680px and centers it at ≥1500px viewports.

## App.html — full source (the app shell)

```html
<!DOCTYPE html>
<html data-theme="<?= initialTheme ?>" data-mode="<?= appMode ?>">
<head>
  <base target="_top">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Pixelify+Sans:wght@400..700&family=Poppins:wght@700;800&display=swap" rel="stylesheet">
  <script>
    // Theme bootstrap — runs before first paint to avoid a flash. Keep any saved
    // preference the server injected (any theme id); only follow the OS when none.
    (function() {
      var root = document.documentElement;
      if (!root.getAttribute('data-theme')) {
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      }
      // Mobile = narrow viewport. Set pre-paint so the responsive (start-menu) nav
      // paints on the first frame; a matchMedia listener in SharedUtils keeps it live.
      if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
        root.setAttribute('data-viewport', 'mobile');
      }
    })();
    // Per-user UI prefs (nav layout / autohide) from the server — read pre-paint
    // by SharedUtils' UiPrefs so the chosen nav layout paints on the first frame.
    window.UI_PREFS = { navLayout: '<?= initialNavLayout ?>', autohide: <?= initialAutohide ?> };
  </script>
  <style>
    /* ── App shell ─────────────────────────────────────────────────────────── */
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      font-family: var(--font-body);
      font-size: var(--fs-body);
      color: var(--text);
      background: var(--bg);
      overflow: hidden;
    }

    #appRoot { display: flex; height: 100vh; }

    /* ── Sidebar ───────────────────────────────────────────────────────────── */
    #sidebar {
      width: var(--shell-sidebar-w);
      flex-shrink: 0;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding-top: 6px;
    }
    .app-brand {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 14px 16px 15px;
      font-family: var(--font-head);
      font-size: var(--brand-fs);
      font-weight: 800;
      letter-spacing: -.01em;
      color: var(--text);
      border-bottom: 1px solid var(--border);
      margin-bottom: 6px;
      cursor: pointer;
      user-select: none;
    }
    .app-brand .logo {
      display: inline-block;
      width: 54px;
      height: 22px;
      flex-shrink: 0;
      background-color: #4a4a4d;   /* neutral silver fox; lightens in dark mode below */
      -webkit-mask: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABBCAYAAABW168KAAANQklEQVR4nO1dC4xcZRX+Zma7fVB2t+URSqnb0mrEqqjVUmPFWEQUtSjYEsW3giQajVi1AcQoEIkQsEaDbxBsohVRRBARX6DBV7WiRYmlFSu2WrAP+9ruzlxzku8jh5s7M3dm7n93Znu/ZLKzs3fn/vec757/vP7/AvmhD8BqAEvdZ2UApRzHUODJKFEHwlLqyHSVC/pyusgIwAwAJwN4AYAXA7gFwN94TJnH2KtAPjqxV40yfyqA1wN4PoBD1NUOp7sJQcC5AKYA2AvgFADPA/BzAN8GsM0R0YRSIBwkY9PJLADnAHgJgEkA/gdgOnU1oQhomA+gwvd7+fnpJOMPAXwPwB7+vSBi9pBM7TUAYDmAM/je9DHC4yrU1W/zcI/yIKAsml1UNeZ37OEYVgI4FcBtAO4GMBqbJgq0D7k3NVq5lwM4C8BxAPZRBxUna9PRifzfWq8TUCZ8MoATHLGECv++G8AggHcDOA3ArQB+wb8V/mF7iN/ASzndmiE4QJlX3Kyk/zEdzaHORkJPw3kR8HgAMxMIKJgQxiiUpwBYxen5WwD+zGMKIrYXYDwTwAoGgJJxOUY8/7+j1JXpbMtEIKBhHgMQmft6x1Z41x0E8CwACwHcz4j5ER5XEDEd8YYZ2b6QMpPfXU/+Qo26mucIGAx55XvM7LcqyP38aSmbRQB+DOC7AB7ncUWgkhzZHgXgtXRlptHPkyvTqs5+gsAITUD5H/No/lu5mySwvXxvjvOLANwB4E76MTrucA1Uyi6ynQrgTACvAnA05SbZtSL3EnVlOkNo2YYkoHyHQeab6vl/aYm4m3f0WwG8lIHKTymgwy1iLrvI1q57GYDX0X/e7wKMVq2e9wNnUXe7Q/qBeRBwDnNNBzv0JypMEZhAjgXwfqYULFBZn0HE3GxsrY692RiiFr8PCTfaIgYYJ9F3bhRgtHKOKnU2p9cJKF9iEu/MSgbfWeEdOsIS0iVMmsZLe/FxCFGTn/UQKhIs1fmZdF5fOlvB0lnE4K5T4nkoZzifWYhggUhIAkpw891UkRVERPmBiwE8h6U9m5q3t/h9yof1JbyXYpWsVSI9iSgiSEQrUnXJ3TH3mX8fuf9vBksen83SWT8DDI0/S8jKKnjsyTRMjd8/3IH/1wyydPv4/gymHb7PO/cI1jb1cxqd9alMNUzmaxJfnoAinydcPWuVZE09IUVCT8BRZ8mVejrA134XROzjy/J5r+bUqM/a8fFa8QOHKRMbb08RUD6D+WrHBCSg4Et7RqQ3UNHlBGslcsQtlvcdk96ntVT+XCJvhRbLE7eUYFE9yXUuRbkVklS51FDk0/hGGU2bDv8Vyg8MTcBhWh2lA0JDgYqSrkkBSfxGqHdjtPp5Pej89SL0qMnvImWUMpGcFWqcNYZ7lYCGBS4yzQtJU2U3oFNCl5AvlFVYwGpUkPOHskq6W9tJQBfoDviEdLA0TAgCVpzPMicH/69AGPjOGK/TriWgnOkq65EfZCa9sIC9bQEHqcuZLrDLzKBk9UW+Hmv12rczgrJUQWH9ehsR01iPAbgBwC+zrMF3Sg5fGjoSwNvYhTHCxS15RWwFwqLKNNJkdiXdyPUjHbfGdULAcqwm+U4AszmweD6rQO8j4ssMzaMAvsIafEfWsNRhvs2qCW9iG9AYLV9h9SY2qrSEfWyL+zoT5OJEUAJ6plu38vlcwGLZ+cLqHX7WcADAZgBfArCxHWvYCgHFcGP+uey6LbF2WVi9wxNV1tUjdqt/kzNhamuYhoC+4L6AVu8k+nrttHoXmFiokSPmG/6F1nBTQqNGWwQUk0vsuF2ZYW9fgYmFKuv+lrxeB+A7JF9Da9isPqmO5vPZb7eXjC+sXoEkiBvWxLCB1nBrI2uYREDvRL4SwHludVVh9QqkQZXJa5sp1wL4Qb0ApVQnqWw9YO8CsITEUwmmQIG0UO3YiPgrAF8G8J948rqUwExbcfYWbtGlbHeRVC7QDtRQawHKTgA3cSXjE5xTA4EdNATgHVxvcIDOZB5Tbrzj2CPeQVwgPZp1cSd1YIdClcHrVK7b+SqAXcY9ndw2jbyAU29epTRZXK3JKMd6CfVe6yfG3N8KdyAZNSejPrfOxcuz5I7VmhTkIFNfyrOp+Iu2mrHECPcsEk9JxNCoMbAB64oPs+17tyt8D3A9ySyuBhuiMCW0zFuDenyaq7ibeYwWZjs3/9zBapUaRAa5+dB81u/BgCGPG1vFDCPibfbmPgBP40sbRIaC7kAL0//gVq/pLqyHIa5NWMjVYXMpxFHWIQ/HhHiNspxC0lmK7CHKcyM3czISNsJkt9ruuSSht5KhMI1J6/tK7oP3sZdPK+GzHoQurJ/OqO2IKtSzZLq745jDRdlLeBf30W8dm+BWMXLLXafyeh9mlPk75tziSCvb5Qw+DwUioabgQfYUfsYI74MQw5u5pdf+AKkXTbuf5a5L+u40hWvvMPusuv3+DO6NspjTdp4BVJ6oOkfeZqrfUI4PxoIMbfqZtk/P68Hk+N4A07FchGncweJmnTtpgfUy7lRayrC9SnuN3M58UKeLnX37v3Ac94pZxhRSiJtoPFBzyttJ0t0d2/1BazY6WTgknVj+9zVN9nJsp33LxvYFjv8JvsXNrOp21mxwkdvmq5OBRLw4u6APuO0kslplFbekR9OnOZ1JUK0R7rVpOeJrOmX2I/rM1hqPFmeQNJB8TGbX0WB0up6nyvHbmK+l3/ek2nDSl+uAY0jChW67r3YHMchWnbXtNi6mgK/kgHtSn0u/ttZjbWNVTrVl+ksmu3/msEOsdHMeZZeF3jeSfDuSdF+P3fILLWC4EMDLmKZp9D/1ENF3We22fA25j1+ciIvo257YAy1kNdfatJm+0vociIfYOUxWn2xzSa3GZ9dwD4DPM7BJbFRt9OV+MfI5vCsOuUgz7WD6mYu6KOQmN02IOIWtZMs5JrWQdxOqHGeJGYJ1HOd47IndR6s1izpPS0JF6P2c7ewhRGi0sL3R1hwKxUv8IksUv4dCSjudyfptdcTNaxdTKa1MRd7E3OMF3ElUe+qNt28YuYfH/IMVgj+N4/bDZepqK+WkRzWkdRtM1mu4nUfTm6fcQpbdvvCjjL6OTOnHiQCK2ErjOK1VqNjVjMQGcnAH0o5tgGNazTH6B8fkDeno3y3s61MlJ7aTI/enjczTTqVVfqH5cBcD+D2rE36DxUZolpEPDW0YWWZEuYYpAU0XIYKiZqjy3H0cyxq3519auYaEpXzSynWInLiYHEkdaLbijEuBNnVdQT9lMMWdGrmdTMcbsjhlLin8OK/niJxJqIbNPRzDnc4d6JaN1g80uQkky0E+Yu0K59aklmWr0aBOGrHd+nq3u2ijk46HhUnjVmzkXbuJ02Ae41RSfhPPvTGjRHLWaKZP6f16Fheidm6gcofOvbVaX8mqQyMr0m0Rp7fo1hp0GeupcitCnnOI57rMdQh30w3aTGe+3f5KcqDtSL2TfJisyAbuVL+ljhVRx0Y3L6KxyO0qAHcFJKHIdxfPdbDLH7KjlFCS9d5CnW9w1rstlDOyIpaiuZRPuBxKmE5s0N0Kv4P/57jL/mDGxKjxO2/lOdBl/l4SBhLcliHq+FLqvGPr3ZehFTGn9WoObAV/VzQ3w11IN8J3Wt/ACsBK51R3AuX41nEflW5/2GLEnzNi7pbl+L7BBDOyst5Z7RHtH5e1ll3OF7IL4hBb/dHFQvdjK5MoUUb10CGnuG4nH9zYjqXu1MnyaQA/iz0mrKs2KZdgKxzoNna/zKYS+l1Zp1sVoHFVSJg+9kfuaoOEIt8trgmj2yLdOKSbfo59Co3Jdey2zryRJERRXknrh+ioPsCNrm2L16ygykaIyorubpPN1/h0zlYDE5HvDn6Hf5xq1igFkMVM6uwB6jAI+UKXxiT0PjYirOfumllHfqEsi29m+BCfW5xmOlYb0r0Argk47ZYCpHCkm9PYRXRt6Bp+6Nqsn26Pz+CBJ/rf2RTQva7Mp1b0WgD5WML1Y2z/b9SgqwbMB1nhsGAGGZOvHFuaYJb2VN7gj2YkX+nKfxYEeawFlRJ1QVEG4/0IO3Tu4RRxgnswYJaPsdL4zXf9FP3aqXVIrodGb+OxWfu7ZWftq7zmSygDk8WH3XHtQmPNhXzIqTEzCmBtR2n5zFdZRSVczhVyImJWkD+4m8QaoVsRJSw7GOExem5v1uOo8hov5zWvogx2ZdxrmWpvvyxP1CuQUk9mRWGUU+IU5toeY2F/HVeNZel7yQlfwrYp//w7PVftKpbZsnTYS3wtZm7yTK572cNqynS6CK8A8Mcur65MCEjpZ7NtfRfXG2xnC9EYE+Ihnigp3++NXOF3M1+38zN/DDKeeq/mte3kte7gtW+mLHRsT6HXLKCgu3wu83RPp5IeYXH814HOK2sUsZng2fzc0hWfcH8LNXWdwj0bh2lh/8o8498Ly5c/yuN0Y+m7j+IDW250Oc48zpuEnrN8eTwxPTQUHPi2cVmgkO1Nqo0+zpKd4b85WKDIJZz99eqB1j2J/wMRT+/OjFErJQAAAABJRU5ErkJggg==") center / contain no-repeat;
              mask: url("data:image/png;base64,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") center / contain no-repeat;
    }
    :root[data-theme="dark"] .app-brand .logo,
    :root[data-theme="midnight"] .app-brand .logo,
    :root[data-theme="top-rail-dark"] .app-brand .logo,
    :root[data-theme="encarta"] .app-brand .logo,
    :root[data-theme="gruvbox-rail"] .app-brand .logo,
    :root[data-theme="luna"] .app-brand .logo { background-color: #d2d2d6; }   /* light logo on the navy/blue title strip */

    /* Theme picker (sidebar) — a CUSTOM dropdown, NOT a native <select>. The
       native open option list is OS-rendered, and the Apps Script web-app
       sandbox iframe doesn't propagate color-scheme to it — so a native <select>
       rendered light-on-light in dark themes IN THE WEB APP (it worked in the
       modal, where the scheme is honored, but not the full-page web app). A
       button + a themed <ul> renders identically and readably in the modal AND
       the web app, in every theme. (The color-scheme tokens still help other
       native controls — scrollbars, checkboxes — render dark in dark themes.) */
    .nav-theme { position: relative; }
    .theme-btn {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 6px;
      background: var(--surface); color: var(--text-2);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      font-family: var(--font-body); font-size: 12.5px; font-weight: 600;
      padding: 4px 8px; cursor: pointer; text-align: left;
    }
    .theme-btn:hover { color: var(--text); border-color: var(--border-2); }
    .theme-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    #themeBtnLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .theme-caret { font-size: 9px; color: var(--text-3); flex-shrink: 0; }

    .theme-menu {
      position: absolute; z-index: 60; left: 0; right: 0;
      bottom: calc(100% + 4px);            /* opens UPWARD — the picker sits near the sidebar bottom */
      margin: 0; padding: 4px; list-style: none;
      background: var(--surface); border: 1px solid var(--border-2);
      border-radius: var(--radius); box-shadow: var(--shadow-lg);
      max-height: 60vh; overflow-y: auto;
    }
    .theme-menu[hidden] { display: none; }
    .theme-menu li {
      padding: 6px 9px; border-radius: var(--radius-sm); cursor: pointer;
      font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap;
    }
    .theme-menu li:hover,
    .theme-menu li:focus { outline: none; background: var(--accent-weak); }
    .theme-menu li[aria-selected="true"] { background: var(--accent); color: var(--on-accent); }
    /* Top Rail layouts put the picker in a horizontal TOP bar — open DOWNWARD. */
    :root[data-shell="top-rail"] .theme-menu { bottom: auto; top: calc(100% + 4px); }

    /* ── Right-rail layout (data-shell="right-rail") ───────────────────────────
       STRUCTURAL axis: the sidebar moves to a right-hand rail. Reusable by ANY
       palette (Dark — Dense composes it via shell:'right-rail' in its metadata).
       Pure CSS; markup + nav onclick wiring (and thus the backend calls) untouched.
       The active-nav accent flips to the rail's inner (right) edge so the
       selection cue keeps pointing at the content it selects. */
    :root[data-shell="right-rail"] #appRoot { flex-direction: row-reverse; }
    :root[data-shell="right-rail"] #sidebar { width: 188px; border-right: none; border-left: 1px solid var(--border); }
    :root[data-shell="right-rail"] .nav-item,
    :root[data-shell="right-rail"] .nav-group-header { border-left-width: 0; border-right: 3px solid transparent; }
    :root[data-shell="right-rail"] .nav-item.active { border-right-color: var(--accent); }

    /* ── Top-rail layout (data-shell="top-rail") ───────────────────────────────
       STRUCTURAL axis: the side rail becomes a horizontal TOP bar. Keyed on
       data-shell, so ANY palette composes it by declaring shell:'top-rail' in its
       Theme.themes metadata — e.g. "Top Rail" (light), "Top Rail — Dark" (Dark
       palette), and "Gruvbox Rail" all share these rules with no duplication.
       Pure CSS; markup + nav onclick wiring (and thus the backend calls) untouched.
       The active marker moves from the left edge to a bottom underline (tab
       metaphor), and the System Settings group becomes a hover flyout since it
       can't stack inline. */
    :root[data-shell="top-rail"] #appRoot { flex-direction: column; }
    :root[data-shell="top-rail"] #sidebar {
      width: 100%; flex-direction: row; align-items: center; padding-top: 0;
      border-right: none; border-bottom: 1px solid var(--border);
    }
    /* Column layout needs min-height:0 on the main pane so #appContent can take
       the leftover height and scroll. Without it the pane grows to content height
       and body{overflow:hidden} clips it — the "can't scroll any page" bug. The
       base #appMain only sets min-width:0 (what the default ROW layout needs). */
    :root[data-shell="top-rail"] #appMain { min-height: 0; }
    :root[data-shell="top-rail"] .app-brand { border-bottom: none; border-right: 1px solid var(--border); margin-bottom: 0; }
    :root[data-shell="top-rail"] .nav-item,
    :root[data-shell="top-rail"] .nav-group-header { border-left-width: 0; border-bottom: 3px solid transparent; }
    :root[data-shell="top-rail"] .nav-item.active { border-bottom-color: var(--accent); }
    :root[data-shell="top-rail"] .nav-footer { display: none; }
    /* System Settings → flyout dropdown. Mouse: hover reveals. The :focus-within
       path is kept so the flyout becomes keyboard-reachable FOR FREE the moment
       the nav's div[onclick] items get tabindex — but that's a pre-existing,
       app-wide gap (every theme's nav is mouse-only today), NOT this theme's to
       fix. ponytail: hover/mouse flyout; keyboard nav-activation is app-wide debt.
       The data-theme attr out-specifies .nav-group.collapsed, so the JS collapse
       toggle is inert here — hover/focus drives visibility. */
    :root[data-shell="top-rail"] .nav-group { position: relative; }
    :root[data-shell="top-rail"] .nav-group-items {
      position: absolute; top: 100%; left: 0; min-width: 190px;
      background: var(--surface); border: 1px solid var(--border);
      box-shadow: var(--shadow-lg); z-index: 50; display: none;
    }
    :root[data-shell="top-rail"] .nav-group:hover .nav-group-items,
    :root[data-shell="top-rail"] .nav-group:focus-within .nav-group-items { display: block; }
    :root[data-shell="top-rail"] .nav-group-items .nav-sub { padding-left: 16px; }

    /* ── Nav axis (data-nav) — reusable nav rendering, composed via theme metadata.
       "icons": collapse the side rail to an icon strip that expands on hover/focus
       (VS Code style). Side/right-rail shells only — inert under top-rail (a top
       bar has no width to reclaim). Pure CSS; nav markup + onclick wiring untouched.
       ponytail: hover-expand, no titles/markup change; the collapsed brand logo is
       clipped by overflow (it expands on hover). Add a compact mark if a theme
       wants a polished collapsed brand. */
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar {
      width: 60px; overflow: hidden; transition: width .12s ease;
    }
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:hover,
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:focus-within { width: 210px; }
    /* collapsed (not hovered): font-size:0 collapses each row's text label; the
       .icon span restores its own size, so only the glyphs show. */
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:not(:hover):not(:focus-within) .nav-item,
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:not(:hover):not(:focus-within) .nav-group-header,
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:not(:hover):not(:focus-within) .app-brand { font-size: 0; gap: 0; }
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:not(:hover):not(:focus-within) .icon { font-size: 14px; }
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:not(:hover):not(:focus-within) .nav-group-caret,
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:not(:hover):not(:focus-within) .theme-caret,
    :root[data-nav="icons"]:not([data-shell="top-rail"]):not([data-shell="bottom-rail"]):not([data-shell="start-menu"]) #sidebar:not(:hover):not(:focus-within) #themeBtnLabel { display: none; }

    /* ── Bottom-rail layout (data-shell="bottom-rail") — horizontal nav at the
       BOTTOM. Mirrors top-rail; active marker is a TOP border and the Settings
       flyout / theme menu open UPWARD. Chosen via UI Settings (user pref). ── */
    :root[data-shell="bottom-rail"] #appRoot { flex-direction: column-reverse; }
    :root[data-shell="bottom-rail"] #sidebar {
      width: 100%; flex-direction: row; align-items: center; padding-top: 0;
      border-right: none; border-top: 1px solid var(--border);
    }
    :root[data-shell="bottom-rail"] #appMain { min-height: 0; }
    :root[data-shell="bottom-rail"] .app-brand { border-bottom: none; border-right: 1px solid var(--border); margin-bottom: 0; }
    :root[data-shell="bottom-rail"] .nav-item,
    :root[data-shell="bottom-rail"] .nav-group-header { border-left-width: 0; border-top: 3px solid transparent; }
    :root[data-shell="bottom-rail"] .nav-item.active { border-top-color: var(--accent); }
    :root[data-shell="bottom-rail"] .nav-footer { display: none; }
    :root[data-shell="bottom-rail"] .nav-group { position: relative; }
    :root[data-shell="bottom-rail"] .nav-group-items {
      position: absolute; bottom: 100%; top: auto; left: 0; min-width: 190px;
      background: var(--surface); border: 1px solid var(--border);
      box-shadow: var(--shadow-lg); z-index: 50; display: none;
    }
    :root[data-shell="bottom-rail"] .nav-group:hover .nav-group-items,
    :root[data-shell="bottom-rail"] .nav-group:focus-within .nav-group-items { display: block; }
    :root[data-shell="bottom-rail"] .nav-group-items .nav-sub { padding-left: 16px; }
    :root[data-shell="bottom-rail"] .theme-menu { bottom: calc(100% + 4px); top: auto; }

    /* ── Start-menu layout (data-shell="start-menu") — a bottom TASKBAR (#startBar)
       with a Start button; the sidebar becomes a pop-up "Start" panel toggled by
       toggleStartMenu() (sets data-start-open on <html>). #startBar is display:none
       in every other layout (true no-op). Chosen via UI Settings (user pref). ── */
    :root[data-shell="start-menu"] #appRoot { display: block; position: relative; }
    :root[data-shell="start-menu"] #appMain { height: calc(100vh - var(--taskbar-h, 40px)); }
    :root[data-shell="start-menu"] #startBar {
      display: flex; align-items: center; gap: var(--space-3);
      position: absolute; left: 0; right: 0; bottom: 0; height: var(--taskbar-h, 40px);
      box-sizing: border-box;   /* padding stays inside the bar width (no horizontal overflow) */
      background: var(--surface); border-top: 1px solid var(--border-2);
      /* Pull the Start button (left) + clock (right) inboard from the rounded screen
         corners — original bar height, no growth. Extra LEFT inset because the Start
         button sits deepest in the bottom-left corner curve; the clock (right) clears
         at 28px. (default viewport keeps the bar above the home indicator). */
      padding: 0 28px 0 48px;
      z-index: 150;
    }
    :root[data-shell="start-menu"] #sidebar {
      position: absolute; left: 6px; bottom: calc(var(--taskbar-h, 40px) + 6px);
      width: 240px; max-height: 72vh; overflow-y: auto;
      border: 1px solid var(--border-2); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg); z-index: 200; display: none;
    }
    :root[data-shell="start-menu"][data-start-open] #sidebar { display: flex; }
    :root[data-shell="start-menu"] #sidebar .nav-spacer { display: none; }   /* compact panel — don't push Close to the bottom */

    /* Start button + taskbar clock — hidden unless the start-menu layout is active. */
    #startBar { display: none; }
    .start-btn {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: var(--font-head); font-weight: 700; font-size: 13px;
      color: var(--on-accent); background: var(--accent);
      border: none; border-radius: var(--radius); padding: 6px 14px; cursor: pointer;
    }
    .start-btn:hover { background: var(--accent-hover); }
    .start-btn .start-logo { font-size: 14px; line-height: 1; }
    .start-clock { margin-left: auto; font-size: var(--fs-sm); color: var(--text-2); font-variant-numeric: tabular-nums; }
    /* Luna dresses the taskbar + Start button as Windows XP. */
    :root[data-theme="luna"] #startBar { background: linear-gradient(180deg,#2a8bf2 0%,#1860c8 50%,#0a52c0 100%); border-top: 1px solid #003bbf; }
    :root[data-theme="luna"] .start-btn { background: linear-gradient(180deg,#7bbf4a,#3c8d0d); color: #fff; border-radius: 0 12px 12px 0; font-style: italic; box-shadow: inset 0 1px 0 rgba(255,255,255,.4); }
    :root[data-theme="luna"] .start-clock { color: #fff; }

    /* ════════════════════════════════════════════════════════════════════════
       MOBILE (data-viewport="mobile") — auto by viewport width (<=760px), set in
       the head pre-paint + a matchMedia listener in SharedUtils. On mobile,
       UiPrefs.applyOverrides forces data-shell="start-menu", so EVERY theme gets
       the start-menu taskbar nav (this REUSES that layout's CSS as-is); below we
       widen the Start panel for touch, fix the height to dvh, stack the
       grid-skeleton views to one column, and trim padding. Theme palettes/tokens
       carry through automatically; per-theme mobile tweaks are scoped
       [data-viewport="mobile"][data-theme="x"]. Placed AFTER the start-menu block
       so these (equal-specificity) overrides win on source order. ── */
    :root[data-viewport="mobile"] #appMain { height: calc(100dvh - var(--taskbar-h, 40px)); }   /* dvh dodges the mobile address-bar jump; falls back to the start-menu 100vh rule */
    :root[data-viewport="mobile"] #sidebar { width: 84vw; max-width: 320px; }
    :root[data-viewport="mobile"] .nav-item,
    :root[data-viewport="mobile"] .nav-group-header { padding-top: 12px; padding-bottom: 12px; }   /* finger-sized targets */

    /* Grid-skeleton views collapse to a single column. */
    :root[data-viewport="mobile"] #view-run .rv-body { grid-template-columns: 1fr; grid-template-areas: "vin" "table" "rail"; }
    :root[data-viewport="mobile"] #view-vinlog .layout { grid-template-columns: 1fr; grid-template-areas: "main" "side"; }
    :root[data-viewport="mobile"] #view-vinlog .col-main { border-right: none; border-bottom: 1px solid var(--border); }
    :root[data-viewport="mobile"] #view-import .import-cols { grid-template-columns: 1fr; grid-template-areas: "left" "right"; }
    :root[data-viewport="mobile"] #view-home .home-cards { grid-template-columns: 1fr; }

    /* Trim oversized desktop padding; let wide tables scroll instead of overflowing the screen. */
    :root[data-viewport="mobile"] #view-run .rv-wrap,
    :root[data-viewport="mobile"] .uis-scroll,
    :root[data-viewport="mobile"] .home-scroll,
    :root[data-viewport="mobile"] .ds-scroll,
    :root[data-viewport="mobile"] .ps-scroll { padding: var(--space-3); }
    :root[data-viewport="mobile"] .table-wrap,
    :root[data-viewport="mobile"] .ds-table,
    :root[data-viewport="mobile"] .dash-table { overflow-x: auto; }

    /* Config views: collapse internal multi-column grids to one column so cards
       go full-width (labels stop clipping, pills wrap instead of overflowing).
       Dealer Rules — both the Filtering tab (.filter-grid 4-col, .filter-grid-2
       2-col) and the Pipedrive tab (.ps-thenelse 2-col, .pd-overrides-grid 3-col). */
    :root[data-viewport="mobile"] #view-rules .filter-grid,
    :root[data-viewport="mobile"] #view-rules .filter-grid-2,
    :root[data-viewport="mobile"] #view-rules .ps-thenelse,
    :root[data-viewport="mobile"] #view-rules .pd-overrides-grid { grid-template-columns: 1fr; }

    /* Per-theme mobile tweak: Luna sheds its desktop window chrome (full-bleed client). */
    :root[data-viewport="mobile"][data-theme="luna"] #appMain { margin: 0; border-radius: 0; border: none; }

    /* ── "Encarta" — Win95/98 window-frame reskin ────────────────────────────────
       Reframes the app as a Win95 application window over the existing markup:
       navy title-bar header, raised gray sidebar chrome, sunken white client
       area, 3D beveled controls, Explorer-style navy selection, chunky 3D
       scrollbars, dotted focus, and NO motion. Pure CSS; fully reversible.
       (Per-view "primary" buttons that hard-set their own background keep their
       colour — a theme can't out-specify an id-scoped rule — but go sharp +
       beveled like the rest; everything token-driven reskins automatically.)   */
    :root[data-theme="encarta"] #appRoot { background: #008080; }   /* classic teal "desktop" peeks at any seam */

    /* Title bar = the header: active-title navy→blue gradient, white bold caption */
    :root[data-theme="encarta"] #appHeader {
      background: linear-gradient(90deg, #000080 0%, #1084d0 100%);
      border-bottom: 2px solid #404040;
      box-shadow: inset 1px 1px #3a93e0;
    }
    :root[data-theme="encarta"] #appHeaderTitle { color: #ffffff; font-weight: 700; letter-spacing: .01em; }
    :root[data-theme="encarta"] #appHeaderRight { color: #d2e2f6; }

    /* Sidebar = raised window chrome; brand = a navy title strip + pixel wordmark */
    :root[data-theme="encarta"] #sidebar {
      border-right: 2px solid #404040;
      box-shadow: inset -1px 0 #808080, inset 1px 1px #ffffff;
    }
    :root[data-theme="encarta"] .app-brand {
      background: linear-gradient(90deg, #000080 0%, #1084d0 100%);
      color: #ffffff; border-bottom: 2px solid #404040; margin-bottom: 0;
      font-family: 'Pixelify Sans', Tahoma, sans-serif; font-weight: 700; letter-spacing: .02em;
    }

    /* Nav = Explorer list: flat rows, light hover, full navy selection bar */
    :root[data-theme="encarta"] .nav-item,
    :root[data-theme="encarta"] .nav-group-header { border-left: none; border-radius: 0; color: #000; }
    :root[data-theme="encarta"] .nav-item:hover { background: var(--accent-weak); color: #000; }
    :root[data-theme="encarta"] .nav-item.active,
    :root[data-theme="encarta"] .nav-item.active:hover { background: var(--accent); color: #fff; box-shadow: none; }
    :root[data-theme="encarta"] .nav-item.active .icon { color: #fff; }

    /* Client area = sunken white work zone */
    :root[data-theme="encarta"] #appContent {
      background: #ffffff;
      box-shadow: inset 1px 1px #404040, inset 2px 2px #808080;
    }

    /* Buttons = raised 3D; pressed = sunken (no scale); dotted focus rectangle */
    :root[data-theme="encarta"] button {
      border: 2px outset #dfdfdf; border-radius: 0; box-shadow: none;
      font-family: var(--font-body);
    }
    :root[data-theme="encarta"] button:active { border-style: inset; transform: none; }
    :root[data-theme="encarta"] button:focus-visible { outline: 1px dotted #000; outline-offset: -4px; box-shadow: none; }

    /* Fields = sunken inset, white, sharp (checkboxes/radios left native) */
    :root[data-theme="encarta"] input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
    :root[data-theme="encarta"] select,
    :root[data-theme="encarta"] textarea {
      background: #ffffff; color: #000; border: 2px inset #dfdfdf; border-radius: 0; box-shadow: none;
    }

    /* Footer = sunken status bar */
    :root[data-theme="encarta"] .nav-footer {
      background: var(--surface); color: #1d1d1d;
      box-shadow: inset 1px 1px #808080, inset -1px -1px #ffffff;
    }

    /* Chunky 3D scrollbars (webkit) */
    :root[data-theme="encarta"] ::-webkit-scrollbar { width: 17px; height: 17px; }
    :root[data-theme="encarta"] ::-webkit-scrollbar-track { background: #d8d4cc; }
    :root[data-theme="encarta"] ::-webkit-scrollbar-thumb { background: var(--surface); border: 2px outset #dfdfdf; }
    :root[data-theme="encarta"] ::-webkit-scrollbar-corner { background: #d8d4cc; }

    /* Retro = instant, no motion + SHARP corners everywhere (no rounded pills,
       cards, toggles, or dots — the whole point of the theme). */
    :root[data-theme="encarta"] * { border-radius: 0 !important; transition: none !important; animation: none !important; }

    /* ── Encarta component overrides — kill the pills & cards, add Win95 bevels ──
       These use !important on purpose: the targets are id-scoped per-view rules
       (#view-… .filter-card / .pill / .toggle-slider) that a theme can't out-rank
       otherwise — a theme is the legitimate top layer of intent here. */
    /* Cards / panels → raised gray 3D group-boxes (no soft shadow). */
    :root[data-theme="encarta"] .filter-card,
    :root[data-theme="encarta"] .home-card,
    :root[data-theme="encarta"] .ps-card,
    :root[data-theme="encarta"] .ps-group,
    :root[data-theme="encarta"] .ps-rule {
      background: var(--surface) !important;
      border: 2px outset #dfdfdf !important;
      box-shadow: none !important;
    }
    /* Home status strip → a sunken readout panel (not a pill). */
    :root[data-theme="encarta"] .home-status {
      background: var(--surface) !important; border: 2px inset #dfdfdf !important; box-shadow: none !important;
    }
    /* Pills → flat beveled toggle-tags: raised when off, pressed-IN when active.
       Per-type colour coding is preserved — only the shape + bevel change. */
    :root[data-theme="encarta"] .pill { border: 2px outset #dfdfdf !important; }
    :root[data-theme="encarta"] .pill.active { border-style: inset !important; }
    /* Every button gets the 3D bevel regardless of per-view styling. */
    :root[data-theme="encarta"] button { border: 2px outset #dfdfdf !important; box-shadow: none !important; }
    :root[data-theme="encarta"] button:active { border-style: inset !important; transform: none !important; }
    /* Toggle switches → squared, beveled Win95 sliders. */
    :root[data-theme="encarta"] .toggle-slider { border: 2px inset #dfdfdf !important; }
    :root[data-theme="encarta"] .toggle-slider:before { border: 2px outset #dfdfdf !important; background: var(--surface) !important; }
    /* Encarta — Run Order table + rail as Win95 panels */
    :root[data-theme="encarta"] #view-run .rv-table-scroll { border: 2px inset #dfdfdf !important; }
    :root[data-theme="encarta"] #view-run #vinDataTable th { background: var(--surface) !important; }
    :root[data-theme="encarta"] #view-run .rv-rail { border-left: 2px inset #dfdfdf !important; }

    /* ── "Windows XP" (Luna) — window-frame reskin over the existing shell. ── */
    :root[data-theme="luna"] #appRoot { background: linear-gradient(180deg,#5a7edc,#4a6fc8); }
    :root[data-theme="luna"] #appMain { margin: 6px 6px 0; border-radius: 8px 8px 0 0; overflow: hidden; border: 1px solid #0831d9; }
    :root[data-theme="luna"] #appHeader { background: linear-gradient(180deg,#0058ee 0%,#2a8bf2 9%,#1d6fd6 45%,#0054e3 90%,#003bbf 100%); border-bottom: 1px solid #003bbf; }
    :root[data-theme="luna"] #appHeaderTitle { color: #fff; font-weight: 700; text-shadow: 1px 1px 1px rgba(0,0,0,.4); }
    :root[data-theme="luna"] #appHeaderRight { color: #dce8ff; }
    :root[data-theme="luna"] #sidebar { background: linear-gradient(180deg,#f0f4fb,#d6e2f5); border-right: 1px solid #7f9db9; }
    :root[data-theme="luna"] .app-brand { background: linear-gradient(180deg,#0058ee,#0054e3); color: #fff; border-bottom: 1px solid #003bbf; }
    :root[data-theme="luna"] .nav-item.active { background: var(--accent); color: #fff; border-left-color: #002d8a; }
    :root[data-theme="luna"] .nav-item.active .icon { color: #fff; }
    :root[data-theme="luna"] .nav-footer { background: linear-gradient(180deg,#57a818,#3c8d0d); color: #fff; border-top: 1px solid #2a6a08; }
    :root[data-theme="luna"] button { background: linear-gradient(180deg,#fdfdfd,#e8e8d8); border: 1px solid #8a8a7a; border-radius: 3px; box-shadow: none; }
    :root[data-theme="luna"] button:hover { border-color: var(--accent-hover); }
    :root[data-theme="luna"] input:not([type=checkbox]):not([type=radio]):not([type=range]),
    :root[data-theme="luna"] select, :root[data-theme="luna"] textarea { background: #fff; border: 1px solid #7f9db9; border-radius: 2px; box-shadow: none; }

    /* data-arrange="desktop" — Home cards become a grid of captioned desktop icons.
       Theme-agnostic LAYOUT on the axis; any future "desktop" theme reuses it. */
    :root[data-arrange="desktop"] #view-home .home-cards { grid-template-columns: repeat(auto-fill, 96px); gap: 18px; padding: 14px; }
    :root[data-arrange="desktop"] #view-home .home-card { background: transparent; border: none; box-shadow: none; text-align: center; padding: 6px 2px; }
    :root[data-arrange="desktop"] #view-home .home-card .card-icon { font-size: 40px; margin-bottom: 4px; }
    :root[data-arrange="desktop"] #view-home .home-card .card-desc { display: none; }
    :root[data-arrange="desktop"] #view-home .home-section-label { display: none; }
    /* Luna pairs the desktop with a blue background + light captions. */
    :root[data-theme="luna"] #view-home, :root[data-theme="luna"] #appContent { background: linear-gradient(180deg,#5a7edc,#4a6fc8); }
    :root[data-theme="luna"] #view-home .home-card .card-title { color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,.6); }
    /* Luna moves the Run rail to the left as an Explorer task pane (uses the grid skeleton below). */
    :root[data-theme="luna"] #view-run .rv-body { grid-template-columns: var(--rv-rail-w) 1fr var(--rv-vin-w); grid-template-areas: "rail table vin"; }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 10px 16px;
      cursor: pointer;
      font-family: var(--font-body);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-2);
      border-left: 3px solid transparent;
      user-select: none;
    }
    .nav-item:hover { background: var(--accent-weak); color: var(--text); }
    .nav-item.active {
      background: var(--accent-weak-2);
      color: var(--accent);
      border-left-color: var(--accent);
    }
    .nav-item.pending { opacity: 0.38; cursor: default; }
    .nav-item.pending:hover { background: none; }
    .nav-item .icon { width: 20px; text-align: center; font-size: 14px; }
    .nav-spacer { flex: 1; }
    .nav-footer {
      padding: 10px 16px 14px;
      font-size: 10.5px;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
    }
    /* Collapsible "System Settings" group */
    .nav-group-header {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 10px 16px;
      cursor: pointer;
      user-select: none;
      font-family: var(--font-body);
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: .03em;
      text-transform: uppercase;
      color: var(--text-3);
      border-left: 3px solid transparent;
    }
    .nav-group-header:hover { background: var(--accent-weak); color: var(--text); }
    .nav-group-header .icon { width: 20px; text-align: center; font-size: 14px; }
    .nav-group-caret { margin-left: auto; font-size: 10px; transition: transform .15s; }
    .nav-group.collapsed .nav-group-caret { transform: rotate(-90deg); }
    .nav-group.collapsed .nav-group-items { display: none; }
    .nav-group-items .nav-sub { padding-left: 34px; font-size: 12.5px; }

    /* ── Main area ─────────────────────────────────────────────────────────── */
    #appMain { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    #appHeader {
      height: var(--shell-header-h);
      flex-shrink: 0;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 18px;
    }
    #appHeaderTitle {
      font-family: var(--font-head);
      font-size: var(--fs-h3);
      font-weight: 700;
      color: var(--text);
    }
    #appHeaderRight { margin-left: auto; font-size: 11px; color: var(--text-3); }
    #appContent { flex: 1; min-height: 0; position: relative; background: var(--bg); }

    /* ── Views ─────────────────────────────────────────────────────────────── */
    .view { height: 100%; }
    /* Author display rules on view roots (flex etc.) would defeat the UA's
       [hidden] rule — force it. */
    .view[hidden] { display: none !important; }

    /* ── Wide-screen responsive frame ───────────────────────────────────────
       Each view root declares a data-layout tier; its content wrapper(s) carry
       the .app-measure marker. At width the wrapper caps to a comfortable
       measure and centers, so extra space becomes calm gutters instead of the
       "modal, stretched" look:
         form       → 880px  (narrow single-column: Utilities)
         form-wide  → 1280px (split / dense config: Run, Rules, Import, Pipedrive,
                              Data Sources)
         data       → 1680px (tables: Home, VIN Logs, Normalization)
       Gated by viewport WIDTH, intentionally NOT by [data-mode]: the modal is
       locked at 1400 so it sits under the 1500px gate and is untouched, while
       the full-screen browser tab AND the installed standalone window (both
       webapp mode) get the treatment. Do not add a [data-mode] qualifier here.
       The selector requires [data-layout] (only ever on a view root) AND the
       .app-measure marker on a direct child, so it can't leak across the shared
       CSS scope. A flat multi-child view (Rules, Norm) tags each content row
       with .app-measure — same measure + auto margins keep them column-aligned. */
    @media (min-width: 1500px) {
      .view[data-layout="form"]      > .app-measure { max-width: var(--measure-form);      margin-inline: auto; }
      .view[data-layout="form-wide"] > .app-measure { max-width: var(--measure-form-wide); margin-inline: auto; }
      .view[data-layout="data"]      > .app-measure { max-width: var(--measure-data);      margin-inline: auto; }
    }
    @media (min-width: 2100px) {
      .view[data-layout] > .app-measure { padding-inline: var(--gutter-wide); }
    }
  </style>
</head>
<body>

  <!-- SharedUtils FIRST: view fragments register guards/inits at parse time -->
  <?!= include_('SharedUtils') ?>
  <!-- Shared EOM report renderer (also byte-copied into eom-viewer/). -->
  <?!= include_('EomReportRenderer') ?>

  <div id="appRoot">

    <nav id="sidebar">
      <div class="app-brand" onclick="navTo('view-home')">
        <span class="logo" role="img" aria-label="SilverFox logo"></span> SilverFox
      </div>
      <div class="nav-item" id="nav-view-home" onclick="navTo('view-home')">
        <span class="icon">&#8962;</span> Home
      </div>
      <div class="nav-item" id="nav-view-run" onclick="navTo('view-run')">
        <span class="icon">&#9654;</span> Run Order
      </div>
      <div class="nav-item" id="nav-view-import" onclick="navTo('view-import')">
        <span class="icon">&#11014;</span> Import Data
      </div>
      <div class="nav-item" id="nav-view-vinlog" onclick="navTo('view-vinlog')">
        <span class="icon">&#128203;</span> VIN Logs
      </div>
      <div class="nav-item" id="nav-view-vin-inbox" onclick="navTo('view-vin-inbox')">
        <span class="icon">&#128229;</span> VIN Inbox
      </div>
      <div class="nav-item" id="nav-view-end-of-month" onclick="navTo('view-end-of-month')">
        <span class="icon">&#128202;</span> End of Month
      </div>
      <div class="nav-item" id="nav-view-utilities" onclick="navTo('view-utilities')">
        <span class="icon">&#128295;</span> Utilities
      </div>
      <div class="nav-group collapsed" id="nav-group-settings">
        <div class="nav-group-header" onclick="toggleSettingsGroup()" title="Show / hide configuration screens">
          <span class="icon">&#9881;</span> System Settings <span class="nav-group-caret">&#9662;</span>
        </div>
        <div class="nav-group-items">
          <div class="nav-item nav-sub" id="nav-view-ui-settings" onclick="navTo('view-ui-settings')">
            <span class="icon">&#127899;</span> UI Settings
          </div>
          <div class="nav-item nav-sub" id="nav-view-rules" onclick="navTo('view-rules')">
            <span class="icon">&#9881;</span> Dealer Rules
          </div>
          <div class="nav-item nav-sub" id="nav-view-norm" onclick="navTo('view-norm')">
            <span class="icon">Aa</span> Normalization
          </div>
          <div class="nav-item nav-sub" id="nav-view-datasources" onclick="navTo('view-datasources')">
            <span class="icon">&#128452;</span> Data Sources
          </div>
          <div class="nav-item nav-sub" id="nav-view-pipedrive-settings" onclick="navTo('view-pipedrive-settings')">
            <span class="icon">&#128279;</span> Pipedrive Settings
          </div>
          <div class="nav-item nav-sub" id="nav-view-fieldcodes" onclick="navTo('view-fieldcodes')">
            <span class="icon">&#35;</span> Field Codes
          </div>
        </div>
      </div>
      <div class="nav-spacer"></div>
      <div class="nav-item nav-theme" title="Switch theme">
        <span class="icon" aria-hidden="true">&#127912;</span>
        <button type="button" id="themeBtn" class="theme-btn"
                aria-haspopup="listbox" aria-expanded="false" aria-label="Theme">
          <span id="themeBtnLabel">Theme</span>
          <span class="theme-caret" aria-hidden="true">&#9662;</span>
        </button>
        <ul id="themeMenu" class="theme-menu" role="listbox" aria-label="Theme" hidden></ul>
      </div>
      <div class="nav-footer">SilverFox V2 &middot; GAS-OPS</div>
    </nav>

    <div id="appMain">
      <div id="appHeader">
        <span id="appHeaderTitle">Home</span>
        <span id="appHeaderRight"></span>
      </div>
      <div id="appContent">
        <?!= include_('ViewHome') ?>
        <?!= include_('ViewRun') ?>
        <?!= include_('ViewImport') ?>
        <?!= include_('ViewDataSources') ?>
        <?!= include_('ViewVinLog') ?>
        <?!= include_('ViewVinInbox') ?>
        <?!= include_('ViewEndOfMonth') ?>
        <?!= include_('ViewRules') ?>
        <?!= include_('ViewNorm') ?>
        <?!= include_('ViewUtilities') ?>
        <?!= include_('ViewPipedriveSettings') ?>
        <?!= include_('ViewFieldCodes') ?>
        <?!= include_('ViewUiSettings') ?>
      </div>
    </div>

    <!-- Bottom taskbar — only rendered in the start-menu nav layout (CSS display:none otherwise). -->
    <div id="startBar">
      <button type="button" class="start-btn" onclick="toggleStartMenu(event)" aria-label="Start menu">
        <span class="start-logo" aria-hidden="true">&#8862;</span> Start
      </button>
      <span class="start-clock" id="startClock"></span>
    </div>

  </div>

  <script>
    // ── Shell boot — runs AFTER all view fragments have registered ──────────
    var NAV_TITLES = {
      'view-home':   'Home',
      'view-run':    'Run Order',
      'view-import': 'Import Data',
      'view-datasources': 'Data Sources',
      'view-vinlog': 'VIN Logs',
      'view-vin-inbox': 'VIN Inbox',
      'view-end-of-month': 'End of Month',
      'view-rules':  'Dealer Rules',
      'view-norm':   'Normalization',
      'view-utilities': 'Utilities',
      'view-pipedrive-settings': 'Pipedrive Settings',
      'view-fieldcodes': 'Field Codes',
      'view-ui-settings': 'UI Settings'
    };
    var _viewInited = {};

    function navTo(viewId) {
      var target = document.getElementById(viewId);
      if (!target) {
        toast('This section is still being migrated into the App — use the Classic menu for now.', 'info');
        return;
      }

      // Show/hide views
      var views = document.querySelectorAll('#appContent .view');
      for (var i = 0; i < views.length; i++) {
        views[i].hidden = (views[i].id !== viewId);
      }

      // Sidebar active state + header title
      var items = document.querySelectorAll('#sidebar .nav-item');
      for (var j = 0; j < items.length; j++) {
        items[j].classList.toggle('active', items[j].id === 'nav-' + viewId);
      }
      // Keep the System Settings group open when navigating to one of its children.
      if (['view-ui-settings', 'view-rules', 'view-norm', 'view-datasources', 'view-pipedrive-settings', 'view-fieldcodes'].indexOf(viewId) !== -1) {
        var sg = document.getElementById('nav-group-settings');
        if (sg) sg.classList.remove('collapsed');
      }
      document.getElementById('appHeaderTitle').textContent = NAV_TITLES[viewId] || '';

      // Lazy init (once), then on-show hook (every visit)
      if (!_viewInited[viewId]) {
        _viewInited[viewId] = true;
        if (window.VIEW_INITS && VIEW_INITS[viewId]) {
          try { VIEW_INITS[viewId](); } catch (e) { toast('Init error: ' + e.message, 'error'); }
        }
      }
      // Enhance this view's <select>s now that it's VISIBLE (real layout + options
      // present). Enhancing while a view is hidden is unreliable, which is why only
      // Run Order's selects (re-populated via innerHTML → caught by the observer)
      // got the themed dropdown before. Idempotent — already-enhanced selects skip.
      // Runs BEFORE VIEW_SHOWN so height-calc views (Norm/FieldCodes) measure the
      // enhanced layout.
      if (window.CustomSelect && CustomSelect.enhanceAll) {
        try { CustomSelect.enhanceAll(target); } catch (e) {}
      }
      if (window.VIEW_SHOWN && VIEW_SHOWN[viewId]) {
        try { VIEW_SHOWN[viewId](); } catch (e) {}
      }
      closeStartMenu();   // picking a destination closes the Start panel (no-op in other layouts)
    }

    function toggleSettingsGroup() {
      var g = document.getElementById('nav-group-settings');
      if (g) g.classList.toggle('collapsed');
    }

    // ── Start-menu layout: Start button popup + taskbar clock ────────────────
    function toggleStartMenu(e) {
      if (e) e.stopPropagation();   // don't let the click bubble to the outside-close handler
      var root = document.documentElement;
      if (root.hasAttribute('data-start-open')) root.removeAttribute('data-start-open');
      else root.setAttribute('data-start-open', '');
    }
    function closeStartMenu() { document.documentElement.removeAttribute('data-start-open'); }
    function tickStartClock() {
      var el = document.getElementById('startClock');
      if (el) { try { el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) {} }
    }

    // Mark not-yet-migrated sections in the sidebar
    function markPendingViews() {
      var ids = ['view-run', 'view-import', 'view-datasources', 'view-vinlog', 'view-rules', 'view-norm', 'view-utilities', 'view-pipedrive-settings', 'view-fieldcodes'];
      ids.forEach(function(id) {
        if (!document.getElementById(id)) {
          var item = document.getElementById('nav-' + id);
          if (item) {
            item.classList.add('pending');
            item.title = 'Coming soon — use the Classic menu for now';
          }
        }
      });
    }

    function exitApp() {
      var msgs = AppGuards.run();
      if (msgs.length === 0 ||
          confirm('Before you close:\n\n' + msgs.join('\n') + '\n\nClose anyway?')) {
        // In a browser tab (web app) there's no host dialog to close — the Close
        // item is hidden, but guard the path anyway.
        if (document.documentElement.getAttribute('data-mode') === 'webapp') {
          toast('Close the browser tab to exit.', 'info');
        } else {
          google.script.host.close();
        }
      }
    }

    markPendingViews();
    Theme.initPicker();                    // build the picker options from the registry
    CustomSelect.start();                  // enhance native <select>s into themed dropdowns (web-app-themeable)
    Theme.apply(Theme.current(), false);   // pin the attribute + sync the picker
    navTo('view-home');
    // Prefetch shared bootstrap data (dealers + users) while the user is on
    // Home — Run Order / VIN Logs then populate instantly on first visit.
    AppData.load();
    // Start-menu (taskbar) layout: live clock + click-outside-to-close (inert
    // unless the start-menu nav layout is active and the panel is open).
    tickStartClock(); setInterval(tickStartClock, 30000);
    document.addEventListener('click', function(e) {
      if (document.documentElement.hasAttribute('data-start-open') &&
          e.target.closest && !e.target.closest('#sidebar') && !e.target.closest('#startBar')) {
        closeStartMenu();
      }
    });
  </script>
</body>
</html>
```

## Classic.html — full source (standalone single-view wrapper)

```html
<!DOCTYPE html>
<html data-theme="<?= initialTheme ?>">
<head>
  <base target="_top">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Poppins:wght@700;800&display=swap" rel="stylesheet">
  <script>
    // Theme bootstrap (mirrors App.html) — keep any injected pref, else follow OS.
    (function() {
      var root = document.documentElement;
      if (!root.getAttribute('data-theme')) {
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      }
    })();
  </script>
  <style>
    /* Standalone wrapper for one converted view fragment — powers the
       "Classic menu" fallback with zero code duplication. */
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      font-family: var(--font-body);
      font-size: var(--fs-body);
      color: var(--text);
      background: var(--bg);
      overflow: hidden;
    }
    .view { height: 100vh; }
    .view[hidden] { display: none !important; }
  </style>
</head>
<body class="standalone">

  <!-- SharedUtils FIRST: the fragment registers guards/inits at parse time -->
  <?!= include_('SharedUtils') ?>
  <?!= include_(fragment) ?>

  <script>
    // In the classic (single-view) context, cross-view navigation falls back
    // to today's behavior: the server replaces this dialog with the target one.
    var CLASSIC_NAV = {
      'view-run':    'promptRunDealer',
      'view-import': 'openScraperImport',
      'view-vinlog': 'openVINLogUpdater',
      'view-rules':  'openRulesEditor',
      'view-norm':   'openNormManager'
    };
    function navTo(viewId) {
      if (CLASSIC_NAV[viewId]) google.script.run[CLASSIC_NAV[viewId]]();
    }

    function exitApp() {
      var msgs = AppGuards.run();
      if (msgs.length === 0 ||
          confirm('Before you close:\n\n' + msgs.join('\n') + '\n\nClose anyway?')) {
        google.script.host.close();
      }
    }

    // Reveal and boot the single embedded view.
    var v = document.querySelector('.view');
    if (v) {
      v.hidden = false;
      if (window.VIEW_INITS && VIEW_INITS[v.id]) {
        try { VIEW_INITS[v.id](); } catch (e) { /* surfaced by the view itself */ }
      }
      if (window.VIEW_SHOWN && VIEW_SHOWN[v.id]) {
        try { VIEW_SHOWN[v.id](); } catch (e) {}
      }
    }
  </script>
</body>
</html>
```

## Per-view shells

Every view fragment follows the same contract:

```html
<div class="view" id="view-<name>" data-layout="form|form-wide|data" hidden>
  <div class="<prefix>-scroll app-measure">  <!-- height:100%; overflow-y:auto; padding -->
    ... view content ...
  </div>
</div>
<style>/* all rules #view-<name>-scoped */</style>
<script>/* registers VIEW_INITS['view-<name>'] and/or VIEW_SHOWN['view-<name>'] */</script>
```

`hidden` is the visibility mechanism; `.view[hidden] { display:none !important }`. Each
tokenized view re-declares `#view-xxx { background: var(--bg); color: var(--text) }` to beat
the SharedUtils white `.view` guard.

### View wrapper inventory

| View | Root | data-layout | Inner shell |
|---|---|---|---|
| Home | `#view-home` | `data` | `.home-scroll.app-measure` — grid areas `status/wflabel/cards/dashhead/dash` |
| Run Order | `#view-run` | `data` | `.rv-wrap` (flex col) → `.rv-topbar` + `.rv-body` grid `"vin table rail"` (`--rv-vin-w` 250px / 1fr / `--rv-rail-w` 280px) |
| Import | `#view-import` | `form-wide` | `#importForm` flex col → `.modal-header` / `.modal-body` (`.import-cols` grid `460px 1fr`, areas `"left right"`) / `.modal-footer` |
| Data Sources | `#view-datasources` | `form-wide` | `.ds-scroll.app-measure` |
| VIN Logs | `#view-vinlog` | `data` | `.layout` grid `1fr var(--col-form-side)`, areas `"main side"`; `.col-main` (runs table) + `.col-side` (detail rail) |
| VIN Inbox | `#view-vin-inbox` | — | `.vi-scroll` → `.vi-head` + `.vi-cards` auto-fill grid `minmax(320px,1fr)` |
| End of Month | `#view-end-of-month` | — | `.eom-scroll` → `.eom-wrap` (max-width 760px; `.eom-wide` → `--measure-data`) |
| Dealer Rules | `#view-rules` | `form-wide` | `.top-bar.app-measure` (dealer select) + `.rules-tabs.app-measure` (tab bar) + tab panels + `#rulesStatus` bar |
| Normalization | `#view-norm` | `data` | `.top-bar` + `.add-bar` + `#normStatus` + `.table-wrap` (JS-sized) + `.footer` |
| Utilities | `#view-utilities` | `form` | `.util-scroll.app-measure` → `.util-group`s of `.util-btn`s |
| Pipedrive Settings | `#view-pipedrive-settings` | `form-wide` | `.ps-scroll.app-measure` (stacked `.ps-card`s) + `.ps-save-row` |
| Field Codes | `#view-fieldcodes` | `data` | `.top-bar` + `.add-bar` + `#fcStatus` + `.table-wrap` (mirrors Normalization) |
| UI Settings | `#view-ui-settings` | `form` | `.uis-scroll.app-measure` → option-card grid + toggle |

### Representative shell CSS — the "top-bar / add-bar / status / table" skeleton
(Normalization; Field Codes is a near-identical copy)

```css
#view-norm .top-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
}
#view-norm .add-bar {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  background: var(--surface);
}
#view-norm #normStatus { font-size: 12px; padding: 5px 16px; height: 28px; line-height: 18px; }
#view-norm .table-wrap { overflow-y: auto; }   /* height set by JS */
#view-norm .footer {
  display: flex; justify-content: flex-end; padding: 10px 16px;
  border-top: 1px solid var(--border); background: var(--surface);
}
```

### Representative shell CSS — Run Order 3-zone grid

```css
#view-run .rv-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: var(--space-3); padding: var(--space-3); }
#view-run .rv-topbar { display: flex; flex-direction: column; gap: var(--space-2); }
#view-run .rv-body { display: grid; grid-template-columns: var(--rv-vin-w) 1fr var(--rv-rail-w);
                     grid-template-areas: "vin table rail"; gap: var(--space-3); flex: 1; min-height: 0; }
#view-run .rv-vinzone { grid-area: vin; display: flex; flex-direction: column; min-height: 0; }
#view-run .rv-tablezone { grid-area: table; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
#view-run .rv-rail { grid-area: rail; display: flex; flex-direction: column; min-height: 0; overflow-y: auto;
                     border-left: 1px solid var(--border); padding-left: var(--space-3); }
```

### Representative shell CSS — VIN Logs two-column

```css
#view-vinlog .layout { display: grid; grid-template-columns: 1fr var(--col-form-side);
                       grid-template-areas: "main side"; height: 100%; }
#view-vinlog .col-main { grid-area: main; min-width: 0; padding: 20px; display: flex;
                         flex-direction: column; border-right: 1px solid var(--border); overflow: hidden; }
#view-vinlog .col-side { grid-area: side; padding: 20px; overflow-y: auto; background: var(--bg);
                         display: flex; flex-direction: column; }
```
