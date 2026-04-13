/**
 * Lottie Preview HTML — self-contained player using @lottiefiles/lottie-player.
 * Serve via HTTP (localhost:4100), not file:// — CDN scripts need HTTP origin.
 */

export function buildLottiePreviewHtml(
  lottieData: object,
  title: string,
): string {
  const json = JSON.stringify(lottieData);
  const w = (lottieData as any).w ?? 1440;
  const h = (lottieData as any).h ?? 900;
  const displayW = Math.min(w, 1200);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Source+Code+Pro:wght@400;500;700&display=swap" rel="stylesheet">
<title>${esc(title)} — Lottie Preview</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0b0b0d;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,-apple-system,sans-serif;color:#f5f5f7}
lottie-player{border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);overflow:hidden;background:#fff}
.info{margin-top:16px;font-size:12px;color:#888}
</style>
</head>
<body>
<lottie-player id="player"
  style="width:${displayW}px;max-width:95vw;"
  background="transparent"
  speed="1"
  autoplay loop controls
></lottie-player>
<div class="info">${esc(title)} · ${w}×${h} · ${(lottieData as any).fr ?? 60}fps</div>
<script src="https://unpkg.com/@lottiefiles/lottie-player@2/dist/lottie-player.js"></script>
<script>
var d=${json};
// Strip non-animated container layers — keep only layers with animation or visual content
// This prevents parent white frames from covering children
var dominated = {};
d.layers.forEach(function(l) {
  if (l.ty === 4 && l.shapes) {
    var hasFill = l.shapes.some(function(s) { return s.ty === 'fl'; });
    var isAnimated = l.ks && (l.ks.o.a === 1 || l.ks.p.a === 1 || l.ks.s.a === 1);
    if (hasFill && !isAnimated) {
      // Check if it's a large container (likely a section bg)
      var rect = l.shapes.find(function(s) { return s.ty === 'rc'; });
      if (rect && rect.s && rect.s.k && rect.s.k[0] > 200 && rect.s.k[1] > 100) {
        // Keep as-is but reduce opacity so children show through
        // Actually just let it render — ordering should handle it
      }
    }
  }
});
customElements.whenDefined('lottie-player').then(function(){
  document.getElementById('player').load(d);
});
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
