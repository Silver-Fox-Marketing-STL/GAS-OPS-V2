# Theme — SilverFox V2 (Google Apps Script HtmlService app)

There is NO Tailwind / CSS framework. The design system is a hand-rolled CSS custom-property
token system defined in `SharedUtils.html` (an HtmlService fragment `include_()`-d FIRST by
both `App.html` and `Classic.html`, so every view's `#view-xxx`-scoped CSS can reference the
tokens). Theme switching = a `data-theme` attribute on `<html>`; each theme id has a matching
`:root[data-theme="<id>"]` token block below. Structural axes (`data-shell`, `data-density`,
`data-shape`, `data-nav`, `data-arrange`, `data-viewport`) are composed on top — see
`layouts.md`.

Fonts are loaded in `App.html` / `Classic.html` heads from Google Fonts:
- `Montserrat` (400/500/600/700) → `--font-body`
- `Poppins` (700/800) → `--font-head`
- `Pixelify Sans` (App.html only, for the "encarta" theme wordmark)

Brand: "Lot Sherpa" — Coquelicot orange accent `#fd410d`, warm licorice-tinted neutrals.

## Full token + shared-primitive CSS (`SharedUtils.html` `<style>` block, verbatim)

This is the complete single source of truth: base Light tokens, Dark, Midnight HC, Encarta
(Win95), Slate, Sage, Gruvbox, Luna (WinXP) palettes, density/shape axes, hierarchy
utilities, toast, custom-select, and native `<select>` base styling.

```css
  /* ════════════════════════════════════════════════════════════════════════
     DESIGN TOKENS — Lot Sherpa brand. Single source of truth, lives here
     because SharedUtils is include_()-d FIRST by App.html and Classic.html,
     so every #view-xxx scoped rule can reference these var(--…) tokens and
     theming reaches the Classic fallback too. Theme = data-theme on <html>:
     :root = Light (default); :root[data-theme="dark"] = brand-warm Dark.
     ════════════════════════════════════════════════════════════════════════ */
  :root {
    /* Tells the browser to render native controls (the <select> popup,
       scrollbars, etc.) in the light scheme. Dark theme blocks override to
       `dark`. Without this the scheme is non-deterministic — it differed
       between the modal dialog and the full-page web app, which made the
       OS-native <select> popup render light (ignoring author option colors)
       in the web app even in dark themes. */
    color-scheme: light;
    /* Pin text to its true size — disables iOS Safari "font boosting" (automatic
       text inflation), which scaled the SAME px font differently per container and
       made identical dropdowns (.cs-menu) render at different sizes across views. */
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    /* surfaces (bright white fields) */
    --bg: #ffffff;
    --surface: #f7f5f2;
    --surface-2: #efeae4;
    --surface-3: #e7e1da;
    /* text (Licorice-tinted near-black → Taupe Gray) */
    --text: #221a14;
    --text-2: #5c544c;
    --text-3: #8d8d92;          /* Taupe Gray (brand) */
    --text-muted: #a9a6a2;
    /* borders */
    --border: #e7e1da;
    --border-2: #d9d3cd;
    /* accent — Coquelicot orange (brand primary) */
    --accent: #fd410d;
    --accent-hover: #d8350a;
    --accent-active: #a52b0f;   /* Rufous */
    --accent-weak: rgba(253,65,13,.08);
    --accent-weak-2: rgba(253,65,13,.15);
    --on-accent: #ffffff;
    /* semantic */
    --success: #1e7e34; --success-weak: #e6f4ea; --on-success: #ffffff;
    --danger:  #c0392b; --danger-weak:  #fce8e6; --on-danger:  #ffffff;
    --warning: #b8860b; --warning-weak: #fff7e0; --warning-strong: #8a6400;
    --info:    #2563a8; --info-weak:    #e7eef7;
    /* categorical type pills (theme-independent — saturated for white text) */
    --type-new: #1e7e34;
    --type-po: #c9920a;
    --type-cpo: #6f42c1;
    --type-cpoel: #2563a8;
    --on-type: #ffffff;
    /* effects */
    --radius-sm: 5px;
    --radius: 8px;
    --radius-lg: 12px;
    --shadow: 0 2px 10px rgba(34,9,1,.10);
    --shadow-lg: 0 6px 24px rgba(34,9,1,.16);
    --focus-ring: 0 0 0 3px rgba(253,65,13,.30);
    /* typography */
    --font-head: 'Poppins', 'Montserrat', Arial, sans-serif;
    --font-body: 'Montserrat', Arial, sans-serif;
    --fs-h1: 22px;
    --fs-h2: 18px;
    --fs-h3: 15px;
    --fs-overline: 11px;
    --fs-body: 13px;
    --fs-sm: 12px;
    --fs-hint: 11px;
    /* spacing scale */
    --space-1: 4px; --space-2: 8px; --space-3: 12px;
    --space-4: 16px; --space-5: 20px; --space-6: 28px;

    /* responsive layout measures — base :root ONLY (never per-theme; a theme
       must not change page measure). Consumed by App.html's width-gated rules
       so the app reads as designed at full-screen width without disturbing the
       locked 1400-wide modal. See the data-layout block in App.html. */
    --measure-form:      880px;                    /* narrow single-column form cap (Utilities, single-column config) */
    --measure-form-wide: 1280px;                   /* split / dense config cap (Run Order, Rules, Import, Pipedrive…) */
    --measure-data:      1680px;                   /* data/table working-area cap */
    --gutter-wide:       48px;                      /* ultra-wide (>=2100px) side breathing room */
    --col-form-side:     clamp(360px, 32vw, 440px); /* replaces the hardcoded 440px split column; resolves to 440 at 1400 */

    /* element-size tokens — base :root defaults = today's literals, so a no-op
       until a theme overrides one. Let a theme resize chrome / view columns with
       zero per-view CSS. (The side-column width uses --col-form-side above.) */
    --shell-header-h: 46px;    /* #appHeader height (App.html) */
    --shell-sidebar-w: 210px;  /* #sidebar width (App.html) */
    --brand-fs: 17px;          /* .app-brand font-size (App.html) */
    --rv-vin-w: 250px;         /* Run Order VIN textarea column (ViewRun) */
    --rv-rail-w: 280px;        /* Run Order right rail column (ViewRun) */
  }

  :root[data-theme="dark"],
  :root[data-theme="top-rail-dark"] {   /* top-rail-dark reuses the Dark palette; its top-bar structure lives in App.html */
    color-scheme: dark;   /* native popup/scrollbar render dark — readable in modal AND web app */
    /* neutral black/grey base — warm oranges reserved for accents/highlights */
    --bg: #121214;
    --surface: #1c1c1f;
    --surface-2: #26262a;
    --surface-3: #313137;
    --text: #f2f2f3;
    --text-2: #c4c4c8;
    --text-3: #9a9aa0;
    --text-muted: #6e6e74;
    --border: #3a3a40;
    --border-2: #4a4a51;
    /* darker orange for accent fills, lighter coral/mikado for highlights */
    --accent: #fd410d;          /* Coquelicot — primary accent */
    --accent-hover: #ff8f71;    /* Coral — lighter highlight on hover */
    --accent-active: #a52b0f;   /* Rufous — darker pressed */
    --accent-weak: rgba(253,65,13,.14);
    --accent-weak-2: rgba(253,65,13,.24);
    --on-accent: #ffffff;
    --success: #4caf6a; --success-weak: rgba(76,175,106,.16); --on-success: #0c1f12;
    --danger:  #ef5350; --danger-weak:  rgba(239,83,80,.16);  --on-danger:  #1f0c0b;
    --warning: #ffc817; --warning-weak: rgba(255,200,23,.15); --warning-strong: #ffd75a;
    --info:    #6ea8e6; --info-weak:    rgba(110,168,230,.16);
    --shadow: 0 2px 12px rgba(0,0,0,.45);
    --shadow-lg: 0 8px 28px rgba(0,0,0,.55);
    --focus-ring: 0 0 0 3px rgba(253,65,13,.45);
  }

  /* ── "Midnight HC" — high-contrast near-black palette ──────────────────────
     Pure token overrides (no structural change). Built for max legibility on
     dim screens / night shifts: near-black surfaces, white text, deliberately
     VISIBLE borders (high contrast needs them), a punchy accent. Logo lightens
     via the shared dark-logo selector in App.html.                            */
  :root[data-theme="midnight"] {
    color-scheme: dark;
    --bg: #000000; --surface: #0a0a0a; --surface-2: #141414; --surface-3: #1c1c1c;
    --text: #ffffff; --text-2: #dcdcdc; --text-3: #b0b0b0; --text-muted: #8a8a8a;
    --border: #5e5e5e; --border-2: #6a6a6a;   /* HC: ≥3:1 on near-black surfaces */
    --accent: #ff5a2c; --accent-hover: #ff8a64; --accent-active: #d8350a;
    --accent-weak: rgba(255,90,44,.18); --accent-weak-2: rgba(255,90,44,.30); --on-accent: #000000;
    --success: #34d058; --success-weak: rgba(52,208,88,.18);  --on-success: #00130a;
    --danger:  #ff6b63; --danger-weak:  rgba(255,107,99,.18); --on-danger:  #130303;
    --warning: #ffc233; --warning-weak: rgba(255,194,51,.18); --warning-strong: #ffd766;
    --info:    #6cb6ff; --info-weak:    rgba(108,182,255,.18);
    --shadow: 0 2px 12px rgba(0,0,0,.7); --shadow-lg: 0 8px 30px rgba(0,0,0,.8);
    --focus-ring: 0 0 0 3px rgba(255,90,44,.6);
  }

  /* ── "Encarta" — Windows 95/98 + 90s multimedia (a full reinvention) ──────────
     3D beveled "silver" chrome (raised buttons / sunken fields), SHARP corners,
     navy title bars + navy Explorer-style selection, Tahoma (the system stand-in
     for MS Sans Serif) with a pixel-font wordmark, chunky beveled scrollbars,
     dotted focus rectangles, and NO motion. Tokens here; the window-frame reflow
     (title-bar header, gray sidebar chrome, sunken client area, beveled controls,
     scrollbars) is the data-theme block in App.html (which loads Pixelify Sans).
     Light scheme — black on silver gray, white "article" client area.            */
  :root[data-theme="encarta"] {
    color-scheme: light;
    --bg: #ffffff;                 /* white client / "article" area */
    --surface: #c0c0c0;            /* Win95 face gray — window chrome */
    --surface-2: #d6d2ca;          /* warm raised face */
    --surface-3: #ebe9e3;
    --text: #000000; --text-2: #1d1d1d; --text-3: #3f3f3f; --text-muted: #5e5e5e;
    --border: #808080;             /* shadow-gray bevel edge */
    --border-2: #404040;           /* dark-shadow edge */
    --accent: #000080;             /* navy — title bar + selection */
    --accent-hover: #1084d0;       /* active-title gradient blue */
    --accent-active: #00006a;
    --accent-weak: #cdd9ee;        /* light selection tint */
    --accent-weak-2: #aac1e3;
    --on-accent: #ffffff;
    --success: #007a1f; --success-weak: #cfe7cf; --on-success: #ffffff;
    --danger:  #a40000; --danger-weak:  #efcfcf; --on-danger:  #ffffff;
    --warning: #7a5c00; --warning-weak: #efe4bc; --warning-strong: #4f3c00;
    --info:    #000080; --info-weak:    #d2dbef;
    /* type tags — flat 90s system colors, white text, sharp corners */
    --type-new: #007a1f; --type-po: #7a5c00; --type-cpo: #000080; --type-cpoel: #008080; --on-type: #ffffff;
    /* SHARP corners; the "shadow" tokens carry the raised 3D bevel so any
       var(--shadow) panel/menu becomes a Win95 raised box automatically. */
    --radius-sm: 0; --radius: 0; --radius-lg: 0;
    --shadow: inset -1px -1px #404040, inset 1px 1px #ffffff, inset -2px -2px #808080, inset 2px 2px #dfdfdf;
    --shadow-lg: inset -1px -1px #404040, inset 1px 1px #ffffff, inset -2px -2px #808080, inset 2px 2px #dfdfdf;
    --focus-ring: 0 0 0 1px #000080;
    --font-head: Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif;
    --font-body: Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif;
  }

  /* ════════════════════════════════════════════════════════════════════════
     CURATED PALETTE PRESETS — pure token overrides (no structural change), so
     each reuses the default light/dark layout and is backend/UX-safe by
     construction. To add one: copy a block, add { id, label } to Theme.themes
     below, and (DARK only) add the id to the .app-brand .logo list in App.html.
     ════════════════════════════════════════════════════════════════════════ */

  /* ── Slate — cool neutral light (the crisp blue counterpart to warm Light) ── */
  /* the palette for the 'slate-icons' composed preset (slate palette + icon rail). */
  :root[data-theme="slate-icons"] {
    color-scheme: light;
    --bg: #ffffff; --surface: #f1f5f9; --surface-2: #e6edf3; --surface-3: #dae3ec;
    --text: #0f1e2e; --text-2: #3f5163; --text-3: #647688; --text-muted: #93a3b3;
    --border: #d8e0e8; --border-2: #c2ccd6;
    --accent: #2563eb; --accent-hover: #1d4fc4; --accent-active: #173f9c;
    --accent-weak: rgba(37,99,235,.08); --accent-weak-2: rgba(37,99,235,.16); --on-accent: #ffffff;
    --success: #1e7e34; --success-weak: #e6f4ea; --on-success: #ffffff;
    --danger:  #c0392b; --danger-weak:  #fce8e6; --on-danger:  #ffffff;
    --warning: #b8860b; --warning-weak: #fff7e0; --warning-strong: #8a6400;
    --info:    #2563a8; --info-weak:    #e7eef7;
    --shadow: 0 2px 10px rgba(15,30,46,.10); --shadow-lg: 0 6px 24px rgba(15,30,46,.16);
    --focus-ring: 0 0 0 3px rgba(37,99,235,.30);
  }

  /* ── Sage — soft green light, calm and low-saturation ── */
  :root[data-theme="sage"] {
    color-scheme: light;
    --bg: #fbfdfb; --surface: #eef4ee; --surface-2: #e2ece2; --surface-3: #d4e2d4;
    --text: #1c2a20; --text-2: #44574a; --text-3: #6a7c6f; --text-muted: #97a59b;
    --border: #d7e3d7; --border-2: #c0d0c0;
    --accent: #2f8f5b; --accent-hover: #25744a; --accent-active: #1c5a39;
    --accent-weak: rgba(47,143,91,.10); --accent-weak-2: rgba(47,143,91,.18); --on-accent: #ffffff;
    --success: #1e7e34; --success-weak: #e6f4ea; --on-success: #ffffff;
    --danger:  #c0392b; --danger-weak:  #fce8e6; --on-danger:  #ffffff;
    --warning: #9a7400; --warning-weak: #f3ecd0; --warning-strong: #6f5400;
    --info:    #2f6a8f; --info-weak:    #e1ebf2;
    --shadow: 0 2px 10px rgba(28,42,32,.10); --shadow-lg: 0 6px 24px rgba(28,42,32,.16);
    --focus-ring: 0 0 0 3px rgba(47,143,91,.32);
  }

  /* ── Gruvbox — warm retro dark, orange accent ── */
  /* the palette for the 'gruvbox-rail' composed preset (gruvbox palette + top-rail). */
  :root[data-theme="gruvbox-rail"] {
    color-scheme: dark;
    --bg: #282828; --surface: #3c3836; --surface-2: #504945; --surface-3: #665c54;
    --text: #ebdbb2; --text-2: #d5c4a1; --text-3: #bdae93; --text-muted: #928374;
    --border: #504945; --border-2: #665c54;
    --accent: #fe8019; --accent-hover: #ff9b47; --accent-active: #d65d0e;
    --accent-weak: rgba(254,128,25,.16); --accent-weak-2: rgba(254,128,25,.26); --on-accent: #1d1407;
    --success: #b8bb26; --success-weak: rgba(184,187,38,.18); --on-success: #141600;
    --danger:  #fb4934; --danger-weak:  rgba(251,73,52,.18);  --on-danger:  #1d0603;
    --warning: #fabd2f; --warning-weak: rgba(250,189,47,.18); --warning-strong: #ffd152;
    --info:    #8ec07c; --info-weak:    rgba(142,192,124,.18);
    --shadow: 0 2px 12px rgba(0,0,0,.5); --shadow-lg: 0 8px 28px rgba(0,0,0,.6);
    --focus-ring: 0 0 0 3px rgba(254,128,25,.5);
  }

  /* ── "Windows XP" (Luna) — blue title bars, beige controls, system fonts.
     Palette/tokens here; the window-frame chrome is the data-theme block in
     App.html; the desktop page-arrangement is data-arrange="desktop". ── */
  :root[data-theme="luna"] {
    color-scheme: light;
    --bg: #ffffff; --surface: #ece9d8; --surface-2: #e3e0cf; --surface-3: #d6d3c2;
    --text: #000000; --text-2: #1c1c1c; --text-3: #444444; --text-muted: #6b6b6b;
    --border: #aca899; --border-2: #7f9db9;
    --accent: #316ac5; --accent-hover: #2a5bb0; --accent-active: #1f4894;
    --accent-weak: #d8e4f8; --accent-weak-2: #bcd2f0; --on-accent: #ffffff;
    --success: #2f7d1f; --success-weak: #dcecd2; --on-success: #ffffff;
    --danger:  #b41a1a; --danger-weak:  #f3d6d6; --on-danger:  #ffffff;
    --warning: #9a6a00; --warning-weak: #f5e7c6; --warning-strong: #6a4a00;
    --info:    #1c5fb0; --info-weak:    #d8e4f8;
    --radius-sm: 3px; --radius: 3px; --radius-lg: 4px;
    --shadow: 0 1px 3px rgba(0,0,0,.25); --shadow-lg: 0 4px 14px rgba(0,0,0,.35);
    --focus-ring: 0 0 0 2px rgba(255,140,0,.6);
    --font-head: 'Trebuchet MS', Tahoma, 'Segoe UI', sans-serif;
    --font-body: Tahoma, 'Segoe UI', Verdana, sans-serif;
    --shell-header-h: 30px;
  }

  /* ════════════════════════════════════════════════════════════════════════
     STRUCTURAL AXES (token half) — DENSITY + SHAPE. A theme opts in by declaring
     `density` / `shape` in its Theme.themes metadata; the client reflects it onto
     <html> pre-paint as data-density / data-shape. Reusable across every palette,
     so a curated "complete idea" theme composes palette × density × shape with no
     duplicated CSS. (The LAYOUT + NAV half — data-shell / data-nav — lives in
     App.html, which owns the shell markup.) Shape is declared AFTER density so a
     sharp theme's 0-radius wins over any density radius tweak.
     ════════════════════════════════════════════════════════════════════════ */
  :root[data-density="compact"] {
    --fs-h1: 20px; --fs-h2: 16px; --fs-h3: 14px; --fs-body: 12px; --fs-sm: 11px;
    --space-1: 3px; --space-2: 6px; --space-3: 9px; --space-4: 12px; --space-5: 15px; --space-6: 20px;
  }
  :root[data-density="spacious"] {
    --fs-h1: 25px; --fs-h2: 20px; --fs-h3: 16px; --fs-body: 14px; --fs-sm: 13px;
    --space-1: 5px; --space-2: 10px; --space-3: 16px; --space-4: 22px; --space-5: 30px; --space-6: 40px;
  }
  :root[data-shape="sharp"] { --radius-sm: 0; --radius: 0; --radius-lg: 0; }
  /* flat = no drop shadows; the existing hairline borders carry structure. */
  :root[data-shape="flat"]  { --shadow: none; --shadow-lg: none; }

  /* Base typography — the body font applies app-wide; per-view font-family
     declarations are migrated to these tokens view-by-view. */
  body { font-family: var(--font-body); background: var(--bg); color: var(--text); }

  /* Interim readability guard: a not-yet-tokenized view still paints a white
     background, but in dark mode the themed body color (near-white) would leak
     into any text that inherits its color → white-on-white. Until each view is
     migrated, pin it to a readable light context (hardcoded light values, NOT
     tokens, so it does NOT follow the theme). A migrated view's #view-xxx root
     overrides this (ID specificity beats this single class). Remove once all
     views are tokenized. */
  .view { background: #ffffff; color: #221a14; }

  /* Opt-in hierarchy utilities (used during view migration) */
  .u-h1 { font-family: var(--font-head); font-weight: 800; font-size: var(--fs-h1); color: var(--text); letter-spacing: -.01em; }
  .u-h2 { font-family: var(--font-head); font-weight: 700; font-size: var(--fs-h2); color: var(--text); }
  .u-h3 { font-family: var(--font-head); font-weight: 600; font-size: var(--fs-h3); color: var(--text); }
  .u-overline { font-family: var(--font-head); font-weight: 700; font-size: var(--fs-overline); letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
  .u-hint { font-size: var(--fs-hint); color: var(--text-3); }

  #appToast {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 2000;
    max-width: 420px;
    padding: 10px 16px;
    border-radius: var(--radius);
    font-family: var(--font-body);
    font-size: 12.5px;
    font-weight: 600;
    box-shadow: var(--shadow-lg);
    display: none;
    line-height: 1.5;
  }
  #appToast.info    { background: var(--info-weak);    color: var(--info);    border: 1px solid var(--info); }
  #appToast.success { background: var(--success-weak); color: var(--success); border: 1px solid var(--success); }
  #appToast.error   { background: var(--danger-weak);  color: var(--danger);  border: 1px solid var(--danger); }

  /* ════════════════════════════════════════════════════════════════════════
     CUSTOM SELECT — progressive enhancement of native <select> into a themed
     dropdown (the generalized, reusable form of the theme picker's .theme-*).
     WHY: the Apps Script web-app sandbox can't theme a native <select>'s OPEN
     option list (it's OS-rendered, light-on-light in dark themes) — so we
     overlay a button + <ul role="listbox"> that themes everywhere (and reads
     as a Win95 control under "encarta", where button/--shadow auto-bevel).
     The native <select> stays in the DOM as the value holder + event source.
     All tokens below resolve in SharedUtils :root, so it themes app-wide.
     ════════════════════════════════════════════════════════════════════════ */
  .cs-field { position: relative; }
  /* A real <button> so Encarta's `button` bevel rule catches it automatically. */
  .cs-btn {
    width: 100%;
    box-sizing: border-box;
    display: flex; align-items: center; gap: 6px;
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    font-family: var(--font-body); font-size: 13px; font-weight: 600;
    /* !important: the widget is injected INTO views, several of which have a
       wildcard `#view-xxx * { padding:0 }` reset (specificity 1,0,0) that would
       otherwise zero the control's padding. The widget defends its own layout. */
    padding: 8px !important; cursor: pointer; text-align: left;
  }
  .cs-btn:hover { border-color: var(--border-2); }
  .cs-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .cs-btn[aria-disabled="true"] { opacity: .55; cursor: default; }
  .cs-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cs-caret { font-size: 9px; color: var(--text-3); flex-shrink: 0; }

  /* position:fixed so the open list escapes any overflow:auto panel clipping
     (several selects live inside scrollable columns); JS sets left/top/width. */
  .cs-menu {
    position: fixed; z-index: 70; margin: 0; padding: 4px !important; list-style: none;
    background: var(--surface); border: 1px solid var(--border-2);
    border-radius: var(--radius); box-shadow: var(--shadow-lg);
    max-height: 280px; overflow-y: auto;
  }
  .cs-menu[hidden] { display: none; }
  .cs-menu li {
    /* Open list = comfortable: bigger text + more space between options. (The
       closed .cs-btn stays compact — "compact box, big text when it expands".) */
    padding: 11px 14px !important;   /* !important: survive host views' `* { padding:0 }` reset (see .cs-btn) */
    border-radius: var(--radius-sm); cursor: pointer;
    font-family: var(--font-body); font-size: 15px; font-weight: 600;
    color: var(--text); white-space: nowrap;
  }
  .cs-menu li:hover,
  .cs-menu li:focus { outline: none; background: var(--accent-weak); }
  .cs-menu li[aria-selected="true"] { background: var(--accent); color: var(--on-accent); }
  .cs-menu li[aria-disabled="true"] { opacity: .5; cursor: default; }
  .cs-menu li[aria-disabled="true"]:hover { background: none; }

  /* Shared base for native <select>s — so a dropdown reads the SAME whether or not
     CustomSelect has enhanced it into a .cs-btn (selects render native before
     enhancement / if it's unavailable). Matches the .cs-btn spec (the comfortable
     "Run Order" look) so prominent selectors that set no select CSS of their own
     (e.g. the Dealer Rules dealer dropdown, Data Sources dealer/source) stop
     falling back to the cramped browser default. Dense in-table selects override
     this with their own compact rules (higher #view-xxx specificity), so packed
     tables stay tight. */
  select {
    font-family: var(--font-body); font-size: 13px; font-weight: 600;
    color: var(--text); background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 8px; cursor: pointer;
  }
  select:hover { border-color: var(--border-2); }
  select:focus-visible { outline: none; box-shadow: var(--focus-ring); }
```

## Theme registry (SharedUtils.html JS — id → label → structural axes)

```js
themes: [
  { id: 'light',         label: 'Light' },
  { id: 'dark',          label: 'Dark' },
  { id: 'top-rail',      label: 'Top Rail',         shell: 'top-rail' },
  { id: 'top-rail-dark', label: 'Top Rail — Dark',  shell: 'top-rail' },
  { id: 'midnight',      label: 'Midnight HC' },
  { id: 'encarta',       label: 'Encarta' },
  { id: 'sage',          label: 'Sage' },
  { id: 'gruvbox-rail',  label: 'Gruvbox Rail',      shell: 'top-rail' },
  { id: 'slate-icons',   label: 'Slate — Icon Rail', nav: 'icons' },
  { id: 'luna',          label: 'Windows XP',        arrange: 'desktop' }
]
```

## Key token values at a glance (base Light theme)

| Group | Tokens |
|---|---|
| Surfaces | `--bg:#ffffff` `--surface:#f7f5f2` `--surface-2:#efeae4` `--surface-3:#e7e1da` |
| Text | `--text:#221a14` `--text-2:#5c544c` `--text-3:#8d8d92` `--text-muted:#a9a6a2` |
| Borders | `--border:#e7e1da` `--border-2:#d9d3cd` |
| Accent | `--accent:#fd410d` (Coquelicot) `--accent-hover:#d8350a` `--accent-active:#a52b0f` (Rufous) |
| Semantic | success `#1e7e34` / danger `#c0392b` / warning `#b8860b` / info `#2563a8` (+ `-weak` tints) |
| Type pills | `--type-new:#1e7e34` `--type-po:#c9920a` `--type-cpo:#6f42c1` `--type-cpoel:#2563a8` (theme-independent) |
| Radius | `--radius-sm:5px` `--radius:8px` `--radius-lg:12px` |
| Type scale | h1 22 / h2 18 / h3 15 / overline 11 / body 13 / sm 12 / hint 11 (px) |
| Spacing | `--space-1..6`: 4 / 8 / 12 / 16 / 20 / 28 px |
| Measures | `--measure-form:880px` `--measure-form-wide:1280px` `--measure-data:1680px` |
| Shell | `--shell-header-h:46px` `--shell-sidebar-w:210px` `--brand-fs:17px` `--rv-vin-w:250px` `--rv-rail-w:280px` |

Density axis: `data-density="compact"` / `"spacious"` rescales `--fs-*` and `--space-*`.
Shape axis: `data-shape="sharp"` zeroes radii; `"flat"` removes shadows.

## Per-view hardcoded colors (inconsistencies to know about)

Views are ~fully tokenized; the exceptions are:

- `App.html` — intentional hardcoded chrome for the retro themes (encarta Win95 bevels
  `#dfdfdf/#808080/#404040/#000080/#1084d0/#008080`; luna XP gradients
  `#0058ee/#2a8bf2/#0054e3/#003bbf/#ece9d8/#7f9db9`, taskbar `#2a8bf2→#0a52c0`,
  start button `#7bbf4a→#3c8d0d`). Logo mask fill: `#4a4a4d` light / `#d2d2d6` dark themes.
- `ViewHome.html` — one hardcoded hover shadow: `box-shadow: 0 1px 6px rgba(253,65,13,0.18)`
  (accent-tinted; not a token).
- `ViewRun.html` — focus ring `box-shadow: 0 0 0 2px rgba(253,65,13,0.25)` on the user select
  (differs from the shared `--focus-ring` 3px/.30 spec).
- `ViewVinLog.html` — focus ring `rgba(253,65,13,0.15)` (a THIRD focus-ring variant),
  plus overlay shadows `rgba(0,0,0,0.45)` / `rgba(0,0,0,0.28)`.
- `ViewVinInbox.html` — token fallbacks with hex: `var(--warning, #c87f00)`,
  `var(--success, #1c7a3a)` / `var(--success-weak, #dcefe0)`, `var(--danger, #b3261e)` /
  `var(--danger-weak, #f6dcdc)`, `var(--warning-weak, #fbe7cf)`; `.vi-actions button.primary`
  hardcodes `color:#fff` instead of `var(--on-accent)`. NOTE: the fallback hexes do NOT match
  the real token values (`--warning` is `#b8860b`, fallback says `#c87f00`; `--danger` is
  `#c0392b`, fallback says `#b3261e`).
- `ViewEndOfMonth.html` — same fallback-hex pattern (`#1c7a3a/#dcefe0/#b3261e/#f6dcdc/#e7eef7/#2563a8`)
  and `.eom-btn-primary` hardcodes `color:#fff`.
- `ViewRules.html` — `rgba(255,255,255,0.85)` and `rgba(0,0,0,0.18)` (overlay/scrim effects).
- `ViewImport.html` — `.btn-primary` uses `color: white` instead of `var(--on-accent)`.
- `EomReportRenderer.html` — every rule uses `var(--token, hexFallback)` on purpose: the
  fragment is byte-copied into the standalone `eom-viewer/` project and must render without
  SharedUtils. Its fallback palette (`#1a2733`, `#dce4ec`, `#f6f8fa`, `#1a3a5c`) is a cool
  blue-gray that does NOT match the warm Lot Sherpa lights.

## Theming architecture inconsistencies

*(Historical list as of June 2026. Items 2 and 5 were fixed by the July 2026
unified-component-layer pass — see `docs/GAS_ShortCut_OPS_Bridge_System.md` →
"Unified Component Layer"; annotated below, not deleted, to keep the record.)*

1. **Interim `.view` guard**: `SharedUtils` pins `.view { background:#ffffff; color:#221a14 }`
   as a readability guard for not-yet-tokenized views; every tokenized view root must re-declare
   `#view-xxx { background: var(--bg); color: var(--text) }` to override it.
2. ~~**Focus rings**: shared `--focus-ring` (3px, .30 alpha) vs ViewRun (2px, .25) vs
   ViewVinLog (2px, .15) — three variants.~~ **FIXED (July 2026).** All three call sites now
   use `var(--focus-ring)`; no per-view literal focus-ring `box-shadow` remains.
3. **Border radii on controls**: token views use `var(--radius-sm)` (5px), but many
   view-local buttons/inputs hardcode `border-radius: 4px` (Run, Norm, FieldCodes, Import,
   VinLog, PipedriveSettings) and 5px (Utilities, DataSources) — pre-token literals.
   **PARTIALLY FIXED (July 2026):** the button/pill/tag/table primitives are unified onto
   `var(--radius-sm)` via the shared `.btn-*`/`.pill`/`.tag`/`.table-u` layer; non-component
   literal 3px/4px radii (inputs, textareas, progress-bar tracks, ad hoc chips) are still
   scattered per view — untouched by that pass, still open.
4. **`--fs-lg` is referenced** (ViewVinInbox `.vi-group-head`, ViewEndOfMonth
   `.eom-reports-title`) **but never defined** in any token block — silently falls back to
   inherited font-size. **Still open** — also referenced by `lot-scan/Capture.html`; noted,
   not fixed, in the July 2026 pass (out of scope, see `docs/GAS_ShortCut_OPS_Bridge_System.md`
   → "Unified Component Layer" open items).
5. ~~**`--font-mono` is referenced** (`var(--font-mono, ui-monospace, monospace)`) but never
   defined; most views just say `font-family: monospace`.~~ **FIXED (July 2026).**
   `--font-mono: ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace` now defined in the
   base `:root` token block (`SharedUtils.html`); `.table-u td.mono` and VIN Inbox's monospace
   fields consume it. The old `var(--font-mono, ui-monospace, monospace)` fallback call sites
   still work (the fallback is now inert) but could be simplified to `var(--font-mono)`.
