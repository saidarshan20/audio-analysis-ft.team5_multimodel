import { useEffect, useMemo, useState } from 'react';
import type { SampleScenario } from '../demoData';

interface Props {
  scenario: SampleScenario;
  onComplete: () => void;
  onBack?: () => void;
}

const STAGES = ['queued', 'data_check', 'features', 'training', 'evaluation', 'complete'];
const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  data_check: 'Data Check',
  features: 'Features',
  training: 'Training',
  evaluation: 'Evaluation',
  complete: 'Complete',
};

export default function StepDemoTraining({ scenario, onComplete, onBack }: Props) {
  const [tick, setTick] = useState(0);
  const progress = Math.min(100, tick * 20);
  const currentStage = STAGES[Math.min(STAGES.length - 1, Math.floor(progress / 20))];
  const visibleLogs = useMemo(() => scenario.logs.slice(0, Math.max(1, tick + 1)), [scenario.logs, tick]);
  const isComplete = progress >= 100;

  useEffect(() => {
    if (isComplete) return;
    const timeout = window.setTimeout(() => setTick((value) => value + 1), 650);
    return () => window.clearTimeout(timeout);
  }, [isComplete, tick]);

  useEffect(() => {
    if (!isComplete) return;
    const timeout = window.setTimeout(onComplete, 900);
    return () => window.clearTimeout(timeout);
  }, [isComplete, onComplete]);

  return (
    <div className="aw-step-content">
      <div className="aw-step-main">
        {onBack && (
          <button className="aw-back-btn" type="button" onClick={onBack}>
            ← Back to Configuration
          </button>
        )}

        <div className="aw-review-banner">
          <span>Using prepared sample metrics so the walkthrough finishes quickly.</span>
          {isComplete && (
            <button className="aw-btn aw-btn--primary" type="button" onClick={onComplete}>
              View Results →
            </button>
          )}
        </div>

        <div className="aw-progress-section">
          <div className="aw-progress-label">
            {STAGE_LABELS[currentStage]} · {progress}%
          </div>
          <div className="aw-progress-bar-bg">
            <div className="aw-progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="aw-stage-pipeline">
            {STAGES.map((stage, index) => {
              const stageIndex = STAGES.indexOf(currentStage);
              return (
                <div key={stage} className="aw-stage-item-wrap">
                  <div className={`aw-stage-dot ${index <= stageIndex ? 'aw-stage-dot--done' : ''} ${index === stageIndex ? 'aw-stage-dot--active' : ''}`} />
                  <span className="aw-stage-label">{STAGE_LABELS[stage]}</span>
                  {index < STAGES.length - 1 && <div className={`aw-stage-line ${index < stageIndex ? 'aw-stage-line--done' : ''}`} />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="aw-logs-section">
          <div className="aw-logs-header">
            <h4>{scenario.task === 'clustering' ? 'Model Search Logs' : 'Training Logs'}</h4>
            <span className="aw-ws-status aw-ws-status--connected">● Connected</span>
          </div>
          <div className="aw-logs-terminal">
            {visibleLogs.map((message, index) => (
              <div key={message} className="aw-log-line">
                <span className="aw-log-time">[{new Date(Date.now() - (visibleLogs.length - index) * 1000).toLocaleTimeString()}]</span>
                <span className="aw-log-msg">{message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="aw-step-sidebar">
        <div className="aw-training-status-panel">
          <h4>Training Status</h4>
          <div className="aw-status-row">
            <span>Status</span>
            <span className={`aw-status-badge ${isComplete ? 'aw-status-badge--complete' : 'aw-status-badge--running'}`}>
              {isComplete ? 'Complete' : 'Running'}
            </span>
          </div>
          <div className="aw-status-row">
            <span>Mode</span>
            <span className="aw-status-value">Sample</span>
          </div>
          <div className="aw-status-row">
            <span>{scenario.task === 'clustering' ? 'Candidates Tested' : 'Models Trained'}</span>
            <span className="aw-status-value">{scenario.leaderboard.models.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
