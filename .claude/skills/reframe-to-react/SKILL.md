---
name: reframe-to-react
description: Use when the user wants to convert a reframe scene into production-ready React code — "export to React", "make this a component library", "refactor this into components", "give me the React code I can ship". This skill is a GUIDE layer over the deterministic engine-side exporter `reframe_export format=react reactTree=true` — it elicits the user's stack preference (shadcn / vanilla / styled / inline) and translates that into the right engine call. No LLM-rewriting of JSX; the engine does the transformation byte-deterministically.
allowed-tools:
  - "mcp__reframe__reframe_export"
  - "mcp__reframe__reframe_inspect"
  - "Read"
---

# reframe → React guide

**This skill does NOT transform code.** The engine does, deterministically. Your role is to (a) ask the user which stack they want, (b) call `reframe_export` with the right parameters, (c) help them navigate the output tree.

Why: visual fidelity is reframe's moat. LLM-rewriting of exported JSX would break determinism — same scene, different output, subtle style drift. Instead, the engine's `exportToReactTree` emits a multi-file tree deterministically (semantic-role → section files, tokens → CSS vars, entry page that composes everything). You orchestrate; the engine delivers.

## How it works

The MCP tool `reframe_export` supports a `reactTree: true` flag plus tree-mode options:

```ts
reframe_export({
  sceneId: "<id>",
  format: "react",
  reactTree: true,
  reactTarget: "inline" | "css-modules" | "tailwind" | "styled-components",
  reactExtractSections: true,     // default — split children with semanticRole
  reactExtractPrimitives: false,  // Phase 2 (scaffolded, no-op currently)
  reactExtractHooks: false,       // Phase 3 (scaffolded, no-op currently)
  reactOutputBase: "src",         // default
  reactPageSlug: "pricing",       // default: derived from scene name
  typescript: true                // default
})
```

Output: materialized to `.reframe/exports/<slug>-react/` with `src/components/sections/`, `src/pages/`, `src/styles/tokens.css`, and optional `tailwind.config.ts` sketch.

See [references/engine-options.md](references/engine-options.md) for every parameter with examples.

## Workflow

### 1. Ask the user once (the only judgment call)

```
Which React stack?
  1. Inline styles, just split to files (fastest, zero deps)
  2. Vanilla JSX + CSS modules (framework-agnostic, no runtime deps)
  3. Tailwind + shadcn/ui (best match for modern projects)
  4. Styled-components / Emotion (CSS-in-JS)
```

If the user doesn't care → default to option 2 (CSS modules) as the safest neutral.

**Current implementation status** (always surface to user):
- Options 1 + 2 fully implemented
- Options 3 + 4 scaffolded: currently fall back to inline styles, but emit the `tailwind.config.ts` sketch when target=tailwind (for Phase 2 when full Tailwind-class rendering lands)

### 2. Call the engine

Map user choice → `reactTarget`:

| Choice | `reactTarget` |
|---|---|
| 1. Inline-split | `"inline"` |
| 2. Vanilla + CSS modules | `"css-modules"` |
| 3. Tailwind + shadcn | `"tailwind"` |
| 4. Styled-components | `"styled-components"` |

Call:

```ts
reframe_export({
  sceneId: "<id>",
  format: "react",
  reactTree: true,
  reactTarget: "<chosen>",
  typescript: true,
})
```

### 3. Report the tree to the user

The engine returns a text summary with:
- Export path (e.g. `.reframe/exports/pricing-react/`)
- Entry file (e.g. `src/pages/pricing.tsx`)
- Section list (each with name, semanticRole, path)
- Tokens path (if designSystem was active)
- Notes (any scaffolded-but-unimplemented features the user requested)

Relay this verbatim. Don't paraphrase — paths matter.

### 4. Answer follow-up questions

User may ask:
- **"Can you open it?"** → don't; just give them the path, they open it themselves
- **"Can you add a shadcn Button wrapper?"** → NOT THIS SKILL. You don't edit the engine's output. Point to Phase 2 roadmap (see [references/roadmap.md](references/roadmap.md))
- **"The extraction missed a section"** → check if the source scene has `semanticRole` on the intended node. If not, the extraction cascaded to "no-role fallback" (≥3 descendants). Suggest setting semanticRole in reframe-design and re-exporting.
- **"Can you merge everything back into one file?"** → drop `reactTree: true`, use `reframe_export format=react` without tree flag (existing single-file exporter)

## Hard rules

1. **Never hand-rewrite the engine's output.** If the tree isn't what the user wants, fix the **source scene** (set semanticRole, change structure) and re-export. Don't edit the emitted .tsx files — that's a dead end.
2. **Never promise Phase 2/3 features as working now.** Primitives extraction and hook extraction are scaffolded but not implemented. Surface the limitation honestly; point to [references/roadmap.md](references/roadmap.md).
3. **Respect determinism.** Same scene + same options → same file tree, byte-equal. If a user reports non-determinism, it's an engine bug to file, not something to work around in the skill.
4. **No feature additions beyond export.** "Add a newsletter signup" is a reframe-design task, not a to-react task.

## When NOT to use this skill

- User says "just give me the React code, I'll refactor it myself" → call `reframe_export format=react` WITHOUT `reactTree`, give them the single-file dump
- User asks for HTML export (not React) → that's the plain `reframe_export format=html` path
- Scene hasn't been compiled yet → route to [reframe-design](../reframe-design/SKILL.md) first

## References

- [references/engine-options.md](references/engine-options.md) — every parameter with examples + defaults
- [references/output-tree.md](references/output-tree.md) — what the emitted file tree looks like, per target
- [references/roadmap.md](references/roadmap.md) — what's Phase 1 (now), Phase 2/3 (planned)

## Examples

- [examples/css-modules-export.md](examples/css-modules-export.md) — typical CSS-modules export, full trace
- [examples/tailwind-sketch.md](examples/tailwind-sketch.md) — tailwind target with Phase-2 scaffold behavior

## Related

- [reframe-design](../reframe-design/SKILL.md) — generates the scene. Tree quality depends on good semanticRoles on top-level sections.
- [reframe-brand](../reframe-brand/SKILL.md) — DESIGN.md drives the emitted tokens.css / tailwind.config.ts sketch
- [reframe-critic](../reframe-critic/SKILL.md) — optional pre-export pass to ensure the source scene is worth productionizing
