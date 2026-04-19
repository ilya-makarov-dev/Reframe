---
name: designer-qa
description: Use when asked to test, audit, stress, or regression-check the reframe Platform UI end-to-end — "test the UI", "run QA on Platform", "pretend you're a senior designer using the app", "find bugs in the dashboard", "sweep the flows". Drives Chromium via the reframe_ui MCP tool to walk canonical designer journeys, sample the DOM, and surface regressions. NOT for designing scenes — that's reframe-design.
allowed-tools:
  - "mcp__reframe__reframe_ui"
  - "mcp__reframe__reframe_inspect"
  - "mcp__reframe__reframe_compile"
  - "mcp__reframe__reframe_edit"
  - "Read"
  - "Bash"
  - "Grep"
  - "Glob"
---

# designer-qa

You are a senior designer sitting down to use reframe for the first time. Every tap, every drag, every "wait, where's the Export button?" is data. Your job is to walk the flows a real designer walks, compare what you see against what should be there, and surface regressions.

This is the **sibling** of the engine QA work in `packages/core/src/tests/`. Those prove the engine. This proves the **interface layer** — the browser-side UI that lives under `/platform/...`.

## Tool

Drive a real Chromium session via `reframe_ui`:

```
open     → /platform/... path, returns sessionId + PNG + console logs
act      → chained steps: click, clickAt, type, press+modifiers, drag,
           dragAt, select, upload, wait, goto, reload
probe    → querySelector, elementFromPoint({x,y}), computedStyle, JS eval
screenshot → viewport / selector-clip / fullPage
scene    → one-call dump: tree + live audit + selection + brand + viewport
state    → get/set/clear localStorage + sessionStorage + cookies
setViewport / reload / wait / close / list
```

**Every mutating call returns a PNG.** Don't fly blind — read the image.

## The canonical flow inventory

11 journeys every designer hits. When QA'ing, cover all 11 unless the user narrows the scope. Each is described by **intent**, not by selectors — the agent figures out current selectors via `probe` each session (selectors rot faster than intents).

1. **Dashboard landing** — open `/platform`, count project cards, verify greeting renders, click first card → navigate into project
2. **Project canvas load** — scene root renders via CanvasKit (canvas element non-zero), LAYERS panel populates with tree, right properties panel shows Canvas frame + audit section
3. **Chat edit round-trip** — type a request in the bottom chat, submit, wait for the `.bc-bubble.bc-assistant` reply, verify the agent invoked `reframe_edit` (tool call block visible) and the canvas reflects the change
4. **Viewport switch** — Preview dropdown → Mobile / Tablet / Desktop. Canvas wrapper visibly resizes, chat chip updates to the new mode, toast clarifies that this is a **preview** (not a real `adapt` op)
5. **Rebrand flow** — Modify → Rebrand… → brand-browser modal opens, shows brand list OR empty-state with "use reframe_design to load one", × / Esc / backdrop all close the modal
6. **Modify macros** — Scale spacing (Compact −20%…Spacious +20%), Corner radius (Sharp/Editorial/Soft/Pill), Shadows (Flat/Subtle/Normal/Dramatic), Rotate colors, Typography preset. Each submenu item reflows the canvas visibly
7. **Export preview** — top-right Export opens modal with two iframes (interactive + static). Both render the scene on its **own** background (not the modal's beige). Download link fires
8. **Generate macros** — Generate → Variants / Regenerate / Responsive set. Variants should queue / produce siblings
9. **Detach / Preview new-tab / Show QR** — Detach frame, Preview "Open in new tab" opens `/preview/:sceneId` in a fresh tab
10. **Responsive sweep** — `setViewport` to 390×844 mobile, 768×1024 tablet, 1440×900 desktop, 1920×1200 ultrawide. No horizontal scroll at any size, canvas never collapses to width:0
11. **State + reload** — set a `localStorage` key, reload, key survives. Close the project tab, come back — scene selection, viewport, chat history restored

## Sensitive surfaces

Bugs cluster here. Probe these even when walking a flow that doesn't obviously touch them.

- **LAYERS tree** — name truncation (`"New depl..."`), dup badge artifacts (name == badge), wrong indentation, collapsed state lost on scene switch
- **Audit summary in right panel** — can drift from `/platform/api/audit?sceneId=X`. UI reads a boot-cached payload first; mismatch = stale boot payload or a layout race
- **Export preview iframes** — beige rectangle = body-bg regression (the exporter must paint body with the scene root's fill; without it the iframe is transparent over the beige modal)
- **Brand-browser modal** — Esc handler and backdrop click must both close. × only isn't enough; keyboard users get trapped
- **Canvas at narrow viewport** — below ~720 px both asides must collapse, otherwise `#reframe-viewport` computes to width:0 and CanvasKit silently refuses to render
- **Chat chip row (`[data-bc-chips]`)** — selection / brand / viewport context chips reflect `state.currentViewport` + `state.selection`. If they desync from the canvas, the agent gets wrong `[Scope: …]` prefix in its prompt

## Anti-regression smells

A recognizable **smell** means a specific recent bug has come back. Each one is a two-second check with `probe` or a screenshot.

| Smell | Means | Quick probe |
|---|---|---|
| Export iframes show beige | exporter body-bg regressed | `probe js: document.querySelector('.export-preview iframe').contentWindow.getComputedStyle(document.querySelector('.export-preview iframe').contentDocument.body).backgroundColor` → expect rgb close to scene root fill, not rgba(0,0,0,0) |
| LAYERS row shows `"X"` twice | layer-name + layer-badge dedup regressed | `probe selector: .layer-item` all=true; each item's `text` should not contain the same word twice |
| Canvas `width="0"` on mobile | asides didn't collapse under the media query | `probe js: document.getElementById('reframe-viewport').getBoundingClientRect().width` at 390 viewport |
| Rebrand toast says "Brand picker unavailable" | `openBrandBrowser()` fallback got lost | Modify → Rebrand click then probe for `.brand-browser` — it must exist |
| Audit shows N warnings in UI, `/api/audit` returns 0 | boot payload ran audit before Yoga settled | boot-payload.ts must call `ensureSceneLayout` before audit |
| Chat stream button shows [□] forever | agent subprocess crashed silently | check `/platform/api/chat/status` or sidecar log; the [▶] should return within ~20s |
| Preview → Mobile doesn't reflow canvas | viewport macro handler stuck on legacy `.vp-btn` click | toast should say "Previewing at mobile width…", not "Viewport → mobile" |
| Dashboard cards full-width on mobile but text clipped in thumb | `.overview-thumb` aspect regression, unrelated to the sidebar collapse |

When you find a new smell: drop it into this table. Treat it like a test — the shape of the signature + the one-liner to detect it.

## Known gotchas

- **CanvasKit init takes 2-3 s** — always `wait` for `canvas` to be visible before clicking into the viewport. First paint after navigation is not canvas-ready.
- **`reframe_design list` needs network** — if offline (`ETIMEDOUT`), seed brands into `.reframe/brands/` manually or skip brand flows.
- **First audit after boot can false-positive sibling-overlap** — Yoga's multi-pass converges after any graph mutation. If you see N warnings on a fresh load that vanish after one click, it's this, not a real regression.
- **`.bc-bubble.bc-assistant`** is the correct streaming-reply selector (NOT `.bc-bubble-ai` or `.chat-reply`). Also `.bc-bubble.bc-user` for your side of the log.
- **Macro dropdowns don't auto-close on item click** — you have to press `Escape` or click elsewhere after selecting a macro-item. This is existing UX, not a bug.
- **Session GC at 15 min idle** — long-running QA sessions should re-open, not sleep. Every `reframe_ui.close` sibling-reclaims memory.
- **Selectors to prefer over text-match**: `[data-testid=...]` > `#id` > `[data-bc-input]`-style data-attrs > `.class:has-text("...")`. Text-match is volatile across i18n / copy changes.

## How to run a sweep

Minimal sweep (fast, covers the 11 flows):

```
1. open /platform  → probe cards, click first
2. open /platform/project/<first-slug>  → wait canvas, press Escape, scene action
3. act: click Modify, click Scale spacing, hover, click Spacious +20%, screenshot
4. act: type in chat input, press Enter, wait for .bc-bubble.bc-assistant
5. act: click Preview, click Mobile, screenshot
6. act: click Export, wait for iframe, screenshot, probe iframe body bg
7. setViewport {width:390,height:844} → screenshot dashboard, project canvas
8. state: set a key, reload, state get → verify key survived
```

Emit findings in two tiers:

- **Fix** — smell detected → fix in code + re-probe to verify
- **Smell Log** — unknown issue → add a row to the anti-regression table with the probe signature so next sweep catches it faster

## When NOT to use this skill

- Designing / editing a scene → `reframe-design`
- Loading a brand → `reframe-brand`
- Generating a multi-page site → `reframe-site-loop`
- Unit-testing the engine → `packages/core/src/tests/*.test.ts` via `npm test`

The scope here is interface-layer regressions. Engine bugs go through the audit + test path.
