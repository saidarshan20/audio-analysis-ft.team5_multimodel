import React, { useState, useMemo } from 'react';
import { 
  BarChart2, Table, Layout, Info, ArrowUpRight, 
  ArrowDownRight, Hash, Type, AlertCircle, TrendingUp,
  ChevronDown, ChevronUp, Download
} from 'lucide-react';
import { CSVAnalysisResult, ColumnStat, getChartDataTeam4, ChartDataResponse } from '../services';

interface Props {
  result: CSVAnalysisResult;
}

const CSVAnalysisView = ({ result }: Props) => {
  const [activeTab, setActiveTab] = useState<'stats' | 'preview' | 'visuals'>('stats');
  const [selectedColumn, setSelectedColumn] = useState<ColumnStat | null>(null);

  // Safely get columns
  const columns = result?.columns || [];

  // Visual Builder State
  const [xAxis, setXAxis] = useState<string>(columns[0] || '');
  const [yAxis, setYAxis] = useState<string>(columns[1] || columns[0] || '');
  const [chartType, setChartType] = useState<string>('bar');
  const [chartData, setChartData] = useState<ChartDataResponse | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  const stats = result.column_stats;

  const handleBuildChart = async () => {
    setChartLoading(true);
    try {
      const resp = await getChartDataTeam4(result.filename, xAxis, yAxis, chartType);
      setChartData(resp);
    } catch (e) {
      console.error("Chart build failed", e);
    } finally {
      setChartLoading(false);
    }
  };

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '0.6rem 1.25rem',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: active ? 'rgba(251, 140, 54, 0.2)' : 'transparent',
    color: active ? '#fb8c36' : '#64748b',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem', animation: 'fadeIn 0.5s ease-out' }}>
      
      {/* ── Summary Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div className="result-card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ background: 'rgba(251, 140, 54, 0.1)', color: '#fb8c36', padding: '10px', borderRadius: '12px' }}>
            <Table size={20} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Rows</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>{result.total_rows.toLocaleString()}</div>
          </div>
        </div>
        <div className="result-card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', padding: '10px', borderRadius: '12px' }}>
            <Layout size={20} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dimensions</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>{result.total_cols} Columns</div>
          </div>
        </div>
        <div className="result-card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ background: 'rgba(129, 140, 248, 0.1)', color: '#818cf8', padding: '10px', borderRadius: '12px' }}>
            <TrendingUp size={20} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>File Type</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>CSV / Excel</div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '6px', background: 'rgba(15, 23, 42, 0.8)', padding: '4px', borderRadius: '12px', width: 'fit-content', border: '1px solid rgba(255,255,255,0.05)' }}>
        <button style={TAB_STYLE(activeTab === 'stats')} onClick={() => setActiveTab('stats')}>
          <Info size={14} /> Insights & Stats
        </button>
        <button style={TAB_STYLE(activeTab === 'preview')} onClick={() => setActiveTab('preview')}>
          <Table size={14} /> Data Explorer
        </button>
        <button style={TAB_STYLE(activeTab === 'visuals')} onClick={() => setActiveTab('visuals')}>
          <BarChart2 size={14} /> Visual Builder
        </button>
      </div>

      {/* ── Content: Insights ── */}
      {activeTab === 'stats' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {stats.map((col, idx) => (
            <div 
              key={idx} 
              className="result-card" 
              style={{ 
                padding: '1.25rem', 
                border: selectedColumn?.name === col.name ? '1px solid #fb8c36' : '1px solid rgba(255,255,255,0.05)',
                transition: 'all 0.3s ease',
                cursor: 'pointer'
              }}
              onClick={() => setSelectedColumn(col)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {col.type === 'numeric' ? <Hash size={16} color="#fb8c36" /> : <Type size={16} color="#38bdf8" />}
                  <span style={{ fontWeight: 600, fontSize: '14px', color: 'inherit' }}>{col.name}</span>
                </div>
                <div style={{ fontSize: '10px', color: '#64748b', background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                  {col.type.toUpperCase()}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                <div>
                  <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Missing Values</div>
                  <div style={{ color: col.null_count > 0 ? '#ef4444' : '#16a34a', fontWeight: 600 }}>
                    {col.null_count} ({((col.null_count / result.total_rows) * 100).toFixed(1)}%)
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Unique Values</div>
                  <div style={{ fontWeight: 600 }}>{col.unique_count}</div>
                </div>
                {col.type === 'numeric' ? (
                  <>
                    <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>
                      <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Range (Min - Max)</div>
                      <div style={{ color: '#fb8c36', display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                        <span>{col.min}</span>
                        <span>{col.max}</span>
                      </div>
                      <div style={{ height: '4px', background: '#334155', borderRadius: '2px', marginTop: '4px', position: 'relative' }}>
                        <div style={{ position: 'absolute', left: '0', right: '0', height: '100%', background: 'linear-gradient(90deg, #fb8c36, #f97316)', borderRadius: '2px' }} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Top Category</div>
                    <div style={{ color: '#38bdf8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {col.top_category || 'N/A'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Content: Preview Table ── */}
      {activeTab === 'preview' && (
        <div className="result-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: '500px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#0f172a', borderBottom: '1px solid #1e293b', zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '12px 15px', color: '#94a3b8', width: '40px' }}>#</th>
                  {result.columns.map(col => (
                    <th key={col} style={{ padding: '12px 15px', color: '#f8fafc', fontWeight: 600, minWidth: '150px' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ background: 'rgba(30,41,59,0.3)' }}>
                {result.preview_rows.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.2s' }}>
                    <td style={{ padding: '10px 15px', color: '#475569', fontSize: '11px' }}>{idx + 1}</td>
                    {result.columns.map(col => (
                      <td key={col} style={{ padding: '10px 15px', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', background: '#0f172a', borderTop: '1px solid #1e293b', fontSize: '11px', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
            <span>Showing first 100 rows of {result.total_rows.toLocaleString()} total.</span>
            <span>{result.total_cols} Columns identified.</span>
          </div>
        </div>
      )}

      {/* ── Content: Visual Builder ── */}
      {activeTab === 'visuals' && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem' }}>
          <div className="result-card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1.25rem', color: '#fb8c36' }}>Chart Configuration</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>X-Axis (Dimension)</label>
                <select 
                  value={xAxis} 
                  onChange={(e) => setXAxis(e.target.value)}
                  style={{ width: '100%', background: 'transparent', color: 'inherit', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px', fontSize: '13px' }}
                >
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Y-Axis (Measure)</label>
                <select 
                  value={yAxis} 
                  onChange={(e) => setYAxis(e.target.value)}
                  style={{ width: '100%', background: 'transparent', color: 'inherit', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px', fontSize: '13px' }}
                >
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Chart Type</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {['Bar', 'Line', 'Area', 'Scatter', 'Pie', 'Histogram'].map(type => (
                    <button 
                      key={type}
                      onClick={() => setChartType(type.toLowerCase())}
                      style={{ 
                        padding: '8px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                        background: chartType === type.toLowerCase() ? 'rgba(251, 140, 54, 0.1)' : '#0f172a',
                        color: chartType === type.toLowerCase() ? '#fb8c36' : '#94a3b8',
                        border: `1px solid ${chartType === type.toLowerCase() ? '#fb8c36' : '#334155'}`,
                        transition: 'all 0.2s'
                      }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                onClick={handleBuildChart}
                disabled={chartLoading}
                style={{ 
                  marginTop: '1rem', padding: '12px', background: '#fb8c36', color: 'white', 
                  border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                }}
              >
                {chartLoading ? 'Generating...' : 'Update Chart'}
              </button>
            </div>
          </div>

          <div className="result-card" style={{ padding: '1.5rem', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
            {!chartData ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
                <BarChart2 size={48} strokeWidth={1} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <p style={{ fontSize: '14px' }}>Configure axes and click "Update Chart" to visualize data.</p>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: '16px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>{xAxis} vs {yAxis}</h4>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>{chartData.chart_type.toUpperCase()} • Showing snapshot of dataset</p>
                  </div>
                </div>
                
                <div style={{ flex: 1, position: 'relative', padding: '20px 0' }}>
                  {/* --- Simple CSS/SVG Bar Chart Implementation --- */}
                  <div style={{ height: '300px', width: '100%', display: 'flex', alignItems: 'flex-end', gap: '4px', paddingBottom: '30px', borderBottom: '1px solid #1e293b', borderLeft: '1px solid #1e293b' }}>
                    {chartData.data.slice(0, 50).map((item, idx) => {
                      const valX = item[xAxis] || item['count'] || idx;
                      const valY = Number(item[yAxis] || item['count'] || 0);
                      const maxVal = Math.max(...chartData.data.map(d => Number(d[yAxis] || d['count'] || 0))) || 1;
                      const heightPercent = Math.max(5, (valY / maxVal) * 100);

                      return (
                        <div 
                          key={idx} 
                          style={{ 
                            flex: 1, height: `${heightPercent}%`, background: 'linear-gradient(to top, #fb8c36, #f97316)', 
                            borderRadius: '2px 2px 0 0', position: 'relative',
                            transition: 'height 1s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                          }}
                          title={`${valX}: ${valY}`}
                        >
                          <div style={{ position: 'absolute', bottom: '-25px', left: '50%', transform: 'translateX(-50%) rotate(-45deg)', transformOrigin: 'top center', fontSize: '9px', color: '#64748b', width: 'max-content', whiteSpace: 'nowrap', opacity: idx % 5 === 0 ? 1 : 0 }}>
                            {String(valX).slice(0, 10)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                <div style={{ marginTop: 'auto', display: 'flex', gap: '20px', alignItems: 'center', fontSize: '12px', color: '#94a3b8' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '10px', height: '10px', background: '#fb8c36', borderRadius: '2px' }} />
                    Value Scale
                  </div>
                  <div style={{ marginLeft: 'auto' }}>
                    Processed {chartData.data.length} data points
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default CSVAnalysisView;
