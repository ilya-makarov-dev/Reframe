/**
 * Platform — Batch Export page (/platform/batch).
 *
 * Multi-select scenes × formats × brands × viewports → generate all.
 */

import { renderShell, renderSidebar } from '../layout.js';

interface BatchPageData {
  scenes: Array<{ id: string; slug: string; name: string }>;
  brands: string[];
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderBatchPage(data: BatchPageData): string {
  const sceneCheckboxes = data.scenes.map(s =>
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" name="scenes" value="${escape(s.id)}" checked>
      <span>${escape(s.name)}</span>
    </label>`
  ).join('\n');

  const formats = ['html', 'svg', 'png', 'pdf', 'react', 'lottie'];
  const formatCheckboxes = formats.map(f =>
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" name="formats" value="${f}" ${f === 'html' || f === 'png' ? 'checked' : ''}>
      <span>${f.toUpperCase()}</span>
    </label>`
  ).join('\n');

  const brandCheckboxes = data.brands.length > 0
    ? data.brands.map(b =>
        `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="brands" value="${escape(b)}">
          <span>${escape(b)}</span>
        </label>`
      ).join('\n')
    : '<span class="t-caption" style="color:var(--text-muted)">No brands registered</span>';

  const viewports = [
    { name: 'Desktop', width: 1440, height: 900 },
    { name: 'Tablet', width: 768, height: 1024 },
    { name: 'Mobile', width: 375, height: 812 },
  ];
  const viewportCheckboxes = viewports.map(v =>
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" name="viewports" value="${v.name}" data-w="${v.width}" data-h="${v.height}">
      <span>${v.name} (${v.width}\u00D7${v.height})</span>
    </label>`
  ).join('\n');

  const main = `
    <div style="padding:32px 40px;max-width:900px">
      <h1 class="t-title" style="font-size:28px;font-weight:700;margin:0 0 8px">Batch Export</h1>
      <p class="t-body" style="color:var(--text-muted);margin:0 0 32px">
        Select scenes, formats, brands, and viewports. Generate all combinations in one click.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px">
        <div>
          <div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Scenes</div>
          <div style="display:flex;flex-direction:column;gap:8px" data-batch-scenes>
            ${sceneCheckboxes || '<span class="t-caption" style="color:var(--text-muted)">No scenes</span>'}
          </div>
        </div>

        <div>
          <div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Formats</div>
          <div style="display:flex;flex-direction:column;gap:8px" data-batch-formats>
            ${formatCheckboxes}
          </div>
        </div>

        <div>
          <div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Brands (optional)</div>
          <div style="display:flex;flex-direction:column;gap:8px" data-batch-brands>
            ${brandCheckboxes}
          </div>
        </div>

        <div>
          <div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Viewports (optional)</div>
          <div style="display:flex;flex-direction:column;gap:8px" data-batch-viewports>
            ${viewportCheckboxes}
          </div>
        </div>
      </div>

      <div style="margin-top:32px;display:flex;align-items:center;gap:16px">
        <button data-batch-generate class="btn-primary" style="padding:12px 32px;background:var(--accent);color:var(--on-accent);border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">
          Generate All
        </button>
        <span data-batch-status class="t-caption" style="color:var(--text-muted)"></span>
      </div>

      <div data-batch-results style="margin-top:24px;display:flex;flex-direction:column;gap:8px"></div>
    </div>
  `;

  return renderShell({
    title: 'Batch Export',
    sidebar: renderSidebar({ current: 'home' }),
    main,
  });
}
