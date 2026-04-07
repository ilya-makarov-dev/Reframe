/**
 * Builder — smoke tests
 *
 * Run: npx tsx src/builder.test.ts
 */

import { NodeType } from '../host/types';
import {
  build, buildInto,
  frame, rect, ellipse, text, group,
  solid, linearGradient, dropShadow, blur,
} from '../builder';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ── 1. Basic tree ──────────────────────────────────

{
  const { root } = build(
    frame({ width: 1080, height: 1080, name: 'Banner' },
      rect({ width: 1080, height: 1080, fills: [solid('#FF0000')] }),
      text('Hello World', { fontSize: 48, x: 40, y: 40 }),
    )
  );

  assert(root.type === NodeType.Frame, 'root is FRAME');
  assert(root.name === 'Banner', 'root name is Banner');
  assert(root.width === 1080, 'root width 1080');
  assert(root.height === 1080, 'root height 1080');

  const kids = root.children!;
  assert(kids.length === 2, 'root has 2 children');
  assert(kids[0].type === NodeType.Rectangle, 'child 0 is RECTANGLE');
  assert(kids[1].type === NodeType.Text, 'child 1 is TEXT');
  assert(kids[1].characters === 'Hello World', 'text content matches');
  assert(kids[1].fontSize === 48, 'fontSize is 48');
  assert(kids[1].x === 40, 'text x is 40');
}

// ── 2. Paint helpers ───────────────────────────────

{
  const s = solid('#FF8800', 0.5);
  assert(s.type === 'SOLID', 'solid type');
  assert(Math.abs(s.color.r - 1) < 0.01, 'solid red');
  assert(Math.abs(s.color.g - 0.533) < 0.01, 'solid green');
  assert(s.opacity === 0.5, 'solid opacity');

  const g = linearGradient([
    { color: '#000', position: 0 },
    { color: '#FFF', position: 1 },
  ]);
  assert(g.type === 'GRADIENT_LINEAR', 'gradient type');
  assert(g.gradientStops!.length === 2, 'gradient has 2 stops');
}

// ── 3. Effects ─────────────────────────────────────

{
  const { root } = build(
    rect({ width: 100, height: 100, effects: [dropShadow({ radius: 8 }), blur(10)] })
  );
  assert(root.effects!.length === 2, '2 effects');
  assert(root.effects![0].type === 'DROP_SHADOW', 'first is drop shadow');
  assert(root.effects![0].radius === 8, 'shadow radius 8');
  assert(root.effects![1].type === 'LAYER_BLUR', 'second is blur');
}

// ── 4. Nested groups ──────────────────────────────

{
  const { root } = build(
    frame({ width: 500, height: 500 },
      group({ name: 'Icons', x: 10, y: 10 },
        ellipse({ width: 32, height: 32 }),
        ellipse({ width: 32, height: 32, x: 40 }),
      ),
    )
  );

  const grp = root.children![0];
  assert(grp.type === NodeType.Group, 'child is GROUP');
  assert(grp.name === 'Icons', 'group name');
  assert(grp.children!.length === 2, 'group has 2 children');
  assert(grp.children![0].type === NodeType.Ellipse, 'group child is ELLIPSE');
}

// ── 5. buildInto ──────────────────────────────────

{
  const { root, graph } = build(
    frame({ width: 800, height: 600, name: 'Canvas' })
  );

  const added = buildInto(graph, root.id,
    text('Injected', { fontSize: 24 })
  );

  assert(added.type === NodeType.Text, 'injected node is TEXT');
  assert(added.characters === 'Injected', 'injected text content');

  // Re-read children
  const kids = root.children!;
  assert(kids.length === 1, 'canvas now has 1 child');
}

// ── 6. Layout props ───────────────────────────────

{
  const { root } = build(
    frame({
      width: 400, height: 200,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      paddingLeft: 20, paddingTop: 20,
      paddingRight: 20, paddingBottom: 20,
    },
      rect({ width: 80, height: 80 }),
      rect({ width: 80, height: 80 }),
    )
  );

  assert(root.layoutMode === 'HORIZONTAL', 'layout mode HORIZONTAL');
}

// ── 7. Constraints ────────────────────────────────

{
  const { root } = build(
    rect({
      width: 100, height: 100,
      horizontalConstraint: 'STRETCH',
      verticalConstraint: 'CENTER',
    })
  );

  assert(root.constraints!.horizontal === 'STRETCH', 'h constraint STRETCH');
  assert(root.constraints!.vertical === 'CENTER', 'v constraint CENTER');
}

// ── Summary ────────────────────────────────────────

console.log(`\n  Builder tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
