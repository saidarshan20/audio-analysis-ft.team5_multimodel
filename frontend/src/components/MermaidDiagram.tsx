import React, { useEffect, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'Inter, sans-serif'
});

interface MermaidProps {
  chart: string;
}

const MermaidDiagram: React.FC<MermaidProps> = ({ chart }) => {
  const [svg, setSvg] = useState<string>('');
  
  // Create a safe, unique ID for mermaid to use during rendering
  const [id] = useState(() => `mermaid-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    let isMounted = true;
    const renderChart = async () => {
      try {
        if (!chart) return;
        // Suppress console errors on parse failures during swift updates
        const { svg: drawnSvg } = await mermaid.render(id, chart);
        if (isMounted) setSvg(drawnSvg);
      } catch (err) {
        console.error('Mermaid render error', err);
      }
    };
    renderChart();
    return () => { isMounted = false; };
  }, [chart, id]);

  return (
    <div 
      className="mermaid-wrapper" 
      style={{ overflowX: 'auto', display: 'flex', justifyContent: 'center', padding: '10px' }}
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  );
};

export default MermaidDiagram;
