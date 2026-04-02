import { Database, Brain, Lightbulb, ArrowRight, Sparkles } from 'lucide-react';
import './HomeView.css';

interface HomeViewProps {
  onNavigate: (viewId: string) => void;
}

// ── Feature data ──────────────────────────────────────────────────────────────
const featureData = [
  {
    id: 'data',
    icon: <Database size={24} />,
    title: 'Data Exchange',
    description:
      'Access powerful data processing tools including OCR, visualization, feature engineering, and anonymization capabilities for your datasets.',
  },
  {
    id: 'model',
    icon: <Brain size={24} />,
    title: 'Model Exchange',
    description:
      'Explore and build ML models with AutoML capabilities. Train, evaluate, and deploy models with ease using our automated machine learning pipeline.',
  },
  {
    id: 'solution',
    icon: <Lightbulb size={24} />,
    title: 'Solution Marketplace',
    description:
      'Discover real-world AI use cases, implementation patterns, and best practices. Connect with our community to learn and share solutions.',
  },
];

// ── HomeView ──────────────────────────────────────────────────────────────────
const HomeView = ({ onNavigate }: HomeViewProps) => {
  return (
    <div className="view-animate-in">

      {/* ── Hero ── */}
      <div className="hero-section">
        <div className="hero-content">
          <div className="hero-badge">
            <Sparkles size={14} className="hero-badge-icon" />
            <span>AI Innovation Hub</span>
          </div>
          <h1 className="hero-title">Welcome to AI Sphere</h1>
          <p className="hero-subtitle">
            Your AI Innovation Hub - Exchange Data, Models, and Use Cases. Everything you{' '}
            <br />
            need to build AI solutions in one platform.
          </p>
        </div>
      </div>

      {/* ── Features grid ── */}
      <div className="features-container">
        <div className="features-grid">
          {featureData.map((feature) => (
            <div key={feature.id} className="feature-card">
              <div className="feature-card-content">
                <div className="feature-icon-wrapper">{feature.icon}</div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
              </div>
              <button
                className="feature-button"
                onClick={() => onNavigate(feature.id)}
              >
                Explore <ArrowRight size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default HomeView;
