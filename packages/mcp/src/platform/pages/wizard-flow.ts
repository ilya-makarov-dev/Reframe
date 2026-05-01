/**
 * Flow wizard page — Phase 4 Brief 4c Pin #2.
 *
 * /platform/workbench/wizards/flow — composition creation surface for
 * the Flow kind. Mounts shared wizard primitive (157-wizard-shared.js)
 * with kind='flow'. Reuses 4b primitive verbatim — only the Step 2
 * config form differs (sequence editor instead of axes).
 */

interface WizardFlowData {
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

export function renderWizardFlowPage(data: WizardFlowData): string {
  const scenesJson = JSON.stringify(data.scenes);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reframe · flow wizard</title>
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
</head>
<body class="wz-page" data-page="wizard-flow">
  <main class="wz-main">
    <header class="wz-page-head">
      <a class="wz-back" href="/platform/workbench/wizards">← Back to wizards</a>
      <h1 class="wz-title">Flow wizard</h1>
      <p class="wz-lead">Linear step transitions over a sequence of scenes — onboarding, multi-step forms, micro-interactions. Pick the entry scene, declare steps, preview, commit.</p>
      <div class="wz-skill-actions">
        <button class="wz-skill" data-wz-skill="reframe-design" data-wz-skill-action="create-flow" data-skill-pending="phase-4d" disabled title="Phase 4d wires → skill-bus invoke">/design create flow from scene</button>
        <button class="wz-skill" data-wz-skill="reframe-critic" data-wz-skill-action="review-flow" data-skill-pending="phase-4d" disabled title="Phase 4d wires → skill-bus invoke">/critic review flow transitions</button>
      </div>
    </header>
    <div class="wz-host" data-wz-host data-wz-kind="flow" data-wz-scenes-json="${escape(scenesJson)}">
      <div class="wz-loading">Loading wizard…</div>
    </div>
  </main>
  <script src="/platform/app.js?v=${Date.now()}"></script>
</body>
</html>`;
}
