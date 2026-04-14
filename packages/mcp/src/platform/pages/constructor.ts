/**
 * Platform — Site Constructor (/platform/constructor).
 *
 * Visual page builder: live preview + block palette + section list.
 * Add a block → API composes → iframe reloads → see result instantly.
 *
 * Layout:
 *   ┌──────────────────────────────┐ ┌──────────────────────┐
 *   │                              │ │ Section list (drag)   │
 *   │    LIVE PREVIEW              │ │  hero-centered   [×]  │
 *   │    (iframe, auto-reload)     │ │  features-3col   [×]  │
 *   │                              │ │  footer-4col     [×]  │
 *   │                              │ │─────────────────────  │
 *   │                              │ │ + Add Section:        │
 *   │                              │ │ category pills        │
 *   │                              │ │ block buttons         │
 *   │                              │ │─────────────────────  │
 *   │                              │ │ Brand: [Stripe ▼]     │
 *   └──────────────────────────────┘ └──────────────────────┘
 */

import {
  renderShell,
  renderSidebar,
} from '../layout.js';

// ─── Types ────────────────────────────────────────────────────

interface ConstructorData {
  blocks: Array<{
    name: string;
    category: string;
    description: string;
    slotCount: number;
  }>;
  categories: string[];
  brands: string[];
  activeBrand?: string;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Main ─────────────────────────────────────────────────────

export function renderConstructor(data: ConstructorData): string {
  // Group blocks by category for quick palette
  const blocksByCategory = new Map<string, typeof data.blocks>();
  for (const b of data.blocks) {
    const list = blocksByCategory.get(b.category) ?? [];
    list.push(b);
    blocksByCategory.set(b.category, list);
  }

  // Brand options
  const brandOptions = data.brands.map(b =>
    `<option value="${escape(b)}"${b === data.activeBrand ? ' selected' : ''}>${escape(b)}</option>`
  ).join('');

  // Block palette: category → buttons
  const paletteSections = data.categories.map(cat => {
    const blocks = blocksByCategory.get(cat) ?? [];
    const buttons = blocks.map(b =>
      `<button class="block-btn" data-block="${escape(b.name)}" title="${escape(b.description)}">${escape(b.name.replace(cat + '-', ''))}</button>`
    ).join('');
    return `<div class="palette-cat">
      <div class="palette-cat-label">${escape(cat)}</div>
      <div class="palette-cat-blocks">${buttons}</div>
    </div>`;
  }).join('');

  const main = `
<style>
  .ctr-layout { display:grid; grid-template-columns:1fr 300px; height:calc(100vh - 56px); overflow:hidden; }
  .ctr-preview { background:#e8e8e8; position:relative; overflow:auto; }
  .ctr-preview iframe { width:100%; border:none; min-height:100%; background:#fff; display:block; }
  .ctr-empty { display:flex; align-items:center; justify-content:center; height:100%; }
  .ctr-empty-inner { text-align:center; max-width:320px; }
  .ctr-empty-inner h2 { font-size:22px; font-weight:700; margin:0 0 8px; color:var(--text-base); }
  .ctr-empty-inner p { font-size:14px; color:var(--text-muted); margin:0; line-height:1.5; }

  .ctr-panel { display:flex; flex-direction:column; border-left:1px solid var(--border); background:var(--surface); overflow-y:auto; }
  .ctr-section-list { flex:1; overflow-y:auto; padding:12px; }
  .ctr-section-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); padding:0 4px 8px; }

  .section-item { display:flex; align-items:center; gap:8px; padding:8px 10px; margin-bottom:4px; background:var(--surface-elevated); border:1px solid var(--border); border-radius:6px; font-size:13px; cursor:grab; }
  .section-item:hover { border-color:var(--accent); }
  .section-item .num { width:20px; height:20px; border-radius:50%; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; flex-shrink:0; }
  .section-item .name { flex:1; font-weight:500; }
  .section-item .remove { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px; padding:0 2px; line-height:1; }
  .section-item .remove:hover { color:var(--accent); }
  .section-item-ghost { opacity:0.4; background:var(--accent); border-color:var(--accent); }
  .drag-handle:hover { color:var(--accent) !important; }

  .ctr-divider { height:1px; background:var(--border); margin:8px 12px; }

  .palette-cat { padding:0 12px 12px; }
  .palette-cat-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:6px; }
  .palette-cat-blocks { display:flex; flex-wrap:wrap; gap:4px; }
  .block-btn { padding:5px 10px; font-size:11px; font-weight:500; border:1px solid var(--border); border-radius:4px; background:var(--surface-elevated); color:var(--text-base); cursor:pointer; white-space:nowrap; }
  .block-btn:hover { border-color:var(--accent); color:var(--accent); }

  .ctr-brand { padding:12px; border-top:1px solid var(--border); }
  .ctr-brand select { width:100%; padding:6px 10px; border:1px solid var(--border); border-radius:4px; background:var(--surface-elevated); color:var(--text); font-size:13px; }
  .ctr-brand-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:6px; }

  .ctr-status { padding:8px 12px; border-top:1px solid var(--border); font-size:12px; color:var(--text-muted); text-align:center; min-height:32px; }
  .ctr-status.busy { color:var(--accent); }
</style>

<div class="ctr-layout">
  <div class="ctr-preview" id="ctr-preview">
    <div class="ctr-empty" id="ctr-empty">
      <div class="ctr-empty-inner">
        <h2>Start building</h2>
        <p>Pick sections from the panel on the right. Each one appears here instantly as a live preview.</p>
      </div>
    </div>
  </div>

  <div class="ctr-panel">
    <div class="ctr-section-list" id="section-list">
      <div class="ctr-section-label">Page sections</div>
      <div id="section-items"></div>
    </div>

    <div class="ctr-divider"></div>

    <div style="padding:8px 12px 4px">
      <div class="ctr-section-label">Add section</div>
    </div>
    <div style="overflow-y:auto;max-height:40vh;padding-bottom:8px">
      ${paletteSections}
    </div>

    <div class="ctr-brand">
      <div class="ctr-brand-label">Brand</div>
      <select id="brand-select">
        <option value="">— None —</option>
        ${brandOptions}
      </select>
    </div>

    <div class="ctr-status" id="ctr-status">Ready</div>

    <div class="ctr-refine" id="ctr-refine" style="display:none;padding:12px;border-top:1px solid var(--border)">
      <div class="ctr-section-label">Refine section</div>
      <div id="refine-target" style="font-size:12px;font-weight:600;margin-bottom:6px"></div>
      <textarea id="refine-prompt" placeholder="e.g. Make it more technical, add social proof, darker tone..." style="width:100%;min-height:60px;padding:8px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--surface-elevated);color:var(--text);resize:vertical;font-family:inherit"></textarea>
      <button id="refine-btn" class="block-btn" style="width:100%;margin-top:6px;padding:6px;font-weight:600;background:var(--accent);color:#fff;border-color:var(--accent)">Ask Agent to Refine</button>
      <div id="refine-result" style="margin-top:8px;font-size:11px;color:var(--text-muted);max-height:120px;overflow-y:auto;white-space:pre-wrap"></div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
<script>
(function() {
  var sections = [];
  var sceneId = null;
  var sortable = null;
  var status = document.getElementById('ctr-status');
  var preview = document.getElementById('ctr-preview');
  var empty = document.getElementById('ctr-empty');
  var itemsEl = document.getElementById('section-items');

  function setStatus(msg, busy) {
    status.textContent = msg;
    status.className = 'ctr-status' + (busy ? ' busy' : '');
  }

  function renderSections() {
    if (sections.length === 0) {
      itemsEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 4px">No sections yet. Click a section type below to start building.</div>';
      if (sortable) { sortable.destroy(); sortable = null; }
      return;
    }
    itemsEl.innerHTML = sections.map(function(name, i) {
      return '<div class="section-item" data-idx="' + i + '">'
        + '<span class="drag-handle" style="cursor:grab;color:var(--text-muted);font-size:14px;user-select:none">&#x2630;</span>'
        + '<span class="num">' + (i + 1) + '</span>'
        + '<span class="name">' + name + '</span>'
        + '<button class="dup" data-idx="' + i + '" title="Duplicate" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;padding:0 2px">&#x2398;</button>'
        + '<button class="remove" data-idx="' + i + '" title="Remove">&times;</button>'
        + '</div>';
    }).join('');

    // Remove buttons
    itemsEl.querySelectorAll('.remove').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        sections.splice(parseInt(btn.dataset.idx), 1);
        renderSections();
        recompose();
      });
    });

    // Duplicate buttons
    itemsEl.querySelectorAll('.dup').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx);
        sections.splice(idx + 1, 0, sections[idx]);
        renderSections();
        recompose();
      });
    });

    // Init SortableJS for drag reorder
    if (sortable) sortable.destroy();
    if (typeof Sortable !== 'undefined') {
      sortable = Sortable.create(itemsEl, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'section-item-ghost',
        onEnd: function(evt) {
          var item = sections.splice(evt.oldIndex, 1)[0];
          sections.splice(evt.newIndex, 0, item);
          renderSections();
          recompose();
        },
      });
    }
  }

  function recompose() {
    if (sections.length === 0) {
      sceneId = null;
      preview.innerHTML = '';
      preview.appendChild(empty);
      empty.style.display = '';
      setStatus('Ready');
      return;
    }
    setStatus('Composing ' + sections.length + ' sections...', true);
    fetch('/platform/api/constructor/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: sections }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) { setStatus('Error: ' + data.error); return; }
      sceneId = data.sceneId;
      // Show live preview via iframe
      empty.style.display = 'none';
      var existingFrame = preview.querySelector('iframe');
      if (existingFrame) {
        existingFrame.src = '/preview/' + sceneId + '?t=' + Date.now();
      } else {
        var iframe = document.createElement('iframe');
        iframe.src = '/preview/' + sceneId + '?t=' + Date.now();
        iframe.style.width = '100%';
        iframe.style.minHeight = '100%';
        iframe.style.border = 'none';
        iframe.style.background = '#fff';
        preview.appendChild(iframe);
      }
      setStatus(data.blockCount + ' sections · ' + (data.notFound.length > 0 ? data.notFound.length + ' not found' : 'ready'));
    })
    .catch(function(e) { setStatus('Error: ' + e.message); });
  }

  // Section selection for refinement
  var selectedSection = -1;
  var refinePanel = document.getElementById('ctr-refine');
  var refineTarget = document.getElementById('refine-target');
  var refinePrompt = document.getElementById('refine-prompt');
  var refineBtn = document.getElementById('refine-btn');
  var refineResult = document.getElementById('refine-result');

  itemsEl.addEventListener('click', function(e) {
    var item = e.target.closest('.section-item');
    if (!item || e.target.closest('.remove') || e.target.closest('.dup')) return;
    var idx = parseInt(item.dataset.idx);
    selectedSection = idx;
    // Highlight selected
    itemsEl.querySelectorAll('.section-item').forEach(function(el) { el.style.borderColor = ''; });
    item.style.borderColor = 'var(--accent)';
    // Show refine panel
    refinePanel.style.display = '';
    refineTarget.textContent = sections[idx] + ' (section ' + (idx + 1) + ')';
    refineResult.textContent = '';
  });

  refineBtn.addEventListener('click', function() {
    if (selectedSection < 0 || !sceneId || !refinePrompt.value.trim()) return;
    refineBtn.disabled = true;
    refineBtn.textContent = 'Asking agent...';
    refineResult.textContent = '';

    fetch('/platform/api/constructor/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneId: sceneId,
        sectionIndex: selectedSection,
        prompt: refinePrompt.value.trim(),
      }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        refineResult.textContent = 'Agent prompt ready (' + data.sectionName + '):\\n\\n' + data.agentPrompt.slice(0, 500) + '...';
      } else {
        refineResult.textContent = 'Error: ' + data.error;
      }
    })
    .catch(function(e) { refineResult.textContent = 'Error: ' + e.message; })
    .finally(function() { refineBtn.disabled = false; refineBtn.textContent = 'Ask Agent to Refine'; });
  });

  // Add block buttons
  document.querySelectorAll('.block-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      sections.push(btn.dataset.block);
      renderSections();
      recompose();
    });
  });

  renderSections();
})();
</script>
  `;

  return renderShell({
    title: 'Constructor — reframe',
    main,
    sidebar: renderSidebar({
      current: 'blocks',
      activeBrand: data.activeBrand,
    }),
    activeBrand: data.activeBrand,
  });
}
