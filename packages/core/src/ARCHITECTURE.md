# Core Architecture

```
src/
│
├── ui/                 @reframe/ui — 120 functions, standard library
│   ├── layout.ts         page, stack, row, wrap, grid, center, spacer
│   ├── atoms.ts          heading, body, label, caption, display, mono, divider
│   ├── composites.ts     button, card, badge, chip, tag, avatar, stat, quote
│   ├── data.ts           table, tabs, accordion, progress, toggle, select
│   ├── navigation.ts     sidebar, breadcrumb, pagination, stepper
│   ├── feedback.ts       modal, toast, tooltip, alert, banner, skeleton
│   ├── forms.ts          checkbox, radio, slider, formGroup, searchInput
│   ├── sections.ts       heroSection, featureGrid, pricingSection, footer
│   ├── style.ts          fill, pad, gap, size, radius, shadow, border (35)
│   ├── theme.ts          createTheme, themed, fromDesignMd, landing
│   ├── render.ts         render() — one-liner: blueprint → build → export
│   ├── blueprint.ts      JSON tree → @reframe/ui calls (define/use)
│   └── defaults.ts       centralized color/spacing defaults
│
├── compiler/           Content + DesignSystem → INode blueprint
├── config/             Build system: reframe init/build/test
├── builder.ts          frame(), text(), solid() → build() → SceneGraph
│
├── engine/             Scene graph, Yoga layout, components, constraints
├── host/               INode / IHost universal interfaces
├── adapters/           Figma, Canva, Standalone (INode ↔ platform)
│
├── exporters/          HTML, SVG, PNG, React, Animated HTML, Lottie
├── importers/          HTML (linkedom), SVG, Figma REST
├── design-system/      Extract, parse, export DESIGN.md + tokens
├── animation/          Timeline, 17 presets, easing, spring physics
│
├── audit.ts            19 audit rules + auto-fix
├── assert.ts           Design assertions (fluent API)
├── diff.ts             Structural tree comparison
├── semantic.ts         Role detection, HTML tag mapping, ARIA
├── serialize.ts        INode ↔ portable JSON
│
├── pipeline/           DAG executor (parallel rounds, timeout, retry)
├── project/            Persistent .reframe/ project system
│
├── resize/             Smart adaptation engine (59 files)
│   ├── adapt.ts          Entry: adaptFromGraph()
│   ├── postprocess/      Semantic classifiers, guide scalers (27)
│   ├── pipelines/        Cluster-scale (uniform, letterbox, cover)
│   ├── scaling/          Element-level transforms
│   ├── layout-profile/   Content pattern analysis
│   ├── orchestration/    Figma plugin orchestration
│   ├── geometry/         Vector math, rect operations
│   ├── contracts/        Shared types
│   ├── data/             Guide presets
│   ├── logging/          Session run logs
│   └── utils/            Formatting
│
├── spec/               Conformance suite
└── tests/              Unit + integration tests
```
