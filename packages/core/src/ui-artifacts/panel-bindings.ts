// Panel-artifact binding resolver.
//
// A panel artifact is HTML authored on disk (.reframe/ui/<name>.panel.html)
// plus a runtime config object. Authors can't embed loops or substitutions
// in plain HTML, so we expose three attributes that expand into normal
// markup before the standard HTML importer sees it:
//
//   data-bind-each="collection"              repeats the element once per
//                                             item in config.collection;
//                                             the item becomes the local
//                                             scope for nested bindings.
//   data-bind-text="path"                    replaces textContent with
//                                             resolved value.
//   data-bind-attr="attr:path[;attr2:path2]" sets attributes from config.
//
// In any ATTRIBUTE VALUE (including gesture JSON, href, data-*) the token
// `{path}` is substituted against the current scope. This keeps the gesture
// grammar identical to the one agents already know from user-scene HTML.
//
// Paths are dotted: `foo.bar` · `items.0.label` · `.` means "the current
// each-scope item itself" (for scalar iterables).
//
// Output is plain HTML — no bespoke runtime. It goes straight into
// importFromHtml(), which means every downstream optimization (Tailwind
// preprocessing, stableIds, audit rules) works on panel artifacts for free.

// linkedom is ESM-only; the importer (html.ts) does the same dynamic
// import dance to stay compatible with core's CJS build.
let _parseHTML: ((html: string) => { document: any }) | null = null;
async function getParseHTML() {
  if (!_parseHTML) {
    const mod = await import('linkedom');
    _parseHTML = mod.parseHTML;
  }
  return _parseHTML;
}

export type PanelConfig = Record<string, unknown>;

interface Scope {
  config: PanelConfig;
  local?: Record<string, unknown>;
}

/** Resolve a dotted path against scope.local (if it binds) else scope.config. */
function resolvePath(path: string, scope: Scope): unknown {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '.') {
    return scope.local !== undefined ? scope.local['.'] ?? scope.local : scope.config;
  }
  const parts = trimmed.split('.');
  let cursor: unknown = scope.local && parts[0] in (scope.local as object) ? scope.local : scope.config;
  for (const part of parts) {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) {
      const i = Number(part);
      cursor = Number.isFinite(i) ? cursor[i] : (cursor as any)[part];
    } else if (typeof cursor === 'object') {
      cursor = (cursor as any)[part];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function stringifyValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return ''; }
}

/**
 * Replace `{path}` tokens in any string with their resolved values.
 * Used for attribute values, including JSON gesture args, where the
 * existing reframe HTML gesture grammar already uses `{foo}` syntax.
 */
// A path token is conservative on purpose: identifiers, dots, brackets,
// hyphens, underscores. This keeps JSON object braces (`{"tool":...}`)
// from getting parsed as substitution targets — critical because panel
// artifacts carry gesture JSON in attribute values.
const PATH_TOKEN = /\{([a-zA-Z0-9_.\-\[\]]+)\}/g;

export function interpolateString(raw: string, scope: Scope): string {
  return raw.replace(PATH_TOKEN, (_m, path) => stringifyValue(resolvePath(path, scope)));
}

function walkAndResolve(node: any, scope: Scope, doc: any): void {
  // Element nodes only.
  if (!node || node.nodeType !== 1) return;

  // 1. data-bind-each — expand BEFORE descending.
  const eachPath = node.getAttribute?.('data-bind-each');
  if (eachPath) {
    const collection = resolvePath(eachPath, scope);
    const asName = node.getAttribute('data-bind-each-as') || 'item';
    node.removeAttribute('data-bind-each');
    node.removeAttribute('data-bind-each-as');

    const items = Array.isArray(collection) ? collection : [];
    const parent = node.parentNode;
    if (!parent) return;

    const anchor = node;
    for (const item of items) {
      const clone = anchor.cloneNode(true);
      const local: Record<string, unknown> = { '.': item };
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        Object.assign(local, item as Record<string, unknown>);
      }
      local[asName] = item;
      const childScope: Scope = { config: scope.config, local };
      walkAndResolve(clone, childScope, doc);
      parent.insertBefore(clone, anchor);
    }
    parent.removeChild(anchor);
    return; // parent walker continues on the inserted clones naturally
  }

  // 2. data-bind-attr="attr:path[;attr:path]" — set attributes.
  const attrBind = node.getAttribute?.('data-bind-attr');
  if (attrBind) {
    node.removeAttribute('data-bind-attr');
    for (const pair of attrBind.split(';')) {
      const colon = pair.indexOf(':');
      if (colon < 0) continue;
      const name = pair.slice(0, colon).trim();
      const path = pair.slice(colon + 1).trim();
      const value = resolvePath(path, scope);
      node.setAttribute(name, stringifyValue(value));
    }
  }

  // 3. Interpolate `{path}` in every remaining attribute value.
  if (node.attributes && node.attributes.length > 0) {
    const names: string[] = [];
    for (let i = 0; i < node.attributes.length; i++) names.push(node.attributes[i].name);
    for (const name of names) {
      const raw = node.getAttribute(name);
      if (typeof raw === 'string' && raw.indexOf('{') >= 0) {
        node.setAttribute(name, interpolateString(raw, scope));
      }
    }
  }

  // 4. data-bind-text — replace textContent AFTER attr work.
  const textPath = node.getAttribute?.('data-bind-text');
  if (textPath) {
    node.removeAttribute('data-bind-text');
    const value = resolvePath(textPath, scope);
    node.textContent = stringifyValue(value);
    return; // text bindings terminate — children (placeholder preview) dropped
  }

  // 5. Recurse into children. Snapshot child list first; each-expansion
  //    inserts new siblings and we don't want to re-visit them in the
  //    current loop (they're already processed inside the each handler).
  const kids: any[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) kids.push(c);
  for (const child of kids) walkAndResolve(child, scope, doc);
}

/**
 * Resolve `data-bind-*` attributes and `{path}` tokens against `config`.
 * Returns plain HTML ready for the standard importFromHtml() pipeline.
 */
export async function resolveBindings(html: string, config: PanelConfig): Promise<string> {
  const parseHTML = await getParseHTML();
  const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`);
  const body = document.body;
  if (!body) return html;
  const scope: Scope = { config };
  const roots: any[] = [];
  for (let c = body.firstChild; c; c = c.nextSibling) roots.push(c);
  for (const r of roots) walkAndResolve(r, scope, document);
  return body.innerHTML;
}
