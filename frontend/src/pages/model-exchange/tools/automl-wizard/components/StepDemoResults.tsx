import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import TryOtherFeatures from '../../../../shared/TryOtherFeatures';
import type { SampleScenario } from '../demoData';

interface Props {
  scenario: SampleScenario;
  onBack?: () => void;
}

const METRIC_LABELS: Record<string, string> = {
  auc: 'AUC',
  accuracy: 'Accuracy',
  logloss: 'Log Loss',
  f1: 'F1',
  precision: 'Precision',
  recall: 'Recall',
  rmse: 'RMSE',
  mse: 'MSE',
  mae: 'MAE',
  r2: 'R2',
  silhouette: 'Silhouette',
  calinski_harabasz: 'Calinski-Harabasz',
  davies_bouldin: 'Davies-Bouldin',
  composite_score: 'Composite',
};

const CLUSTER_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6'];

const formatMetric = (key: string, value: number | null | undefined) => {
  if (value == null) return '-';
  if (['accuracy', 'f1', 'precision', 'recall'].includes(key)) return `${(value * 100).toFixed(1)}%`;
  if (key === 'mse') return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) > 999) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toFixed(4);
};

export default function StepDemoResults({ scenario, onBack }: Props) {
  const best = scenario.leaderboard.models[0];
  const metricKeys = Object.keys(best.metrics);
  const primaryMetric = scenario.leaderboard.primary_metric || metricKeys[0];
  const chartMetric = primaryMetric === 'rmse' ? 'r2' : primaryMetric;
  const chartData = scenario.leaderboard.models.map((model) => ({
    name: `#${model.rank} ${model.algorithm}`,
    [chartMetric]: Number(model.metrics[chartMetric] ?? model.metrics[primaryMetric] ?? 0),
  }));

  const classificationRows = scenario.holdout.classification_rows;
  const regressionRows = scenario.holdout.regression_rows;
  const clustering = scenario.clustering;

  return (
    <div className="aw-step-content">
      <div className="aw-step-main aw-step-main--wide">
        {onBack && (
          <button className="aw-back-btn" type="button" onClick={onBack}>
            ← Back to Training
          </button>
        )}

        <div className="aw-best-model-card">
          <div className="aw-best-model-info">
            <span className="aw-best-model-label">{scenario.task === 'clustering' ? 'Best Candidate' : 'Best Model'}</span>
            <span className="aw-best-model-name">{best.algorithm}</span>
          </div>
          <div className="aw-best-model-metric">
            <span className="aw-best-model-metric-label">{METRIC_LABELS[primaryMetric] || primaryMetric}</span>
            <span className="aw-best-model-metric-value">{formatMetric(primaryMetric, best.metrics[primaryMetric])}</span>
          </div>
        </div>

        <div className="aw-results-metrics-hero aw-results-metrics-hero--two-col">
          <div className={`aw-perf-section aw-perf-section--cv aw-perf-section--task-${scenario.task}`}>
            <h3 className="aw-perf-title">Model selection metrics</h3>
            <div className="aw-perf-cards aw-perf-cards--dense">
              {metricKeys.map((key) => (
                <div key={key} className="aw-perf-card aw-perf-card--compact">
                  <span className="aw-perf-card-label">{METRIC_LABELS[key] || key}</span>
                  <span className="aw-perf-card-value">{formatMetric(key, best.metrics[key])}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="aw-perf-section aw-perf-section--validation-cls">
            <h3 className="aw-perf-title">{scenario.task === 'clustering' ? 'Cluster summary' : 'Holdout split'}</h3>
            <div className="aw-perf-cards aw-perf-cards--dense aw-perf-cards--cls-validation">
              {scenario.task === 'clustering' && clustering ? (
                <>
                  <div className="aw-perf-card aw-perf-card--compact aw-perf-card--cls">
                    <span className="aw-perf-card-label">Rows</span>
                    <span className="aw-perf-card-value">{scenario.dataset.total_rows}</span>
                  </div>
                  <div className="aw-perf-card aw-perf-card--compact aw-perf-card--cls">
                    <span className="aw-perf-card-label">Clusters</span>
                    <span className="aw-perf-card-value">{clustering.clusters.length}</span>
                  </div>
                  <div className="aw-perf-card aw-perf-card--compact aw-perf-card--cls">
                    <span className="aw-perf-card-label">Features</span>
                    <span className="aw-perf-card-value">{scenario.recommendation.features.length}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="aw-perf-card aw-perf-card--compact aw-perf-card--cls">
                    <span className="aw-perf-card-label">Training Rows</span>
                    <span className="aw-perf-card-value">{scenario.holdout.train_rows}</span>
                  </div>
                  <div className="aw-perf-card aw-perf-card--compact aw-perf-card--cls">
                    <span className="aw-perf-card-label">Holdout Rows</span>
                    <span className="aw-perf-card-value">{scenario.holdout.test_rows}</span>
                  </div>
                  <div className="aw-perf-card aw-perf-card--compact aw-perf-card--cls">
                    <span className="aw-perf-card-label">Target</span>
                    <span className="aw-perf-card-value aw-best-model-metric-value--wrap">{scenario.recommendation.target_column}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {classificationRows.length > 0 && (
          <div className="aw-holdout-section">
            <h3 className="aw-holdout-title">Validation dataset with predictions</h3>
            <div className="aw-table-scroll">
              <table className="aw-holdout-table">
                <thead><tr><th>#</th><th>Actual</th><th>Predicted</th><th>Confidence</th><th>Key Features</th></tr></thead>
                <tbody>
                  {classificationRows.map((row, index) => (
                    <tr key={`${row.actual}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{row.actual}</td>
                      <td>{row.predicted}</td>
                      <td>{(row.confidence * 100).toFixed(1)}%</td>
                      <td>{Object.entries(row.features ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {regressionRows.length > 0 && (
          <div className="aw-holdout-section">
            <h3 className="aw-holdout-title">Validation dataset with predictions</h3>
            <div className="aw-table-scroll">
              <table className="aw-holdout-table">
                <thead><tr><th>#</th><th>Actual</th><th>Predicted</th><th>Error</th><th>Key Features</th></tr></thead>
                <tbody>
                  {regressionRows.map((row, index) => (
                    <tr key={`${row.actual}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{formatMetric('raw', row.actual)}</td>
                      <td>{formatMetric('raw', row.predicted)}</td>
                      <td>{formatMetric('raw', row.error)}</td>
                      <td>{Object.entries(row.features ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {clustering && (
          <>
            <div className="aw-holdout-section">
              <h3 className="aw-holdout-title">Cluster distribution</h3>
              <div className="aw-table-scroll">
                <table className="aw-holdout-table">
                  <thead><tr><th>Cluster</th><th>Rows</th><th>Share</th><th>Centroid Highlights</th></tr></thead>
                  <tbody>
                    {clustering.clusters.map((cluster) => (
                      <tr key={cluster.cluster_id}>
                        <td>Cluster {cluster.cluster_id}</td>
                        <td>{cluster.size}</td>
                        <td>{cluster.percentage}%</td>
                        <td>{Object.entries(cluster.centroid).map(([k, v]) => `${k}: ${Number(v).toFixed(2)}`).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="aw-chart-container">
              <h3>PCA 2D Projection</h3>
              <ResponsiveContainer width="100%" height={340}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="x" type="number" />
                  <YAxis dataKey="y" type="number" />
                  <Tooltip />
                  {clustering.clusters.map((cluster) => (
                    <Scatter
                      key={cluster.cluster_id}
                      name={`Cluster ${cluster.cluster_id}`}
                      data={clustering.points.filter((point) => point.cluster === cluster.cluster_id)}
                      fill={CLUSTER_COLORS[cluster.cluster_id % CLUSTER_COLORS.length]}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        <div className="aw-lb-header">
          <div>
            <h3>{scenario.task === 'clustering' ? 'Candidate Leaderboard' : 'Model Leaderboard'}</h3>
            <p className="aw-lb-subtitle">Prepared comparison ranked by {METRIC_LABELS[primaryMetric] || primaryMetric}.</p>
          </div>
        </div>

        <div className="aw-leaderboard">
          <table className="aw-lb-table">
            <thead>
              <tr>
                <th>Model ID</th>
                {metricKeys.map((key) => <th key={key}>{METRIC_LABELS[key] || key}</th>)}
              </tr>
            </thead>
            <tbody>
              {scenario.leaderboard.models.map((model, index) => (
                <tr key={model.model_id} className={index === 0 ? 'aw-lb-row--best' : ''}>
                  <td className="aw-lb-model-id">
                    {index === 0 && <span className="aw-badge aw-badge--green">Best</span>}
                    {' '}{model.model_id}
                  </td>
                  {metricKeys.map((key) => <td key={key}><strong>{formatMetric(key, model.metrics[key])}</strong></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!clustering && (
          <div className="aw-chart-container">
            <h3>Performance Comparison</h3>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey={chartMetric} fill="#e67e22" name={METRIC_LABELS[chartMetric] || chartMetric} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <TryOtherFeatures current="automl" />
      </div>

      <div className="aw-step-sidebar">
        <div className="aw-ai-summary-panel">
          <div className="aw-ai-summary-header">
            <div>
              <h4>{scenario.summary.title}</h4>
              <p className="aw-ai-desc">Quick insights and recommendations based on pipeline results.</p>
            </div>
          </div>
          <div className="aw-ai-summary-content">
            <div className="aw-ai-section">
              <h5>Executive Summary</h5>
              <p>{scenario.summary.body}</p>
            </div>
            <div className="aw-ai-section">
              <h5>Key Insights</h5>
              {scenario.summary.insights.map((insight) => (
                <div key={insight} className="aw-ai-insight-card">{insight}</div>
              ))}
            </div>
            <div className="aw-ai-section">
              <h5>Recommendation</h5>
              <div className="aw-ai-rec-card">{scenario.summary.recommendation}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
