import { useRef, useEffect } from 'react';
import { WaveformData } from '../../services';

interface Props {
  waveform: WaveformData;
  currentTime: number;
  duration: number;
}

const WaveformCanvas = ({ waveform, currentTime, duration }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const n     = waveform.amplitudes.length;
    const midY  = H / 2;
    const barW  = Math.max(1, W / n);
    const progress = duration > 0 ? currentTime / duration : 0;
    for (let i = 0; i < n; i++) {
      const amp  = Math.abs(waveform.amplitudes[i]);
      const barH = amp * midY * 0.9;
      const played = i / n <= progress;
      ctx.fillStyle = played ? '#818cf8' : '#334155';
      ctx.fillRect((i / n) * W, midY - barH, barW - 0.5, barH * 2);
    }

    // Draw playhead line
    if (duration > 0) {
      const x = progress * W;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }, [waveform, currentTime, duration]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>
        Waveform (normalized)
      </h4>
      <canvas
        ref={canvasRef}
        width={600}
        height={80}
        style={{ width: '100%', height: '80px', borderRadius: '6px', background: '#020617' }}
      />
    </div>
  );
};

export default WaveformCanvas;
