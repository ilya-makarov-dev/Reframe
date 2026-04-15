/**
 * Browser ESM shim for canvaskit-wasm.
 *
 * canvaskit-wasm ships as UMD (var CanvasKitInit = ...), which can't be
 * imported as ESM default. This shim loads it via a script tag and
 * exposes the global as a default export.
 *
 * Served as /platform/vendor/canvaskit-shim.js — the import map
 * redirects "canvaskit-wasm" here.
 */

// Load canvaskit UMD script
const script = document.createElement('script');
script.src = '/platform/vendor/canvaskit/canvaskit.js';
const ready = new Promise<void>((resolve, reject) => {
  script.onload = () => resolve();
  script.onerror = () => reject(new Error('Failed to load CanvasKit'));
});
document.head.appendChild(script);

async function CanvasKitInit(opts?: any): Promise<any> {
  await ready;
  const init = (globalThis as any).CanvasKitInit;
  if (!init) throw new Error('CanvasKitInit not found');
  return init(opts);
}

export default CanvasKitInit;
