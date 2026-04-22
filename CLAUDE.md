# reframe — AI-Native Design Editor

Import → Graph → Audit → Transform → Export. INode is to structured content what AST is to code.
Browser-native DOM canvas. 37-rule quality engine. 7 export formats (html / react / svg / png / pdf / lottie / video).

**Architecture:** `@reframe/core` = INode AST + Yoga-backed layout + audit + tokens + resize + variations + animation + semantic layer + 7 exporters — the engine. `@reframe/editor` = DOM canvas (iframe + HTML exporter + CSS 3D transforms) + selection overlays + zoom/pan + present mode. `@reframe/mcp` = 7 MCP tools + Platform UI (`:4100`) + REST API + SSE sync. **No @open-pencil/core, no CanvasKit, no Skia in runtime** — removed 2026-04-22. Editor bundle ships at ~32 KB; scene renders through the same HTML exporter whether you're editing, exporting, or previewing.

**For design work:** three input paths — DESIGN.md seeds brand context, AI agent writes HTML, direct canvas editing (drag / resize / inline-text-edit / Shift+click multi-select / present mode via `P` key). All converge on one INode SceneGraph. Server is the single source of layout truth: every mutation endpoint runs `ensureSceneLayout` + SSE broadcasts + canvas incremental-patches without flashy full reload.

## When running as the in-app agent

When you're spawned by `/api/agent/chat` (the Platform UI's bottom chat or right sidebar), you're inside an open reframe session talking to a designer — not a developer. Every intent routes through exactly one of the 8 reframe skills below. Each skill is written as **role + sensitive surfaces + smell table + canonical flows**, not as a procedure — the engine handles procedure, skills carry the taste + failure-pattern memory the engine can't encode.

| User intent | Skill | First move |
|---|---|---|
| "make / build / design / redo …" a page, section, hero, form, dashboard | `reframe-design` | Check brand context, write HTML with taste rules baked in, `reframe_compile`, scan smell table |
| Names a brand (Stripe, Linear, Airbnb…) or "apply / rebrand / use X's style" | `reframe-brand` | `reframe_design action=extract` → Read DESIGN.md → then design or rebrand-in-place |
| Multiple pages / full site / sitemap | `reframe-site-loop` | Write SITE.md + next-prompt.md baton, one page per turn, brand frozen on turn 1 |
| Vague / mood-only / ≤ 10 words ("a landing page", "something nice") | `reframe-enhance` | Rewrite into structured brief (DESIGN SYSTEM + sections + audience + must/nice), hand off |
| "how does this look?" / "review" / "make it better" / "polish" | `reframe-critic` | Read `reframe_inspect` + DESIGN.md, ≤3 concrete fixes with engine citations |
| "export to React" / "give me TSX" / "ship as components" | `reframe-to-react` | Ask stack once, map to `reactTarget`, call `reframe_export reactTree=true`, relay verbatim |
| "animate / make it move / fade in / stagger / shader transition / TTS / captions / promo video / render MP4" | `reframe-motion` | Consult decision table — stay in INode-space for simple motion, drop to raw hyperframes HTML for complex (shaders / TTS / multi-scene); bridge `.reframe/brands/<slug>/DESIGN.md` into their HARD-GATE; never expose composition HTML to the designer |
| "test the UI" / "QA the platform" / "find bugs" / "cross-layer debug" (dev-side) | `designer-qa` | **Orchestrator.** ASK or propose first (never auto-walk). Localize bug by layer, then dispatch — call `reframe-critic` for taste judgments, `reframe-design` for HTML fixes, `reframe-brand` for fidelity verification, `reframe-to-react` for export-shape issues, `reframe-motion` for animation regressions; patch engine + UI + exporters + tool handlers; write regression tests in `packages/core/src/tests/` when warranted; re-verify; log recurring patterns to smell tables. See § Orchestration. |

**The costume, not the CLI.** You have the full reframe MCP (6 core pipeline tools + `reframe_ui` for Playwright-backed browser automation) plus all normal Claude Code tools. But the user in the browser doesn't want a dev session — they want scene changes. Prefer `reframe_edit` over regeneration when the ask fits an INode property. Keep tool chatter short. Show your work in the preview, not in words.

**All 8 reframe skills share the same shape** — role frame + sensitive surfaces + smell table + canonical flows + anti-patterns + tools to reach for. The smell tables GROW: when you catch a failure pattern the engine can't encode (brand drift, slop signature, site-level cross-page regression, export determinism gap, motion slop etc.), add a row. The next session catches the same pattern in seconds rather than rediscovering it.

**Plus 3 mirrored skills** from [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes): `hyperframes`, `gsap`, `hyperframes-registry` — byte-verbatim copies under `.claude/skills/`. These are NEVER routed to directly — only `reframe-motion` delegates to them when its decision table lands on "raw hyperframes". Re-sync quarterly via sparse git clone (see `reframe-motion` skill footer for the command). Never hand-edit — would break upstream merge.

**The engine is deterministic; the skills are the memory the engine lacks.** 37-rule audit + 8 aesthetic metrics + brandFidelity measure structure. Smell tables catch what structural measurement misses: genericness, fake content, fake logos, tone mismatch, gradient inflation, corner inflation, brand type weight collapse, site nav drift, centered-hero-with-5-elements. That's the moat.

**Full-stack debug + cross-layer fix** (dev-side, not designer-side): `designer-qa` drives Chromium via `reframe_ui`, uses the Platform map in its SKILL.md to localize bugs by layer (engine · UI · export · brand · taste · tests), and **orchestrates fixes across layers** — it's the only skill that sees the whole stack. When a bug is worth guarding against, it writes a regression test in `packages/core/src/tests/` (engine) or drives a Playwright probe (UI). It's the one skill that can close a bug grammatically from symptom to patch to proof.

**Scope context is pre-loaded.** The bottom chat prepends `[Scope: node: … · brand: … · viewport: …]` to each message. Trust it. If the scope says `brand: stripe`, don't re-extract — just Read the cached DESIGN.md.

### Working chain — follow every turn

1. **Plan with TodoWrite.** Any request that takes more than one step (read DESIGN.md → write HTML → compile counts as three) starts with a `TodoWrite` call listing the steps. Mark each `completed` the moment it's done — don't batch. The bottom-chat UI renders this as a live checklist, so the user sees progress. Skip TodoWrite only for pure Q&A or a single `reframe_edit` property tweak.

2. **Copy before big edits.** If the user asks to "make a dark version / variant / alternative" of an existing scene, don't edit the source in place — call `reframe_project action=clone` (or Write a new `.reframe/src/<name>-variant.html` alongside the original) and work on the copy. The original scene stays intact so the user can compare.

3. **Reuse over regenerate.** Small asks (color, spacing, swap a label, toggle dark mode on an existing token set) = one `reframe_edit` call. Reach for `reframe_compile` only when structure changes or the source HTML is wrong. Regeneration from scratch is the last resort, not the default.

4. **End with a compact summary.** After the final tool call, reply with 2-4 lines max: what you did, then 2-3 "Next steps if useful:" suggestions the user can pick from. No headers, no restating the prompt, no emoji.

## Orchestration — one agent, many skills

Seven of the eight reframe skills are **specialists** — one mental model each. One skill is an **orchestrator** — `designer-qa`. One skill (`reframe-motion`) is a **level-decider** that delegates downward to mirrored hyperframes skills. This section names the boundaries so the agent doesn't either (a) treat every task as orchestration, bloating simple asks, or (b) stay in a specialist silo when a bug genuinely spans layers.

### Role matrix

| Skill | Role | Can summon other skills? | Scope of authority |
|---|---|---|---|
| `designer-qa` | **Orchestrator** | Yes — any specialist | Debug, test, fix across engine · UI · export · brand · tests |
| `reframe-site-loop` | **Site-scoped coordinator** | Yes — brand, enhance, design, critic, per turn | Multi-page generation only, one page per turn, baton-driven |
| `reframe-motion` | **Level-decider** | Yes — delegates DOWN to mirrored `hyperframes` / `gsap` / `hyperframes-registry` for raw-composition work | One motion intent, INode-space vs raw-hyperframes routing |
| `reframe-design` | Specialist — write HTML | Reads brand DESIGN.md; hands off to critic at end | One scene, taste + smell table |
| `reframe-brand` | Specialist — parse & bind tokens | Patches `parser.ts` inline (Auto-diff) | One brand load, etalon enrichment |
| `reframe-critic` | Specialist — ≤3-item review | Hands off to design on "apply?" | One compiled scene, translate numbers → taste |
| `reframe-enhance` | Specialist — brief-writer | Hands off to design, site-loop, or motion | One vague intent → structured brief |
| `reframe-to-react` | Specialist — stack translator | None | One scene → TSX, byte-deterministic |

Two orchestrators exist. They don't overlap: `reframe-site-loop` **builds** across pages; `designer-qa` **debugs & fixes** across layers. `reframe-motion` is a third coordinator kind — it **delegates downward** to externally-authored skills (the mirrored hyperframes trio) and translates their output back into reframe artifacts; it doesn't orchestrate sibling reframe specialists. Summoning is one-way: reframe → hyperframes, never the reverse.

### When `designer-qa` enters orchestrator mode

Not on every invocation — only when the ask (or the bug it uncovers) spans layers. Enter orchestrator mode if any of:

- A rendering bug is half engine (Yoga / importer / layout) and half taste (which value is "right")
- An export differs from the canvas — exporter + audit + possibly types.ts all in play
- A QA sweep found a pattern worth a regression test in `packages/core/src/tests/`
- A fix in one layer requires verification in another (engine patch → re-import test → UI probe → export cross-check)
- A brand rebrand chain surfaced a parser gap → patch `parser.ts` → re-extract → re-audit across N scenes

If the ask is a single-layer concrete question ("check if right-panel updates after canvas edit"), stay focused — don't fan out into orchestration for its own sake.

### Rules of orchestration

1. **Read the specialist's SKILL.md inline; don't reinvent its judgment.** If you need critic's taste framing, open its SKILL.md and apply the ≤3-item rubric. If you need brand's parser-drift protocol, open its SKILL.md and run the Auto-diff step. Never rewrite a specialist's decision procedure in the QA session.
2. **Optional: spawn a specialist as an Agent subagent** when the work is independent and self-contained (e.g. critic running in parallel while you continue probing UI). Prefer inline skill-application for work that's tightly coupled to what `designer-qa` is already doing.
3. **Specialists don't summon the orchestrator.** If a specialist catches a cross-layer finding, it reports to the user in its normal output; the user decides whether to invoke `/designer-qa`. This prevents recursion and keeps invocation intent user-driven.
4. **Fixes stay small per layer.** ≤ 40 lines per fix layer, same as the in-bucket rule inside `designer-qa`'s SKILL.md. An orchestrated fix might touch 2-3 layers — each stays under budget. If any one layer needs more, split into a follow-up.
5. **Every orchestrated fix ends with three things:** a re-verification probe that would have caught the bug, a row in the relevant smell table (parser / taste / export / UI / site), and a single-sentence user-facing summary. No sprawling status reports.
6. **Regression tests live where the bug lived.** Engine bug → `packages/core/src/tests/`. UI bug → covered by a `reframe_ui` probe logged as a smell row (we don't have a Playwright CI harness yet; the probe IS the test).
7. **Do NOT hide orchestration from the user.** Before spanning 3+ layers or calling 2+ specialist skills, say in one sentence what you're about to do. Orchestration without narration looks like a loop that got out of control.

### The enhance preprocessor — route vague intent here FIRST

`reframe-enhance` is a **specialist about prompts**, not about output. Its job: turn natural-language user intent into a structured brief that the target specialist can execute deterministically. Without it, the orchestrator either (a) ad-hoc interprets every session (different result each time) or (b) falls back to a canonical shape (same boring output every time). Both are bad.

**Decision tree for the orchestrator (or any skill routing a vague ask):**

```
User gives a vague ask (≤10 words, or ambiguous scope, or missing signals)
   │
   ▼
Is the ask TRIVIAL and single-layer?
   ("change the button color", "look at this scene", "export as TSX")
   │
   ├─ YES → handle directly via the target specialist; no enhance
   │
   └─ NO (complex, multi-cluster, cross-layer, or user wants a plan before execution)
         │
         ▼
       Route to reframe-enhance FIRST
         │
         ▼
       enhance reads the target specialist's SKILL.md, picks the right brief shape,
       asks ≤ 2-3 questions, produces structured brief
         │
         ▼
       Hand the brief back to the target specialist as the prompt body
         │
         ▼
       Target specialist executes against the brief — no re-interpretation
```

**Why this matters.** Vague intent handled ad-hoc = the user's earlier complaint: *"он одно и тоже гоняет каждый раз — дичь"*. The fix isn't "make the specialist smarter at guessing" — it's "give the specialist a deterministic brief so guessing isn't in the loop".

**When the orchestrator itself gets a vague ask** (e.g. `/designer-qa` with no concrete target): the skill's own First move (ASK / PROPOSE / concrete-target) handles trivial cases. For complex QA asks where a structured brief would prevent re-discovery next session — route to enhance, produce a QA-shaped brief, then enter orchestrator mode against that brief.

**Enhance is a specialist, not an orchestrator** — it doesn't execute, it just normalizes. Brief → handoff. No infinite loops.

### Parallel fix-in-bucket — when and how

Some orchestrator work is embarrassingly parallel: N independent slices of the same class of problem, each touchable without stepping on the others. For this class, spawn subagents, let them work blind, merge their findings.

**The shape** (pioneered in `designer-qa § How to run a sweep`; canonical recipe lives there):

1. **Partition by distinct state.** Each subagent owns a slice that's isolated at the data layer — a project slug, a brand batch, a scene range, a viewport class, a test-file directory. If two subagents could touch the same file for mutation, the partition is wrong.
2. **Pre-flight serially.** Anything shared (brand extraction, slug reservation, directory creation) happens once before spawn. A subagent trying to extract a brand another subagent is already extracting corrupts both.
3. **Spawn all subagents in one message** via parallel `Agent` tool calls, each with a self-contained prompt naming its slice and the rules (no cross-talk, no shared sessions, return structured findings).
4. **Each subagent fixes in-bucket** for mechanical patches within its budget (≤ 40 lines, re-verify with the same probe that caught the bug, no yak-shaving). Conflicts where two buckets race the same file: the loser logs `fix=conflict` and moves on — main skill handles serially at merge.
5. **Main skill merges + serially finishes leftovers.** Dedup findings by sentinel, serial-fix anything the buckets couldn't close, promote new sentinels into the relevant smell table, flip `🔴 → 🟢` only after re-verify.

**When parallel is right:**
- `designer-qa` — three Chromium sessions on three distinct project slugs (the canonical case).
- `reframe-brand` catalog-wide Auto-diff — 60+ brands split into N batches, each batch reads DESIGN.md + parsed DesignSystem and reports drift rows. Parser fixes happen serially afterward because `parser.ts` is a single shared file.
- `reframe-critic` multi-scene review — one critic per scene when reviewing a site's N pages, each returns its ≤3-item report; the main skill composes the cross-page summary.
- Regression-test batch runs — one subagent per test directory, each runs + reports failures; main skill fixes serially.

**When parallel is wrong:**
- **Shared-file mutation in the FIX phase.** Parser patches, schema edits, single-doc rewrites — serialize the fix, even if the detection phase was parallel. Two agents editing `parser.ts` simultaneously produce a broken merge.
- **Sequential dependency.** `reframe-site-loop` is the textbook counter-example — page N's nav references page 1's slugs. Never parallelize site generation. Build is serial; only QA-after-build can parallelize per page.
- **Small scope.** One scene, one brand, one bug — the parallel overhead (pre-flight + spawn + merge) exceeds the wall-clock win.
- **Low RAM / co-hosted live user.** Three Chromium contexts ≈ 2-3 GB. If the sidecar is serving a live user session right now, their session wins — run serial.

**Naming rule (learned 2026-04-20).** Bucket identifiers must have distinct first-tokens (split on `-` / `_`). `qa-a-run1` + `qa-b-run1` share the first token `qa` and collapse under the dashboard's prefix-heuristic (`inferProjectKey`), causing routing 404s. Use `qaa-<ts>` / `qab-<ts>` / `qac-<ts>` or any three ids whose first hyphen-token differs.

**Finding-line format across all parallel orchestrations:**
```
<state> · <surface> · <sentinel> · <evidence> · fix=<yes|no|conflict|needs-pr|none> · files=[...]
```

Subagents don't edit skill smell-table states (🔴 ↔ 🟢) — they report `fix=yes` and the main skill flips the row after merge + re-verify. Subagents also don't commit — fixes stay uncommitted for main-skill review.

### Anti-patterns

- **Orchestrator mode by default.** `/designer-qa` without a concrete bug or cross-layer symptom = ask or propose (see the skill's § First move). Don't wind up the orchestrator machinery for a scoped question.
- **Specialist skill invoking the orchestrator.** `reframe-design` should never call `designer-qa`. That direction is inverted.
- **Fixing across layers without verification between them.** Patch engine → re-import → verify. Then patch UI → reload → verify. Not "patch all three then verify at the end" — a mid-chain failure leaves you guessing which patch broke what.
- **Using orchestrator mode to add features.** Orchestration is for debug/test/fix and for multi-layer cleanup. Feature work is a specialist's job (design / site-loop).
- **Skipping the smell-table row.** Every orchestrated fix teaches the system something. If the row doesn't land, the next session rediscovers the same bug from scratch.
- **Parallelizing the fix phase on shared files.** Detection phase parallel — fine. Fix phase on `parser.ts` / `types.ts` / a single doc — serialize. Two subagents editing the same file concurrently = corrupt merge.
- **Sub-agents summoning sub-agents.** Parallelism is 1-level only. An orchestrator spawns N specialists; those specialists do NOT spawn more. Depth > 1 loses merge discipline and blows memory.

## Build & Test

```bash
npm run build                              # build all 4 packages (core, cli, mcp, editor)
npm test                                   # run all tests
npx tsc --noEmit -p packages/core/tsconfig.json    # typecheck core
npx tsc --noEmit -p packages/mcp/tsconfig.json     # typecheck mcp
npx tsc --noEmit -p packages/editor/tsconfig.json  # typecheck editor
node packages/editor/src/bridge/bridge.integration.test.mjs  # editor integration test (35 assertions)
```

## Pipeline (design → compile → inspect → edit → export)

```
1. reframe_design → load brand context
     action: "list"                         → browse 60+ brands
     action: "extract", brand: "stripe"     → full DESIGN.md (300+ lines)

2. reframe_compile → YOU write full HTML with inline styles, pass to compile
     html: "<div style='width:1440px'>..."  → first compile
     file: ".reframe/src/home.html"         → re-compile after editing source

3. reframe_inspect → review 37-rule audit → reframe_edit to fix → re-inspect

4. reframe_export → deliver (html/react/svg/png/pdf/lottie/animated_html/site)
```

## Packages (4)

```
packages/core      @reframe/core    — headless engine: SceneGraph, audit (37 rules), tokens, resize, variations, 8 exporters, HTML import, animation
packages/mcp       @reframe/mcp     — MCP server (7 tools — reframe_block folded into design/edit) + HTTP sidecar (:4100) + Platform UI + REST API + SSE
packages/editor    @reframe/editor  — DOM canvas editor: iframe + HTML exporter + CSS 3D transforms + selection overlay + present mode (~32 KB bundled)
packages/cli       @reframe/cli     — CLI: init/build/test
```

## MCP Tools — 7 total

```
reframe_design     brand load/list/extract (60+ brands via getdesign) + catalog: listBlocks / extractBlock (hyperframes motion library)
reframe_compile    HTML → INode scene + 37-rule audit + auto-fix + token binding
reframe_inspect    tree + 37-rule audit + 8 aesthetic metrics + brand fidelity + diff + semantic skeleton
reframe_edit       ALL mutations — update / add / delete / clone / move / resize / macros (scaleSpacing, scaleRadius, rotateColors, typographyPreset) / components / variations / adapt / vary / addBlock (install hyperframes catalog block as INode subtree)
reframe_export     7 formats: html (optionally animated via `animate` config) / react / svg / png / pdf / lottie / video (hyperframes-backed MP4)
reframe_project    persistence — save/load/history/content/macros/brands/components
reframe_ui         Playwright-backed Platform UI automation — open/act/probe/screenshot/wait/close/list
```

reframe_ui drives the live Platform UI via Playwright — stateful sessions, inline PNG + console/network logs returned on every mutating call. Mirrors what reframe_compile/inspect/edit do for the engine, but for the browser side — reproduce UI bugs, verify fixes, walk multi-step flows end-to-end. Catalog blocks (formerly `reframe_block`) are browsed via `reframe_design action=listBlocks` and installed via `reframe_edit op=addBlock` — one merged surface instead of two overlapping tools.

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

## Taste rules (the audit doesn't catch these — honor them anyway)

These are enforced as a system rule, not per-skill. They apply every time the agent writes HTML, regardless of which skill is active.

- **Max one accent color** above 80% saturation. A second high-sat color is noise.
- **No pure black (`#000`).** Use `#111`–`#1a` even on dark themes. Pure black burns holes in a dark layout.
- **Inter is banned for premium / editorial contexts.** Use Geist, Outfit, Cabinet Grotesk, or Söhne. Inter is fine for neutral SaaS / dashboards.
- **Serif in dashboards = no.** Serif is editorial only.
- **Never invent numbers, stats, logos, or testimonials.** If the user didn't provide them, use neutral labels ("trusted by teams", not "trusted by 40k engineers"). This is the most common way generated designs feel fake.
- **Emoji-as-UI is a tell.** Emoji in body copy = fine. Emoji as iconography = replace with SVG or glyph characters.
- **No "3 equal cards horizontally."** Use asymmetric grid / zig-zag / bento. The generic 3-up is the AI-slop signature.
- **Centered hero only when variance is low.** Headline + CTA = centered okay. Headline + 3 stats + image + 2 CTAs = not centered.
- **Motion via `transform` / `opacity` only.** Never animate `top/left/width/height`. Spring physics ≈ stiffness 100, damping 20.

## DESIGN.md = Brand Context

Agent receives the **full DESIGN.md** from `reframe_design` — 300+ lines with exact colors, typography, button variants, card/badge/input/nav specs, spacing scale, shadows.

**IMPORTANT:** Read the DESIGN.md carefully. Use those exact values. The 37-rule audit validates against it.

## Common Gotchas

- linkedom (HTML import) does not compute CSS flex constraints — but Yoga handles layout post-import. `flex:1` in HUG parents now works correctly (fixed: flexBasis conditional on parent sizing).
- CSS Grid is fully supported: `display:grid`, `grid-template-columns`, `grid-column/row: span N`, gap. Imports as `layoutMode: 'GRID'`.
- `width: fit-content` / `min-content` / `max-content` handled as HUG sizing (not parsed as 0).
- @media responsive rules link correctly via linkedom `data-reframe-idx` (index mismatch fixed).
- Audit overflow rules respect `clipsContent` — flex containers with explicit dimensions auto-clip
- `reframe_compile` shows warnings inline now — fix them before export
- Brand DESIGN.md files cached in `.reframe/brands/` — delete to re-fetch
- Token export: `defineTokens` auto-saves `.reframe/tokens.json` (DTCG format)
- Aesthetic scoring: 8 metrics (alignment, whitespace, balance, harmony, hierarchy, rhythm, readability, proportion)
- PNG/PDF export: uses CanvasKit WASM **server-side only** (loaded lazily by `packages/core/src/exporters/raster.ts` on first raster call). Browser editor never touches it — HTML rendering happens natively via iframe.
- Layout backend: Yoga WASM (own mapping logic). Optional Taffy fallback via `setLayoutBackend('taffy')` before `initYoga()` — requires `yoga-layout-taffy` npm.
- Canvas backend: DOM + iframe + CSS 3D. OP / CanvasKit / Skia removed from editor runtime 2026-04-22 (see `.claude/skills/designer-qa/SKILL.md` Fix log `architecture/op-removal-B-C`). `.fig` import unsupported — use Figma's "Copy as HTML" + `reframe_compile` instead.
- Video export: uses `hyperframes` CLI out-of-process (Puppeteer + FFmpeg). Telemetry disabled globally. `reframe_export format=video renderVideo=true` spawns the render inline.
- `project init` with a different dir preserves session scenes (no longer clears them).
