/**
 * Platform page: Design System (/platform/design-system).
 *
 * Visualizes the currently loaded DESIGN.md as swatches + typography hierarchy
 * + radius scale. Read-only — token edits happen via reframe_design /
 * reframe_edit defineTokens which broadcast over SSE for auto-refresh.
 */

import { renderShell, renderSidebar, type SidebarSceneItem, type SidebarComponentItem, type SidebarMacroItem } from '../layout.js';

interface DesignSystemData {
  brand?: string;
  colors?: Array<{ name: string; hex: string }>;
  typography?: Array<{ role: string; fontSize: number; fontWeight: number; fontFamily?: string }>;
  primaryFont?: string;
  secondaryFont?: string;
  radiusScale?: number[];
  sidebarScenes?: SidebarSceneItem[];
  sidebarComponents?: SidebarComponentItem[];
  sidebarMacros?: SidebarMacroItem[];
  activeBrand?: string;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderDesignSystemPage(data: DesignSystemData): string {
  const main = `<div class="page">
    <h1 class="page-title">Design system</h1>
    <p class="page-lead">${data.brand ? `Active brand: <strong>${escape(data.brand)}</strong>. Changes propagate to every scene via token binding.` : 'No brand loaded. Run <code>reframe_design action=extract</code> to load one.'}</p>

    ${renderColorSection(data.colors ?? [])}
    ${renderTypographySection(data.typography ?? [], data.primaryFont, data.secondaryFont)}
    ${renderRadiusSection(data.radiusScale ?? [])}
  </div>`;

  return renderShell({
    title: 'reframe · design system',
    main,
    sidebar: renderSidebar({
      current: 'design-system',
      scenes: data.sidebarScenes ?? [],
      components: data.sidebarComponents ?? [],
      macros: data.sidebarMacros ?? [],
    }),
    activeBrand: data.activeBrand ?? data.brand,
    agentStatus: 'idle',
  });
}

function renderColorSection(colors: Array<{ name: string; hex: string }>): string {
  if (colors.length === 0) {
    return `<div class="tokens-section">
      <h2>Colors</h2>
      <div style="color:var(--text-tertiary);font-size:13px">No color tokens.</div>
    </div>`;
  }
  return `<div class="tokens-section">
    <h2>Colors <span style="color:var(--text-tertiary);font-weight:400">(${colors.length})</span></h2>
    <div class="color-swatches">
      ${colors.map(c => `<div class="color-swatch">
        <div class="chip" style="background: ${escape(c.hex)}"></div>
        <div class="label">${escape(c.name)}</div>
        <div class="hex">${escape(c.hex)}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderTypographySection(
  hier: Array<{ role: string; fontSize: number; fontWeight: number; fontFamily?: string }>,
  primaryFont?: string,
  secondaryFont?: string,
): string {
  if (hier.length === 0) {
    return `<div class="tokens-section">
      <h2>Typography</h2>
      <div style="color:var(--text-tertiary);font-size:13px">No typography tokens.</div>
    </div>`;
  }
  return `<div class="tokens-section">
    <h2>Typography</h2>
    <div style="margin-bottom:16px;font-size:13px;color:var(--text-secondary)">
      ${primaryFont ? `<div>Primary: <strong style="color:var(--text-primary)">${escape(primaryFont)}</strong></div>` : ''}
      ${secondaryFont ? `<div>Secondary: <strong style="color:var(--text-primary)">${escape(secondaryFont)}</strong></div>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:1px;background:var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border-subtle)">
      ${hier.map(t => `<div style="display:flex;align-items:baseline;gap:16px;padding:16px 20px;background:var(--surface-elevated)">
        <span style="font-family:${escape(t.fontFamily || primaryFont || 'inherit')};font-size:${t.fontSize}px;font-weight:${t.fontWeight};color:var(--text-primary);line-height:1">${escape(t.role.charAt(0).toUpperCase() + t.role.slice(1))}</span>
        <span style="color:var(--text-tertiary);font-family:var(--mono);font-size:11px;margin-left:auto">${t.fontSize}px · ${t.fontWeight}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderRadiusSection(scale: number[]): string {
  if (scale.length === 0) return '';
  return `<div class="tokens-section">
    <h2>Border radius scale</h2>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      ${scale.map((r, i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">
        <div style="width:56px;height:56px;background:var(--accent);border-radius:${r}px"></div>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text-tertiary);font-feature-settings:'tnum'">${i}: ${r}px</span>
      </div>`).join('')}
    </div>
  </div>`;
}
