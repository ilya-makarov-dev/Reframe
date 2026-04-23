---
name: reframe-ui
description: Use when composing an agent-operable INode panel for reframe's Platform UI — brand-palette, variant-picker, inspector, brand-gallery, or any new panel that mounts into a shell slot or replaces a page's main content. Covers the grammar of Block A primitives (intent / onClick / onInput / mountSlot / keybinding), the sizing rules that keep Yoga layout sane, the gesture dispatch protocol (MCP bridge vs browser.* pseudo-tools), and the smell table of panels that compile clean but read wrong. Not for scene-level design (→ reframe-design), not for brand token editing (→ reframe-brand). This skill carries the taste knowledge about composing the APP ITSELF.
allowed-tools:
  - "mcp__reframe__*"
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
---

# reframe-ui

**You are composing UI for reframe's own Platform UI — not user scenes.** Every pixel of a panel goes through the same INode pipeline that renders user designs: `composeXxxPanel(opts) → SceneGraph → ensureSceneLayout → exportToHtml → HTML mounted via SSE or inlined server-side`.

The substrate is Block A (Phase 0+) — `intent` / `onClick` / `onInput` / `focusable` / `keybinding` / `mountSlot` / `semanticPath`. The runtime dispatcher (`055-agent-runtime.js`) catches every `data-gesture-*` attribute, substitutes `{value}/{path}/{id}` placeholders, and POSTs to `/platform/api/agent-gesture` — or handles `browser.*` pseudo-tools locally.

Your job:

1. Turn intent ("show brand palette", "inspect selected node") into an INode tree that compiles with Yoga, paints with exporter, and dispatches with the runtime.
2. Honor the brand-locked editing principle: panels edit STRUCTURE + SEMANTICS, not per-node visual properties. Colors/fonts/spacing live in brand tokens — never expose a per-element color picker.
3. Keep the runtime contract clean: every interactive node has `semanticRole` + `focusable` + a gesture binding. Nothing interactive without a handler.

## Sensitive surfaces — where panels drift

Check these before you finish composing, especially in the first live-Chrome probe.

- **Yoga sizing** — HUG vs FIXED is THE trap. Root vertical container needs `primaryAxisSizing: 'HUG'` + `counterAxisSizing: 'FIXED'` (width set explicitly). Any VERTICAL child that holds other children: same pair. HORIZONTAL wrap containers: `primaryAxisSizing: 'FIXED'` (takes parent width) + `counterAxisSizing: 'HUG'` (grows as rows wrap). Without these, Yoga collapses containers to 100px and sections overlap. This is Phase 3.1's biggest lesson — default sizing lies.

- **Intent editableBy** — marks what agents + users are allowed to touch. `'locked'` rejects gestures client-side + server-side. Every decorative text/divider/label inside a panel chrome should be `'locked'`, not `'both'` — otherwise agents might rewrite your panel structure thinking it's editable.

- **Gesture args vs substitution** — args carry `{placeholders}` that get swapped at dispatch time. `{value}` for onInput current value, `{path}` for dispatching node's semanticPath, `{id}` for node id. Forgetting this and hardcoding values means every click sends the composer-time value, not the runtime one. Common on text-edit rows that forgot `{value}` in the rename args.

- **Shell mount-slot absence** — if the target page's `<aside>` or equivalent doesn't carry `data-mount-slot="right-panel"`, the runtime dispatcher finds nothing and silently no-ops. Every Platform UI page renderer must wire the slot — check before mounting, surface as a bug if missing.

- **CSS var bindings vs hex** — swatches that ought to repaint live on `token:changed` SSE must carry `meta.tokenBindings.fill: '<role>'`. Without it the exporter emits hardcoded hex and the fast-path patch on documentElement doesn't reach them. Verify the panel HTML contains `var(--color-<role>)` refs — no vars = no live repaint.

- **Interactive role without handler** — a `semanticRole: 'button'` with no `onClick` / `onInput` / `href` trips the `interactionCompliance` audit rule. Either wire the handler or drop the role.

- **Descriptive vs role token names** — parser stores both canonical roles (`primary`, `background`, `accent`) and descriptive ones (`racing-red`, `pure-white`) in `colors.roles`. Your pill row should prefer canonical + let the brand surface the descriptive ones as alternates, NOT show all 20 raw role names from the parser.

- **Contenteditable TEXT for name inputs** — a TEXT node with `semanticRole: 'input'` + `onInput` binding is contenteditable by the runtime dispatcher reading `textContent`. Remember to keep fontFamily/fontSize readable — a 10px monospace editable name row is technically valid but brutally unusable.

## Panel shape cheatsheet

Every reframe panel follows a common skeleton — memorize it. Variations happen in the middle, not the shell.

```
panel (root)
  ├─ intent: '<panel-name>/panel'
  ├─ mountSlot: { name: 'right-panel', accepts: [<panel kinds>] }
  ├─ layoutMode: VERTICAL
  ├─ primaryAxisSizing: 'HUG'
  ├─ counterAxisSizing: 'FIXED'
  ├─ width: 320 (right-panel) or 1100 (page main)
  ├─ padding: 16 (right-panel) or 40 (page main)
  ├─ fills: DARK surface background
  │
  ├─ header (frame, HORIZONTAL, SPACE_BETWEEN)
  │   ├─ title (TEXT, 14/600)
  │   └─ close-button (FRAME button, onClick: reframe_ui.unmount, keybinding: escape)
  │
  ├─ section × N (VERTICAL, HUG, itemSpacing: 12-16)
  │   ├─ section-label (TEXT, 10/JetBrains Mono, UPPER, TEXT_TERTIARY)
  │   └─ content (panel-specific)
  │
  └─ actions row (HORIZONTAL, HUG) — optional
      └─ primary / secondary / danger buttons
```

Color palette used by panels (from a dark Platform UI theme):
- `SURFACE_BG` = 0.066/0.066/0.078 — panel background
- `SURFACE` = 0.086/0.086/0.102 — card / button resting
- `SURFACE_ELEV` = 0.109/0.109/0.129 — elevated rows
- `BORDER` = 0.172/0.172/0.204 — visible separator
- `BORDER_SUBTLE` = 0.12/0.12/0.14 — barely-there frame divider
- `TEXT_PRIMARY` = 0.98/0.98/0.98
- `TEXT_SECONDARY` = 0.72/0.72/0.76
- `TEXT_TERTIARY` = 0.52/0.52/0.56 — captions, meta
- `ACCENT` = 0.388/0.357/1.0 — active pill, primary CTA
- `DANGER` = 0.82/0.35/0.35 — delete / destructive

## Gesture recipes

### Click → MCP tool (server-side)
```ts
onClick: {
  tool: 'reframe_edit',
  args: { op: 'applyVariant', sceneId: '...', targetPath: '{path}', variantId: '...' },
  fastPath: 'optimistic-ui',
}
```
Dispatcher POSTs to `/platform/api/agent-gesture`. Server's `TOOL_HANDLERS.get('reframe_edit')` resolves the target via `findNodeByPath(graph, targetPath)` and mutates. `fastPath: 'optimistic-ui'` hints the dispatcher to add `rf-gesture-pressed` class for 140ms as visual feedback.

### Input → same
```ts
onInput: {
  tool: 'reframe_edit',
  args: { op: 'rename', sceneId: '...', targetPath: '{path}', name: '{value}' },
  fastPath: 'local-state',
}
```
Fires on change/input. `{value}` pulled from `ev.target.value` for `<input>` or `textContent` for contenteditable TEXT.

### Click → close panel (client-side)
```ts
onClick: { tool: 'reframe_ui', args: { action: 'unmount', panel: 'brand-palette' }, fastPath: 'local-state' },
keybinding: { combo: 'escape', tool: 'reframe_ui', args: { action: 'unmount', panel: 'brand-palette' } },
```
Dispatcher POSTs `/platform/api/agent-gesture`. Server's `reframe_ui` handler emits `panel:unmount` SSE → every connected browser (including the one that clicked) removes the panel.

### Click → browser-local action (no server roundtrip)
```ts
onClick: { tool: 'browser.download', args: { url: '/api/tokens/<slug>?format=dtcg', filename: '<slug>.tokens.json' }, fastPath: 'local-state' }
```
Dispatcher catches `browser.*` before the fetch call and handles locally — synthesizes `<a href download>` click. Other browser.* tools: `browser.navigate`, `browser.reload`.

### Click → mount another panel (agent chain)
```ts
onClick: {
  tool: 'reframe_ui',
  args: { action: 'mount', panel: 'inspector', slot: 'right-panel', config: { target: {...}, sceneId: '...' } },
}
```
Server emits `panel:mount` SSE with composed HTML. Any agent-UI flow where one panel triggers another uses this — keeps the UI chainable without new primitives.

## Smell table — compile clean, read wrong

Accumulated failure modes from Phase 0-3 live authoring. Grow this when you catch a new pattern — the next composer catches it in seconds.

| Smell | What it looks like | Root cause | Fix |
|---|---|---|---|
| **Collapsed sections overlap** | Title of section N draws on top of section N-1's content | Default `primaryAxisSizing: 'FIXED'` on VERTICAL container → Yoga collapses to 100px | Set `'HUG'` on every VERTICAL container |
| **Wrapped rows don't wrap** | Horizontal grid of items exits container to the right, doesn't wrap even with `layoutWrap: 'WRAP'` | Default `counterAxisSizing: 'FIXED'` on HORIZONTAL wrap container → Yoga treats content as one infinite row | Set `counterAxisSizing: 'HUG'` on wrap containers |
| **Panel blank after mount** | Server says `{ok:true, nodeCount: ...}` but DOM shows nothing | Target page's shell has no `data-mount-slot="right-panel"` | Wire the attribute on `<aside>` / equivalent in the page renderer |
| **Token swatch doesn't repaint live** | `token:changed` SSE fires, `--color-primary` patched, but panel still shows old hex | Swatch has hardcoded `fills: [{color: hex}]` without `meta.tokenBindings.fill: role` | Add `meta: { tokenBindings: { fill: role } }` + pass `DesignSystem` to exporter |
| **Button dead on click** | `data-gesture-click` emitted, event fires, no network call | `intent.editableBy === 'locked'` — dispatcher refuses | Change to `'both'` / `'user'` / `'agent'` as appropriate |
| **Hex still in DESIGN.md after setToken** | SSE token:changed fires, visible repaint, but disk write silently skipped | Brand uses bold-parens format (Ferrari: `**Pure White** (\`#FFFFFF\`)`) not simple `Label: #hex` | Patch regex covers it now — but verify on fresh brand formats |
| **Inspector shows stale target after graph edit** | Rename/clone happens, inspector still shows old name | Panel didn't remount after scene:session-changed SSE | Platform UI must listen to scene-changed and re-mount inspector with refreshed target OR make inspector an SSE subscriber itself |
| **Descriptive pill noise** | Inspector pill row lists 20 raw roles (`racing-red`, `pure-white`, ...) | Parser stores both canonical and descriptive; panel iterates everything | Slice `availableRoles` to 6-10 canonical; escape-hatch for descriptive ones via "show all" toggle |
| **Contenteditable name row unreadable** | User tries to rename, can't see cursor | 10-11px monospace font on edit-target TEXT | Bump to 13-16px sans font; keep `semanticRole: 'input'` |
| **Focus lost after optimistic-ui** | User typed 3 chars, 4th lands outside the input | Agent replies with SSE patch that replaces `<main>` innerHTML → focus dropped | Dispatcher needs focus-preservation on incremental patches (Phase 4 target — not yet implemented) |
| **Panel outlives its node** | Delete succeeded, inspector stays with stale target | Handler fired delete but not panel:unmount | Every destructive op should auto-unmount panels that reference the target |
| **Pill row wraps into one-per-line** | 6 role pills each on their own row | Pill parent's counter-axis not HUG | `counterAxisSizing: 'HUG'` on `pills` frame |
| **Export button triggers MCP roundtrip for a download** | User clicks "Export" → 200ms network latency before browser starts download | Used `reframe_edit export` tool instead of `browser.download` | Switch to `browser.download` pseudo-tool — zero roundtrip |

## Canonical flows

### Compose → register → inline render (self-host a page)
1. Write composer at `packages/core/src/panels/<name>.ts` — export `compose<Name>Panel(opts) → SceneGraph`.
2. Export composer + options types from `packages/core/src/index.ts`.
3. Register in `packages/mcp/src/platform/panels.ts` — `COMPOSERS_EXT.set('<name>', (config, ctx) => ({ graph, designSystem? }))`.
4. Page renderer calls `renderPanel('<name>', config, { projectDir })` and drops the HTML into `renderShell`'s `main` slot.
5. Offline bench in `packages/mcp/src/tests/phase<N>-<name>.ts` — verify structure + gestures + no-brand fallback.
6. Live Chrome: `reframe_ui action=open path=/platform/<page>` → screenshot + probe selectors.
7. Commit + push.

### Compose → register → mount-on-demand (right-panel skill)
Same steps 1-3. No page renderer needed.
4. Mount via MCP: `reframe_ui action=mount panel=<name> config={...}`.
5. Unmount via keybinding (escape) or programmatic: `reframe_ui action=unmount panel=<name>`.
6. Live Chrome: open a project canvas page → `mount` → screenshot → click swatches/buttons → probe network/DOM.

### Add a new gesture tool to the MCP bridge
1. Open `packages/mcp/src/platform/api/agent-runtime.ts`.
2. `TOOL_HANDLERS.set('<tool>', async (args, body, ctx) => { ... })`.
3. Handler resolves scene via `getScene(sceneId)` + target via `findNodeByPath(graph, targetPath)`.
4. Mutate graph directly (`graph.updateNode`, `graph.deleteNode`, `graph.cloneTree`).
5. Emit `scene:session-changed` SSE after every mutation so other clients patch.
6. Return `{ok, handled: true, result: {...}}`. Unknown ops → `handled: false`.
7. Typecheck core + mcp + bench a fresh test.

## Anti-patterns

- **Writing hand-HTML inside a panel** — defeats the purpose. Every visible element is an INode. If you catch yourself writing `innerHTML: '<div>...'`, it's a bug.
- **Per-node color picker** — violates brand-locked editing. Inspector edits structure + semantics; brand-palette edits brand.
- **Server-side dispatch for pure-browser actions** — downloads, navigates, reloads don't need MCP. Use `browser.*`.
- **Explicit heights everywhere** — pre-computing heights defeats Yoga HUG. Set HUG on containers, explicit height only on leaf TEXT / FRAME where Yoga can't measure.
- **Hardcoded palette in composer** — brand comes from ctx.projectDir. A composer that always shows `#635BFF` is not self-hosting Ferrari.
- **Forgetting `semanticPath` in gesture args** — agents reference nodes by stable paths, not ids. Always include `targetPath: '{path}'`.
- **Duplicating Yoga sizing knowledge per panel** — consider extracting helpers if composing a fourth panel. Rule of three: first panel, learn it; second, copy; third, extract.

## Tools to reach for

- **`reframe_ui action=open`** — spin up Chromium on a Platform UI route. First step of every live verification.
- **`reframe_ui action=probe`** — JS expression against the page. Read computed bboxes, CSS vars, inline styles. Best for "is my panel visually there" questions.
- **`reframe_ui action=screenshot fullPage=true`** — capture the rendered panel. Remember: Platform UI's `<main>` has inner scroll; fullPage doesn't capture that, scroll `<main>` manually via probe before screenshotting to see content past viewport.
- **`reframe_ui action=mount`** — compose + SSE broadcast. The agent-UI way to trigger a panel without going through the chat.
- **`reframe_ui action=act`** — click + type + press a sequence of steps. Use to verify gestures roundtrip end-to-end.

## Authoring artifacts vs composing in code (Phase 6)

Panels now come in two forms. **Same substrate, same pipeline, different authoring surface.** Pick the right one per task; they coexist in the same registry.

| | Code composer | Disk artifact |
|---|---|---|
| **Where** | `packages/core/src/panels/<name>.ts` | `<projectDir>/.reframe/ui/<name>.panel.html` |
| **Output** | `SceneGraph` returned from a function | HTML + `data-bind-*` bindings |
| **Hot-reload** | Needs rebuild + MCP reconnect | File write → chokidar → SSE `panel:catalog-changed` → remount |
| **When to reach for it** | Ship-in-core defaults used by every project; anything perf-critical; panels that need typed config objects and complex per-field logic | Everything else: per-project customizations, agent-authored one-offs, fast iteration, variants for a specific design session |
| **Override** | Used as fallback | Wins on name clash — drops into `<projectDir>/.reframe/ui/dashboard.panel.html` to override the ship-in-core `dashboard` |

**Rule of thumb:** if the panel ships to every user of `@reframe/core`, write a composer. If it exists because *this* project or *this* session needs it, write an artifact. Agents authoring new panels default to artifacts; a composer is worth promoting only after a panel earns its place across multiple projects.

### Artifact format — three binding attributes, one interpolation rule

```html
<div style="width:320px; padding:16px"
     data-intent-role="version-history/root"
     data-mount-slot="right-panel"
     data-panel-accepts="version-history">
  <h3 data-bind-text="title">Title fallback</h3>

  <div data-bind-each="versions">
    <div data-intent-role="version-history/entry"
         data-bind-attr="data-version-id:id;data-author:author"
         data-gesture-click='{"tool":"reframe_edit","args":{"op":"restoreVersion","versionId":"{id}"}}'>
      <span data-bind-text="label">Version N</span>
      <span data-bind-text="timestamp">time ago</span>
    </div>
  </div>
</div>
```

- **`data-bind-each="<path>"`** repeats the element for every item in `config.<path>`. Nested bindings inside resolve against the row. Use `data-bind-each-as="row"` to rename the scope variable (default is `item` + the row's own object fields merged flat).
- **`data-bind-text="<path>"`** replaces `textContent`. Drops any child nodes (they were authoring placeholders).
- **`data-bind-attr="attrA:pathA;attrB:pathB"`** sets multiple attributes from config.
- **`{path}` interpolation** works in every attribute value — including JSON gesture args. Conservative syntax (`{alpha.numeric_dash[0]}` only) so JSON braces like `{"tool":...}` don't get parsed as tokens.

`.` references the current row scope (`{.}` inside `data-bind-each="items"` on a string array resolves to the current string).

Missing paths silently resolve to empty. Empty arrays render zero rows — that's valid, not a crash.

### Canonical flow: intent → draft → commit → mount → iterate

1. **Intent.** User says "show me version history with restore buttons." Identify the role path, mount slot, gesture tool.
2. **Draft HTML.** Write the artifact. Respect the same taste rules as scene authoring (no pure black, max one high-sat accent, proper sizing). Include at least one working `data-bind-each` + `data-bind-text` so the template-vs-data split is obvious.
3. **Commit via `reframe_ui action=authorCommit name=<kebab> html=<string>`.** The tool writes to disk AND runs a dry-run render with empty config. If parse fails, it rolls back (unless `keepOnFailure=true`). A successful commit reports `nodeCount` — non-trivial number means the bindings expanded as expected.
4. **Mount via `reframe_ui action=mount panel=<kebab> config={...}`.** Verify the panel renders in the browser with actual data. Use `reframe_ui action=probe` to confirm `data-intent-role` and `data-mount-slot` survived.
5. **Iterate.** Re-commit the HTML as needed; the watcher + SSE remount open clients automatically. No sidecar restart, no MCP reconnect.
6. **Delete when done** (for throwaway panels): `reframe_ui action=authorDelete name=<kebab>`. If a code-shipped panel of the same name exists, it becomes active again.

### Artifact-specific smell table

| Smell | Why it's a bug | Fix |
|---|---|---|
| **Config shape lives only in the agent's head** | Next session re-opens the panel and guesses field names. | Put a comment block at the top of the artifact listing every `data-bind-*` path the panel expects. |
| **`{value}` substitution inside JSON** | Agents confuse `{value}` (runtime gesture placeholder) with `{config.path}` (author-time binding). | Binding tokens only resolve against the author's config. Use `{path}` from the runtime substitutions for gesture-time values. |
| **Hard-coded brand colors in an artifact** | Panel stops tracking `token:changed` SSE repaints. | Use CSS vars — `color: var(--color-text)` — just like the exporter emits for token-bound scenes. |
| **Artifact authored without any `data-intent-role`** | Agents can't address it with `semanticPath`, breaking QA scenarios. | Every interactive + labelled element gets an intent role. Chrome containers at minimum need one on the root. |
| **Overriding a code panel by accident** | Dropping `dashboard.panel.html` into `.reframe/ui/` invisibly overrides the ship-in-core dashboard. | `reframe_ui action=authorList` shows "artifact wins" annotations. If you want additive, pick a different name. |
| **Multiple `data-bind-each` siblings at the same level** | Expansion is well-defined but visual order becomes load-bearing on a template that looks innocent. | When in doubt, wrap each `each` in its own semantic container. |
| **Forgetting `data-panel-accepts`** | Shell slot may reject mounting a panel of the wrong kind. | Declare `data-panel-accepts="<kind>"` on the root when the panel is scoped to a specific shell slot kind. |

## When NOT to use this skill

- Designing a user scene → `reframe-design`
- Editing a brand's DESIGN.md → `reframe-brand`
- Motion / video / scene transitions → `reframe-motion`
- Multi-page site generation → `reframe-site-loop`

This skill is strictly about **reframe's own UI**, composed through reframe's own engine. Every panel is a proof point of the self-hosting thesis.
