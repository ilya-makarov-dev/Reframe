/**
 * electric layer — random arc/spark events.
 *
 * Discrete arc events at configurable frequency. Each arc is a jagged
 * lightning-like polyline from one random point to another, with N
 * branches, lasting ~150ms with bright flash → fade. Reads as energy
 * / activity / "charged" — hero pages for AI products, action confirms.
 *
 * Differs from particle layers: NO continuous particle pool. Arcs are
 * discrete events on a timeline. Storage = active-events array, GC'd
 * when life expires; new events spawned on a frequency timer.
 *
 * Config:
 *   frequency: 0.5..10 arcs/sec     default 2
 *   color:     hex / rgba           default 'rgba(140,180,255,0.9)'
 *   branches:  1..5                 default 3  (arc complexity)
 *
 * Default blend: 'lighter' — electric arcs are luminous; additive
 * matches the physical model.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, isHexColor } from './utils.js';

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const freqRaw = config.frequency;
  if (freqRaw !== undefined && freqRaw !== null) {
    if (typeof freqRaw !== 'number' || !Number.isFinite(freqRaw) || freqRaw < 0.5 || freqRaw > 10) {
      return { ok: false, param: 'frequency', message: 'must be a finite number in 0.5..10 arcs/sec' };
    }
  }
  const colorRaw = config.color;
  if (colorRaw !== undefined && colorRaw !== null) {
    if (typeof colorRaw !== 'string') {
      return { ok: false, param: 'color', message: 'must be a CSS color string' };
    }
    if (!isHexColor(colorRaw) && !/^rgba?\(/.test(colorRaw)) {
      return { ok: false, param: 'color', message: 'must be a hex (#abc/#aabbcc) or rgb()/rgba() color' };
    }
  }
  const branchesRaw = config.branches;
  if (branchesRaw !== undefined && branchesRaw !== null) {
    if (typeof branchesRaw !== 'number' || !Number.isFinite(branchesRaw) || branchesRaw < 1 || branchesRaw > 5) {
      return { ok: false, param: 'branches', message: 'must be a finite number in 1..5' };
    }
  }
  return {
    ok: true,
    resolved: {
      frequency: readNumber(config, 'frequency', 2, 0.5, 10),
      color: typeof colorRaw === 'string' ? colorRaw : 'rgba(140,180,255,0.9)',
      branches: Math.round(readNumber(config, 'branches', 3, 1, 5)),
    },
  };
}

const BROWSER_SOURCE = `
function factory_electric(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var rng = seededRng(layerId);
  var frequency = typeof config.frequency === 'number' ? config.frequency : 2;
  var color = config.color || 'rgba(140,180,255,0.9)';
  var branches = typeof config.branches === 'number' ? Math.round(config.branches) : 3;
  var MAX_ACTIVE = 5;
  var w = canvas.width, h = canvas.height;
  var ARC_LIFE_MS = 180;

  // Active arcs: each = { points: [[x,y],...], birth: ms, life: ms, segments: [...sub-branches...] }
  var arcs = [];

  // Build a jagged polyline between two endpoints with N midpoint
  // perturbations — classic lightning shape.
  function buildArc(x0, y0, x1, y1, depth) {
    if (depth === 0) return [[x0, y0], [x1, y1]];
    var mx = (x0 + x1) / 2;
    var my = (y0 + y1) / 2;
    // Perpendicular offset proportional to segment length, jittered.
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.sqrt(dx * dx + dy * dy);
    var perpX = -dy / (len || 1);
    var perpY = dx / (len || 1);
    var offset = (rng() - 0.5) * len * 0.3;
    mx += perpX * offset;
    my += perpY * offset;
    var left = buildArc(x0, y0, mx, my, depth - 1);
    var right = buildArc(mx, my, x1, y1, depth - 1);
    return left.concat(right.slice(1));
  }

  function spawnArc(time) {
    if (arcs.length >= MAX_ACTIVE) return;
    var x0 = rng() * w;
    var y0 = rng() * h;
    var angle = rng() * Math.PI * 2;
    var dist = 100 + rng() * 200;
    var x1 = x0 + Math.cos(angle) * dist;
    var y1 = y0 + Math.sin(angle) * dist;
    var trunk = buildArc(x0, y0, x1, y1, 4);
    // Branches: forks off the trunk at random points.
    var subBranches = [];
    for (var b = 0; b < branches - 1; b++) {
      var startIdx = 1 + Math.floor(rng() * (trunk.length - 2));
      var sx = trunk[startIdx][0];
      var sy = trunk[startIdx][1];
      var bAngle = rng() * Math.PI * 2;
      var bDist = 30 + rng() * 70;
      var ex = sx + Math.cos(bAngle) * bDist;
      var ey = sy + Math.sin(bAngle) * bDist;
      subBranches.push(buildArc(sx, sy, ex, ey, 3));
    }
    arcs.push({ trunk: trunk, branches: subBranches, birth: time });
  }

  var nextSpawnAt = 0;
  var lastTime = 0;

  return {
    render: function(ctx2, time) {
      lastTime = time;
      ctx2.clearRect(0, 0, w, h);

      // Spawn arcs on the frequency timer. Use a deterministic random
      // jitter on the interval so spawns aren't strictly periodic.
      if (time >= nextSpawnAt) {
        spawnArc(time);
        var interval = 1000 / frequency;
        var jitter = 1 + (rng() - 0.5) * 0.3;
        nextSpawnAt = time + interval * jitter;
      }

      // Render + GC. Iterate backward for safe splice during traversal.
      for (var i = arcs.length - 1; i >= 0; i--) {
        var arc = arcs[i];
        var age = time - arc.birth;
        if (age >= ARC_LIFE_MS) { arcs.splice(i, 1); continue; }
        var t = age / ARC_LIFE_MS;
        // Bright flash (0..0.2), fade out (0.2..1).
        var alpha = t < 0.2 ? t / 0.2 : (1 - t) / 0.8;
        ctx2.lineCap = 'round';
        ctx2.lineJoin = 'round';
        // Wide soft glow under sharp core for "electric" reading.
        ctx2.strokeStyle = color;
        ctx2.globalAlpha = alpha * 0.3;
        ctx2.lineWidth = 6;
        drawPath(ctx2, arc.trunk);
        ctx2.globalAlpha = alpha;
        ctx2.lineWidth = 1.5;
        drawPath(ctx2, arc.trunk);
        for (var b = 0; b < arc.branches.length; b++) {
          ctx2.globalAlpha = alpha * 0.25;
          ctx2.lineWidth = 4;
          drawPath(ctx2, arc.branches[b]);
          ctx2.globalAlpha = alpha * 0.8;
          ctx2.lineWidth = 1;
          drawPath(ctx2, arc.branches[b]);
        }
      }
      ctx2.globalAlpha = 1;
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      w = newW;
      h = newH;
    },
    destroy: function() {
      arcs.length = 0;
    },
  };

  function drawPath(ctx2, points) {
    if (points.length < 2) return;
    ctx2.beginPath();
    ctx2.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i++) ctx2.lineTo(points[i][0], points[i][1]);
    ctx2.stroke();
  }
}
`;

export const electricImpl: LayerImpl = {
  type: 'electric',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'lighter',
};
