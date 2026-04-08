import React, { useEffect, useState, useRef, useCallback } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'Inter, sans-serif',
});

interface MermaidProps {
  chart: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.12;

const MermaidDiagram: React.FC<MermaidProps> = ({ chart }) => {
  const [svg, setSvg]         = useState<string>('');
  const [id]                  = useState(() => `mermaid-${Math.random().toString(36).substr(2, 9)}`);
  const [playMode, setPlayMode] = useState(false);
  const [scale, setScale]     = useState(1);
  const [offset, setOffset]   = useState({ x: 0, y: 0 });
  const dragging  = useRef(false);
  const lastPos   = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let mounted = true;
    const render = async () => {
      if (!chart) return;
      try {
        const { svg: drawn } = await mermaid.render(id, chart);
        if (mounted) {
          setSvg(drawn);
          setScale(1);
          setOffset({ x: 0, y: 0 });
        }
      } catch (err) {
        console.error('Mermaid render error', err);
      }
    };
    render();
    return () => { mounted = false; };
  }, [chart, id]);

  // Exit play mode on Escape
  useEffect(() => {
    if (!playMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitPlay(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playMode]);

  const exitPlay = () => {
    setPlayMode(false);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!playMode) return;
    e.preventDefault();
    e.stopPropagation();
    setScale(s => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s - Math.sign(e.deltaY) * ZOOM_STEP)));
  }, [playMode]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!playMode) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [playMode]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  }, []);

  const stopDrag = useCallback(() => { dragging.current = false; }, []);

  if (!svg) return null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>

      {/* ── Top bar ── */}
      <div style={{
        position: 'absolute', top: 10, right: 12, zIndex: 20,
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        {playMode ? (
          <>
            <button onClick={() => setScale(s => Math.max(MIN_ZOOM, s - ZOOM_STEP))} style={iconBtn}>−</button>
            <span style={{ fontSize: 10, color: '#94a3b8', minWidth: 34, textAlign: 'center' }}>
              {Math.round(scale * 100)}%
            </span>
            <button onClick={() => setScale(s => Math.min(MAX_ZOOM, s + ZOOM_STEP))} style={iconBtn}>+</button>
            <button onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} style={{ ...textBtn, color: '#94a3b8' }}>
              Reset
            </button>
            <button onClick={exitPlay} style={{ ...textBtn, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}>
              ✕ Exit
            </button>
          </>
        ) : (
          <button
            onClick={() => setPlayMode(true)}
            style={{
              background: 'rgba(251,140,54,0.12)',
              border: '1px solid rgba(251,140,54,0.35)',
              color: '#fb8c36',
              borderRadius: 7,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            ⤢ Explore
          </button>
        )}
      </div>

      {/* ── Static overlay when not in play mode ── */}
      {!playMode && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          cursor: 'default',
        }} />
      )}

      {/* ── Hint when in play mode ── */}
      {playMode && (
        <div style={{
          position: 'absolute', bottom: 10, left: 14, zIndex: 20,
          fontSize: 10, color: '#475569', pointerEvents: 'none',
          background: 'rgba(2,6,23,0.7)', padding: '3px 8px', borderRadius: 4,
        }}>
          Scroll to zoom · Drag to pan · Esc to exit
        </div>
      )}

      {/* ── Canvas ── */}
      <div
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          cursor: playMode ? (dragging.current ? 'grabbing' : 'grab') : 'default',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: dragging.current ? 'none' : 'transform 0.08s ease-out',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
            minHeight: '100%',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
};

const iconBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#f1f5f9',
  borderRadius: 6,
  width: 26, height: 26,
  cursor: 'pointer',
  fontSize: 15,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0,
};

const textBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#94a3b8',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 11,
  cursor: 'pointer',
  fontWeight: 500,
};

export default MermaidDiagram;
