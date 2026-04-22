---
name: reframe-motion
description: Use when the user asks for animation, motion, transitions, video, "make it move", "add fade-in", "slide up", "stagger cards", shader transitions between scenes, TTS voiceover, captions synced to audio, audio-reactive visuals, promo clip, onboarding animation, or asks to export a scene as video. NOT for static scene design (→ reframe-design), not for brand rules about motion defaults (→ reframe-brand — this skill consumes what reframe-brand produced). This skill is the decision layer between reframe's INode animations (simple, CSS/GSAP-over-iframe) and raw hyperframes compositions (complex, shader/TTS/multi-scene/video). The goal is ONE thing — never expose the seam to the designer.
allowed-tools:
  - "mcp__reframe__*"
  - "Read"
  - "Write"
  - "Edit"
---

# reframe-motion

**You are a motion director sitting between static design and video output.** reframe owns the scene (INode, brand, audit). Hyperframes owns the video render (Puppeteer + FFmpeg + GSAP + shaders). You decide, per intent, which level to author at — and you bridge the seam so the designer never sees it.

Two rules of thumb govern every decision:

1. **Stay in INode-space as long as the motion fits there.** Simple entrance tweens, hover states, stagger-on-children, scroll-triggered reveals — all INode primitives. Previews instantly in our iframe. Renders via our exporter. No hyperframes invocation needed unless the user asks for MP4.
2. **Drop to raw hyperframes HTML only when INode can't express it.** Shader transitions between scenes, TTS voiceover, captions synced to audio, audio-reactive beat sync, multi-scene video promos. You read the `hyperframes` + `gsap` + `hyperframes-registry` skills we've mirrored under `.claude/skills/` and author their composition HTML — but on behalf of the designer, never surfacing the HTML to them.

The seam is architectural, not UX. The designer says "fade my hero in", they see it fade. The designer says "kinematic shader transition with voiceover between hero and pricing", they see that too. Both requests go through this skill; the skill picks the level.

## Sensitive surfaces

Where motion work quietly goes wrong:

- **Brand motion drift** — hyperframes' `house-style.md` defines default motion (timings, easings, palettes). When a brand is active, the brand's DESIGN.md motion section MUST win. Reading hyperframes' defaults and ignoring DESIGN.md = brand collapse.
- **DESIGN.md gate mapping** — the `hyperframes` skill's HARD-GATE looks for `DESIGN.md` / `visual-style.md` at project root. Our brand DESIGN.md lives at `.reframe/brands/<slug>/DESIGN.md`. When delegating to their skill, map this — don't let it generate a fresh minimal DESIGN.md on top of an existing brand.
- **Preview expectations** — simple INode motion previews in our iframe instantly (CSS animations). Raw hyperframes compositions need Puppeteer render to preview accurately. Tell the user: "instant preview" vs "~30-60 s render for video".
- **Timeline mental model** — INode animations are per-scene (entrance-on-render). Raw hyperframes compositions have a GLOBAL timeline with `data-start` / `data-duration`. When you cross that seam, clip-timing semantics flip. Don't conflate.
- **Scene-root motion** — the scene root is the frame, not a draggable/animatable element. Never write transform/opacity animations on the root node; only on children. This bit us in the DOM-canvas drag-writeback (see `designer-qa` fix log entry `editor/phase2c-drag-resize-inline-multiselect`) and it bites motion too.
- **Non-transform / opacity props in tweens** — animating `width` / `height` / `padding` / `top` / `left` causes jank and breaks determinism. Use `x` / `y` / `scale` / `autoAlpha`. This rule is on both sides of the seam.
- **Infinite repeats** (`repeat: -1`) — break deterministic video render. Compute exact repeat counts. Applies to raw hyperframes only; INode animations currently don't expose this footgun.

## Decision table — intent → operate level

The core artifact of this skill. Rows grow over time; keep the left column as a grep-able phrase the user actually says.

| User intent signal | Operate level | Why |
|---|---|---|
| "fade in", "slide up", "stagger cards", "entrance animation" | **INode-space** | Single-prop tween on child nodes; exporter converts to CSS / GSAP-over-iframe |
| "hover", "focus", "active", "disabled" state animation | **INode.states** | Native reframe primitive; already in the scene graph, no exporter change |
| "animate on scroll" / "reveal on scroll" | **INode-space** | IntersectionObserver + CSS, or GSAP ScrollTrigger in iframe — INode carries the trigger metadata |
| "add motion to my scene" (default, no other signal) | **INode-space** | Start simple; escalate only if a follow-up demands it |
| "transition between scenes" / "between hero and pricing" | **raw hyperframes** | Multi-scene timeline, composition artifact required |
| "shader transition" / "flash through white" / "cinematic wipe" / "glitch cut" | **raw hyperframes** | `@hyperframes/shader-transitions` package; WebGL, needs their pipeline |
| "voiceover" / "TTS narration" / "Kokoro voice" | **raw hyperframes** | Their TTS integration; see `hyperframes/references/tts.md` |
| "captions", "subtitles", "karaoke", "lyrics synced to audio" | **raw hyperframes** | Caption system; see `hyperframes/references/captions.md` |
| "audio-reactive", "beat sync", "pulse on bass" | **raw hyperframes** | Frequency-band → GSAP property mapping; see `audio-reactive.md` |
| "letter-by-letter", "word stagger", "typewriter" on a text node | **INode-space** preferred | Stagger on child spans; reach for raw only if effect is rich (clip-path slam, scatter, elastic) |
| "promo video", "30-second clip", "onboarding animation", "pitch reel" | **raw hyperframes** | Composition artifact; multiple scenes or extended timeline; video-first |
| "export this as video" / "give me MP4" / "render" | **NEITHER** — call `reframe_export format=video renderVideo=true` directly | Tool handles dispatch; don't route through this skill |
| "make it slower / faster / tighter" (on existing animation) | **direct `reframe_edit`** — no skill routing | Property tweak on existing INodeAnimation or composition |

**When in doubt, start in INode-space.** Escalating INode → raw is cheap (re-export with different exporter). De-escalating raw → INode loses information. Bias low.

## Smell table — motion regressions the engine can't see

Format mirrors other skills. Sentinels are grep-able or machine-checkable. Recipes live in the `hyperframes/` skill refs or our INode docs; this table just catches the pattern.

| Smell | Why it reads broken | Probe | Fix |
|---|---|---|---|
| Animating `visibility` / `display` via GSAP | Runs but unseekable — no deterministic midpoint | Grep tweens for `visibility:` / `display:` | Use `autoAlpha` (GSAP's opacity+visibility) |
| `Math.random()` in any tween value | Non-deterministic render; different MP4 each call | Grep tween configs for `Math.random\|Math\\.random\|crypto\\.` | Seed it, or use `gsap.utils.wrap` / `gsap.utils.distribute` |
| `repeat: -1` on any tween | Breaks video duration math | Grep `repeat:\s*-1` in compositions | Compute finite count from scene duration |
| Entrance missing on a new element | Reads as "pre-formed" — looks dropped-in | For each `.clip`, confirm a `gsap.from()` with `autoAlpha:0` exists | Add entrance |
| Multi-scene composition with no transitions | Feels like jump cuts | Count scenes vs transitions; transitions = scenes - 1 | Add crossfade / shader / reveal between every pair |
| GSAP timeline built inside async callback | Race with element presence → missed entrances | Grep `.timeline()` inside `async` / `then` / `setTimeout` | Build timelines at page-load sync |
| Animating layout props (width/height/padding) | Janky, triggers reflow | Grep `gsap.(to\|from\|fromTo)\\([^)]*(width\|height\|padding)` | Use transforms (`x`, `y`, `scale`) instead |
| Default ease-out 0.3s when brand says otherwise | Brand motion drift | Open `.reframe/brands/<slug>/DESIGN.md` → check Motion section; compare against composition easing | Use DESIGN.md `timing` / `easing` tokens |
| Inter / Roboto in animated text when brand specifies otherwise | Type collapse under motion | First animated text node computed `fontFamily` vs brand primary | Apply brand font + `font-feature-settings` |
| Animating the scene root frame | Breaks the frame boundary; canvas/iframe seam | Tween target selector includes root or `body > *:first-child` of frame | Animate children only; root is the frame, not a prop |
| Brand accent hardcoded (`#ffffff`, `#000000`) in tween | Lost tokenization; rebrand won't follow | Grep tween values for raw hex instead of `var(--color-*)` | Use CSS var via `cssVariable:true` GSAP syntax or INode token binding |
| Brand OpenType features dropped on animated text | Small caps / tabular nums vanish | Computed `fontFeatureSettings` on animated text | Apply brand `font-feature-settings` on `.clip`'s root style |

When you find a new motion smell: add a row + a row in the decision table if it implies a new routing rule.

## Canonical flows

### Simple motion on an existing scene (80% of asks) — preset via `animate` config

Animations are NOT stored on `SceneNode` — they're built at export time from an `animate` config. The config picks presets per node name + optional stagger on a group. 22 presets ship today (see § Preset menu below).

1. `reframe_inspect sceneId=<id>` → identify target nodes by role/name. Node names are what you feed to `animate.presets[].nodeName`.
2. `Read .reframe/brands/<slug>/DESIGN.md` — if a brand is active, check its Motion section (timing, easing, preferred patterns). If brand is silent on motion, follow `hyperframes/house-style.md` defaults and surface the choice to the user.
3. Pick presets from the 22-preset menu. Map intent → preset: "fade in" → `fadeIn`, "slide up" → `slideInUp`, "stagger cards" → `stagger` block with `fadeSlideUp`, "pulse accent" → `pulse`.
4. Call `reframe_export format=html animate={ presets: [{nodeName, preset, delay?, duration?}, ...], stagger?: {nodeNames, preset, staggerDelay} }`. This emits animated HTML (GSAP + timeline scrub). Writes to `.reframe/exports/<slug>.html`.
5. Preview: open the exported HTML — or invoke `reframe_ui` with that file to confirm motion visually.
6. If user confirms AND wants MP4: same call with `format=video renderVideo=true`. Rendering ~30-60 s (first run ~2-3 min for Chromium download).

Constraint: INode-space motion today = preset × node + optional stagger. Custom keyframes / multi-preset sequences on the same node / timeline labels → drop to raw hyperframes.

### Complex motion — drop to raw hyperframes

Reframe's `reframe_export` accepts `sceneId + animate config` but does NOT today take a pre-authored composition HTML file as input. For raw compositions the flow bypasses `reframe_export` and drives hyperframes CLI directly via `Bash`. Still invisible to the user — they see "motion added, rendering", not the command line.

1. Detect: scan the intent against the decision table. If any row lands on **raw hyperframes**, commit to that level early; don't try to fake it in INode.
2. `Read .claude/skills/hyperframes/SKILL.md` — top-to-bottom, including the HARD-GATE.
3. **Bridge the DESIGN.md gate.** The `hyperframes` HARD-GATE says "DESIGN.md at project root". Map: `.reframe/brands/<slug>/DESIGN.md` is our equivalent. If brand is active, the gate is satisfied — do NOT let their flow generate a fresh minimal DESIGN.md. If no brand is active, hand off to `reframe-brand` first.
4. `Read .claude/skills/hyperframes/references/<topic>.md` for the specific technique — `transitions.md` for scene transitions, `tts.md` for voiceover, `captions.md` for synced text, `audio-reactive.md` for beat sync, `motion-principles.md` for choreography. Their `visual-styles.md` + `house-style.md` describe defaults; override with our DESIGN.md.
5. `Read .claude/skills/gsap/SKILL.md` for GSAP API specifics.
6. Seed the raw composition by exporting the target scene as plain HTML first (or grab its compiled output from `.reframe/exports/<slug>.html`) so you start from real rendered markup, not from memory. `reframe_export format=html sceneId=X` writes a baseline you then adapt.
7. Author the raw composition. `Write .reframe/src/<scene-name>-motion/index.html` (directory, not loose file — hyperframes CLI expects a project dir). Inject brand DESIGN.md values (colors, fonts, font-feature-settings) into the composition's root CSS. Author the GSAP timeline inside a `<script>` tag per `hyperframes/SKILL.md` rules — synchronous timeline construction, no `Math.random()`, no `repeat: -1`.
8. Optional: install catalog blocks for this composition via `reframe_design action=extractBlock blockName=<slug>` (fetches to `.reframe/blocks/`), then import into your composition per `hyperframes-registry` wiring recipe.
9. Render: `Bash: npx --yes hyperframes render .reframe/src/<scene-name>-motion -o .reframe/exports/<scene-name>.mp4 --fps 30 --quality standard`. First run downloads Chromium (~2-3 min); subsequent runs ~15-45 s depending on composition length. Surface the timing to the user before blocking.
10. If the user wants to preview before committing to a full render: open `.reframe/src/<scene-name>-motion/index.html` directly in a browser tab (or via `reframe_ui`) — CSS-based motion will play live, shaders will look off until full Puppeteer render.

Phase 2 upgrade path: extend `reframe_export` schema with `compositionPath: string` so the exporter accepts pre-authored composition dirs directly — collapses steps 9 + the MP4-return shape into one tool call. Do NOT build this preemptively; wait until a user workflow demands it.

### Multi-scene composition / promo video

**Phase 2 territory — not yet first-class in the Platform UI.** Today: author as a single raw hyperframes composition referencing multiple scene renders. Store at `.reframe/src/<name>-promo.html` + `.reframe/compositions/<name>/` for sub-blocks. Surface to user: "this is a standalone composition, not a scene — lives outside the scenes list". When the Composition artifact ships in the UI, migrate.

### Edit existing motion (tighten timing, change easing)

Don't route through this skill. For INode-level motion the animation IS the `animate` config on the export call — re-export with adjusted `duration` / `easing` / `delay` override on the target preset entry. For raw compositions, `Edit` on `.reframe/src/<name>-motion/index.html`. This skill's routing is for level-picking on NEW motion work.

## Anti-patterns

- **Exposing raw hyperframes HTML to the designer.** Agent writes it; user sees "fade + shader transition added" in natural language. The composition HTML lives on disk; the user doesn't read it unless they ask to see the source.
- **Skipping `.reframe/brands/<slug>/DESIGN.md` when a brand is active.** The `hyperframes` HARD-GATE is there to prevent generic styling; our brand catalog is a superset of what the gate asks for. Always bridge, never bypass.
- **Using hyperframes Studio (CodeMirror + timeline bars).** Their redactor is a competing UI surface — the designer lives in our Platform UI, not theirs. `@hyperframes/player` web-component is fine for preview embed; Studio is not.
- **Jumping to raw hyperframes for asks that fit INode.** "Fade the hero in" does not need Puppeteer. Escalation has a cost (render time, composition file sprawl).
- **Inventing motion specs when DESIGN.md is silent.** If the brand has no Motion section, surface the gap: "brand doesn't specify motion; recommend `ease-out 300ms` as house default — ok?" Don't silently pick.
- **Adding motion unprompted.** A designer who didn't ask for animation doesn't want one. Motion is opt-in, on every scene. The skill activates on intent, not on scene load.
- **Bypassing `reframe-brand` when no DESIGN.md exists.** Hand off to `reframe-brand` to load a brand before authoring motion — do not write a fresh minimal DESIGN.md just to satisfy the HARD-GATE.
- **Putting motion on the scene root.** Animate children. Root is the frame.
- **Building a timeline editor inside reframe.** The visualization can grow later (a simple "what happens when" list in the right panel for Phase 2), but don't compete with Studio.

## Preset menu — the 22-preset vocabulary

Presets are GSAP tweens wrapped in reframe-friendly names. They are NOT replacements for hyperframes — they compile to GSAP inside the composition HTML the exporter emits. Think of presets as a **shorthand vocabulary** covering the 80% of static-page motion.

| Category | Presets |
|---|---|
| Fade | `fadeIn` · `fadeOut` |
| Slide (directional + fade) | `slideInLeft` · `slideInRight` · `slideInUp` · `slideInDown` |
| Scale | `scaleIn` · `scaleOut` · `popIn` |
| Reveal (clip-path based) | `revealLeft` · `revealUp` |
| Attention | `pulse` · `shake` · `bounce` |
| Text | `typewriter` |
| Color / blur | `colorShift` · `blurIn` |
| Fade + slide combos | `fadeSlideUp` · `fadeSlideDown` · `fadeSlideLeft` · `fadeSlideRight` |
| Fade + scale combo | `fadeScaleIn` |

**Every preset accepts per-call overrides** via the `animate` config:
- `duration` (ms) — override preset default
- `delay` (ms) — delay before start
- `easing` — override preset default easing. Accepts any `EasingPreset` name: `linear` · `ease-out` · `ease-out-cubic` · `ease-out-back` · `ease-out-expo` · `ease-out-elastic` · `ease-out-bounce` · `ease-in-out-quart` · etc. (full list in `packages/core/src/animation/types.ts:EasingPreset`)
- `distance` (px) — slide/reveal presets only; default 60. Ignored by non-translate presets.

## Three composition modes

The `animate` config supports three orthogonal modes — mix freely in one call.

**1. `presets[]` — single preset per node** (most common)
```js
animate: {
  presets: [
    { nodeName: 'Hero', preset: 'fadeIn', duration: 800, easing: 'ease-out-cubic' },
    { nodeName: 'CTA', preset: 'slideInUp', delay: 400, distance: 80 },
  ]
}
```

**2. `stagger` — same preset across N nodes with cumulative delay**
```js
animate: {
  stagger: {
    nodeNames: ['Card1', 'Card2', 'Card3'],
    preset: 'fadeSlideUp',
    staggerDelay: 150,     // ms between each
    duration: 600,          // applied to all
    easing: 'ease-out-back'
  }
}
```

**3. `sequences[]` — multiple presets per node with cumulative timing** (compose attention)
```js
animate: {
  sequences: [{
    nodeName: 'Hero',
    chain: [
      { preset: 'fadeIn', duration: 600 },
      { preset: 'pulse', duration: 800 },     // starts after fade finishes
    ],
    delay: 200,
    overlap: 0               // 0 = pure sequence; positive = cross-over; negative = gap
  }]
}
```

**When to escalate to raw hyperframes** — any of:
- Need to animate CSS vars / brand tokens during motion (`color-shift from primary to secondary`)
- Need GSAP timeline labels / nested timelines / `gsap.utils.distribute`
- Need motion on `::before`/`::after` pseudo-elements
- Need shader transitions, TTS, captions, audio-reactive, multi-scene choreography

## Tools to reach for

- `reframe_inspect sceneId=X` — list node names; you need these for `animate.presets[].nodeName`. Animations themselves live on the export, not on the node.
- `reframe_export format=html sceneId=X animate={...}` — preview animated HTML (GSAP + timeline scrub). Writes to `.reframe/exports/<slug>.html`, open in browser or via `reframe_ui` to confirm motion.
- `reframe_export format=video sceneId=X animate={...} renderVideo=true` — render MP4. Opt-in: first run downloads ~100 MB Chromium.
- `reframe_export format=lottie sceneId=X animate={...}` — Lottie JSON (CSS transforms subset; not all presets supported in Lottie).
- `reframe_edit op=addBlock` — install a catalog block (hyperframes-registry subset) into the scene as an INode subtree. The block carries its own motion — combine with your own `animate` config.
- `reframe_design action=listBlocks` — browse catalog names + descriptions; prefer this over random block picks.
- `Read .reframe/brands/<slug>/DESIGN.md` — brand motion source of truth. Check Motion / Timing / Easing sections.
- `Read .claude/skills/hyperframes/SKILL.md` and its `references/*.md` — when dropping to raw.
- `Read .claude/skills/gsap/SKILL.md` — GSAP API reference for raw compositions.
- `Read .claude/skills/hyperframes-registry/SKILL.md` — catalog wiring for standalone compositions.
- `Write .reframe/src/<name>-motion/index.html` — when authoring raw compositions; keeps static source `.reframe/src/<name>.html` untouched.
- `Bash: npx --yes hyperframes render <dir> -o <out.mp4>` — render raw composition directly (bypasses `reframe_export`).

## Gotchas

- **First render is slow.** `npx hyperframes render` downloads Chromium on first invocation (~2-3 min). Subsequent renders are ~15-45 s depending on composition length.
- **Telemetry is disabled repo-wide** via `npx hyperframes telemetry disable` (persisted in user config). Don't re-enable.
- **Preview fidelity for raw compositions.** Our iframe preview shows composition HTML correctly for CSS-based motion, but shader transitions need full Puppeteer render to look accurate. Expose this to the user: "preview is approximate; final render will apply the shader properly".
- **Brand font feature settings** survive export only if applied at composition level. When authoring raw hyperframes, explicitly pass `font-feature-settings` from DESIGN.md into the composition's root CSS.
- **Catalog blocks may carry their own motion defaults** (e.g. `flash-through-white` has internal easing). These override brand motion intentionally — the block's whole point is its specific look. Flag if a block's defaults conflict with brand ("block uses cubic-bezier(.8,0,.2,1); brand spec is ease-out — keep block default, or override?").
- **`@hyperframes/player`** can embed playback in our iframe without driving full Puppeteer — useful for preview-quality scrub of compositions that don't need frame-accurate shaders. Not yet wired; note this as the preview-upgrade path.

## When NOT to use this skill

- User asks for a static scene with no motion → `reframe-design`.
- User asks "how does my animation look?" on an existing motion scene → `reframe-critic` (critic knows motion via this skill's smell table).
- User wants to tweak an existing animation ("0.3s slower", "change easing to ease-in") → direct `reframe_edit` on the `animations` field; no skill routing.
- User asks to rebrand motion specifically ("make all my animations match Stripe's timing") → `reframe-brand` (updates DESIGN.md Motion section, then re-apply via this skill on the updated brand).
- User asks for a site with motion on every page → `reframe-site-loop` orchestrates per-page, delegates motion to this skill per page.

## Growing the decision + smell tables

When a new motion pattern lands:

1. Add a row to the **decision table** — new intent signal + operate level + why. This is how the skill learns routing.
2. Add a row to the **smell table** — what fails, how to detect, how to fix. This is how the skill learns taste.
3. If the pattern requires a hyperframes sub-reference we don't have cached locally — pull it into `.claude/skills/hyperframes/references/` via curl, and bump the bridge note.

The decision table is the moat. A reframe-motion that knows 50 intent → level mappings + their traps is a skill that keeps the seam invisible forever.

## Credits

The `hyperframes`, `gsap`, and `hyperframes-registry` skills under `.claude/skills/` were imported 2026-04-22 from [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) under the Apache License 2.0. Thanks to the hyperframes team for open-sourcing that work — it gave reframe a deep motion-authoring surface without reinventing the wheel.

Those three skill directories remain under Apache 2.0. Local modifications and this `reframe-motion` skill are part of reframe and fall under reframe's AGPL-3.0 license. See the repository's `NOTICE` file for the full third-party license statement.

**How this skill treats upstream:** the imported skills are a soft fork, not a live mirror. When hyperframes ships a useful new reference (new transition, new caption technique, new preset), cherry-pick manually — no bulk re-sync. Local edits accumulate, and the `reframe-motion` skill itself is entirely reframe's; it is never synced with upstream.
