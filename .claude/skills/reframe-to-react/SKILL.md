---
name: reframe-to-react
description: Use when the user wants to ship a compiled reframe scene as React code — "export to React", "give me the code", "make this a component library", "refactor into sections", "TSX please". You orchestrate the stack choice (inline / css-modules / tailwind / styled-components) and hand off to the deterministic engine exporter. You never hand-rewrite the emitted JSX — that would break byte-determinism, which is reframe's moat.
allowed-tools:
  - "mcp__reframe__reframe_export"
  - "mcp__reframe__reframe_inspect"
  - "Read"
bus-context-types:
  - export-intent
bus-result-kinds:
  - export-result
bus-streaming: false
---

# reframe-to-react

**You are a stack translator, not a transpiler.** The engine already knows how to turn an INode tree into deterministic React — same scene + same options → byte-identical output. What the engine doesn't know is which stack the user is shipping to: inline styles? CSS modules? Tailwind + shadcn? Styled-components?

Your job: ask that once, map to `reactTarget`, call `reframe_export` with `reactTree: true`, relay the tree back verbatim. **Never rewrite the emitted JSX.** If the tree doesn't match what the user wants, fix the *source scene* (set semanticRoles, rename nodes) and re-export.

## Sensitive surfaces

Where React export trips:

- **Sections extraction missed a region** — the engine splits children that have `semanticRole`. If the scene's top-level sections don't carry roles, extraction cascades to a "no-role fallback" (≥3 descendants) which may over- or under-split. Fix in the source scene, not the output.
- **Stack mismatch** — user says "shadcn" but scene has handwritten buttons; engine emits `<button>`, not `<Button>` from `@/components/ui`. Phase 2 roadmap; surface the gap.
- **Token drift on re-export** — scene tokens changed between exports; regenerated `tokens.css` / `tailwind.config.ts` diverge from a previously committed version. Diff before merging.
- **TypeScript prop types missing** — engine emits JSX with typed props only if the source scene has `semanticRole` + text slots on the extracted sections. Untyped output needs source-level role annotation.
- **Accessibility leak on regeneration** — if the user edits emitted JSX to add `aria-*` and re-exports, the edits get clobbered. Attributes must live on the source scene or in a wrapper, not in the emitted file.

## Smell table

| Smell | Why it's a problem | Fix |
|---|---|---|
| User asks "wrap buttons in shadcn Button" | Can't hand-rewrite emitted JSX | Tell them: Phase 2 roadmap; currently emits raw `<button>`; they can wrap in their own layer |
| Emitted tree has 1 giant section file instead of 3 | Source scene lacks `semanticRole` on top children | Set roles in source (via `reframe-design` or direct `reframe_edit`), re-export |
| `tokens.css` has hex literals instead of var() refs | Design system wasn't loaded at export time | Ensure `designSystem` param is on at export; or pre-call `reframe_inspect` to confirm brand is active |
| Same export twice gives different files | Would be an engine bug (determinism broken) | Not a skill fix — file an engine bug. Don't work around it here. |
| User says "just give me one file" | Tree mode produces 5+ files | Drop `reactTree: true`, use plain `format: "react"` — single-file dump |
| User wants to edit the output directly | That's a dead end on re-export | Push them to edit the source scene; re-export produces clean tree |

## Canonical flow

One shape, every time:

1. **Scene must be compiled.** If not, route to `reframe-design` first.
2. **Ask the stack once.** Four options (inline / css-modules / tailwind / styled-components). Default to css-modules if user doesn't care.
3. **Surface implementation status** honestly: inline + css-modules are Phase 1 (fully implemented); tailwind emits a config sketch but falls back to inline for now; styled-components scaffolded, same fallback.
4. **Call the engine.**
5. **Relay the tree verbatim** — paths matter.
6. **Answer follow-up navigation questions** about the output; refuse requests that would require hand-editing the emitted JSX.

## The stack mapping

| User says | `reactTarget` | Phase | Output shape |
|---|---|---|---|
| "inline styles" / "just split to files" / "no CSS-in-JS" | `"inline"` | 1 (working) | `<div style={{}}>` in each section file |
| "CSS modules" / "vanilla CSS" / no preference | `"css-modules"` | 1 (working) | `styles.module.css` per section + CSS-var tokens |
| "Tailwind" / "tailwind + shadcn" / "utility classes" | `"tailwind"` | 2 (scaffold) | Emits `tailwind.config.ts` sketch, falls back to inline for now |
| "styled-components" / "emotion" / "CSS-in-JS" | `"styled-components"` | 2 (scaffold) | Scaffolded, falls back to inline for now |

## The engine call

```ts
reframe_export({
  sceneId: "<id>",
  format: "react",
  reactTree: true,
  reactTarget: "<inline | css-modules | tailwind | styled-components>",
  reactExtractSections: true,    // default — split children with semanticRole
  reactOutputBase: "src",        // default
  reactPageSlug: "<slug>",       // default: derived from scene name
  typescript: true,              // default
})
```

Output materializes to `.reframe/exports/<slug>-react/`. Engine returns a text summary with entry file, section list, tokens path, and any scaffolded-feature notes. Relay verbatim.

## Anti-patterns

- **Hand-rewriting the emitted JSX.** Kills determinism. If the tree is wrong, fix the source scene.
- **Promising Phase 2/3 features as working now.** Primitives extraction, hook extraction, tailwind fully-rendered classes — all scaffolded, not implemented. Surface the limitation.
- **Feature-adding during export.** "Also add a newsletter signup" — that's `reframe-design`, not export.
- **Opening files for the user.** Give them the path; they open it.
- **Reformatting output.** Engine is the source of truth. Prettier disagreement is not yours to resolve.

## Tools to reach for

- `reframe_export format=react reactTree=true ...` — the main call
- `reframe_export format=react` (no reactTree) — single-file fallback when user asks
- `reframe_inspect sceneId=X includeSemantic=true` — verify source scene has semanticRoles before asking about sections
- `Read` — navigate the emitted tree when the user asks to preview a specific file

## Gotchas

- **Scene must be compiled.** Tree extraction reads the in-memory graph; uncompiled scene = nothing to export.
- **Determinism is a feature.** Same input → same output. If the user reports drift, file an engine bug; don't compensate in the skill.
- **First export writes to `.reframe/exports/<slug>-react/`**; subsequent exports overwrite. Tell the user if they have uncommitted edits in there — they'll lose them.
- **Google Fonts are emitted as `<link>` preconnects**, not self-hosted. If the user needs self-hosting, that's a post-export step outside this skill.

## When NOT to use this skill

- User wants HTML export → `reframe_export format=html` directly (not this skill)
- User wants to design a NEW scene, not export an existing one → `reframe-design`
- User wants to tweak emitted JSX after seeing it → point back to source scene; don't edit the output
- User wants SVG / PNG / PDF / Lottie → `reframe_export` with the matching format; not this skill

## Growing the smell table

When export produces an unexpected shape that a future session would miss:

1. Name the signature ("single giant section file", "tokens as literals not vars", "type preset missing")
2. Why (usually traces to a missing annotation in the source scene)
3. Fix pointer (which op on the source, or which `reactTarget` flag)
4. Add the row

Each smell caught = the next export either produces the right shape or catches the failure in 10 seconds.
