/**
 * Template Gallery — starter templates for common design formats.
 *
 * Each template is self-contained HTML that gets imported via importHtml.
 * Agent can also use these as starting points.
 */

import { useCallback } from 'react';
import { useSceneStore } from '../store/scene';

interface Template {
  name: string;
  category: string;
  width: number;
  height: number;
  description: string;
  html: string;
}

const TEMPLATES: Template[] = [
  {
    name: 'Tech Banner',
    category: 'Banner',
    width: 1920,
    height: 1080,
    description: 'Dark tech startup hero with headline, subtitle, CTA',
    html: `<div data-name="Banner" style="width:1920px;height:1080px;background:linear-gradient(135deg,#0a0a0a 0%,#1a1a2e 50%,#16213e 100%);position:relative;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;overflow:hidden;display:flex;align-items:center;justify-content:center">
  <div data-name="Glow" style="position:absolute;left:660px;top:240px;width:600px;height:600px;background:radial-gradient(circle,rgba(74,158,255,0.15) 0%,transparent 70%);border-radius:50%"></div>
  <div data-name="Content" style="display:flex;flex-direction:column;align-items:center;text-align:center;z-index:1">
    <div data-name="Badge" style="padding:6px 16px;border:1px solid rgba(74,158,255,0.3);border-radius:20px;color:#4a9eff;font-size:14px;letter-spacing:1px;margin-bottom:24px">NOW IN BETA</div>
    <h1 data-name="Headline" style="color:#ffffff;font-size:72px;font-weight:700;margin:0 0 20px;letter-spacing:-2px;line-height:1.1;text-align:center">Build the future<br/>with AI</h1>
    <p data-name="Subtitle" style="color:#888888;font-size:22px;margin:0 0 40px;line-height:1.5;text-align:center;width:600px">The next generation platform for developers who want to ship faster and build smarter.</p>
    <div data-name="CTA" style="padding:16px 40px;background:#4a9eff;color:#ffffff;font-size:18px;font-weight:600;border-radius:8px">Get Started Free</div>
  </div>
</div>`,
  },
  {
    name: 'Social Card',
    category: 'Social',
    width: 1080,
    height: 1080,
    description: 'Square social media post with bold typography',
    html: `<div data-name="Social" style="width:1080px;height:1080px;background:#1a1a1a;position:relative;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:80px">
  <div data-name="Accent-Line" style="width:60px;height:4px;background:#4a9eff;border-radius:2px;margin-bottom:32px"></div>
  <h1 data-name="Title" style="color:#ffffff;font-size:64px;font-weight:800;margin:0 0 24px;line-height:1.15;letter-spacing:-1px">Design is<br/>not what it<br/>looks like.</h1>
  <p data-name="Quote" style="color:#4a9eff;font-size:28px;font-weight:500;margin:0 0 48px">Design is how it works.</p>
  <div data-name="Author" style="display:flex;align-items:center;gap:16px">
    <div data-name="Avatar" style="width:48px;height:48px;border-radius:50%;background:#333"></div>
    <div>
      <div data-name="Name" style="color:#e0e0e0;font-size:18px;font-weight:600">Steve Jobs</div>
      <div data-name="Handle" style="color:#666;font-size:14px">@apple</div>
    </div>
  </div>
  <div data-name="Brand" style="position:absolute;bottom:48px;right:80px;color:#333;font-size:14px;letter-spacing:2px">REFRAME</div>
</div>`,
  },
  {
    name: 'Story',
    category: 'Social',
    width: 1080,
    height: 1920,
    description: 'Vertical story format with gradient background',
    html: `<div data-name="Story" style="width:1080px;height:1920px;background:linear-gradient(180deg,#1a1a2e 0%,#16213e 40%,#0f3460 100%);position:relative;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:60px">
  <div data-name="Icon" style="width:80px;height:80px;border-radius:20px;background:rgba(74,158,255,0.15);border:2px solid rgba(74,158,255,0.3);margin-bottom:40px;display:flex;align-items:center;justify-content:center;font-size:36px;color:#4a9eff">✦</div>
  <h1 data-name="Heading" style="color:#ffffff;font-size:56px;font-weight:700;margin:0 0 20px;line-height:1.2">Swipe up to<br/>discover more</h1>
  <p data-name="Body" style="color:rgba(255,255,255,0.6);font-size:22px;margin:0 0 60px;max-width:700px;line-height:1.5">Explore our latest collection of AI-powered design tools</p>
  <div data-name="CTA-Button" style="padding:18px 48px;background:#4a9eff;color:#fff;font-size:20px;font-weight:600;border-radius:30px">Learn More</div>
  <div data-name="Swipe" style="position:absolute;bottom:80px;color:rgba(255,255,255,0.3);font-size:16px;letter-spacing:1px">↑ SWIPE UP</div>
</div>`,
  },
  {
    name: 'Card',
    category: 'Component',
    width: 400,
    height: 500,
    description: 'Product/feature card with image area, title, description',
    html: `<div data-name="Card" style="width:400px;height:500px;background:#1e1e1e;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;display:flex;flex-direction:column;border:1px solid #2a2a2a">
  <div data-name="Image" style="height:220px;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center">
    <div data-name="Icon-Box" style="width:64px;height:64px;border-radius:16px;background:rgba(74,158,255,0.15);display:flex;align-items:center;justify-content:center;font-size:28px;color:#4a9eff">⚡</div>
  </div>
  <div data-name="Content" style="padding:28px;flex:1;display:flex;flex-direction:column">
    <div data-name="Tag" style="color:#4a9eff;font-size:12px;font-weight:600;letter-spacing:1px;margin-bottom:12px">FEATURE</div>
    <h3 data-name="Title" style="color:#ffffff;font-size:22px;font-weight:700;margin:0 0 12px;line-height:1.3">Lightning Fast Exports</h3>
    <p data-name="Description" style="color:#888;font-size:15px;line-height:1.6;margin:0 0 auto">Export to HTML, SVG, React, Lottie — all from a single design source of truth.</p>
    <div data-name="Action" style="margin-top:20px;color:#4a9eff;font-size:14px;font-weight:600;cursor:pointer">Learn more →</div>
  </div>
</div>`,
  },
  {
    name: 'Ad Banner',
    category: 'Banner',
    width: 728,
    height: 90,
    description: 'Standard leaderboard ad banner',
    html: `<div data-name="Leaderboard" style="width:728px;height:90px;background:linear-gradient(90deg,#0a0a0a,#1a1a2e);position:relative;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;display:flex;align-items:center;padding:0 24px;gap:24px;overflow:hidden;border:1px solid #2a2a2a;border-radius:4px">
  <div data-name="Logo-Area" style="width:48px;height:48px;border-radius:12px;background:rgba(74,158,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <span data-name="Logo-Icon" style="color:#4a9eff;font-size:20px;font-weight:700">R</span>
  </div>
  <div data-name="Text-Group" style="flex:1;min-width:0">
    <div data-name="Headline" style="color:#ffffff;font-size:18px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Design faster with AI-native tools</div>
    <div data-name="Sub" style="color:#888;font-size:13px;margin-top:2px">From concept to production in minutes, not days.</div>
  </div>
  <div data-name="CTA" style="padding:10px 24px;background:#4a9eff;color:#fff;font-size:14px;font-weight:600;border-radius:6px;white-space:nowrap;flex-shrink:0;cursor:pointer">Try Free</div>
</div>`,
  },
  {
    name: 'Dashboard',
    category: 'App',
    width: 1440,
    height: 900,
    description: 'Minimal analytics dashboard layout',
    html: `<div data-name="Dashboard" style="width:1440px;height:900px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;display:flex;overflow:hidden">
  <div data-name="Sidebar" style="width:240px;background:#111;border-right:1px solid #222;padding:20px 16px;display:flex;flex-direction:column;gap:4px">
    <div data-name="Logo" style="color:#fff;font-size:18px;font-weight:700;padding:8px 12px;margin-bottom:20px">acme</div>
    <div data-name="Nav-Home" style="padding:10px 12px;background:rgba(74,158,255,0.1);border-radius:8px;color:#4a9eff;font-size:14px;font-weight:500">Dashboard</div>
    <div data-name="Nav-Analytics" style="padding:10px 12px;color:#666;font-size:14px">Analytics</div>
    <div data-name="Nav-Projects" style="padding:10px 12px;color:#666;font-size:14px">Projects</div>
    <div data-name="Nav-Settings" style="padding:10px 12px;color:#666;font-size:14px;margin-top:auto">Settings</div>
  </div>
  <div data-name="Main" style="flex:1;padding:28px 32px;overflow:hidden">
    <div data-name="Header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:28px">
      <h1 data-name="Page-Title" style="color:#fff;font-size:24px;font-weight:700;margin:0">Dashboard</h1>
      <div data-name="Date" style="color:#666;font-size:13px">Apr 5, 2026</div>
    </div>
    <div data-name="Stats" style="display:flex;gap:16px;margin-bottom:24px">
      <div data-name="Stat-1" style="flex:1;background:#141414;border:1px solid #222;border-radius:12px;padding:20px">
        <div style="color:#666;font-size:12px;margin-bottom:8px">Revenue</div>
        <div style="color:#fff;font-size:28px;font-weight:700">$24,500</div>
        <div style="color:#34d399;font-size:12px;margin-top:4px">+12.5%</div>
      </div>
      <div data-name="Stat-2" style="flex:1;background:#141414;border:1px solid #222;border-radius:12px;padding:20px">
        <div style="color:#666;font-size:12px;margin-bottom:8px">Users</div>
        <div style="color:#fff;font-size:28px;font-weight:700">1,840</div>
        <div style="color:#34d399;font-size:12px;margin-top:4px">+8.2%</div>
      </div>
      <div data-name="Stat-3" style="flex:1;background:#141414;border:1px solid #222;border-radius:12px;padding:20px">
        <div style="color:#666;font-size:12px;margin-bottom:8px">Conversion</div>
        <div style="color:#fff;font-size:28px;font-weight:700">3.6%</div>
        <div style="color:#f87171;font-size:12px;margin-top:4px">-0.4%</div>
      </div>
      <div data-name="Stat-4" style="flex:1;background:#141414;border:1px solid #222;border-radius:12px;padding:20px">
        <div style="color:#666;font-size:12px;margin-bottom:8px">Avg. Order</div>
        <div style="color:#fff;font-size:28px;font-weight:700">$86</div>
        <div style="color:#34d399;font-size:12px;margin-top:4px">+3.1%</div>
      </div>
    </div>
    <div data-name="Chart-Area" style="background:#141414;border:1px solid #222;border-radius:12px;padding:24px;height:420px;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;margin-bottom:20px">
        <div style="color:#fff;font-size:16px;font-weight:600">Revenue Overview</div>
        <div style="display:flex;gap:8px">
          <div style="padding:6px 12px;background:#1a1a1a;border-radius:6px;color:#888;font-size:12px">7D</div>
          <div style="padding:6px 12px;background:rgba(74,158,255,0.1);border-radius:6px;color:#4a9eff;font-size:12px">30D</div>
          <div style="padding:6px 12px;background:#1a1a1a;border-radius:6px;color:#888;font-size:12px">90D</div>
        </div>
      </div>
      <div data-name="Chart-Placeholder" style="flex:1;background:linear-gradient(180deg,rgba(74,158,255,0.05) 0%,transparent 100%);border-radius:8px;border:1px dashed #222;display:flex;align-items:center;justify-content:center;color:#333;font-size:14px">Chart visualization area</div>
    </div>
  </div>
</div>`,
  },
];

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  const importHtml = useSceneStore(s => s.importHtml);

  const handleSelect = useCallback((template: Template) => {
    importHtml(template.html);
    onClose();
  }, [importHtml, onClose]);

  const categories = [...new Set(TEMPLATES.map(t => t.category))];

  return (
    <div className="template-overlay" onClick={onClose}>
      <div className="template-gallery" onClick={e => e.stopPropagation()}>
        <div className="template-gallery__header">
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Templates</span>
          <button className="toolbar__btn" onClick={onClose} style={{ fontSize: 14, padding: '2px 8px' }}>×</button>
        </div>

        {categories.map(cat => (
          <div key={cat} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '0 0 8px' }}>
              {cat}
            </div>
            <div className="template-grid">
              {TEMPLATES.filter(t => t.category === cat).map(t => (
                <div key={t.name} className="template-card" onClick={() => handleSelect(t)}>
                  <div className="template-card__preview">
                    <div style={{
                      width: '100%', height: '100%',
                      background: 'linear-gradient(135deg, #141414, #1a1a2e)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: 'var(--text-muted)',
                    }}>
                      {t.width}×{t.height}
                    </div>
                  </div>
                  <div className="template-card__info">
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{t.name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{t.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Get templates list for agent access */
export function getTemplateNames(): string[] {
  return TEMPLATES.map(t => t.name);
}

export function getTemplateByName(name: string): Template | undefined {
  return TEMPLATES.find(t => t.name.toLowerCase() === name.toLowerCase());
}
