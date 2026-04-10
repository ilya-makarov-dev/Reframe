# reframe — Programmable Design Engine

YOU are the designer. reframe is your rendering engine. You write HTML+CSS, reframe compiles, validates, exports. **Be creative. Every design should feel different.**

## Build & Test

```bash
npm run build                              # build all packages
npm test                                   # run all tests
npx tsc --noEmit -p packages/core/tsconfig.json   # typecheck core
npx tsc --noEmit -p packages/mcp/tsconfig.json    # typecheck mcp
```

## MCP Pipeline (always this order)

```
1. reframe_design → load brand context
     action: "list"                         → browse 60+ brands
     action: "extract", brand: "stripe"     → full DESIGN.md (300+ lines)
     action: "extract", url: "https://..."  → extract from any site

2. reframe_compile → YOU write full HTML with inline styles, pass to compile
     html: "<div style='width:1440px'>..."  → first compile
     file: ".reframe/src/home.html"         → re-compile after editing source

3. reframe_inspect → review 23-rule audit → reframe_edit to fix → re-inspect

4. reframe_export → deliver (html/react/svg/animated_html/lottie/site)
```

## HTML Rules

- Inline styles only (no classes)
- `width` on root element (1440px for web)
- Explicit `background` + `color` on every container
- Min 44px button height (WCAG touch target)
- Apply `font-feature-settings` if brand specifies OpenType features (ss01, tnum, etc.)
- Full-width sections: no fixed px on stretching containers, use `width:100%`

## DESIGN.md = Brand Context

Agent receives the **full DESIGN.md** from `reframe_design` — 300+ lines with exact colors, typography (with OpenType features), button variants with hover states, card/badge/input/nav specs, spacing scale, shadows, do's/don'ts.

**IMPORTANT:** Read the DESIGN.md carefully. Use those exact values. The 23-rule audit validates your HTML against all of it.

Brands come from `getdesign` npm. Custom: copy `DESIGN.md.example`, fill in your values.

## Source HTML Workflow

Compile auto-saves to `.reframe/src/<name>.html`. Small fixes → `reframe_edit`. Big changes → edit source file → re-compile with `file` param.

## Architecture

```
packages/core    INode AST, SceneGraph, layout (Yoga), audit (23 rules),
                 importers, exporters, design system parser, tokens, resize
packages/mcp     MCP server (6 tools), session, auto-fix, brand catalog
packages/cli     reframe build/test, config loader
packages/studio  Visual editor (experimental)
```

## Common Gotchas

- linkedom (HTML import) does not compute CSS flex constraints — avoid deeply nested flex without explicit widths
- Audit overflow rules respect `clipsContent` — flex containers with explicit dimensions auto-clip
- `reframe_compile` shows warnings inline now — fix them before export
- Brand DESIGN.md files cached in `.reframe/brands/` — delete to re-fetch
