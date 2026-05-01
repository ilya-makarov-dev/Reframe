/**
 * Sampler wizard page — Phase 4 Brief 4b Pin #4.
 *
 * /platform/workbench/wizards/sampler — composition creation surface
 * for the Sampler kind. Mounts shared wizard primitive with
 * kind='sampler'. Same shape as wizard-variants.
 */

interface WizardSamplerData {
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

export function renderWizardSamplerPage(data: WizardSamplerData): string {
  const scenesJson = JSON.stringify(data.scenes);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reframe · sampler wizard</title>
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
</head>
<body class="wz-page" data-page="wizard-sampler">
  <main class="wz-main">
    <header class="wz-page-head">
      <a class="wz-back" href="/platform/workbench/wizards">← Back to wizards</a>
      <h1 class="wz-title">Sampler wizard</h1>
      <p class="wz-lead">Sampling grid — N variations of one base scene laid out as a specimen sheet. Pick a scene, configure mode + grid, preview, commit.</p>
      <div class="wz-skill-actions">
        <button class="wz-skill" data-wz-skill="reframe-design" data-wz-skill-action="create-sampler" data-skill-pending="phase-4d" disabled title="Phase 4d wires → skill-bus invoke">/design create sampler grid</button>
      </div>
    </header>
    <div class="wz-host" data-wz-host data-wz-kind="sampler" data-wz-scenes-json="${escape(scenesJson)}">
      <div class="wz-loading">Loading wizard…</div>
    </div>
  </main>
  <script src="/platform/app.js?v=${Date.now()}"></script>
</body>
</html>`;
}
