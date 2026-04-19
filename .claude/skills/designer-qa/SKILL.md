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

This is the **sibling** of the engine QA work in `packages/core/src/tests/`. Those prove the engine in isolation. This proves **the whole stack as a designer experiences it** — the browser-side UI *and the rendered scene that comes out the other end*. UI flow bugs live in `packages/mcp/src/platform/`; render/import/layout bugs live in `packages/core/`. You look for both.

**Critical rule: never end a sweep without looking at the rendered scene.** A flow that "works" (clicks land, toasts fire, no console errors) can still ship a broken scene — text clipped, siblings overlapping, wrong fill, collapsed row, corrupt import. The UI won't tell you. The canvas will. After every mutating flow (chat edit, rebrand, macro, compile, export), run a **render check** (see below) before declaring the step green.

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

**Screenshot hygiene — hard rule.** No single image may exceed **2000 px on any side**, or the platform rejects it ("exceeds the dimension limit for many-image requests") and the session is polluted. Reframe canvases are routinely 1440×3000+, so:

- **Never** call `screenshot fullPage: true` on a scene page. Default to `selector` clips.
- For the canvas: screenshot `selector: '#reframe-viewport canvas'` — it's viewport-bounded.
- For a long scene you need end-to-end: split into clips of height ≤ 1800 (`clip: {x:0, y:0, width:1440, height:1800}`, then `y:1800, height:1800`, etc.).
- Before any fullPage-style capture, cap viewport: `setViewport {width: 1440, height: 900}` — never 1920×2000+.
- If a response comes back rejected, **do not retry the same call** — re-frame as a selector or clip. A retry with the same params re-pollutes the context.

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

## Before you probe — rebuild ritual when UI JS changed

The Platform UI JavaScript is **concatenated at build time** from `packages/mcp/src/platform/ui/*.js` into `packages/mcp/dist/mcp/src/platform/platform-ui.js`, and the sidecar reads that bundle **once at module load** (`scripts.ts → PLATFORM_JS = loadPlatformJs()` — a module constant, not a per-request read). Two silent traps follow:

1. **Source edits don't reach the browser until the bundle is rebuilt.** Editing `150-sidebar.js` or `160-init.js` and reloading the tab serves the stale bundle — your fix is invisible.
2. **Rebuilding the bundle doesn't reach the browser until the sidecar restarts.** `PLATFORM_JS` is captured on process start; a fresh bundle on disk is ignored until the process is killed and re-spawned.

Before claiming a UI fix verified, ALWAYS:

```bash
# 1. Rebuild the bundle (copies & concatenates ui/*.js → dist/platform-ui.js + rebuilds editor-bundle.js).
node scripts/copy-platform-assets.mjs

# 2. Restart the sidecar. On Windows it's listening on :4100, find + kill + relaunch:
netstat -ano | grep ":4100 " | head -1           # grab the PID from column 5
taskkill //F //PID <pid>                          # Windows, bash shell syntax
node packages/mcp/dist/mcp/src/http-server.js &   # relaunch in background

# 3. In a Playwright session, session may have been closed by the sidecar death — reopen.
```

Then **confirm fix is live before testing**: `reframe_ui probe js=(window.refreshLayersTree||function(){}).toString().includes('_refreshTreeTimer')`. If `false` the sidecar is still serving the old bundle; don't proceed — restart again.

Warning signs that the old bundle is still live:
- Network panel floods with identical requests on a single user interaction (`scene/tree` ×100, `audit` ×50, etc.). If your fix was supposed to coalesce, it's still on old code.
- Browser fetches `/platform/app.js` and the response size has not changed from before your source edit.
- `ERR_INSUFFICIENT_RESOURCES` on innocuous-looking GETs — that's the browser's "too many concurrent requests" circuit breaker tripping.

## Render-scene QA — the second half of every sweep

A UI flow that completes cleanly can still produce a broken scene. Engine import / layout / paint bugs only surface when you look at the output. After every mutating flow, do this:

1. **`reframe_inspect`** on the current sceneId — read the audit warnings, the 8 aesthetic metrics, the semantic skeleton. Warnings > 0 that weren't there pre-edit = a regression worth logging. Aesthetic metric dropping hard (e.g. alignment 0.9 → 0.4) = visible damage.
2. **Screenshot the canvas, not the page.** Use `reframe_ui screenshot` with `selector: '#reframe-viewport canvas'` (or the scene-root equivalent in preview/export). **Never `fullPage: true` on tall scenes** — see screenshot-size gotcha below.
3. **Compare skeleton vs. render.** If the semantic skeleton claims `[nav] 1440×84` but the screenshot shows nav overlapping the hero, that's a Yoga/import mismatch — log it, then hand the repro HTML to the engine side (`packages/core/src/tests/`).
4. **Cross-check export.** `reframe_export` → html + png. If the PNG body is the wrong color, or the html iframe shows the beige modal bg, the exporter regressed (not the canvas renderer) — different bug, different fix path.

**Render-side smell rows** (add to the table above when you find new ones):

| Render smell | Likely engine bug | Quick probe |
|---|---|---|
| Siblings visually overlap at narrow viewport | Yoga multi-pass didn't converge OR flexBasis regression on HUG parents | `reframe_inspect` — look for `overflow` / `sibling-overlap` warnings; re-run at 1440 to confirm it's viewport-only |
| Text node rendered clipped / single line when skeleton says `690×221` | text measurement desync — font not loaded at measure time | probe `document.fonts.status`; re-screenshot after `document.fonts.ready` |
| Scene root paints transparent over page bg | import lost root fill OR exporter body-bg regression | `reframe_inspect` root node — check `fills[0]` exists and is solid |
| Grid section collapses to one column though `grid-template-columns: repeat(3, 1fr)` | linkedom grid import regression (the `data-reframe-idx` mismatch class) | re-compile the source HTML standalone, diff resulting tree |
| Button height < 44 px in render but skeleton says 44 | min-height not propagating from HUG to fixed | audit should already flag; if not, audit rule regressed |
| Full-width section renders 1440 inside a 1920 viewport | fixed-px on stretching container — taste rule broken on generation side | fix source HTML (`width: 100%` on stretch), recompile |
| Centered hero with 5+ elements | slop-signature regression from `reframe-design` | not an engine bug — log against the *generation* skill, not the engine |
| Inspect shows root CANVAS "Page 1" 100×100 while FRAME child is 1440×N | html.ts line 178-184 writes page dims but something later resets — OR `resolveScene` picks CANVAS over FRAME as rootId | `reframe_inspect sceneId=<just-compiled>` — read first line. If `(100×100)` despite compile log saying 1440×N, this regressed |
| Button with `height:48;padding:14px 22px` inside `<div style="display:grid;...">` → `<div>` (plain block) → `<button>` chain renders 100×48 with text clipped to ~56 wide | plain block `<div>` imported as VERTICAL flex w/ stretch; button loses HUG and stretches or collapses | compile `<div style="display:grid;grid-template-columns:1fr 1fr"><div><button>Start in 30 seconds</button></div><div>x</div></div>` → inspect → button should be ~213×48, not 668×48 or 100×48 |
| Old saved .scene.json files have frozen-in buggy sizes | engine fixes don't retro-apply to stored JSON | re-compile source via `reframe_compile file=...` and re-save (`reframe_project save`). Don't trust `scenes/*.json` as ground truth for current-engine behaviour |

The last row matters: designer-qa is the **only skill that sees the full stack**, so it's the right place to catch generation-side taste regressions that slip past `reframe-critic`. Don't "fix" them here — log and route.

## Known gotchas

- **CanvasKit init takes 2-3 s** — always `wait` for `canvas` to be visible before clicking into the viewport. First paint after navigation is not canvas-ready.
- **Screenshot size limit: no dimension may exceed 2000 px.** The image tool rejects anything larger with "exceeds the dimension limit for many-image requests (2000px)" and pollutes the session context. Rules:
  - Never use `fullPage: true` on a scene — reframe canvases are routinely 1440×3000+.
  - Default to `selector` clips (e.g. `#reframe-viewport`, `.export-preview iframe`, a specific panel) — they're naturally bounded.
  - If you must capture the full scene, split vertically: two or three screenshots via `clip: {x, y, width, height}` with height ≤ 1800 px each.
  - For responsive sweeps, set `setViewport` to ≤ 1920 width before shooting the viewport.
  - If a shot comes back rejected, discard it — don't retry the same call — and re-take with a selector / clip.
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
