# reframe-design skill

Teaches agents to drive the reframe design pipeline — write HTML, compile it into the engine's INode graph, iterate via the 37-rule audit, export to one of 8 formats.

## What it does

- **Routes design intents** to the right workflow: new scene / edit existing / fix audit.
- **Enforces HTML invariants** the engine's audit validates against (inline styles, explicit colors, 44px buttons, OpenType features).
- **Encodes taste rules** the machine audit can't measure (max-1-accent, no pure black, no fake metrics, no 3-equal-cards).
- **Hands off** to `reframe-brand` for DESIGN.md extraction, `reframe-enhance` for vague prompt rewriting, `reframe-critic` for post-compile review.

## Install

Skills in this repo ship via the `.claude/skills/` directory — Claude Code auto-discovers them when the workspace root is the cwd of the subprocess. No separate install step.

External use (via the `stitch-skills` pattern):

```bash
npx skills add ilya-makarov-dev/reframe --skill reframe-design
```

*(not yet published — placeholder)*

## Example prompt

```
Make a pricing page for a SaaS — 3 tiers, use the Linear brand.
```

The skill will:
1. Recognize the brand mention → hand to `reframe-brand` to extract DESIGN.md
2. Route to `workflows/text-to-design.md`
3. Write `.reframe/src/pricing.html` with inline styles using Linear tokens
4. Call `reframe_compile` → `reframe_inspect` → fix loop
5. Offer `reframe-critic` to validate taste

## Skill structure

```
reframe-design/
├── SKILL.md                 — agent entry point (trigger map + invariants)
├── README.md                — this file
├── workflows/
│   ├── text-to-design.md    — new scene pipeline
│   ├── edit-design.md       — iterate on an existing scene
│   └── fix-audit.md         — triage and fix failed audit rules
├── references/
│   ├── html-rules.md        — the engine's HTML invariants
│   ├── tool-schemas.md      — reframe_* MCP tool signatures
│   └── taste-anti-patterns.md — rules the audit doesn't catch
└── examples/
    ├── stripe-hero.html     — gold-standard reference (on-brand + audit-clean)
    └── pricing-flow.md      — worked example: prompt → inspect-clean
```

## Works with

- [`reframe-brand`](../reframe-brand/) — load DESIGN.md before generating
- [`reframe-enhance`](../reframe-enhance/) — rewrite vague prompts into structured ones
- [`reframe-critic`](../reframe-critic/) — post-compile taste review using audit + aesthetic scores
- [`reframe-site-loop`](../reframe-site-loop/) — multi-page sites via baton pattern
- [`reframe-to-react`](../reframe-to-react/) — refactor machine-exported React into production tree

## Learn more

Start with [SKILL.md](SKILL.md) — it's the agent's entry point. Dive into individual workflows / references as needed.
