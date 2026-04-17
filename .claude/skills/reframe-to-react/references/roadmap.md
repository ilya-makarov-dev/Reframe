# Roadmap — what's Phase 1 (now) vs Phase 2/3 (planned)

The engine's React tree exporter ships in phases. This file documents what works **today** and what's scaffolded but unimplemented. Surface honestly to users.

## Phase 1 — shipped

**Status:** fully implemented, deterministic, used by this skill.

- ✅ `exportToReactTree` function in core
- ✅ Multi-file tree output: `Record<path, content>`
- ✅ Section extraction by `semanticRole` on top-level children
- ✅ Fallback extraction by descendant count (≥3) when no semanticRole
- ✅ Single-file fallback when nothing extractable
- ✅ Entry page that imports + renders sections in order
- ✅ `tokens.css` emitted when designSystem is present
- ✅ `typescript` toggle (.tsx vs .jsx)
- ✅ Custom `outputBase` and `pageSlug`
- ✅ Targets: `inline`, `css-modules` (CSS content returned alongside component)
- ✅ MCP tool plumbing via `reframe_export reactTree=true`
- ✅ Disk materialization under `.reframe/exports/<slug>-react/`

### Phase 1 known gaps

- ⚠️ `css-modules` target returns CSS in a comment block within the component rather than a separate `.module.css` file. **Phase 1.1 fix:** split CSS into sibling files (trivial — already the right data, needs the materializer to emit separately).
- ⚠️ Token variable substitution in section components not yet wired — sections still have hardcoded hexes even when `tokens.css` is present. **Phase 1.2 fix:** post-process style objects to replace `color: '#635BFF'` with `color: 'var(--color-primary)'` when DS is active.

## Phase 2 — scaffolded, accepts options, currently no-op

**Status:** flags accepted, emit warning notes, planned for implementation.

### Shape-hash primitive extraction (`reactExtractPrimitives`)

Walk INode tree, compute structural hash per subtree (ignoring content, preserving shape + layout + type). Subtrees repeating ≥ N times → extract to `src/components/ui/<Primitive>.tsx` with props for the varying content.

**Algorithm sketch:**
```
hash(subtree) = sha256(
  subtree.type
  + '|' + subtree.layoutMode
  + '|' + children.map(hash).join(',')
)
```
Cluster by hash → for clusters size ≥ 3, extract to primitive with props for [text, color, link].

**Planned primitives:** Button, Card, Badge, Input, NavItem, Avatar, Pill.

### Tailwind class emission (`reactTarget: "tailwind"` real implementation)

Map engine's computed style objects → Tailwind classes. Requires:
- Per-prop mapping table (color → `bg-*`, fontSize → `text-*`, padding → `p-*`, etc.)
- Custom-value emission for non-standard values (`bg-[#635BFF]`)
- Brand-aware theme references (`bg-primary` when `#635BFF` matches `colors.primary`)

Falls back to arbitrary values (`w-[187px]`) for off-grid measurements.

### Styled-components emission (`reactTarget: "styled-components"` real implementation)

Generate `.styles.ts` files per component with styled-components syntax. Theme access via `ThemeProvider`.

### Token var substitution in section bodies

When designSystem is active, replace hardcoded hexes in inline styles with `var(--color-*)` references sourced from emitted `tokens.css`. Currently done at `:root` emission time but not at per-node style time.

## Phase 3 — scaffolded, more ambitious

**Status:** flags accepted, planned but needs state-model exploration.

### Hook extraction (`reactExtractHooks`)

Detect state-bearing nodes — nodes with `.states` (hover/active/focus/disabled/selected overrides) or interactive handlers — and scaffold `useX` hooks in `src/hooks/`. Example:

```ts
// src/hooks/usePlanSelect.ts
export function usePlanSelect() {
  const [selected, setSelected] = useState<string | null>(null);
  return { selected, setSelected };
}
```

Section components receive the hook via props or via direct hook call at the top.

### Interaction wiring

When nodes have explicit click/tap handlers in INode (from gesture or rule), emit event handlers in the React output. Requires a handler model that INode doesn't fully define yet.

## When to ship Phase 2

Signals to prioritize Phase 2:
- Users asking for Tailwind more than 3x in feedback
- Users hand-editing section files to extract primitives post-export (wasted motion)
- Shape-hash dedup algorithm works well enough in offline tests

## When to ship Phase 3

Signals to prioritize Phase 3:
- Users asking for real interaction (not just visual) export
- Scenes with explicit state machines being built in reframe (needs engine's interaction model to mature first)

## Out of scope

These will NOT be added:

- **LLM-refactoring of emitted code.** Breaks determinism. The whole point of Phase 1+ was to avoid this.
- **Full Next.js / Remix / Gatsby app scaffolding.** This skill emits components, not framework setup. User pastes into their own project.
- **Styled-system, Vanilla Extract, Panda CSS, Stitches, etc.** Only four style targets; beyond those, users should hand-port.
- **Arbitrary animation libraries.** Current `timeline` → CSS keyframes path is enough; no Framer-Motion / React-Spring emission.

## Related

- [engine-options.md](engine-options.md) — the surface that's accepted today
- [output-tree.md](output-tree.md) — what Phase 1 actually produces
- Engine source of truth: `packages/core/src/exporters/react.ts` (`exportToReactTree`)
