import { Sparkles } from 'lucide-react';
import { TextAnalysisResult } from '../services';

interface Props {
  result: TextAnalysisResult;
}

const TextAnalysisView = ({ result }: Props) => (
  <div className="result-card">
    <div className="summary-section">
      <h4><Sparkles size={16} /> Summary</h4>
      <p>{result.summary}</p>
    </div>
    <div className="stats-grid">
      <div className="stat-pill positive">Positive: {(result.sentiment.positive * 100).toFixed(0)}%</div>
      <div className="stat-pill negative">Negative: {(result.sentiment.negative * 100).toFixed(0)}%</div>
      <div className="stat-pill neutral">Neutral: {(result.sentiment.neutral * 100).toFixed(0)}%</div>
    </div>
    {result.timeline && result.timeline.length > 0 && (
      <div className="timeline-section">
        <h4>Timeline</h4>
        <div className="timeline-list">
          {result.timeline.map((ev, i) => (
            <div key={i} className="timeline-item">
              <span className="date">{ev.date}</span>
              <span className="desc">{ev.description}</span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);

export default TextAnalysisView;
