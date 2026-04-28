/**
 * React-step wrapper — transform the React exporter's per-step output
 * into a `function Step<i>(props)` declaration suitable for inline
 * embedding in a single <script type="text/babel"> block (#20 SPA).
 *
 * Input shape (from `exportToReact(node, { typescript: false, cssModules: false, componentName: 'Step<i>' })`):
 *
 *   import React from 'react';
 *   const Step0 = () => {
 *     return (
 *       <>
 *         <div ...>...</div>
 *       </>
 *     );
 *   };
 *   export default Step0;
 *
 * Output shape (after wrap):
 *
 *   function Step0(props) {
 *     return (
 *       <>
 *         <div ...>...</div>
 *       </>
 *     );
 *   }
 *
 * Strips:
 *   - All `import` lines (React + ReactDOM live as window globals via UMD)
 *   - `export default <Name>;` (no module system in classic <script>)
 *   - Outer `const <Name> = () => {` → `function <Name>(props) {` so
 *     the body can read `props.state` and `props.setState` for the
 *     data-flow-state binding.
 *   - Trailing `};` → `}` (the const declaration's terminator)
 *
 * The fragment wrapper `<>...</>` inside the body is preserved as-is —
 * it's valid JSX inside any function returning a React element.
 */

export interface WrapStepOptions {
  /** Step index — produces `Step0`, `Step1`, ... */
  index: number;
}

export function wrapStepBody(jsxModule: string, opts: WrapStepOptions): string {
  const stepName = `Step${opts.index}`;

  // Strip import lines.
  let body = jsxModule.replace(/^\s*import\s+[^;]+;?\s*$/gm, '');

  // Strip `export default <Name>;` (any name).
  body = body.replace(/^\s*export\s+default\s+\w+\s*;?\s*$/m, '');

  // Find the outer `const <Name> = () => {` declaration and rewrite it
  // as `function <stepName>(props) {`. Greedy match the original name so
  // we cover whatever the exporter chose (`Scene`, `Step0`, `Component`).
  // Regex anchors the LHS at the start of a line + `const`, so inner
  // arrow functions in the body don't get rewritten.
  const arrowDecl = /^(\s*)const\s+\w+\s*=\s*\(\s*\)\s*=>\s*\{/m;
  if (!arrowDecl.test(body)) {
    throw new Error(
      `wrapStepBody: expected to find \`const <Name> = () => {\` declaration in input. ` +
      `React exporter output shape changed.`,
    );
  }
  body = body.replace(arrowDecl, (_full, indent) => `${indent}function ${stepName}(props) {`);

  // Find the matching closing `};` of that declaration. The exporter
  // emits exactly one top-level `};` after the function body. Replace
  // the LAST `};` on its own line with `}`. (Internal blocks are
  // closed with `}` already, no semicolon, so we don't touch those.)
  // Rather than balance braces (overkill), we pick the last `^};$` line.
  const lines = body.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*};\s*$/.test(lines[i])) {
      lines[i] = lines[i].replace(/};/, '}');
      break;
    }
  }
  body = lines.join('\n').trim();

  return body;
}
