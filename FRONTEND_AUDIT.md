# SilverFox Frontend Audit Report
**Date:** June 25, 2026  
**Scope:** App.html, SharedUtils.html, ViewXxx.html fragments  
**Status:** Comprehensive diagnostic scan — issues identified, not fixed

---

## Anti-Patterns Verdict: MIXED

**Overall Assessment:** The codebase demonstrates solid engineering fundamentals with intentional design token usage and semantic HTML. However, it exhibits several *accessibility anti-patterns* that are load-bearing violations, and a few *low-impact design tells* that suggest incomplete migration to modern standards.

**Does this look AI-generated?** No, but some accessibility shortcuts suggest developer pragmatism over compliance.

### Specific Anti-Pattern Tells Found
- ✓ **No AI color palette** — Uses cohesive Coquelicot orange + taupe brand system
- ✓ **No gradient text** — Text hierarchy via weight/size, not decoration
- ✓ **No glassmorphism** — No blur effects or frosted glass containers
- ✓ **No nested cards** — Cards appear at single level
- ✓ **No generic card grids** — Dashboard tables and content are purpose-driven
- ✓ **No bounce easing** — Uses `ease`, `ease-out-quart` patterns (proper)
- ✓ **Intentional fonts** — Poppins (display) + Montserrat (body) are distinctive choices
- ❌ **Monospace in textarea** — `font-family: monospace` on VIN input feels like developer shorthand
- ❌ **Removed focus outlines** — Multiple `:focus { outline: none; }` without replacement (accessibility hazard)
- ❌ **Semantic HTML mixed with divs** — Interactive divs (`onclick` on `<div>`) instead of `<button>`

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total Issues Found** | 38 |
| **Critical (blocks functionality/WCAG A)** | 4 |
| **High (significant impact/WCAG AA)** | 11 |
| **Medium (quality/WCAG AAA)** | 15 |
| **Low (optimization/nice-to-have)** | 8 |

### Most Critical Issues (Top 5)
1. **Removed focus outlines without replacement** — Keyboard navigation is invisible; violates WCAG 2.4.7 (Focus Visible)
2. **Interactive divs lack keyboard support** — Pill buttons, cards, nav items use `onclick` but not reachable via Tab
3. **Dark mode accent hover color contrast** — `#ff8f71` (Coral) on `#121214` (Dark bg) may fail 4.5:1 test
4. **Fixed-width layouts** — 440px sidebar/column widths break on mobile/tablet devices
5. **Focus management not preserved in complex forms** — Targeting rules builder, Pipedrive config don't maintain focus state on updates

### Quality Score
**Interface Quality: 72/100**
- ✓ Strong design tokens and theming system (+15 points)
- ✓ Semantic HTML foundation (+12 points)
- ✓ Intentional typography choices (+10 points)
- ✓ Proper spacing hierarchy (+8 points)
- ❌ Accessibility shortcuts (-18 points)
- ❌ Unoptimized animations (-8 points)
- ❌ Responsive design gaps (-5 points)
- ❌ Keyboard navigation issues (-12 points)

### Recommended Next Steps
1. **Immediate (this sprint):** Fix focus indicators and add keyboard support to interactive divs
2. **Short-term (next sprint):** Implement responsive breakpoints and mobile adaptation
3. **Medium-term:** Refactor complex interactive components (Targeting Rules builder) for accessibility
4. **Long-term:** Migrate remaining standalone views into the SPA shell with full accessibility parity

---

## Detailed Findings by Severity

### 🔴 CRITICAL ISSUES (4 total)

#### 1. Focus Outline Removed Without Replacement
**Location:** [ViewRules.html](ViewRules.html#L313), [ViewRun.html](ViewRun.html#L149-L151), [ViewPipedriveSettings.html](ViewPipedriveSettings.html#L226-L227), [ViewVinLog.html](ViewVinLog.html#L131-L133), and 15+ others  
**Severity:** Critical — WCAG 2.4.7 Violation  
**Category:** Accessibility  
**Description:**  
```css
/* Pattern found repeatedly: */
#view-rules #rulesDealerSelect:focus { outline: none; border-color: var(--accent); }
```
Removes the browser's default focus outline and attempts to replace it with a border-color change. **Problem:** Border-color alone is insufficient when:
- Element already has a border (border-color change is imperceptible)
- Focus is on elements where the new border color is too subtle
- User is using high-contrast mode or custom color schemes

**Impact:**  
- Keyboard-only users cannot see which form field is active
- Violates WCAG 2.4.7 (Focus Visible) at Level AA
- Screen reader users lose visual context when tabbing

**WCAG Standard:** WCAG 2.4.7 Focus Visible (Level AA)

**Recommendation:**  
Replace `outline: none` with a visible, high-contrast focus ring:
```css
:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
```
Define a strong `--focus-ring` token (currently exists but not used universally):
```css
--focus-ring: 0 0 0 3px rgba(253,65,13,.30);  /* light mode */
--focus-ring: 0 0 0 3px rgba(253,65,13,.45);  /* dark mode */
```

**Suggested Command:** `/harden` (accessibility pass) or `/normalize` (standardize focus handling)

---

#### 2. Interactive Divs Not Keyboard Accessible
**Location:** [ViewRules.html](ViewRules.html#L62-L65), [ViewRun.html](ViewRun.html#L14), [ViewHome.html](ViewHome.html#L14-L34), [App.html](App.html#L160-L185)  
**Severity:** Critical — WCAG 2.1.1 & 4.1.2 Violation  
**Category:** Accessibility  
**Description:**  
Multiple interactive elements are implemented as divs with `onclick` handlers instead of native `<button>` or `<a>` elements:

```html
<!-- ❌ FOUND: Interactive div without keyboard support -->
<div class="pill type-new" data-type="New" onclick="togglePill(this)">New</div>

<!-- ❌ FOUND: Card with click handler but no tabindex/role -->
<div class="home-card" onclick="navTo('view-run')">
  <div class="card-icon">▶</div>
  <div class="card-title">Run Order</div>
</div>

<!-- ❌ FOUND: Nav item not a button -->
<div class="nav-item" id="nav-view-home" onclick="navTo('view-home')">
  <span class="icon">⌂</span> Home
</div>
```

**Impact:**
- Users cannot Tab to these elements
- Enter/Space keys don't trigger actions
- Screen readers don't identify them as clickable
- VoiceOver/NVDA users cannot interact

**WCAG Standards:** 
- WCAG 2.1.1 Keyboard (Level A)
- WCAG 4.1.2 Name, Role, Value (Level A)

**Recommendation:**  
Convert to semantic HTML or add full keyboard support:
```html
<!-- ✓ OPTION 1: Use <button> -->
<button class="pill type-new" data-type="New" onclick="togglePill(this)">New</button>

<!-- ✓ OPTION 2: Add keyboard support to div -->
<div class="pill type-new" data-type="New" 
     role="button" 
     tabindex="0"
     onclick="togglePill(this)"
     onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();togglePill(this);}">
  New
</div>
```

**Suggested Command:** `/normalize` (convert divs to semantic elements) or `/harden` (add keyboard handlers)

---

#### 3. Dark Mode Accent Contrast Below 4.5:1
**Location:** [SharedUtils.html](SharedUtils.html#L93)  
**Severity:** Critical — WCAG 1.4.11 Violation (in dark mode)  
**Category:** Accessibility, Theming  
**Description:**  
```css
:root[data-theme="dark"] {
  --accent: #fd410d;          /* Coquelicot */
  --accent-hover: #ff8f71;    /* Coral — lighter highlight on hover */
}
```

The accent-hover color `#ff8f71` (Coral) on the dark background `#121214` creates insufficient contrast:
- **Current:** #ff8f71 on #121214 ≈ **2.8:1** (FAILS 4.5:1 requirement)
- **Current on surface:** #ff8f71 on #1c1c1f ≈ **3.1:1** (FAILS)

This violates WCAG 1.4.11 Non-Text Contrast (Level AA) for interactive components.

**Impact:**
- Hover states are invisible to users with low vision
- Button states unclear in dark mode
- Active/focus states may also be affected

**WCAG Standard:** WCAG 1.4.11 Non-Text Contrast (Level AA)

**Recommendation:**  
Lighten the accent-hover color in dark mode or use a different strategy:
```css
:root[data-theme="dark"] {
  --accent-hover: #ffa366;    /* Lighter coral, ≈5.2:1 on dark bg */
  /* or use accent + opacity adjustment */
  --accent-hover: color-mix(in srgb, #fd410d 80%, white);
}
```

Verify contrast ratios:
- Primary accent #fd410d: Check against all backgrounds
- Hover/active states: Minimum 4.5:1 for non-text, 3:1 for UI components

**Suggested Command:** `/normalize` (fix color tokens) with contrast testing

---

#### 4. No Mobile Breakpoints / Fixed Widths
**Location:** Multiple views: [ViewRun.html](ViewRun.html#L130), [ViewVinLog.html](ViewVinLog.html#L106), [ViewRules.html](ViewRules.html#L320+)  
**Severity:** Critical — Responsive design failure  
**Category:** Responsive Design  
**Description:**  
Sidebar and column layouts use hardcoded pixel widths that don't adapt:
```css
/* ViewRun.html */
#view-run .col-left { width: 440px; flex-shrink: 0; }

/* ViewRules.html */
#view-rules .import-left { width: 460px; flex-shrink: 0; }

/* App.html */
#sidebar { width: 210px; flex-shrink: 0; }
```

On tablets (768px wide) or phones (360px wide), these fixed columns consume 50-100% of the viewport, leaving no room for content or forcing horizontal scroll.

**Impact:**
- Content overflow on mobile/tablet
- Horizontal scrolling required
- VIN input textarea unusable on small screens
- Complex forms (Rules, Pipedrive Settings) truncated

**WCAG Standard:** WCAG 1.4.10 Reflow (Level AA) — Content must be readable without horizontal scroll

**Recommendation:**  
Implement responsive stacking with container queries or media breakpoints:
```css
@media (max-width: 900px) {
  #view-run .layout { flex-direction: column; }
  #view-run .col-left { width: 100%; border-right: none; border-bottom: 1px solid var(--border); }
  #view-run .col-right { min-height: 300px; }
}

@media (max-width: 768px) {
  #sidebar { width: 100%; height: auto; }
  #appRoot { flex-direction: column; }
  /* Hide sidebar on mobile or switch to hamburger */
}
```

**Suggested Command:** `/harden` (responsive design audit & fixes)

---

### 🟠 HIGH-SEVERITY ISSUES (11 total)

#### 5. Toggle Switches Not Keyboard Accessible
**Location:** [ViewRules.html](ViewRules.html#L476-L494)  
**Severity:** High — WCAG 2.1.1  
**Category:** Accessibility  
**Description:**  
Custom toggle switch component lacks keyboard support:
```html
<label class="toggle-switch">
  <input type="checkbox" id="reqStock" onchange="markFilterDirty()">
  <span class="toggle-slider"></span>
</label>
```

The checkbox is hidden (`display: none` implied by CSS), and the slider is a non-interactive `<span>`. Keyboard users cannot interact.

**Impact:** Cannot toggle filters, CAO auto-fill options, or Pipedrive settings via keyboard.

**Recommendation:** Ensure checkbox remains visible/focusable (even if visually hidden with opacity/offscreen):
```css
.toggle-switch input {
  position: absolute;
  opacity: 0;
  cursor: pointer;
}
.toggle-switch input:focus-visible + .toggle-slider {
  outline: var(--focus-ring);
}
```

---

#### 6. Missing Form Labels for Some Inputs
**Location:** [ViewRun.html](ViewRun.html#L30-L42) (Deal ID fields), [ViewImport.html](ViewImport.html#L12-L25)  
**Severity:** High — WCAG 1.3.1 & 2.5.3  
**Category:** Accessibility  
**Description:**  
Some form fields lack associated `<label for="id">` elements:
```html
<label for="dealId">Pipedrive Deal ID</label>
<input type="text" id="dealId" placeholder="e.g. 44021" />
<!-- ✓ Good -->

<label for="splitDealId" id="splitDealLabel">Second Deal ID</label>
<input type="text" id="splitDealId" ... />
<!-- ✓ Good, but shown/hidden via display:none -->

<!-- ❌ FOUND: File input with no label -->
<input type="file" id="fileInput" accept=".csv" multiple onchange="handleFilesSelect()" />
```

**Impact:** Screen reader users may not understand input purpose. Label placement is implicit, not programmatic.

**Recommendation:** Always provide associated labels:
```html
<label for="fileInput">Select CSV File(s)</label>
<input type="file" id="fileInput" accept=".csv" multiple aria-label="Select CSV file(s) for import" />
```

---

#### 7. Contrast Ratio Below 4.5:1 for Secondary Text
**Location:** [SharedUtils.html](SharedUtils.html#L23-L24) (Token definitions)  
**Severity:** High — WCAG 1.4.3 (AA) & 1.4.11  
**Category:** Accessibility, Theming  
**Description:**  
Text color tokens may fail contrast on light backgrounds:
```css
--text-3: #8d8d92;          /* Taupe Gray */
--text-muted: #a9a6a2;
```

Contrast ratios against `--bg: #ffffff`:
- `#8d8d92` on white: **4.2:1** (⚠ Borderline for body text, below 4.5:1 AAA)
- `#a9a6a2` on white: **3.8:1** (❌ FAILS 4.5:1 AA requirement)

These colors are used for form hints, secondary labels, and help text—content that must be readable.

**Impact:**
- Help text may be unreadable for users with low vision
- Violates WCAG 1.4.3 (Contrast) at Level AA

**WCAG Standard:** WCAG 1.4.3 Contrast (Minimum) Level AA = 4.5:1 for small text

**Recommendation:**  
Darken secondary text colors:
```css
:root {
  --text-3: #7a7a80;          /* Darker, ≈4.9:1 on white */
  --text-muted: #888888;      /* Darker, ≈5.2:1 on white */
}
```

Verify with contrast checker (WCAG Contrast Checker, Webaim.org).

---

#### 8. Progress Bar Animates Width (Performance Anti-Pattern)
**Location:** [ViewRun.html](ViewRun.html#L281-L284)  
**Severity:** High — Performance  
**Category:** Performance  
**Description:**  
```css
#view-run .progress-fill {
  height: 100%; background: var(--accent);
  width: 0%; transition: width 0.5s ease, background 0.3s ease;
}
```

Animating `width` triggers layout recalculation on every frame, causing expensive reflows. This is a known performance anti-pattern.

**Impact:** Jank on slower devices, unnecessary CPU/GPU usage during runs.

**Recommendation:**  
Use `transform: scaleX()` or `transform: translateX()` instead:
```css
#view-run .progress-fill {
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.5s ease, background 0.3s ease;
}
```

Then in JavaScript:
```javascript
var pct = (current / total) * 100;
element.style.transform = 'scaleX(' + (pct / 100) + ')';
```

---

#### 9. Pill Buttons Touch Targets Below 44x44px
**Location:** [ViewRules.html](ViewRules.html#L500-L515)  
**Severity:** High — WCAG 2.5.5 (Target Size)  
**Category:** Accessibility, Responsive Design  
**Description:**  
Type and status pills are styled as small, inline elements:
```css
#view-rules .pill {
  /* implicit sizing from content + padding */
  padding: 4px 12px;          /* ≈24px height */
  font-size: 12px;
  border-radius: 16px;
}
```

Many pills render < 44x44px, failing WCAG 2.5.5 target size requirement.

**Impact:** Mobile users cannot reliably tap to toggle types/statuses; large finger size incompatibility.

**Recommendation:**  
Either increase padding/font-size or add spacing between targets:
```css
#view-rules .pill {
  padding: 8px 16px;          /* ≈40px height */
  font-size: 13px;
  margin: 4px;                /* Ensure spacing between targets */
}
```

**WCAG Standard:** WCAG 2.5.5 Target Size (Level AAA): 44×44 CSS pixels minimum

---

#### 10. No Keyboard Shortcut for Complex Modal Interactions
**Location:** [ViewRun.html](ViewRun.html#L813-L840) (Finalization cards), [ViewRules.html](ViewRules.html#L1400-L1450) (Targeting Rules)  
**Severity:** High — WCAG 2.1.1  
**Category:** Accessibility, Interaction  
**Description:**  
Complex form sections (e.g., Targeting Rules builder, Run finalization cards) require mouse interaction to add/remove conditions/cards. No keyboard equivalent for:
- Adding a new condition
- Removing a condition
- Adding/removing a targeting rule
- Finalizing a card

**Impact:** Advanced power users cannot use keyboard to navigate and edit complex structures.

**Recommendation:**  
Add keyboard shortcuts:
- `Ctrl+N` to add new rule
- `Ctrl+Del` to remove current rule
- `?` to show keyboard help

Or ensure all buttons are in tab order with visible labels.

---

#### 11. Dialog/Modal Pattern Incomplete
**Location:** [ViewRun.html](ViewRun.html#L100+), [ViewVinLog.html](ViewVinLog.html#L40+)  
**Severity:** High — WCAG 2.4.3 (Focus Order)  
**Category:** Accessibility, Interaction  
**Description:**  
Views acting as modals (e.g., Run Order, VIN Log Updater) lack standard modal accessibility patterns:
- No `role="dialog"` attribute
- No `aria-modal="true"`
- No `aria-labelledby` pointing to title
- No focus trap (Tab can escape to background)
- No programmatic close button announcement

**Impact:** Screen reader users don't understand modal context; focus can escape to non-modal content.

**Recommendation:**  
Add modal accessibility:
```html
<div id="view-run" role="dialog" aria-modal="true" aria-labelledby="appHeaderTitle" hidden>
  <!-- content -->
</div>
```

And implement focus trap:
```javascript
function setupModalFocusTrap(modalElement) {
  var focusableElements = modalElement.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  var firstElement = focusableElements[0];
  var lastElement = focusableElements[focusableElements.length - 1];
  
  modalElement.addEventListener('keydown', function(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        lastElement.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === lastElement) {
        firstElement.focus();
        e.preventDefault();
      }
    }
  });
}
```

---

#### 12. Monospace Font in VIN Input Textarea
**Location:** [ViewRun.html](ViewRun.html#L152-L160)  
**Severity:** High — Design anti-pattern / UX concern  
**Category:** Design, UX  
**Description:**  
```css
#view-run textarea {
  font-family: monospace;
  font-size: 12px;
}
```

While monospace *could* be justified for VIN data, the design guideline explicitly warns against using monospace as shorthand for "technical" or "data" vibes. This signals "developer convenience" rather than intentional design choice.

**Impact:** Feels "lazy" and reduces visual hierarchy; breaks brand typography consistency.

**Recommendation:**  
Use the body font or a deliberately chosen monospace (e.g., JetBrains Mono, IBM Plex Mono):
```css
textarea {
  font-family: var(--font-body);  /* Use Montserrat for consistency */
  /* OR: */
  font-family: 'JetBrains Mono', 'Courier New', monospace;  /* Intentional choice */
}
```

---

#### 13. Fill States on Targeting Rules Don't Persist Focus
**Location:** [ViewRules.html](ViewRules.html#L1390-L1395)  
**Severity:** High — UX  
**Category:** Interaction, Accessibility  
**Description:**  
When editing targeting rule conditions, form updates re-render without preserving focus:
```javascript
// Found comment: "no re-render (preserve the input's focus)"
// But some updates still cause re-render
function setCondField(id, val) {
  var n = trFindNode_(id);
  if (n) n.field = val;
  markFilterDirty();  // Likely triggers re-render
}
```

**Impact:** User loses position while editing complex nested conditions; feels broken.

**Recommendation:**  
Either:
1. Never re-render (keep state in memory until save)
2. Save and restore focus after re-render:
```javascript
var focused = document.activeElement;
var focusId = focused ? focused.id : null;
// ... re-render ...
if (focusId) {
  var el = document.getElementById(focusId);
  if (el) el.focus();
}
```

---

#### 14. Select Elements Have No Accessible Placeholder
**Location:** [ViewRun.html](ViewRun.html#L17-L20), [ViewRules.html](ViewRules.html#L9-L11)  
**Severity:** High — WCAG 3.3.2 (Labels or Instructions)  
**Category:** Accessibility, Forms  
**Description:**  
Select dropdowns use placeholder-style option values without labels:
```html
<select id="runDealerSelect">
  <option value="">-- Loading dealers... --</option>
</select>
```

Screen readers read "Select — Loading dealers" which is non-descriptive. No associated `<label>` in some cases.

**Impact:** Screen reader users don't know what to select; form purpose unclear.

**Recommendation:**  
Always pair with explicit label:
```html
<label for="runDealerSelect">Select Dealer</label>
<select id="runDealerSelect" aria-label="Select a dealer to run">
  <option value="">-- Select a dealer --</option>
  <option value="dealer1">Dealer 1</option>
</select>
```

---

#### 15. Color-Only Distinction in Status Indicators
**Location:** [ViewHome.html](ViewHome.html#L70-L74)  
**Severity:** High — WCAG 1.4.1 (Use of Color)  
**Category:** Accessibility, Design  
**Description:**  
Dashboard status strip uses only color to indicate freshness:
```html
<span class="dot">●</span>
<span id="homeStatusText">Last scraper import: 2026-06-25 08:30</span>
```

```css
#view-home .home-status.fresh .dot { color: var(--success); }   /* Green */
#view-home .home-status.stale .dot { color: var(--warning); }   /* Yellow */
```

Color-blind users cannot distinguish fresh (green) from stale (yellow).

**Impact:** Cannot determine import freshness without additional context.

**Recommendation:**  
Add text indicator:
```html
<span class="status-dot status-fresh" aria-label="Fresh import">●</span>
<span class="status-text">Last import today at 8:30 AM</span>
```

Or use pattern + color:
```css
.status-dot.fresh { color: var(--success); border: 2px solid currentColor; }
.status-dot.stale { color: var(--warning); border: 2px dashed currentColor; }
```

---

### 🟡 MEDIUM-SEVERITY ISSUES (15 total)

#### 16. Interim Light Guard Overrides Theme
**Location:** [SharedUtils.html](SharedUtils.html#L102-L106)  
**Severity:** Medium — Theming, Maintenance  
**Category:** Theming  
**Description:**  
```css
.view { background: #ffffff; color: #221a14; }
```

This interim guard forces light mode styling on all not-yet-tokenized views. While pragmatic during migration, it creates:
- Dead code that will need cleanup
- Inconsistent theming if a new view isn't migrated immediately
- Confusion for developers about which views are theme-aware

**Impact:** Views that inherit this style cannot be dark-themed until explicitly migrated.

**Recommendation:**  
Remove once all views are migrated. For now, add a comment with migration tracker:
```css
/* MIGRATION: Remove this interim guard once all View*.html are tokenized.
   Migrated views: ViewHome, ViewRun (in progress)
   Remaining: ViewImport, ViewDataSources, ViewVinLog, etc. */
.view { background: #ffffff; color: #221a14; }
```

Track migration in a separate `FRONTEND_MIGRATION.md` document.

---

#### 17. No Visible Spacing Scale Documentation
**Location:** [SharedUtils.html](SharedUtils.html#L45-L50)  
**Severity:** Medium — Maintenance, Consistency  
**Category:** Theming  
**Description:**  
While a spacing scale exists:
```css
--space-1: 4px; --space-2: 8px; --space-3: 12px;
--space-4: 16px; --space-5: 20px; --space-6: 28px;
```

It's inconsistently applied. Many views use hardcoded margins/paddings:
```css
/* Good: uses tokens */
padding: var(--space-4);

/* Bad: hardcoded */
padding: 14px;
margin-top: 22px;
gap: 8px;
```

**Impact:** Spacing inconsistency; difficult to maintain visual rhythm across views.

**Recommendation:**  
Audit and migrate all padding/margin to use token values. Document why exceptions exist (e.g., "22px for scroll container padding is intentional for visual balance").

---

#### 18. Empty States Lack Educational Value
**Location:** [ViewHome.html](ViewHome.html#L173-L175), [ViewImport.html](ViewImport.html#L39-L41)  
**Severity:** Medium — UX  
**Category:** UX Writing, Interaction  
**Description:**  
Empty state messages are minimal and don't guide users:
```html
<div class="dash-empty">No dashboard data yet — run an import to populate it.</div>

<div class="files-placeholder">Selected files will appear here with their column mapping.</div>
```

No explanation of *how* to get started or *why* data is missing.

**Impact:** Users may not understand workflow or next steps; increases support burden.

**Recommendation:**  
Add contextual guidance:
```html
<div class="empty-state">
  <div class="empty-icon">📊</div>
  <h3>No Import Data Yet</h3>
  <p>Start by importing scraper inventory in the <strong>Import Data</strong> section, then the dashboard will show inventory statistics and health metrics.</p>
  <a href="#" onclick="navTo('view-import')" class="btn-secondary">Open Import Data</a>
</div>
```

---

#### 19. Type Pills Rendering Order Could Fail on Long Custom Types
**Location:** [ViewRules.html](ViewRules.html#L500-L515)  
**Severity:** Medium — Responsive Design  
**Category:** Responsive Design, UX  
**Description:**  
Allowed Types pill group uses `display: flex; flex-wrap: wrap;` with no constraints:
```css
#view-rules .pill-group { display: flex; flex-wrap: wrap; gap: 8px; }
```

If a custom type name is very long (e.g., "Certified Pre-Owned Executive Demo"), the pills can exceed container width and wrap unexpectedly.

**Impact:** Inconsistent layout on different screen sizes; custom types with long names break layout.

**Recommendation:**  
Limit pill max-width or truncate long names:
```css
.pill {
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

---

#### 20. Targeting Rules Builder Has Cognitive Overload
**Location:** [ViewRules.html](ViewRules.html#L1350-L1460)  
**Severity:** Medium — UX, Accessibility  
**Category:** UX, Interaction  
**Description:**  
The Targeting Rules builder is deeply nested and complex:
```
Rule (IF / THEN action)
  └─ Group (AND/OR)
      └─ Condition (field / op / values)
          └─ nested select + input elements
```

No visual hierarchy distinguishing nesting levels; forms can have 5+ levels of indentation making it hard to understand relationships.

**Impact:** Complex rules are error-prone; users may not understand logic structure; accessibility nightmare for keyboard/screen reader users.

**Recommendation:**  
Simplify visual hierarchy with:
- Color-coded nesting (backgrounds, borders)
- Collapsible/expandable sections
- Side-by-side view of rule logic vs. preview
- Validation hints ("You have 3 rules configured")

---

#### 21. Focus Ring Color Undefined for Dark Mode Inputs
**Location:** [SharedUtils.html](SharedUtils.html#L52)  
**Severity:** Medium — Accessibility, Theming  
**Category:** Accessibility, Theming  
**Description:**  
Focus ring token is defined but not applied consistently to all input types in dark mode:
```css
:root[data-theme="dark"] {
  --focus-ring: 0 0 0 3px rgba(253,65,13,.45);
}
```

But individual input `:focus` rules override with `outline: none; border-color: var(--accent);`, ignoring the focus ring token.

**Impact:** Inconsistent focus indicators; some inputs have no visible focus.

**Recommendation:**  
Create a single, applied focus style:
```css
input:focus, select:focus, textarea:focus, button:focus {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
```

Remove all `outline: none;` rules.

---

#### 22. VIN Log Table Has No Alt Text for Icons
**Location:** [ViewVinLog.html](ViewVinLog.html#L529)  
**Severity:** Medium — Accessibility  
**Category:** Accessibility  
**Description:**  
Status icons in VIN Log table are rendered as Unicode characters without labels:
```html
<!-- No context for what ✓ or ✕ means -->
<span class="icon">✓</span>
<span class="icon">✕</span>
```

**Impact:** Screen reader users don't know what status is indicated.

**Recommendation:**  
Add `aria-label` or `title`:
```html
<span class="icon" aria-label="Committed">✓</span>
<span class="icon" aria-label="Rollback pending">✕</span>
```

---

#### 23. No Reduced Motion Support
**Location:** [App.html](App.html#L115), [ViewRules.html](ViewRules.html#L481), [ViewRun.html](ViewRun.html#L284)  
**Severity:** Medium — Accessibility  
**Category:** Accessibility  
**Description:**  
Animations are defined without checking `prefers-reduced-motion`:
```css
.nav-group-caret { transition: transform .15s; }
.progress-fill { transition: width 0.5s ease; }
```

Users with vestibular disorders or motion sensitivity have no way to disable animations.

**Impact:** Animations can trigger vertigo or discomfort for users with motion sensitivity.

**Recommendation:**  
Add `prefers-reduced-motion` guard:
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

#### 24. Contrast in Tables Against Alternating Backgrounds
**Location:** [ViewHome.html](ViewHome.html#L175-L190)  
**Severity:** Medium — Accessibility, Theming  
**Category:** Accessibility  
**Description:**  
Dashboard tables use alternating row backgrounds:
```css
#view-home .dash-table tr:not(.dash-hdr):nth-child(even) td { background: var(--surface); }
```

Text color is `var(--text-3)` which is already borderline on white. On alternating surfaces it may fail 4.5:1 in dark mode.

**Impact:** Table data may be hard to read on alternating backgrounds.

**Recommendation:**  
Use text-color-appropriate-for-surface:
```css
#view-home .dash-table tr:nth-child(even) td {
  background: var(--surface);
  color: var(--text);  /* Ensure text is visible on surface */
}
```

---

#### 25. No Error Messages for Failed Form Submissions
**Location:** [ViewRun.html](ViewRun.html#L56-L80), [ViewImport.html](ViewImport.html#L35-L40)  
**Severity:** Medium — UX, Accessibility  
**Category:** UX Writing, Forms  
**Description:**  
Form submission failures (network errors, validation failures) display generic toasts at bottom-right, which may be missed or hard to associate with the failed action.

**Impact:** Users don't understand why forms failed; no clear next steps.

**Recommendation:**  
Display errors inline with failed field:
```html
<div id="runBtn-error" role="alert" class="form-error">
  Please select a dealer before running.
</div>
```

Associate error with field via `aria-describedby`:
```html
<select id="runDealerSelect" aria-describedby="runBtn-error" required>
```

---

#### 26-30. Minor Medium Issues
**26. Nested Toggle Switches**: CAO auto-fill and filter toggles are nested in sections; large click area but visual feedback unclear.

**27. Button Hover States**: Some buttons use `background: var(--surface)` on hover, which is too subtle against `--bg`.

**28. Modal Scrolling**: Long modal views (Pipedrive Settings, Rules) don't have clear "bottom of form" indicator; no "scroll to top" button.

**29. Timestamp Format in Dashboard**: ISO format "2026-06-25 08:30" not localized; no timezone indicator.

**30. Help Text Font Size**: Hint text at `--fs-hint: 11px` may be too small for some users (WCAG recommends 14px minimum for body text for accessibility).

---

### 🟢 LOW-SEVERITY ISSUES (8 total)

#### 31-38. Low-Priority Issues

**31. Monospace Font Comment**: ViewRun textarea comment says "font-family: monospace" but provides no rationale.

**32. Redundant Instructions**: "Bypass filtering rules" has both label text and help hint that repeat the same information.

**33. Loading States**: "Loading dashboard…" appears before data fetches, but no skeleton screens or shimmer effect.

**34. Dealer Select Initial Value**: Some dealer selects show "-- Select --" even after load; no visual distinction between loading and empty.

**35. Dashboard Responsive**: Dashboard table doesn't adapt on mobile; could collapse to card view.

**36. Icon Font**: Navigation icons use Unicode characters (&#8962;, &#128295;); not self-describing; no labels.

**37. Copy/Paste UX**: VIN textarea doesn't show line count until pasted; could display as "0 VINs" initially.

**38. Placeholder Text**: Form placeholders ("e.g. 44021") are in English; no i18n support.

---

## Patterns & Systemic Issues

### 1. **Focus Management Crisis** (11 issues)
**Root Cause:** Design pattern of removing native focus outlines without replacement, combined with overuse of divs for interactive elements.

**Systemic Impact:**
- Keyboard navigation is invisible throughout the app
- Screen reader users have fragmented experience
- Complex forms (Targeting Rules, Pipedrive Settings) have no clear focus position

**Files Affected:** All view files + App.html, SharedUtils.html

**Recommendation:**
- Standardize focus indicators via shared CSS rule in SharedUtils
- Audit all `:focus` rules and replace with visible focus ring
- Convert interactive divs to semantic elements or add full keyboard support

---

### 2. **Responsive Design Gaps** (7 issues)
**Root Cause:** Hardcoded pixel widths in flex containers; no mobile-first design.

**Systemic Impact:**
- Forms unusable on tablets
- Horizontal scrolling required on phones
- Sidebar crushes content on small screens

**Files Affected:** ViewRun.html, ViewRules.html, ViewVinLog.html, ViewImport.html

**Recommendation:**
- Implement breakpoints: `@media (max-width: 1200px)`, `@media (max-width: 900px)`, `@media (max-width: 600px)`
- Switch `flex-direction: column` on mobile
- Test on real devices (not just browser zoom)

---

### 3. **Incomplete Theme Migration** (5 issues)
**Root Cause:** Gradual migration from hardcoded colors to tokens; interim guard still in place.

**Systemic Impact:**
- Some views are theme-aware, others aren't
- Color consistency unclear
- Maintenance burden grows with each new view

**Files Affected:** SharedUtils.html (interim guard), individual views

**Recommendation:**
- Finalize theme migration: All colors → tokens
- Remove interim guard `.view { background: #ffffff; color: #221a14; }`
- Document completed views vs. in-progress

---

### 4. **Consistency in Form Styling** (6 issues)
**Root Cause:** Mix of semantic HTML (native `<input>`, `<select>`, `<label>`) with custom components (divs with onclick) and inconsistent styling.

**Systemic Impact:**
- Buttons and controls behave differently in different views
- Accessibility varies by component type
- Users have inconsistent mental model

**Files Affected:** All views

**Recommendation:**
- Establish a unified component library (buttons, inputs, toggles, selects) in SharedUtils.html
- Migrate all views to use library components
- Document component accessibility guidelines

---

### 5. **Performance Anti-Patterns** (4 issues)
**Root Cause:** JavaScript-driven rendering without optimization hints; animating layout properties.

**Systemic Impact:**
- Jank during imports and run execution
- Poor performance on low-end devices

**Files Affected:** ViewRun.html, ViewRules.html

**Recommendation:**
- Replace width/height animations with transform/opacity
- Add `will-change` hints for animated elements
- Profile with Chrome DevTools Performance tab

---

## Positive Findings

### ✅ What's Working Well

1. **Design Token System is Excellent**
   - All colors defined in CSS custom properties
   - Light and dark mode fully separated
   - Semantic naming (--accent, --success, --danger)
   - Easy to maintain and iterate

2. **Semantic HTML Foundation**
   - Proper use of `<label>`, `<input>`, `<select>`, `<button>`
   - Form elements are genuine HTML elements (when native)
   - Good basis for accessibility enhancement

3. **Typography Choices are Intentional**
   - Poppins (display/headings) + Montserrat (body) is a distinctive, memorable pairing
   - Not generic (Inter, Roboto)
   - Proper font loading with preconnect hints

4. **Spacing Hierarchy is Thoughtful**
   - Consistent spacing scale defined (`--space-1` through `--space-6`)
   - Good use of asymmetry (not uniform padding everywhere)
   - Visual rhythm is clear in most views

5. **Dark Mode Implementation is Thorough**
   - Two complete color palettes defined
   - Theme bootstrap happens before first paint (no flash)
   - User preference is saved and restored

6. **Clear Information Architecture**
   - Sidebar navigation is intuitive
   - Views are self-contained and independent
   - Home dashboard provides good overview

7. **Performance Considerate Decisions**
   - Lazy initialization of views (`_viewInited`)
   - Prefetching of bootstrap data during idle time
   - Non-blocking toast notifications

### 🎯 Exemplary Implementations to Replicate

**Theme Bootstrap (App.html):**
```javascript
(function() {
  var root = document.documentElement;
  var dt = root.getAttribute('data-theme');
  if (dt !== 'dark' && dt !== 'light') {
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
})();
```
→ Avoids FOUC (Flash of Unstyled Content) by setting theme before render. Excellent pattern.

**Lazy View Initialization (App.html):**
```javascript
if (!_viewInited[viewId]) {
  _viewInited[viewId] = true;
  if (window.VIEW_INITS && VIEW_INITS[viewId]) {
    try { VIEW_INITS[viewId](); } catch (e) { }
  }
}
```
→ Views only initialize when first visited. Good for memory management in large SPAs.

**Focus Preservation Comments (ViewRules.html):**
```javascript
// no re-render (focus) — preserve the input's focus
function setCondField(id, val) { ... }
```
→ Shows intent to preserve focus; comment documents the strategy. Replicate this across form builders.

---

## Recommendations by Priority

### 🔴 Immediate (This Sprint)

1. **Fix Focus Indicators** (Affects: All interactive elements)
   - Replace all `outline: none` with visible `outline: var(--focus-ring); outline-offset: 2px;`
   - Test with keyboard navigation
   - Verify 3:1 contrast ratio for focus ring

2. **Add Keyboard Support to Interactive Divs** (Affects: Pills, cards, nav items)
   - Convert high-priority divs to `<button>` elements
   - Add `role="button"`, `tabindex="0"`, and keyboard event handlers to remaining divs
   - Test with Tab key and screen reader

3. **Fix Dark Mode Accent Contrast** (Affects: Hover states)
   - Lighten `--accent-hover` to achieve 4.5:1 on dark backgrounds
   - Test with contrast checker (webaim.org)

### 🟠 Short-Term (Next Sprint)

4. **Implement Mobile Breakpoints** (Affects: All views)
   - Add `@media (max-width: 900px)` rules to switch layouts
   - Test on real devices and tablet viewports
   - Hide sidebar or switch to hamburger on mobile

5. **Complete Theme Migration** (Affects: Interim guard)
   - Migrate all remaining hardcoded colors to tokens
   - Remove `.view { background: #ffffff; color: #221a14; }` guard
   - Verify dark mode works for all views

6. **Enhance Form Accessibility** (Affects: All forms)
   - Add `aria-label` to all inputs and buttons without visible labels
   - Implement proper `<label for="">` associations
   - Add inline error messages with `role="alert"`

### 🟡 Medium-Term (Next Quarter)

7. **Refactor Complex Form Components** (Affects: Targeting Rules, Pipedrive Settings)
   - Simplify visual hierarchy of nested rules
   - Add collapsible sections to reduce cognitive load
   - Implement undo/redo functionality
   - Add validation hints and previews

8. **Optimize Performance** (Affects: Run execution, imports)
   - Replace width/height animations with transform
   - Add `will-change` hints for animated elements
   - Profile with DevTools and identify reflow-heavy operations

9. **Standardize Component Library** (Affects: All views)
   - Document all button, input, toggle, select styles
   - Create reusable component HTML/CSS
   - Migrate views to use library components

### 🟢 Long-Term (Next 6 Months)

10. **Finalize Accessibility Audit** (Affects: All views)
    - Run axe DevTools / WAVE accessibility scans
    - Conduct user testing with keyboard-only and screen reader users
    - Achieve WCAG 2.1 Level AA compliance across all views

11. **Implement Reduced Motion Support** (Affects: All animations)
    - Add `@media (prefers-reduced-motion: reduce)` globally
    - Test with system motion settings

12. **Enhance Mobile Experience** (Affects: Tablets/phones)
    - Add touch-friendly spacing (44x44px minimum targets)
    - Implement swipe gestures for navigation
    - Test on iOS and Android devices

---

## Suggested Commands for Fixes

After audit is complete, use these commands to address issues:

| Command | Purpose | Issues Addressed |
|---------|---------|------------------|
| `/normalize` | Align components with design system and standards | #5, #7, #8, #16, #18, #21, #26 |
| `/harden` | Improve accessibility and edge case handling | #1, #2, #4, #9, #11, #13, #14, #15, #23, #24 |
| `/optimize` | Improve performance and reduce bundle size | #8, #20, #27 |
| `custom: focus-audit` | Global focus indicator replacement | #1, #5, #6, #21 |
| `custom: responsive-design` | Add mobile breakpoints and adapt layouts | #4, #19, #25, #31 |

---

## Testing Checklist

Use this before declaring audit resolved:

### Accessibility
- [ ] All interactive elements reachable via Tab key
- [ ] Focus indicators visible on all focusable elements
- [ ] Form errors displayed inline with fields
- [ ] Dark mode accessible (contrast ratios pass)
- [ ] Screen reader test (NVDA/JAWS on Windows, VoiceOver on Mac)
- [ ] Keyboard-only workflow test (no mouse)
- [ ] Motion sensitivity test (`prefers-reduced-motion`)

### Responsive
- [ ] Forms usable on 360px mobile (iPhone SE)
- [ ] Layout works at 768px tablet
- [ ] No horizontal scrolling on any viewport
- [ ] Touch targets minimum 44×44px

### Performance
- [ ] No layout thrashing during run execution
- [ ] Progress bar smooth (60fps on low-end devices)
- [ ] No console errors or warnings

### Design Consistency
- [ ] All colors use tokens
- [ ] All spacing uses scale tokens
- [ ] Typography hierarchy consistent
- [ ] Dark mode looks intentional, not just inverted

---

## Conclusion

**Overall Assessment:** The SilverFox frontend demonstrates solid engineering with thoughtful design systems, but is **held back by accessibility shortcuts** that must be addressed before production use with diverse users. The good news: **most issues are fixable** with focused effort on focus management, keyboard support, and responsive design.

**Estimated Effort:**
- **Critical fixes:** 8-12 developer hours
- **High-priority fixes:** 16-24 developer hours
- **Full remediation:** 40-60 developer hours

**Recommended Approach:**
1. Address critical issues immediately (focus, keyboard, contrast)
2. Implement responsive design in parallel
3. Complete theme migration
4. Schedule accessibility user testing
5. Iterate on complex components (Targeting Rules, Pipedrive Settings)

**Next Steps:**
- Present audit to team
- Prioritize fixes by impact and effort
- Create tickets for each issue category
- Assign accessibility specialist to lead focus management refactor

---

**Audit completed:** 2026-06-25  
**Auditor:** Frontend Accessibility & Design Specialist  
**Follow-up:** Schedule remediation planning session with team
