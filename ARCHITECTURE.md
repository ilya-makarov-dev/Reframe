# reframe — Architecture

> reframe is a **design operating system**: a kernel + default editor + installable packs + marketplace for everything in between. Open the default shell, make designs; or fork the shell, or build your own vertical on the same kernel.

This file names the layers so nobody has to reverse-engineer them from package.json and import graphs.

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  DISTROS      reframe-studio · reframe-decks · reframe-sites     │  what end-users install
│               (kernel + std + runtime + shell + packs bundle)    │
├──────────────────────────────────────────────────────────────────┤
│  SHELL        shell-studio  — feed + catalogs + drilldown        │  replaceable surface
│               shell-decks   — (future, vertical)                 │  declared in project.json
│               shell-sites   — (future, vertical)                 │
├──────────────────────────────────────────────────────────────────┤
│  PACKS        brand/<slug>     — tokens + DESIGN.md              │  installable artifacts
│               panel/<name>     — one or more *.panel.html        │  (registry: github-first
│               tool/<name>      — MCP tool definitions (future)   │   → own registry later)
│               recipe/<name>    — prompt + scene templates        │
├──────────────────────────────────────────────────────────────────┤
│  STD          panel helpers · Block A primitives · gesture       │  standard library
│               recipes · sizing helpers · DSL for composers       │  authors of packs consume
├──────────────────────────────────────────────────────────────────┤
│  RUNTIME      HTTP sidecar · SSE · MCP bridge · gesture          │  init + syscalls
│               dispatcher · panel registry · shell registry       │  (@reframe/mcp today)
├──────────────────────────────────────────────────────────────────┤
│  KERNEL       INode AST · layout (Yoga) · audit (37 rules) ·     │  substrate
│               tokens · exporters (7 formats) · compiler          │  (@reframe/core today —
│               HTML/SVG importers · variations · aesthetic        │   pure, no UI, no network)
└──────────────────────────────────────────────────────────────────┘
```

## Where each layer lives today

| Layer | Folder | Notes |
|---|---|---|
| Kernel | `packages/core/src/{engine,audit,aesthetic,brand-fidelity,design-system,exporters,importers,variations,resize,compiler,config,content,serialize.ts,...}` | Pure data + math. No network, no UI. Call with any Node/Deno runtime. |
| Std | `packages/core/src/panels/helpers.ts` · Block A primitives scattered in `engine/types.ts` · gesture shapes | To be consolidated as `packages/std/` in a future pass. |
| Runtime | `packages/mcp/src/` (minus shell pages) — `http-server.ts`, `events.ts`, `store.ts`, `session.ts`, `preview-inject.ts`, `api/`, `tools/`, `platform/panels.ts`, `panel-registry.ts`, `panel-hot.ts`, `shell-registry.ts`, `project-manifest.ts`, `pack-loader.ts`, `api/agent-runtime.ts` | Receives HTTP requests, dispatches to shell + MCP tools. Loads project manifest + packs at boot. |
| Shell (studio) | `packages/mcp/src/platform/pages/{feed,brands-catalog-page,components-catalog-page,card-drilldown,...}.ts` + `.reframe/ui/*.panel.html` (for the default project) | Registered in `shell-registry.ts`. Match subpaths relative to `/platform`. Every visible pixel is an artifact. |
| Packs | `.reframe/packs/<kind>/<name>/pack.json` + kind-specific content. Legacy-compat reads also from `.reframe/brands/` and `.reframe/ui/`. | Scanner: `platform/pack-loader.ts`. First-class packs win over legacy paths on name clash. |
| CLI | `packages/cli/src/commands/{new,serve,add,ship,build,test,init,...}.ts` | Produce and serve projects. `reframe new` / `reframe serve` / `reframe add` / `reframe ship` are the v1 product CLI. |

## The project container — `.reframe/`

A reframe project is a directory with a `.reframe/` subtree. It's the container: everything about the project lives here, nothing in a cloud account, nothing mandatory outside.

```
myproject/
  .reframe/
    project.json       # manifest v1 — distro, shell, kernel band, packs
    scenes/            # INode graphs (user designs)
    brands/            # legacy brand dir (still read — packs/brand/ wins on clash)
    packs/             # first-class installed packs
      brand/ferrari/   # pack.json + DESIGN.md + assets/
      panel/timeline/  # pack.json + *.panel.html
    ui/                # loose panel artifacts (hot-reloadable, legacy-friendly)
    components/        # saved component masters (INode subtrees)
    exports/           # rendered outputs — html, react, svg, pdf, mp4
    history/           # op log (undo + lineage source)
    cache/             # preview thumbnails, intermediate renders
    dist/              # production bundle (via `reframe ship`)
  src/                 # HTML sources the user / agent authors
```

### Manifest shape

```json
{
  "reframe": "1",
  "name": "my-project",
  "distro": "studio",
  "shell": "studio",
  "kernel": "^1.0",
  "packs": {
    "brand/ferrari": { "version": "1.0", "source": ".reframe/packs/brand/ferrari" },
    "panel/version-history": { "version": "0.3", "source": ".reframe/packs/panel/version-history" }
  }
}
```

- **`reframe`** — manifest schema version. Current `"1"`.
- **`distro`** — what flavor of reframe expects to boot this project. Unknown distro = warn, not crash.
- **`shell`** — resolved by `shell-registry.ts`. Unknown = fall back to `studio`.
- **`kernel`** — semver-like band. Future versions enforce compat before boot.
- **`packs`** — map of `<kind>/<name>` → install record.

Legacy fields (`version`, `brands`, `scenes`, `activeBrand`) are preserved unchanged for backwards compatibility.

## Pack shape

Every pack is a directory with a `pack.json` at its root:

```json
{
  "name": "version-history",
  "version": "1.0.0",
  "kind": "panel",
  "kernel": "^1.0",
  "description": "Scene version timeline as a right-panel artifact",
  "main": "version-history.panel.html",
  "author": "reframe-community",
  "license": "MIT"
}
```

**Kinds:**
- `brand` — DESIGN.md (required) + optional `tokens.json` + `assets/`
- `panel` — one or more `*.panel.html` artifacts (main specifies entry)
- `tool` — MCP tool definitions (schema TBD)
- `recipe` — prompt + scene templates (schema TBD)
- `shell` — alternate shell (main specifies an entry module that calls `registerShell`) — schema TBD

Legacy layouts (`.reframe/brands/<slug>/DESIGN.md`, loose `.reframe/ui/*.panel.html`) are surfaced as **implicit packs** by the loader so no migration is forced on existing projects.

## Boot sequence

```
reframe serve (or MCP stdio connect)
        │
        ▼
sidecar binds :4100 (coexistence check — skip if another healthy sidecar owns it)
        │
        ▼
reads `.reframe/project.json` via project-manifest.readManifest()
        │
        ▼
resolves `manifest.shell` → shell-registry.getShell(name)  → shell def
        │
        ▼
scans `.reframe/packs/` via pack-loader.listAllPacks() + legacy dirs
        │
        ▼
panel-registry hot-loads artifacts (loose + packs)
        │
        ▼
HTTP router receives /platform/* request:
   shell.match(subpath) → shell.dispatch({ ctx, subpath, url, req })
        │
        ▼
response HTML ← shell's page module (artifact-hydrated)
```

## Distribution

| Form | Who uses | How |
|---|---|---|
| **Native app (future Tauri wrapper)** | end-designer | One download bundles kernel + shell-studio + runtime. `.dmg` / `.exe` / Linux AppImage. |
| **Web version (future)** | try-before-install | Kernel-in-WASM + runtime via edge worker. Limited (no video/PDF until backend present). |
| **CLI (@reframe/cli)** | power users, CI | `npm i -g @reframe/cli` · `reframe new` · `reframe serve`. Canonical dev shape today. |
| **Stdio MCP** | AI agents (Claude, other) | `.mcp.json` points at sidecar binary; agents drive via MCP tools. |
| **Registry** | pack authors | Github-first in v1 (`reframe add github:org/pack`), own registry later. |

## Renaming direction (future)

The packages in this repo were laid down before these layers were named. Today the physical folders don't 1:1 match the layer words. Planned evolution:

- `packages/core` → **stays** but kernel + std split within (`packages/core/kernel/` vs `packages/core/std/`), then eventually extract to `packages/std/`.
- `packages/mcp` → split into `packages/runtime/` + `packages/shell-studio/`. Runtime keeps HTTP + SSE + MCP bridge; shell-studio keeps pages + default artifacts.
- `packages/editor` → stays (it's the DOM canvas, used by drilldown). Could move under `shell-studio/` since it's only used there.
- `packages/cli` → stays; adds commands as surface.

Renames will happen when they stop being theoretical — i.e. when someone wants to ship a `reframe-decks` distro that literally imports `@reframe/runtime` without also dragging the studio shell. Until then the boundary is enforced in code (exports) and doc (this file), not package.json.

## Non-goals

- **Not Figma.** Figma-app-shape (canvas+inspector) is one shell (drilldown edit); reframe is the layer beneath.
- **Not a chat assistant.** The chat is ONE surface. Drag-refs, hover actions, inspector, catalog — all first-class.
- **Not tied to one agent provider.** MCP is the interop point; any MCP-capable agent works.
- **Not a SaaS-only product.** The full product runs locally against `.reframe/`. Cloud sync / multiplayer come later as opt-in pack-kinds (e.g. `tool/collab`).

---

Single-sentence reframe for outsiders: *"reframe is the Lisp of design tools — a homoiconic kernel where UI, content, brand tokens, and interaction are one structured type, with a default editor (studio) made of itself and a pack ecosystem for everything else."*
