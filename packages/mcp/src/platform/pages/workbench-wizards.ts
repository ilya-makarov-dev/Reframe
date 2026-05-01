/**
 * Wizards catalog page — Phase 4 Brief 4b Pin #5.
 *
 * /platform/workbench/wizards — landing surface listing every
 * composition wizard kind. 4b ships 2 (Variants + Sampler); 4c will
 * extend to 4 (+ Flow + Overlay) without changing the catalog shape.
 *
 * Pattern matches brand/components workbench catalog grid: per-kind
 * card with name + icon + brief + "Create new" CTA. Cards also list
 * existing instances of that kind from `.reframe/<kind>/` storage so
 * the catalog doubles as a directory of every composition in the
 * project.
 */

interface WizardKindCard {
  /** url slug — variants / sampler / flow / overlay */
  kind: string;
  /** Display name for the card heading. */
  name: string;
  /** One-line pitch shown beneath the heading. */
  description: string;
  /** Icon SVG path data (24×24 viewBox). */
  iconSvgPath: string;
  /** Existing instances of this kind discovered on disk. */
  existing: Array<{ id: string; name?: string; updatedAt?: string }>;
  /** Whether the wizard is shipping in this build. False = badge "coming soon". */
  shipping: boolean;
}

interface WorkbenchWizardsData {
  cards: WizardKindCard[];
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(iso?: string): string {
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
  return `${d}d ago`;
}

function renderCard(card: WizardKindCard): string {
  const existingHtml = card.existing.length === 0
    ? '<div class="wzc-empty-existing">No instances yet.</div>'
    : `<ul class="wzc-existing-list">${card.existing.slice(0, 4).map((inst) =>
        `<li class="wzc-existing-row">
          <span class="wzc-existing-id">${escape(inst.id)}</span>
          <span class="wzc-existing-meta">${escape(timeAgo(inst.updatedAt))}</span>
        </li>`
      ).join('')}</ul>`;

  const ctaHref = card.shipping
    ? `/platform/workbench/wizards/${encodeURIComponent(card.kind)}`
    : '#';
  const ctaClass = card.shipping ? 'wzc-cta wzc-cta--primary' : 'wzc-cta wzc-cta--disabled';
  const ctaLabel = card.shipping ? 'Create new →' : 'Coming in 4c';

  return `<article class="wzc-card" data-wz-kind="${escape(card.kind)}">
    <header class="wzc-card-head">
      <div class="wzc-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          ${card.iconSvgPath}
        </svg>
      </div>
      ${card.shipping ? '' : '<span class="wzc-soon-badge">soon</span>'}
    </header>
    <h2 class="wzc-card-title">${escape(card.name)}</h2>
    <p class="wzc-card-desc">${escape(card.description)}</p>
    <div class="wzc-existing">
      <span class="wzc-existing-label">Existing</span>
      ${existingHtml}
    </div>
    <a class="${ctaClass}" href="${ctaHref}" data-testid="wizard-${escape(card.kind)}-cta"${card.shipping ? '' : ' aria-disabled="true"'}>${ctaLabel}</a>
  </article>`;
}

export function renderWorkbenchWizardsPage(data: WorkbenchWizardsData): string {
  const cards = data.cards.map(renderCard).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reframe · composition wizards</title>
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
</head>
<body class="wzc-page" data-page="workbench-wizards">
  <main class="wzc-main">
    <header class="wzc-page-head">
      <a class="wzc-back" href="/platform">← Back to dashboard</a>
      <h1 class="wzc-title">Composition wizards</h1>
      <p class="wzc-lead">Step-by-step builders for composition primitives. Each wizard picks a base scene, configures the composition shape, previews live, and commits to disk.</p>
    </header>
    <div class="wzc-grid" data-wz-cards>${cards}</div>
  </main>
  <script src="/platform/app.js?v=${Date.now()}"></script>
</body>
</html>`;
}
