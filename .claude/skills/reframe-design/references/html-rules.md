# HTML invariants

These are the **contract between your generated HTML and the reframe engine**. The 37-rule audit validates against them; violating them produces fails at compile time.

## Inline styles only

```html
<!-- ✅ -->
<div style="padding: 24px; background: #0A2540; color: #fff">Hero</div>

<!-- ❌ -->
<div class="hero">Hero</div>
<style>.hero { padding: 24px; }</style>
```

Why: the engine parses inline styles directly into INode properties. External CSS → linkedom can't resolve cascade at import time → node properties missing.

One exception: `<style>` blocks **can** carry `@media` responsive rules if they reference elements via `data-reframe-idx` (engine links them). Not recommended for anything beyond responsive.

## Width on root

```html
<!-- ✅ web -->
<div style="width: 1440px; ...">...</div>

<!-- ✅ mobile -->
<div style="width: 390px; ...">...</div>

<!-- ❌ -->
<div style="...">...</div>  <!-- no width = engine can't size the scene -->
```

The root element's width is the canvas width. No width → no scene.

## Explicit `background` + `color` on every container

```html
<!-- ✅ -->
<div style="background: #0A2540; color: #fff; padding: 48px">
  <div style="background: #13294B; color: #fff; padding: 24px">Nested</div>
</div>

<!-- ❌ -->
<div style="background: #0A2540">
  <div style="padding: 24px">Nested — color inherits? engine doesn't know</div>
</div>
```

Why: reframe renders via CanvasKit, not a browser. CSS inheritance isn't computed; every node needs its own resolved color. Audit rule `color-in-palette` catches missing colors.

## Full-width sections use `width: 100%`

```html
<!-- ✅ -->
<section style="width: 100%; padding: 96px 0; background: #0A2540">
  <div style="max-width: 1200px; margin: 0 auto">Content</div>
</section>

<!-- ❌ -->
<section style="width: 1440px; ...">...</section>  <!-- becomes fixed, no stretch -->
```

Why: scene resize / responsive-adapt depends on stretchable full-width containers. Fixed px = no adaptivity.

## Buttons ≥ 44px high

```html
<!-- ✅ -->
<button style="height: 44px; padding: 0 20px; ...">Get started</button>

<!-- ❌ -->
<button style="padding: 4px 12px; ...">Get started</button>  <!-- ~28px tall -->
```

WCAG touch target. Audit rule `min-touch-target`.

## OpenType features per brand DESIGN.md

When the brand's DESIGN.md specifies features like `ss01`, `tnum`, `cv11`:

```html
<!-- ✅ -->
<span style="font-family: 'Stripe Sans', Inter; font-feature-settings: 'ss01', 'tnum'; font-size: 48px">
  $29
</span>
```

Apply to **every** text node in the scene, not just the "obvious" ones. Audit rule `font-in-palette` checks the tokens; `brandFidelity` score reflects coverage.

Common features and where they matter:
- `tnum` — tabular numbers (pricing, tables, stats)
- `ss01`/`ss02`/… — stylistic sets (a character, @ symbol, ampersand)
- `cv11`/`cv12`/… — character variants (single-story `a`, open `0`, etc.)
- `case` — uppercase punctuation (for ALL-CAPS headings)
- `zero` — slashed zero (for data-heavy UIs)

## Spacing on a grid

Pick a base (usually 4 or 8 px) and snap all `padding` / `margin` / `gap`:

```html
<!-- ✅ 8px grid: 8, 16, 24, 32, 48, 64, 96, 128 -->
<div style="padding: 48px 64px; gap: 24px">...</div>

<!-- ❌ -->
<div style="padding: 47px 63px; gap: 23px">...</div>
```

Audit rule `spacing-grid-compliance`. Aesthetic score `rhythm`.

## Do NOT use

| Feature | Why not | Use instead |
|---|---|---|
| `<img>` with external URL | Engine needs local assets | `<img src="./local.png">` or Figma-style image fills via `reframe_edit` |
| Positioning (`position: absolute/fixed`) | Layout engine is Yoga flex/grid — positioning outside flow won't render | Use nested flex |
| Floats (`float: left/right`) | Same reason | Flex |
| `transform` on static nodes | Engine ignores transforms for layout; use for motion only | `margin` / `translate` in animation |
| CSS custom properties (`--my-color: ...`) | Engine resolves values at import, but variables add indirection | Concrete hex values |

## Audit rules by invariant

The 37-rule audit's most common failures map to these invariants:

| Invariant broken | Rule(s) that catch it |
|---|---|
| Non-inline styles | `font-in-palette`, `color-in-palette` often degrade |
| Missing width on root | `node-overflow` (scene-level) |
| Missing `background` / `color` | `color-in-palette`, `contrast-minimum` |
| Button too short | `min-touch-target` |
| No OpenType when brand requires | `font-in-palette`, `brandFidelity` score |
| Spacing off-grid | `spacing-grid-compliance` |
