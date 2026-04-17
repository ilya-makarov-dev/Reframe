# reframe-to-react skill

**Guide layer** over the engine's deterministic React tree exporter. Elicits the user's target stack, calls `reframe_export format=react reactTree=true` with the right flags, relays the result honestly. Does NOT transform code — the engine does, byte-deterministically.

## What this skill does

- **Asks once:** which target stack? (inline / css-modules / tailwind / styled-components)
- **Maps** the user's choice to `reactTarget` flag
- **Calls** the engine-side `exportToReactTree` via the MCP tool
- **Relays** the engine's output verbatim (including "not yet implemented" notes for Phase 2/3 scaffolds)
- **Pushes back** on requests that aren't export concerns (layout changes → `reframe-design`)

## What this skill does NOT do

- Rewrite JSX
- Extract components by hand
- Run TypeScript validation itself
- Call an LLM to refactor
- Promise Phase 2/3 features as shipped

The engine's guarantee is **visual-fidelity determinism** — same INode tree + same options → same file tree, byte-equal. LLM-rewriting would break this. This skill preserves the guarantee by staying thin.

## Architecture

```
User intent
    ↓
reframe-to-react skill (this)          ← asks stack, maps to flags, relays output
    ↓
reframe_export MCP tool                 ← deterministic entry point
    ↓
exportToReactTree (core engine)         ← walks INode, emits file map
    ↓
Materializer (MCP tool)                 ← writes files to .reframe/exports/<slug>-react/
```

## Example prompt + response

**User:**
```
Export this pricing page as React with CSS modules.
```

**Skill:**
1. Parses user's "CSS modules" — no ambiguity
2. Calls `reframe_export({ sceneId, format: "react", reactTree: true, reactTarget: "css-modules", ... })`
3. Relays:
```
Tree written to .reframe/exports/pricing-react/ (8 files, target=css-modules):
  · Entry: src/pages/pricing.tsx
  · 6 section components in src/components/sections/
  · Tokens: src/styles/tokens.css
```

Full trace: [examples/css-modules-export.md](examples/css-modules-export.md).

## Stack targets

| Target | Status | Output |
|---|---|---|
| `"inline"` | ✅ Phase 1 | Split files, inline styles |
| `"css-modules"` | ✅ Phase 1 | Split files + per-component CSS modules |
| `"tailwind"` | ⚠️ Scaffolded | Falls back to inline + `tailwind.config.ts` sketch |
| `"styled-components"` | ⚠️ Scaffolded | Falls back to inline |

Full status matrix in [references/roadmap.md](references/roadmap.md).

## Skill structure

```
reframe-to-react/
├── SKILL.md                       — agent entry (guide, not transformer)
├── README.md                      — this file
├── references/
│   ├── engine-options.md          — every reframe_export react flag with examples
│   ├── output-tree.md             — what the engine emits per target
│   └── roadmap.md                 — Phase 1 (now) / Phase 2 (primitives, tailwind) / Phase 3 (hooks)
└── examples/
    ├── css-modules-export.md      — typical happy path
    └── tailwind-sketch.md         — Phase-2 scaffold behavior (being honest about it)
```

No workflow files — the skill is linear: ask stack → call engine → relay. SKILL.md carries the whole pipeline.

## Works with

- [`reframe-design`](../reframe-design/) — upstream, generates scenes with good `semanticRole`s that drive extraction quality
- [`reframe-brand`](../reframe-brand/) — DESIGN.md feeds the `tokens.css` + `tailwind.config.ts` sketch
- [`reframe-critic`](../reframe-critic/) — optional pre-export pass to make sure the source scene is worth productionizing

## Engine source of truth

`packages/core/src/exporters/react.ts` — search for `exportToReactTree`. If the skill's documented behavior ever diverges from the engine, **trust the engine source** and file an issue to update the skill.
