import React from 'react';
import { Activity } from 'lucide-react';

interface ProcessingSectionProps {
  progress: number;
  statusText: string;
  onCancel: () => void;
}

export const ProcessingSection: React.FC<ProcessingSectionProps> = ({
  progress,
  statusText,
  onCancel,
}) => {
  return (
    <div className="xt-processing-section">
      <div className="xt-processing-card">
        <Activity size={32} className="xt-pulse-icon" />
        <h3 className="xt-processing-title">Processing Document</h3>
        <p className="xt-processing-status">{statusText}</p>
        <div className="xt-progress-bar-container">
          <div
            className="xt-progress-fill"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <p className="xt-progress-text">{progress}% Complete</p>
        <div className="xt-processing-subtext" style={{ marginBottom: '20px' }}>This may take a minute depending on the document length and complexity.</div>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px', borderRadius: '6px', border: '1px solid #e2e8f0',
            backgroundColor: '#fff', color: '#ef4444', fontSize: '13px', outline: 'none', cursor: 'pointer',
            fontWeight: 500
          }}
        >
          Cancel Extraction
        </button>
      </div>
    </div>
  );
};