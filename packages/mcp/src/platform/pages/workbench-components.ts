/**
 * Components Workbench page — Phase 4 Brief 4a Pin #1+#2+#4.
 *
 * /platform/workbench/components — second canonical "domain workbench"
 * surface. Inherits the layout shape from brand workbench (Phase 3a):
 * catalog grid in default mode, workbench split-panel when ?slug= is
 * set. Component-specific deltas:
 *
 *   - "swatches" → "slot count" + "instance count" badges on cards
 *   - "preview iframe" → "live preview iframe" rendering the master subtree
 *   - "scenes-using strip" → "instances" list (sceneId / nodeId pairs)
 *   - "Apply to active scene" → "Insert into active scene" (instantiate flow)
 *
 * Render is server-side; interaction (extract, instantiate, override
 * editor) lives in 156-workbench-components.js.
 */

import type { ComponentCatalogEntry, ComponentMasterDetail, InstanceRef } from '../api/components-workbench-service.js';

export interface WorkbenchComponentsData {
  /** Workbench mode when set — show master detail + preview. Catalog mode otherwise. */
  selectedSlug?: string;
  /** Catalog entries — always populated. */
  catalog: ComponentCatalogEntry[];
  /** Loaded master + ComponentFile for the selected component. */
  selectedMaster?: ComponentMasterDetail;
  /** Live instance refs across all scenes. */
  instances?: InstanceRef[];
  /** Active scene id — used for Insert-into-scene affordance + preview context. */
  activeSceneId?: string;
  /** Active scene slug — display only. */
  activeSceneSlug?: string;
  /** Scenes the user can pick when instantiating, surfaced in the Insert flow. */
  availableScenes?: Array<{ id: string; slug: string; name: string }>;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function componentInitials(name: string): string {
  if (!name) return '?';
  const words = name.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function timeAgo(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function renderCatalogCard(entry: ComponentCatalogEntry): string {
  const slotsBadge = entry.slots.length === 0
    ? '<span class="cw-card-meta cw-card-meta--muted">no slots</span>'
    : `<span class="cw-card-meta">${entry.slots.length} slot${entry.slots.length === 1 ? '' : 's'}</span>`;
  const instancesBadge = entry.instanceCount === 0
    ? '<span class="cw-card-meta cw-card-meta--muted">no instances</span>'
    : `<span class="cw-card-meta cw-card-meta--active">${entry.instanceCount} instance${entry.instanceCount === 1 ? '' : 's'}</span>`;
  const desc = entry.description
    ? `<div class="cw-card-desc">${escape(entry.description)}</div>`
    : '';
  return `<a class="cw-card" href="/platform/workbench/components?slug=${encodeURIComponent(entry.slug)}" data-component-slug="${escape(entry.slug)}">
    <div class="cw-card-head">
      <div class="cw-card-mark" aria-hidden="true">${escape(componentInitials(entry.name))}</div>
      <div class="cw-card-rev">rev ${entry.revision}</div>
    </div>
    <div class="cw-card-name">${escape(entry.name)}</div>
    ${desc}
    <div class="cw-card-meta-row">
      ${slotsBadge}
      ${instancesBadge}
    </div>
    <div class="cw-card-foot">
      <span class="cw-card-slug">${escape(entry.slug)}</span>
      <span class="cw-card-updated">${escape(timeAgo(entry.updated))}</span>
    </div>
  </a>`;
}

function renderCatalogMode(data: WorkbenchComponentsData): string {
  const cards = data.catalog.map(renderCatalogCard).join('');
  const empty = data.catalog.length === 0;
  const grid = empty
    ? `<div class="cw-empty">
        <p class="cw-empty-title">No components yet.</p>
        <p class="cw-empty-lead">Components are reusable subtrees you save as masters and instantiate across scenes.
        To create one: open a scene, right-click a node you want to reuse, choose
        <strong>Extract component</strong>.</p>
        <a class="cw-btn cw-btn--primary" href="/platform">Open a scene</a>
      </div>`
    : `<div class="cw-catalog-grid" data-cw-grid>${cards}</div>`;
  return `<header class="cw-page-head">
    <h1 class="cw-title">Components workbench</h1>
    <p class="cw-lead">${data.catalog.length === 0
      ? 'A library of reusable subtrees you can drop into any scene.'
      : `${data.catalog.length} component master${data.catalog.length === 1 ? '' : 's'}. Each can be instantiated in any scene; edits to the master propagate to every instance.`}</p>
  </header>
  <div class="cw-toolbar">
    <input type="search" class="cw-search" placeholder="Filter components…" data-cw-filter aria-label="Filter components">
    <a class="cw-secondary" href="/platform">← Back to dashboard</a>
  </div>
  ${grid}`;
}

function renderMasterPreviewIframe(slug: string, sceneId?: string): string {
  // The master subtree lives only on disk as ComponentFile.root — there's
  // no standalone scene id for it. Phase 4a renders a static structural
  // summary inline (slot list + node count) and the iframe shows the
  // active scene with the instance highlighted (Insert flow target).
  // Full master-only render is Phase 4c scope (component preview endpoint).
  if (!sceneId) {
    return `<div class="cw-preview-empty">
      <p>Open a scene to see this component in context.</p>
      <p class="cw-preview-hint">A dedicated master-only preview ships in a later sub-brief.</p>
    </div>`;
  }
  const src = `/api/render/${encodeURIComponent(sceneId)}?format=html`;
  return `<iframe class="cw-preview-frame" data-cw-preview src="${escape(src)}" title="Active scene preview" sandbox="allow-same-origin allow-scripts" loading="lazy" data-component-slug="${escape(slug)}"></iframe>`;
}

function renderSlotsSection(master: ComponentMasterDetail): string {
  const slots = master.file.slots ?? [];
  if (slots.length === 0) {
    return '<div class="cw-section-empty">No slots declared. Mark nodes with <code>data-reframe-slot</code> in source HTML to expose them as overridable.</div>';
  }
  const rows = slots.map((slot) =>
    `<li class="cw-slot-row" data-cw-slot="${escape(slot)}">
      <span class="cw-slot-name">${escape(slot)}</span>
      <span class="cw-slot-meta">overridable</span>
    </li>`
  ).join('');
  return `<ul class="cw-slot-list">${rows}</ul>`;
}

function renderInstancesSection(instances: InstanceRef[], slug: string): string {
  if (instances.length === 0) {
    return `<div class="cw-section-empty cw-empty-with-action">
      <p>No instances of this component yet.</p>
      <button class="cw-btn cw-btn--primary" data-cw-instantiate data-cw-slug="${escape(slug)}">Insert into active scene</button>
    </div>`;
  }
  const rows = instances.map((inst) => {
    const overrideCount = Object.keys(inst.overrides).length;
    const overrideTag = overrideCount === 0
      ? '<span class="cw-instance-meta cw-instance-meta--muted">master defaults</span>'
      : `<span class="cw-instance-meta">${overrideCount} override${overrideCount === 1 ? '' : 's'}</span>`;
    return `<li class="cw-instance-row" data-cw-instance data-cw-scene-id="${escape(inst.sceneId)}" data-cw-node-id="${escape(inst.nodeId)}">
      <a class="cw-instance-link" href="/platform/project/${encodeURIComponent(inst.sceneSlug)}#${encodeURIComponent(inst.nodeId)}">
        <span class="cw-instance-scene">${escape(inst.sceneName)}</span>
        <span class="cw-instance-node">${escape(inst.nodeId)}</span>
      </a>
      ${overrideTag}
    </li>`;
  }).join('');
  return `<ul class="cw-instance-list" data-cw-instances>${rows}</ul>
    <div class="cw-instance-actions">
      <button class="cw-btn cw-btn--primary" data-cw-instantiate data-cw-slug="${escape(slug)}">+ Add instance to active scene</button>
    </div>`;
}

function renderSkillActionsSection(slug: string): string {
  // Phase 4a foundation only — chips render with data-cw-skill attrs but
  // are gated until Phase 4d wires them through the skill-bus. Dispatcher
  // surface ready (skillInvocationContext on service layer); UI chips
  // render as disabled placeholders with tooltip explaining the wire-up.
  return `<div class="cw-skills" data-cw-skills data-cw-slug="${escape(slug)}">
    <button class="cw-skill" data-cw-skill="reframe-critic" data-cw-skill-action="critique-master" data-cw-skill-context-kind="component-edit" disabled title="Phase 4d wires → skill-bus invoke">/critic master</button>
    <button class="cw-skill" data-cw-skill="reframe-design" data-cw-skill-action="design-variant" data-cw-skill-context-kind="component-edit" disabled title="Phase 4d wires → skill-bus invoke">/design variant</button>
    <button class="cw-skill" data-cw-skill="reframe-design" data-cw-skill-action="extract-from-selection" data-cw-skill-context-kind="design-intent" disabled title="Phase 4d wires → skill-bus invoke">/extract from selection</button>
  </div>
  <div class="cw-skill-log" data-cw-skill-log>
    <span class="cw-skill-log-label">Recent skill activity</span>
    <div class="cw-skill-log-entries" data-cw-skill-log-entries>
      <div class="cw-skill-log-empty">No activity yet — chips wire to bus in Phase 4d.</div>
    </div>
  </div>`;
}

function renderWorkbenchMode(data: WorkbenchComponentsData): string {
  const slug = data.selectedSlug!;
  const master = data.selectedMaster;
  const instances = data.instances ?? [];
  const sceneId = data.activeSceneId;

  if (!master) {
    return `<header class="cw-workbench-head">
      <a class="cw-back" href="/platform/workbench/components">← Back to catalog</a>
      <h1 class="cw-title">${escape(slug)}</h1>
    </header>
    <div class="cw-section-empty">Component master not found on disk. It may have been deleted, or the slug is mistyped.</div>`;
  }

  const sceneTag = data.activeSceneSlug
    ? `<span class="cw-meta-pill">scene: ${escape(data.activeSceneSlug)}</span>`
    : '<span class="cw-meta-pill cw-meta-pill--muted">no active scene</span>';

  return `<header class="cw-workbench-head">
    <a class="cw-back" href="/platform/workbench/components">← Back to catalog</a>
    <h1 class="cw-title">${escape(master.name)}</h1>
    <div class="cw-head-meta">
      <span class="cw-slug-tag">${escape(master.slug)}</span>
      <span class="cw-meta-pill">rev ${master.revision}</span>
      ${sceneTag}
      ${instances.length > 0 ? `<span class="cw-meta-pill">${instances.length} instance${instances.length === 1 ? '' : 's'}</span>` : ''}
    </div>
    <div class="cw-head-actions">
      <button class="cw-btn cw-btn--primary" data-cw-instantiate data-cw-slug="${escape(master.slug)}"${sceneId ? '' : ' disabled'} title="Add an instance of this component to the active scene">+ Insert into scene</button>
      <button class="cw-btn cw-btn--danger" data-cw-delete data-cw-slug="${escape(master.slug)}"${instances.length > 0 ? ' disabled title="Delete blocked while instances exist"' : ''}>Delete master</button>
    </div>
  </header>
  <div class="cw-workbench-body" data-cw-body data-cw-slug="${escape(master.slug)}"${sceneId ? ` data-cw-scene-id="${escape(sceneId)}"` : ''}>
    <section class="cw-detail">
      <details class="cw-section" open>
        <summary class="cw-section-head">Master</summary>
        <div class="cw-master-info">
          ${master.description ? `<p class="cw-master-desc">${escape(master.description)}</p>` : '<p class="cw-master-desc cw-master-desc--muted">No description.</p>'}
          <div class="cw-master-stats">
            <span><strong>${master.revision}</strong> revision${master.revision === 1 ? '' : 's'}</span>
            <span>created ${escape(timeAgo(master.created))}</span>
            <span>updated ${escape(timeAgo(master.updated))}</span>
          </div>
        </div>
      </details>
      <details class="cw-section" open>
        <summary class="cw-section-head">Slots <span class="cw-section-meta">${(master.file.slots ?? []).length}</span></summary>
        ${renderSlotsSection(master)}
      </details>
      <details class="cw-section" open>
        <summary class="cw-section-head">Instances <span class="cw-section-meta">${instances.length}</span></summary>
        ${renderInstancesSection(instances, master.slug)}
      </details>
      <details class="cw-section">
        <summary class="cw-section-head">Skill actions <span class="cw-section-meta">Phase 4d</span></summary>
        ${renderSkillActionsSection(master.slug)}
      </details>
    </section>
    <section class="cw-preview">
      <div class="cw-preview-shell">${renderMasterPreviewIframe(master.slug, sceneId)}</div>
      <div class="cw-preview-foot">
        <span class="cw-preview-label">Live preview — active scene</span>
      </div>
    </section>
  </div>
  ${renderInstantiateModal(master.slug, data.availableScenes ?? [])}`;
}

function renderInstantiateModal(slug: string, scenes: Array<{ id: string; slug: string; name: string }>): string {
  // Hidden by default. Bundle binder opens it from the Insert button when
  // there are multiple scenes available; with exactly one scene the binder
  // skips the modal and instantiates immediately.
  const sceneOptions = scenes.length === 0
    ? '<option value="" disabled selected>No scenes open</option>'
    : scenes.map((s) =>
        `<option value="${escape(s.id)}">${escape(s.name || s.slug)}</option>`
      ).join('');
  return `<dialog class="cw-instantiate-modal" data-cw-instantiate-modal>
    <form method="dialog" class="cw-instantiate-form" data-cw-instantiate-form data-cw-slug="${escape(slug)}">
      <header class="cw-instantiate-head">
        <h2 class="cw-instantiate-title">Insert ${escape(slug)}</h2>
        <p class="cw-instantiate-lead">Pick the scene the new instance lands in. The instance will be added under the scene root and inherits master defaults; you can add slot overrides afterwards in the inspector.</p>
      </header>
      <label class="cw-instantiate-field">
        <span>Scene</span>
        <select data-cw-instantiate-scene${scenes.length === 0 ? ' disabled' : ''}>${sceneOptions}</select>
      </label>
      <div class="cw-instantiate-error" data-cw-instantiate-error hidden></div>
      <footer class="cw-instantiate-foot">
        <button type="button" class="cw-btn" data-cw-instantiate-cancel>Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" data-cw-instantiate-submit${scenes.length === 0 ? ' disabled' : ''}>Insert</button>
      </footer>
    </form>
  </dialog>`;
}

export function renderWorkbenchComponentsPage(data: WorkbenchComponentsData): string {
  const main = data.selectedSlug
    ? renderWorkbenchMode(data)
    : renderCatalogMode(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reframe · components workbench</title>
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
</head>
<body class="cw-page" data-page="workbench-components"${data.selectedSlug ? ` data-cw-slug="${escape(data.selectedSlug)}"` : ''}${data.activeSceneId ? ` data-active-scene-id="${escape(data.activeSceneId)}"` : ''}>
  <main class="cw-main">${main}</main>
  <script src="/platform/app.js?v=${Date.now()}"></script>
</body>
</html>`;
}
