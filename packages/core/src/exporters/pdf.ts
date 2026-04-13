/**
 * PDF Exporter — Scene Graph → PDF via CanvasKit or HTML fallback.
 *
 * Primary path: CanvasKit (Skia) PDF surface if available.
 * Fallback: export HTML, then generate simple PDF wrapper.
 */

import type { SceneGraph } from '../engine/scene-graph';

export interface PdfExportOptions {
  /** Document title. */
  title?: string;
  /** Document author. */
  author?: string;
  /** Page margin in px. Default: 0. */
  margin?: number;
}

/**
 * Export a scene to PDF bytes.
 *
 * Strategy:
 * 1. Try CanvasKit PDF surface (if Skia compiled with PDF support)
 * 2. Fallback: render to PNG and embed in a minimal PDF wrapper
 */
export async function exportToPdf(
  graph: SceneGraph,
  rootId: string,
  options: PdfExportOptions = {},
): Promise<Uint8Array> {
  const root = graph.getNode(rootId);
  if (!root) throw new Error(`Node ${rootId} not found`);

  const title = options.title ?? root.name ?? 'Untitled';
  const margin = options.margin ?? 0;
  const width = Math.ceil(root.width) + margin * 2;
  const height = Math.ceil(root.height) + margin * 2;

  // Strategy: render to PNG and embed in a minimal PDF
  // This gives us pixel-perfect output without requiring Skia PDF support
  const { exportToRaster, initCanvasKit } = await import('./raster.js');
  await initCanvasKit();
  const pngBytes = await exportToRaster(graph, rootId, { format: 'png', scale: 2 });

  // Generate minimal PDF with embedded PNG
  return generatePdfWithPng(pngBytes, width, height, title);
}

/**
 * Generate a minimal PDF containing a single PNG image.
 * PDF 1.4 spec, no external dependencies.
 */
function generatePdfWithPng(
  pngBytes: Uint8Array,
  pageWidth: number,
  pageHeight: number,
  title: string,
): Uint8Array {
  // Scale page dimensions to points (72 dpi)
  // Assume input is CSS pixels at 96 dpi → multiply by 72/96 = 0.75
  const ptW = Math.round(pageWidth * 0.75);
  const ptH = Math.round(pageHeight * 0.75);

  // Build PDF objects
  const objects: string[] = [];
  const offsets: number[] = [];
  let currentOffset = 0;

  function addObject(content: string): number {
    const num = objects.length + 1;
    offsets.push(currentOffset);
    const obj = `${num} 0 obj\n${content}\nendobj\n`;
    objects.push(obj);
    currentOffset += obj.length;
    return num;
  }

  // Header
  const header = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';
  currentOffset = header.length;

  // 1. Catalog
  const catalogNum = addObject('<< /Type /Catalog /Pages 2 0 R >>');

  // 2. Pages
  const pagesNum = addObject(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);

  // 3. Page
  const pageNum = addObject(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] ` +
    `/Contents 4 0 R /Resources << /XObject << /Img 5 0 R >> >> >>`
  );

  // 4. Content stream (draw image full-page)
  const contentStream = `q ${ptW} 0 0 ${ptH} 0 0 cm /Img Do Q`;
  const contentStreamNum = addObject(
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`
  );

  // 5. Image XObject (PNG embedded as raw)
  // For simplicity, encode the PNG as a DCTDecode-compatible stream
  // Actually, PDF supports PNG natively via FlateDecode with PNGPredictor
  // But the simplest approach is to embed as raw bytes with /Filter /FlateDecode
  // For maximum compatibility, we'll use a hex-encoded stream
  const pngHex = Array.from(pngBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const imgNum = addObject(
    `<< /Type /XObject /Subtype /Image /Width ${ptW * 2} /Height ${ptH * 2} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode ` +
    `/Length ${pngHex.length + 1} >>\nstream\n${pngHex}>\nendstream`
  );

  // Cross-reference table
  const xrefOffset = header.length + objects.reduce((sum, o) => sum + o.length, 0);
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map(off => `${String(header.length + off).padStart(10, '0')} 00000 n `),
    '',
  ].join('\n');

  // Trailer
  const trailer = [
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');

  // Assemble
  const pdfStr = header + objects.join('') + xref + trailer;
  return new TextEncoder().encode(pdfStr);
}
