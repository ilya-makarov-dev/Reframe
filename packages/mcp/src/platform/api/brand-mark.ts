/**
 * Brand-mark serving endpoint (Week 5 #21).
 *
 *   GET /api/brand/<slug>/mark/<variant>
 *     → 200 image/svg+xml — file bytes from `.reframe/brands/<slug>/marks/<variant>.svg`
 *     → 404 — brand directory missing OR variant SVG missing
 *
 * Read-only by design — mutations happen via filesystem (manual deposit
 * by the user, or `reframe_design action=extract` regenerating the
 * marks/ directory). No POST/PUT in Phase 0; brand marks change rarely
 * enough that an out-of-band edit + dashboard reload is acceptable.
 *
 * Cache profile: long max-age (24h) since brand marks are stable across
 * brand revisions; ETag is content-hash so a manual SVG swap invalidates
 * cleanly without waiting for the timeout.
 *
 * Variant filtering: only `*.svg` files are servable. A non-SVG dropped
 * into marks/ (e.g. .png, .ico) yields 404 — Phase 0 brand-mark contract
 * is SVG-only because the inliner emits `data:image/svg+xml;base64,...`.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { PlatformContext } from '../router.js';

function brandsRoot(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'brands');
}

function markPath(projectDir: string, slug: string, variant: string): string {
  return path.join(brandsRoot(projectDir), slug, 'marks', `${variant}.svg`);
}

function parseBrandMarkPath(pathname: string): { slug: string; variant: string } | null {
  // /platform/api/brand/<slug>/mark/<variant>  (slug/variant: alnum + dash)
  const m = pathname.match(/^\/platform\/api\/brand\/([A-Za-z0-9_-]+)\/mark\/([A-Za-z0-9_-]+)\/?$/);
  if (!m) return null;
  return { slug: m[1], variant: m[2] };
}

export async function handleBrandMarkApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  if (req.method !== 'GET') return false;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parsed = parseBrandMarkPath(url.pathname);
  if (!parsed) return false;
  const { slug, variant } = parsed;

  const projectDir = ctx.projectDir;
  if (!projectDir) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'no project open' }));
    return true;
  }

  const filePath = markPath(projectDir, slug, variant);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'brand mark not found', slug, variant }));
    return true;
  }

  let body: string;
  try {
    body = fs.readFileSync(filePath, 'utf8');
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `read failed: ${err?.message ?? err}` }));
    return true;
  }

  const hashHex = crypto.createHash('sha1').update(body).digest('hex').slice(0, 16);
  const etag = `W/"mark-${hashHex}"`;
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
    ETag: etag,
  });
  res.end(body);
  return true;
}
