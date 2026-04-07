/**
 * Asset Manager — images (data URI) and Google Fonts.
 *
 * Images: upload → data URI → available for designs.
 * Fonts: search Google Fonts → load via @import.
 */

import { useState, useCallback, useRef } from 'react';
import { useSceneStore } from '../store/scene';

// ─── Types ─────────────────────────────────────────────────

interface ImageAsset {
  id: string;
  name: string;
  dataUri: string;
  width: number;
  height: number;
}

interface FontAsset {
  family: string;
  loaded: boolean;
}

// Popular Google Fonts — subset for quick access
const POPULAR_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins',
  'Lato', 'Nunito', 'Raleway', 'Playfair Display', 'Source Code Pro',
  'JetBrains Mono', 'Fira Code', 'Space Grotesk', 'DM Sans', 'Outfit',
  'Sora', 'Manrope', 'Plus Jakarta Sans', 'Instrument Sans', 'Geist',
];

export function AssetManager() {
  const designSystem = useSceneStore(s => s.designSystem);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [fonts, setFonts] = useState<FontAsset[]>([]);
  const [activeTab, setActiveTab] = useState<'images' | 'fonts'>('images');
  const [fontSearch, setFontSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Upload image → data URI
  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUri = reader.result as string;
        const img = new Image();
        img.onload = () => {
          setImages(prev => [...prev, {
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            dataUri,
            width: img.width,
            height: img.height,
          }]);
        };
        img.src = dataUri;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, []);

  const handleCopyUri = useCallback((asset: ImageAsset) => {
    navigator.clipboard.writeText(asset.dataUri);
    setCopiedId(asset.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleCopyCss = useCallback((asset: ImageAsset) => {
    const css = `background-image: url('${asset.dataUri}'); background-size: cover; background-position: center;`;
    navigator.clipboard.writeText(css);
    setCopiedId(asset.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleRemoveImage = useCallback((id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  }, []);

  // Load Google Font
  const handleLoadFont = useCallback((family: string) => {
    if (fonts.some(f => f.family === family)) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700;800&display=swap`;
    document.head.appendChild(link);

    setFonts(prev => [...prev, { family, loaded: true }]);
  }, [fonts]);

  const handleCopyFontCss = useCallback((family: string) => {
    navigator.clipboard.writeText(`font-family: '${family}', sans-serif;`);
  }, []);

  const handleRemoveFont = useCallback((family: string) => {
    setFonts(prev => prev.filter(f => f.family !== family));
  }, []);

  const filteredFonts = fontSearch
    ? POPULAR_FONTS.filter(f => f.toLowerCase().includes(fontSearch.toLowerCase()))
    : POPULAR_FONTS;

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div className="panel-header">
        <span>Assets</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            className="toolbar__btn"
            style={{ fontSize: 10, padding: '2px 6px', background: activeTab === 'images' ? 'var(--accent-dim)' : undefined, color: activeTab === 'images' ? 'var(--accent)' : undefined }}
            onClick={() => setActiveTab('images')}
          >Img</button>
          <button
            className="toolbar__btn"
            style={{ fontSize: 10, padding: '2px 6px', background: activeTab === 'fonts' ? 'var(--accent-dim)' : undefined, color: activeTab === 'fonts' ? 'var(--accent)' : undefined }}
            onClick={() => setActiveTab('fonts')}
          >Fonts</button>
        </div>
      </div>

      {activeTab === 'images' && (
        <div style={{ padding: '8px 12px' }}>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleUpload} />
          <button className="toolbar__btn" style={{ width: '100%', fontSize: 10, padding: '4px 0' }} onClick={() => fileRef.current?.click()}>
            Upload Image
          </button>

          {images.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {images.map(img => (
                <div key={img.id} className="asset-item">
                  <div className="asset-item__thumb" style={{ backgroundImage: `url(${img.dataUri})` }} />
                  <div className="asset-item__info">
                    <div style={{ fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{img.width}×{img.height}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button className="asset-action" onClick={() => handleCopyCss(img)} title="Copy CSS">
                      {copiedId === img.id ? '✓' : 'CSS'}
                    </button>
                    <button className="asset-action" onClick={() => handleRemoveImage(img.id)} title="Remove">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {images.length === 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '8px 0', textAlign: 'center' }}>
              Upload images for use in designs
            </div>
          )}
        </div>
      )}

      {activeTab === 'fonts' && (
        <div style={{ padding: '8px 12px' }}>
          {/* Loaded fonts */}
          {fonts.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Loaded</div>
              {fonts.map(f => (
                <div key={f.family} className="asset-item">
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: `'${f.family}', sans-serif`, flex: 1 }}>{f.family}</span>
                  <button className="asset-action" onClick={() => handleCopyFontCss(f.family)} title="Copy CSS">CSS</button>
                  <button className="asset-action" onClick={() => handleRemoveFont(f.family)} title="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Search + quick access */}
          <input
            className="prop-input"
            placeholder="Search fonts..."
            value={fontSearch}
            onChange={e => setFontSearch(e.target.value)}
            style={{ width: '100%', fontSize: 10, marginBottom: 6 }}
          />
          <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filteredFonts.map(family => {
              const isLoaded = fonts.some(f => f.family === family);
              return (
                <div key={family} className="font-item" onClick={() => !isLoaded && handleLoadFont(family)}>
                  <span style={{ fontSize: 11, color: isLoaded ? 'var(--accent)' : 'var(--text-secondary)' }}>{family}</span>
                  {isLoaded ? (
                    <span style={{ fontSize: 9, color: 'var(--accent)' }}>✓</span>
                  ) : (
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Load</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Design system fonts */}
          {designSystem?.typography?.hierarchy && designSystem.typography.hierarchy.length > 0 && (
            <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>From Design System</div>
              {[...new Set(designSystem!.typography!.hierarchy.map(t => t.fontFamily).filter(Boolean))].map(family => {
                const isLoaded = fonts.some(f => f.family === family);
                return (
                  <div key={family} className="font-item" onClick={() => !isLoaded && handleLoadFont(family!)}>
                    <span style={{ fontSize: 11, color: 'var(--text-accent)' }}>{family}</span>
                    {!isLoaded && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Load</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
