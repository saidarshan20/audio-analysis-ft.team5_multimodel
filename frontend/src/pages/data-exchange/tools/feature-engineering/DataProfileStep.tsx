import { useMemo, useState, useEffect } from 'react';
import FeatureSelectDropdown from './FeatureSelectDropdown';
import { AlertCircle, ChevronLeft, ChevronRight, Database, TrendingUp, BarChart2, Info } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip as PieTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as BarTooltip, Legend, Treemap
} from 'recharts';

type DatasetInfo = {
  name: string;
  rows: number;
  columns: number;
};

type ProfileColumnDetail = {
  column: string;
  dtype: string;
  unique: number;
  missing: number;
  mean?: number;
  median?: number;
  std?: number;
  min?: number;
  max?: number;
  skew?: number;
  outlier_percent?: number;
  missing_percent?: number;
  sample_values?: string[];
  q1?: number;
  q3?: number;
  outlier_count?: number;
  dominance_ratio?: number;
  mode?: number;
};

type ProfilePayload = {
  overview?: {
    rows: number;
    columns: number;
    missing_percent: number;
    memory_mb: number;
  };
  types?: {
    numeric: number;
    categorical: number;
    datetime: number;
  };
  quality?: {
    completeness: number;
    feature_richness: number;
  };
  column_details?: ProfileColumnDetail[];
  distributions?: Record<string, { type: 'numeric' | 'categorical'; hist?: number[]; bins?: number[]; categories?: string[]; counts?: number[]; mean?: number; median?: number }>;
  correlation?: Record<string, Record<string, number>>;
  missing_correlation?: Record<string, Record<string, number>>;
  target_column?: string;
};

type DataProfileStepProps = {
  onNext: () => void;
  onPrev: () => void;
  data?: Record<string, unknown>;
  datasetInfo?: DatasetInfo;
};

type ProfileTab = 'Overview' | 'Feature Analysis' | 'Missing Values' | 'Column Details';

/* ─── Reusable: Inline Box Plot ─────────────────────────────────────────── */
const SimpleBoxPlot = ({ min, q1, median, q3, max, width = 200, height = 24 }: { min?: number; q1?: number; median?: number; q3?: number; max?: number; width?: number; height?: number }) => {
  if (min === undefined || max === undefined) return <div style={{ width, height, background: 'var(--surface-muted)', borderRadius: 4 }} title="Data unavailable" />;
  const range = max - min;
  if (range === 0) return <div style={{ width, height, display: 'flex', alignItems: 'center' }}><div style={{ width: 4, height: 16, background: '#3b82f6' }} /></div>;
  // Clamp q1, median, q3 within [min, max] to prevent overflow
  const safeQ1 = Math.max(min, Math.min(max, q1 ?? min));
  const safeQ3 = Math.max(min, Math.min(max, q3 ?? max));
  const safeMed = Math.max(min, Math.min(max, median ?? min));
  const toPercent = (val: number) => `${((val - min) / range) * 100}%`;
  const iqrWidth = ((safeQ3 - safeQ1) / range) * 100;
  return (
    <div style={{ position: 'relative', width, height, display: 'flex', alignItems: 'center' }}>
      {/* Whisker line from min to max */}
      <div style={{ position: 'absolute', height: 2, background: '#9ca3af', left: '0%', width: '100%' }} />
      {/* Min cap */}
      <div style={{ position: 'absolute', width: 2, height: 12, background: '#9ca3af', left: '0%' }} />
      {/* Max cap */}
      <div style={{ position: 'absolute', width: 2, height: 12, background: '#9ca3af', right: '0%' }} />
      {/* IQR box */}
      <div style={{ position: 'absolute', height: 10, background: 'rgba(59,130,246,0.25)', border: '1px solid #3b82f6', borderRadius: 2, left: toPercent(safeQ1), width: `${iqrWidth}%` }} title={`Q1: ${q1}, Q3: ${q3}`} />
      {/* Median line */}
      <div style={{ position: 'absolute', width: 2, height: 12, background: '#1d4ed8', left: toPercent(safeMed) }} title={`Median: ${median}`} />
    </div>
  );
};

/* ─── Reusable: Section Card wrapper ────────────────────────────────────── */
const SectionCard = ({ title, subtitle, helpTip, children, style = {} }: { title: string; subtitle?: string; helpTip?: string; children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', marginBottom: '32px', ...style }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: subtitle ? '4px' : '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <h4 style={{ fontWeight: 600, fontSize: '18px', margin: 0 }}>{title}</h4>
        {helpTip && (
          <div style={{ position: 'relative', display: 'inline-flex' }} className="xt-fe-tooltip-wrapper">
            <Info size={16} color="var(--primary, #fb8c36)" style={{ cursor: 'pointer', flexShrink: 0 }} />
            <div className="xt-fe-tooltip-panel">
              {helpTip}
            </div>
          </div>
        )}
      </div>
    </div>
    {subtitle && <p className="text-muted text-sm" style={{ marginBottom: '16px' }}>{subtitle}</p>}
    {children}
  </div>
);

const DataProfileStep = ({ onNext, onPrev, data, datasetInfo }: DataProfileStepProps) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>('Overview');
  const [selectedDistCol, setSelectedDistCol] = useState('');
  const [chartView, setChartView] = useState<string>('Histogram');
  const [distGlobalTab, setDistGlobalTab] = useState<string>('outliers');
  const [gcSearching, setGcSearching] = useState(false);
  const [gcQuery, setGcQuery] = useState('');

  const payload = (data ?? {}) as ProfilePayload;
  const info = datasetInfo ?? { name: 'Dataset', rows: 0, columns: 0 };

  const overview = payload.overview ?? {
    rows: info.rows,
    columns: info.columns,
    missing_percent: 0,
    memory_mb: 0,
  };

  const types = payload.types ?? { numeric: 0, categorical: 0, datetime: 0 };
  const quality = payload.quality ?? { completeness: 0, feature_richness: 0 };
  const columns = payload.column_details ?? [];

  // Target column resolved from backend AI detection
  const targetColumn = payload.target_column ?? null;
  const targetColDetail = columns.find((c) => c.column === targetColumn);

  const numericCols = useMemo(
    () => columns.filter((col) => col.dtype.includes('int') || col.dtype.includes('float')),
    [columns]
  );
  const categoricalCols = useMemo(
    () => columns.filter((col) => !col.dtype.includes('int') && !col.dtype.includes('float')),
    [columns]
  );

  useEffect(() => {
    if (!selectedDistCol && columns.length > 0) {
      const firstCol = columns[0];
      setSelectedDistCol(firstCol.column);
      const isNum = firstCol.dtype.includes('int') || firstCol.dtype.includes('float');
      setChartView(isNum ? 'Histogram' : 'Pie Chart');
    }
  }, [columns, selectedDistCol]);

  const skewData = numericCols.map((c) => ({ name: c.column, skew: c.skew || 0 }));

  const distDataRaw = selectedDistCol ? payload.distributions?.[selectedDistCol] : undefined;
  const selectedColDetail = columns.find((col) => col.column === selectedDistCol);

  let distChartData: any[] = [];
  if (distDataRaw) {
    if (distDataRaw.type === 'numeric' && distDataRaw.hist && distDataRaw.bins) {
      distChartData = distDataRaw.hist.map((count, i) => ({
        range: `${distDataRaw.bins![i]?.toFixed(1) ?? '0'} - ${distDataRaw.bins![i + 1]?.toFixed(1) ?? '0'}`,
        count,
      }));
    } else if (distDataRaw.type === 'categorical' && distDataRaw.categories && distDataRaw.counts) {
      distChartData = distDataRaw.categories.map((cat, i) => ({
        name: cat,
        count: distDataRaw.counts![i] ?? 0,
      }));
    }
  }

  const featureScaleData = numericCols.map((c) => ({
    name: c.column,
    min: c.min ?? 0,
    max: c.max ?? 0,
    range: (c.max ?? 0) - (c.min ?? 0),
  }));

  const variabilityData = numericCols
    .filter((c) => c.mean && c.mean !== 0)
    .map((c) => ({
      name: c.column,
      cv: Math.abs(((c.std ?? 0) / c.mean!) * 100),
    }));

  const completenessData = columns.map((c) => ({
    name: c.column,
    complete: overview.rows > 0 ? Math.round(((overview.rows - c.missing) / overview.rows) * 100 * 100) / 100 : 100,
    dtype: c.dtype,
  }));

  // Pie chart data
  const pieChartData = [
    { name: 'Numeric', value: types.numeric, color: '#8b5cf6' },
    { name: 'Categorical', value: types.categorical, color: '#3b82f6' },
    ...(types.datetime > 0 ? [{ name: 'Datetime', value: types.datetime, color: '#10b981' }] : []),
  ].filter((i) => i.value > 0);

  return (
    <div>
      <div className="card text-center mb-8">
        <h2 className="mb-4" style={{ fontSize: '24px', fontWeight: 'bold' }}>
          Dataset Profile
        </h2>
        <p className="text-muted mb-8 text-sm">Comprehensive analysis of your dataset structure and quality</p>

        <div style={{ display: 'grid', gridTemplateColumns: targetColumn ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: '24px', marginBottom: '32px' }}>
          <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '12px', textAlign: 'left' }}>
            <p className="text-sm text-muted mb-2">Total Rows</p>
            <h3 style={{ fontSize: '28px', fontWeight: 'bold' }}>{overview.rows}</h3>
          </div>
          <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '12px', textAlign: 'left' }}>
            <p className="text-sm text-muted mb-2">Total Columns</p>
            <h3 style={{ fontSize: '28px', fontWeight: 'bold' }}>{overview.columns}</h3>
          </div>
          <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '12px', textAlign: 'left' }}>
            <p className="text-sm text-muted mb-2">Missing Data</p>
            <h3 style={{ fontSize: '28px', fontWeight: 'bold' }}>{overview.missing_percent.toFixed(2)}%</h3>
          </div>
          {targetColumn && (
            <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '12px', textAlign: 'left' }}>
              <p className="text-sm text-muted mb-2" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Target Column
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '28px', fontWeight: 'bold', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={targetColumn}>
                  {targetColumn}
                </h3>
                {targetColDetail && (
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px',
                    background: targetColDetail.dtype.includes('int') || targetColDetail.dtype.includes('float') ? 'rgba(59,130,246,0.12)' : 'rgba(16,185,129,0.12)',
                    color: targetColDetail.dtype.includes('int') || targetColDetail.dtype.includes('float') ? '#3b82f6' : '#10b981',
                    border: targetColDetail.dtype.includes('int') || targetColDetail.dtype.includes('float') ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(16,185,129,0.2)',
                  }}>
                    {targetColDetail.dtype}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '32px' }}>
          {(['Overview', 'Feature Analysis', 'Missing Values', 'Column Details'] as ProfileTab[]).map((tab) => (
            <div
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '12px 16px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                color: activeTab === tab ? 'var(--text-main)' : 'var(--text-muted)',
                borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
              }}
            >
              {tab}
            </div>
          ))}
        </div>

        {activeTab === 'Overview' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', textAlign: 'left' }}>
                <h4 style={{ fontWeight: 600, fontSize: '18px', marginBottom: '4px' }}>Column Type Distribution</h4>
                <p className="text-muted text-sm mb-8">Breakdown of column data types in your dataset</p>

                <div style={{ height: '200px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieChartData} innerRadius={0} outerRadius={80} dataKey="value">
                        {pieChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <PieTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '16px' }}>
                  {pieChartData.map((item) => (
                    <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color }} />
                      {item.name}: {item.value}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', textAlign: 'left' }}>
                <h4 style={{ fontWeight: 600, fontSize: '18px', marginBottom: '4px' }}>Data Health Score</h4>
                <p className="text-muted text-sm mb-8">Overall dataset quality metrics</p>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Data Completeness
                    <div style={{ position: 'relative', display: 'inline-flex' }} className="xt-fe-tooltip-wrapper">
                      <Info size={14} color="var(--primary, #fb8c36)" style={{ cursor: 'pointer', flexShrink: 0 }} />
                      <div className="xt-fe-tooltip-panel">
                        Percentage of available (non-missing) data points across the entire dataset.
                      </div>
                    </div>
                  </span>
                  <span>{quality.completeness.toFixed(1)}%</span>
                </div>
                <div style={{ height: '12px', borderRadius: '6px', backgroundColor: 'rgba(251,140,54,0.18)', marginBottom: '24px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${quality.completeness}%`, backgroundColor: 'var(--primary)', transition: 'width 0.5s' }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Feature Richness
                    <div style={{ position: 'relative', display: 'inline-flex' }} className="xt-fe-tooltip-wrapper">
                      <Info size={14} color="var(--primary, #fb8c36)" style={{ cursor: 'pointer', flexShrink: 0 }} />
                      <div className="xt-fe-tooltip-panel">
                        The proportion of numeric features in the dataset. A higher percentage typically provides richer quantitative signals for machine learning algorithms.
                      </div>
                    </div>
                  </span>
                  <span>{quality.feature_richness.toFixed(1)}%</span>
                </div>
                <div style={{ height: '12px', borderRadius: '6px', backgroundColor: 'rgba(59,130,246,0.18)', marginBottom: '0px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${quality.feature_richness}%`, backgroundColor: '#3b82f6', transition: 'width 0.5s' }} />
                </div>
              </div>
            </div>

            <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', textAlign: 'left', marginBottom: '32px' }}>
              <h4 style={{ fontWeight: 600, fontSize: '18px', marginBottom: '4px' }}>Dataset Memory Footprint</h4>
              <p className="text-muted text-sm mb-6">Estimated memory consumption by data types</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
                  <Database color="var(--primary)" size={32} style={{ margin: '0 auto 12px' }} />
                  <div style={{ fontWeight: 'bold', fontSize: '24px' }}>{overview.memory_mb.toFixed(2)} MB</div>
                  <div className="text-muted text-sm">Estimated Size</div>
                </div>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
                  <TrendingUp color="#3b82f6" size={32} style={{ margin: '0 auto 12px' }} />
                  <div style={{ fontWeight: 'bold', fontSize: '24px' }}>{types.numeric}</div>
                  <div className="text-muted text-sm">Numeric Features</div>
                </div>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
                  <BarChart2 color="#10b981" size={32} style={{ margin: '0 auto 12px' }} />
                  <div style={{ fontWeight: 'bold', fontSize: '24px' }}>{types.categorical}</div>
                  <div className="text-muted text-sm">Categorical Features</div>
                </div>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
                  <AlertCircle color="#f59e0b" size={32} style={{ margin: '0 auto 12px' }} />
                  <div style={{ fontWeight: 'bold', fontSize: '24px' }}>{columns.filter((col) => col.missing > 0).length}</div>
                  <div className="text-muted text-sm">Columns w/ Missing</div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'Feature Analysis' && (() => {
          const globalCharts = [
            { id: 'outliers', label: 'Outlier Detection (Box Plot)' },
            { id: 'skewness', label: 'Data Symmetry (Skewness)' },
            ...(featureScaleData.length > 0 ? [{ id: 'scale', label: 'Feature Scale Comparison' }] : []),
            ...(variabilityData.length > 0 ? [{ id: 'variability', label: 'Variability (CV)' }] : []),
            ...(categoricalCols.length > 0 ? [{ id: 'dominance', label: 'Category Dominance' }] : []),
            ...(categoricalCols.length > 0 ? [{ id: 'cardinality', label: 'Cardinality' }] : []),
            { id: 'correlations', label: 'Correlations' },
          ];
          const gcIdx = Math.max(0, globalCharts.findIndex(t => t.id === distGlobalTab));
          const activeGC = globalCharts[gcIdx] ?? globalCharts[0];
          const goPrev = () => setDistGlobalTab(globalCharts[(gcIdx - 1 + globalCharts.length) % globalCharts.length].id);
          const goNext = () => setDistGlobalTab(globalCharts[(gcIdx + 1) % globalCharts.length].id);
          return (
            <div style={{ textAlign: 'left' }}>
              <SectionCard
                title=" Explore Individual Features"
                subtitle="Use the dropdown to select any feature and see how its values are spread across the dataset."
                helpTip="This chart changes based on the feature you select. For numbers, it shows a histogram (how many rows fall into each value range). For categories, it shows a bar chart of how often each category appears."
              >
                <div className="fe-select-wrapper" style={{ marginBottom: '16px' }}>
                  <span className="fe-select-label">Select a feature:</span>
                  <FeatureSelectDropdown
                    value={selectedDistCol}
                    onChange={(val) => {
                      setSelectedDistCol(val);
                      const isNum = numericCols.some(c => c.column === val);
                      setChartView(isNum ? 'Histogram' : 'Bar Chart');
                    }}
                    groups={[
                      { label: 'Numeric Features', options: numericCols.map(c => c.column) },
                      { label: 'Categorical Features', options: categoricalCols.map(c => c.column) },
                    ]}
                  />
                </div>

                {/* ── Chart type scroller ── */}
                {distDataRaw && (() => {
                  const numericViews = ['Histogram', 'Bell Curve', 'Box Plot'];
                  const catViews = ['Bar Chart'];
                  if (distDataRaw.categories && distDataRaw.categories.length > 0) {
                    catViews.push('Text Length');
                  }
                  const views = distDataRaw.type === 'numeric' ? numericViews : catViews;
                  const activeView = views.includes(chartView) ? chartView : views[0];
                  return (
                    <div className="fe-chart-scroller-wrap">
                      {views.map((v) => (
                        <button
                          key={v}
                          className={`fe-chart-scroll-btn${activeView === v ? ' active' : ''}`}
                          onClick={() => setChartView(v)}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {distDataRaw ? (
                  <div style={{ display: 'flex', gap: '24px' }}>
                    <div style={{ flex: 3, padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', height: '350px' }}>
                      {/* ── Histogram ── */}
                      {distDataRaw.type === 'numeric' && chartView === 'Histogram' && (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={distChartData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                            <XAxis dataKey="range" tick={{ fontSize: 10 }} label={{ value: 'Value Range (grouped into bins)', position: 'insideBottom', offset: -25, fontSize: 12 }} />
                            <YAxis label={{ value: 'Number of Rows', angle: -90, position: 'insideLeft', offset: -5, fontSize: 12 }} />
                            <BarTooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)' }} formatter={(value: any) => [`${value} rows`, 'Row Count']} />
                            <Bar dataKey="count" fill="var(--primary)" name="Row Count" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}

                      {/* ── Bell Curve (skewness) ── */}
                      {distDataRaw.type === 'numeric' && chartView === 'Bell Curve' && selectedColDetail && selectedColDetail.skew !== undefined && (() => {
                        const skewVal = selectedColDetail.skew!;
                        const absSkew = Math.abs(skewVal);
                        const skewColor = absSkew < 0.5 ? '#10b981' : absSkew < 1 ? '#f59e0b' : '#ef4444';
                        const clampedSkew = Math.max(-3, Math.min(3, skewVal));
                        const svgW = 500, svgH = 260;
                        const pad = { left: 40, right: 24, top: 20, bottom: 36 };
                        const plotW = svgW - pad.left - pad.right;
                        const plotH = svgH - pad.top - pad.bottom;
                        const baseY = pad.top + plotH;
                        const xStart = pad.left, xEnd = pad.left + plotW;
                        const dataMin = selectedColDetail.min ?? 0;
                        const dataMax = selectedColDetail.max ?? 1;
                        const dataRange = dataMax - dataMin || 1;
                        const valToX = (v: number) => xStart + ((v - dataMin) / dataRange) * plotW;
                        let modeVal = selectedColDetail.mode;
                        if ((modeVal === undefined || modeVal === null) && distDataRaw.hist && distDataRaw.bins) {
                          const maxIdx = distDataRaw.hist.indexOf(Math.max(...distDataRaw.hist));
                          modeVal = (distDataRaw.bins[maxIdx] + distDataRaw.bins[maxIdx + 1]) / 2;
                        }
                        const peakX = (modeVal !== undefined && modeVal !== null)
                          ? Math.max(xStart + 15, Math.min(xEnd - 15, valToX(modeVal)))
                          : xStart + plotW / 2;
                        const skewFactor = Math.max(-0.9, Math.min(0.9, clampedSkew * 0.25));
                        const leftSpread = peakX - xStart;
                        const rightSpread = xEnd - peakX;
                        const leftCpFactor = 0.4 - skewFactor * 0.15;
                        const rightCpFactor = 0.4 + skewFactor * 0.15;
                        const peakY = pad.top + 5;
                        const curvePath = `M ${xStart},${baseY} C ${xStart + leftSpread * (0.3 - skewFactor * 0.1)},${baseY} ${peakX - leftSpread * leftCpFactor},${peakY + 5} ${peakX},${peakY} C ${peakX + rightSpread * rightCpFactor},${peakY + 5} ${xEnd - rightSpread * (0.3 + skewFactor * 0.1)},${baseY} ${xEnd},${baseY}`;
                        const meanX = valToX(selectedColDetail.mean ?? 0);
                        const medianX = valToX(selectedColDetail.median ?? 0);
                        const modeX = (modeVal !== undefined && modeVal !== null) ? valToX(modeVal) : null;
                        const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ val: dataMin + f * dataRange, x: xStart + f * plotW }));
                        return (
                          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" height="100%" style={{ overflow: 'visible', maxHeight: 260 }}>
                              <line x1={xStart} y1={pad.top} x2={xStart} y2={baseY} stroke="var(--border-color)" strokeWidth="1" />
                              <line x1={xStart} y1={baseY} x2={xEnd} y2={baseY} stroke="var(--border-color)" strokeWidth="1" />
                              {xTicks.map((t, i) => (
                                <g key={i}>
                                  <line x1={t.x} y1={baseY} x2={t.x} y2={baseY + 4} stroke="var(--border-color)" strokeWidth="1" />
                                  <text x={t.x} y={baseY + 14} textAnchor="middle" fontSize="9" fill="#9ca3af">{t.val.toFixed(1)}</text>
                                </g>
                              ))}
                              <text x={xStart + plotW / 2} y={svgH - 2} textAnchor="middle" fontSize="10" fill="#9ca3af">Value</text>
                              <text x={pad.left - 10} y={pad.top + plotH / 2} textAnchor="middle" fontSize="9" fill="#9ca3af" transform={`rotate(-90, ${pad.left - 10}, ${pad.top + plotH / 2})`}>Density</text>
                              <path d={curvePath} fill={`${skewColor}18`} stroke={skewColor} strokeWidth="2.5" />
                              <line x1={meanX} y1={pad.top} x2={meanX} y2={baseY} stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="6 3" />
                              <text x={meanX} y={pad.top - 5} textAnchor="middle" fontSize="9" fill="#8b5cf6" fontWeight="600">Mean</text>
                              <line x1={medianX} y1={pad.top} x2={medianX} y2={baseY} stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="6 3" />
                              <text x={medianX} y={pad.top - 5} textAnchor={medianX > meanX + 20 ? 'middle' : medianX < meanX ? 'end' : 'start'} fontSize="9" fill="#3b82f6" fontWeight="600">Median</text>
                              {modeX !== null && (
                                <>
                                  <line x1={modeX} y1={pad.top} x2={modeX} y2={baseY} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 2" />
                                  <text x={modeX} y={baseY + 26} textAnchor="middle" fontSize="9" fill="#f59e0b" fontWeight="600">Mode</text>
                                </>
                              )}
                            </svg>
                            <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 14, height: 2, background: '#8b5cf6', display: 'inline-block' }} /> Mean ({selectedColDetail.mean?.toFixed(2)})</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 14, height: 2, background: '#3b82f6', display: 'inline-block' }} /> Median ({selectedColDetail.median?.toFixed(2)})</span>
                              {modeVal !== undefined && modeVal !== null && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 14, height: 2, background: '#f59e0b', display: 'inline-block' }} /> Mode ({(modeVal as number).toFixed(2)})</span>}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── Box Plot (numeric) ── */}
                      {distDataRaw.type === 'numeric' && chartView === 'Box Plot' && selectedColDetail && (() => {
                        const c = selectedColDetail;
                        const min = c.min ?? 0, max = c.max ?? 1, q1 = c.q1 ?? min, q3 = c.q3 ?? max, med = c.median ?? (min + max) / 2;
                        const range = max - min || 1;
                        const svgW = 500, svgH = 160;
                        const padL = 60, padR = 40, padT = 30, padB = 30;
                        const plotW = svgW - padL - padR;
                        const toX = (v: number) => padL + ((v - min) / range) * plotW;
                        const midY = padT + (svgH - padT - padB) / 2;
                        const boxH = 36;
                        return (
                          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" style={{ maxHeight: 160, overflow: 'visible' }}>
                              {/* Whisker line */}
                              <line x1={toX(min)} y1={midY} x2={toX(max)} y2={midY} stroke="#9ca3af" strokeWidth="2" />
                              {/* Min cap */}
                              <line x1={toX(min)} y1={midY - 14} x2={toX(min)} y2={midY + 14} stroke="#9ca3af" strokeWidth="2" />
                              {/* Max cap */}
                              <line x1={toX(max)} y1={midY - 14} x2={toX(max)} y2={midY + 14} stroke="#9ca3af" strokeWidth="2" />
                              {/* IQR box */}
                              <rect x={toX(q1)} y={midY - boxH / 2} width={toX(q3) - toX(q1)} height={boxH} fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth="2" rx="3" />
                              {/* Median line */}
                              <line x1={toX(med)} y1={midY - boxH / 2} x2={toX(med)} y2={midY + boxH / 2} stroke="#1d4ed8" strokeWidth="2.5" />
                              {/* Labels */}
                              <text x={toX(min)} y={midY + boxH / 2 + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">Min {min.toFixed(1)}</text>
                              <text x={toX(q1)} y={midY - boxH / 2 - 6} textAnchor="middle" fontSize="10" fill="#3b82f6">Q1 {q1.toFixed(1)}</text>
                              <text x={toX(med)} y={midY + boxH / 2 + 16} textAnchor="middle" fontSize="10" fill="#1d4ed8">Median {med.toFixed(1)}</text>
                              <text x={toX(q3)} y={midY - boxH / 2 - 6} textAnchor="middle" fontSize="10" fill="#3b82f6">Q3 {q3.toFixed(1)}</text>
                              <text x={toX(max)} y={midY + boxH / 2 + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">Max {max.toFixed(1)}</text>
                            </svg>
                          </div>
                        );
                      })()}

                      {/* ── Categorical Bar Chart ── */}
                      {distDataRaw.type === 'categorical' && chartView === 'Bar Chart' && (() => {
                        const BAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6'];
                        const data = distChartData.map((d: any, i: number) => ({ name: d.name, count: d.count, fill: BAR_COLORS[i % BAR_COLORS.length] }));
                        return (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data} layout="vertical" margin={{ top: 20, right: 30, left: 30, bottom: 40 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                              <XAxis type="number" label={{ value: 'Count', position: 'insideBottom', offset: -25, fontSize: 12 }} />
                              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                              <BarTooltip formatter={(value: any) => [`${value} rows`, 'Count']} contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)' }} />
                              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                {data.map((entry: any, index: number) => (
                                  <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        );
                      })()}

                      {/* ── Text Length ── */}
                      {distDataRaw.type === 'categorical' && chartView === 'Text Length' && (() => {
                        const textLengths = distDataRaw.text_lengths && distDataRaw.text_lengths.length > 0
                          ? distDataRaw.text_lengths
                          : distDataRaw.categories.map((c: string) => String(c).length);

                        const lengthData = distDataRaw.categories.map((cat: string, i: number) => ({
                          name: cat,
                          avgLength: textLengths[i]
                        }));
                        return (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={lengthData} layout="vertical" margin={{ top: 20, right: 30, left: 30, bottom: 40 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                              <XAxis type="number" label={{ value: 'Average Character Length', position: 'insideBottom', offset: -25, fontSize: 12 }} />
                              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                              <BarTooltip formatter={(value: any) => [`${value} chars`, 'Avg Length']} contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)' }} />
                              <Bar dataKey="avgLength" name="Avg String Length" fill="#10b981" radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                    <div style={{ flex: 1, padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--surface-soft)' }}>
                      <h5 style={{ fontWeight: 600, marginBottom: '16px' }}>Quick Stats for "{selectedDistCol}"</h5>
                      {distDataRaw.type === 'numeric' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Average (Mean)</span><span style={{ fontWeight: 500 }}>{distDataRaw.mean?.toFixed(2) ?? 0}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Middle Value (Median)</span><span style={{ fontWeight: 500 }}>{distDataRaw.median?.toFixed(2) ?? 0}</span></div>
                          {selectedColDetail && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Smallest Value</span><span style={{ fontWeight: 500 }}>{selectedColDetail.min?.toFixed(2) ?? 0}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Largest Value</span><span style={{ fontWeight: 500 }}>{selectedColDetail.max?.toFixed(2) ?? 0}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Spread (Std Dev)</span><span style={{ fontWeight: 500 }}>{selectedColDetail.std?.toFixed(2) ?? 0}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Skewness</span><span style={{ fontWeight: 500 }}>{selectedColDetail.skew?.toFixed(2) ?? 0}</span></div>
                            </>
                          )}
                          <p className="text-xs text-muted mt-2" style={{ lineHeight: '1.5' }}>If the Average and Middle Value are far apart, the data is "skewed" — meaning some extreme values are pulling the average in one direction.</p>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
                          {selectedColDetail && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="text-muted">Most Common Value</span>
                                <span title={String(selectedColDetail.mode || 'N/A')} style={{
                                  fontWeight: 600,
                                  maxWidth: '140px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  textAlign: 'right',
                                  backgroundColor: 'var(--surface)',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-color)',
                                  fontSize: '13px'
                                }}>
                                  "{String(selectedColDetail.mode || 'N/A')}"
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                                <span className="text-muted">Text Consistency</span>
                                <span style={{
                                  fontWeight: 600,
                                  fontSize: '11px',
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  backgroundColor: (selectedColDetail.has_whitespace_issues || selectedColDetail.has_mixed_case) ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                  color: (selectedColDetail.has_whitespace_issues || selectedColDetail.has_mixed_case) ? '#f59e0b' : '#10b981',
                                  border: `1px solid ${(selectedColDetail.has_whitespace_issues || selectedColDetail.has_mixed_case) ? '#f59e0b' : '#10b981'}`
                                }}>
                                  {(selectedColDetail.has_whitespace_issues || selectedColDetail.has_mixed_case) ? 'INCONSISTENT' : 'CLEAN'}
                                </span>
                              </div>
                            </>
                          )}



                          {selectedColDetail && selectedColDetail.dominance_ratio && selectedColDetail.dominance_ratio > 0.9 && (
                            <div style={{ marginTop: '12px', padding: '8px', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: '6px', border: '1px solid #f59e0b' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f59e0b', fontSize: '11px', fontWeight: 600 }}>
                                <AlertCircle size={14} /> Stability Warning
                              </div>
                              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                                This feature is highly stable (mode dominates &gt;90%). It may lack predictive variance.
                              </p>
                            </div>
                          )}

                          <p className="text-xs text-muted mt-2" style={{ lineHeight: '1.5' }}>
                            {chartView === 'Text Length' && "This checks structural consistency by plotting the average character length of strings in each category, helping spot data anomalies."}
                            {chartView === 'Bar Chart' && "Bar Charts are best for showing the frequency of each category to see how your data is distributed."}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', borderRadius: '8px' }} className="text-muted">
                    No distribution data available
                  </div>
                )}

              </SectionCard>

              {/* ── All-Features Overview ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 0 16px', borderBottom: '2px solid var(--border-color)', marginBottom: '20px' }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>All-Features Overview</h3>
                  <p className="text-muted text-sm" style={{ margin: '2px 0 0' }}>Charts for all features at once. Use the arrows to navigate.</p>
                </div>
                {/* Prev / Next navigator */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', position: 'relative' }}>
                  <div className="fe-gc-nav">
                    <button className="fe-gc-arrow" onClick={goPrev} aria-label="Previous chart">‹</button>
                    <span className="fe-gc-label" onDoubleClick={() => { setGcSearching(true); setGcQuery(''); }} title="Double-click to search">
                      {gcSearching ? (
                        <input
                          className="fe-gc-search-input"
                          autoFocus
                          value={gcQuery}
                          onChange={e => setGcQuery(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') { setGcSearching(false); setGcQuery(''); }
                            if (e.key === 'Enter') {
                              const q = gcQuery.toLowerCase();
                              const match = globalCharts.find(t => t.label.toLowerCase().includes(q));
                              if (match) setDistGlobalTab(match.id);
                              setGcSearching(false); setGcQuery('');
                            }
                          }}
                          onBlur={() => { setGcSearching(false); setGcQuery(''); }}
                          placeholder="Search chart…"
                        />
                      ) : (
                        <span className="fe-gc-label-name">{activeGC.label}</span>
                      )}
                    </span>
                    <button className="fe-gc-arrow" onClick={goNext} aria-label="Next chart">›</button>
                  </div>
                  {gcSearching && (() => {
                    const filtered = gcQuery
                      ? globalCharts.filter(t => t.label.toLowerCase().includes(gcQuery.toLowerCase()))
                      : globalCharts;
                    return (
                      <div className="fe-gc-dropdown" onMouseDown={e => e.preventDefault()}>
                        {filtered.length > 0 ? filtered.map(t => (
                          <div
                            key={t.id}
                            className={`fe-gc-dropdown-item${t.id === distGlobalTab ? ' active' : ''}`}
                            onClick={() => { setDistGlobalTab(t.id); setGcSearching(false); setGcQuery(''); }}
                          >
                            {t.label}
                          </div>
                        )) : (
                          <div className="fe-gc-dropdown-empty">No charts found</div>
                        )}
                      </div>
                    );
                  })()}
                  <span className="fe-gc-label-pager">{gcIdx + 1} / {globalCharts.length}</span>
                </div>
              </div>

              {distGlobalTab === 'outliers' && (
                <SectionCard
                  title="Outlier Detection (Box Plot)"
                  subtitle="Each row shows one numeric feature. The box-and-whisker shape visualizes the data spread."
                  helpTip="The box in the middle represents where the majority of values fall (25th to 75th percentile). The line in the box is the middle value (median). The whiskers extend to the min and max. Outliers are data points that are unusually far from the rest — they can skew analysis results."
                >
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                    <table className="data-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>Feature Name</th>
                          <th style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>Data Spread (Min → Max)</th>
                          <th style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>Outlier Count</th>
                          <th style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>Outlier %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {numericCols.map((c) => (
                          <tr key={c.column}>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}><b>{c.column}</b></td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '45px', textAlign: 'right' }}>{c.min !== undefined ? c.min.toFixed(1) : ''}</span>
                                <SimpleBoxPlot min={c.min} q1={c.q1} median={c.median} q3={c.q3} max={c.max} width={160} height={24} />
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '45px', textAlign: 'left' }}>{c.max !== undefined ? c.max.toFixed(1) : ''}</span>
                              </div>
                            </td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
                              <span style={{ color: (c.outlier_count ?? 0) > 0 ? 'var(--error)' : 'inherit' }}>{c.outlier_count ?? 0}</span>
                            </td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
                              <span style={{ color: (c.outlier_percent ?? 0) > 0 ? 'var(--error)' : 'inherit' }}>{(c.outlier_percent ?? 0).toFixed(2)}%</span>
                            </td>
                          </tr>
                        ))}
                        {numericCols.length === 0 && (
                          <tr><td colSpan={4} className="text-muted text-center" style={{ padding: '16px' }}>No numeric columns available</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

              {distGlobalTab === 'skewness' && (
                <SectionCard
                  title="Data Symmetry Check (Skewness)"
                  subtitle="Shows whether each numeric feature's values are evenly spread (symmetric) or lopsided (skewed)."
                  helpTip="A skewness value near 0 means the data is roughly even on both sides (like a bell curve). A value above +1 means most data is bunched on the left with a long tail to the right. Below -1 means the opposite. Red bars highlight features that are highly skewed — these might benefit from transformations."
                >
                  <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', height: '280px' }}>
                    {skewData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={skewData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} label={{ value: 'Feature Name', position: 'insideBottom', offset: -25, fontSize: 12 }} />
                          <YAxis label={{ value: 'Skewness Score (0 = symmetric)', angle: -90, position: 'insideLeft', offset: -5, fontSize: 12 }} />
                          <BarTooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)' }} formatter={(value: any) => [`${value.toFixed(3)}`, 'Skewness']} />
                          <Bar dataKey="skew" fill="#f59e0b" name="Skewness">
                            {skewData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={Math.abs(entry.skew) > 1 ? '#ef4444' : '#f59e0b'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="text-muted">
                        No numeric features to analyze
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {distGlobalTab === 'scale' && (
                <SectionCard
                  title="Feature Scale Comparison"
                  subtitle="Horizontal range plot showing the min → max span for each numeric feature."
                  helpTip="If features have vastly different ranges (e.g., one goes 0–1 and another 0–100,000), many ML algorithms will unfairly weigh the larger-ranged feature. You would need to apply Normalization or Standardization before training."
                >
                  {(() => {
                    // Compute global scale
                    const allVals = featureScaleData.flatMap(d => [Math.abs(d.min || 0), Math.abs(d.max || 0)]).filter(v => v > 0);
                    const globalMax = Math.max(...featureScaleData.map(d => Math.abs(d.max ?? 0)), 1);
                    const globalMin = Math.min(...allVals, 0.01);
                    const useLog = globalMax / Math.max(globalMin, 0.001) > 100;
                    // SVG layout
                    const rowH = 46;
                    const padLeft = 130;
                    const padRight = 80;
                    const padTop = 20;
                    const padBot = 65; // increased space for bottom legend
                    const chartWidth = 700;
                    const plotW = chartWidth - padLeft - padRight;
                    const svgH = padTop + featureScaleData.length * rowH + padBot;
                    // Scale helpers
                    const domainMin = useLog ? Math.max(globalMin * 0.5, 0.001) : 0;
                    const domainMax = globalMax * 1.1;
                    const toX = (val: number): number => {
                      if (useLog) {
                        const logMin = Math.log10(Math.max(domainMin, 0.001));
                        const logMax = Math.log10(domainMax);
                        const logVal = Math.log10(Math.max(Math.abs(val), domainMin));
                        return padLeft + ((logVal - logMin) / (logMax - logMin)) * plotW;
                      }
                      return padLeft + (val / domainMax) * plotW;
                    }
                    // Ticks calculation
                    const ticks: number[] = [];
                    if (useLog) {
                      const logStart = Math.floor(Math.log10(Math.max(domainMin, 0.001)));
                      const logEnd = Math.ceil(Math.log10(domainMax));
                      for (let p = logStart; p <= logEnd; p++) ticks.push(Math.pow(10, p));
                    } else {
                      for (let i = 0; i <= 4; i++) ticks.push(Math.round((domainMax / 4) * i));
                    }
                    const fmtTick = (v: number) => {
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
                      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
                      if (v >= 1) return v.toFixed(0);
                      return v.toFixed(2);
                    };
                    const COLORS_DUMB = ['#f97316', '#3b82f6', '#10b981', '#a855f7', '#f43f5e', '#06b6d4', '#eab308', '#ec4899', '#84cc16', '#6366f1'];
                    return (
                      <div style={{ overflowX: 'auto', padding: '8px 0' }}>
                        <svg width={chartWidth} height={svgH} viewBox={`0 0 ${chartWidth} ${svgH}`} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
                          {/* Grid lines & tick labels */}
                          {ticks.map((tick, i) => {
                            const x = toX(tick);
                            if (x < padLeft || x > padLeft + plotW) return null;
                            return (
                              <g key={i}>
                                <line x1={x} y1={padTop} x2={x} y2={svgH - padBot + 6} stroke="var(--border-color, #e2e8f0)" strokeWidth="1" strokeDasharray="4 4" />
                                <text x={x} y={svgH - padBot + 18} textAnchor="middle" fontSize="11" fill="var(--text-muted, #94a3b8)">{fmtTick(tick)}</text>
                              </g>
                            );
                          })}

                          {/* Baseline */}
                          <line x1={padLeft} y1={svgH - padBot} x2={padLeft + plotW} y2={svgH - padBot} stroke="var(--border-color, #cbd5e1)" strokeWidth="1.5" />
                          {/* Rows */}
                          {featureScaleData.map((feat, i) => {
                            const y = padTop + i * rowH + rowH / 2;
                            const minVal = feat.min ?? 0;
                            const maxVal = feat.max ?? 0;
                            const x1 = toX(Math.max(Math.abs(minVal), useLog ? domainMin : 0));
                            const x2 = toX(Math.abs(maxVal));
                            const color = COLORS_DUMB[i % COLORS_DUMB.length];
                            return (
                              <g key={feat.name}>
                                {/* Alternating row background */}
                                {i % 2 === 0 && (
                                  <rect x={0} y={y - rowH / 2 + 2} width={chartWidth} height={rowH - 4} rx="6" fill="var(--text-muted, #94a3b8)" opacity="0.06" />
                                )}

                                {/* Feature name */}
                                <text x={padLeft - 16} y={y + 4} textAnchor="end" fontSize="13" fontWeight="600" fill="var(--text-main, #334155)">
                                  {feat.name.length > 14 ? feat.name.slice(0, 13) + '…' : feat.name}
                                </text>

                                {/* Connecting line */}
                                <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.4" />

                                {/* Min dot */}
                                <circle cx={x1} cy={y} r="5.5" fill="var(--surface-main, var(--bg-panel, #ffffff))" stroke={color} strokeWidth="2.5" />

                                {/* Max dot */}
                                <circle cx={x2} cy={y} r="5.5" fill={color} stroke={color} strokeWidth="2" />

                                {/* Range label on right */}
                                <text x={Math.max(x1, x2) + 14} y={y + 4} fontSize="11.5" fill="var(--text-muted, #64748b)" fontWeight="500">
                                  {fmtTick(minVal)} → {fmtTick(maxVal)}
                                </text>
                              </g>
                            );
                          })}
                          {/* Legend BELOW the chart */}
                          <g transform={`translate(${padLeft + plotW / 2 - 90}, ${svgH - 20})`}>
                            <circle cx="0" cy="0" r="5" fill="var(--surface-main, var(--bg-panel, #ffffff))" stroke="var(--text-muted, #94a3b8)" strokeWidth="2" />
                            <text x="12" y="4" fontSize="12" fill="var(--text-muted, #94a3b8)" fontWeight="500">Minimum Value</text>

                            <line x1="110" y1="0" x2="140" y2="0" stroke="var(--text-muted, #94a3b8)" strokeWidth="3" strokeLinecap="round" opacity="0.4" />

                            <circle cx="170" cy="0" r="5" fill="var(--text-muted, #94a3b8)" />
                            <text x="182" y="4" fontSize="12" fill="var(--text-muted, #94a3b8)" fontWeight="500">Maximum Value</text>
                          </g>
                        </svg>
                      </div>
                    );
                  })()}
                </SectionCard>
              )}

              {distGlobalTab === 'variability' && (
                <SectionCard
                  title="Data Spread / Variability (Coefficient of Variation)"
                  subtitle="Measures how spread out each feature's values are relative to its average."
                  helpTip="The Coefficient of Variation (CV) = Standard Deviation ÷ Mean × 100. A higher CV means the data is more spread out relative to its center. Features with very high CV (>100%) are highly variable and may dominate model training. Features with very low CV (<5%) are nearly constant and might not add useful information."
                >
                  <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={variabilityData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} label={{ value: 'Feature Name', position: 'insideBottom', offset: -25, fontSize: 12 }} />
                        <YAxis label={{ value: 'CV % (Std Dev / Mean × 100)', angle: -90, position: 'insideLeft', offset: -5, fontSize: 12 }} />
                        <BarTooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)' }} formatter={(value: any) => [`${value.toFixed(1)}%`, 'Coefficient of Variation']} />
                        <Bar dataKey="cv" fill="#f59e0b" name="CV %" radius={[4, 4, 0, 0]}>
                          {variabilityData.map((entry, index) => (
                            <Cell key={`cv-${index}`} fill={entry.cv > 100 ? '#ef4444' : entry.cv < 5 ? '#9ca3af' : '#f59e0b'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}



              {distGlobalTab === 'dominance' && (
                <SectionCard
                  title="Category Dominance (Imbalance Check)"
                  subtitle="Shows how much of each categorical feature is taken up by the single most frequent value."
                  helpTip="A dominance ratio near 100% means almost every row has the same value — this feature likely has no predictive power. Between 50-80% may indicate class imbalance, which can bias models. Below 50% suggests healthy variety. For classification targets, high imbalance requires special handling like SMOTE or class weights."
                >
                  <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', height: Math.max(280, categoricalCols.length * 36 + 60) + 'px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={categoricalCols.map((c) => ({
                          name: c.column,
                          dominance: Math.round((c.dominance_ratio ?? 0) * 100 * 10) / 10,
                        }))}
                        layout="vertical"
                        margin={{ top: 10, right: 40, left: 20, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                        <XAxis type="number" domain={[0, 100]} label={{ value: 'Most Frequent Value Share %', position: 'insideBottom', offset: -10, fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                        <BarTooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)' }} formatter={(value: any) => [`${value}%`, 'Top Category Share']} />
                        <Bar dataKey="dominance" name="Dominance %" radius={[0, 4, 4, 0]}>
                          {categoricalCols.map((c, index) => {
                            const d = (c.dominance_ratio ?? 0) * 100;
                            return <Cell key={`dom-${index}`} fill={d >= 90 ? '#ef4444' : d >= 70 ? '#f59e0b' : '#10b981'} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              {distGlobalTab === 'cardinality' && (
                <SectionCard
                  title="Cardinality Overview (Unique Values per Category)"
                  subtitle="How many distinct values each categorical feature contains."
                  helpTip="Low cardinality (2–5) = great for one-hot encoding. Medium (6–20) = may need target encoding. High (50+) = could be IDs or free-text that require special handling or should be dropped. Binary features (exactly 2 values like yes/no) are highlighted in blue."
                >
                  <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', height: Math.max(280, categoricalCols.length * 36 + 60) + 'px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={categoricalCols.map((c) => ({
                          name: c.column,
                          unique: c.unique ?? 0,
                        }))}
                        layout="vertical"
                        margin={{ top: 10, right: 40, left: 20, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                        <XAxis type="number" label={{ value: 'Number of Unique Values', position: 'insideBottom', offset: -10, fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                        <BarTooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)' }} formatter={(value: any) => [`${value} values`, 'Unique Count']} />
                        <Bar dataKey="unique" name="Unique Values" radius={[0, 4, 4, 0]}>
                          {categoricalCols.map((c, index) => {
                            const u = c.unique ?? 0;
                            return <Cell key={`card-${index}`} fill={u === 2 ? '#3b82f6' : u <= 10 ? '#10b981' : u <= 50 ? '#f59e0b' : '#ef4444'} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              {distGlobalTab === 'correlations' && (
                <SectionCard
                  title="Feature Relationships (Correlation Matrix)"
                  subtitle="Shows how strongly each pair of numeric features moves together."
                  helpTip="A value of +1.00 means two features always move in the same direction. A value of -1.00 means they move in opposite directions. Values near 0.00 mean no relationship. Dark blue = strong positive link. Dark red = strong negative link. High correlations between two features may mean one is redundant."
                >
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'center', border: '1px solid var(--border-color)' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
                          <th style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)' }}>Feature</th>
                          {numericCols.map((c) => <th key={c.column} style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>{c.column}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {numericCols.map((c1) => (
                          <tr key={c1.column}>
                            <td style={{ padding: '12px', fontWeight: 600, borderRight: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>{c1.column}</td>
                            {numericCols.map((c2) => {
                              const val = payload.correlation?.[c1.column]?.[c2.column] ?? 0;
                              const intensity = Math.abs(val);
                              const bgColor = val > 0 ? `rgba(59, 130, 246, ${intensity})` : `rgba(239, 68, 68, ${intensity})`;
                              return (
                                <td key={c2.column} style={{ padding: '12px', backgroundColor: bgColor, color: intensity > 0.6 ? 'white' : 'inherit', borderBottom: '1px solid var(--border-color)' }}>
                                  {val.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

            </div>
          );
        })()}

        {activeTab === 'Missing Values' && (
          <div style={{ textAlign: 'left', padding: '24px', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
            {overview.missing_percent === 0 ? (
              <div style={{ textAlign: 'center', padding: '64px', backgroundColor: 'var(--surface-success-soft)', borderRadius: '8px' }}>
                <AlertCircle size={48} color="var(--success)" style={{ margin: '0 auto 16px' }} />
                <h4 style={{ fontWeight: 600, fontSize: '20px', color: 'var(--success)', marginBottom: '8px' }}>No Missing Values</h4>
                <p className="text-muted text-sm">Your dataset is complete with no missing data!</p>
              </div>
            ) : (
              <>
                <h4 style={{ fontWeight: 600, fontSize: '18px', marginBottom: '16px' }}>Missing Data Details</h4>
                <p className="text-muted text-sm mb-6">Tabular breakdown of features containing missing values.</p>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '32px', overflow: 'hidden' }}>
                  <table className="data-table">
                    <thead>
                      <tr><th>Feature</th><th>Missing Count</th><th>Available Rows</th><th>Missing %</th><th>Data Type</th></tr>
                    </thead>
                    <tbody>
                      {columns.filter((col) => col.missing > 0).map((col) => (
                        <tr key={col.column}>
                          <td><b>{col.column}</b></td>
                          <td><span style={{ color: 'var(--error)' }}>{col.missing}</span></td>
                          <td>{overview.rows - col.missing}</td>
                          <td><span style={{ color: 'var(--error)' }}>{col.missing_percent?.toFixed(2) ?? 0}%</span></td>
                          <td>{col.dtype}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h4 style={{ fontWeight: 600, fontSize: '18px', marginBottom: '16px' }}>Missing vs Available Data per Feature</h4>
                <p className="text-muted text-sm mb-6">Stacked representation showing exactly which variables are incomplete.</p>
                <div style={{ height: '300px', marginBottom: '32px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={columns.filter((col) => col.missing > 0).map((col) => ({ name: col.column, missing: col.missing_percent ?? 0, available: 100 - (col.missing_percent ?? 0) }))} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis label={{ value: 'Percentage %', angle: -90, position: 'insideLeft', offset: -10 }} />
                      <BarTooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)' }} />
                      <Bar dataKey="missing" stackId="a" fill="var(--error)" name="Missing %" />
                      <Bar dataKey="available" stackId="a" fill="#10b981" name="Available %" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'Column Details' && (
          <div style={{ textAlign: 'left', padding: '24px', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
            <h4 style={{ fontWeight: 600, fontSize: '18px', marginBottom: '16px' }}>Numeric Columns ({types.numeric})</h4>
            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '32px', overflow: 'hidden' }}>
              <table className="data-table">
                <thead><tr><th>Feature</th><th>Outliers</th><th>Range</th><th>Mean</th><th>Skew</th></tr></thead>
                <tbody>
                  {numericCols.map((col) => (
                    <tr key={col.column}>
                      <td><b>{col.column}</b></td>
                      <td>{col.outlier_percent?.toFixed(1) || 0}% outliers</td>
                      <td>[{col.min?.toFixed(2) || 0}, {col.max?.toFixed(2) || 0}]</td>
                      <td>{col.mean?.toFixed(2) || 0}</td>
                      <td>{col.skew?.toFixed(2) || 0}</td>
                    </tr>
                  ))}
                  {numericCols.length === 0 && (
                    <tr><td colSpan={5} className="text-muted text-center" style={{ padding: '16px' }}>No numeric columns found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <h4 style={{ fontWeight: 600, fontSize: '18px', marginBottom: '16px' }}>Categorical Columns ({types.categorical})</h4>
            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '32px', overflow: 'hidden' }}>
              <table className="data-table">
                <thead><tr><th>Feature</th><th>Unique Values</th><th>Missing</th><th style={{ minWidth: '250px' }}>Values</th></tr></thead>
                <tbody>
                  {categoricalCols.map((col) => {
                    const distData = payload.distributions?.[col.column];
                    const sampleVals = (distData?.type === 'categorical' && distData.categories)
                      ? distData.categories.join(', ')
                      : '';

                    return (
                      <tr key={col.column}>
                        <td><b>{col.column}</b></td>
                        <td>{col.unique}</td>
                        <td>{col.missing > 0 ? <span style={{ color: 'var(--error)' }}>{col.missing} ({col.missing_percent?.toFixed(1)}%)</span> : '0'}</td>
                        <td>
                          <div style={{
                            maxHeight: '80px',
                            overflowY: 'auto',
                            padding: '4px 0',
                            fontSize: '13px',
                            lineHeight: '1.6',
                            wordBreak: 'break-word',
                          }} title={sampleVals}>
                            {sampleVals || <span className="text-muted">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {categoricalCols.length === 0 && (
                    <tr><td colSpan={4} className="text-muted text-center" style={{ padding: '16px' }}>No categorical columns found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button className="btn-outline btn text-sm" onClick={onPrev} style={{ borderRadius: '8px' }}>
          <ChevronLeft size={16} /> Back to Select Dataset
        </button>
        <div style={{ display: 'flex', gap: '16px', marginLeft: 'auto', fontSize: '13px', color: 'var(--text-muted)' }}>
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '999px', padding: '4px 12px' }}>
            Dataset: {info.name}
          </div>
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '999px', padding: '4px 12px' }}>
            {info.rows} rows
          </div>
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '999px', padding: '4px 12px' }}>
            {info.columns} columns
          </div>
        </div>
        <button className="btn btn-primary" onClick={onNext} style={{ marginLeft: '16px' }}>
          Continue to Data Quality <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default DataProfileStep;
