# SilverFox V2 — Design System ("Lot Sherpa")

## Product context

Internal ops app for a vehicle-graphic production workflow (~43 automotive dealer
accounts). Google Apps Script HtmlService single-page app: one shell (`App.html`),
13 views, all styled with hand-rolled CSS custom-property tokens defined in
`SharedUtils.html`. No Tailwind, no framework. Daily power-user tool — density and
scannability matter more than marketing polish.

Key screens: Run Order (VIN paste → match table → finalize), Import Data, VIN Logs,
Dealer Rules (filter pills + Pipedrive config), Normalization CRUD table, End of
Month billing reports, Home dashboard.

## Brand

- Name/wordmark: **SilverFox** (system: "Lot Sherpa" design language)
- Accent: **Coquelicot orange `#fd410d`** (hover `#d8350a`, active/Rufous `#a52b0f`)
- Neutrals: warm licorice-tinted — bg `#ffffff`, surface `#f7f5f2`, surface-2 `#efeae4`,
  surface-3 `#e7e1da`; text `#221a14` → `#5c544c` → `#8d8d92` → muted `#a9a6a2`
- Borders: `#e7e1da` / `#d9d3cd`
- Fonts: **Poppins** 700/800 for headings (`--font-head`), **Montserrat** 400–700 for
  body (`--font-body`). No other fonts.

## Tokens (base Light theme — the single source of truth)

| Group | Values |
|---|---|
| Surfaces | `--bg #ffffff` `--surface #f7f5f2` `--surface-2 #efeae4` `--surface-3 #e7e1da` |
| Text | `--text #221a14` `--text-2 #5c544c` `--text-3 #8d8d92` `--text-muted #a9a6a2` |
| Borders | `--border #e7e1da` `--border-2 #d9d3cd` |
| Accent | `--accent #fd410d` `--accent-hover #d8350a` `--accent-active #a52b0f` `--accent-weak rgba(253,65,13,.08)` `--accent-weak-2 rgba(253,65,13,.15)` `--on-accent #fff` |
| Semantic | success `#1e7e34`/`#e6f4ea`; danger `#c0392b`/`#fce8e6`; warning `#b8860b`/`#fff7e0`; info `#2563a8`/`#e7eef7` |
| Type pills | `--type-new #1e7e34` `--type-po #c9920a` `--type-cpo #6f42c1` `--type-cpoel #2563a8`, text `--on-type #fff` (theme-independent, saturated for white text) |
| Radius | `--radius-sm 5px` `--radius 8px` `--radius-lg 12px` |
| Shadows | `--shadow 0 2px 10px rgba(34,9,1,.10)` `--shadow-lg 0 6px 24px rgba(34,9,1,.16)` |
| Focus | `--focus-ring 0 0 0 3px rgba(253,65,13,.30)` — the ONE canonical focus ring |
| Type scale | h1 22 / h2 18 / h3 15 / overline 11 (uppercase, .06em) / body 13 / sm 12 / hint 11 px |
| Spacing | `--space-1..6`: 4 / 8 / 12 / 16 / 20 / 28 px |

Dark theme exists (neutral near-black surfaces, same Coquelicot accent, lighter coral
hover) plus 8 more palettes — all pure token overrides. Design for Light; anything
token-driven themes automatically.

## Component grammar

**Buttons — three-variant grammar** (Run Order's dialect is canonical):
- Primary: solid `--accent`, `--on-accent` text, bold, no border; hover `--accent-hover`;
  disabled `--text-muted` bg.
- Secondary: `--bg` fill, `--text-2`, 1px `--border-2`; hover `--surface`.
- Ghost (accent-outline): `--bg` fill, `--accent` text, 1.5px `--accent` border;
  hover `--accent-weak`.
- Danger: outlined `--danger` text/border; hover `--danger-weak`.

**Pills**: vehicle-type pills use the per-type saturated fill when active, outlined
neutral when inactive. Status badges are weak-tint chips (semantic-weak bg + semantic
text). Radius today drifts between 10px / 20px / 999px across views.

**Tables**: `border-collapse: collapse`; sticky uppercase 10–11px letter-spaced header
on `--surface-2`; 1px `--border` row dividers; `font-variant-numeric: tabular-nums`;
semantic row states use weak tints (`--danger-weak` not-found rows, `--accent-weak`
editing rows); TOTALS rows invert (`--text` bg, `--bg` text).

**Cards**: `--surface` bg, 1px `--border`, `--radius`, accent-colored section heading.
**Status bars**: one-line weak-tint strips (info/success/error/empty).
**Tabs**: folder tabs seated on a border line; active = accent text + accent bottom border.
**Toggles**: iOS-style, accent track when checked.
**Progress**: 6px rounded track, accent fill, done→success / error→danger.

## Known drift (what the unification pass resolves)

- Six per-view button dialects (Run, Utilities, Norm, DataSources, PipedriveSettings,
  EOM, Import) — same grammar, different paddings/radii/literals; Import's
  "btn-secondary" is actually the ghost style.
- Three pill radii (10px read-only / 20px clickable / 999px badges).
- Four table recipes with different header sizes (10 vs 11px) and paddings.
- Hardcoded `border-radius: 4px` and three focus-ring variants where `--radius-sm`
  and `--focus-ring` should be used.
- Stray `color: #fff` / `color: white` where `--on-accent` should be used.

## Motion & interaction

Minimal: 0.12–0.2s transitions on hover/toggle/progress only. No entrance animations.
`prefers-reduced-motion` respected by the retro themes (no motion at all there).

## Hard constraints

- Use ONLY the tokens above — no new colors, fonts, gradients, or shadows.
- Poppins (headings) + Montserrat (body) only.
- Everything must remain expressible as plain CSS custom properties (no framework).
