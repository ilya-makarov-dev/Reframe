# reframe — Programmable Design Engine

YOU are the designer. reframe is your rendering engine.

**Primary workflow: write HTML → reframe compiles, validates, exports.**
You write beautiful HTML+CSS (your strength). reframe imports it, audits against 19 rules, adapts to multiple sizes, and exports to React/SVG/Lottie/multi-page site. Don't fight with JSON — design in HTML.

## How It Works

```
YOU write HTML  →  INode AST  →  validate (19 rules)  →  export → user reviews
     ↑                                ↑                    ↓            │
  DESIGN.md                       auto-fix            .reframe/        │
  = brand context                 = corrections       exports/         │
                                                                       │
  ← ─ ─ ─ ─ ─  edit → inspect → export  ← ─ ─ user feedback ─ ─ ─ ─ ┘
```

**DESIGN.md is your brand context.** Load a brand (`brand: 'stripe'`), read `.reframe/brand.md` for design philosophy. Audit enforces compliance.

## Pipeline (always follow this order)

### Step 1: Load brand
```
reframe_design({ action: 'extract', brand: 'stripe' })
```
Sets active brand for the session. All subsequent calls use it automatically.
Pre-built brand guides available. Load by name or extract from any URL.
Or extract from URL: `{ action: 'extract', url: 'https://example.com' }`

### Step 2: Design in HTML + compile

Write a complete HTML page with inline styles. Make it beautiful — you're a designer.
Then send to reframe:
```
reframe_compile({
  html: `
    <div style="width: 1440px; min-height: 900px; background: #09090b; font-family: Inter, sans-serif;">
      <nav style="padding: 16px 80px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 20px; font-weight: 700; color: #fff;">Acme</span>
        <button style="background: #7c3aed; color: #fff; padding: 10px 24px; border-radius: 8px; border: none; font-weight: 600;">Sign Up</button>
      </nav>
      <section style="padding: 140px 80px; text-align: center;">
        <h1 style="font-size: 64px; font-weight: 700; color: #fafafa; letter-spacing: -2px; line-height: 1.05;">Build faster</h1>
        <p style="font-size: 20px; color: #a1a1aa; margin-top: 24px; max-width: 500px; margin-left: auto; margin-right: auto;">The modern platform for ambitious teams.</p>
      </section>
    </div>
  `,
  exports: ['html'],
  name: 'home'
})
```
reframe imports your HTML → INode AST → audits → auto-fixes → saves to `.reframe/exports/`.

**Blueprint path** (alternative for programmatic/batch): use `blueprint` JSON with primitives (stack, row, card, display, body, button). Not for creative work — for templates and automation.

### Step 3: Inspect → Edit → Inspect (loop until clean)

This is a LOOP. Inspect shows issues with actionable fixes. Edit fixes them. Inspect again to verify. Repeat until clean.

```
reframe_inspect({ sceneId: 's1' })
```
Inspect tells you exactly what to fix:
```
[!] contrast-minimum: Contrast 2.57:1 below 3:1 for "Product"
    → reframe_edit: update "Product" props: { fills: ["#fafafa"] }
[!] min-touch-target: "button" is 132×40px — below 44×44px
    → reframe_edit: update "button" props: { minHeight: 44, paddingTop: 12 }
```
Fix:
```
reframe_edit({ operations: [
  { op: 'update', path: 'Product', props: { fills: ['#fafafa'] } },
  { op: 'update', path: 'button', props: { minHeight: 44, paddingTop: 12, paddingBottom: 12 } }
]})
```
Then inspect again. When user gives feedback ("make the hero bigger", "change accent color"), inspect → edit → inspect.

### Step 4: Export → user reviews → loop back

Export is a **preview**, not the final step. User sees the result, gives feedback, you edit and export again.
```
reframe_export({ sceneId: 's1', format: 'html' })   // user opens file
```
User: "make the CTA bigger and change accent to green"
```
reframe_edit({ operations: [
  { op: 'update', path: 'CTA', props: { fontSize: 18, paddingTop: 16, paddingBottom: 16 } }
]})
reframe_inspect({ sceneId: 's1' })                   // verify
reframe_export({ sceneId: 's1', format: 'html' })    // user reviews again
```

## Design Rules

**Design in HTML.** You write stunning HTML+CSS. Use inline styles. Make every page self-contained. reframe handles the rest.

**When user specifies colors, USE THEM.** If user says "accent #7c3aed" → use exactly that. Not your default.

**Set explicit dimensions on root.** `<div style="width: 1440px; min-height: 900px; ...">`. reframe needs dimensions for the root container.

**Use inline styles, not classes.** reframe imports inline styles. External CSS and class-based styles may not import fully.

**HTML design rules:**
- Root: `<div style="width: 1440px; min-height: 900px; font-family: Inter, sans-serif; background: #...; color: #...;">`
- Navbar: ALWAYS full-width. Use `width: 100%` or no width (stretch). Use `<a>` for nav links, not `<span>`.
- Sections: ALWAYS `width: 100%` or no explicit width. Let flex handle it.
- Never set fixed pixel widths on containers that should stretch. Use `flex: 1` or `width: 100%`.
- Hero: 120-160px padding, display text 56-72px
- Whitespace between sections: 80-120px padding
- Cards: subtle shadows, 20-32px padding, consistent radius
- Buttons: min 44px height, clear contrast, `cursor: pointer`
- Typography: min 2x size jump between hierarchy levels
- Dark themes: explicit background + text color on EVERY container

## reframe Design Language

You are a designer. Every value is a design decision. `pad: 160` = premium. `fontWeight: 300` = confident. `cornerRadius: 4` = precise. Read the DESIGN.md — it has the brand's philosophy, not just hex codes.

### Atoms
```
display(text, fontSize, fontWeight, letterSpacing, fills)  — hero text
heading(text, level:1-6)                                   — section headers
body(text, muted?, fontSize?)                              — paragraphs
label(text, fontSize?, opacity?)                           — small labels
button(text, variant:filled/outline/ghost, size:sm/md/lg)  — clickable
badge(text)  · stat(value, label)  · divider()  · link(text)
```

### Layout
```
stack(pad, gap, align:center/left, fills)     — vertical (column)
row(pad, gap, justify:between/center, align)  — horizontal
card(pad, gap, fills, cornerRadius)           — container + border/shadow
page(w:1440)                                  — root wrapper, always first
center(pad, gap)                              — centered content
grid(columns, gap)                            — CSS grid
```

### Sections (ONLY for quick prototyping — they produce generic layouts)
```
navbar · hero · features · pricing · testimonials · cta · footer · statsBar · logoBar
```
⚠️ For real designs, BUILD sections yourself from primitives. Sections look identical every time.
Instead of `{ type: "hero" }`, compose: `stack(pad:[140,80], gap:32, align:center, fills:["#09090b"]) > display + body + row > buttons`

### Key Props
```
pad: [vertical, horizontal] or number    — inner spacing
gap: number                              — between children
fills: ["#hex"]                          — background
layoutGrow: 1                            — stretch to fill available space
align: "center"                          — center children (cross-axis)
justify: "between" | "center"            — distribute (main-axis)
cornerRadius: number                     — rounded corners
effects: [{type:"DROP_SHADOW", ...}]     — shadows
states: {hover: {fills: [...]}}          — interaction states
```

### Multi-Page Site
```
1. reframe_compile({ html: "<div>...Home page HTML...</div>", name: "home" })
2. reframe_compile({ html: "<div>...Pricing page HTML...</div>", name: "pricing" })
3. reframe_compile({ html: "<div>...About page HTML...</div>", name: "about" })
4. reframe_export({ sceneId: "s1", format: "site" })  → bundles ALL scenes with navigation
```

### Spacing Guide
```
Hero padding:     120-160px  (premium, breathing room)
Section padding:  80-100px   (clear separation)
Card padding:     24-32px    (comfortable content)
Dashboard:        16-24px    (dense, functional)
Button padding:   12-16px vertical, 24-32px horizontal
Gap between cards: 16-24px
Gap between sections: 48-80px
Min button height: 44px (touch target)
```

## Tools (6)

### `reframe_design` — Load brand / extract design system
- `brand: 'stripe'` → loads pre-built DESIGN.md, sets session brand
- `url: 'https://...'` → extracts design system from any website
- `html: '<div>...'` → extracts from raw HTML
- `action: 'prompt'` → generates optimized system prompt from DESIGN.md

### `reframe_compile` — Design compiler
- **HTML** (primary): you write HTML+CSS → reframe imports to INode
- **Blueprint** (programmatic): JSON tree for automation/templates
- Auto-audits, auto-fixes, saves to `.reframe/exports/`

### `reframe_edit` — Modify scenes
Operations: `create`, `add`, `update`, `delete`, `clone`, `resize`, `move`, `defineTokens`, `setMode`.
Path syntax: `"NodeName"` (searches entire tree) or `"Parent/Child"`.
Both `characters` and `text` accepted for text content.

### `reframe_export` — Any format
Formats: `html`, `svg`, `react`, `animated_html`, `lottie`, `site`.
`site` bundles all scenes into clickable multi-page app with routing + transitions.
All exports auto-save to `.reframe/exports/`.

### `reframe_inspect` — Feedback loop
- No sceneId → session overview
- With sceneId → tree + 19-rule audit + recommendations
- See issues → fix with reframe_edit → re-inspect

### `reframe_project` — Persistence
Actions: `init`, `save`, `load`, `list`, `status`.
Scenes auto-save to `.reframe/scenes/`.

## @reframe/ui — Standard Library

120 TypeScript functions for building INode programmatically. Part of the engine, not a separate input. Used for blueprint path, automation, and `reframe build` configs. See README for full reference.

## INode Properties

**Geometry:** x, y, width, height, rotation, flipX, flipY
**Visual:** fills (`["#FF0000"]` or `[{color:"#FF0000"}]` or IPaint), opacity, cornerRadius, visible, strokes, strokeWeight, dashPattern, effects
**Text:** characters, fontSize, fontFamily, fontWeight, italic, textAlignHorizontal, textAlignVertical, lineHeight, letterSpacing, textCase, textDecoration, textTruncation, maxLines, textAutoResize
**Rich text:** styleRuns (`[{start, length, style: {fontWeight, fontSize, fillColor, italic, ...}}]`)
**Layout:** layoutMode (NONE/HORIZONTAL/VERTICAL/GRID), layoutWrap, primaryAxisAlign, counterAxisAlign, itemSpacing, counterAxisSpacing, padding (shorthand or per-side), layoutGrow, layoutAlignSelf, clipsContent
**Grid:** gridTemplateColumns, gridTemplateRows, gridColumnGap, gridRowGap, gridPosition
**Size constraints:** minWidth, maxWidth, minHeight, maxHeight
**Mask:** isMask, maskType (ALPHA/VECTOR/LUMINANCE)
**Semantic:** role (button/heading/card/nav/hero/cta/...), slot (content placeholder)
**Behavior:** states (`{ hover: { fills: [...] }, disabled: { opacity: 0.5 } }`), responsive (`[{ maxWidth: 768, props: { fontSize: 28 } }]`)
**Tokens:** Any value can be `{token: "color.primary"}` — resolves from design system

## Design Tokens

Bridge between DESIGN.md and INode. Reference `{token: 'color.primary'}` instead of `#4A9EFF`.

**Naming:** `color.<role>`, `type.<role>.size/weight/lineHeight/family`, `space.xs/sm/md/lg/xl/xxl`, `radius.sm/md/lg/full`, `button.radius`

**Operations (via reframe_edit):**
- `defineTokens` — DESIGN.md → token collection (optional `darkMode: true`)
- `setMode` — switch light/dark (re-resolves all bound values)

**Benefits:** Compliance by construction (tokens auto-pass palette audit), CSS custom properties in HTML export, dark mode switching, cross-scene consistency.

## Audit Rules (19)

**Structural (8):** text-overflow, node-overflow, min-font-size, no-empty-text, no-zero-size, no-hidden-nodes, contrast-minimum, min-touch-target
**Design system (6):** font-in-palette, color-in-palette, font-weight, font-size-role, border-radius, spacing-grid
**Layout intelligence (4):** visual-hierarchy, content-density, visual-balance, cta-visibility
**Export fidelity (1):** export-fidelity (roundtrip loss detection)

## Semantic Layer

30 roles auto-detected from node properties with confidence scoring. Exports map to semantic HTML (`<button>`, `<nav>`, `<h1>`) and ARIA attributes.

## Scene Persistence

Two IDs per scene: session ID (`s1`) and slug (`hero-dark-saas`). Both work everywhere.
Auto-saves to `.reframe/scenes/<slug>.scene.json`.

## Studio

Visual editor at `packages/studio`. Same INode tree, real-time MCP sync via SSE (port 4100).

```bash
cd packages/studio && npm run dev   # http://localhost:3000
```

## Key Files

### Core Engine
- `packages/core/src/engine/scene-graph.ts` — SceneGraph: node CRUD, clone, reparent
- `packages/core/src/engine/layout.ts` — Yoga WASM layout computation
- `packages/core/src/engine/component-registry.ts` — components: masters, variants, instances
- `packages/core/src/host/types.ts` — INode interface (80+ properties)
- `packages/core/src/builder.ts` — fluent API: frame(), text(), solid() → build() → SceneGraph
- `packages/core/src/compiler/` — content + DesignSystem → INode blueprint
- `packages/core/src/resize/` — smart adaptation engine (59 files, semantic scaling)

### Intelligence
- `packages/core/src/audit.ts` — 19 audit rules + auto-fix
- `packages/core/src/assert.ts` — design assertions (fluent API)
- `packages/core/src/diff.ts` — structural tree comparison
- `packages/core/src/semantic.ts` — role detection, HTML tag mapping, ARIA

### Design System
- `packages/core/src/design-system/` — extract, parse, export DESIGN.md
- `packages/core/src/design-system/tokens.ts` — token bridge, CSS var export

### I/O
- `packages/core/src/importers/html.ts` — HTML → INode (linkedom)
- `packages/core/src/exporters/` — HTML, SVG, PNG, React, Animated HTML, Lottie
- `packages/core/src/animation/` — timeline, 17 presets, easing
- `packages/core/src/serialize.ts` — INode ↔ portable JSON
- `packages/core/src/pipeline/` — DAG executor (parallel rounds, timeout, retry)

### UI Standard Library
- `packages/core/src/ui/` — 120 functions across 14 modules
- `packages/core/src/ui/blueprint.ts` — JSON → @reframe/ui calls (define/use decomposition)
- `packages/core/src/ui/theme.ts` — createTheme, themed, fromDesignMd, landing
- `packages/core/src/ui/defaults.ts` — centralized design tokens
- `packages/core/src/ui/render.ts` — one-liner: blueprint → build → layout → export

### Build System
- `packages/core/src/config/` — types, loader, build engine, test engine
- `packages/cli/src/commands/build.ts` — `reframe build`
- `packages/cli/src/commands/test.ts` — `reframe test`

### MCP
- `packages/mcp/src/tools/` — 6 tool handlers + auto-fix engine
- `packages/mcp/src/store.ts` — dual-ID scene store, auto-persistence
- `packages/mcp/src/session.ts` — session intelligence: cache, lifecycle, advisor
- `packages/mcp/src/http-server.ts` — HTTP sidecar: SSE, REST, Studio sync
