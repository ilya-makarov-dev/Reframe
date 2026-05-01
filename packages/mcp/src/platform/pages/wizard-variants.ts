/**
 * Variants wizard page — Phase 4 Brief 4b Pin #3.
 *
 * /platform/workbench/wizards/variants — composition creation surface
 * for the Variants kind. Mounts the shared wizard primitive
 * (157-wizard-shared.js) with kind='variants'. Server-side render is
 * minimal: header + cancel link + a wizard host element + a scenes
 * data-attribute the bundle reads on mount.
 *
 * Layout matches the brand/components workbench shape (back link,
 * sticky header, single content column) for visual consistency.
 */

interface WizardVariantsData {
  /** Project's session scenes — surfaced as data-wz-scenes-json on mount. */
  scenes: Array<{
    id: string;
    slug: string;
    name: string;
    width?: number;
    height?: number;
    nodes: number;
  }>;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderWizardVariantsPage(data: WizardVariantsData): string {
  const scenesJson = JSON.stringify(data.scenes);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reframe · variants wizard</title>
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
</head>
<body class="wz-page" data-page="wizard-variants">
  <main class="wz-main">
    <header class="wz-page-head">
      <a class="wz-back" href="/platform/workbench/wizards">← Back to wizards</a>
      <h1 class="wz-title">Variants wizard</h1>
      <p class="wz-lead">Cartesian product of N axes around a base scene. Pick a scene, declare axes, preview, commit.</p>
      <div class="wz-skill-actions">
        <button class="wz-skill" data-wz-skill="reframe-design" data-wz-skill-action="create-variants" data-skill-pending="phase-4d" disabled title="Phase 4d wires → skill-bus invoke">/design create variants from scene</button>
        <button class="wz-skill" data-wz-skill="reframe-critic" data-wz-skill-action="review-variants" data-skill-pending="phase-4d" disabled title="Phase 4d wires → skill-bus invoke">/critic review this variant set</button>
      </div>
    </header>
    <div class="wz-host" data-wz-host data-wz-kind="variants" data-wz-scenes-json="${escape(scenesJson)}">
      <div class="wz-loading">Loading wizard…</div>
    </div>
  </main>
  <script src="/platform/app.js?v=${Date.now()}"></script>
</body>
</html>`;
}
