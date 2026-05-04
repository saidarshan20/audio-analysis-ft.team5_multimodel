import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart2,
  CheckCircle2,
  Download,
  Droplet,
  FileText,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react';
import '../ToolPage.css';
import './FeatureEngineering.css';
import DataPreviewStep from './DataPreviewStep.tsx';
import DataProfileStep from './DataProfileStep.tsx';
import DataQualityStep from './DataQualityStep.tsx';
import ExportStep from './ExportStep.tsx';
import FeatureGenerationStep from './FeatureGenerationStep.tsx';
import SelectDatasetStep from './SelectDatasetStep.tsx';
import AuditLogsViewer from './audit/AuditLogsViewer.tsx';
import { useAuth } from '../../../../auth/authContext';
import { API_BASE_URL } from '../utils/api';
import type { FeatureKey } from '../../../shared/TryOtherFeatures';

type StepId = 'select' | 'profile' | 'quality' | 'generate' | 'preview' | 'export';

type FeatureEngineeringPageProps = {
  onBack?: () => void;
  onNavigateFeature?: (feature: Exclude<FeatureKey, 'datasets'>) => void;
};

type DatasetInfo = {
  name: string;
  rows: number;
  columns: number;
};

type SelectDatasetResult = {
  sessionId: string;
  info?: Record<string, unknown>;
  profile?: Record<string, unknown>;
};

type StepResult = {
  preview?: Record<string, unknown>;
};

const STEPS: { id: StepId; title: string; icon: React.ElementType }[] = [
  { id: 'select', title: 'Select Dataset', icon: FileText },
  { id: 'profile', title: 'Data Profile', icon: BarChart2 },
  { id: 'quality', title: 'Data Quality', icon: Droplet },
  { id: 'generate', title: 'Feature Generation', icon: Star },
  { id: 'preview', title: 'Data Preview', icon: TrendingUp },
  { id: 'export', title: 'Export', icon: Download },
];

const STEP_ID_TO_INDEX: Record<string, number> = {
  select: 0, profile: 1, quality: 2, generate: 3, preview: 4, export: 5,
};

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const normalizeDatasetInfo = (raw?: Record<string, unknown> | null): DatasetInfo => {
  const name =
    (typeof raw?.name === 'string' && raw.name) ||
    (typeof raw?.dataset_name === 'string' && raw.dataset_name) ||
    (typeof raw?.file_name === 'string' && raw.file_name) ||
    'Dataset';

  const rows = toNumber(raw?.rows ?? raw?.num_rows ?? raw?.row_count, 0);
  const columns = toNumber(raw?.columns ?? raw?.num_columns ?? raw?.column_count, 0);

  return { name, rows, columns };
};

const FeatureEngineeringPage = ({ onBack, onNavigateFeature }: FeatureEngineeringPageProps) => {
  const { user } = useAuth();
  const username = user?.username ?? 'anonymous';

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | undefined>();
  const [profileData, setProfileData] = useState<Record<string, unknown> | undefined>();
  const [previewData, setPreviewData] = useState<Record<string, unknown> | undefined>();
  const [qualityData, setQualityData] = useState<Record<string, unknown> | undefined>();
  const [initialGenStage, setInitialGenStage] = useState(0);
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  // ─── Auto-save progress on every step change ──────────────────────────────
  const saveProgress = useCallback(
    (step: string, stage = 0) => {
      if (!sessionId) return;
      fetch(`${API_BASE_URL}/team2_feature_eng/sessions/${sessionId}/save-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, stage }),
      }).catch(() => {}); // fire-and-forget
    },
    [sessionId]
  );

  const nextStep = () => {
    setCurrentStepIndex((prev) => {
      const next = Math.min(prev + 1, STEPS.length - 1);
      saveProgress(STEPS[next].id);
      return next;
    });
  };

  const prevStep = () => {
    setCurrentStepIndex((prev) => {
      const next = Math.max(prev - 1, 0);
      saveProgress(STEPS[next].id);
      return next;
    });
  };

  const handleUploadComplete = (data: SelectDatasetResult) => {
    setSessionId(data.sessionId);
    setDatasetInfo(normalizeDatasetInfo(data.info));
    setProfileData(data.profile ?? {});
    setCurrentStepIndex(1);
    saveProgress('profile');
  };

  // ─── Resume handler (called from SelectDatasetStep) ───────────────────────
  const handleResumeSession = useCallback(
    async (resumeSessionId: string) => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/team2_feature_eng/sessions/${resumeSessionId}/resume`,
          { method: 'POST' }
        );
        if (!res.ok) throw new Error('Resume failed');
        const data = (await res.json()) as Record<string, unknown>;

        setSessionId(resumeSessionId);

        // Restore dataset info
        const rows = toNumber(data.rows, 0);
        const cols = toNumber(data.cols, 0);
        const dsName = typeof data.dataset_name === 'string' ? data.dataset_name : 'Dataset';
        setDatasetInfo({ name: dsName, rows, columns: cols });

        // Restore cached data
        if (data.profile_data && typeof data.profile_data === 'object') {
          setProfileData(data.profile_data as Record<string, unknown>);
        }
        if (data.quality_data && typeof data.quality_data === 'object') {
          setQualityData(data.quality_data as Record<string, unknown>);
        }

        // Restore step position
        const step = typeof data.current_step === 'string' ? data.current_step : 'profile';
        const stage = toNumber(data.current_stage, 0);
        const stepIndex = STEP_ID_TO_INDEX[step] ?? 1;
        setCurrentStepIndex(stepIndex);
        if (step === 'generate') {
          setInitialGenStage(stage);
        }
      } catch (err) {
        console.error('Failed to resume session:', err);
        alert('Failed to resume session. Starting fresh.');
      }
    },
    []
  );

  const handleQualityComplete = (result?: StepResult) => {
    if (result?.preview && typeof result.preview === 'object') {
      setPreviewData(result.preview);
    }
    nextStep();
  };

  const handleFeatureComplete = (result?: StepResult) => {
    if (result?.preview && typeof result.preview === 'object') {
      setPreviewData(result.preview);
    }
    nextStep();
  };

  const goToStep = (index: number) => {
    if (index <= currentStepIndex) {
      setCurrentStepIndex(index);
      saveProgress(STEPS[index].id);
    }
  };

  const stepperNodes = useMemo(() => {
    const nodes: React.ReactNode[] = [];

    STEPS.forEach((step, index) => {
      const Icon = step.icon;
      const isActive = index === currentStepIndex;
      const isCompleted = index < currentStepIndex;

      if (index > 0) {
        nodes.push(
          <div key={`conn-${step.id}`} className={`xt-connector${isCompleted ? ' done' : ''}`} />
        );
      }

      nodes.push(
        <div
          key={step.id}
          className={`xt-step${index <= currentStepIndex ? '' : ' locked'}`}
          onClick={() => goToStep(index)}
        >
          <div className={`xt-step-circle${isActive ? ' active' : isCompleted ? ' done' : ''}`}>
            {isCompleted ? <CheckCircle2 size={16} /> : <Icon size={16} />}
          </div>
          <span className={`xt-step-label${isActive ? ' active' : isCompleted ? ' done' : ''}`}>
            {step.title}
          </span>
        </div>
      );
    });

    return nodes;
  }, [currentStepIndex]);

  return (
    <main className="xt-page container wrapper">
      {onBack && (
        <button className="xt-back-btn" onClick={onBack}>
          <ArrowLeft size={14} /> Back to Data Tools
        </button>
      )}

      <div className="xt-header page-header">
        <div className="xt-header-icon title-icon">
          <Sparkles size={26} />
        </div>
        <div>
          <h1 className="xt-header-title">AI Feature Engineering</h1>
          <p className="xt-header-subtitle">Automated feature generation powered by LLMs</p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button 
            className={`btn-secondary ${showAuditLogs ? 'active' : ''}`}
            onClick={() => setShowAuditLogs(!showAuditLogs)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <FileText size={16} />
            {showAuditLogs ? 'Hide Activity Log' : 'Activity Log'}
          </button>
        </div>
      </div>

      <div className="xt-stepper-card card stepper-container">
        <div className="xt-stepper">{stepperNodes}</div>
      </div>

      <div className="step-content">
        {currentStepIndex === 0 && (
          <SelectDatasetStep
            onNext={handleUploadComplete}
            username={username}
            onResume={handleResumeSession}
          />
        )}

        {currentStepIndex === 1 && (
        <DataProfileStep
          onNext={nextStep}
          onPrev={prevStep}
          data={profileData}
          datasetInfo={datasetInfo}
        />
        )}

        {currentStepIndex === 2 && (
        <DataQualityStep
          onNext={handleQualityComplete}
          onPrev={prevStep}
          sessionId={sessionId}
          datasetInfo={datasetInfo}
          cachedData={qualityData}
          onDataLoaded={setQualityData}
        />
        )}

        {currentStepIndex === 3 && (
        <FeatureGenerationStep
          onNext={handleFeatureComplete}
          onPrev={prevStep}
          sessionId={sessionId}
          datasetInfo={datasetInfo}
          initialStageIndex={initialGenStage}
          onStageChange={(stage: number) => saveProgress('generate', stage)}
        />
        )}

        {currentStepIndex === 4 && (
        <DataPreviewStep
          onNext={nextStep}
          onPrev={prevStep}
          data={previewData}
          datasetInfo={datasetInfo}
          sessionId={sessionId}
        />
        )}

        {currentStepIndex === 5 && (
        <ExportStep
          onPrev={prevStep}
          datasetInfo={datasetInfo}
          sessionId={sessionId}
          onNavigateFeature={onNavigateFeature}
        />
        )}
      </div>

      {/* Activity Logs Panel */}
      {showAuditLogs && sessionId && (
        <div style={{ marginTop: '24px' }}>
          <AuditLogsViewer sessionId={sessionId} />
        </div>
      )}
    </main>
  );
};

export default FeatureEngineeringPage;
