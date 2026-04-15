/**
 * Design System Panel — brand loading, token management, mode switching.
 *
 * Connects reframe's design token pipeline to the editor:
 * - Load brand (reframe_design extract) → DESIGN.md
 * - Parse → defineTokens → auto-bind to nodes
 * - Switch light/dark mode
 * - View token tree with swatches
 */

export interface DesignSystemPanelData {
  /** Active brand name (e.g., "Stripe", "PlayStation"). */
  activeBrand: string | null;
  /** Current mode: light or dark. */
  mode: 'light' | 'dark';
  /** Token count. */
  tokenCount: number;
  /** Color tokens for preview. */
  colorTokens: Array<{ name: string; value: string }>;
  /** Typography tokens for preview. */
  typographyTokens: Array<{ role: string; size: number; weight: number; family: string }>;
  /** Available brands (from reframe_design list). */
  availableBrands: string[];
}

/** Render the design system panel as HTML string. */
export function renderDesignSystemPanel(data: DesignSystemPanelData): string {
  const sections: string[] = [];

  // ── Active Brand ──
  sections.push(`<div style="padding:12px 0;border-bottom:1px solid #222;">
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Brand</div>
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:14px;font-weight:500;color:#e5e5e5;">${data.activeBrand ?? 'No brand'}</span>
      <button data-action="change-brand" style="
        padding:4px 10px;border-radius:4px;border:1px solid #333;
        background:#1a1a1a;color:#888;font-size:11px;cursor:pointer;
      ">Change</button>
    </div>
  </div>`);

  // ── Mode Toggle ──
  sections.push(`<div style="padding:12px 0;border-bottom:1px solid #222;">
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Mode</div>
    <div style="display:flex;gap:4px;">
      <button data-action="set-mode-light" style="
        flex:1;padding:6px;border-radius:4px;border:1px solid ${data.mode === 'light' ? '#2563eb' : '#333'};
        background:${data.mode === 'light' ? '#1e3a5f' : '#1a1a1a'};
        color:${data.mode === 'light' ? '#93c5fd' : '#666'};font-size:11px;cursor:pointer;
      ">Light</button>
      <button data-action="set-mode-dark" style="
        flex:1;padding:6px;border-radius:4px;border:1px solid ${data.mode === 'dark' ? '#2563eb' : '#333'};
        background:${data.mode === 'dark' ? '#1e3a5f' : '#1a1a1a'};
        color:${data.mode === 'dark' ? '#93c5fd' : '#666'};font-size:11px;cursor:pointer;
      ">Dark</button>
    </div>
  </div>`);

  // ── Color Tokens ──
  if (data.colorTokens.length > 0) {
    let colorHtml = '';
    for (const token of data.colorTokens.slice(0, 12)) {
      colorHtml += `<div style="display:flex;align-items:center;gap:8px;padding:2px 0;">
        <span style="width:16px;height:16px;border-radius:3px;background:${token.value};border:1px solid #333;flex-shrink:0;"></span>
        <span style="font-size:11px;color:#888;flex:1;">${token.name}</span>
        <span style="font-size:10px;color:#555;font-family:monospace;">${token.value}</span>
      </div>`;
    }
    sections.push(`<div style="padding:12px 0;border-bottom:1px solid #222;">
      <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Colors (${data.colorTokens.length})</div>
      ${colorHtml}
    </div>`);
  }

  // ── Typography Tokens ──
  if (data.typographyTokens.length > 0) {
    let typeHtml = '';
    for (const token of data.typographyTokens.slice(0, 8)) {
      typeHtml += `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:11px;">
        <span style="color:#888;">${token.role}</span>
        <span style="color:#e5e5e5;">${token.size}px / ${token.weight}</span>
      </div>`;
    }
    sections.push(`<div style="padding:12px 0;border-bottom:1px solid #222;">
      <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Typography</div>
      ${typeHtml}
    </div>`);
  }

  // ── Stats ──
  sections.push(`<div style="padding:12px 0;font-size:11px;color:#555;">
    ${data.tokenCount} tokens bound
  </div>`);

  return sections.join('');
}
