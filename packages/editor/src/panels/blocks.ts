/**
 * Blocks Panel — section-based page builder.
 *
 * Shows reframe's 17 block templates grouped by category.
 * Click to add a block to the canvas (appends to current page).
 * This is "constructor mode" — integrated into the editor, not a separate page.
 */

export interface BlockDef {
  name: string;
  label: string;
  category: string;
  slots: number;
}

export const BLOCK_LIBRARY: BlockDef[] = [
  // Hero
  { name: 'hero-centered', label: 'Hero Centered', category: 'Hero', slots: 3 },
  { name: 'hero-split', label: 'Hero Split', category: 'Hero', slots: 3 },
  { name: 'hero-gradient', label: 'Hero Gradient', category: 'Hero', slots: 3 },
  // Features
  { name: 'features-grid-3col', label: 'Features 3-Col', category: 'Features', slots: 4 },
  { name: 'features-alternating', label: 'Features Alternating', category: 'Features', slots: 2 },
  // Pricing
  { name: 'pricing-3col', label: 'Pricing 3-Tier', category: 'Pricing', slots: 1 },
  // Testimonials
  { name: 'testimonials-grid', label: 'Testimonials Grid', category: 'Testimonials', slots: 1 },
  // CTA
  { name: 'cta-centered', label: 'CTA Centered', category: 'CTA', slots: 3 },
  { name: 'cta-split', label: 'CTA Split', category: 'CTA', slots: 2 },
  // Stats
  { name: 'stats-bar', label: 'Stats Bar', category: 'Stats', slots: 4 },
  // Navigation
  { name: 'nav-simple', label: 'Nav Simple', category: 'Navigation', slots: 1 },
  // Footer
  { name: 'footer-4col', label: 'Footer 4-Col', category: 'Footer', slots: 1 },
  { name: 'footer-simple', label: 'Footer Simple', category: 'Footer', slots: 1 },
  // Other
  { name: 'faq-simple', label: 'FAQ', category: 'Other', slots: 1 },
  { name: 'contact-form', label: 'Contact Form', category: 'Other', slots: 1 },
  { name: 'gallery-grid', label: 'Gallery', category: 'Other', slots: 1 },
  { name: 'team-grid', label: 'Team Grid', category: 'Other', slots: 1 },
];

/** Render the blocks panel as HTML string. */
export function renderBlocksPanel(options?: { filter?: string }): string {
  const filter = options?.filter?.toLowerCase() ?? '';

  const categories = [...new Set(BLOCK_LIBRARY.map(b => b.category))];
  let html = '';

  // Search
  html += `<div style="padding:8px 0;">
    <input id="block-search" type="text" placeholder="Search blocks..."
      value="${escHtml(filter)}"
      style="width:100%;padding:6px 10px;border-radius:5px;border:1px solid var(--border);
        background:var(--bg-0);color:var(--text-1);font-size:12px;font-family:inherit;outline:none;">
  </div>`;

  for (const cat of categories) {
    const blocks = BLOCK_LIBRARY
      .filter(b => b.category === cat)
      .filter(b => !filter || b.label.toLowerCase().includes(filter) || b.name.includes(filter));

    if (blocks.length === 0) continue;

    html += `<div style="padding:8px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${cat}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">`;

    for (const block of blocks) {
      html += `<button data-add-block="${block.name}" style="
        padding:10px 8px;border-radius:5px;border:1px solid var(--border);
        background:var(--bg-2);color:var(--text-2);cursor:pointer;
        font-family:inherit;font-size:11px;text-align:center;
        transition:all 0.1s;
      " onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--text-1)'"
         onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-2)'">
        ${block.label}
      </button>`;
    }

    html += `</div></div>`;
  }

  if (html.indexOf('data-add-block') === -1) {
    html += `<div style="padding:24px;text-align:center;color:var(--text-3);font-size:12px;">No blocks found</div>`;
  }

  return html;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
