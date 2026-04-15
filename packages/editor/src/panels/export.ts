/**
 * Export Panel — triggers reframe's 12 export formats from the editor.
 *
 * Flow: editor graph → GraphBridge.toReframeGraph() → reframe exporter → download.
 * Raster (PNG/PDF) can also use OpenPencil's CanvasKit renderer directly.
 */

export type ExportFormat =
  | 'html' | 'react' | 'svg' | 'png' | 'pdf'
  | 'animated_html' | 'lottie' | 'site';

export interface ExportOption {
  format: ExportFormat;
  label: string;
  description: string;
  icon: string;
  category: 'code' | 'image' | 'animation' | 'bundle';
}

export const EXPORT_OPTIONS: ExportOption[] = [
  // Code
  { format: 'html',    label: 'HTML',         description: 'Semantic HTML with inline styles',              icon: 'H', category: 'code' },
  { format: 'react',   label: 'React (TSX)',  description: 'Functional component with TypeScript',          icon: 'R', category: 'code' },
  { format: 'svg',     label: 'SVG',          description: 'Vector graphics with viewBox',                  icon: 'S', category: 'code' },

  // Image
  { format: 'png',     label: 'PNG',          description: 'Raster image (supports @2x retina)',            icon: 'P', category: 'image' },
  { format: 'pdf',     label: 'PDF',          description: 'Print-ready document',                          icon: 'D', category: 'image' },

  // Animation
  { format: 'animated_html', label: 'Animated HTML', description: 'HTML with CSS keyframes or WAAPI',       icon: 'A', category: 'animation' },
  { format: 'lottie',  label: 'Lottie',       description: 'After Effects JSON for mobile/web',             icon: 'L', category: 'animation' },

  // Bundle
  { format: 'site',    label: 'Multi-page Site', description: 'All scenes bundled with routing',            icon: 'W', category: 'bundle' },
];

/** Render the export panel as HTML string. */
export function renderExportPanel(options?: {
  sceneCount?: number;
  sceneName?: string;
}): string {
  const categories = ['code', 'image', 'animation', 'bundle'] as const;
  const labels: Record<string, string> = {
    code: 'Code',
    image: 'Image',
    animation: 'Animation',
    bundle: 'Bundle',
  };

  let html = '';

  if (options?.sceneName) {
    html += `<div style="padding:12px 0;border-bottom:1px solid #222;font-size:12px;color:#888;">
      Exporting: <span style="color:#e5e5e5;">${options.sceneName}</span>
    </div>`;
  }

  for (const cat of categories) {
    const items = EXPORT_OPTIONS.filter(o => o.category === cat);
    html += `<div style="padding:12px 0;border-bottom:1px solid #222;">
      <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${labels[cat]}</div>`;

    for (const item of items) {
      html += `<button data-export-format="${item.format}" style="
        display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;
        background:transparent;border:1px solid #262626;border-radius:6px;
        color:#e5e5e5;cursor:pointer;margin-bottom:4px;text-align:left;
        font-family:inherit;font-size:12px;
      " onmouseover="this.style.background='#1a1a1a'" onmouseout="this.style.background='transparent'">
        <span style="width:28px;height:28px;background:#1a1a1a;border-radius:4px;
          display:flex;align-items:center;justify-content:center;
          font-size:12px;font-weight:700;color:#666;flex-shrink:0;">${item.icon}</span>
        <div>
          <div style="font-weight:500;">${item.label}</div>
          <div style="font-size:11px;color:#666;margin-top:1px;">${item.description}</div>
        </div>
      </button>`;
    }

    html += `</div>`;
  }

  return html;
}
