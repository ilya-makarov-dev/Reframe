<h3 align="center">The Programmable Design Engine</h3>
<p align="center">
  <img src=".github/logotype.png" alt="Reframe" width="100%">
</p>
<p align="center">Parse · Validate · Transform · Export</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-7c3aed?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-43853d?style=flat-square" alt="node">
  <img src="https://img.shields.io/badge/MCP-7_tools-ff6b6b?style=flat-square" alt="MCP tools">
  <img src="https://img.shields.io/badge/audit-23_rules-10b981?style=flat-square" alt="audit rules">
  <img src="https://img.shields.io/badge/exports-7_formats-f59e0b?style=flat-square" alt="export formats">
  <img src="https://img.shields.io/badge/brand-.md_guides-6366f1?style=flat-square" alt="brand guides">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#mcp-pipeline">MCP Pipeline</a> · <a href="#inode--the-design-ast">INode AST</a> · <a href="#platform">Platform</a> · <a href="#how-its-different">Comparison</a> · <a href="#license">License</a>
</p>

---

<table>
<tr>
<td>

**🚀 v0.1.0 — developer preview**

Not a release yet — the engine is close to feature-complete but still stabilising. HTML import, 23-rule audit with auto-fix, semantic resize, and 7 export formats run end-to-end and make a solid demo; APIs may still shift before a tagged release. **6 core + 1 experimental MCP tools** drive AI agents in Claude Code, Cursor, and any MCP-compatible client — consolidated down from 12 after iterate/resize/vary moved inside `reframe_edit` as ops. 60+ brand design systems available via [`getdesign`](https://www.npmjs.com/package/getdesign) npm, with **full brand inheritance** (rebrand applies component recipes, not just colors). Platform UI at `:4100/platform` is a **pan/zoom canvas workspace** — projects group variants, every scene sits on one infinite board, and history/snapshots replace manual save-state juggling.

</td>
</tr>
</table>

<br>

### Core Features

| | | |
|:---:|:---:|:---:|
| **🎨 Design AST** | **🤖 AI-Native Pipeline** | **⚡ Multi-Target Output** |
| INode — 80+ properties. Universal format for visual design. Open, portable, version-controlled. | 7 MCP tools (6 core + 1 experimental). AI writes HTML, Reframe validates, adapts, exports. Works with any MCP client. | One design → HTML (hybrid SVG for vectors), React, SVG, PNG, Lottie, Animated HTML, Multi-page Site. |
| **✅ 23-Rule Audit** | **🔄 Deterministic Resize** | **👁 Platform** |
| Contrast, accessibility, brand compliance, component specs, font features, spacing scale. Auto-fix most issues. Put in CI. | Not scaling — re-layout. Classifies elements, remaps to guide templates. Milliseconds. No AI. | Pan/zoom canvas at `:4100/platform`. All variants on one board, right panel Layers/Props/Audit/Variations, ops history + snapshots. |

---

## What is Reframe?

Reframe does for design what compilers do for code. An intermediate representation (**INode**), a validation layer (**23 audit rules**), an adaptation engine (**semantic resize**), and multi-target output.

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│   BRAND                                                                │
│   ─────                                                                │
│   getdesign npm ──→ DESIGN.md ───────┐  60+ brands                     │
│   Your own ───────→ DESIGN.md ───────┤  (copy .example)                │
│   Extract URL ────→ DESIGN.md ───────┘  (reverse-engineer any site)    │
│                         │                                              │
│                         ▼                                              │
│               ┌────────────────────┐                                   │
│               │  Design System     │  colors · typography              │
│               │  Parser (fuzzy)    │  OpenType · shadows               │
│               │  + Inheritance     │  button/card/badge/               │
│               │  + Tokens (WCAG)   │  input/nav component specs        │
│               └─────────┬──────────┘                                   │
│                         │                                              │
│   IMPORT                │                  REVIEW                      │
│   ──────                │                  ──────                      │
│   AI Agent ──── HTML ───┤              ┌── Platform canvas             │
│   Developer ─ @reframe/ui ──→ INode ◄──┤   (:4100/platform)            │
│   Re-compile ─ src/*.html ─┤    AST    │   pan · zoom · right panel    │
│                         │  (SceneGraph)│   Layers/Props/Audit/         │
│                         │               │   Variations · history       │
│                         │               │                              │
│                         │               └── reframe_collab ┄ intent    │
│                         │                    (experimental) ┄ queue    │
│                         │                                              │
│   ENGINE                │                                              │
│   ──────      ┌─────────┼─────────┬─────────┬─────────┐               │
│               ▼         ▼         ▼         ▼         ▼               │
│          ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐          │
│          │ Audit  ││ Adapt  ││ Tokens ││ Vary   ││ Inherit│          │
│          │23 rules││resize +││ CSS +  ││ grid   ││ brand  │          │
│          │auto-fix││variants││ bind   ││ axes   ││ recipes│          │
│          └───┬────┘└───┬────┘└───┬────┘└───┬────┘└───┬────┘          │
│              └─────────┴─────────┼─────────┴─────────┘                │
│                                  ▼                                     │
│   OUTPUT                                                               │
│   ──────                                                               │
│   .reframe/exports/*.html ········ static pages (hybrid SVG)           │
│   .reframe/exports/*.tsx ········· React components                    │
│   .reframe/exports/*.svg ········· vector graphics                     │
│   .reframe/exports/*.json ········ Lottie animations                   │
│   .reframe/exports/site.html ····· multi-page app                      │
│   .reframe/scenes/*.scene.json ··· portable INode (persistence)        │
│   .reframe/snapshots (in-memory) · history + named snapshots           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

> **Any input. One AST. Any output.**  
> AI agents write HTML. Developers write TypeScript with `@reframe/ui`. Platform canvas reads the same SceneGraph for review and variation work. All paths converge on INode — the engine validates, adapts, and exports to any format.

---

## Why

Design has no compiler. Code has GCC, ESLint, Prettier, TypeScript — tools that parse, validate, transform, and output. Design has Figma (proprietary), Photoshop (opaque), and HTML (mixes structure with style).

**Reframe is the missing layer.**

```
  PARSE        any design → structured data (INode AST)
  VALIDATE     23 rules: contrast, accessibility, brand, component specs. Auto-fix.
  TRANSFORM    resize, tokens, dark mode, responsive
  OUTPUT       → HTML, React, SVG, PNG, Lottie, Animated, Site
```

> Put `reframe build` in CI — designs that violate brand guidelines don't ship.

---

## Data Flow

```
  ┌──────────────────────────────────────────────────────────────┐
  │ 0. BRAND                                                     │
  │    getdesign npm ─→ DESIGN.md (60+ brands)                   │
  │    Custom ────────→ DESIGN.md.example (parser-annotated)     │
  │    Extract URL ───→ reverse-engineer any site                │
  │                                                              │
  │ 1. IMPORT                                                    │
  │    AI Agent ──→ HTML/CSS ───┐                                │
  │    Developer ─→ @reframe/ui ─┼──→ INode AST                  │
  │    Re-compile ─ file:src/*.html ─┘  80+ props · stable ids   │
  │                              ▲                               │
  │                              │ source HTML auto-saved to     │
  │                              │ .reframe/src/<name>.html —    │
  │                              │ edit → re-compile loop        │
  │                                                              │
  │ 2. ENGINE (reframe_edit = single mutation surface)           │
  │    Audit ······· 23 rules, auto-fix                          │
  │    Adapt ······· semantic resize + variant auto-refresh      │
  │    Tokens ······ defineTokens + brand inheritance recipes    │
  │    Variations ·· scaleSpacing/Radius/Shadows/Colors/Type     │
  │    Vary grid ··· Cartesian brand × density × radius × …      │
  │    History ····· ops log + snapshots + revert-to             │
  │                                                              │
  │ 3. REVIEW (same AST, second door)                            │
  │    Platform canvas @ :4100/platform                          │
  │      · pan/zoom all project variants at native size          │
  │      · right panel: Layers/Props/Audit/Variations            │
  │      · history dropdown + snapshots                          │
  │    reframe_collab (experimental) ┄┄ async intent queue       │
  │                                                              │
  │ 4. EXPORT                                                    │
  │    .reframe/exports/*.html ········ static (hybrid SVG)      │
  │    .reframe/exports/*.tsx ········· React components         │
  │    .reframe/exports/*.svg ········· vector graphics          │
  │    .reframe/exports/*.json ········ Lottie animations        │
  │    .reframe/exports/site.html ····· multi-page app           │
  │    .reframe/scenes/*.scene.json ··· portable INode           │
  └──────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### For AI Agents — MCP

Add to your MCP client config (Claude Code, Cursor, Windsurf, Cline):

```json
{
  "mcpServers": {
    "reframe": {
      "command": "node",
      "args": ["node_modules/@reframe/mcp/dist/mcp/src/index.js"]
    }
  }
}
```

**The pipeline:**

```
1. reframe_design({ action: "list" })                          → browse 60+ brand design systems
   reframe_design({ action: "extract", brand: "stripe" })      → full DESIGN.md → .reframe/design.md
   (or url: "https://..." to extract from any website)
2. reframe_compile({ html: "<div>...</div>" })                 → AI writes HTML → INode
3. reframe_inspect({ sceneId: "s1" })                          → 23-rule audit (REQUIRED)
4. reframe_edit({ operations: [{ op: "update", ... }] })       → fix issues
5. reframe_export({ sceneId: "s1", format: "site" })           → export
```

AI writes creative HTML using brand values from DESIGN.md. Reframe validates against 23 audit rules (colors, typography, font features, component specs, spacing scale, interactive states), auto-fixes issues, and exports to any format.

### For Developers — @reframe/ui

120 composable TypeScript functions that build INode trees. The programmatic API to the same AST that MCP and Platform use.

```typescript
import { render, page, stack, row, heading, body, button, card } from '@reframe/ui';

const primary = '#7c3aed';
const plans = [
  { name: 'Free', price: '$0', features: ['5 projects', 'Community support'] },
  { name: 'Pro', price: '$29', features: ['Unlimited', 'Priority support', 'API'] },
];

const html = await render(
  page({ w: 1440 },
    stack({ pad: [140, 80], gap: 32, align: 'center', fills: ['#09090b'] },
      heading('Simple pricing', { fontSize: 48, fills: ['#fafafa'] }),
      row({ gap: 24, justify: 'center' },
        ...plans.map(p => card({ layoutGrow: 1, pad: 32, gap: 16, fills: ['#111'] },
          heading(p.name, { level: 3, fills: ['#fafafa'] }),
          heading(p.price, { level: 2, fills: [primary] }),
          ...p.features.map(f => body(`✓ ${f}`, { fontSize: 14, fills: ['#a1a1aa'] })),
          button('Get started', { variant: 'filled', color: primary }),
        )),
      ),
    ),
  ),
);
```

> **This is what makes it programmable** — variables, loops, conditionals, themes.  
> Figma can't loop. HTML can't be validated. `@reframe/ui` is code that produces verified design.

### For CI/CD

```yaml
# .github/workflows/design.yml
- run: npx reframe build   # compile all scenes from config
- run: npx reframe test    # assert design rules pass
```

---

## INode — The Design AST

INode is to visual design what the DOM is to documents — a universal, structured representation. Every visual tool uses the same primitives. INode makes them explicit and programmable.

```typescript
interface INode {
  // Identity
  type: 'FRAME' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'GROUP' | 'VECTOR';
  name: string;

  // Geometry
  x, y, width, height, rotation: number;

  // Visual
  fills: Paint[];              // solid, gradient, image
  strokes: Paint[];            // borders
  effects: Effect[];           // drop shadow, inner shadow, blur
  cornerRadius: number;
  opacity: number;

  // Layout (CSS Flexbox + Grid)
  layoutMode: 'HORIZONTAL' | 'VERTICAL' | 'GRID' | 'NONE';
  primaryAxisAlign: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlign: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  itemSpacing: number;
  padding: { top, right, bottom, left };
  layoutGrow: number;          // flex-grow

  // Typography
  characters: string;
  fontSize, fontWeight: number;
  fontFamily: string;
  lineHeight, letterSpacing: number;
  fontFeatureSettings: string[]; // OpenType: ['ss01', 'tnum']
  styleRuns: StyleRun[];       // rich text

  // Behavior
  states: { hover: {...}, active: {...}, focus: {...} };
  responsive: [{ maxWidth: 768, props: { fontSize: 28 } }];

  // Semantic
  semanticRole: 'button' | 'heading' | 'nav' | 'hero' | 'cta';
  href: string;                // navigation target
}
```

**Adapters** bridge INode to external tools. The Standalone adapter runs headless (Node.js, MCP, CI). The Figma adapter maps INode ↔ SceneNodes. Write an adapter (~200 lines) and any design tool speaks the same language.

---

## MCP Pipeline

7 tools (6 core + 1 experimental). Continuous feedback loop — not a linear pipeline.

```
compile → inspect → [edit → inspect]* → export → user reviews
                                                       │
            ↑          "make the CTA bigger"           │
            └──────────────────────────────────────────┘
            edit → inspect → export → user reviews again
```

**7 MCP tools** — one per phase of the flow, plus one experimental async surface:

| Tool | Purpose |
|------|---------|
| `reframe_design` | `list` 60+ brands, `extract` by slug/URL/HTML → DESIGN.md, `prompt` for AI context |
| `reframe_compile` | AI writes HTML → import to INode. 23-rule audit + auto-fix |
| `reframe_inspect` | Tree + 23-rule audit + fix hints; `diffWith` diff; `diffTextDetail` / `diffStructuredDetail` can shorten text or 2nd JSON block to summary-only counts |
| `reframe_edit` | **Single surface for all scene mutations.** Ops: `update`/`add`/`delete`/`clone`/`resize`/`move` (structural), `defineTokens`/`setMode` (theming), `scaleSpacing`/`scaleRadius`/`scaleShadows`/`rotateColors`/`typographyPreset` (style transforms), `iterate` (audit+fix loop), `adapt` (responsive size variants), `vary` (Cartesian variation grid). Replaces the former `reframe_iterate` / `reframe_resize` / `reframe_vary` tools. |
| `reframe_export` | Preview: html, react, svg, lottie, animated_html, site |
| `reframe_project` | Save/load, history, snapshots, components, macros, brand registry. Scenes persist to `.reframe/scenes/` |
| `reframe_collab` *(experimental)* | Async agent-worker stub for the Platform UI gesture/intent queue. Three actions: `list` / `process` / `respond`. Dormant in the direct flow; exists so async workflows have a surface when needed. |

### CLI vs MCP (quick map)

| Flow | CLI (`reframe` in packages/cli) | MCP (7 tools above) |
|------|----------------------------------|----------------------|
| Import / build | `reframe build`, configs | `reframe_compile`, `reframe_edit` |
| Audit / tree | `reframe test`, export-svg | `reframe_inspect` |
| Export | `reframe build` outputs | `reframe_export` |
| Brand / tokens | project + `.reframe/design.md` | `reframe_design`, `defineTokens` in edit |
| Persistence | `.reframe/` on disk | `reframe_project` + session store |

Same engine (`packages/core`): MCP tools call into compile, audit, serialize, exporters — matching the CLI where they share code paths.

Export is not the final step — it's a **preview**. User sees the result, gives feedback, AI edits, inspects, exports again. The loop continues until the user is happy.

Inspect gives **edit commands**, not just errors:
```
[!] contrast 2.57:1 for "Product"
    → reframe_edit: update "Product" props: { fills: ["#fafafa"] }
```

### Multi-Page Sites

```
reframe_compile({ html: "...", name: "home" })
reframe_compile({ html: "...", name: "pricing" })
reframe_compile({ html: "...", name: "about" })
reframe_export({ sceneId: "s1", format: "site" })
```

> Produces a single HTML file: hash routing, page transitions, auto-linked navigation, active nav state.

---

## DESIGN.md — Brand as Code

Not a config file — a **design philosophy** in prose. Teaches AI agents how to design in your brand. Teaches the 23-rule audit engine what to enforce.

60+ curated brand design systems are available via [`getdesign`](https://www.npmjs.com/package/getdesign) npm package — load any of them with one MCP call:

```
reframe_design({ action: "list" })                    → browse all brands
reframe_design({ action: "extract", brand: "stripe" }) → full 300-line DESIGN.md
```

Each DESIGN.md covers **9 sections**: Visual Atmosphere, Color Palette, Typography Rules (with OpenType features), Component Stylings (button variants, cards, badges, inputs, nav), Layout Principles (spacing scale, radius scale), Depth & Elevation (multi-layer shadows), Do's and Don'ts, Responsive Behavior, Agent Prompt Guide.

```markdown
## 3. Typography Rules
### Font Family
- **Primary**: `sohne-var`, fallbacks: `SF Pro Display`
- **OpenType Features**: `"ss01"` on all text; `"tnum"` for tabular numerals

### Hierarchy
| Role | Size | Weight | Line Height | Letter Spacing | Features |
|------|------|--------|-------------|----------------|----------|
| Display Hero | 56px | 300 | 1.03 | -1.4px | ss01 |
| Body | 16px | 300 | 1.40 | normal | ss01 |

## 4. Component Stylings
### Buttons
**Primary** — bg `#533afd`, text `#fff`, radius 4px, hover `#4434d4`
**Ghost** — transparent, border `#b9b9f9`, hover `rgba(83,58,253,0.05)`
```

The parser extracts everything: colors, typography with font features, button variants with hover states, card/badge/input/nav specs, spacing scale, gradients, multi-layer shadows. The audit validates the agent's HTML against all of it.

**Create your own:** Copy [`DESIGN.md.example`](DESIGN.md.example), fill in your brand values, and the engine parses it automatically. The template covers all 9 sections — colors, typography (with OpenType features), components (buttons/cards/badges/inputs/nav with hover states), spacing, shadows, responsive behavior, and design rules.

---

## Audit Engine

23 rules across 6 categories. Most auto-fix.

| Category | Rules | Auto-fix |
|----------|-------|:--------:|
| **Accessibility** | contrast-minimum (WCAG AA), min-touch-target (44px), min-font-size | ✓ |
| **Structural** | text-overflow, node-overflow, no-empty-text, no-zero-size, no-hidden-nodes | partial |
| **Brand** | font-in-palette, color-in-palette, font-weight, font-size-role, border-radius, spacing-grid | ✓ |
| **Component Specs** | component-spec-compliance (button/card/badge/input radius, height), font-features-compliance (OpenType), spacing-scale-compliance, state-completeness (hover states) | ✓ |
| **Design Quality** | visual-hierarchy, content-density, visual-balance, cta-visibility | — |
| **Export** | export-fidelity | — |

---

## Universal Resize — `adapt` op

> **Preview.** Works end-to-end on common patterns, still maturing on edge cases.

Deterministic layout adaptation — no AI, no guessing. The engine classifies elements by role, detects layout patterns, and remaps content to target dimensions. Five strategies, pick per call: **smart** (default — classify + reflow), **contain** / **cover** (aspect-preserving), **stretch** (raw proportional), **reflow** (pure flex re-pack).

```
1920×1080 hero  →  classify (title, button, background)
                →  detect pattern (full_bleed_hero)
                →  select guide (728×90 template)
                →  remap elements to slots
                →  728×90 banner — re-composed, not scaled
```

Exposed as `reframe_edit { op: "adapt" }` and `reframe_project { action: "add_variant" }`. Variant scenes auto-refresh on every `reframe_compile` of the base, so source HTML edits, replayed history ops, and macro applications propagate to all breakpoints without manual re-runs.

One design → banner, social card, story, OG image, mobile/tablet/desktop. Milliseconds. Pure computation — deterministic, reproducible, no LLM needed.

---

## Brand Inheritance

`reframe_edit { op: "defineTokens", brand: "stripe" }` is the one-shot **"rebrand this scene"** pipeline. Not just color swap — full component recipe application:

```
1. Parse DESIGN.md → DesignSystem
      (colors, typography with OpenType, button/card/badge/input/nav specs)
2. Tokenize + auto-bind every node to the right token role
3. Semantic rebrand with polarity detection
      (scene-dark-on-scene-dark vs brand-dark-on-brand-light)
4. Contrast-aware text color selection
      (walks parents to find effective bg, ranks tokens by WCAG contrast)
5. applyBrandInheritance — runs component recipes on matching nodes
      (buttons get exact radius/height/padding/hover states from the spec;
       cards, badges, inputs, navs likewise)
```

Semantic classifier + `inferStructuralRole` detects FRAME nodes as buttons/cards/badges/inputs/navs from visual properties, so unclassified nodes still get their recipes. One call = "make this scene look like Spotify / Stripe / Ferrari."

---

## Variations — Deterministic Design Space

No AI. Pure transforms in `packages/core/src/variations/`. Exposed as `reframe_edit` ops and via Platform UI `/api/variations`:

| Axis | Op | Values |
|------|----|--------|
| Density | `scaleSpacing` | factor (<1 compact, >1 spacious) |
| Radius | `scaleRadius` | sharp / soft / pill / editorial / factor |
| Shadows | `scaleShadows` | flat / subtle / normal / dramatic / factor |
| Colors | `rotateColors` | invert-accent / invert-mode / [tokenA, tokenB] |
| Typography | `typographyPreset` | dramatic / flat / editorial / technical / friendly |
| Grid | `vary` | Cartesian product of all axes + brand + mode |

```
reframe_edit({ operations: [{
  op: "vary",
  sceneId: "s1",
  axes: {
    brand: ["stripe", "linear", "vercel"],
    density: [0.75, 1, 1.25],
    radius: ["sharp", "soft", "pill"]
  }
}]})  // → 27 new session scenes, one per combination
```

Same input → same output, every time. Pair with `reframe_edit { op: "adapt" }` to generate responsive variants across breakpoints (smart / contain / cover / stretch / reflow strategies).

---

## SVG Hybrid Rendering

HTML exporter now emits inline `<svg>` for vector primitives inside their wrapper `<div>`: ELLIPSE, STAR, POLYGON, LINE, VECTOR, and icon-like frames. `shouldRenderAsSvg()` + `isIconLikeFrame()` in `svg-primitives.ts` decide which nodes qualify; everything else renders as divs as before. Text stroke is preserved via SVG when a stroke is set. Opt-out with `svgDecorations: false`. Graceful fallback if anything throws.

Result: exported HTML contains crisp vector decorations — circles, stars, arrows, brand icons — instead of div hacks with border-radius.

---

## Platform

Design workspace at `http://localhost:4100/platform`. Rewritten as a **pan/zoom canvas** — projects group variants, every scene sits on one infinite board. You are the creative director — AI designs, you review.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  AI creates via MCP         You work on Platform canvas  │
│        │                              │                  │
│        ▼                              ▼                  │
│  ┌──────────┐    real-time sync   ┌────────────┐        │
│  │          │◄────── SSE ────────►│ Project    │        │
│  │  INode   │   (port 4100, ::)   │ canvas     │        │
│  │  AST     │                     │ pan / zoom │        │
│  │          │                     │ all scenes │        │
│  └────┬─────┘                     └─────┬──────┘        │
│       │                                 │                │
│       │                        ┌────────┴────────┐      │
│       ▼                        ▼                 ▼      │
│  same audit              Layers/Props/       History +  │
│  same export             Audit/Variations    snapshots  │
│  same pipeline           right panel         revert-to  │
│                                                          │
│  caches: ctx 2s · preview LRU64 · audit LRU64            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

| Feature | Status |
|---------|--------|
| **Project canvas** — pan/zoom Figma-style workspace, all variants at native size | ✓ |
| Dashboard groups scenes into projects by owner + variantOf metadata | ✓ |
| Lazy iframe artboards with auto-grow to real `scrollHeight` (no cropped windows) | ✓ |
| Floating tool palette (bottom) + zoom controls (top-right) | ✓ |
| Right panel — Layers / Properties / Audit / Variations tabs, resizable | ✓ |
| **History dropdown** — ops log + named snapshots, restore / revert-to / clear | ✓ |
| Variations API — apply single axis or Cartesian grid from the panel | ✓ |
| 8 gesture verbs — ask, echo, pin, rule, brush, resonance, lasso, time | ✓ |
| Intent system — draft, commit, process, propose, accept/reject (via `reframe_collab`) | ✓ |
| Real-time MCP sync (SSE, debounced 300–1000ms per channel) | ✓ |
| Export dropdown — HTML / React / SVG / Lottie / animated / site | ✓ |
| Dual-stack bind (`::`) · Platform context / preview / audit caches | ✓ |

### Snapshots

The history dropdown doubles as a git-lite: `/platform/api/history/save` captures a full `serialize(scene)` into an in-memory store (LRU 30 per scene, `packages/mcp/src/snapshots.ts`). `/restore` deserializes back into the session. `/revert-to` walks the ops log backwards and replays inverse props atomically — no need to save a snapshot before every edit.

---

## Animation

> **Beta** — functional, actively improving.

23 presets + custom keyframes + spring physics. Export as CSS animations or Lottie JSON.

```
reframe_export({
  sceneId: "s1",
  format: "animated_html",
  animate: {
    presets: [
      { nodeName: "Headline", preset: "fadeSlideUp", delay: 0 },
      { nodeName: "CTA", preset: "scaleIn", delay: 400 }
    ]
  }
})
```

<details>
<summary><strong>All 23 presets</strong></summary>

`fadeIn` · `fadeOut` · `slideInUp` · `slideInDown` · `slideInLeft` · `slideInRight` · `scaleIn` · `scaleOut` · `popIn` · `bounce` · `revealLeft` · `revealUp` · `pulse` · `shake` · `typewriter` · `colorShift` · `blurIn` · `fadeSlideUp` · `fadeSlideDown` · `fadeSlideLeft` · `fadeSlideRight` · `fadeScaleIn`

Stagger support for sequential animations across multiple elements.

</details>

---

## @reframe/ui — Standard Library

120 TypeScript functions. The programmatic interface to INode.

<details>
<summary><strong>Full function reference</strong></summary>

| Module | Count | Functions |
|--------|:-----:|-----------|
| Layout | 9 | `page` `stack` `row` `center` `wrap` `grid` `spacer` `container` `overlay` |
| Text | 8 | `heading` (h1-h6) `body` `label` `caption` `display` `mono` `divider` `image` |
| Interactive | 6 | `button` `link` `input` `select` `toggle` `navItem` |
| Containers | 8 | `card` `badge` `chip` `tag` `avatar` `stat` `quote` `listItem` |
| Data | 5 | `table` `tabs` `accordion` `progress` `keyValue` |
| Navigation | 4 | `sidebar` `breadcrumb` `pagination` `stepper` |
| Feedback | 6 | `modal` `toast` `tooltip` `alert` `banner` `emptyState` |
| Forms | 5 | `checkbox` `radio` `slider` `formGroup` `searchInput` |
| Sections | 9 | `heroSection` `featureGrid` `pricingSection` `testimonialSection` `ctaSection` `footerSection` `navbarSection` `logoBar` `statsBar` |
| Theme | 3 | `createTheme` `themed` `fromDesignMd` |
| Render | 2 | `render` `renderAll` |

</details>

---

## How It's Different

Reframe is not a replacement for design tools — it's infrastructure that sits between creation and production.

| What you get | How |
|-------------|-----|
| **Open format** | INode AST — not proprietary, not locked to any editor |
| **Automated QA** | 23 audit rules with auto-fix. Runs in CI. |
| **Multi-format export** | One design → 7 formats (HTML, React, SVG, PNG, Lottie, animated, site) |
| **AI-native pipeline** | MCP tools — any AI agent can design, validate, export |
| **Brand compliance** | DESIGN.md = brand philosophy. 60+ brands via npm. Audit enforces it. |
| **Deterministic resize** | Semantic re-layout — no AI, pure computation |
| **Design as code** | Version-controlled, testable, composable |

> **The analogy:** ESLint doesn't replace your editor — it validates your code. Reframe doesn't replace your design tool — it validates, adapts, and exports your design.

---

## Architecture

```
packages/
│
├── core/       @reframe/core
│               INode AST · SceneGraph · layout engine (Yoga WASM)
│               audit (23 rules, auto-fix) · importers (HTML, Figma)
│               exporters (HTML hybrid-SVG, SVG, React, Lottie,
│                          animated, site)
│               @reframe/ui (120 functions) · semantic layer · diff
│               design-system parser + brand inheritance (component
│                          recipes: button/card/badge/input/nav)
│               tokens (WCAG-aware rebrand, light/dark modes)
│               variations (spacing/radius/shadows/colors/typography
│                          + Cartesian grid)
│               resize engine (5 strategies, variant auto-refresh)
│               animation (23 presets) · assert
│
├── mcp/        @reframe/mcp
│               MCP server (6 core + 1 experimental = 7 tools)
│               HTTP sidecar on port 4100 (dual-stack `::` bind — no
│               200ms Windows localhost penalty) · Platform UI canvas
│               session management · DESIGN.md context · auto-fix
│               snapshots store (LRU 30/scene) · variations API
│               intent queue (.reframe/intents) for reframe_collab
│               brand catalog via getdesign npm (60+ brands)
│
└── cli/        @reframe/cli
                `reframe build` · `reframe test` · config loader · Figma import
```

---

## Install

**Requirements:** Node.js >= 18

```bash
git clone https://github.com/ilya-makarov-dev/reframe.git
cd reframe
npm install
npm run build
npm test
```

> npm packages (`@reframe/core`, `@reframe/mcp`, `@reframe/cli`) are not yet published to npm. Install from source for now.

---

## Contributing

Contributions welcome.

1. Fork and create a feature branch
2. Make changes with tests
3. `npm test` to verify
4. Submit a PR

By submitting a contribution, you agree that your work is licensed under the project's AGPL-3.0 license and that the project maintainer retains the right to relicense contributions under the commercial license. See [CLA.md](CLA.md).

Active contributors who make significant, sustained contributions may be invited as **core contributors** with commit access and a role in the project's direction.

**Areas where help is needed:**

- **Export targets** — SwiftUI, Flutter, Jetpack Compose, MJML (email)
- **Audit rules** — new design quality and accessibility checks
- **Brand guides** — contribute DESIGN.md for brands not yet in [`getdesign`](https://www.npmjs.com/package/getdesign)
- **HTML importer** — CSS property coverage, CSS Grid, complex selectors
- **Platform UI** — design supervision UX, gesture system
- **Adapters** — Sketch, Penpot, Canva

---

## Acknowledgments

Brand design systems are sourced from [`getdesign`](https://www.npmjs.com/package/getdesign) — an open npm package providing curated DESIGN.md specifications for 60+ brands. Reframe uses it as an optional dependency for the `reframe_design` brand catalog.

---

## License

<table>
<tr>
<td width="50%">

**Open Source — AGPL-3.0**

Free for open source. Use, modify, distribute — as long as your source is available under the same terms when deployed as a network service.

</td>
<td width="50%">

**Commercial License**

For closed-source SaaS, proprietary software, or managed services where AGPL doesn't work.

[Details →](COMMERCIAL_LICENSE.md)

</td>
</tr>
</table>

---

<p align="center">
  Created by <a href="https://github.com/ilya-makarov-dev">Ilya Makarov</a>
</p>
