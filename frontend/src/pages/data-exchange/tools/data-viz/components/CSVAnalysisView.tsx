import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  BarChart2,
  Table,
  Layout,
  Info,
  Hash,
  Type,
  TrendingUp,
  BarChart3,
  LineChart as LineIcon,
  AreaChart as AreaIcon,
  ScatterChart as ScatterIcon,
  PieChart as PieIcon,
  LayoutTemplate,
  Download,
  Sparkles,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getChartDataTeam4, getVisualIdeasTeam4 } from '../services';
import type { CSVAnalysisResult, ColumnStat, VisualIdea } from '../services';
import './CSVAnalysisView.css';

interface Props {
  result: CSVAnalysisResult;
  isSample?: boolean;
  sampleOf?: number;
}

type ViewTab = 'stats' | 'preview' | 'visuals';
type ChartType = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'histogram';
type AggType = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'median';

const CHART_COLORS = ['#fb8c36', '#38bdf8', '#818cf8', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#f87171'];

const CHART_TYPES: { id: ChartType; label: string; icon: React.ReactNode }[] = [
  { id: 'bar', label: 'Bar', icon: <BarChart3 size={16} /> },
  { id: 'line', label: 'Line', icon: <LineIcon size={16} /> },
  { id: 'area', label: 'Area', icon: <AreaIcon size={16} /> },
  { id: 'scatter', label: 'Scatter', icon: <ScatterIcon size={16} /> },
  { id: 'pie', label: 'Pie', icon: <PieIcon size={16} /> },
  { id: 'histogram', label: 'Histogram', icon: <LayoutTemplate size={16} /> },
];

const AGG_OPTIONS: { value: AggType; label: string; color: string }[] = [
  { value: 'sum', label: 'Sum', color: '#fb8c36' },
  { value: 'avg', label: 'Average', color: '#3b82f6' },
  { value: 'count', label: 'Count', color: '#10b981' },
  { value: 'min', label: 'Min', color: '#8b5cf6' },
  { value: 'max', label: 'Max', color: '#f43f5e' },
  { value: 'median', label: 'Median', color: '#eab308' },
];

const TooltipStyle: React.CSSProperties = {
  background: 'rgba(15,23,42,0.95)',
  border: '1px solid #334155',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#e2e8f0',
};

function aggregateByXKey(raw: any[], xKey: string, yKey: string, aggType: AggType): any[] {
  if (!raw.length || !xKey || !yKey) return [];

  const groups = new Map<string, number[]>();
  for (const row of raw) {
    const key = String(row[xKey] ?? row.label ?? '');
    const val = Number(row[yKey] ?? row.value ?? row.count);
    if (!Number.isNaN(val)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(val);
    }
  }

  return Array.from(groups.entries()).map(([label, values]) => {
    const sum = values.reduce((a, b) => a + b, 0);
    const count = values.length;
    const avg = sum / count;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const computed: Record<AggType, number> = { sum, avg, count, min, max, median };

    return { [xKey]: label, [yKey]: computed[aggType] };
  });
}

function computeAggregations(data: any[], yKey: string) {
  const values = data.map(d => Number(d[yKey])).filter(v => !Number.isNaN(v));
  if (!values.length) return null;

  const count = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / count;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return { sum, avg, count, min, max, median };
}

function formatAggValue(value: number | null | undefined): string {
  const n = Number(value);
  if (value == null || Number.isNaN(n)) return '-';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}

const ChartRenderer = ({
  data,
  chartType,
  xAxis,
  yAxis,
}: {
  data: any[];
  chartType: ChartType;
  xAxis: string;
  yAxis: string;
}) => {
  const points = useMemo(() => {
    return data.map(item => ({
      ...item,
      _x: item[xAxis] ?? item.label ?? '',
      _y: Number(item[yAxis] ?? item.value ?? item.count ?? 0),
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
    const pieData = points
      .map(p => ({ name: String(p._x).slice(0, 24), value: Number(p._y) }))
      .filter(p => !Number.isNaN(p.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 16);

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
            innerRadius={42}
            paddingAngle={2}
            label={false}
            labelLine={false}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TooltipStyle} itemStyle={{ color: '#e2e8f0' }} />
          <Legend formatter={value => <span style={{ color: '#94a3b8', fontSize: 11 }}>{value}</span>} />
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
          <XAxis
            dataKey="x"
            name={xAxis}
            {...commonAxisProps}
            label={{ value: xAxis, position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis dataKey="y" name={yAxis} {...commonAxisProps} />
          <Tooltip {...tooltipProps} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={scatterData} fill="#fb8c36" opacity={0.85} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'histogram') {
    const histData = points.map(p => ({
      label: String(p._x),
      count: Number(p._y),
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

  const compact = points
    .map(p => ({ name: String(p._x).slice(0, 30), value: Number(p._y) }))
    .filter(p => !Number.isNaN(p.value))
    .slice(0, 200);

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={compact} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" {...commonAxisProps} angle={-35} textAnchor="end" interval={Math.floor(compact.length / 10)} />
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
        <AreaChart data={compact} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
          <defs>
            <linearGradient id="csvv-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#fb8c36" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#fb8c36" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" {...commonAxisProps} angle={-35} textAnchor="end" interval={Math.floor(compact.length / 10)} />
          <YAxis {...commonAxisProps} />
          <Tooltip {...tooltipProps} />
          <Area type="monotone" dataKey="value" stroke="#fb8c36" fill="url(#csvv-area-grad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={compact} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...commonAxisProps} angle={-35} textAnchor="end" interval={Math.floor(compact.length / 10)} />
        <YAxis {...commonAxisProps} />
        <Tooltip {...tooltipProps} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {compact.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

const CSVAnalysisView = ({ result, isSample = false, sampleOf }: Props) => {
  const [activeTab, setActiveTab] = useState<ViewTab>('stats');
  const [selectedColumn, setSelectedColumn] = useState<ColumnStat | null>(null);

  const columns = result?.columns || [];
  const stats = result?.column_stats || [];

  const numericCols = useMemo(
    () => stats.filter(c => c.type === 'numeric').map(c => c.name),
    [stats],
  );
  const categoricalCols = useMemo(
    () => stats.filter(c => c.type === 'categorical').map(c => c.name),
    [stats],
  );

  const [xAxis, setXAxis] = useState<string>('');
  const [yAxis, setYAxis] = useState<string>('');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [aggregationType, setAggregationType] = useState<AggType>('sum');
  const [rawChartData, setRawChartData] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [aiIdeas, setAiIdeas] = useState<VisualIdea[]>([]);
  const [aiIdeasLoading, setAiIdeasLoading] = useState(false);
  const [aiIdeasError, setAiIdeasError] = useState<string | null>(null);
  const [aiIdeasProvider, setAiIdeasProvider] = useState<string>('');
  const chartCanvasRef = useRef<HTMLDivElement>(null);
  const applyingIdeaRef = useRef(false);

  const activeAgg = AGG_OPTIONS.find(o => o.value === aggregationType)!;

  useEffect(() => {
    if (!columns.length) return;
    if (applyingIdeaRef.current) {
      applyingIdeaRef.current = false;
      return;
    }

    if (chartType === 'scatter') {
      const sx = numericCols[0] || columns[0];
      const sy = numericCols[1] || numericCols[0] || columns[1] || columns[0];
      setXAxis(sx);
      setYAxis(sy);
      return;
    }

    if (chartType === 'histogram') {
      const histCol = numericCols[0] || columns[0];
      setXAxis(histCol);
      setYAxis(histCol);
      return;
    }

    const defaultX = categoricalCols[0] || columns[0];
    const defaultY = numericCols[0] || columns[1] || columns[0];
    setXAxis(defaultX);
    setYAxis(defaultY);
  }, [chartType, columns, numericCols, categoricalCols]);

  useEffect(() => {
    setRawChartData([]);
    setChartError(null);
    setAiIdeas([]);
    setAiIdeasError(null);
    setAiIdeasProvider('');
  }, [result.filename]);

  const displayData = useMemo(() => {
    if (chartType === 'scatter' || chartType === 'histogram') return rawChartData;
    return aggregateByXKey(rawChartData, xAxis, yAxis, aggregationType);
  }, [rawChartData, chartType, xAxis, yAxis, aggregationType]);

  const aggregatedSummary = useMemo(
    () => computeAggregations(displayData, yAxis),
    [displayData, yAxis],
  );

  const xAxisOptions = chartType === 'scatter'
    ? (numericCols.length ? numericCols : columns)
    : (categoricalCols.length ? categoricalCols : columns);

  const yAxisOptions = numericCols.length ? numericCols : columns;

  const buildChart = async (opts?: { nextChartType?: ChartType; nextXAxis?: string; nextYAxis?: string }) => {
    const selectedChartType = opts?.nextChartType ?? chartType;
    const selectedXAxis = opts?.nextXAxis ?? xAxis;
    const selectedYAxis = opts?.nextYAxis ?? yAxis;

    if (!selectedXAxis || !selectedYAxis) {
      setChartError('Please choose axis columns first.');
      return;
    }

    setChartLoading(true);
    setChartError(null);

    try {
      if (selectedChartType === 'histogram') {
        const resp = await getChartDataTeam4(result.filename, selectedYAxis, selectedYAxis, selectedChartType);
        const histogramData = (resp.data || []).map((row: any) => ({
          [selectedYAxis]: row[selectedYAxis] ?? row[resp.x_axis] ?? row.label ?? row.bin ?? '',
          count: Number(row.count ?? 0),
        }));
        setXAxis(selectedYAxis);
        setRawChartData(histogramData);
      } else {
        const resp = await getChartDataTeam4(result.filename, selectedXAxis, selectedYAxis, selectedChartType);
        setRawChartData(resp.data || []);
      }
    } catch (e: any) {
      setChartError(e.message || 'Chart generation failed');
      setRawChartData([]);
    } finally {
      setChartLoading(false);
    }
  };

  const handleBuildChart = async () => {
    await buildChart();
  };

  const handleGetAIVisualIdeas = async () => {
    setAiIdeasLoading(true);
    setAiIdeasError(null);
    try {
      const resp = await getVisualIdeasTeam4(result.filename, 4);
      setAiIdeas(resp.ideas || []);
      setAiIdeasProvider(resp.provider || '');
      if (resp.warning) {
        setAiIdeasError(resp.warning);
      }
    } catch (e: any) {
      setAiIdeas([]);
      setAiIdeasProvider('');
      setAiIdeasError(e.message || 'Failed to fetch AI visual ideas.');
    } finally {
      setAiIdeasLoading(false);
    }
  };

  const handleApplyVisualIdea = async (idea: VisualIdea) => {
    applyingIdeaRef.current = true;
    setChartType(idea.chart_type as ChartType);
    setAggregationType(idea.aggregation as AggType);
    setXAxis(idea.x_axis);
    setYAxis(idea.y_axis);
    await buildChart({
      nextChartType: idea.chart_type as ChartType,
      nextXAxis: idea.x_axis,
      nextYAxis: idea.y_axis,
    });
  };

  const downloadChart = useCallback(() => {
    const container = chartCanvasRef.current;
    if (!container) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 420;

    const cloned = svg.cloneNode(true) as SVGSVGElement;
    cloned.setAttribute('width', String(width));
    cloned.setAttribute('height', String(height));

    const serialized = new XMLSerializer().serializeToString(cloned);
    const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }

      ctx.scale(scale, scale);
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      const link = document.createElement('a');
      const stem = result.filename.replace(/\.[^.]+$/, '');
      link.download = `${stem}_${chartType}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = url;
  }, [result.filename, chartType]);

  return (
    <div className="csvv-root">
      {isSample && (
        <div className="csvv-warning-banner">
          <span className="csvv-warning-icon">!</span>
          <div className="csvv-warning-text">
            <strong>Analysis capped at 100,000 rows.</strong>
            <span>
              Stats and charts are based on the first {result.total_rows.toLocaleString()} rows fetched.
              {sampleOf ? ` Full dataset has ~${sampleOf.toLocaleString()} rows.` : ''}
              {' '}Use the full dataset download for complete records.
            </span>
          </div>
        </div>
      )}

      <div className="csvv-summary-grid">
        <div className="result-card csvv-summary-card">
          <div className="csvv-summary-icon csvv-summary-icon--orange"><Table size={20} /></div>
          <div>
            <div className="csvv-summary-label">Total Rows</div>
            <div className="csvv-summary-value">{result.total_rows.toLocaleString()}</div>
          </div>
        </div>
        <div className="result-card csvv-summary-card">
          <div className="csvv-summary-icon csvv-summary-icon--blue"><Layout size={20} /></div>
          <div>
            <div className="csvv-summary-label">Dimensions</div>
            <div className="csvv-summary-value">{result.total_cols} Columns</div>
          </div>
        </div>
        <div className="result-card csvv-summary-card">
          <div className="csvv-summary-icon csvv-summary-icon--violet"><TrendingUp size={20} /></div>
          <div>
            <div className="csvv-summary-label">Numeric Cols</div>
            <div className="csvv-summary-value">{numericCols.length}</div>
          </div>
        </div>
      </div>

      <div className="csvv-tab-strip">
        <button className={`csvv-tab-btn ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => setActiveTab('stats')}>
          <Info size={14} /> Insights & Stats
        </button>
        <button className={`csvv-tab-btn ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => setActiveTab('preview')}>
          <Table size={14} /> Data Explorer
        </button>
        <button className={`csvv-tab-btn ${activeTab === 'visuals' ? 'active' : ''}`} onClick={() => setActiveTab('visuals')}>
          <BarChart2 size={14} /> Visual Builder
        </button>
      </div>

      {activeTab === 'stats' && (
        <div className="csvv-stats-grid">
          {stats.map(col => (
            <div
              key={col.name}
              className={`result-card csvv-col-card ${selectedColumn?.name === col.name ? 'selected' : ''}`}
              onClick={() => setSelectedColumn(col)}
            >
              <div className="csvv-col-header">
                <div className="csvv-col-title-wrap">
                  {col.type === 'numeric' ? <Hash size={16} color="#fb8c36" /> : <Type size={16} color="#38bdf8" />}
                  <span className="csvv-col-title">{col.name}</span>
                </div>
                <span className={`csvv-type-badge csvv-type-badge--${col.type}`}>{col.type}</span>
              </div>

              <div className="csvv-metrics-grid">
                <div>
                  <div className="csvv-metric-label">Missing</div>
                  <div className={`csvv-metric-value ${col.null_count > 0 ? 'is-bad' : 'is-good'}`}>
                    {col.null_count} ({((col.null_count / result.total_rows) * 100).toFixed(1)}%)
                  </div>
                </div>
                <div>
                  <div className="csvv-metric-label">Unique</div>
                  <div className="csvv-metric-value">{col.unique_count.toLocaleString()}</div>
                </div>

                {col.type === 'numeric' ? (
                  <>
                    <div>
                      <div className="csvv-metric-label">Mean</div>
                      <div className="csvv-metric-value is-blue">
                        {col.mean !== null ? Number(col.mean).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="csvv-metric-label">Std Dev</div>
                      <div className="csvv-metric-value">
                        {col.std_dev !== null ? Number(col.std_dev).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                      </div>
                    </div>
                    <div className="csvv-range-wrap">
                      <div className="csvv-range-meta">
                        <span>Min: {col.min ?? '-'}</span>
                        <span>Max: {col.max ?? '-'}</span>
                      </div>
                      <div className="csvv-range-track">
                        <div className="csvv-range-fill" />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="csvv-top-category">
                    <div className="csvv-metric-label">Top Category</div>
                    <div className="csvv-top-category-value">{col.top_category || 'N/A'}</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'preview' && (
        <div className="result-card csvv-table-card">
          <div className="csvv-table-scroll">
            <table className="csvv-table">
              <thead>
                <tr>
                  <th className="csvv-row-id">#</th>
                  {result.columns.map(col => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.preview_rows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="csvv-row-id">{idx + 1}</td>
                    {result.columns.map(col => (
                      <td key={col} title={String(row[col] ?? '')}>{row[col]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="csvv-table-footer">
            <span>Preview: first {result.preview_rows.length} of {result.total_rows.toLocaleString()} rows | {result.total_cols} columns</span>
            <span>Charts use backend-sampled rows | Stats are from full analyzed data</span>
          </div>
        </div>
      )}

      {activeTab === 'visuals' && (
        <div className="csvv-viz-layout">
          <div className="result-card csvv-config-card">
            <h3 className="csvv-config-title">Chart Configuration</h3>

            <button className="csvv-ai-ideas-btn" onClick={handleGetAIVisualIdeas} disabled={aiIdeasLoading}>
              <Sparkles size={15} />
              {aiIdeasLoading ? 'Generating Visual Ideas...' : 'Get AI Visual Ideas'}
            </button>

            {aiIdeasError && (
              <div className="csvv-ai-ideas-note csvv-ai-ideas-note--warn">{aiIdeasError}</div>
            )}

            {aiIdeas.length > 0 && (
              <div className="csvv-ai-ideas-list">
                <div className="csvv-ai-ideas-head">
                  <span>Suggested by {aiIdeasProvider || 'AI'}</span>
                  <span>{aiIdeas.length} ideas</span>
                </div>
                {aiIdeas.map((idea, idx) => (
                  <div key={`${idea.title}-${idx}`} className="csvv-ai-idea-card">
                    <h5>{idea.title}</h5>
                    <p>{idea.insight}</p>
                    <div className="csvv-ai-idea-meta">
                      <span>{idea.chart_type.toUpperCase()}</span>
                      <span>{idea.x_axis} → {idea.y_axis}</span>
                      <span>{idea.aggregation.toUpperCase()}</span>
                    </div>
                    <button onClick={() => handleApplyVisualIdea(idea)} disabled={chartLoading}>
                      Apply Idea
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="csvv-config-group">
              <label className="csvv-label">
                Chart Type
              </label>
              <div className="csvv-chart-type-grid">
                {CHART_TYPES.map(type => (
                  <button
                    key={type.id}
                    onClick={() => setChartType(type.id)}
                    className={`csvv-chart-type-btn ${chartType === type.id ? 'active' : ''}`}
                  >
                    {type.icon}
                    <span>{type.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {chartType !== 'histogram' && (
              <div className="csvv-config-group">
                <label className="csvv-label">
                  X-Axis
                  <span className={`csvv-axis-badge ${chartType === 'scatter' ? 'numeric' : 'categorical'}`}>
                    {chartType === 'scatter' ? 'numeric' : 'categorical'}
                  </span>
                </label>
                <select className="csvv-select" value={xAxis} onChange={e => setXAxis(e.target.value)}>
                  {xAxisOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            <div className="csvv-config-group">
              <label className="csvv-label">
                Y-Axis
                <span className="csvv-axis-badge numeric">numeric</span>
              </label>
              <select className="csvv-select" value={yAxis} onChange={e => setYAxis(e.target.value)}>
                {yAxisOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {rawChartData.length > 0 && chartType !== 'scatter' && chartType !== 'histogram' && (
              <div className="csvv-config-group">
                <div className="csvv-agg-divider"><span>Aggregation</span></div>
                <select
                  className="csvv-select csvv-agg-select"
                  value={aggregationType}
                  onChange={e => setAggregationType(e.target.value as AggType)}
                  style={{ borderColor: activeAgg.color, color: activeAgg.color }}
                >
                  {AGG_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {aggregatedSummary && (
                  <div className="csvv-agg-preview" style={{ borderColor: `${activeAgg.color}66`, background: `${activeAgg.color}12` }}>
                    <span>
                      {activeAgg.label} of <strong>{yAxis}</strong>
                    </span>
                    <strong style={{ color: activeAgg.color }}>{formatAggValue(aggregatedSummary[aggregationType])}</strong>
                  </div>
                )}
              </div>
            )}

            <button className="csvv-build-btn" onClick={handleBuildChart} disabled={chartLoading}>
              {chartLoading ? 'Generating...' : 'Build Chart'}
            </button>
          </div>

          <div className="csvv-viz-main">
            <div className="result-card csvv-chart-card">
              <div className="csvv-chart-header">
                <div>
                  <h4>{CHART_TYPES.find(t => t.id === chartType)?.label}</h4>
                  <p>
                    {chartType === 'histogram'
                      ? `Distribution of ${yAxis}`
                      : `${activeAgg.label} of ${yAxis} across ${xAxis}`}
                    {' '}| {result.filename}
                  </p>
                </div>
                {!chartLoading && !chartError && displayData.length > 0 && (
                  <button className="csvv-download-btn" onClick={downloadChart}>
                    <Download size={14} /> Download PNG
                  </button>
                )}
              </div>

              <div className="csvv-chart-canvas" ref={chartCanvasRef}>
                {!rawChartData.length && !chartLoading && !chartError && (
                  <div className="csvv-chart-placeholder">
                    <BarChart2 size={46} />
                    <p>Pick axes and click <strong>Build Chart</strong>.</p>
                  </div>
                )}

                {chartError && (
                  <div className="csvv-chart-error">
                    <p>Chart failed: {chartError}</p>
                    <button onClick={handleBuildChart}>Retry</button>
                  </div>
                )}

                {chartLoading && <div className="csvv-chart-loading">Generating chart...</div>}

                {!chartLoading && !chartError && displayData.length > 0 && (
                  <ChartRenderer data={displayData} chartType={chartType} xAxis={xAxis} yAxis={chartType === 'histogram' ? 'count' : yAxis} />
                )}
              </div>
            </div>

            {!chartLoading && !chartError && (
              <div className="result-card csvv-processed-card">
                <div className="csvv-processed-header">
                  <div>
                    <h4>Visualization Data</h4>
                    <p>
                      Processed values for {chartType === 'histogram' ? yAxis : xAxis} and {chartType === 'histogram' ? 'count' : yAxis}
                    </p>
                  </div>
                  <span style={{ color: activeAgg.color, borderColor: `${activeAgg.color}66`, background: `${activeAgg.color}14` }}>
                    {displayData.length} {chartType === 'histogram' ? 'BINS' : 'GROUPS'}
                  </span>
                </div>
                <div className="csvv-processed-body">
                  {displayData.length === 0 ? (
                    <div className="csvv-processed-empty">
                      Build a chart or apply an AI idea to populate visualization rows.
                    </div>
                  ) : (
                    <table className="csvv-table">
                      <thead>
                        <tr>
                          <th>{chartType === 'histogram' ? yAxis : xAxis}</th>
                          <th className="csvv-right">
                            {chartType === 'histogram' ? 'Count' : `${aggregationType.toUpperCase()}(${yAxis})`}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayData.map((row, idx) => (
                          <tr key={`${row[xAxis] ?? row[yAxis]}-${idx}`}>
                            <td>{row[chartType === 'histogram' ? yAxis : xAxis]}</td>
                            <td className="csvv-right csvv-bold" style={{ color: activeAgg.color }}>
                              {formatAggValue(Number(row[chartType === 'histogram' ? 'count' : yAxis]))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CSVAnalysisView;
