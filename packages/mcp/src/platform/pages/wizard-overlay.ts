/**
 * Overlay wizard page — Phase 4 Brief 4c Pin #3.
 *
 * /platform/workbench/wizards/overlay — composition creation surface
 * for the Overlay kind. Mounts shared wizard primitive with
 * kind='overlay'. Same shape as wizard-variants / wizard-sampler /
 * wizard-flow — only the Step 2 config form differs (layer list with
 * type / opacity / blend / z-index, capped at 3 layers per the engine
 * OverlayLayer constraint).
 */

interface WizardOverlayData {
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

export function renderWizardOverlayPage(data: WizardOverlayData): string {
  const scenesJson = JSON.stringify(data.scenes);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reframe · overlay wizard</title>
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
</head>
<body class="wz-page" data-page="wizard-overlay">
  <main class="wz-main">
    <header class="wz-page-head">
      <a class="wz-back" href="/platform/workbench/wizards">← Back to wizards</a>
      <h1 class="wz-title">Overlay wizard</h1>
      <p class="wz-lead">Base scene with up to 3 effect layers — noise, shaders, particles. Pick a scene, declare layers (opacity + blend + z-order), preview, commit.</p>
      <div class="wz-skill-actions">
        <button class="wz-skill" data-wz-skill="reframe-design" data-wz-skill-action="create-overlay" data-skill-pending="phase-4d" disabled title="Phase 4d wires → skill-bus invoke">/design create overlay layers</button>
        <button class="wz-skill" data-wz-skill="reframe-critic" data-wz-skill-action="review-overlay" data-skill-pending="phase-4d" disabled title="Phase 4d wires → skill-bus invoke">/critic check layer hierarchy</button>
      </div>
    </header>
    <div class="wz-host" data-wz-host data-wz-kind="overlay" data-wz-scenes-json="${escape(scenesJson)}">
      <div class="wz-loading">Loading wizard…</div>
    </div>
  </main>
  <script src="/platform/app.js?v=${Date.now()}"></script>
</body>
</html>`;
}
