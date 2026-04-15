import { useRef, useEffect } from 'react';
import { SpectrogramData } from '../../services';

interface Props {
  spectrogram: SpectrogramData;
  currentTime: number;
  duration: number;
  title?: string;
}

const SpectrogramCanvas = ({ spectrogram, currentTime, duration, title = 'STFT Spectrogram' }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrogram) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const freqBins = spectrogram.magnitude_db.length;
    const timeBins = spectrogram.time_bins.length;
    const W = canvas.width, H = canvas.height;
    const cellW = W / timeBins, cellH = H / freqBins;
    for (let f = 0; f < freqBins; f++) {
      for (let t = 0; t < timeBins; t++) {
        const intensity = (spectrogram.magnitude_db[f][t] + 80) / 80;
        const r = Math.round(Math.min(255, intensity * 2   * 255));
        const g = Math.round(Math.min(255, intensity * 1.5 * 255));
        const b = Math.round(Math.max(0,   (1 - intensity * 2) * 255));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(t * cellW, (freqBins - 1 - f) * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
    if (duration > 0) {
      const x = (currentTime / duration) * W;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }, [spectrogram, currentTime, duration]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>
        {title}
      </h4>
      <canvas
        ref={canvasRef}
        width={300}
        height={160}
        style={{ width: '100%', height: '160px', borderRadius: '6px', imageRendering: 'pixelated' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginTop: '4px' }}>
        <span>0 Hz</span><span>↑ frequency axis</span>
      </div>
    </div>
  );
};

export default SpectrogramCanvas;
