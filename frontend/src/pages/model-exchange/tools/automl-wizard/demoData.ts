import type {
  AIRecommendResponse,
  AutoDetectTaskResponse,
  ClusterSummary,
  ColumnInfo,
  DatasetMetadata,
  DatasetPreviewResponse,
  DimensionReductionPoint,
  HoldoutEvaluationResponse,
  LeaderboardResponse,
  MLTask,
  UseCaseSuggestion,
} from './types';

type SampleKind = 'classification' | 'regression' | 'clustering';

export type SampleScenario = {
  id: string;
  label: string;
  task: SampleKind;
  runId: string;
  dataset: DatasetMetadata;
  columns: ColumnInfo[];
  preview: DatasetPreviewResponse;
  suggestions: UseCaseSuggestion[];
  detectTask: AutoDetectTaskResponse;
  recommendation: AIRecommendResponse;
  logs: string[];
  leaderboard: LeaderboardResponse;
  holdout: HoldoutEvaluationResponse;
  summary: {
    title: string;
    body: string;
    insights: string[];
    recommendation: string;
  };
  clustering?: {
    bestAlgorithm: string;
    bestParams: Record<string, unknown>;
    metrics: Record<string, number>;
    clusters: ClusterSummary[];
    points: DimensionReductionPoint[];
    featureImportance: Array<{ feature: string; importance: number }>;
  };
};

const makePreview = (
  dataset: DatasetMetadata,
  columns: ColumnInfo[],
  rows: Record<string, unknown>[],
): DatasetPreviewResponse => ({
  dataset_id: dataset.id,
  columns: columns.map((column) => column.name),
  total_rows: dataset.total_rows,
  rows,
});

const classificationDataset: DatasetMetadata = {
  id: 'sample-customer-churn',
  filename: 'customer_churn_classification.csv',
  total_rows: 1240,
  total_columns: 8,
  size_bytes: 186_420,
  category: 'Sample',
  description: 'Customer subscription records for predicting whether a customer is likely to churn.',
};

const classificationColumns: ColumnInfo[] = [
  { name: 'customer_id', dtype: 'object', null_count: 0, unique_count: 1240, sample_values: ['C-1001', 'C-1002', 'C-1003'] },
  { name: 'tenure_months', dtype: 'int64', null_count: 0, unique_count: 72, sample_values: ['6', '18', '42'] },
  { name: 'monthly_spend', dtype: 'float64', null_count: 0, unique_count: 684, sample_values: ['29.9', '74.5', '105.2'] },
  { name: 'support_tickets', dtype: 'int64', null_count: 0, unique_count: 12, sample_values: ['0', '2', '5'] },
  { name: 'contract_type', dtype: 'object', null_count: 0, unique_count: 3, sample_values: ['Monthly', 'Annual', 'Two-year'] },
  { name: 'payment_delay_days', dtype: 'int64', null_count: 0, unique_count: 18, sample_values: ['0', '3', '11'] },
  { name: 'usage_score', dtype: 'float64', null_count: 0, unique_count: 391, sample_values: ['0.82', '0.64', '0.31'] },
  { name: 'churned', dtype: 'object', null_count: 0, unique_count: 2, sample_values: ['No', 'Yes'] },
];

const regressionDataset: DatasetMetadata = {
  id: 'sample-housing-prices',
  filename: 'housing_price_regression.csv',
  total_rows: 980,
  total_columns: 8,
  size_bytes: 154_880,
  category: 'Sample',
  description: 'Property records for estimating sale price from house and neighborhood attributes.',
};

const regressionColumns: ColumnInfo[] = [
  { name: 'property_id', dtype: 'object', null_count: 0, unique_count: 980, sample_values: ['H-401', 'H-402', 'H-403'] },
  { name: 'area_sqft', dtype: 'int64', null_count: 0, unique_count: 431, sample_values: ['1120', '1840', '2450'] },
  { name: 'bedrooms', dtype: 'int64', null_count: 0, unique_count: 6, sample_values: ['2', '3', '4'] },
  { name: 'bathrooms', dtype: 'float64', null_count: 0, unique_count: 8, sample_values: ['1.5', '2', '3'] },
  { name: 'age_years', dtype: 'int64', null_count: 0, unique_count: 75, sample_values: ['4', '17', '32'] },
  { name: 'distance_to_center_km', dtype: 'float64', null_count: 0, unique_count: 219, sample_values: ['2.4', '7.8', '15.1'] },
  { name: 'school_rating', dtype: 'float64', null_count: 0, unique_count: 41, sample_values: ['6.8', '8.2', '9.1'] },
  { name: 'sale_price', dtype: 'float64', null_count: 0, unique_count: 862, sample_values: ['184000', '342500', '515000'] },
];

const clusteringDataset: DatasetMetadata = {
  id: 'sample-customer-segments',
  filename: 'customer_segments_clustering.csv',
  total_rows: 1500,
  total_columns: 7,
  size_bytes: 132_560,
  category: 'Sample',
  description: 'Customer behavior attributes for discovering natural customer segments.',
};

const clusteringColumns: ColumnInfo[] = [
  { name: 'customer_id', dtype: 'object', null_count: 0, unique_count: 1500, sample_values: ['S-7001', 'S-7002', 'S-7003'] },
  { name: 'annual_spend', dtype: 'float64', null_count: 0, unique_count: 786, sample_values: ['4200', '12800', '23600'] },
  { name: 'visit_frequency', dtype: 'float64', null_count: 0, unique_count: 212, sample_values: ['1.2', '4.7', '9.4'] },
  { name: 'avg_basket_value', dtype: 'float64', null_count: 0, unique_count: 339, sample_values: ['32', '74', '118'] },
  { name: 'digital_engagement', dtype: 'float64', null_count: 0, unique_count: 401, sample_values: ['0.21', '0.64', '0.91'] },
  { name: 'discount_usage_rate', dtype: 'float64', null_count: 0, unique_count: 267, sample_values: ['0.08', '0.31', '0.72'] },
  { name: 'loyalty_months', dtype: 'int64', null_count: 0, unique_count: 90, sample_values: ['4', '28', '61'] },
];

export const sampleScenarios: SampleScenario[] = [
  {
    id: 'classification',
    label: 'Customer Churn Classification',
    task: 'classification',
    runId: 'sample-classification-customer-churn',
    dataset: classificationDataset,
    columns: classificationColumns,
    preview: makePreview(classificationDataset, classificationColumns, [
      { customer_id: 'C-1001', tenure_months: 6, monthly_spend: 29.9, support_tickets: 3, contract_type: 'Monthly', payment_delay_days: 8, usage_score: 0.41, churned: 'Yes' },
      { customer_id: 'C-1002', tenure_months: 22, monthly_spend: 89.5, support_tickets: 0, contract_type: 'Annual', payment_delay_days: 0, usage_score: 0.88, churned: 'No' },
      { customer_id: 'C-1003', tenure_months: 14, monthly_spend: 54.2, support_tickets: 1, contract_type: 'Monthly', payment_delay_days: 2, usage_score: 0.69, churned: 'No' },
      { customer_id: 'C-1004', tenure_months: 3, monthly_spend: 34.1, support_tickets: 5, contract_type: 'Monthly', payment_delay_days: 11, usage_score: 0.22, churned: 'Yes' },
    ]),
    suggestions: [
      { use_case: 'Predict customers likely to churn in the next billing cycle', ml_task: 'classification', target_hint: 'churned' },
      { use_case: 'Prioritize retention outreach using churn risk', ml_task: 'classification', target_hint: 'churned' },
    ],
    detectTask: {
      task: 'classification',
      confidence: 'High',
      reasoning: 'The target column contains two categorical outcomes, making this a binary classification workflow.',
      suggestions: [
        { use_case: 'Predict customers likely to churn in the next billing cycle', ml_task: 'classification', target_hint: 'churned' },
      ],
      source: 'Sample data',
    },
    recommendation: {
      target_column: 'churned',
      features: ['tenure_months', 'monthly_spend', 'support_tickets', 'contract_type', 'payment_delay_days', 'usage_score'],
      confidence: 'High',
      reasoning: 'Churn is best predicted from tenure, support activity, payment delay, spending, contract type, and usage signals.',
      source: 'Sample data',
    },
    logs: [
      'Parse uploaded frame: customer_churn_classification.csv',
      'H2O AutoML: project=customer_churn_classification, task=classification',
      'Target column: churned; training_frame rows=992; validation_frame rows=248',
      'AutoML: starting GLM grid',
      'AutoML: starting DRF model',
      'AutoML: starting GBM grid',
      'AutoML: starting XGBoost grid',
      'New leader: GBM_sample_01, auc=0.9342',
      'StackedEnsemble_AllModels skipped for quick sample run',
      'Scoring holdout frame complete',
    ],
    leaderboard: {
      run_id: 'sample-classification-customer-churn',
      ml_task: 'classification',
      primary_metric: 'auc',
      models: [
        { rank: 1, model_id: 'GBM_sample_01', algorithm: 'GBM', is_best: true, metrics: { auc: 0.9342, accuracy: 0.8911, logloss: 0.2468, f1: 0.8724, precision: 0.8817, recall: 0.8632 } },
        { rank: 2, model_id: 'XGBoost_sample_02', algorithm: 'XGBoost', is_best: false, metrics: { auc: 0.9215, accuracy: 0.8823, logloss: 0.2631, f1: 0.8618, precision: 0.8742, recall: 0.8498 } },
        { rank: 3, model_id: 'DRF_sample_03', algorithm: 'DRF', is_best: false, metrics: { auc: 0.9074, accuracy: 0.8694, logloss: 0.2914, f1: 0.8441, precision: 0.8516, recall: 0.8367 } },
      ],
    },
    holdout: {
      run_id: 'sample-classification-customer-churn',
      model_id: 'GBM_sample_01',
      train_ratio_config: 0.8,
      test_ratio_config: 0.2,
      train_rows: 992,
      test_rows: 248,
      train_fraction_actual: 0.8,
      test_fraction_actual: 0.2,
      regression_rows: [],
      classification_rows: [
        { actual: 'Yes', predicted: 'Yes', confidence: 0.91, probabilities: { No: 0.09, Yes: 0.91 }, features: { tenure_months: 4, monthly_spend: 35.4, support_tickets: 4, contract_type: 'Monthly' } },
        { actual: 'No', predicted: 'No', confidence: 0.88, probabilities: { No: 0.88, Yes: 0.12 }, features: { tenure_months: 31, monthly_spend: 82.1, support_tickets: 0, contract_type: 'Annual' } },
      ],
    },
    summary: {
      title: 'AI Results Summary',
      body: 'GBM gives the strongest churn signal with high AUC and balanced precision/recall.',
      insights: ['Payment delay and low usage score increase churn risk.', 'Annual and two-year contracts show stronger retention.'],
      recommendation: 'Prioritize outreach for monthly-contract customers with high support tickets.',
    },
  },
  {
    id: 'regression',
    label: 'Housing Price Regression',
    task: 'regression',
    runId: 'sample-regression-housing-prices',
    dataset: regressionDataset,
    columns: regressionColumns,
    preview: makePreview(regressionDataset, regressionColumns, [
      { property_id: 'H-401', area_sqft: 1120, bedrooms: 2, bathrooms: 1.5, age_years: 18, distance_to_center_km: 9.2, school_rating: 7.1, sale_price: 218000 },
      { property_id: 'H-402', area_sqft: 1840, bedrooms: 3, bathrooms: 2, age_years: 7, distance_to_center_km: 4.8, school_rating: 8.5, sale_price: 386000 },
      { property_id: 'H-403', area_sqft: 2450, bedrooms: 4, bathrooms: 3, age_years: 3, distance_to_center_km: 3.1, school_rating: 9.0, sale_price: 542000 },
    ]),
    suggestions: [
      { use_case: 'Estimate property sale price from home attributes', ml_task: 'regression', target_hint: 'sale_price' },
    ],
    detectTask: {
      task: 'regression',
      confidence: 'High',
      reasoning: 'The target column is numeric and continuous, which fits regression.',
      suggestions: [{ use_case: 'Estimate property sale price from home attributes', ml_task: 'regression', target_hint: 'sale_price' }],
      source: 'Sample data',
    },
    recommendation: {
      target_column: 'sale_price',
      features: ['area_sqft', 'bedrooms', 'bathrooms', 'age_years', 'distance_to_center_km', 'school_rating'],
      confidence: 'High',
      reasoning: 'Sale price depends strongly on area, room counts, age, location distance, and school rating.',
      source: 'Sample data',
    },
    logs: [
      'Parse uploaded frame: housing_price_regression.csv',
      'H2O AutoML: project=housing_price_regression, task=regression',
      'Target column: sale_price; training_frame rows=784; validation_frame rows=196',
      'AutoML: starting GLM model',
      'AutoML: starting DRF model',
      'AutoML: starting GBM grid',
      'AutoML: starting XGBoost grid',
      'New leader: XGBoost_sample_01, rmse=28640.52',
      'Generating holdout predictions for regression task',
    ],
    leaderboard: {
      run_id: 'sample-regression-housing-prices',
      ml_task: 'regression',
      primary_metric: 'rmse',
      models: [
        { rank: 1, model_id: 'XGBoost_sample_01', algorithm: 'XGBoost', is_best: true, metrics: { rmse: 28640.52, mse: 820279395, mae: 21890.18, r2: 0.9142 } },
        { rank: 2, model_id: 'GBM_sample_02', algorithm: 'GBM', is_best: false, metrics: { rmse: 30218.14, mse: 913136000, mae: 23140.55, r2: 0.9045 } },
        { rank: 3, model_id: 'DRF_sample_03', algorithm: 'DRF', is_best: false, metrics: { rmse: 32790.44, mse: 1075213040, mae: 25330.21, r2: 0.8876 } },
      ],
    },
    holdout: {
      run_id: 'sample-regression-housing-prices',
      model_id: 'XGBoost_sample_01',
      train_ratio_config: 0.8,
      test_ratio_config: 0.2,
      train_rows: 784,
      test_rows: 196,
      train_fraction_actual: 0.8,
      test_fraction_actual: 0.2,
      classification_rows: [],
      regression_rows: [
        { actual: 386000, predicted: 397850, error: -11850, features: { area_sqft: 1840, bedrooms: 3, bathrooms: 2, school_rating: 8.5 } },
        { actual: 542000, predicted: 526420, error: 15580, features: { area_sqft: 2450, bedrooms: 4, bathrooms: 3, school_rating: 9.0 } },
        { actual: 218000, predicted: 229100, error: -11100, features: { area_sqft: 1120, bedrooms: 2, bathrooms: 1.5, school_rating: 7.1 } },
      ],
    },
    summary: {
      title: 'AI Results Summary',
      body: 'XGBoost gives the lowest RMSE and explains most price variance in the holdout data.',
      insights: ['Area and school rating are the strongest positive price drivers.', 'Distance from city center and property age reduce estimated price.'],
      recommendation: 'Use the model for pricing assistance, then review outliers manually before final valuation.',
    },
  },
  {
    id: 'clustering',
    label: 'Customer Segments Clustering',
    task: 'clustering',
    runId: 'sample-clustering-customer-segments',
    dataset: clusteringDataset,
    columns: clusteringColumns,
    preview: makePreview(clusteringDataset, clusteringColumns, [
      { customer_id: 'S-7001', annual_spend: 4200, visit_frequency: 1.2, avg_basket_value: 32, digital_engagement: 0.21, discount_usage_rate: 0.72, loyalty_months: 5 },
      { customer_id: 'S-7002', annual_spend: 12800, visit_frequency: 4.7, avg_basket_value: 74, digital_engagement: 0.64, discount_usage_rate: 0.31, loyalty_months: 28 },
      { customer_id: 'S-7003', annual_spend: 23600, visit_frequency: 9.4, avg_basket_value: 118, digital_engagement: 0.91, discount_usage_rate: 0.08, loyalty_months: 61 },
    ]),
    suggestions: [
      { use_case: 'Discover natural customer segments from behavior signals', ml_task: 'clustering', target_hint: 'No target required' },
    ],
    detectTask: {
      task: 'clustering',
      confidence: 'High',
      reasoning: 'No outcome column is needed; the numeric behavior columns are suitable for unsupervised clustering.',
      suggestions: [{ use_case: 'Discover natural customer segments from behavior signals', ml_task: 'clustering', target_hint: 'No target required' }],
      source: 'Sample data',
    },
    recommendation: {
      target_column: '',
      features: ['annual_spend', 'visit_frequency', 'avg_basket_value', 'digital_engagement', 'discount_usage_rate', 'loyalty_months'],
      confidence: 'High',
      reasoning: 'Behavior, spend, discount usage, and tenure are appropriate signals for segment discovery.',
      source: 'Sample data',
    },
    logs: [
      'Parse uploaded frame: customer_segments_clustering.csv',
      'Clustering workflow: scaling numeric feature columns',
      'Evaluating KMeans candidate models for k=3..7',
      'Evaluating GaussianMixture candidate models',
      'Evaluating DBSCAN candidate models',
      'Best candidate: KMeans(k=4), silhouette=0.6412',
      'Computing PCA projection for visualization',
      'Generating labeled preview with cluster_label',
    ],
    leaderboard: {
      run_id: 'sample-clustering-customer-segments',
      ml_task: 'clustering',
      primary_metric: 'silhouette',
      models: [
        { rank: 1, model_id: 'KMeans_k4_sample', algorithm: 'KMeans', is_best: true, metrics: { silhouette: 0.6412, calinski_harabasz: 824.5, davies_bouldin: 0.712, composite_score: 0.884 } },
        { rank: 2, model_id: 'KMeans_k5_sample', algorithm: 'KMeans', is_best: false, metrics: { silhouette: 0.6031, calinski_harabasz: 791.2, davies_bouldin: 0.794, composite_score: 0.831 } },
        { rank: 3, model_id: 'GaussianMixture_k4_sample', algorithm: 'GaussianMixture', is_best: false, metrics: { silhouette: 0.5844, calinski_harabasz: 742.7, davies_bouldin: 0.851, composite_score: 0.802 } },
      ],
    },
    holdout: {
      run_id: 'sample-clustering-customer-segments',
      model_id: 'KMeans_k4_sample',
      train_ratio_config: 1,
      test_ratio_config: 0,
      train_rows: 1500,
      test_rows: 0,
      train_fraction_actual: 1,
      test_fraction_actual: 0,
      classification_rows: [],
      regression_rows: [],
    },
    clustering: {
      bestAlgorithm: 'KMeans',
      bestParams: { n_clusters: 4, init: 'k-means++' },
      metrics: { silhouette: 0.6412, calinski_harabasz: 824.5, davies_bouldin: 0.712, composite_score: 0.884 },
      clusters: [
        { cluster_id: 0, size: 410, percentage: 27.3, centroid: { annual_spend: 5100, visit_frequency: 1.6, discount_usage_rate: 0.68 } },
        { cluster_id: 1, size: 365, percentage: 24.3, centroid: { annual_spend: 11800, visit_frequency: 4.1, discount_usage_rate: 0.32 } },
        { cluster_id: 2, size: 388, percentage: 25.9, centroid: { annual_spend: 22900, visit_frequency: 8.8, discount_usage_rate: 0.12 } },
        { cluster_id: 3, size: 337, percentage: 22.5, centroid: { annual_spend: 8800, visit_frequency: 6.5, discount_usage_rate: 0.58 } },
      ],
      points: [
        { x: -1.4, y: 0.8, cluster: 0 }, { x: -1.1, y: 0.5, cluster: 0 }, { x: -0.9, y: 0.9, cluster: 0 },
        { x: 0.1, y: -0.2, cluster: 1 }, { x: 0.3, y: -0.5, cluster: 1 }, { x: 0.6, y: -0.1, cluster: 1 },
        { x: 1.4, y: 0.8, cluster: 2 }, { x: 1.7, y: 1.1, cluster: 2 }, { x: 1.2, y: 0.6, cluster: 2 },
        { x: -0.2, y: -1.1, cluster: 3 }, { x: -0.5, y: -1.3, cluster: 3 }, { x: 0.1, y: -1.4, cluster: 3 },
      ],
      featureImportance: [
        { feature: 'annual_spend', importance: 0.31 },
        { feature: 'visit_frequency', importance: 0.23 },
        { feature: 'discount_usage_rate', importance: 0.18 },
        { feature: 'digital_engagement', importance: 0.16 },
        { feature: 'loyalty_months', importance: 0.12 },
      ],
    },
    summary: {
      title: 'AI Results Summary',
      body: 'KMeans identifies four clear behavior-based customer segments.',
      insights: ['High-value loyal customers separate clearly from discount-driven visitors.', 'Digital engagement helps distinguish frequent mid-value customers.'],
      recommendation: 'Use cluster labels for campaign personalization and retention strategy.',
    },
  },
];

export const sampleOptions = sampleScenarios.map((scenario) => ({
  id: scenario.id,
  label: scenario.label,
  task: scenario.task as MLTask,
  description: scenario.dataset.description,
}));

export const getSampleScenario = (id: string) =>
  sampleScenarios.find((scenario) => scenario.id === id) ?? sampleScenarios[0];
