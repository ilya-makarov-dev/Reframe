/**
 * Viewport Canvas Bootstrap — progressive enhancement of the scene preview.
 *
 * Served as /platform/viewport.js (ESM module).
 * Loads CanvasKit WASM + @open-pencil/core, creates interactive canvas.
 * Falls back to iframe preview if loading fails.
 *
 * This is a <script type="module"> — uses dynamic import() for ESM deps.
 */

export const VIEWPORT_CANVAS_JS = `
(async function initViewportCanvas() {
  'use strict';

  const canvas = document.getElementById('reframe-viewport');
  const iframe = document.getElementById('reframe-preview-fallback');
  if (!canvas) return; // Not a scene page

  const sessionId = canvas.dataset.session;
  if (!sessionId) return;

  // ── Status helper ──
  function setStatus(msg) {
    const el = document.querySelector('.mode-banner');
    if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
  }

  try {
    setStatus('Loading CanvasKit...');

    // ── 1. Load CanvasKit ──
    const ckModule = await import('/platform/vendor/canvaskit/canvaskit.js');
    const CanvasKitInit = ckModule.default || ckModule.CanvasKitInit || ckModule;
    const ck = await CanvasKitInit({
      locateFile: (file) => '/platform/vendor/canvaskit/' + file,
    });

    // ── 2. Create WebGL surface ──
    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';

    const surface = ck.MakeWebGLCanvasSurface(canvas);
    if (!surface) throw new Error('WebGL not supported');

    // ── 3. Load @open-pencil/core ──
    setStatus('Loading editor core...');
    const core = await import('/platform/vendor/open-pencil-core/index.js');
    const { SceneGraph, createEditor, SkiaRenderer, computeAllLayouts } = core;

    // ── 4. Create editor ──
    const graph = new SceneGraph();
    const editor = createEditor({
      graph,
      getViewportSize: () => ({
        width: container.clientWidth,
        height: container.clientHeight,
      }),
    });

    const renderer = new SkiaRenderer(ck, surface);
    editor.setCanvasKit(ck, renderer);

    // ── 5. Fetch scene data ──
    setStatus('Loading scene...');
    const resp = await fetch('/scenes/' + sessionId + '?format=json');
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.nodes) {
        // Hydrate OP graph from scene JSON
        const page = graph.addPage('Page 1');
        const nodeMap = new Map();

        // Sort nodes: parents first (by depth/order in the JSON)
        const entries = Object.entries(data.nodes);

        // First pass: create nodes without children relationships
        for (const [id, nodeData] of entries) {
          const nd = nodeData;
          if (nd.type === 'CANVAS') continue; // Skip canvas wrapper

          // Determine parent: use page as default
          let parentId = page.id;
          if (nd.parentId && nodeMap.has(nd.parentId)) {
            parentId = nd.parentId;
          }

          try {
            const created = graph.createNode(nd.type, parentId, {
              id: nd.id || id,
              name: nd.name || nd.type,
              x: nd.x || 0,
              y: nd.y || 0,
              width: nd.width || 100,
              height: nd.height || 100,
              fills: nd.fills || [],
              strokes: nd.strokes || [],
              effects: nd.effects || [],
              opacity: nd.opacity ?? 1,
              visible: nd.visible ?? true,
              cornerRadius: nd.cornerRadius || 0,
              text: nd.text || '',
              fontSize: nd.fontSize || 16,
              fontFamily: nd.fontFamily || 'Inter',
              fontWeight: nd.fontWeight || 400,
              layoutMode: nd.layoutMode || 'NONE',
              paddingTop: nd.paddingTop || 0,
              paddingRight: nd.paddingRight || 0,
              paddingBottom: nd.paddingBottom || 0,
              paddingLeft: nd.paddingLeft || 0,
              itemSpacing: nd.itemSpacing || 0,
              primaryAxisAlign: nd.primaryAxisAlign || 'MIN',
              counterAxisAlign: nd.counterAxisAlign || 'MIN',
              primaryAxisSizing: nd.primaryAxisSizing || 'FIXED',
              counterAxisSizing: nd.counterAxisSizing || 'FIXED',
            });
            nodeMap.set(created.id, created);
          } catch (e) {
            // Skip nodes that fail to create
          }
        }

        // Compute layout
        try { computeAllLayouts(graph); } catch (e) {}

        // Set page ID for layer tree
        editor.state.currentPageId = page.id;
      }
    }

    // ── 6. Swap: show canvas, hide iframe ──
    canvas.style.display = 'block';
    if (iframe) iframe.style.display = 'none';

    // Zoom to fit
    editor.zoomToFit();

    // ── 7. Render loop ──
    let running = true;
    function renderFrame() {
      if (!running) return;
      try {
        renderer.render(graph, editor.state.selectedIds, {
          hoveredNodeId: editor.state.hoveredNodeId,
          marquee: editor.state.marquee,
          snapGuides: editor.state.snapGuides,
        }, editor.state.sceneVersion);
      } catch (e) {}
      requestAnimationFrame(renderFrame);
    }
    renderFrame();

    // ── 8. Handle resize ──
    new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = container.clientWidth + 'px';
      canvas.style.height = container.clientHeight + 'px';
      editor.requestRender();
    }).observe(container);

    // ── 9. Pointer events ──
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const { x, y } = editor.screenToCanvas(e.clientX, e.clientY);
      const hit = editor.hitTestAtPoint(x, y);
      if (hit) {
        editor.select([hit.id], e.shiftKey);
      } else {
        editor.clearSelection();
      }
      editor.requestRender();

      // Dispatch to existing PLATFORM_JS
      window.dispatchEvent(new CustomEvent('reframe:canvas-select', {
        detail: {
          nodeId: hit ? hit.id : null,
          selectedIds: [...editor.state.selectedIds],
        },
      }));
    });

    canvas.addEventListener('pointermove', (e) => {
      const { x, y } = editor.screenToCanvas(e.clientX, e.clientY);
      const hit = editor.hitTestAtPoint(x, y);
      editor.setHoveredNode(hit ? hit.id : null);
      editor.requestRepaint();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        editor.applyZoom(e.deltaY > 0 ? 1.5 : -1.5, e.clientX, e.clientY);
      } else {
        editor.pan(-e.deltaX, -e.deltaY);
      }
      editor.requestRender();
    }, { passive: false });

    canvas.addEventListener('dblclick', (e) => {
      const { x, y } = editor.screenToCanvas(e.clientX, e.clientY);
      const hit = editor.hitTestAtPoint(x, y, true);
      if (hit && hit.type === 'TEXT') {
        editor.startTextEditing(hit.id);
        editor.requestRender();
      }
    });

    setStatus('');
    console.log('[reframe] CanvasKit viewport active');

    // Expose for debugging
    window.__reframeEditor = editor;
    window.__reframeGraph = graph;

  } catch (err) {
    console.warn('[reframe] CanvasKit init failed, using iframe fallback:', err.message);
    // Keep iframe visible
    canvas.style.display = 'none';
    if (iframe) iframe.style.display = 'block';
    setStatus('');
  }
})();
`;
