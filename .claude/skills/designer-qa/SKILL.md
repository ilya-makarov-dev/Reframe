---
name: designer-qa
description: Use when asked to test, audit, stress, or regression-check the reframe Platform UI end-to-end — "test the UI", "run QA on Platform", "pretend you're a senior designer using the app", "find bugs in the dashboard". Drives Chromium via the reframe_ui MCP tool. DEFAULT mode is to ASK what to probe or propose 2-3 non-obvious tests — never auto-walk the canonical sweep unless the user explicitly asks for "full / canonical / Level 1 / прогон по всему". The platform map inside is orientation, not a checklist. NOT for designing scenes — that's reframe-design.
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

## First move — ASK or PROPOSE, never auto-walk

You *live in this app*. You don't walk the map to prove it exists — you walk it when someone points at a specific room. The `/designer-qa` slash command is a **conversation opener**, not an execution trigger.

When `/designer-qa` fires, branch on how concrete the ask is:

- **Concrete target** ("test the right panel + canvas bg", "check chat → rebrand round-trip", "find overlap bugs at 768 px", "поломай именно вот это") → go straight to THAT surface. Use the Platform map (below) to orient, open Chromium, probe. Do NOT warm up with unrelated flows.
- **Vague ask** ("test the UI", "QA the platform", "sweep the flows", "/designer-qa" with no args) → **stop before opening Chromium.** Pick one based on complexity:
  1. **Ask** what layer / flow / bug hypothesis is interesting right now — for the simplest asks. ("Какой слой сейчас беспокоит? Правая панель? Чат? Экспорт? Баг, который ты видел глазами?")
  2. **Propose 2-3 non-obvious test ideas** tied to what's actually interesting — recent commits, open 🔴 in the smell table, under-probed surfaces (brand-state leak on 5th rebrand, token drift on scene 3, chat-context loss on long threads, export-vs-canvas visual diff, `/preview/:id` desync from editor). **For each idea, name the CLASS of bug it would catch** — not what it does. Then let the user pick.
  3. **Route to `reframe-enhance`** — when the user's ask is complex enough that a structured QA brief would prevent ad-hoc re-interpretation next session. enhance reads this skill's Platform map + Fault-localization, asks ≤ 2-3 questions, produces a SCOPE + CLUSTERS + FAULT-LOCALIZATION + DELIVERABLE brief (see `reframe-enhance § Brief shape — QA target`), hands back. Then enter orchestrator mode against THAT brief instead of raw user words. See `CLAUDE.md § Orchestration → The enhance preprocessor`.
- **Explicit full-sweep opt-in** ("full / canonical / Level 1 / прогон по всему / walk all 11") → *now* use § How to run a sweep with parallel buckets. This is user-invoked, not default.

**Why this matters.** The user said, saved for all future sessions: *«он одно и тоже гоняет каждый раз — дичь»*. Running the canonical 11-flow sweep on every invocation is lazy and useless — the user already knows what the canonical sweep produces. Value comes from directed QA: a specific hypothesis, a cunning stress-case, or a surface that's rarely probed. Conversation first, execution second.

**Think like a resident, not a tourist.** A resident can localize a bug by symptom alone (see § Fault-localization below) and knows what probe to run first. A tourist walks the map. You are not a tourist.

## Orchestrator mode — you're the one skill that sees the whole stack

`designer-qa` is the **orchestrator** of the 7-skill system (see `CLAUDE.md § Orchestration` for the full role matrix and rules). The other six skills are specialists — each owns one mental model (write HTML, translate brand, review with ≤3 items, write brief, run site baton, export to React). You own the **cross-layer view**: engine, UI, export, brand, taste, tests. When a bug or cleanup spans layers, you dispatch to whichever specialist owns each layer, apply its judgment, fix, re-verify, log.

### Enter orchestrator mode when
- A rendering bug is half engine + half taste (which value is "right")
- Export differs from canvas — exporter + audit + possibly types.ts all in play
- A QA sweep found a pattern worth a regression test in `packages/core/src/tests/`
- A fix in one layer needs verification in another (engine patch → re-import test → UI probe)
- Brand rebrand chain surfaced a parser gap — patch `parser.ts` → re-extract → re-audit across N scenes

### Stay focused (don't enter orchestrator mode) when
- User's ask is single-layer and concrete ("does the right-panel update after canvas edit?") — answer in-layer, don't fan out
- User's ask is a design/review/brand task that just happens to hit a QA-shaped verb — route to the right specialist (CLAUDE.md's top-of-file table) and let them work

### How to dispatch a specialist

1. **Read its SKILL.md inline and apply the rubric yourself** — preferred when the work is tightly coupled to what you're already probing (e.g. running `reframe-critic`'s ≤3-item shape on the scene you just rendered).
2. **Spawn it as an Agent subagent** — preferred when the work is independent and self-contained (e.g. critic reviewing scene A in parallel while you keep probing scene B).
3. **Never rewrite a specialist's judgment.** Use its rules; don't replace them with your own.

### Regression tests — write them when the bug earns one

When a bug would have been caught by a test that doesn't exist yet, write the test:
- **Engine bug** → add a case to `packages/core/src/tests/` (or a new file if none fits)
- **UI bug** → the `reframe_ui` probe that reproduces it IS the test; log it as a smell row with the exact probe
- **Export bug** → engine test that compiles + exports + diffs the payload byte-for-byte

Bug closure = symptom → patch → proof. Skipping the proof means the next session learns nothing.

Full rules + role matrix + anti-patterns live in `CLAUDE.md § Orchestration`.

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
- For the canvas: screenshot `selector: '#canvas-area canvas'` — it's viewport-bounded.
- For a long scene you need end-to-end: split into clips of height ≤ 1800 (`clip: {x:0, y:0, width:1440, height:1800}`, then `y:1800, height:1800`, etc.).
- Before any fullPage-style capture, cap viewport: `setViewport {width: 1440, height: 900}` — never 1920×2000+.
- If a response comes back rejected, **do not retry the same call** — re-frame as a selector or clip. A retry with the same params re-pollutes the context.

## Platform map — know the territory like a resident

You already live here. This section exists so a fresh session inherits the same mental model instantly — **it is orientation, not a checklist**. Read it, hold it, use it to navigate the user's specific ask. Do NOT walk it end-to-end unless § First move routed you to a full-sweep opt-in.

### Routes
- `/platform` — **dashboard**. `.overview-card[href="/platform/project/<slug>"]` cards, time-of-day greeting, left rail (Home / Brandbook / active-brand switcher with SWITCH affordance). Entry point, never edit scenes here.
- `/platform/project/:slug` — **editor shell**. Four zones below. This is the room designers live in.
- `/preview/:sceneId` — **clean standalone preview**. No chrome, no chat, no panels. Scene painted on its own fill. Opens from Preview ▾ → "Open in new tab". Use this when you need to confirm the canvas paints correctly *without* the editor's beige body-bg leaking into the judgment.
- `/platform/app.js` — concatenated UI bundle (served from `packages/mcp/dist/mcp/src/platform/platform-ui.js`, built from `src/platform/ui/*.js`).
- `/platform/api/*` — JSON sidecar:
  - `GET /audit?sceneId=<id>` — live audit: findings (with `fix` recipes) + 8 aesthetic metrics + brandFidelity. Missing sceneId resolves via Referer.
  - `GET /manifest?slug=<slug>` + `GET /project?slug=<slug>` — project state: scenes, `activeBrand`, members. Aliases that return the same payload.
  - `GET /chat/status` — agent state (ready / thinking / tool-calling / streaming). Single source of truth for "is the agent busy?".
  - `POST /variations/apply` — macro ops (colorRotation, scaleSpacing, scaleRadius, …). Auto-defines tokens from `activeBrand` slug if missing.
  - `POST /agent/chat` — bottom-chat submit. Prepends `[Scope: node:… · brand:… · viewport:…]` from the chip row.
  - `GET /scene/tree?sceneId=<id>` — tree payload for LAYERS rail.
  - **SSE channel** broadcasts scene/tree + audit updates. The browser has multiple subscribers (LAYERS, right panel, chip row, canvas) — when ONE lags, that's usually the bug.

### The four zones of the editor shell
1. **Toolbar (top-center):** `Generate ▾ · Modify ▾ · Detach · Preview ▾ · More ▾ · Export (top-right)`. Home of macros, viewport switch, rebrand modal, export preview. Source: `140-toolbar.js`. Gotcha: submenus don't auto-close on item click — Escape or outside-click required.
2. **LAYERS rail (left):** `.layer-item > .layer-name`, indented by depth, role badges. Feeds from scene-tree SSE. Source: `150-sidebar.js`. Gotcha: historical name-dedup bug inherited deepest descendant text into every wrapper — fixed via `findFirst` depth-cap in `packages/core/src/importers/html.ts`. If two adjacent depths share identical names, that fix regressed.
3. **Canvas (center):** `main#canvas-area > canvas` (NOT `#reframe-viewport canvas` — that selector is historical). CanvasKit paints here; **2-3s boot after nav** — first click is a trap, always `wait` for visibility. Figma-like direct interaction via GraphBridge ↔ `@open-pencil/core`.
4. **Right properties panel:** selection-driven. Empty state = "Select a node to inspect". With selection → per-node controls (fills, text, layout, spacing, radius, shadows, typography) + root-level audit summary + brandFidelity strip. **This panel is the #1 suspect for drift** — it reads from multiple sources (boot cache, live SSE, direct API) and any one being stale desyncs it from the canvas.
5. **Bottom chat (`bc-*` namespace):** `[data-bc-input]` input, `[data-bc-chips]` scope chip row (selection · brand · viewport), `.bc-bubble.bc-user` / `.bc-bubble.bc-assistant` messages. Source: `105-bottom-chat.js`. Enter sends, Shift+Enter newlines. `window.reframeRenderBottomChips` is the global chip-repaint hook.

### State & hydration
- `window.__REFRAME_BOOT__` — full hydration payload on first paint: `project`, `manifest`, `scenes` keyed by id with `audit` pre-cached. Built by `packages/mcp/src/platform/boot-payload.ts`. Audit shape MUST match `/api/audit` — `findings[].fix={property,current,suggested,css}` + `brandFidelity`. Mismatch = stale boot payload.
- `localStorage` — chat history, last-opened project, theme, scene selection, viewport. Survives reload; wiped only on explicit clear.
- `StoreSync.pullFromMCP()` — on reload, pulls `/api/manifest?slug=` + `/api/audit?sceneId=` to repair drift between boot cache and live state. If this throws TypeError, one of those endpoints is 4xx'ing — check router.ts aliases.
- **Slug-vs-label gotcha:** `manifest.activeBrand` is always the SLUG (`"linear"`). `scene.brand` stores the display LABEL (`"Inspired by Linear"`). Feeding one to the other has bitten the variations pipeline — `loadBrandFromProject` expects slug.

### The data-flow loop to hold in your head
```
user mutates something (click / drag / chat / macro / keyboard)
       │
       ▼
UI fetch  /platform/api/...       OR    direct  reframe_edit  call
       │                                        │
       ▼                                        ▼
engine mutates scene  (packages/core/src/)
       │
       ▼
SSE broadcasts  (scene/tree + audit)
       │
       ├──▶  canvas repaint            (CanvasKit via GraphBridge)
       ├──▶  LAYERS rail repaint       (150-sidebar.js)
       ├──▶  right-panel repaint       (property wiring)
       ├──▶  chip-row repaint          (window.reframeRenderBottomChips)
       └──▶  audit summary repaint     (boot cache OR /api/audit fresh)
```
When the user reports "X did not update", name the **subscriber that didn't hear**. That is the bug's address — not "the app broke". One subscriber out of sync ≠ full app broken.

### Rituals the native has internalized
- **UI JS edits require rebuild + restart.** `ui/*.js` concatenates at build time into `dist/platform-ui.js`; the sidecar captures that bundle at process start as a module constant. Edit → `node scripts/copy-platform-assets.mjs` → kill :4100 → relaunch → probe to assert fix is live. See § Before you probe for the full ritual. Skipping this means your fix is invisible and you'll debug a ghost.
- **Engine fixes (`packages/core/`) reload on next MCP call** — no bundle rebuild, no sidecar restart.
- **First-audit-after-boot false positives.** Yoga multi-pass hasn't converged yet; sibling-overlap warnings often vanish after one user interaction. Click once, re-read before filing.
- **Screenshot size limit: 2000 px per axis.** `fullPage: true` on a scene page blows it (canvases are 1440×3000+). Clip with `#canvas-area canvas` selector or manual `clip:{x,y,w,h}` chunks.
- **Session GC at 15 min idle.** Long sessions: re-open, don't sleep.
- **One-shot scene snapshot:** `reframe_ui action=scene` returns tree + live audit + selection + brand + viewport in one call. Use it instead of five probes.

### The eleven canonical journeys — pointers, NOT a script
When — and only when — the user asks for the full canonical sweep ("full / Level 1 / canonical / прогон по всему"), these are the eleven surfaces to cover. One line each, so you know where each journey lives on the map above. You do **not** walk them in order, and you do **not** walk them at all for a scoped request.

1. **Dashboard landing** → `/platform`, card grid, first card → project
2. **Project canvas load** → `/platform/project/:slug`, canvas boot, LAYERS populates, right panel shows root audit
3. **Chat edit round-trip** → `[data-bc-input]` submit → `.bc-bubble.bc-assistant` reply with tool-call block → canvas repaint
4. **Viewport switch** → Preview ▾ → Mobile/Tablet/Desktop; chip updates, toast matches `/Previewing at .* width/`
5. **Rebrand flow** → Modify ▾ → Rebrand… → `.brand-browser` modal; Esc + backdrop + × all close
6. **Modify macros** → Scale spacing / Corner radius / Shadows / Rotate colors / Typography preset; canvas visibly reflows per click
7. **Export preview** → top-right Export → modal with two iframes; body bg matches scene root fill (not beige leak)
8. **Generate macros** → Generate ▾ → Variants / Regenerate / Responsive; siblings queue
9. **Detach / Preview new-tab / QR** → Detach, Preview "Open in new tab" → `/preview/:sceneId` fresh tab
10. **Responsive sweep** → setViewport 390 / 768 / 1440 / 1920; asides collapse ≤ 1024 px; canvas never width:0
11. **State + reload** → localStorage survives; scene selection, viewport, chat history restored after close + reopen

## Sensitive surfaces

Bugs cluster here. Probe these even when walking a flow that doesn't obviously touch them.

- **LAYERS tree** — name truncation (`"New depl..."`), dup badge artifacts (name == badge), wrong indentation, collapsed state lost on scene switch
- **Audit summary in right panel** — can drift from `/platform/api/audit?sceneId=X`. UI reads a boot-cached payload first; mismatch = stale boot payload or a layout race
- **Export preview iframes** — beige rectangle = body-bg regression (the exporter must paint body with the scene root's fill; without it the iframe is transparent over the beige modal)
- **Brand-browser modal** — Esc handler and backdrop click must both close. × only isn't enough; keyboard users get trapped
- **Canvas at narrow viewport** — below ~720 px both asides must collapse, otherwise `#reframe-viewport` computes to width:0 and CanvasKit silently refuses to render
- **Chat chip row (`[data-bc-chips]`)** — selection / brand / viewport context chips reflect `state.currentViewport` + `state.selection`. If they desync from the canvas, the agent gets wrong `[Scope: …]` prefix in its prompt

## Fault-localization — symptom → layer (where a resident looks first)

A tourist runs fifteen probes. A resident runs one — the one aimed at the layer they already suspect. Use this table to pick that probe. For any bug symptom the user reports, translate it to a **subscriber that didn't hear** from the data-flow loop above, or to the layer most likely to own the regression.

| Symptom | Most likely layer / owner | First probe |
|---|---|---|
| Canvas looks wrong (overlap, clipped text, 0-height button, wrong fill) | engine — `packages/core/src/` importers, layout, paint, audit | `reframe_inspect sceneId=X` — audit warnings + tree; check if skeleton dims match render |
| Button "does nothing" / toast lies / dropdown won't close / item click is a no-op | UI — `packages/mcp/src/platform/ui/*.js` | `probe` for the expected DOM mutation; if missing → bundle likely stale OR handler misbound |
| Right panel shows stale props after canvas edit; LAYERS ok | right-panel subscriber on property wiring (`150-sidebar.js` / panel render) | verify LAYERS DID repaint — if yes, right-panel is the desync. Check if the selection changed IDs under it. |
| LAYERS rail stale while canvas is correct | SSE subscriber for tree in `150-sidebar.js` | hit `/api/scene/tree?sceneId=X` — does fresh fetch match canvas? if yes, SSE subscriber didn't fire |
| Exported html/png differs from canvas | exporter — `packages/core/src/exporters/` | `reframe_export format=html` + open file → compare body bg, root fill vs live canvas |
| Chat agent forgets context / wrong scope prefix | chip-row desync OR `/api/agent/chat` prompt builder | probe `.bc-chip[data-chip-kind=*] .bc-chip-label` — matches `state.currentViewport` + `state.selection`? |
| Reload loses state / `StoreSync.pullFromMCP` TypeError | router aliases or boot-payload shape | direct hit `/api/manifest?slug=X` + `/api/audit?sceneId=Y` — any 4xx? compare to `__REFRAME_BOOT__` |
| Rebrand leaks prior brand's accent | token binding — `defineTokens` + `rotateColors` | diff `reframe_inspect` tokens before/after; check `manifest.activeBrand` is slug, not label |
| Macro runs but canvas didn't reflow | SSE subscriber for tree OR macro returned `{ok:true}` but didn't mutate | compare scene revision before/after; if unchanged → API handler skipped; if changed → subscriber dropped |
| First-paint warnings that vanish on second probe | Yoga multi-pass, NOT a bug | click once, re-read. File only if warnings persist after interaction |
| Audit count drifts between right panel and `/api/audit` | stale boot cache | compare `__REFRAME_BOOT__.scenes[id].audit` vs fresh fetch |
| Session dies between calls | sidecar GC (15 min idle) OR MCP bridge hiccup | `reframe_ui list` — if empty, reopen. Don't retry the same call on a dead session |

**Heuristic of last resort:** when you can't localize, the data-flow loop diagram is your checklist. Walk upstream from the symptom — render surface → its subscriber → SSE → engine mutation → API handler → user input. The bug is the first link that didn't pass.

## Anti-regression smells

A recognizable **smell** means a specific past bug might have come back. Each row is a 2-second pre-flight. Format:

- **st**: `🔴` open · `🟢` fixed (guard against re-emergence — check only if something suspicious nearby) · `🟡` watch (flaky, conditional)
- **surface**: `engine · api · toolbar · canvas · chat · export · modal · layers · import`
- **sentinel**: a single grep-able or machine-checkable signature — HTTP status + error string, `probe` result, selector count, computed style. Prose descriptors go in parens, they're not the match key.
- **probe**: the one call that detects it.

During a sweep, batch-probe all `🔴`/`🟡` rows at pre-flight. Skip `🟢` unless a mutation nearby fired an unexpected warning — then revisit. Fix recipes live in the **Fix log** at the bottom of this file, keyed by sentinel — consult when a `🟢` row flips back to `🔴`. Don't paste recipes into the smell table; git history is authoritative.

| st | surface       | sentinel                                         | probe                                                                                                   |
|----|---------------|--------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| 🟢 | export        | iframe body bg ≠ scene root fill                 | `probe js:` iframe's computed body bg — expect rgb(8,9,10) for Linear dark, not rgba(0,0,0,0) or beige  |
| 🟢 | layers        | consecutive depth levels share exact name        | `probe selector:.layer-item all:true` — no two adjacent depths with same `.layer-name` text             |
| 🟢 | canvas/mobile | canvas pane ≤ 40 % of viewport width at ≤ 768 px | fixed 2026-04-20 via `layout/asides` breakpoint raise; re-verified at 390 + 768 (#reframe-viewport width=390/768, asides=0/0) |
| 🟢 | toolbar       | Modify → Rebrand toast reads "Brand picker unavailable" | click Rebrand → `.brand-browser` attached                                                           |
| 🟢 | boot          | UI warning count ≠ `/platform/api/audit` count   | was a measurement artifact — `consumeBootSection(id,'audit')` in 010-core.js nulls the payload after first read (one-shot cache by design). Probe boot.audit BEFORE any consumer fires, or compare via raw HTML grep `"audit":{` — current render matches /api/audit score 97 / 3 info |
| 🟡 | chat/agent-latency | `.bc-send` spinner > 25 s · `.bc-bubble.bc-assistant` > 25 s (observed 55 s) | LLM backend latency on complex edits — Claude API p95 sits there. Not a code-side bug: merged into one "non-debt" row. Mitigation would live in agent.ts streaming (partial-token flush), not in QA-layer code |
| 🟢 | toolbar       | Preview → Mobile toast "Viewport → mobile" (legacy) | post-click toast text matches `/Previewing at .* width/`                                             |
| 🟢 | dashboard     | `.overview-thumb` bbox.height < 100 at 1440      | re-verified 2026-04-20 — `aspect-ratio: 16/10` on thumb holds: at vp=1440 card w=263 → thumb h=163; no regression                                                    |
| 🟢 | api/variations| POST `/variations/apply kind:colorRotation` → 400 "no tokens" | same request → 200 {ok:true} (auto-defines from activeBrand)                                   |
| 🟢 | toolbar       | Generate→Responsive click leaves bc-input empty  | probe `[data-bc-input].value` contains "responsive variants" after click                                |
| 🟢 | modal/export  | Escape on Export preview keeps modal open        | open Export → press Escape → `.export-preview` detached                                                 |
| 🟢 | core/edit     | `path:"Hero"` → UPDATE ERROR "Hero" not found    | re-verified 2026-04-20: `reframe_edit op:update path:"role:heading"` + `path:"text:shipping fast"` both return `UPDATE "h1" — characters`. `findNode` role/text prefixes (edit.ts · 2026-04-20 Fix log) remain live |
| 🟢 | compile       | re-compile file= without height drops height to default | compile file+name only, no height → new scene.height === prior scene.height                      |
| 🟢 | chip/viewport | Preview→Mobile changes canvas but chip still "desktop" | post viewport click → `.bc-chip[data-chip-kind=viewport] .bc-chip-label` matches new vp          |
| 🟢 | chat/bc-input | press Enter appends \n (value ends in `\n`)      | type + press Enter (no Shift) → `.bc-bubble.bc-user` count +1 within 500ms                              |
| 🟢 | dashboard/grouping | scenes sharing first hyphen-token collapse to one project | seed 3 scenes with distinct first tokens → 3× `/platform/project/<slug>` returns 200; with shared token only owner's 200, rest 404 |
| 🟢 | api/reload | `/platform/api/audit` → 400, `/platform/api/manifest?slug=` → 404, `/platform/api/project?slug=` → 404 | fixed 2026-04-20: router resolves missing sceneId from Referer; aliases for /manifest + /project return project payload |
| 🟢 | boot/audit | `__REFRAME_BOOT__.scenes[<id>].audit` is null/undefined while `/platform/api/audit?sceneId=<id>` returns findings | fixed 2026-04-20: `buildAuditResult` in boot-payload.ts aligns shape with /api/audit (findings[].fix, brandFidelity); silent catch now logs |
| 🟢 | layout/asides | at ≤ 1024 px both asides collapse; canvas pane = 100 % of viewport | fixed 2026-04-20 editor-shell-page.ts: media query raised to 1024 px, full `grid-template` shorthand + `!important` beats the base shorthand |
| 🟢 | toolbar/dropdown | Escape after Modify dropdown does NOT dismiss the menu/submenu | fixed 2026-04-20 140-toolbar.js `bindMacroDropdowns` — capture-phase `keydown` Escape handler closes `[data-macro-menu]` + `.macro-submenu.open`; outside-click now also closes open submenus. Re-verified: Modify→Esc, Modify→submenu→Esc both clear |
| 🟢 | toolbar/overlap | Export button overlaps More-dropdown chevron at 768 × 1024 | fixed 2026-04-20 editor-shell-page.ts 1024px media query — `.macro-dropdowns { display: none !important; }` at ≤1024. The absolute-positioned macro pill lost its side rails once sidebars collapsed; hiding it removes the collision. Generate/Modify/Preview/More remain reachable via bottom chat palette and agent prompts at mobile/tablet |
| 🟢 | docs/selector-drift | canvas lives at `main#canvas-area > canvas`, not `#reframe-viewport canvas` | already resolved in SKILL.md § Tool + screenshot hygiene (2026-04-20). Row kept as 🟢 regression guard — if anyone restores the old `#reframe-viewport canvas` selector anywhere in skill docs, this row points at the correction |
| 🟢 | export/iframe-html-bg | iframe `<html>` has no explicit bg, so when iframe content is shorter than the iframe frame, modal beige bleeds through between body and iframe edge | fixed 2026-04-20 exporters/html.ts — `rootBgForBody(root, graph)` now applied to both `html` and `body` selectors |
| 🟢 | export/fixed-child-shrink | FIXED-sized child in flex parent renders bbox.width=0 when a sibling has long wrapping text (badge vanishes under text pressure) | fixed 2026-04-20 exporters/html.ts primary-axis branch — emit `flex-shrink: 0` alongside `width: Npx` for FIXED children; default shrink:1 let browser crush the badge to 0 |
| 🟢 | layers/stale-text-name | reframe_edit updates `characters` on a TEXT node → LAYERS still shows the import-time frozen name ("Set per-person limits, ca" after shortening to "Set spending limits…") | fixed 2026-04-20 150-sidebar.js — TEXT nodes with text now display the live text (truncated to 28) as displayName instead of the frozen `node.name`; chat edits reflected immediately |
| 🟡 | boot/brand-leak | `activeBrand` persists across project switches — new/empty project inherits prior session's brand (e.g. qaa-2026 opens reporting "Active brand: Inspired by Airbnb") | **architectural, needs-pr.** Current .reframe/ dir holds ONE `project.json` with ONE `activeBrand` slot; dashboard "projects" are virtual groupings of scenes sharing that dir. Fixing requires per-virtual-project manifest shards + router resolution — out of ≤40-line fix budget. Workaround: `reframe_project set_active_brand` after every project switch |
| 🟢 | ui-session/gc | Playwright session GC'd well under the 15-min idle window (observed 30–60 s during active bucket walks) | re-verified 2026-04-20 — `ui-session.ts` `IDLE_TIMEOUT_MS = 15 * 60 * 1000` (15 min) is correct and unchanged. The "under-15-min" observation was **sidecar restart side-effect**: every rebuild (`copy-platform-assets.mjs`) kills :4100, which closes the Playwright browser, which drops all sessions. Expected, not a code bug. Lesson: after rebuild, always `reframe_ui open` fresh — don't reuse a session id from before the restart |
| 🟢 | dashboard/heading-overlap | project-card heading + description overlay the top of the dark thumb | re-verified 2026-04-20 at vp=1440 — thumb bbox ends at y=461, name bbox starts at y=475. No overlap; card structure is `<thumb>` then `<meta>` stacked vertically inside `.overview-card` (display:block). Smell was a stale observation. Separate product issue fixed same day: `.overview-name` showed scene-root INode name ("Stack", "Row") instead of project slug — added `stack/row/column/group/frame/canvas/body/html` to dashboard.ts `GENERIC_TAGS` fallback |
| 🟢 | toolbar/macro-submenu | Modify → submenu items render with bbox `{width:0, height:0}` | was a stale-probe-selector, not a real regression. Correct selector is `.macro-submenu-panel button` (inside `.macro-submenu.open`), not `.dropdown-submenu button` (class never existed). Re-verified: clicking `.macro-submenu-trigger` opens the panel with proper bbox, items respond to clicks. CSS uses `display: none → flex` on `.open`/`:hover` — working as designed |
| 🟢 | right-panel/empty-state-on-boot | after reload with no persisted selection, right panel keeps the static "Select a node to inspect" HTML placeholder — Canvas-root controls (W/H + background + audit) never render until user presses Escape or clicks empty workspace | fixed 2026-04-20 160-init.js `tryRestoreProps` — when `!state.selection.inode` on first top-level call, invoke `clearPropsPanel()` so the scene-dashboard renders as the default empty state |
| 🟢 | canvas/deep-click-to-leaf | clicking a button on canvas selected its inner TEXT leaf (e.g. `button-text` 98×18) instead of the button frame; LAYERS+chip desynced because the leaf has no `data-layer-node` entry | fixed 2026-04-20 160-init.js `reframe:canvas-select` handler — before dispatching, walk `parentId` chain via `__reframeEditor.getNode` until an ancestor with `data-layer-node` is found; promote selection to that ancestor. First-meaningful-parent UX (Figma-like). Also fires `reframeRenderBottomChips` + `reframe:ui-state-changed` so the chip/LAYERS subscribers update too |
| 🟢 | right-panel/derived-dims-stale | after changing `font-size` on a TEXT node, panel's W/H inputs kept pre-edit values even though layout bbox reflowed | fixed 2026-04-20 160-init.js — `reframe:prop-changed` listener triggers `queuePropsRefresh()` (300ms debounce) for layout-affecting props (font-size, font-family, font-weight, line-height, letter-spacing, padding*, width, height, min-/max-*, gap, itemSpacing, text, characters). Re-verified: changed font-size 40→80→48 on h1, panel H tracks canvas bbox on each change |
| 🟡 | right-panel/multi-select-gap | Shift+click in LAYERS highlights N items, right panel + chip show only last-clicked | **product gap, not debt.** Requires panel renderer to compute common-prop intersection across N nodes + chip row to render "N selected" badge. Deliberate scope-out; implement when multi-select becomes a workflow. Moved to `.reframe/product-gaps.md` (outside this table) |
| 🟢 | dashboard/thumbnail-color-drift | project card thumbnail rendered an orange/red gradient for a scene whose root fill is `#fafaf9` | was a cache/loading artifact. `/cover/<id>.svg` is an intentional DECORATIVE fallback (procedural palette from sceneId hash) shown while the real `/thumbnail/<id>.png?scale=1` is cold-rendering via CanvasKit. After PNG loads (fade in ~240ms) it replaces the cover. Re-verified: PNG shows real scene content (cream features, dark footer) — matching canvas render. Not a bug |
| 🟢 | canvas/empty-state-paints-root-frame-fill | empty-state "Background" input routed to ROOT NODE fill (`data-node="root"` · `data-prop="background"` · POST /api/node/edit). Paint leaked through as a stripe where children didn't cover full root bbox (e.g. 1440-wide Section inside a 1600-wide root → 160px dark stripe on the right). User's mental model was correct: "Canvas" in empty-state = Figma-style workspace around frames, NOT the root frame itself | fixed 2026-04-20 — 110-properties.js renames the empty-state panel to `Canvas [workspace]` with subtitle "Nothing selected — edit the canvas around your frame", input now `data-prop="canvas-bg" data-workspace-key="reframe:workspace-bg:<slug>"` (no `data-node`). 120-widgets.js `bindPropInputs` intercepts `prop === 'canvas-bg'` BEFORE node-edit path: calls `applyCanvasBg(hex)` which (a) sets `--surface-canvas` CSS var on documentElement and (b) writes `__reframeEditor.state.pageColor = {r,g,b,a:1}` + bumps sceneVersion — **both layers required** because `@open-pencil/core/constants` has a hardcoded `CANVAS_BG_COLOR = {r:.96,g:.96,b:.96}` that the SkiaRenderer paints on every frame (`canvas.clear(ck.Color4f(pageColor.r, ...))` in renderer.js:480). Without pageColor override the CSS var is invisible — beige wins. Value persisted per project slug in localStorage; 160-init.js re-applies on boot (CSS var synchronously + retries `applyCanvasBg` at 200ms intervals until editor is wired). Scene root INode fill is now never touched from the empty-state control — select the root frame explicitly in LAYERS to edit that. |
| 🟢 | engine/grid-auto-rows-ignored | Bento `grid-template-columns: repeat(6,1fr); grid-auto-rows: minmax(200px, auto)` → cells collapsed to ~159px content-height. `resolveGridTrackToken` for `minmax(Npx, auto)` fell into AUTO(0) branch — lost the 200px minimum. Root scene also stuck at default 1080, overflowing footer | fixed 2026-04-20 — 3 engine fixes + 1 parser fix, all verified by grid-stress.test.ts (8 assertions pass). See Fix log entries 2026-04-20 for `grid-auto-rows field` / `minmax auto min` / `implicit row count from spans` / `post-layout height propagation` / `parser radius bullet-list` |
| 🟡 | engine/audit-autofix-radius-snap-to-smallest | With brand scale `[2,4,6,8,12,22,9999]`, audit `border-radius-compliance` auto-fix snaps EVERY off-scale radius to `2` (smallest), not nearest. E.g. `6 → 2`, `999 → 2`, `12 → 2` — visually destroys the design | **needs-pr.** snap algorithm in `packages/core/src/audit.ts` picks `scale[0]` instead of `scale.reduce((nearest, s) => |v-s| < |v-nearest| ? s : nearest)`. Workaround: compile with `audit: false` to skip auto-fix when brand is loaded. Real fix requires audit-rule redesign; over 40-line budget |
| 🟡 | engine/aesthetic-whitespace-penalizes-dashboards | Dashboard scenes hit whitespace=12% Poor, alignment=50% Fair — dragging overall to 63% when hierarchy/rhythm are 100%. Metric calibrated for marketing-page genre, misrates information-dense UIs | metric tuning needs density-aware calibration. Low priority — overall score is still informative; breakdown per metric is the useful signal. No code fix |

When you find a new smell: one row here (≤ ~110 chars per column), and if you fixed it, one line in the Fix log. Don't inline the recipe.

### Fix log

Short ledger of what was fixed, keyed to sentinel. Consult ONLY when a `🟢` sentinel flips back to failing — then the entry tells you where to look first. Format: `YYYY-MM-DD · sentinel-id · file:symbol · one-line why`.

- 2026-04-20 · export iframe body bg · `packages/core/src/exporters/html.ts` exporter writes body bg from scene root fill · historical
- 2026-04-20 · layer name dedup · `packages/core/src/importers/html.ts` `findFirst` depth-capped at 2 · prior heuristic inherited deepest descendant text into every wrapper
- 2026-04-20 · variations colorRotation 400 · `packages/mcp/src/platform/api/variations.ts` `ensureTokenIndex()` resolves project `activeBrand` slug → loads DESIGN.md → `tokenizeDesignSystem` + `autoBindTokensFromGraph` before call. Slug-vs-label gotcha: manifest.activeBrand is always the slug ("linear"); scene.brand stores the display label ("Inspired by Linear") — don't feed scene.brand to `loadBrandFromProject`
- 2026-04-20 · Generate→Responsive selector · `140-toolbar.js` handleMacroAction — read `[data-bc-input]` first; fallback to legacy `[data-agent-input]`; dispatch `input` event after `value=` so autosize fires
- 2026-04-20 · Export modal Escape · `140-toolbar.js` `showExportPreview` — `document.addEventListener('keydown', onEsc, true)` with capture (beats canvas Escape handler); remove on close
- 2026-04-20 · reframe_edit role/text lookup · `packages/mcp/src/tools/edit.ts` `findNode` — `path:"role:<role>"` and `path:"text:<substr>"` prefixes + automatic role/text fallback on single-segment miss. Unblocks agent after the name-dedup fix collapsed wrapper names to generic "Stack"/"Row"
- 2026-04-20 · compile height inheritance · `packages/mcp/src/tools/compile.ts` — when `name` matches a saved project scene AND no explicit `width`/`height`, read prior dims from `manifest.scenes[*]` so agent re-compile loops don't truncate tall canvases to 1080
- 2026-04-20 · chip repaint global binding · `105-bottom-chat.js` — assigns `window.reframeRenderBottomChips = renderChips`; toolbar was already calling it as a no-op fallback. Preview→Mobile now repaints chip immediately.
- 2026-04-20 · bc-input Enter to send · `105-bottom-chat.js` — Shift+Enter inserts newline; plain Enter / Cmd/Ctrl+Enter both submit. Was Cmd+Enter-only, so Slack/Discord-trained designers hit Enter, saw a newline, assumed broken.
- 2026-04-20 · api/reload endpoints · `packages/mcp/src/platform/router.ts` — `/api/audit` without sceneId resolves via Referer → `project.members[0].id`; added `/api/manifest?slug=` and `/api/project?slug=` aliases that return `{ok, slug, name, activeSceneId, scenes, activeBrand}` using existing `findProjectBySlug`+`getActiveBrand`. Closes StoreSync.pullFromMCP TypeError on reload.
- 2026-04-20 · boot/audit payload · `packages/mcp/src/platform/boot-payload.ts` `buildAuditResult` — aligned shape with `/platform/api/audit`: `findings[].fix={property,current,suggested,css}` + `brandFidelity`; replaced silent error swallow with `console.error` so future null-audit regressions are diagnosable.
- 2026-04-20 · layout/asides collapse · `packages/mcp/src/platform/pages/editor-shell-page.ts` inline `<style>` — breakpoint raised 720 → 1024 px; media override uses **full** `grid-template` shorthand + `!important` because the base rule uses shorthand (longhand column override alone loses at equal specificity). Gotcha for next editor: don't put backticks inside this inline `<style>` template-literal — they close the outer string and blank the page.
- 2026-04-20 · export iframe-html-bg · `packages/core/src/exporters/html.ts` — `rootBgForBody(root, graph)` now applied to the `html` selector AND `body` selector. Previously only `body` was painted, so when iframe height exceeded scene content the iframe's containing modal bg bled through the `html` gap. One-line addition to the style block; no byte-determinism impact for scenes ≥ full iframe height (they already cover the html background).
- 2026-04-20 · export flex-shrink FIXED children · `packages/core/src/exporters/html.ts` primary-axis branch — when emitting `width: Npx` / `height: Npx` for a FIXED-sized child of a flex parent, also emit `flex-shrink: 0`. Default `flex-shrink: 1` let siblings with long wrapping text crush the FIXED child to width:0 (e.g. a 32×32 badge in a row with a 2-line body text vanished while cards 1 + 3 rendered fine). FIXED = "this size, period" — shrink:0 is the correct CSS, width alone is a hint the browser ignores under pressure.
- 2026-04-20 · right-panel empty-state on boot · `packages/mcp/src/platform/ui/160-init.js` `tryRestoreProps` — added an early branch: if `!state.selection?.inode` on the top-level invocation (`attemptsLeft === 6`), call `clearPropsPanel()` once and return. `clearPropsPanel` already delegates to `renderSceneDashboard` when a session id exists, so the Canvas-root panel (W/H + background + audit) becomes the real empty state. Previously the panel stayed stuck on the static `<div class="props-empty">Select a node to inspect</div>` from `editor-shell-page.ts` until the user pressed Escape or clicked empty workspace — that interaction flipped the state machine, but cold boot never did.
- 2026-04-20 · canvas deep-click promotion · `packages/mcp/src/platform/ui/160-init.js` `reframe:canvas-select` handler — before writing state / showing props, walk ancestors via `window.__reframeEditor.getNode(id).parentId` until an ancestor has a `[data-layer-node=...]` entry (max 8 hops); promote `nodeId` to that ancestor. Fixes: clicking "Start free trial" button text selected its TEXT leaf (98×18, not in LAYERS) instead of the button frame (164×48, in LAYERS). LAYERS+chip desynced because the LAYERS-guard dropped the leaf id, but the right panel ignored the guard and rendered leaf anyway. Same patch also fires `reframeRenderBottomChips()` + `reframe:ui-state-changed` so chip + LAYERS subscribers repaint together with the panel.
- 2026-04-20 · toolbar Escape dismisses menu + submenu · `packages/mcp/src/platform/ui/140-toolbar.js` `bindMacroDropdowns` — added capture-phase `document.addEventListener('keydown', ..., true)`: when any `[data-macro-menu]:not(.hidden)` or `.macro-submenu.open` is present, Escape closes them all (menus, active button styling, submenus). Also extended the outside-click path to close open submenus. Keyboard users were getting trapped in a half-open Modify menu with no way out except clicking outside. Capture phase beats the canvas Escape handler (which deselects nodes), so when a menu IS open Escape closes it; when no menu is open canvas keeps Escape for deselect.
- 2026-04-20 · toolbar overlap at tablet vp · `packages/mcp/src/platform/pages/editor-shell-page.ts` inline `<style>` 1024px media query — added `.macro-dropdowns { display: none !important; }`. The macro pill is `position: absolute; left:50%; transform: translate(-50%,-50%)` which centered it over the header flex row; once sidebars collapsed at ≤1024 and the right-anchored Export button couldn't push it away, the pill overlapped Export and the More-dropdown chevron. Hiding it removes the collision cleanly — Generate/Modify/Preview/More remain reachable via bottom chat palette + agent prompts at mobile/tablet.
- 2026-04-20 · dashboard card name shows project slug not scene-root INode name · `packages/mcp/src/platform/pages/dashboard.ts` — extended `GENERIC_TAGS` with `stack`, `row`, `column`, `group`, `frame`, `canvas`, `body`, `html`. Linkedom-imported scenes land on these auto-inferred names ("Stack" for column flex, "Row" for row flex); dashboard.ts previously only checked HTML tag names (`div`, `span`, `section`, …) so the card showed "Stack" where the user expected "qa-landing". Now falls back to `p.slug` for every auto-inferred structural name.
- 2026-04-20 · right-panel derived-dims refresh on prop-change · `packages/mcp/src/platform/ui/160-init.js` — added `window.addEventListener('reframe:prop-changed', ...)` that calls `queuePropsRefresh()` (the existing 300ms-debounced re-fetcher used by `node-moved`/`node-resized`) when the edited prop is layout-affecting: `font-size|font-family|font-weight|line-height|letter-spacing|padding*|width|height|min-/max-*|gap|itemSpacing|text|characters`. Previously only the input the user edited was updated; derived Size W/H stayed at pre-edit values until a re-select. Fires the event from `editNodeProp` in 120-widgets.js (already dispatched there for CanvasKit re-hydration).
- 2026-04-20 · empty-state Background paints workspace, not root frame · **110-properties.js** `renderSceneDashboard` — renamed the empty-state block to `Canvas [workspace]` and changed the input from `data-prop="background" data-node="root"` to `data-prop="canvas-bg" data-workspace-key="reframe:workspace-bg:<slug>"` (no `data-node`, so the node-edit path is skipped). Initial value read from `localStorage[key]` first, falling back to `getComputedStyle(documentElement)['--surface-canvas']`, default `#E8E2D0`. Subtitle clarified: "Nothing selected — edit the canvas around your frame". **120-widgets.js** `bindPropInputs` intercepts `prop === 'canvas-bg'` in the generic change handler BEFORE `editNodeProp`, calling new helper `applyCanvasBg(hex)` + writing localStorage + updating the sibling swatch. `applyCanvasBg` does two things: (1) `document.documentElement.style.setProperty('--surface-canvas', hex)` — paints `#canvas-area` around the CanvasKit canvas element; (2) parses hex to `{r,g,b,a:1}` in 0..1 space and writes `__reframeEditor.state.pageColor`, bumps `state.sceneVersion`, calls `editor.requestRender()` — mandatory because `@open-pencil/core` has a hardcoded `CANVAS_BG_COLOR = {r:.96,g:.96,b:.96}` in constants.js that the SkiaRenderer clears the canvas with on every frame (`renderer.js:480 canvas.clear(ck.Color4f(this.pageColor.r, ...))`). Without (2) the CSS var only shows in the sliver of `#canvas-area` not covered by the `<canvas>` element — basically invisible. Fill-swatch click handler in 120-widgets.js also branches for `isWorkspace`: native color picker drives `applyCanvasBg` on `input` (live preview while dragging) + `change` (commit + persist). `enhanceColorPopover` path ALSO handles `canvas-bg` in `openColorPopover.commit()` — original commit unconditionally called `editNodeProp(sceneId, nodeId, ...)` with empty sceneId/nodeId for workspace swatches (POST silently failed). Live preview on `input` for popover hex + native picker for parity with swatch path. Input-event live preview added to main hex input too (typing feels responsive, not Enter-gated). **160-init.js** `init` restores on boot: reads `localStorage['reframe:workspace-bg:<slug>']`, sets CSS var synchronously (pre-paint), then `setInterval` retry loop calls `applyCanvasBg` every 200ms until `window.__reframeEditor` is ready (CanvasKit WASM boots 2-3s after DOMContentLoaded; pageColor writes before that are no-ops). Gives up after 30 tries. Scene root INode fill is never touched from this control — user must select the root frame explicitly in LAYERS to edit that.
- 2026-04-20 · engine/grid-auto-rows field · `packages/core/src/engine/types.ts` + `scene-graph.ts` + `serialize.ts` + `exporters/html.ts` — added `gridAutoRows: GridTrack | null` and `gridAutoColumns` on SceneNode. Parses from CSS `grid-auto-rows: <track>` in `importers/html.ts:3195` via existing `parseGridTemplate`. Layout engine in `engine/layout.ts:640` now prefers `gridAutoRows` over `FR 1` fallback when `gridTemplateRows` is empty. HTML exporter emits `grid-auto-rows` when set, keeping round-trip parity. Scenarios unblocked: Bento landing `grid-template-columns: repeat(6,1fr); grid-auto-rows: minmax(200px, auto)` + cells with `grid-row: span 2` — previously collapsed to 159px/row, now correctly 200px × 3 rows.
- 2026-04-20 · engine/minmax-with-auto-max · `packages/core/src/importers/html.ts` `resolveGridTrackToken` minmax branch — when `max === 'auto' | 'max-content' | 'min-content'`, fall back to the `min` argument's pixel value as `{type:'FIXED', value: minPx}` instead of collapsing to `AUTO(0)`. Common Bento idiom `minmax(200px, auto)` means "at least 200, grow if content needs more" — the 200 is authoritative, not discardable. Previously lost both the minimum AND any row-span math built on top.
- 2026-04-20 · engine/implicit-grid-row-count-from-spans · `packages/core/src/engine/layout.ts:635` — `numRows` computation previously `Math.max(gridTemplateRows.length, ceil(children.length / numCols))`, which ignored row-spans: 6 children on 6 cols → 1 implicit row, even when one child spanned 2 rows. Replaced with pre-placement simulation: walk children, track span-aware occupancy, take max `endRow` reached. Handles both explicit-placement and auto-placement with span-aware wrap. Fixes: Bento hero `grid-column: span 4; grid-row: span 2` sat in row 1 only (auto-rows had nothing to place them in).
- 2026-04-20 · engine/post-layout-height-propagation · `packages/core/src/engine/layout.ts:873` `computeAllLayouts` — after grid pass, walks the tree bottom-up and grows every VERTICAL container (scene root + column sections) whose declared height is smaller than sum(child bottoms). Previously scene root pinned at importer default 1080; a 728-px bento section + 88-px nav + 360-px hero + 80-px footer = 1256 total overflowed by 176px, painting footer outside the frame bounds. Editorial (2522), email (969), pricing (auto-grown from initial compute) all relied on this. **Critical constraint**: pure manual height math, NOT `computeLayout(rootId)` re-run. Earlier attempt re-invoked Yoga which overwrote `computeGridLayout`'s cell x/y coords (all 6 bento cells collapsed to top-left of grid frame). Yoga treats grid frame as a flex container when re-walking from ancestor; manual propagation reads child bottoms without recomputing children.
- 2026-04-20 · design-system/parser radius bullet-list · `packages/core/src/design-system/parser.ts:1518-1554` `parseDesignMd` — radius section now (a) falls back to carving `### Border Radius` sub-block out of the `## Layout` section body when no dedicated h2 exists (Linear/Stripe/Airbnb DESIGN.md all keep radius under Layout as h3), (b) extracts numeric radii from prose bullet lines like `- Micro (2px): Inline badges` via `/\((\d{1,5})\s*(?:px|%)?\)|:\s*(\d{1,5})\s*px/gi`. Previously the parser found no `scale: N N N` single-line format in Linear's DESIGN.md and fell back to default `[0,2,4,8,12,16]` — Linear's signature 6px "Comfortable" radius was then off-scale, tanking `brandFidelity.radiusCompliance` to 28% across every scene that used it. After fix: Linear scale extracted as `[2,4,6,8,12,22,9999,50]`, radiusCompliance → 100% for scenes whose radii match.
- 2026-04-20 · regression test grid-stress · `packages/core/src/tests/grid-stress.test.ts` — 4 scenarios × 8 assertions covering: (1) `grid-auto-rows: minmax(200px, auto)` imports as FIXED 200 + row-span child height ≥ 400, (2) implicit row count derives from rowSpan not `ceil(children/cols)`, (3) scene root grows past 1080 default for multi-section content, (4) grid cells retain distinct x/y after root-grow pass (no Yoga re-pass regression). Run: `npx tsx src/tests/grid-stress.test.ts` from `packages/core`. Passes 8/8.
- 2026-04-20 · layer panel stale TEXT name · `packages/mcp/src/platform/ui/150-sidebar.js` `renderLayerNode` — for TEXT nodes with absorbedText, override `displayName` to the live text (truncated to 28 chars) and blank `absorbedText` so it doesn't double-render as a preview quote. Fixes: chat agent updates `characters` via reframe_edit, LAYERS still shows the frozen import-time name ("Set per-person limits, ca") → reads as "nothing happened." Designer gets immediate visual confirmation after any text edit.

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

A UI flow that completes cleanly can still produce a broken scene. Engine import / layout / paint bugs only surface when you look at the output. "Padding 120 → 72, canvas reflowed from 4400 to 4352, toast fired" is not a pass — that's **mechanics**. The designer using this app doesn't care about the number; they care whether the result looks good. Three tiers, run after every mutating flow:

### Tier 1 — Mechanics (cheap, every mutation)

Engine-measurable regressions. Takes seconds.

1. **`reframe_inspect`** on the current sceneId — read audit warnings, 8 aesthetic metrics, semantic skeleton. Warnings > 0 that weren't there pre-edit = a regression worth logging. Aesthetic metric dropping hard (alignment 0.9 → 0.4) = visible damage.
2. **Screenshot the canvas, not the page.** `reframe_ui screenshot selector: '#canvas-area canvas'`. **Never `fullPage: true` on tall scenes** — see screenshot-size gotcha below.
3. **Quick-visual sanity on the PNG** (5 sentinels, nothing more):
   - Text clipped mid-word or truncated with `…` where a full line should fit?
   - Buttons rendering without their label (swallowed by a 0-height parent)?
   - Siblings visually overlapping (not by flex gap — by actual z-stack)?
   - CTA primary lost its accent — blends into the surface?
   - Scene root painting the wrong background (beige leak, transparent)?
4. **Skeleton vs. render cross-check.** If semantic skeleton claims `[nav] 1440×84` but screenshot shows nav overlapping the hero, that's a Yoga/import mismatch — log it.

### Tier 2 — DESIGN.md fidelity (cheap, every mutation after a brand is loaded)

The brand is an **oracle, not just a seed**. Currently the skill reads DESIGN.md as input to generation and then forgets. Instead:

1. Read `.reframe/brands/<slug>/DESIGN.md` (or the prose returned by `reframe_design extract`). Pull the **hard numbers**: hero size, tracking, weights, brand accent hex, border rgba, radius scale.
2. `reframe_inspect` the scene's hero / primary CTA / card — compare the render against the prose. Hero is 48px when DESIGN.md said 72px? Tracking is 0 when DESIGN.md said -1.584? Fill is `#111` when DESIGN.md said `#08090a`? **Fidelity fail — log the delta, propose a `reframe_edit update` with the brand-correct value.**
3. Fidelity-clean scenes can still be taste-poor — pass Tier 2 is not "done". Proceed to Tier 3.

Fidelity is not taste. Fidelity catches "you wrote the wrong number"; taste catches "you wrote the right numbers but it reads dead". Both matter.

### Tier 3 — Taste (expensive, end-of-sweep only, ONCE)

Delegate to `reframe-critic`. Don't inline a competing rubric — that skill already encodes the full Behance-tier smell library (fake metrics, fake logos, 3-equal-cards, centered-hero-5-elements, gradient-glass, forgettable-failure-mode, tone-mismatch) and knows how to translate engine numbers into designer sentences.

When to invoke:
- **At the end of a QA sweep** — after all mutations + mechanics + fidelity passes.
- **Once per scene**, not per mutation (critic is gated to final review; firing it after each click produces noise, not signal).
- **When mechanics + fidelity both pass but the PNG "looks off"** — critic is the only layer that can articulate why.

Invocation: call `reframe-critic` as its own skill or read its SKILL.md and apply inline. Output: ≤ 3 concrete fixes with engine citations. Attach those to your sweep report.

### Tier 4 — Export cross-check (when an exporter is in scope)

`reframe_export` → html + png. If the PNG body is the wrong color, or the html iframe shows the beige modal bg, the **exporter** regressed — different bug, different fix path than the canvas renderer.

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

**Only enter this section if § First move routed here via explicit full-sweep opt-in.** The parallel-bucket recipe below is NOT the default mode of `/designer-qa`; the default is to ASK or PROPOSE (see § First move). This section is the operational blueprint for when the user has said "full / canonical / Level 1 / прогон по всему". In all other cases — concrete bug, specific surface, scoped hypothesis — skip the bucket machinery and go directly to the target using the Platform map.

**When full-sweep IS on:** three independent Chromium sessions, three `Agent` subagents, no communication between them. Serial mode is the fallback for stress/fuzz flows (see below) or when the user narrows scope to a single flow but still wants a canonical shape.

### Bucket assignment (fixed — do not reassign across sweeps)

Each bucket owns a distinct project slug and a distinct set of flows. Buckets are partitioned so two concurrent subagents never mutate the same disk state.

| Bucket | Slug | Flows owned | Why these |
|---|---|---|---|
| A — boot & persistence | `qaa-<ts>` | 1 Dashboard landing · 2 Project canvas load · 11 State + reload | read-mostly; verifies cold-start + round-trip survival |
| B — mutations & agent  | `qab-<ts>` | 3 Chat edit round-trip · 6 Modify macros · 8 Generate macros | mutates scene tree only |
| C — viewport & export  | `qac-<ts>` | 4 Viewport switch · 5 Rebrand · 7 Export preview · 9 Detach / new-tab · 10 Responsive sweep | mutates project-level settings (activeBrand, viewport) |

**Slug-naming rule (discovered 2026-04-20 during first parallel run).** Bucket slugs must have **distinct first tokens** (split on `-` / `_`). `qa-a-run1` + `qa-b-run1` + `qa-c-run1` all share the first token `qa`, and the dashboard's prefix-heuristic (`inferProjectKey` in `project-grouping.ts`) groups them into ONE project → only the owner's `/platform/project/<slug>` route resolves, the others 404. Use `qaa-<ts>` / `qab-<ts>` / `qac-<ts>` (or any three slugs whose first hyphen-token differs) to keep them as three distinct projects.

Split rationale: B mutates the scene tree, C mutates project-level settings. On different slugs, a rebrand in C can't corrupt a chat-edit in B. A is read-dominant and cheap, it rides along.

### Pre-flight (serial, one-shot — before spawn)

Two things MUST complete before spawning subagents, else they race on shared disk:

1. **Extract every brand any bucket will touch.** `reframe_design action=extract brand=<slug>` writes `.reframe/brands/<slug>/DESIGN.md` globally; two concurrent extracts of the same brand corrupt each other. Cache up front, post-cache reads are parallel-safe.
2. **Reserve the three slugs.** `reframe_project action=init slug=qa-a-<ts>` (and `-b`, `-c`). Confirm each exists before spawn.

### Spawn recipe

One message, three `Agent` tool calls with `subagent_type: "general-purpose"`, `run_in_background: false`. Each prompt is self-contained:

```
You are designer-qa bucket <A|B|C>. Your isolated slug is "<slug>". Do NOT
open, read, or mutate any other slug. Do NOT call reframe_design action=extract
(main skill pre-cached brands). Open reframe_ui with a fresh sessionId and walk
ONLY flows <list>. Obey screenshot size rules from SKILL.md § Tool (never
fullPage, ≤ 2000 px on any axis).

You are allowed — and expected — to FIX bugs you surface, across any layer
(engine, UI, export, tool handlers). Rules from SKILL.md § Fix in-bucket:
  • read-before-edit, ≤ 40 lines per fix, re-verify with the same probe that
    caught it, no yak-shaving adjacent code
  • rebuild + restart sidecar ONLY for changes to packages/mcp/src/platform/
    ui/*.js, platform-ui.css, or packages/mcp/src/tools/*.ts — engine fixes
    don't need the ritual
  • do NOT commit git changes; leave the diff for the main skill to review
  • do NOT edit SKILL.md smell-row states — report fix=yes, main skill flips

Return findings as structured lines, one per finding, matching smell-table
format + fix status:
  <state> · <surface> · <sentinel> · <evidence> · fix=<yes|no|conflict|needs-pr|none> · files=[...]

End with: "BUCKET <X> DONE · <N> findings · <M> fixed".
```

Wall-clock: ≈ 3-4 min parallel vs. 12-15 min serial.

### Merge

Main skill receives three finding lists, deduplicates by sentinel (same sentinel reported by two buckets = one row, evidence merged), promotes new sentinels into the smell table. If a subagent errors out or times out, its flows revert to serial — do **not** retry the same bucket in parallel (retry re-races the same shared state that failed).

### Fix in-bucket (the default — close what you catch)

Buckets are not QA robots. They are senior designers / engineers who **fix bugs as they surface**, across every layer — engine (`packages/core/src/`), UI (`packages/mcp/src/platform/`), export (`packages/core/src/exporters/`), tool handlers (`packages/mcp/src/tools/`). A sweep that logs 12 🔴 and walks away is a failed sweep.

**Rules buckets follow when they fix:**

1. **Read before edit.** Always. Edit tool requires it, but also the read prevents blind patches. If a file has changed since another bucket touched it, the Edit will mismatch — that's the conflict signal (see below).
2. **≤ 40 lines per fix.** Same rule as Level 2 bug-triage loop. Over budget = log as `needs-pr` in the finding, do NOT commit in-session. Keep moving.
3. **Re-verify with the same probe that caught the bug.** Re-open / reload / re-screenshot, run the sentinel again. If still failing, leave the 🔴 as-is and note what you tried. Don't mark `fixed: yes` unless the probe flipped.
4. **Touch only what the fix requires.** Do not yak-shave adjacent cleanup — that inflates the diff, inflates rebuild cost, and steps on sibling buckets.
5. **Rebuild + sidecar restart** is needed ONLY for changes to `packages/mcp/src/platform/ui/*.js`, `platform-ui.css`, or tool handlers (`packages/mcp/src/tools/*.ts`). Engine fixes in `packages/core/src/` reload on next MCP call. See § Before you probe.

**Conflict handling (when two buckets race the same file).**

Option one: Edit's exact-string match fails because the other bucket already changed the surrounding context. → The bucket logs `fixed: conflict`, files_touched=[...], skips the fix, moves on. The main skill's Fix phase picks it up serially after merge.

Option two: Both Edits succeeded but produced a broken combination (rare — different logical changes to the same function). → Detected at re-verify (probe still fails OR new probe fails). The later bucket logs the conflict, reverts its own change via Edit, moves on.

**Each subagent's finding line now includes fix status + touched files:**

```
<state> · <surface> · <sentinel> · <evidence> · fix=<yes|no|conflict|needs-pr|none> · files=[...]
```

- `yes` — bucket fixed it and re-verified; state flipped to 🟢.
- `no` — bucket saw the bug but didn't attempt fix (out of flow-scope time budget).
- `conflict` — attempted and raced a sibling bucket.
- `needs-pr` — scope > 40 lines; follow-up PR required.
- `none` — not a code bug (taste, doc, generation pattern).

### Fix phase (serial, after merge — only handles what buckets left on the floor)

After merge, main skill filters for findings with `fix ∈ {no, conflict}` and fixes them one at a time, serial:

1. **Partition by layer** from the finding's suspected file.
2. **Fix, re-verify, next.** ≤ 40 lines each. Over budget → log `needs-pr`, continue.
3. **Flip row state** in the smell table: 🔴 → 🟢 only when the probe reports clean. Add one line to the Fix log (`YYYY-MM-DD · sentinel-id · file:symbol · one-line why`).
4. **Rebuild + restart** only when UI JS / CSS / tool handlers changed.

### Anti-patterns for fixes (bucket OR main-skill fix phase)

- **Do not parallelize fixes across three fixer subagents in the Fix phase.** Buckets fixing in-bucket is fine (they each own a distinct slug and found their own bugs). Main-skill fix phase is strictly serial — it is reconciling leftovers, parallelism there re-introduces the race.
- **Do not fix across layers in one shot.** If a finding is "engine sends wrong payload + UI renders it wrong", fix engine first, re-verify, then revisit whether the UI fix is still needed (often it isn't).
- **Do not fix a taste smell with code.** `centered hero with 5 elements` is not a code bug; it's a generation-side pattern. Log `fix=none`, route to `reframe-design` / `reframe-enhance`.
- **Do not edit SKILL.md smell-row states from a subagent.** State flips (🔴 ↔ 🟢) are the main skill's job after merging + re-verifying. Subagents report `fix=yes`, main skill flips the row.
- **Do not commit git changes from a subagent.** Fixes stay uncommitted; main skill reviews the aggregate diff post-sweep and decides commit boundaries.

### Anti-patterns for parallel mode

- **No inter-subagent communication.** No shared doc, no "wait for sibling A", no dependency between buckets. They run blind.
- **No sessionId sharing.** Each subagent calls its own `reframe_ui open`. A single sessionId driven by two agents = undefined Playwright state.
- **No slug sharing.** Two subagents on `/platform/project/X` means SSE broadcasts cross-contaminate and `manifest.json` last-write-wins. Always distinct slugs per bucket.
- **No parallel for stress/fuzz.** Fuzz clicking for 2 min saturates the sidecar; viewport-thrash races the CanvasKit WASM queue. These run **serial, single bucket**, after the parallel sweep reports clean.
- **No parallel on low-RAM.** Three Chromium contexts ≈ 2-3 GB. If the sidecar is co-hosting a live user session (the person asking for the sweep is IN the browser right now), the user session wins — run serial.
- **No re-extract during spawn.** If a bucket needs a brand not in the pre-flight list, the whole sweep aborts and restarts with an updated pre-flight. Do not extract mid-run.

### Complex scenarios (run after the 11 flows pass, serial, single bucket)

The 11 flows verify "buttons work". These verify "the stack doesn't fall apart":

- **Round-trip:** rebrand Stripe → `reframe_export` html → `reframe_compile file=` on the exported html → diff audit counts. Any new warning = exporter or importer regressed.
- **Viewport thrash:** `setViewport` cycling 390 → 1440 → 768 → 1920 → 390 seven times in 30 s. Canvas must never go to width:0, console must stay clean, audit count must stabilize.
- **Fuzz toolbar:** random clicks on toolbar items for 2 min with a fixed seed (reproducible). Monitor `/platform/api/chat/status` + console for unexpected errors. Known-closable modals auto-dismissed via `Escape` every 5 s.
- **Rebrand chain:** Stripe → Linear → Airbnb → Stripe, reading DESIGN.md fidelity after each hop. Accent hex, hero size, and radius scale must match the currently-active brand, not a previous one (brand-state leak regression).

Log results against the Tier 2 fidelity bar, not just "no crash".

### Emitting findings

- **Fix** — smell detected → fix in code + re-probe to verify
- **Smell Log** — unknown issue → add a row to the anti-regression table with the probe signature so next sweep catches it faster

## Deeper modes — QA by doing real design work

Level 1 (the 11 flows + parallel buckets) walks scripted mechanics — fast, structured, reproducible. But **mechanics passing ≠ stack is healthy.** Bugs that block a real designer shipping a real project — brand drift on the fifth rebrand, export→re-import losing a root fill, chat agent forgetting context on iteration 7, nav inconsistency across pages, token binding stale on scene 3 — only surface when you actually try to ship something. That's Level 2 + 3.

These modes run **serial, single session, 30-60 min** per brief. No parallel buckets — the project is one cohesive thread, splitting it defeats the point. Artifact on output: a shippable scene/site/email/brand system, not a report.

### Level 2 — Designer brief mode

You are a senior designer on Behance whose muscle memory is in canvas. You take one brief, execute it end-to-end using the **full interaction palette**, and fix whatever blocks you at the engine or UI level along the way.

**Interaction ladder — pick the lightest tool that fits the ask.** Real designers don't chat for every change; they tap when it's a tap job, drag when it's a drag job. Mixing paths IS the test — if chat + direct edit + macros don't cooperate in one project, that's the bug.

| Change kind | Right tool | Why |
|---|---|---|
| Nudge spacing 24 → 32, swap one color, toggle weight | `reframe_edit op=update` on the single prop | 1 call, deterministic, zero generation variance |
| "Make this section feel denser" / "add a testimonial row" | bottom chat in Platform UI | generation IS the point — let the agent regenerate |
| Restructure a section (3-col → bento, grid → zigzag) | edit `.reframe/src/<name>.html`, `reframe_compile file=` | chat regenerates unpredictably; source edit is precise |
| Blanket macro across scene (all radii softer, shadows flat) | toolbar → Modify → Scale radius / Shadows | one-click intent, no prompt engineering |
| Rebrand mid-project | toolbar → Modify → Rebrand, pick brand | exercises the real UI path users hit |
| Align two siblings by eye | canvas drag in viewport (via `reframe_ui act dragAt`) | the Figma muscle — tests it feels right |

**Bug-triage loop** — when a blocker hits mid-design, switch hats, fix, switch back:

```
1. Log symptom in the bug log: sentinel · surface · evidence (one line).
2. Identify layer:
     engine  → packages/core/src/ (importers, layout, paint, audit)
     UI      → packages/mcp/src/platform/ (toolbar, chat, modals, panels)
     export  → packages/core/src/exporters/
3. Read the suspected file. Fix if scope ≤ 40 lines.
   Larger → log as "needs follow-up PR", continue the brief with a workaround.
4. Re-verify by redoing the exact step that triggered it.
5. Back to the brief. Do NOT yak-shave — one fix, one verify, move on.
```

Discipline: the brief is the job, bugs are the byproduct. Don't stop executing the brief just because you found one bug — note it, work around it, keep shipping.

**Brief library — pick one, execute until shippable.** Each has audience · must-have · viewport · acceptance. User's custom brief? Map it onto this shape first (`reframe-enhance` can help if vague).

1. **Welcome email — fintech onboarding.** Header + greeting + 3 next-step cards + primary CTA + footer. 600×auto, inline styles only. Accept: renders in a 600px iframe without overflow, CTA ≥ 44 px, no external CSS.
2. **Launch banner set.** Same brand, 3 sizes: 1200×628 (Twitter), 1080×1080 (Insta), 1200×1200 (LinkedIn). Accept: same headline + CTA, brand accent identical across all three, audit clean on each.
3. **3-page marketing site.** home + pricing + 404, one brand. Accept: cross-page nav links use real slugs, `reframe_export format=site` opens clickable, brand typography + accent identical on all pages.
4. **Dashboard + empty state + error state.** One product surface, three states from one token set. Accept: visual continuity, audit clean on all three, aesthetic metric spread across the three ≤ 0.15.
5. **Editorial long-form.** Article page, 1440×6000+. Accept: typography rhythm stable top-to-bottom, PNG export ≥ 2000 px correctly uses the file-ref fallback (not inline), export html has body bg matching root fill.
6. **Rebrand-chain stress.** Same scene rebranded 4× (Stripe → Linear → Airbnb → Vercel). Accept: structure preserved across all four; no brand-state leak (brand N-1's accent must NOT appear after rebrand to brand N); `brandFidelity` ≥ 0.8 on final.
7. **Brand decomposition** → see Level 3.

### Level 3 — Brand decomposition

Pick one brand (Notion, Stripe, Linear, Apple, Vercel, Airbnb). Extract the system, build 3-4 surfaces from it in one project, verify consistency. This is the classic senior exercise — it tests whether DESIGN.md extraction + token binding + multi-scene brand fidelity hold across surfaces.

**Protocol**

1. `reframe_design action=extract brand=<slug>` — read the full DESIGN.md. Write down the **10 load-bearing numbers**: hero size, hero tracking, body size, accent hex, surface dark/light, radius scale, shadow scale, button height, nav height, grid gap.
2. Build 4 surfaces in the SAME project (same slug, same brand): landing home, pricing, signup form, email confirmation. Use the interaction ladder freely.
3. After each surface: `reframe_inspect` → diff render against your 10 numbers. Log every delta (surface N has button height 52 when brand says 48).
4. Final: `reframe_export format=site` for the 3 web surfaces + `reframe_export format=html` for the email. Open each, screenshot, eyeball: does it feel like ONE brand, or 4 surfaces sharing a color?

**Failure modes this catches that Level 1 cannot:**

- Token binding runs on scene 1 only; scenes 2-4 inherit raw values that stale after `defineTokens` re-run.
- Accent rotates correctly on rebrand but secondary accent / semantic colors don't — surface 4 has prior brand's "danger red".
- Typography preset toggled on scene 1 doesn't propagate to subsequently-compiled scenes in the same project.
- Exporter consolidates tokens per-scene, not per-project, so the site has inline hex and the email has CSS vars — two outputs, same brand, different style architecture.

Each is a different fix path. The Level-3 brief is the only way to find which one without writing a bespoke integration test.

### Which level does this request need?

- "test the UI" / "QA platform" / "sweep the flows" → **Level 1 parallel sweep** (default).
- "pretend you're a designer" / "ship something real" / "run a project" (no specific brief) → **Level 2**, you pick from the library.
- User gives an actual brief ("design a welcome email for …") → **Level 2 with their brief**, map onto the acceptance shape, execute.
- "decompose brand X" / "build a system from Y" / "can reframe hold a brand across 4 surfaces" → **Level 3**.
- "do all of it" → Level 1 first (cheap, confirms stack is alive), then Level 2 on one brief, then Level 3 if time remains. **Never** Level 3 first — if Level 1 fails, Level 3 is guaranteed to fail and you learn nothing from it.

## When NOT to use this skill

- Designing / editing a scene → `reframe-design`
- Loading a brand → `reframe-brand`
- Generating a multi-page site → `reframe-site-loop`
- Unit-testing the engine → `packages/core/src/tests/*.test.ts` via `npm test`

The scope here is interface-layer regressions. Engine bugs go through the audit + test path.
