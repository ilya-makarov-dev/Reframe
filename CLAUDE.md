# reframe — Universal Typed-Graph Engine

Import → Graph → Audit → Transform → Export. INode is to structured content what AST is to code.
Design is the first domain. Knowledge is the second. The engine is content-agnostic.

**For design work:** YOU are the designer. Write HTML+CSS, reframe compiles, validates, exports. Be creative.
**For knowledge work:** Wiki is the knowledge graph. QUERY before work, INGEST after work.

## Build & Test

```bash
npm run build                              # build all packages
npm test                                   # run all tests
npx tsc --noEmit -p packages/core/tsconfig.json   # typecheck core
npx tsc --noEmit -p packages/mcp/tsconfig.json    # typecheck mcp
```

## Pipeline (QUERY → design → compile → inspect → edit → export → INGEST)

Wiki is part of the pipeline, not optional. Every session starts with QUERY, ends with INGEST.

```
0. QUERY wiki     → load relevant knowledge BEFORE starting work
     Read wiki/index.md → find relevant page → Read that page

1. reframe_design → load brand context
     action: "list"                         → browse 60+ brands
     action: "extract", brand: "stripe"     → full DESIGN.md (300+ lines)

2. reframe_compile → YOU write full HTML with inline styles, pass to compile
     html: "<div style='width:1440px'>..."  → first compile
     file: ".reframe/src/home.html"         → re-compile after editing source

3. reframe_inspect → review 23-rule audit → reframe_edit to fix → re-inspect

4. reframe_export → deliver (html/react/svg/animated_html/lottie/site)

5. INGEST wiki    → record non-obvious learnings AFTER work is done
     Edit wiki/engine/audit.md → append entry at end
     Edit wiki/log.md → append log line
```

**Step 0 is mandatory.** Before writing HTML, debugging, rebranding — read relevant wiki pages first. Don't re-derive what's already known.

**Step 5 is mandatory.** If you learned something non-obvious (a gotcha, a pattern, a fix), write it into the relevant wiki page. If the session was routine and nothing surprising happened, skip.

## Tools (7 registered)

```
reframe_design     brand load/list/extract (local or npx getdesign)
reframe_compile    HTML → INode scene + audit + auto-fix
reframe_inspect    tree + 23-rule audit + diff + semantic skeleton
reframe_edit       ALL mutations — structural + theming + variations
reframe_export     html / react / svg / lottie / animated_html / site
reframe_project    persistence — save/load/history/snapshots/components/macros/brands
reframe_collab     EXPERIMENTAL — async intent queue worker stub
```

## Wiki — Knowledge Graph (Karpathy model)

`wiki/` is a git-tracked Obsidian knowledge graph. **No MCP tool — just Read/Write files directly.**

**QUERY (before work):** Read `wiki/index.md` → find relevant page → Read it.
**INGEST (after work):** Edit relevant wiki page → append entry at end → Edit `wiki/log.md`.
**RAW (research):** User drops files in `wiki/raw/` → you Read them → extract knowledge → Write to wiki pages.

**When to QUERY:**
- About to compile HTML → Read wiki/engine/compiler.md
- About to rebrand → Read wiki/engine/tokens.md
- About to debug audit → Read wiki/engine/audit.md
- Working with brand X → Read wiki/brands/brands-overview.md
- Any uncertainty → read wiki first, act second

**When to INGEST:**
- Discovered a non-obvious fix → append to relevant engine/ page
- Design pattern that worked → append to relevant craft/ page
- First deep use of a brand → create wiki/brands/{slug}.md
- Engine behavior not obvious from code → append to relevant page

**Entry format:**
```
## [Short title]
**Context:** what was happening
**Learning:** the non-obvious thing. Link related: [[other-page]]
**Applies when:** when to use this
```

**When NOT to ingest:** routine operations, what code comments explain, session state.

### Processing raw materials

When the user drops files in `wiki/raw/` (articles, messages, research):
1. Read the raw material
2. Extract non-obvious knowledge
3. Write into the right wiki page (vision/, engine/, craft/, decisions/)
4. Append to wiki/log.md
5. The raw file stays as source of truth, wiki gets the compiled knowledge

### Wiki sections

| Section | What's there |
|---|---|
| `wiki/vision/` | Why reframe exists, principles, roadmap, research |
| `wiki/architecture/` | How it works: INode, pipeline, design-system, platform, tools, aesthetic, animation, ops, host, builder, ui-library, resize-internals, content-compiler |
| `wiki/engine/` | What breaks: compiler, audit, tokens, resize, export gotchas |
| `wiki/craft/` | What works: layout, typography, color, components, responsive, motion |
| `wiki/brands/` | Brand archetypes and per-brand intelligence |
| `wiki/contributing/` | How-to: quickstart, architecture-map, common-tasks |
| `wiki/decisions/` | Key decisions with rationale |
| `wiki/raw/` | Gitignored: drop articles, messages, research here |

Full catalog: `wiki/index.md`. Open `wiki/` in Obsidian for graph view.

## reframe_edit — the one place for mutations

```
Structural:     update, add, delete, clone, resize, move
Theming:        defineTokens, setMode
Variation:      scaleSpacing, scaleRadius, scaleShadows,
                rotateColors, typographyPreset
Flow:           iterate (audit+fix loop),
                adapt   (responsive size variants),
                vary    (Cartesian brand × density × radius × … grid)
```

## HTML Rules

- Inline styles only (no classes)
- `width` on root element (1440px for web)
- Explicit `background` + `color` on every container
- Min 44px button height (WCAG touch target)
- Apply `font-feature-settings` if brand specifies OpenType features (ss01, tnum, etc.)
- Full-width sections: no fixed px on stretching containers, use `width:100%`

## DESIGN.md = Brand Context

Agent receives the **full DESIGN.md** from `reframe_design` — 300+ lines with exact colors, typography, button variants, card/badge/input/nav specs, spacing scale, shadows.

**IMPORTANT:** Read the DESIGN.md carefully. Use those exact values. The 23-rule audit validates against it.

## Common Gotchas

- linkedom (HTML import) does not compute CSS flex constraints — avoid deeply nested flex without explicit widths
- Audit overflow rules respect `clipsContent` — flex containers with explicit dimensions auto-clip
- `reframe_compile` shows warnings inline now — fix them before export
- Brand DESIGN.md files cached in `.reframe/brands/` — delete to re-fetch
- Token export: `defineTokens` auto-saves `.reframe/tokens.json` (DTCG format)
- Block library: 17 starter blocks auto-registered on first `list_blocks` or `add_block`
- Aesthetic scoring: 8 metrics (alignment, whitespace, balance, harmony, hierarchy, rhythm, readability, proportion)
- PNG/PDF export: requires CanvasKit WASM (auto-initialized on first call)
- Layout backend: default Yoga, switchable to Taffy via `setLayoutBackend('taffy')` before `initYoga()`
