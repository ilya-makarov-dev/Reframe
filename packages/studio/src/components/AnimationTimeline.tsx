/**
 * Animation Timeline — tracks, keyframes, play/pause/scrub, preset picker.
 *
 * Visual timeline editor for ITimeline. Preview animations in canvas.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSceneStore } from '../store/scene';
import { listPresets, presets, stagger } from '@reframe/core/animation/presets';
import { computeDuration } from '@reframe/core/animation/timeline';
import type { ITimeline, INodeAnimation } from '@reframe/core/animation/types';

export function AnimationTimeline() {
  const {
    graph, rootId, timeline, setTimeline,
    animPlaying, setAnimPlaying, animTime, setAnimTime,
    selectedIds, exportAnimatedHtml, exportLottieJson,
  } = useSceneStore();
  const [showPresets, setShowPresets] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('fadeIn');
  const [presetDelay, setPresetDelay] = useState(0);
  const [presetDuration, setPresetDuration] = useState(600);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  const totalDuration = timeline ? computeDuration(timeline) : 0;
  const animCount = timeline?.animations.length ?? 0;

  // Play/pause animation loop
  useEffect(() => {
    if (!animPlaying || !timeline) return;
    startTimeRef.current = performance.now() - animTime;

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      const duration = computeDuration(timeline);
      if (elapsed >= duration && !timeline.loop) {
        setAnimPlaying(false);
        setAnimTime(duration);
        return;
      }
      setAnimTime(timeline.loop ? elapsed % duration : elapsed);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [animPlaying, timeline]);

  const handlePlayPause = useCallback(() => {
    if (!timeline) return;
    if (animPlaying) {
      setAnimPlaying(false);
    } else {
      if (animTime >= totalDuration) setAnimTime(0);
      setAnimPlaying(true);
    }
  }, [animPlaying, timeline, animTime, totalDuration]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    setAnimTime(t);
    setAnimPlaying(false);
  }, []);

  const handleAddPreset = useCallback(() => {
    if (!graph || !rootId || selectedIds.length === 0) return;
    const preset = presets[selectedPreset];
    if (!preset) return;

    const base = preset.create({ duration: presetDuration });
    const newAnims: INodeAnimation[] = selectedIds.map((id, i) => ({
      nodeId: id,
      nodeName: graph.getNode(id)?.name,
      name: selectedPreset,
      keyframes: base.keyframes,
      duration: base.duration,
      delay: presetDelay + i * 100,
      direction: base.direction,
      fillMode: base.fillMode ?? 'both',
    }));

    setTimeline({
      ...(timeline ?? { animations: [] }),
      animations: [...(timeline?.animations ?? []), ...newAnims],
    });
  }, [graph, rootId, selectedIds, selectedPreset, presetDelay, presetDuration, timeline]);

  const handleClearTimeline = useCallback(() => {
    setTimeline(null);
    setAnimTime(0);
    setAnimPlaying(false);
  }, []);

  const handleRemoveAnim = useCallback((index: number) => {
    if (!timeline) return;
    const anims = [...timeline.animations];
    anims.splice(index, 1);
    setTimeline(anims.length > 0 ? { ...timeline, animations: anims } : null);
  }, [timeline]);

  const handleExportHtml = useCallback(() => {
    const html = exportAnimatedHtml();
    if (!html) return;
    download('animated.html', html, 'text/html');
  }, [exportAnimatedHtml]);

  const handleExportLottie = useCallback(() => {
    const json = exportLottieJson();
    if (!json) return;
    download('animation.json', json, 'application/json');
  }, [exportLottieJson]);

  if (!graph || !rootId) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div className="panel-header">
        <span>
          Animation
          {animCount > 0 && (
            <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>
              {animCount} tracks · {(totalDuration / 1000).toFixed(1)}s
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setShowPresets(!showPresets)}>
            + Add
          </button>
          {timeline && (
            <>
              <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={handleExportHtml}>HTML</button>
              <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={handleExportLottie}>Lottie</button>
              <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--error)' }} onClick={handleClearTimeline}>Clear</button>
            </>
          )}
        </div>
      </div>

      {/* Preset picker */}
      {showPresets && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
            {selectedIds.length === 0 ? 'Select nodes first, then add animation' : `Animate ${selectedIds.length} node(s):`}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {listPresets().map(name => (
              <button
                key={name}
                className="toolbar__btn"
                style={{
                  fontSize: 9, padding: '2px 6px',
                  background: name === selectedPreset ? 'var(--accent)' : undefined,
                  color: name === selectedPreset ? '#fff' : undefined,
                  borderColor: name === selectedPreset ? 'var(--accent)' : undefined,
                }}
                onClick={() => setSelectedPreset(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
              Delay: <input className="prop-input prop-input--short" type="number" value={presetDelay} onChange={e => setPresetDelay(+e.target.value)} style={{ width: 50 }} />ms
            </label>
            <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
              Duration: <input className="prop-input prop-input--short" type="number" value={presetDuration} onChange={e => setPresetDuration(+e.target.value)} style={{ width: 50 }} />ms
            </label>
            <button
              className="toolbar__btn toolbar__btn--primary"
              style={{ fontSize: 10, padding: '3px 10px' }}
              onClick={handleAddPreset}
              disabled={selectedIds.length === 0}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Transport controls */}
      {timeline && (
        <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-subtle)' }}>
          <button
            onClick={handlePlayPause}
            style={{
              background: 'none', border: 'none', color: 'var(--text-primary)',
              cursor: 'pointer', fontSize: 16, padding: 0,
            }}
          >
            {animPlaying ? '⏸' : '▶'}
          </button>
          <input
            type="range" min={0} max={totalDuration} step={1}
            value={animTime}
            onChange={handleScrub}
            style={{ flex: 1, height: 4, accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 70, textAlign: 'right' }}>
            {(animTime / 1000).toFixed(2)}s / {(totalDuration / 1000).toFixed(1)}s
          </span>
        </div>
      )}

      {/* Animation tracks */}
      {timeline && (
        <div style={{ maxHeight: 120, overflowY: 'auto' }}>
          {timeline.animations.map((anim, i) => {
            const nodeName = anim.nodeName ?? anim.nodeId ?? '?';
            const delay = anim.delay ?? 0;
            const startPct = totalDuration > 0 ? (delay / totalDuration) * 100 : 0;
            const widthPct = totalDuration > 0 ? (anim.duration / totalDuration) * 100 : 100;

            return (
              <div key={i} style={{
                padding: '4px 12px', fontSize: 10,
                display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                <span style={{ color: 'var(--text-secondary)', minWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {nodeName}
                </span>
                <span style={{ color: 'var(--text-accent)', minWidth: 55 }}>
                  {anim.name ?? 'custom'}
                </span>

                {/* Mini timeline bar */}
                <div style={{
                  flex: 1, height: 12, background: 'var(--bg-input)',
                  borderRadius: 2, position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute',
                    left: `${startPct}%`,
                    width: `${Math.min(widthPct, 100 - startPct)}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    borderRadius: 2,
                    opacity: 0.6,
                  }} />
                </div>

                <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {anim.duration}ms
                </span>
                <button
                  onClick={() => handleRemoveAnim(i)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: 10, padding: '0 2px',
                  }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
