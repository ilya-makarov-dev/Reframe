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

// Phase 3 Brief 3d Pin #1 — variants list endpoint.
function parseBrandMarksListPath(pathname: string): { slug: string } | null {
  // /platform/api/brand/<slug>/marks
  const m = pathname.match(/^\/platform\/api\/brand\/([A-Za-z0-9_-]+)\/marks\/?$/);
  if (!m) return null;
  return { slug: m[1] };
}

const VARIANT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/i;
const MAX_MARK_BYTES = 200 * 1024; // 200 KB cap per Brief 3d Pin #1.

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c) => {
      const buf = c as Buffer;
      size += buf.length;
      if (size > MAX_MARK_BYTES * 2) {
        // Hard ceiling at 2x the per-file cap to defend against
        // adversarial uploads that pad the multipart envelope.
        reject(new Error('upload too large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Minimal multipart/form-data parser. Reframe doesn't depend on
 * formidable/busboy and the brand-mark upload is the only file-upload
 * endpoint today, so a focused parser is cheaper than the dependency.
 *
 * Returns the first file part's bytes + content-type, or null when no
 * file part is found. Does NOT support multiple files in one request.
 */
function parseFirstFilePart(body: Buffer, boundary: string): { bytes: Buffer; contentType: string } | null {
  const sep = Buffer.from('--' + boundary);
  let cursor = body.indexOf(sep);
  if (cursor < 0) return null;
  cursor += sep.length;
  while (cursor < body.length) {
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2; // CRLF
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) return null; // closing --
    // Headers are CRLF-delimited up to a blank line.
    const headerEnd = body.indexOf('\r\n\r\n', cursor);
    if (headerEnd < 0) return null;
    const headers = body.slice(cursor, headerEnd).toString('utf-8');
    const partEnd = body.indexOf(sep, headerEnd + 4);
    if (partEnd < 0) return null;
    // Trim trailing CRLF before separator.
    let bodyEnd = partEnd;
    if (body[bodyEnd - 2] === 0x0d && body[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    const bytes = body.slice(headerEnd + 4, bodyEnd);
    const isFile = /content-disposition:[^\n]*filename=/i.test(headers);
    if (isFile) {
      const ctMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
      const contentType = (ctMatch?.[1] ?? 'application/octet-stream').trim().toLowerCase();
      return { bytes, contentType };
    }
    cursor = partEnd + sep.length;
  }
  return null;
}

export async function handleBrandMarkApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const projectDir = ctx.projectDir;

  // ── GET /platform/api/brand/<slug>/marks ──── Brief 3d Pin #1
  // Lists variants discovered on disk under .reframe/brands/<slug>/marks/
  // and the default variant ('primary' if present, else first found).
  const listParsed = parseBrandMarksListPath(url.pathname);
  if (listParsed && req.method === 'GET') {
    if (!projectDir) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'no project open' }));
      return true;
    }
    const { slug } = listParsed;
    const dir = path.join(brandsRoot(projectDir), slug, 'marks');
    let variants: string[] = [];
    if (fs.existsSync(dir)) {
      try {
        variants = fs.readdirSync(dir)
          .filter((f) => f.endsWith('.svg'))
          .map((f) => f.slice(0, -4))
          .sort();
      } catch { variants = []; }
    }
    const defaultVariant = variants.includes('primary')
      ? 'primary'
      : (variants.includes('logo') ? 'logo' : (variants[0] ?? null));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, variants, defaultVariant }));
    return true;
  }

  // ── POST /platform/api/brand/<slug>/mark/<variant> ──── Brief 3d Pin #1
  // multipart/form-data upload. Validates SVG mimetype + size + variant
  // name, writes to .reframe/brands/<slug>/marks/<variant>.svg, broadcasts
  // scoped brand:edited SSE so workbenches with this brand reload.
  const uploadParsed = parseBrandMarkPath(url.pathname);
  if (uploadParsed && req.method === 'POST') {
    if (!projectDir) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'no project open' }));
      return true;
    }
    const { slug, variant } = uploadParsed;
    if (!VARIANT_NAME_RE.test(variant)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid variant name (a-z, 0-9, dash; ≤41 chars)' }));
      return true;
    }
    const ct = String(req.headers['content-type'] ?? '');
    const boundaryMatch = ct.match(/boundary=([^\s;]+)/i);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'multipart/form-data with boundary required' }));
      return true;
    }
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (e: any) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e?.message ?? 'upload failed' }));
      return true;
    }
    const part = parseFirstFilePart(body, boundaryMatch[1]);
    if (!part) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'no file part in upload' }));
      return true;
    }
    if (part.bytes.length > MAX_MARK_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `file exceeds ${MAX_MARK_BYTES} byte cap` }));
      return true;
    }
    if (!part.contentType.includes('image/svg+xml')) {
      res.writeHead(415, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'SVG required (image/svg+xml)' }));
      return true;
    }
    // Sniff the bytes for `<svg` — a malicious upload could lie about its
    // content-type. Reject anything that doesn't look like SVG.
    const head = part.bytes.slice(0, 256).toString('utf-8');
    if (!/<svg[\s>]/i.test(head)) {
      res.writeHead(415, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'file body is not SVG' }));
      return true;
    }
    const brandDir = path.join(brandsRoot(projectDir), slug);
    if (!fs.existsSync(brandDir)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `brand ${slug} not found` }));
      return true;
    }
    const marksDir = path.join(brandDir, 'marks');
    if (!fs.existsSync(marksDir)) fs.mkdirSync(marksDir, { recursive: true });
    const filePath = path.join(marksDir, `${variant}.svg`);
    try {
      fs.writeFileSync(filePath, part.bytes);
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `write failed: ${err?.message ?? err}` }));
      return true;
    }
    // Scoped SSE so workbench preview re-renders with new logo.
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'design-system:updated' } as any);
      emitEvent({ type: 'brand:edited', slug } as any);
    } catch { /* best-effort */ }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, variant, path: `marks/${variant}.svg`, bytes: part.bytes.length }));
    return true;
  }

  // ── GET /platform/api/brand/<slug>/mark/<variant> ──── existing serve
  if (req.method !== 'GET') return false;
  const parsed = parseBrandMarkPath(url.pathname);
  if (!parsed) return false;
  const { slug, variant } = parsed;

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
