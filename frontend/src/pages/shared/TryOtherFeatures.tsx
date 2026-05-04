import {
  BarChart2,
  Cpu,
  Database,
  Lock,
  ScanLine,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import type React from 'react';
import { useNavigate } from 'react-router-dom';
import './TryOtherFeatures.css';

export type FeatureKey = 'ocr' | 'viz' | 'feat' | 'anon' | 'automl' | 'datasets';

type Props = {
  current: FeatureKey;
  onNavigateFeature?: (feature: Exclude<FeatureKey, 'datasets'>) => void;
  title?: string;
  subtitle?: string;
};

const FEATURES: Array<{
  key: FeatureKey;
  title: string;
  description: string;
  tone: string;
  Icon: React.ElementType;
}> = [
  {
    key: 'ocr',
    title: 'OCR Conversion',
    description: 'Extract text, tables, and insights from scanned documents.',
    tone: 'orange',
    Icon: ScanLine,
  },
  {
    key: 'viz',
    title: 'Data Visualization',
    description: 'Explore datasets with charts, summaries, and AI analysis.',
    tone: 'amber',
    Icon: BarChart2,
  },
  {
    key: 'feat',
    title: 'Feature Engineering',
    description: 'Transform raw data into ML-ready features.',
    tone: 'violet',
    Icon: Sparkles,
  },
  {
    key: 'anon',
    title: 'Data Anonymization',
    description: 'Protect sensitive data before sharing or modeling.',
    tone: 'rose',
    Icon: Lock,
  },
  {
    key: 'automl',
    title: 'AutoML Wizard',
    description: 'Train, compare, and evaluate machine learning models.',
    tone: 'blue',
    Icon: Cpu,
  },
  {
    key: 'datasets',
    title: 'Open Datasets',
    description: 'Browse public datasets and reuse them across modules.',
    tone: 'green',
    Icon: Database,
  },
];

export default function TryOtherFeatures({
  current,
  onNavigateFeature,
  title = 'Try Other Features',
  subtitle = 'Continue your workflow with another Data2Insight AI Capabilities',
}: Props) {
  const navigate = useNavigate();

  const openFeature = (key: FeatureKey) => {
    if (key === 'datasets') {
      navigate('/Data2Insightai/datasets');
      return;
    }

    if (key === 'automl') {
      navigate('/Data2Insightai/model');
      return;
    }

    if (onNavigateFeature) {
      onNavigateFeature(key);
      return;
    }

    sessionStorage.setItem('home-start-tool', key);
    navigate('/Data2Insightai/data');
  };

  const visibleFeatures = FEATURES.filter((feature) => feature.key !== current);

  return (
    <section className="tof-section" aria-labelledby="tof-title">
      <div className="tof-header">
        <div>
          <h3 id="tof-title">{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className="tof-grid">
        {visibleFeatures.map(({ key, title, description, tone, Icon }) => (
          <button
            key={key}
            type="button"
            className="tof-card"
            onClick={() => openFeature(key)}
            aria-label={`Open ${title}`}
          >
            <span className={`tof-icon tof-icon--${tone}`}>
              <Icon size={22} />
            </span>

            <span className="tof-card-copy">
              <strong>{title}</strong>
              <span>{description}</span>
            </span>

            <ArrowRight className="tof-arrow" size={18} />
          </button>
        ))}
      </div>
    </section>
  );
}
