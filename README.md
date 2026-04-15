<h3 align="center">AI-Native Design Editor</h3>
<p align="center">
  <img src=".github/logotype.png" alt="Reframe" width="100%">
</p>
<p align="center">Design · Audit · Transform · Export — powered by INode AST</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-7c3aed?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-43853d?style=flat-square" alt="node">
  <img src="https://img.shields.io/badge/MCP-7_tools-ff6b6b?style=flat-square" alt="MCP tools">
  <img src="https://img.shields.io/badge/audit-37_rules-10b981?style=flat-square" alt="audit rules">
  <img src="https://img.shields.io/badge/exports-8_formats-f59e0b?style=flat-square" alt="export formats">
  <img src="https://img.shields.io/badge/viewport-CanvasKit_(Skia)-e11d48?style=flat-square" alt="CanvasKit viewport">
  <img src="https://img.shields.io/badge/blocks-17_templates-8b5cf6?style=flat-square" alt="block templates">
  <img src="https://img.shields.io/badge/aesthetic-8_metrics-06b6d4?style=flat-square" alt="aesthetic metrics">
  <img src="https://img.shields.io/badge/brand-.md_guides-6366f1?style=flat-square" alt="brand guides">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#mcp-pipeline">MCP Pipeline</a> · <a href="#inode--the-design-ast">INode AST</a> · <a href="#platform">Platform</a> · <a href="wiki/">Wiki Knowledge Base</a> · <a href="#license">License</a>
</p>

---

<table>
<tr>
<td>

**🚀 v0.1.0 — developer preview**

An AI-native design editor with production-quality engine. Interactive CanvasKit viewport (via [`@open-pencil/core`](https://github.com/open-pencil/open-pencil)) + 37-rule quality audit + 8 export formats. **INode is to structured content what AST is to code.**

Three input modes: **AI Agent** writes HTML → engine compiles. **Constructor** picks sections from 17 block templates. **Direct editing** on Figma-like canvas (selection, drag, resize, text edit). All converge on one CanvasKit viewport. **7 MCP tools** drive AI agents in Claude Code, Cursor, and any MCP-compatible client. 60+ brand design systems via [`getdesign`](https://www.npmjs.com/package/getdesign) npm. W3C DTCG token interop. .fig file import/export. Headless REST API for batch rendering and CI/CD. Platform UI at `:4100/platform`. Git-tracked [wiki/](wiki/) with 30 pages of architecture and patterns.

</td>
</tr>
</table>

<br>

### Core Features

| | | |
|:---:|:---:|:---:|
| **🎨 Interactive Canvas** | **🤖 AI-Native Pipeline** | **⚡ 10 Export Formats** |
| CanvasKit (Skia WASM) viewport via @open-pencil/core. Selection, drag, resize, text edit, zoom/pan, snap guides, undo/redo. .fig import/export. | 7 MCP tools. AI writes HTML → engine compiles + audits + exports. Constructor assembles from 17 block templates. Direct editing on canvas. | One graph → HTML, React, SVG, PNG, PDF, Lottie, Animated HTML, Site. Plus W3C DTCG tokens. |
| **✅ 37-Rule Audit + Quality** | **🔄 Deterministic Transforms** | **👁 Unified Platform** |
| Contrast, accessibility, brand compliance, spacing, 8 aesthetic metrics, brand fidelity scoring. Auto-fix pipeline. | Rebrand, resize, vary — no AI. Tokens, compile, lint — deterministic. Same inputs → same outputs, always. | Three input modes (AI / Blocks / Direct) → one canvas → one platform at `:4100/platform`. Dashboard, viewport, panels. |

---

## What is Reframe?

An AI-native design editor with a production-quality engine underneath. AI designs, human directs, engine guarantees quality.

The core insight: **INode is to visual design what AST is to code.** A typed, traversable tree that enables programmatic operations — audit, transform, export — the same way ESLint/Prettier/Babel work on code ASTs.

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   THREE INPUT MODES ──→ ONE CANVAS ──→ ONE ENGINE ──→ ANY OUTPUT     │
│                                                                      │
│   ┌─────────────┐                                                    │
│   │ 1. AI Agent  │  "Build a fintech landing page"                   │
│   │   HTML/CSS   ├──┐                                                │
│   └─────────────┘  │                                                 │
│   ┌─────────────┐  │    ┌─────────────────────┐                     │
│   │ 2. Blocks   │  ├──→ │   INode SceneGraph   │                     │
│   │  17 sections │  │    │   (Figma-compatible)  │                    │
│   └─────────────┘  │    │                       │                    │
│   ┌─────────────┐  │    │  @reframe/core:       │    ┌────────────┐ │
│   │ 3. Canvas   │  │    │   37-rule audit       │    │  EXPORT    │ │
│   │  Figma-like  ├──┘    │   design tokens       │──→ │  12 fmts  │ │
│   │  (OpenPencil)│       │   resize/adapt        │    │  html     │ │
│   └─────────────┘       │   brand fidelity      │    │  react    │ │
│                          │   8 aesthetic metrics  │    │  svg/png  │ │
│   ┌─────────────┐       │                       │    │  pdf      │ │
│   │ BRAND       │       │  @open-pencil/core:   │    │  lottie   │ │
│   │ 60+ systems ├──────→│   CanvasKit viewport  │    │  .fig     │ │
│   │ getdesign   │       │   .fig import/export  │    │  site     │ │
│   └─────────────┘       │   selection/drag/zoom │    │  animated │ │
│                          │   undo/redo/snap     │    └────────────┘ │
│   ┌─────────────┐       │   P2P collab (WebRTC) │                   │
│   │ MCP (7 tools)├──────→│                       │                   │
│   │ AI pipeline  │       └─────────────────────┘                    │
│   └─────────────┘                                                    │
│                                                                      │
│   PLATFORM @ :4100/platform                                          │
│   ┌─────────┬──────────────────────────┬──────────────┐             │
│   │ Layers  │   CanvasKit Viewport     │ Props/Blocks │             │
│   │ (tree)  │   select · drag · zoom   │ AI/Audit     │             │
│   │         │   resize · text edit     │ Design/Export │             │
│   ├─────────┴──────────────────────────┴──────────────┤             │
│   │ [Ask AI to design something...         ] 100%     │             │
│   └───────────────────────────────────────────────────┘             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

> **Three doors, one room.** AI writes HTML → engine compiles. User picks blocks → engine assembles. User drags on canvas → engine updates. All paths converge on the same INode SceneGraph. Same audit, same tokens, same export.

---

## Why

Design has no compiler. Code has ESLint, Prettier, TypeScript — parse, validate, transform, output. Design has Figma (proprietary), Canva (locked), and raw HTML (no validation).

**Reframe is the missing layer.** AI generates the design, engine guarantees the quality.

```
  AI GENERATES   brief → HTML → INode SceneGraph (structured design data)
  ENGINE AUDITS  37 rules: contrast, accessibility, brand compliance, aesthetic quality
  ENGINE FIXES   auto-fix pipeline resolves issues without human intervention
  HUMAN REVIEWS  interactive CanvasKit canvas — select, edit, approve
  ENGINE EXPORTS → HTML, React, SVG, PNG, PDF, Lottie, Animated HTML, Site
```

> The human is the creative director. AI is the designer. The engine is QA. Nobody ships without passing 37 rules.

---

## Architecture

```
  ┌──────────────────────────────────────────────────────────────┐
  │                                                              │
  │  PACKAGES                                                    │
  │                                                              │
  │  @open-pencil/core (MIT, npm)      @reframe/core (AGPL)     │
  │  ├ CanvasKit viewport (Skia)       ├ 37-rule audit engine    │
  │  ├ SceneGraph + SkiaRenderer       ├ design tokens (DTCG)    │
  │  ├ .fig read/write (Kiwi codec)    ├ resize / adapt / vary   │
  │  ├ selection / drag / resize       ├ 8 export formats       │
  │  ├ undo/redo + snap guides         ├ HTML → INode import     │
  │  ├ text editing (Paragraph API)    ├ 17 block templates      │
  │  ├ Yoga layout (flex + grid)       ├ content round-trip      │
  │  └ P2P collab (WebRTC + Yjs)      └ animation timeline      │
  │           │                              │                   │
  │           └──────────┬───────────────────┘                   │
  │                      ▼                                       │
  │  @reframe/editor (AGPL)            @reframe/mcp (AGPL)      │
  │  ├ GraphBridge (OP ↔ reframe)      ├ 7 MCP tools             │
  │  ├ CanvasKit canvas bootstrap      ├ HTTP server (:4100)     │
  │  ├ interaction (drag/marquee/snap) ├ SSE real-time events    │
  │  ├ panels: Props/Blocks/AI/        ├ REST API (render/batch) │
  │  │   Audit/Design/Export           ├ Platform UI pages       │
  │  ├ .fig drag & drop               └ session + store          │
  │  ├ AI prompt input                                           │
  │  └ MCP sync (SSE + HTTP PUT)                                 │
  │                                                              │
  │  DATA FLOW                                                   │
  │                                                              │
  │  AI prompt ──→ MCP reframe_compile ──→ INode SceneGraph      │
  │  .fig file ──→ @open-pencil/core ────→ INode SceneGraph      │
  │  Block pick ─→ reframe_project ──────→ INode SceneGraph      │
  │  Canvas edit → @open-pencil/core ────→ INode SceneGraph      │
  │                                            │                 │
  │                    ┌───────────────────────┘                  │
  │                    ▼                                          │
  │  ┌────────────────────────────────────────────────────┐      │
  │  │ ENGINE: audit → tokens → adapt → vary → export     │      │
  │  │  37 rules · 8 aesthetics · brand fidelity · DTCG   │      │
  │  └─────────────────────┬──────────────────────────────┘      │
  │                        ▼                                     │
  │  OUTPUT (8 core formats)                                      │
  │  html · react · svg · png · pdf · lottie · animated · site   │
  │  + tokens.json (DTCG) · scene.json (portable INode)          │
  │                                                              │
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
3. reframe_inspect({ sceneId: "s1" })                          → 37-rule audit (REQUIRED)
4. reframe_edit({ operations: [{ op: "update", ... }] })       → fix issues
5. reframe_export({ sceneId: "s1", format: "site" })           → export
```

AI writes creative HTML using brand values from DESIGN.md. Reframe validates against 37 audit rules (colors, typography, font features, component specs, spacing, aesthetic quality), auto-fixes issues, and exports to 8 formats. Or skip HTML — use `reframe_project add_block` to assemble pages from 17 section templates.

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

7 tools. Continuous feedback loop — not a linear pipeline. Engine extended by @open-pencil/core for .fig support, interactive viewport, and 90 AI design tools.

```
compile → inspect → [edit → inspect]* → export → user reviews
                                                       │
            ↑          "make the CTA bigger"           │
            └──────────────────────────────────────────┘
            edit → inspect → export → user reviews again
```

**7 MCP tools** — one per phase of the flow:

| Tool | Purpose |
|------|---------|
| `reframe_design` | `list` 60+ brands, `extract` by slug/URL/HTML → DESIGN.md, `prompt` for AI context |
| `reframe_compile` | AI writes HTML → import to INode. 37-rule audit + auto-fix. Aesthetic quality scoring. Semantic role classification. |
| `reframe_inspect` | Tree + 37-rule audit + 8 aesthetic metrics + fix hints. Semantic skeleton. Diff mode. |
| `reframe_edit` | **Single surface for all scene mutations.** Structural: `update`/`add`/`delete`/`clone`/`resize`/`move`. Theming: `defineTokens`/`setMode`. Variations: `scaleSpacing`/`scaleRadius`/`scaleShadows`/`rotateColors`/`typographyPreset`. Advanced: `iterate` (audit+fix loop), `adapt` (responsive variants), `vary` (Cartesian grid), `instantiateBlock` (section templates), `multiColumn` (grid layout). |
| `reframe_export` | 8 formats: html, react, svg, png, pdf, lottie, animated_html (CSS/WAAPI), site |
| `reframe_project` | Save/load, history, snapshots, components, macros, brand registry, DTCG token export/import, block library (17 templates). |
| `reframe_collab` | Async agent-worker for Platform UI gesture/intent queue. Actions: `list` / `process` / `respond` / `start_session` / `sync_status`. |

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

Not a config file — a **design philosophy** in prose. Teaches AI agents how to design in your brand. Teaches the 37-rule audit engine what to enforce.

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

37 rules across 7 categories. Most auto-fix.

| Category | Rules | Auto-fix |
|----------|-------|:--------:|
| **Accessibility** | contrast-minimum (WCAG AA), min-touch-target (44px), min-font-size | ✓ |
| **Structural** | text-overflow, node-overflow, content-overflow, container-underflow, sibling-overlap, no-empty-text, no-zero-size, no-hidden-nodes | partial |
| **Brand** | font-in-palette, color-in-palette, font-weight, font-size-role, border-radius, spacing-grid | ✓ |
| **Component Specs** | component-spec-compliance, font-features-compliance (OpenType), spacing-scale-compliance, state-completeness (hover states) | ✓ |
| **Design Quality** | visual-hierarchy, content-density, visual-balance, cta-visibility | — |
| **Aesthetic** | alignment, whitespace, harmony, proportion, rhythm, readability, overall (8 metrics, 0–100% scores) | — |
| **Semantic** | cta-contrast, heading-hierarchy, caption-readability, touch-target, landmark-presence | ✓ |

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
| **Dashboard** — 5 entry points: Design / Build from blocks / Rebrand / Audit / API | ✓ |
| **Pipeline stepper** — Generate → Review → Refine → Ship (click to switch context) | ✓ |
| **Project canvas** — pan/zoom workspace, all variants at native size | ✓ |
| **Right panel** — 6 tabs: Sections / Design / Rebrand / Vary / Quality / Tokens | ✓ |
| **Brand picker** — toolbar dropdown, instant rebrand via API | ✓ |
| **Quality tab** — 8 aesthetic metrics with visual bars and ratings | ✓ |
| **Tokens tab** — DTCG token tree with color swatches, export/import | ✓ |
| **Block library** — `/platform/blocks`, 17 templates, category filter, "Add to page" | ✓ |
| **Batch export** — `/platform/batch`, scenes × formats × brands × viewports matrix | ✓ |
| **API docs** — `/platform/api-docs`, 9 REST endpoints documented | ✓ |
| **History dropdown** — ops log + named snapshots, restore / revert-to / clear | ✓ |
| **Variations** — apply single axis or Cartesian grid from the panel | ✓ |
| Export dropdown — HTML / React / SVG / PNG / PDF / Lottie / animated / site | ✓ |
| Real-time MCP sync (SSE, debounced 300–1000ms per channel) | ✓ |

### Platform Vision

```
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   DASHBOARD — "What do you want to create?"                          ║
║                                                                      ║
║   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                ║
║   │  🎨 Design  │  │  🧱 Build   │  │  🔄 Rebrand │                ║
║   │  AI writes  │  │  Pick from  │  │  Paste HTML  │                ║
║   │  full page  │  │  17+ blocks │  │  apply brand │                ║
║   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                ║
║          │                │                │                         ║
║   ┌──────┴────┐    ┌──────┴────┐    ┌──────┴────┐                   ║
║   │ 📊 Audit  │    │ 🔌 API   │    │ 📦 Batch  │                   ║
║   │ Quality   │    │ REST +   │    │ N brands  │                   ║
║   │ check     │    │ Headless │    │ × formats │                   ║
║   └───────────┘    └──────────┘    └───────────┘                   ║
║                                                                      ║
║   ── Recent projects ──                                              ║
║   [stripe 72%]  [pricing 65%]  [hero 85%]  ← quality badges        ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║   WORKSPACE — Brief → Generate → Review → Ship                      ║
║               ═══════  ─────────  ─────────  ──────                  ║
║                                                                      ║
║   ┌─ Pipeline Stepper ──────────────────────┐                        ║
║   │  [1 Generate]  →  [2 Review]  →  [3 Refine]  →  [4 Ship]  │    ║
║   │   active          quality tab    rebrand tab    export     │    ║
║   └─────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
║   ┌─────────────────────────────────┐  ┌──────────────────────┐     ║
║   │                                 │  │  Brand: [Stripe ▼]   │     ║
║   │        LIVE PREVIEW             │  │                      │     ║
║   │        (canvas / artboards)     │  │  Quality: 72% ●      │     ║
║   │                                 │  │  Alignment    44%    │     ║
║   │   ┌─────────┐  ┌─────────┐     │  │  Harmony     100%    │     ║
║   │   │ scene 1 │  │ scene 2 │     │  │  Rhythm      100%    │     ║
║   │   │ 1440×   │  │ 768×    │     │  │  Readability  65%    │     ║
║   │   └─────────┘  └─────────┘     │  │                      │     ║
║   │                 [72%] badge     │  │  Tabs:               │     ║
║   │                                 │  │  Sections │ Design   │     ║
║   └─────────────────────────────────┘  │  Rebrand  │ Vary     │     ║
║                                        │  Quality  │ Tokens   │     ║
║   ┌─ Variant Strip ────────────────┐   └──────────────────────┘     ║
║   │ ┌──────┐┌──────┐┌──────┐┌────┐│                                 ║
║   │ │ base ││ d0.8 ││ pill ││dark││   ← click to promote            ║
║   │ │ 72%  ││ 68%  ││ 65%  ││70% ││   ← quality scores              ║
║   │ └──────┘└──────┘└──────┘└────┘│                                  ║
║   └────────────────────────────────┘                                 ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║   BLOCK CONSTRUCTOR (🧱 Build flow)                                  ║
║                                                                      ║
║   ┌─ Block Library (/platform/blocks) ─────────────────────────┐    ║
║   │                                                             │    ║
║   │  Categories: hero │ features │ pricing │ testimonials │     │    ║
║   │               cta │ stats │ team │ faq │ footer │ nav │     │    ║
║   │               contact │ gallery                              │    ║
║   │                                                             │    ║
║   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │    ║
║   │  │hero-centered │ │hero-split    │ │hero-gradient │       │    ║
║   │  │ 3 slots      │ │ 3 slots      │ │ 3 slots      │       │    ║
║   │  │[Add to page] │ │[Add to page] │ │[Add to page] │       │    ║
║   │  └──────────────┘ └──────────────┘ └──────────────┘       │    ║
║   │                                                             │    ║
║   │  FUTURE: pick type → engine shows 4 variants →             │    ║
║   │          user picks best → inserts into page                │    ║
║   │          (Midjourney pattern for sections)                   │    ║
║   └─────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║   HEADLESS API (/api/*)                                              ║
║                                                                      ║
║   GET  /api/render/{id}?format=png&brand=stripe&scale=2             ║
║   POST /api/render/batch  { formats[], brands[], viewports[] }      ║
║   GET  /api/tokens/{id}?format=dtcg    ← W3C Design Tokens         ║
║   POST /api/tokens/{id}                ← import .tokens.json        ║
║   GET  /api/audit/{id}?aesthetic=true  ← 37 rules + 8 metrics      ║
║   GET  /api/blocks?category=hero       ← browse 17+ blocks         ║
║   POST /api/blocks/instantiate         ← block → scene             ║
║   GET  /api/scenes                     ← list all                   ║
║   GET  /thumbnail/{id}.png             ← CanvasKit raster          ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║   EXPORT — 8 formats                                                ║
║                                                                      ║
║   html ····· semantic, CSS vars, hover/responsive                    ║
║   react ···· TSX, TypeScript, @media queries                         ║
║   svg ······ vector with text preserved                              ║
║   png ······ CanvasKit raster (@1x, @2x retina)                     ║
║   pdf ······ print-ready document                                    ║
║   lottie ··· native mobile/web animations                            ║
║   animated · CSS @keyframes or WAAPI with springs                    ║
║   theatre ·· Theatre.js project for timeline editing                 ║
║   site ····· multi-page app with routing + transitions               ║
║   transition responsive preview (desktop ↔ mobile morph)             ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║   UNIVERSAL FLOW — every scenario follows this pattern:              ║
║                                                                      ║
║   SOURCE ────→ TRANSFORM ────→ QUALITY ────→ DELIVER                 ║
║                                   ↑    │                             ║
║                                   └────┘  loop until pass            ║
║                                                                      ║
║   SOURCE:     HTML │ Blocks │ Figma │ URL │ DESIGN.md                ║
║   TRANSFORM:  Tokens │ Rebrand │ Variations │ Adapt │ Animate        ║
║   QUALITY:    37 audit rules + 8 aesthetic metrics                    ║
║   DELIVER:    8 export formats + REST API + batch pipeline          ║
║                                                                      ║
║   The AI is the designer. The human is the art director.             ║
║   The engine is the factory.                                         ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

#### Roadmap

- Variant strip with quality scores below canvas
- Block variant generation (pick section type → multiple options → choose)
- Page constructor with section reordering
- Storyboard view for multi-page flows

### Snapshots

The history dropdown doubles as a git-lite: `/platform/api/history/save` captures a full `serialize(scene)` into an in-memory store (LRU 30 per scene, `packages/mcp/src/snapshots.ts`). `/restore` deserializes back into the session. `/revert-to` walks the ops log backwards and replays inverse props atomically — no need to save a snapshot before every edit.

---

## Animation

> **Beta** — functional, actively improving.

23 presets + custom keyframes + spring physics. Export as CSS @keyframes, WAAPI (Web Animations API with springs), Lottie JSON, or Theatre.js project.

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
| **Automated QA** | 37 audit rules + 8 aesthetic quality metrics. Auto-fix. Runs in CI. |
| **Multi-format export** | One design → 8 formats (HTML, React, SVG, PNG, PDF, Lottie, animated, Theatre.js, site, transition) |
| **AI-native pipeline** | 7 MCP tools — any AI agent can design, validate, export |
| **Brand compliance** | DESIGN.md = brand philosophy. 60+ brands via npm. W3C DTCG token interop. |
| **Section blocks** | 17 templates (hero, pricing, features, etc.). Assemble pages from blocks. |
| **Deterministic resize** | Semantic re-layout — no AI, pure computation |
| **Design as code** | Version-controlled, testable, composable |

> **The analogy:** ESLint doesn't replace your editor — it validates your code. Reframe doesn't replace your design tool — it validates, adapts, and exports your design.

---

## Architecture

```
packages/
│
├── core/       @reframe/core
│               INode AST · SceneGraph · layout engine (Yoga WASM / Taffy)
│               audit (37 rules, auto-fix) · aesthetic scoring (8 metrics)
│               importers (HTML, SVG, Figma) · blocks (17 templates)
│               exporters (HTML, React, SVG, PNG, PDF, Lottie,
│                          animated CSS/WAAPI, Theatre.js, site)
│               @reframe/ui (120 functions) · semantic layer · diff
│               design-system parser + brand inheritance (component
│                          recipes: button/card/badge/input/nav)
│               tokens (WCAG-aware rebrand, light/dark, W3C DTCG)
│               variations (spacing/radius/shadows/colors/typography
│                          + Cartesian grid)
│               resize engine (5 strategies, variant auto-refresh)
│               animation (23 presets, WAAPI, Theatre.js) · assert
│               collab (CRDT sync, vector clock)
│
├── mcp/        @reframe/mcp
│               MCP server (7 tools)
│               HTTP sidecar on port 4100 (dual-stack `::` bind)
│               Platform UI (dashboard, canvas, blocks, batch, API docs)
│               Headless REST API (/api/render, /api/tokens, /api/blocks, etc.)
│               session management · auto-fix · snapshots (LRU 30/scene)
│               intent queue · brand catalog (60+ via getdesign npm)
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
