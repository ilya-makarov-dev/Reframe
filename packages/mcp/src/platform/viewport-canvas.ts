/**
 * Viewport Canvas Bootstrap — CanvasKit interactive viewport.
 *
 * Served as /platform/viewport.js (ESM module).
 * Loads CanvasKit WASM + @open-pencil/core, creates interactive canvas.
 *
 * Two modes:
 * - Scene page:   data-session="s1"           → single root frame
 * - Project page:  data-project-scenes="s1,s2" → multiple artboard frames
 *                  + window.__REFRAME_ARTBOARDS__ JSON for layout positions
 *
 * No iframe fallback — CanvasKit is the only renderer.
 */

export const VIEWPORT_CANVAS_JS = `
(async function initViewportCanvas() {
  'use strict';

  const canvas = document.getElementById('reframe-viewport');
  if (!canvas) return;

  const projectScenes = canvas.dataset.projectScenes;
  const singleSession = canvas.dataset.session;

  const sceneIds = projectScenes
    ? projectScenes.split(',').filter(Boolean)
    : singleSession ? [singleSession] : [];
  if (sceneIds.length === 0) return;

  const isProjectMode = !!projectScenes;

  function setStatus(msg) {
    const el = document.querySelector('.mode-banner');
    if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
  }

  try {
    setStatus('Loading CanvasKit\\u2026');

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
    setStatus('Loading editor\\u2026');
    const core = await import('/platform/vendor/open-pencil-core/index.js');
    const { SceneGraph, createEditor, SkiaRenderer, computeAllLayouts, computeSnap, computeSelectionBounds } = core;

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

    // ── 5. Hydrate scenes ──
    function hydrateNodes(entries, parentId, nodeMap) {
      for (const [id, nodeData] of entries) {
        const nd = nodeData;
        if (nd.type === 'CANVAS') continue;

        let pid = parentId;
        if (nd.parentId && nodeMap.has(nd.parentId)) {
          pid = nd.parentId;
        }

        try {
          const created = graph.createNode(nd.type, pid, {
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
        } catch (e) {}
      }
    }

    setStatus('Loading scene' + (sceneIds.length > 1 ? 's' : '') + '\\u2026');
    const page = graph.addPage('Page 1');

    if (isProjectMode) {
      // ── PROJECT: multiple artboard frames ──
      // Layout data from server-rendered JSON
      const artboards = window.__REFRAME_ARTBOARDS__ || [];
      const layoutMap = new Map();
      artboards.forEach(function(a) { layoutMap.set(a.id, a); });

      const results = await Promise.all(sceneIds.map(function(id) {
        return fetch('/scenes/' + id + '?format=json')
          .then(function(r) { return r.ok ? r.json() : null; })
          .catch(function() { return null; });
      }));

      for (let i = 0; i < sceneIds.length; i++) {
        const data = results[i];
        if (!data || !data.nodes) continue;

        const sid = sceneIds[i];
        const layout = layoutMap.get(sid) || { x: i * 1560, y: 0, w: 1440, h: 900, name: sid };

        try {
          const artboard = graph.createNode('FRAME', page.id, {
            name: layout.name,
            x: layout.x,
            y: layout.y,
            width: layout.w,
            height: layout.h,
            fills: [],
            clipsContent: true,
          });

          const nodeMap = new Map();
          nodeMap.set(artboard.id, artboard);
          hydrateNodes(Object.entries(data.nodes), artboard.id, nodeMap);
        } catch (e) {
          console.warn('[reframe] Failed to hydrate scene ' + sid, e);
        }
      }
    } else {
      // ── SINGLE SCENE ──
      const resp = await fetch('/scenes/' + sceneIds[0] + '?format=json');
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.nodes) {
          const nodeMap = new Map();
          hydrateNodes(Object.entries(data.nodes), page.id, nodeMap);
        }
      }
    }

    try { computeAllLayouts(graph); } catch (e) {}
    editor.state.currentPageId = page.id;

    // ── 6. Zoom to fit ──
    editor.zoomToFit();

    // ── 7. Render loop ──
    function renderFrame() {
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

    // ── 8. Resize ──
    new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = container.clientWidth + 'px';
      canvas.style.height = container.clientHeight + 'px';
      editor.requestRender();
    }).observe(container);

    // ── 9. Pointer events — Figma-like interaction ──
    //
    // Uses OP Editor API (editor.updateNode, editor.commitMove,
    // editor.setMarquee, editor.setSnapGuides) — same patterns as
    // packages/editor/src/canvas/interaction.ts.
    //
    // Modes: idle, move, marquee, pan, resize, create
    //
    let drag = null; // null | { kind, ... }
    let spaceHeld = false;

    // Canvas-local coords (accounts for sidebar/header offset)
    function lx(e) { return e.clientX - canvas.getBoundingClientRect().left; }
    function ly(e) { return e.clientY - canvas.getBoundingClientRect().top; }

    function emitSelect(hit) {
      window.dispatchEvent(new CustomEvent('reframe:canvas-select', {
        detail: {
          nodeId: hit ? hit.id : null,
          selectedIds: [...editor.state.selectedIds],
        },
      }));
    }

    canvas.addEventListener('pointerdown', (e) => {
      let cx, cy;
      try { ({x: cx, y: cy} = editor.screenToCanvas(lx(e), ly(e))); } catch { return; }

      // Right-click → context menu (browser default for now)
      if (e.button === 2) return;

      // Middle-click → pan
      if (e.button === 1) {
        drag = { kind: 'pan', startX: e.clientX, startY: e.clientY,
                 startPanX: editor.state.panX, startPanY: editor.state.panY };
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (e.button !== 0) return;

      // Space held → pan
      if (spaceHeld) {
        drag = { kind: 'pan', startX: e.clientX, startY: e.clientY,
                 startPanX: editor.state.panX, startPanY: editor.state.panY };
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
        return;
      }

      // Hit test — deep (most nested node)
      const hit = editor.hitTestAtPoint(cx, cy, true);

      if (hit) {
        if (!editor.state.selectedIds.has(hit.id)) {
          editor.select([hit.id], e.shiftKey);
          emitSelect(hit);
        }

        // Snapshot original positions → start drag-to-move
        const originals = new Map();
        for (const id of editor.state.selectedIds) {
          const nd = editor.getNode ? editor.getNode(id) : (graph.getNode ? graph.getNode(id) : null);
          if (nd) originals.set(id, { x: nd.x, y: nd.y });
        }
        drag = { kind: 'move', startX: cx, startY: cy, originals };
        canvas.setPointerCapture(e.pointerId);
      } else {
        // Empty space → marquee
        if (!e.shiftKey) {
          editor.clearSelection();
          emitSelect(null);
        }
        drag = { kind: 'marquee', startX: cx, startY: cy };
        canvas.setPointerCapture(e.pointerId);
      }
      editor.requestRender();
    });

    canvas.addEventListener('pointermove', (e) => {
      let cx, cy;
      try { ({x: cx, y: cy} = editor.screenToCanvas(lx(e), ly(e))); } catch { return; }

      if (!drag) {
        // Hover
        const hit = editor.hitTestAtPoint(cx, cy);
        editor.setHoveredNode(hit ? hit.id : null);
        canvas.style.cursor = hit ? 'default' : 'default';
        editor.requestRepaint();
        return;
      }

      if (drag.kind === 'pan') {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        editor.state.panX = drag.startPanX + dx;
        editor.state.panY = drag.startPanY + dy;
        editor.requestRender();
        return;
      }

      if (drag.kind === 'move') {
        const dx = cx - drag.startX;
        const dy = cy - drag.startY;
        canvas.style.cursor = 'move';

        // Move all selected nodes — direct mutation (OP nodes are mutable)
        for (const [id, orig] of drag.originals) {
          const nd = editor.getNode(id);
          if (nd) { nd.x = orig.x + dx; nd.y = orig.y + dy; }
        }

        editor.requestRender();
        return;
      }

      if (drag.kind === 'marquee') {
        const minX = Math.min(drag.startX, cx), minY = Math.min(drag.startY, cy);
        const maxX = Math.max(drag.startX, cx), maxY = Math.max(drag.startY, cy);

        if (editor.setMarquee) {
          editor.setMarquee({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
        }

        // Live select nodes inside marquee
        const ids = [];
        try {
          for (const node of graph.getAllNodes()) {
            if (!node.visible || node.type === 'CANVAS' || node.type === 'PAGE') continue;
            if (node.x >= minX && node.y >= minY &&
                node.x + node.width <= maxX && node.y + node.height <= maxY) {
              ids.push(node.id);
            }
          }
        } catch(_) {}
        if (ids.length > 0) editor.select(ids);
        editor.requestRender();
        return;
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!drag) return;

      if (drag.kind === 'move') {
        // Commit move with undo support (OP editor API)
        try { if (editor.commitMove) editor.commitMove(drag.originals); } catch(_) {}

        // Notify platform — persist to server
        for (const [id, orig] of drag.originals) {
          const nd = editor.getNode(id);
          if (nd && (nd.x !== orig.x || nd.y !== orig.y)) {
            window.dispatchEvent(new CustomEvent('reframe:node-moved', {
              detail: { nodeId: id, x: nd.x, y: nd.y },
            }));
          }
        }
        emitSelect(null);
      }

      if (drag.kind === 'marquee') {
        if (editor.setMarquee) editor.setMarquee(null);
        emitSelect(null);
      }

      if (drag.kind === 'pan') {
        canvas.style.cursor = spaceHeld ? 'grab' : 'default';
      }

      canvas.releasePointerCapture(e.pointerId);
      drag = null;
      canvas.style.cursor = 'default';
      editor.requestRender();
    });

    // ── Right-click context menu ──
    let clipboard = null; // { ids: string[], nodes: serialized[] }

    function showContextMenu(clientX, clientY) {
      // Remove existing
      var old = document.getElementById('ck-ctx-menu');
      if (old) old.remove();

      var ids = [...editor.state.selectedIds];
      var hasSelection = ids.length > 0;
      var node = hasSelection ? editor.getNode(ids[0]) : null;
      var isHidden = node && node.visible === false;
      var isLocked = node && node.locked;

      var items = [];
      if (hasSelection) {
        items.push({ label: 'Copy', action: 'copy', key: 'Ctrl+C' });
        items.push({ label: 'Paste', action: 'paste', key: 'Ctrl+V' });
        items.push({ label: 'Duplicate', action: 'duplicate', key: 'Ctrl+D' });
        items.push({ label: 'Delete', action: 'delete', key: 'Del', sep: true });
        items.push({ label: isHidden ? 'Show' : 'Hide', action: 'toggle-vis' });
        items.push({ label: isLocked ? 'Unlock' : 'Lock', action: 'toggle-lock' });
      } else {
        items.push({ label: 'Paste', action: 'paste', key: 'Ctrl+V' });
        items.push({ label: 'Select All', action: 'select-all', key: 'Ctrl+A' });
      }

      var menu = document.createElement('div');
      menu.id = 'ck-ctx-menu';
      menu.style.cssText = 'position:fixed;left:' + clientX + 'px;top:' + clientY + 'px;z-index:1000;background:var(--surface-elevated,#1a1a1a);border:1px solid var(--border-strong,#333);border-radius:8px;padding:4px;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-size:13px;';

      items.forEach(function(it) {
        if (it.sep) {
          var sep = document.createElement('div');
          sep.style.cssText = 'height:1px;background:var(--border-subtle,#333);margin:4px 0;';
          menu.appendChild(sep);
        }
        var btn = document.createElement('button');
        btn.dataset.action = it.action;
        btn.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;padding:6px 12px;border:none;border-radius:4px;background:transparent;color:var(--text-primary,#e5e5e5);cursor:pointer;text-align:left;font-family:inherit;font-size:13px;';
        btn.innerHTML = '<span>' + it.label + '</span>' + (it.key ? '<span style="color:var(--text-tertiary,#666);font-size:11px">' + it.key + '</span>' : '');
        btn.addEventListener('mouseenter', function() { btn.style.background = 'var(--accent-tint, rgba(37,99,235,0.15))'; });
        btn.addEventListener('mouseleave', function() { btn.style.background = 'transparent'; });
        btn.addEventListener('click', function(ev) {
          ev.stopPropagation();
          menu.remove();
          handleContextAction(it.action);
        });
        menu.appendChild(btn);
      });

      document.body.appendChild(menu);
      // Close on click outside
      setTimeout(function() {
        document.addEventListener('pointerdown', function close(ev) {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', close); }
        });
      }, 10);
    }

    function handleContextAction(action) {
      var ids = [...editor.state.selectedIds];
      if (action === 'copy') {
        // Serialize selected nodes for paste
        clipboard = ids.map(function(id) {
          var nd = editor.getNode(id);
          if (!nd) return null;
          return { id: id, type: nd.type, x: nd.x, y: nd.y, width: nd.width, height: nd.height, name: nd.name,
            fills: nd.fills, strokes: nd.strokes, opacity: nd.opacity, cornerRadius: nd.cornerRadius,
            text: nd.text, fontSize: nd.fontSize, fontFamily: nd.fontFamily, fontWeight: nd.fontWeight,
            visible: nd.visible, locked: nd.locked };
        }).filter(Boolean);
      } else if (action === 'paste') {
        // Duplicate selected (or from clipboard)
        if (ids.length > 0) {
          try { if (editor.duplicateSelected) editor.duplicateSelected(); } catch(_) {}
        }
      } else if (action === 'duplicate') {
        try { if (editor.duplicateSelected) editor.duplicateSelected(); } catch(_) {}
      } else if (action === 'delete') {
        ids.forEach(function(id) {
          try { if (editor.deleteNode) editor.deleteNode(id); else if (graph.removeNode) graph.removeNode(id); } catch(_) {}
        });
        editor.clearSelection();
      } else if (action === 'toggle-vis') {
        ids.forEach(function(id) {
          var nd = editor.getNode(id);
          if (nd) nd.visible = !nd.visible;
        });
      } else if (action === 'toggle-lock') {
        ids.forEach(function(id) {
          var nd = editor.getNode(id);
          if (nd) nd.locked = !nd.locked;
        });
      } else if (action === 'select-all') {
        try { if (editor.selectAll) editor.selectAll(); } catch(_) {}
      }
      editor.requestRender();
      emitSelect(null);
    }

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // If right-clicking on a node, select it first
      let cx2, cy2;
      try { ({x: cx2, y: cy2} = editor.screenToCanvas(lx(e), ly(e))); } catch { return; }
      var hit = editor.hitTestAtPoint(cx2, cy2);
      if (hit && !editor.state.selectedIds.has(hit.id)) {
        editor.select([hit.id]);
        editor.requestRender();
        emitSelect(hit);
      }
      showContextMenu(e.clientX, e.clientY);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        editor.applyZoom(e.deltaY > 0 ? 1.5 : -1.5, lx(e), ly(e));
      } else {
        editor.pan(-e.deltaX, -e.deltaY);
      }
      editor.requestRender();
    }, { passive: false });

    // ── Text editing overlay ──
    // OP's startTextEditing() only sets internal state — we need a real
    // DOM textarea overlay so the user can type. On double-click TEXT node,
    // create an absolutely positioned textarea over the node's screen bbox.
    let activeTextOverlay = null;

    function openTextOverlay(nodeId) {
      closeTextOverlay();
      var nd = editor.getNode(nodeId);
      if (!nd) return;

      // Convert node bbox to screen coords
      var canvasRect = canvas.getBoundingClientRect();
      var zoom = editor.state.zoom || 1;
      var panX = editor.state.panX || 0;
      var panY = editor.state.panY || 0;
      var sx = nd.x * zoom + panX + canvasRect.left;
      var sy = nd.y * zoom + panY + canvasRect.top;
      var sw = nd.width * zoom;
      var sh = Math.max(nd.height * zoom, 28);

      var ta = document.createElement('textarea');
      ta.value = nd.text || '';
      ta.style.cssText = 'position:fixed;z-index:100;border:2px solid var(--accent,#2563eb);border-radius:2px;' +
        'background:rgba(255,255,255,0.95);color:#000;font-family:' + (nd.fontFamily || 'Inter') + ';' +
        'font-size:' + ((nd.fontSize || 16) * zoom) + 'px;font-weight:' + (nd.fontWeight || 400) + ';' +
        'padding:4px;resize:none;outline:none;overflow:hidden;line-height:1.4;' +
        'left:' + sx + 'px;top:' + sy + 'px;width:' + sw + 'px;min-height:' + sh + 'px;';
      ta.dataset.nodeId = nodeId;

      ta.addEventListener('blur', function() { commitText(ta); });
      ta.addEventListener('keydown', function(ev) {
        if (ev.key === 'Escape') { ta.blur(); ev.preventDefault(); }
        if (ev.key === 'Enter' && !ev.shiftKey) { ta.blur(); ev.preventDefault(); }
        ev.stopPropagation(); // Don't trigger canvas shortcuts while typing
      });

      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      activeTextOverlay = ta;
    }

    function commitText(ta) {
      if (!ta || !ta.parentNode) return;
      var nid = ta.dataset.nodeId;
      var newText = ta.value;
      ta.remove();
      activeTextOverlay = null;
      if (!nid) return;
      var nd = editor.getNode(nid);
      if (nd) {
        nd.text = newText;
        editor.requestRender();
        // Persist to server
        var sessionId = canvas.dataset.session;
        if (sessionId) {
          window.dispatchEvent(new CustomEvent('reframe:prop-changed', {
            detail: { nodeId: nid, props: { 'text-content': newText } },
          }));
          // Also POST directly
          fetch('/platform/api/node/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: sessionId, nodeId: nid, props: { 'text-content': newText } }),
          }).catch(function() {});
        }
      }
    }

    function closeTextOverlay() {
      if (activeTextOverlay) { commitText(activeTextOverlay); }
    }

    canvas.addEventListener('dblclick', (e) => {
      let cx, cy;
      try { ({x: cx, y: cy} = editor.screenToCanvas(lx(e), ly(e))); } catch { return; }
      const hit = editor.hitTestAtPoint(cx, cy, true);
      if (hit) {
        if (hit.type === 'TEXT') {
          // Open text editing overlay
          openTextOverlay(hit.id);
        } else {
          // Double-click frame → enter container, select child
          editor.select([hit.id]);
        }
        editor.requestRender();
        emitSelect(hit);
      }
    });

    // ── 10. Property change → canvas sync ──
    // When the properties panel edits a node via the API, the server
    // sends back updated props. We map common CSS props → OP node
    // fields so the canvas updates without a full re-hydrate.
    window.addEventListener('reframe:prop-changed', function(evt) {
      var d = evt.detail || {};
      if (!d.nodeId) return;
      var nd = editor.getNode ? editor.getNode(d.nodeId) : (graph.getNode ? graph.getNode(d.nodeId) : null);
      if (!nd) return;
      var p = d.props || {};
      // Map CSS props → OP SceneNode fields
      if (p.width != null) nd.width = Number(p.width);
      if (p.height != null) nd.height = Number(p.height);
      if (p.x != null) nd.x = Number(p.x);
      if (p.y != null) nd.y = Number(p.y);
      if (p.opacity != null) nd.opacity = Number(p.opacity);
      if (p['border-radius'] != null) nd.cornerRadius = Number(p['border-radius']);
      if (p['font-size'] != null) nd.fontSize = Number(p['font-size']);
      if (p['font-weight'] != null) nd.fontWeight = Number(p['font-weight']);
      if (p['font-family']) nd.fontFamily = String(p['font-family']);
      if (p.background) {
        // Convert hex → OP fill
        try {
          var hex = String(p.background).replace('#', '');
          if (hex.length === 6) {
            var r = parseInt(hex.slice(0,2),16)/255;
            var g = parseInt(hex.slice(2,4),16)/255;
            var b = parseInt(hex.slice(4,6),16)/255;
            nd.fills = [{ type: 'SOLID', color: {r:r,g:g,b:b,a:1}, visible: true }];
          }
        } catch(_) {}
      }
      if (p.color && nd.type === 'TEXT') {
        try {
          var hex2 = String(p.color).replace('#', '');
          if (hex2.length === 6) {
            var r2 = parseInt(hex2.slice(0,2),16)/255;
            var g2 = parseInt(hex2.slice(2,4),16)/255;
            var b2 = parseInt(hex2.slice(4,6),16)/255;
            nd.fills = [{ type: 'SOLID', color: {r:r2,g:g2,b:b2,a:1}, visible: true }];
          }
        } catch(_) {}
      }
      if (p.visible != null) nd.visible = p.visible !== false && p.visible !== 'false';
      // Re-layout and re-render
      try { computeAllLayouts(graph); } catch(_) {}
      editor.requestRender();
    });

    // ── 11. Keyboard shortcuts ──
    document.addEventListener('keydown', (e) => {
      var tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

      var key = e.key;

      // Space → pan mode
      if (key === ' ' && !spaceHeld) {
        spaceHeld = true;
        canvas.style.cursor = 'grab';
        e.preventDefault();
        return;
      }

      // Delete / Backspace → remove selected
      if (key === 'Delete' || key === 'Backspace') {
        var ids = [...editor.state.selectedIds];
        if (ids.length > 0) {
          ids.forEach(function(nid) {
            try {
              if (editor.deleteNode) editor.deleteNode(nid);
              else if (graph.removeNode) graph.removeNode(nid);
            } catch(_) {}
          });
          editor.clearSelection();
          editor.requestRender();
          emitSelect(null);
          e.preventDefault();
        }
        return;
      }

      // Escape → deselect
      if (key === 'Escape') {
        editor.clearSelection();
        if (editor.setMarquee) editor.setMarquee(null);
        editor.requestRender();
        emitSelect(null);
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd + A → select all
      if ((e.ctrlKey || e.metaKey) && key === 'a') {
        if (editor.selectAll) editor.selectAll();
        editor.requestRender();
        emitSelect(null);
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd + D → duplicate
      if ((e.ctrlKey || e.metaKey) && key === 'd') {
        var selIds = [...editor.state.selectedIds];
        if (selIds.length > 0 && editor.duplicateNodes) {
          editor.duplicateNodes(selIds);
          editor.requestRender();
          emitSelect(null);
        }
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd + C → copy
      if ((e.ctrlKey || e.metaKey) && key === 'c') {
        handleContextAction('copy');
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd + V → paste (duplicate)
      if ((e.ctrlKey || e.metaKey) && key === 'v') {
        handleContextAction('paste');
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd + X → cut
      if ((e.ctrlKey || e.metaKey) && key === 'x') {
        handleContextAction('copy');
        handleContextAction('delete');
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd + Z → undo, Ctrl/Cmd + Shift + Z → redo
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        try {
          if (e.shiftKey) { if (editor.redo) editor.redo(); }
          else { if (editor.undo) editor.undo(); }
        } catch(_) {}
        editor.requestRender();
        e.preventDefault();
        return;
      }
      // H → toggle visibility of selected
      if (key === 'h' && !e.ctrlKey && !e.metaKey) {
        if (editor.state.selectedIds.size > 0) {
          handleContextAction('toggle-vis');
          e.preventDefault();
        }
        return;
      }

      // Arrow keys → nudge (1px, shift = 10px)
      var nudge = e.shiftKey ? 10 : 1;
      var arrows = { ArrowUp: [0,-nudge], ArrowDown: [0,nudge], ArrowLeft: [-nudge,0], ArrowRight: [nudge,0] };
      if (arrows[key]) {
        var [adx, ady] = arrows[key];
        var nudgeIds = [...editor.state.selectedIds];
        if (nudgeIds.length > 0) {
          nudgeIds.forEach(function(nid) {
            var nd = editor.getNode(nid);
            if (nd) { nd.x += adx; nd.y += ady; }
          });
          editor.requestRender();
          e.preventDefault();
        }
        return;
      }

      // Ctrl+0 → zoom to fit
      if (key === '0' && (e.ctrlKey || e.metaKey)) {
        editor.zoomToFit(); editor.requestRender(); e.preventDefault(); return;
      }
      // +/= → zoom in, - → zoom out
      if (key === '+' || key === '=') {
        editor.applyZoom(-3, container.clientWidth/2, container.clientHeight/2);
        editor.requestRender(); e.preventDefault(); return;
      }
      if (key === '-' && !e.ctrlKey && !e.metaKey) {
        editor.applyZoom(3, container.clientWidth/2, container.clientHeight/2);
        editor.requestRender(); e.preventDefault(); return;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === ' ') { spaceHeld = false; canvas.style.cursor = 'default'; }
    });

    setStatus('');
    console.log('[reframe] CanvasKit viewport active' + (isProjectMode ? ' (project: ' + sceneIds.length + ' scenes)' : ''));

    window.__reframeEditor = editor;
    window.__reframeGraph = graph;

  } catch (err) {
    console.error('[reframe] CanvasKit failed:', err);
    setStatus('Canvas failed to load: ' + err.message);
  }
})();
`;
