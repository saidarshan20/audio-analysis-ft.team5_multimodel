import React, { useState, useMemo } from 'react';
import {
  BarChart2, Table, Layout, Info,
  Hash, Type, TrendingUp
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  ScatterChart, Scatter, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts';
import { CSVAnalysisResult, ColumnStat, getChartDataTeam4, ChartDataResponse } from '../services';

interface Props {
  result: CSVAnalysisResult;
  isSample?: boolean;       // true when data comes from a catalog 500-row sample
  sampleOf?: number;        // original dataset total (if known)
}

const CHART_COLORS = ['#fb8c36', '#38bdf8', '#818cf8', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#f87171'];

// ── Tooltip shared style ────────────────────────────────────────────────────
const TooltipStyle: React.CSSProperties = {
  background: 'rgba(15,23,42,0.95)',
  border: '1px solid #334155',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#e2e8f0',
};

// ── Chart renderer — picks the right Recharts component per type ─────────────
const ChartRenderer = ({
  data, chartType, xAxis, yAxis,
}: {
  data: any[];
  chartType: string;
  xAxis: string;
  yAxis: string;
}) => {
  // Normalise — use all rows the backend sent (already capped server-side at 2000)
  const points = useMemo(() => {
    return data.map(item => ({
      ...item,
      _x: item[xAxis] ?? item['label'] ?? '',
      _y: Number(item[yAxis] ?? item['count'] ?? 0),
    }));
  }, [data, xAxis, yAxis]);

  const commonAxisProps = {
    tick: { fill: '#64748b', fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: '#1e293b' },
  };

  const gridProps = { stroke: '#1e293b', strokeDasharray: '3 3' };

  const tooltipProps = {
    contentStyle: TooltipStyle,
    itemStyle: { color: '#e2e8f0' },
    labelStyle: { color: '#94a3b8', marginBottom: 4 },
    cursor: { fill: 'rgba(255,255,255,0.04)' },
  };

  if (chartType === 'pie') {
    // Aggregate: group by _x, sum _y
    const aggregated: Record<string, number> = {};
    points.forEach(p => {
      const key = String(p._x).slice(0, 20);
      aggregated[key] = (aggregated[key] || 0) + p._y;
    });
    const pieData = Object.entries(aggregated)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([name, value]) => ({ name, value }));

    return (
      <ResponsiveContainer width="100%" height={340}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={120}
            innerRadius={40}
            paddingAngle={2}
            label={false}
            labelLine={false}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TooltipStyle} itemStyle={{ color: '#e2e8f0' }} />
          <Legend
            formatter={(value) => <span style={{ color: '#94a3b8', fontSize: 11 }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'scatter') {
    const scatterData = points.map(p => ({ x: Number(p._x) || 0, y: p._y }));
    return (
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="x" name={xAxis} {...commonAxisProps} label={{ value: xAxis, position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }} />
          <YAxis dataKey="y" name={yAxis} {...commonAxisProps} />
          <Tooltip {...tooltipProps} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={scatterData} fill="#fb8c36" opacity={0.8} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'histogram') {
    // Backend sends pre-binned data: { [xAxis]: "(1000, 5000]", count: 145 }
    // The bin key is the xAxis column name containing the interval string.
    const histData = data.map(d => ({
      label: String(d[xAxis] ?? d['label'] ?? d['bin'] ?? ''),
      count: Number(d['count'] ?? d[yAxis] ?? 0),
    }));

    return (
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={histData} margin={{ top: 10, right: 20, bottom: 40, left: 10 }} barCategoryGap="2%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...commonAxisProps} angle={-35} textAnchor="end" interval={0} />
          <YAxis {...commonAxisProps} />
          <Tooltip {...tooltipProps} />
          <Bar dataKey="count" fill="#fb8c36" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Bar / Line / Area — aggregate by _x, sum _y
  // Show up to 200 categories (backend already limits rows to 2000)
  const aggregated: Record<string, number> = {};
  points.forEach(p => {
    const key = String(p._x).slice(0, 30);
    aggregated[key] = (aggregated[key] || 0) + p._y;
  });
  const agg = Object.entries(aggregated)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200)
    .map(([name, value]) => ({ name, value }));

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={agg} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" {...commonAxisProps} angle={-35} textAnchor="end" interval={Math.floor(agg.length / 10)} />
          <YAxis {...commonAxisProps} />
          <Tooltip {...tooltipProps} />
          <Line type="monotone" dataKey="value" stroke="#fb8c36" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'area') {
    return (
      <ResponsiveContainer width="100%" height={340}>
        <AreaChart data={agg} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#fb8c36" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#fb8c36" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" {...commonAxisProps} angle={-35} textAnchor="end" interval={Math.floor(agg.length / 10)} />
          <YAxis {...commonAxisProps} />
          <Tooltip {...tooltipProps} />
          <Area type="monotone" dataKey="value" stroke="#fb8c36" fill="url(#areaGrad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // Default: Bar
  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={agg} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...commonAxisProps} angle={-35} textAnchor="end" interval={Math.floor(agg.length / 10)} />
        <YAxis {...commonAxisProps} />
        <Tooltip {...tooltipProps} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {agg.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const CSVAnalysisView = ({ result, isSample = false, sampleOf }: Props) => {
  const [activeTab, setActiveTab] = useState<'stats' | 'preview' | 'visuals'>('stats');
  const [selectedColumn, setSelectedColumn] = useState<ColumnStat | null>(null);

  const columns = result?.columns || [];
  const numericCols = result.column_stats.filter(c => c.type === 'numeric').map(c => c.name);

  const [xAxis, setXAxis] = useState<string>(columns[0] || '');
  const [yAxis, setYAxis] = useState<string>(numericCols[0] || columns[1] || columns[0] || '');
  const [chartType, setChartType] = useState<string>('bar');
  const [chartData, setChartData] = useState<ChartDataResponse | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const stats = result.column_stats;

  const handleBuildChart = async () => {
    setChartLoading(true);
    setChartError(null);
    try {
      const resp = await getChartDataTeam4(result.filename, xAxis, yAxis, chartType);
      setChartData(resp);
    } catch (e: any) {
      setChartError(e.message || 'Chart generation failed');
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

      {/* ── Sample Warning Banner ── */}
      {isSample && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '12px',
          padding: '12px 16px', borderRadius: '10px',
          background: 'rgba(251, 191, 36, 0.08)',
          border: '1px solid rgba(251, 191, 36, 0.25)',
        }}>
          <span style={{ fontSize: '18px', lineHeight: 1 }}>⚠️</span>
          <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
            <strong style={{ color: '#fbbf24' }}>Sample analysis — not the full dataset.</strong>
            <span style={{ color: '#94a3b8', marginLeft: '6px' }}>
              Stats and charts are based on {result.total_rows.toLocaleString()} sampled rows
              {sampleOf ? ` of ~${sampleOf.toLocaleString()} total` : ' from the data.gov.in catalog'}.
              Download the full dataset for authoritative analysis.
            </span>
          </div>
        </div>
      )}

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
            <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Numeric Cols</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>{numericCols.length}</div>
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

      {/* ── Insights & Stats ── */}
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
                cursor: 'pointer',
              }}
              onClick={() => setSelectedColumn(col)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {col.type === 'numeric' ? <Hash size={16} color="#fb8c36" /> : <Type size={16} color="#38bdf8" />}
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{col.name}</span>
                </div>
                <div style={{ fontSize: '10px', color: '#64748b', background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                  {col.type.toUpperCase()}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                <div>
                  <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Missing</div>
                  <div style={{ color: col.null_count > 0 ? '#ef4444' : '#16a34a', fontWeight: 600 }}>
                    {col.null_count} ({((col.null_count / result.total_rows) * 100).toFixed(1)}%)
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Unique</div>
                  <div style={{ fontWeight: 600 }}>{col.unique_count.toLocaleString()}</div>
                </div>
                {col.type === 'numeric' ? (
                  <>
                    <div>
                      <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Mean</div>
                      <div style={{ color: '#818cf8', fontWeight: 600 }}>{col.mean !== null ? Number(col.mean).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Std Dev</div>
                      <div style={{ fontWeight: 600 }}>{col.std_dev !== null ? Number(col.std_dev).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
                    </div>
                    <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>
                        <span>Min: {col.min}</span><span>Max: {col.max}</span>
                      </div>
                      <div style={{ height: '4px', background: '#334155', borderRadius: '2px', position: 'relative' }}>
                        <div style={{ position: 'absolute', left: 0, right: 0, height: '100%', background: 'linear-gradient(90deg, #fb8c36, #f97316)', borderRadius: '2px' }} />
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

      {/* ── Data Explorer ── */}
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
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '10px 15px', color: '#475569', fontSize: '11px' }}>{idx + 1}</td>
                    {result.columns.map(col => (
                      <td key={col} style={{ padding: '10px 15px', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                        {row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', background: '#0f172a', borderTop: '1px solid #1e293b', fontSize: '11px', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <span>Preview: first {result.preview_rows.length} of {result.total_rows.toLocaleString()} rows · {result.total_cols} columns</span>
            <span style={{ color: '#475569' }}>Charts use up to 2,000 rows from backend · Stats computed on full data</span>
          </div>
        </div>
      )}

      {/* ── Visual Builder ── */}
      {activeTab === 'visuals' && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem' }}>
          {/* Config panel */}
          <div className="result-card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1.25rem', color: '#fb8c36', marginTop: 0 }}>Chart Configuration</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>X-Axis (Dimension)</label>
                <select
                  value={xAxis}
                  onChange={e => setXAxis(e.target.value)}
                  style={{ width: '100%', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '8px', padding: '8px', fontSize: '13px' }}
                >
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Y-Axis (Measure)</label>
                <select
                  value={yAxis}
                  onChange={e => setYAxis(e.target.value)}
                  style={{ width: '100%', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '8px', padding: '8px', fontSize: '13px' }}
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
                        background: chartType === type.toLowerCase() ? 'rgba(251, 140, 54, 0.15)' : '#0f172a',
                        color: chartType === type.toLowerCase() ? '#fb8c36' : '#94a3b8',
                        border: `1px solid ${chartType === type.toLowerCase() ? '#fb8c36' : '#334155'}`,
                        transition: 'all 0.2s',
                        fontWeight: chartType === type.toLowerCase() ? 600 : 400,
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
                  marginTop: '0.5rem', padding: '12px', background: chartLoading ? '#334155' : '#fb8c36',
                  color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600,
                  cursor: chartLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'background 0.2s',
                }}
              >
                {chartLoading ? 'Generating…' : 'Build Chart'}
              </button>
            </div>
          </div>

          {/* Chart display */}
          <div className="result-card" style={{ padding: '1.5rem', minHeight: '420px', display: 'flex', flexDirection: 'column' }}>
            {!chartData && !chartError && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#475569', gap: '12px' }}>
                <BarChart2 size={48} strokeWidth={1} style={{ opacity: 0.4 }} />
                <p style={{ fontSize: '14px', margin: 0 }}>Pick axes and a chart type, then click <strong style={{ color: '#fb8c36' }}>Build Chart</strong>.</p>
              </div>
            )}

            {chartError && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#f87171', gap: '8px' }}>
                <p style={{ fontSize: '14px', margin: 0 }}>Chart failed: {chartError}</p>
                <button onClick={handleBuildChart} style={{ fontSize: '12px', color: '#fb8c36', background: 'none', border: '1px solid #fb8c36', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer' }}>Retry</button>
              </div>
            )}

            {chartData && (
              <>
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
                      {xAxis} {chartType !== 'histogram' && chartType !== 'pie' ? `vs ${yAxis}` : ''}
                    </h4>
                    <p style={{ fontSize: '11px', color: '#64748b', margin: '3px 0 0 0' }}>
                      {chartType.toUpperCase()} · {chartData.data.length.toLocaleString()} rows from backend
                      {isSample && <span style={{ color: '#fbbf24', marginLeft: 6 }}>· sample only</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => setChartData(null)}
                    style={{ background: 'none', border: '1px solid #334155', color: '#64748b', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                  >
                    Reset
                  </button>
                </div>

                <ChartRenderer
                  data={chartData.data}
                  chartType={chartType}
                  xAxis={xAxis}
                  yAxis={yAxis}
                />
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default CSVAnalysisView;
