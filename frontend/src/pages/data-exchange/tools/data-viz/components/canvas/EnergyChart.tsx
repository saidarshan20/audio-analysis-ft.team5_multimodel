import { useRef, useEffect } from 'react';
import { EnergyData } from '../../services';

interface Props {
  energy: EnergyData;
  currentTime: number;
}

const EnergyChart = ({ energy, currentTime }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !energy) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const n    = energy.rms_values.length;
    const barW = Math.max(1, W / n);
    for (let i = 0; i < n; i++) {
      const barH  = energy.rms_values[i] * H * 0.9;
      const played = energy.timestamps[i] <= currentTime;
      const alpha  = 0.4 + energy.rms_values[i] * 0.6;
      ctx.fillStyle = played
        ? `rgba(251,140,54,${alpha})`
        : `rgba(71,85,105,${alpha})`;
      ctx.fillRect((i / n) * W, H - barH, barW - 0.5, barH);
    }
  }, [energy, currentTime]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>
        RMS Energy
      </h4>
      <canvas
        ref={canvasRef}
        width={600}
        height={60}
        style={{ width: '100%', height: '60px', borderRadius: '6px', background: 'var(--bg-root)' }}
      />
    </div>
  );
};

export default EnergyChart;
