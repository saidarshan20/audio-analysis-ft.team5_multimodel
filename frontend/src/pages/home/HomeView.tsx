import { Database, Brain, Lightbulb, Sparkles, ArrowRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import './HomeView.css';
import watermarkLogo from '../../assets/looplogo.png';

interface HomeViewProps {
  onNavigate: (viewId: string) => void;
}

// ── Feature data ──────────────────────────────────────────────────────────────
const featureData = [
  {
    id: 'data',
    icon: <Database size={22} />,
    label: 'Data Exchange',
    tag: '04 tools',
    description:
      'OCR, visualization, feature engineering, and anonymization—every data prep capability you need on one surface.',
    accent: '#38bdf8',
    accentRgb: '56,189,248',
  },
  {
    id: 'model',
    icon: <Brain size={22} />,
    label: 'Model Exchange',
    tag: 'AutoML',
    description:
      'Train, evaluate and deploy ML models through a guided AutoML pipeline. Experiment at scale without the boilerplate.',
    accent: '#fb8c36',
    accentRgb: '251,140,54',
  },
  {
    id: 'solution',
    icon: <Lightbulb size={22} />,
    label: 'Solution Hub',
    tag: 'Community',
    description:
      'Real-world AI use-cases, implementation blueprints, and community patterns—discover and share what works.',
    accent: '#a78bfa',
    accentRgb: '167,139,250',
  },
];

// ── Card component ────────────────────────────────────────────────────────────
interface CardProps {
  feature: (typeof featureData)[0];
  onNavigate: (id: string) => void;
  index: number;
}
const FeatureCard = ({ feature, onNavigate, index }: CardProps) => {
  const [hovered, setHovered] = useState(false);
  return (
    <article
      className="fc fc--icon-only"
      data-index={index}
      style={{ '--accent': feature.accent, '--accent-rgb': feature.accentRgb } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="fc-corner" />
      <div className="fc-body">
        <div className="fc-icon">{feature.icon}</div>
        <span className="fc-tag">{feature.tag}</span>
        <h3 className="fc-title">{feature.label}</h3>
        <p className="fc-desc">{feature.description}</p>
      </div>
      <button
        className={`fc-bubble${hovered ? ' fc-bubble--open' : ''}`}
        onClick={() => onNavigate(feature.id)}
        aria-label={`Explore ${feature.label}`}
      >
        <span className="fc-bubble-icon"><ArrowRight size={16} /></span>
        <span className="fc-bubble-text">Explore</span>
      </button>
    </article>
  );
};

// ── HomeView ──────────────────────────────────────────────────────────────────
const HomeView = ({ onNavigate }: HomeViewProps) => {
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [startFeature, setStartFeature] = useState('');
  const [isFeatureOpen, setIsFeatureOpen] = useState(false);

  const startOptions = [
    { value: 'ocr', label: 'OCR Conversion' },
    { value: 'viz', label: 'Data Visualization' },
    { value: 'feat', label: 'Feature Engineering' },
    { value: 'anon', label: 'Data Anonymization' },
    { value: 'automl', label: 'AutoML' },
  ];

  const handleStartProject = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!projectName.trim() || !startFeature) return;

    if (startFeature === 'automl') {
      setShowProjectModal(false);
      setIsFeatureOpen(false);
      onNavigate('model');
      return;
    }

    sessionStorage.setItem('home-start-tool', startFeature);
    setShowProjectModal(false);
    setIsFeatureOpen(false);
    onNavigate('data');
  };

  return (
    <div className="view-animate-in hv-shell">
      {/* centered watermark */}
      <div className="hv-watermark" aria-hidden="true">
        <div className="hv-watermark-halo" />
        <img src={watermarkLogo} alt="" className="hv-watermark-img" />
      </div>

      <div className="hv-top">
        {/* hero */}
        <header className="hv-hero">
          <h1 className="hv-hero-title">Welcome to&nbsp;<em>AI&nbsp;Sphere</em></h1>
          <div className="hv-hero-badge">
            <Sparkles size={13} />
            <span>AI Innovation Hub</span>
          </div>
          <p className="hv-hero-sub">
            Exchange Data, Models, and Use Cases—everything you need<br />
            to build AI solutions in one unified platform.
          </p>
          <button className="hv-hero-cta" onClick={() => setShowProjectModal(true)}>
            <span>Start New Project</span>
            <ArrowRight size={16} />
          </button>
        </header>

      </div>

      {/* cards */}
      <section className="hv-cards">
        {featureData.map((f, i) => (
          <FeatureCard key={f.id} feature={f} onNavigate={onNavigate} index={i} />
        ))}
      </section>

      {showProjectModal && (
        <div className="hv-modal-backdrop" onClick={() => { setShowProjectModal(false); setIsFeatureOpen(false); }}>
          <div className="hv-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="hv-modal-close"
              type="button"
              onClick={() => { setShowProjectModal(false); setIsFeatureOpen(false); }}
              aria-label="Close"
            >
              x
            </button>

            <h3 className="hv-modal-title">Start New Project</h3>
            <p className="hv-modal-sub">Create a new data processing project and select features to include.</p>

            <form className="hv-modal-form" onSubmit={handleStartProject}>
              <label className="hv-modal-label" htmlFor="project-name">Project Name</label>
              <input
                id="project-name"
                className="hv-modal-input"
                placeholder="Enter project name..."
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />

              <label className="hv-modal-label" htmlFor="start-feature">Where to Start</label>
              <div className="hv-select" id="start-feature">
                <button
                  type="button"
                  className={`hv-select-trigger${isFeatureOpen ? ' is-open' : ''}`}
                  onClick={() => setIsFeatureOpen((v) => !v)}
                >
                  <span className={!startFeature ? 'is-placeholder' : ''}>
                    {startOptions.find((o) => o.value === startFeature)?.label ?? 'Select starting feature...'}
                  </span>
                  <ChevronDown size={16} />
                </button>

                {isFeatureOpen && (
                  <div className="hv-select-menu">
                    {startOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`hv-select-option${startFeature === opt.value ? ' is-active' : ''}`}
                        onClick={() => {
                          setStartFeature(opt.value);
                          setIsFeatureOpen(false);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="hv-modal-actions">
                <button type="button" className="hv-modal-btn hv-modal-btn--ghost" onClick={() => { setShowProjectModal(false); setIsFeatureOpen(false); }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="hv-modal-btn hv-modal-btn--primary"
                  disabled={!projectName.trim() || !startFeature}
                >
                  Start Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomeView;
