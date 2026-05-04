import React, { useState } from 'react';
import { BrainCircuit, AlertCircle, CheckCircle, Maximize2, X } from 'lucide-react';

interface AiInsightsTabProps {
  selectedDocId: string;
  language: any;
  qaScore: string;
  documentType: string;
  nlpData: any;
  summary: string;
  entities: any[];
  isNlpLoading: boolean;
  topFrequency: Array<{ text: string; frequency: number }>;
  maxFrequency: number;
  wordcloudSrc: string | null;
  linguisticSrc: string | null;
  knowledgeGraphSrc: string | null;
  topPos: Array<[string, number]>;
  maxPosCount: number;
  linguisticError: string | null;
}

export const AiInsightsTab: React.FC<AiInsightsTabProps> = ({
  selectedDocId,
  language,
  qaScore,
  documentType,
  nlpData,
  summary,
  entities,
  isNlpLoading,
  topFrequency,
  maxFrequency,
  wordcloudSrc,
  linguisticSrc,
  knowledgeGraphSrc,
  topPos,
  maxPosCount,
  linguisticError,
}) => {
  const [isGraphFullscreen, setIsGraphFullscreen] = useState(false);
  const cleanTakeaways = Array.isArray(nlpData?.insights?.takeaways)
    ? nlpData.insights.takeaways.filter((t: any) => typeof t === 'string' && t.trim().length > 0)
    : [];
  const cleanActionItems = Array.isArray(nlpData?.insights?.action_items)
    ? nlpData.insights.action_items.filter((item: any) => item && typeof item.task === 'string' && item.task.trim().length > 0)
    : [];

  const structured = nlpData?.structured_entities || {};
  const people = Array.isArray(structured.people) ? structured.people.filter((v: any) => typeof v === 'string' && v.trim().length > 0) : [];
  const organizations = Array.isArray(structured.organizations) ? structured.organizations.filter((v: any) => typeof v === 'string' && v.trim().length > 0) : [];
  const amounts = Array.isArray(structured.amounts) ? structured.amounts.filter((v: any) => typeof v === 'string' && v.trim().length > 0) : [];
  const dates = Array.isArray(structured.dates) ? structured.dates.filter((v: any) => typeof v === 'string' && v.trim().length > 0) : [];
  const relationships = Array.isArray(structured.relationships) ? structured.relationships.filter((v: any) => typeof v === 'string' && v.trim().length > 0) : [];
  const hasStructuredEntities = [people, organizations, amounts, dates, relationships].some((arr) => arr.length > 0);
  return (
    <div className="xt-tab-panel">
      {selectedDocId === 'all' ? (
        <div className="xt-empty-state" style={{ textAlign: 'center', padding: '40px' }}>
          <BrainCircuit size={48} style={{ opacity: 0.3, marginBottom: '16px', display: 'inline-block' }} />
          <p style={{ color: '#718096', fontSize: '15px' }}>Please select a specific document to view its AI Insights.</p>
        </div>
      ) : (
        <React.Fragment>
          <div className="xt-metrics-grid">
            <div className="xt-metric-card">
              <span className="xt-metric-label">Detected Language</span>
              <span className="xt-metric-value">{language?.name ? language.name.charAt(0).toUpperCase() + language.name.slice(1) : "Unknown"}</span>
            </div>
            <div className="xt-metric-card">
              <span className="xt-metric-label">Language Confidence</span>
              <span className="xt-metric-value">{((language?.confidence || 0)*100).toFixed(1)}%</span>
            </div>
            <div className="xt-metric-card">
              <span className="xt-metric-label">Quality Assessment</span>
              <span className="xt-metric-value">{qaScore}</span>
            </div>
            <div className="xt-metric-card">
              <span className="xt-metric-label">Document Format</span>
              <span className="xt-metric-value">{documentType}</span>
            </div>
          </div>

          <div className="xt-insight-section">
            <h3>Document Summary</h3>
            <div className="xt-summary-box">
              {nlpData?.summary || nlpData?.insights?.summary || summary}
            </div>
          </div>

          <div className="xt-insight-section">
            <h3>Risk & Compliance Panel</h3>
            {isNlpLoading ? (
               <div className="xt-loading-state">Analyzing document risks...</div>
            ) : nlpData?.risk_flags?.length > 0 ? (
               <div className="xt-entities-flex" style={{ flexDirection: 'column' }}>
                 {nlpData.risk_flags.map((flag: any, i: number) => (
                   <div key={i} className={`xt-error-banner`} style={{ marginBottom: '8px', padding: '10px 16px' }}>
                     <AlertCircle size={16} /> <strong>{flag.category}</strong>: {flag.message}
                   </div>
                 ))}
               </div>
            ) : (
               <div className="xt-summary-box" style={{ background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46', display: 'flex', alignItems: 'center', gap: '8px' }}>
                 <CheckCircle size={16} /> No critical risk or compliance flags detected.
               </div>
            )}
          </div>

          <div className="xt-insight-section">
            <h3>Key Insights & Actionable Tasks</h3>
            {isNlpLoading ? (
               <div className="xt-loading-state">Extracting actions...</div>
            ) : (cleanTakeaways.length > 0 || cleanActionItems.length > 0) ? (
               <div className="xt-nlp-grid">
                 {cleanTakeaways.length > 0 && (
                   <div className="xt-nlp-box">
                     <strong style={{ display: 'block', marginBottom: '10px' }}>Top Takeaways / Highlights</strong>
                     <ul className="xt-workflow-list">
                       {cleanTakeaways.map((t: string, i: number) => <li key={i}>{t}</li>)}
                     </ul>
                   </div>
                 )}
                 {cleanActionItems.length > 0 && (
                   <div className="xt-nlp-box">
                     <strong style={{ display: 'block', marginBottom: '10px' }}>Action Items Required</strong>
                     <ul className="xt-workflow-list">
                       {cleanActionItems.map((item: any, i: number) => (
                         <li key={i}>
                            <span><strong>{item.task}</strong></span>
                            {item.due_date && <span className="xt-entity-type">{item.due_date}</span>}
                            {item.assignee && <span className="xt-dataset-badge">{item.assignee}</span>}
                         </li>
                       ))}
                     </ul>
                   </div>
                 )}
               </div>
            ) : (
               <div
                 className="xt-viz-placeholder"
                 style={{
                   minHeight: '96px',
                   height: 'auto',
                   padding: '18px 20px',
                   justifyContent: 'flex-start',
                   color: 'var(--t-primary, #eef1ff)',
                   textAlign: 'left'
                 }}
               >
                 Standard insights are available, but no actionable tasks were extracted for this document.
               </div>
            )}
          </div>

          <div className="xt-insight-section">
            <h3>Key Entity Dashboard</h3>
            {isNlpLoading ? (
              <div className="xt-loading-state">Mapping relationships...</div>
            ) : hasStructuredEntities ? (
              <div className="xt-nlp-grid">
                {people.length > 0 && (
                  <div className="xt-nlp-box"><strong>People:</strong> {people.join(', ')}</div>
                )}
                {organizations.length > 0 && (
                  <div className="xt-nlp-box"><strong>Organizations:</strong> {organizations.join(', ')}</div>
                )}
                {amounts.length > 0 && (
                  <div className="xt-nlp-box"><strong>Amounts:</strong> {amounts.join(', ')}</div>
                )}
                {dates.length > 0 && (
                  <div className="xt-nlp-box"><strong>Dates:</strong> {dates.join(', ')}</div>
                )}
                {relationships.length > 0 && (
                  <div className="xt-nlp-box full-width">
                    <strong>Key Relationships:</strong>
                    <ul className="xt-workflow-list" style={{ marginTop: '10px' }}>
                       {relationships.map((r: string, i: number) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                {knowledgeGraphSrc && (
                  <div className="xt-nlp-box full-width">
                    <div className="xt-kg-header">
                      <strong>Knowledge Graph</strong>
                      <button
                        type="button"
                        className="xt-kg-fullscreen-btn"
                        onClick={() => setIsGraphFullscreen(true)}
                        title="View fullscreen"
                        aria-label="View knowledge graph in fullscreen"
                      >
                        <Maximize2 size={15} />
                      </button>
                    </div>
                    <div className="xt-kg-wrapper">
                      <img
                        src={knowledgeGraphSrc}
                        alt="Knowledge graph generated from key relationships"
                        className="xt-viz-img xt-kg-image"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : entities && entities.length > 0 ? (
              <div className="xt-entities-flex">
                {entities.slice(0, 15).map((e: any, i: number) => (
                  <span key={i} className="xt-entity-tag">
                    {e.text} <span className="xt-entity-type">{e.type}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div
                className="xt-viz-placeholder"
                style={{
                  minHeight: '96px',
                  height: 'auto',
                  padding: '18px 20px',
                  justifyContent: 'flex-start',
                  color: 'var(--t-primary, #eef1ff)',
                  textAlign: 'left'
                }}
              >
                No entities were extracted for this document.
              </div>
            )}
          </div>

          <div className="xt-insight-section">
            <h3>Advanced Visualizations</h3>
            <div className="xt-viz-grid">
              <div className="xt-viz-box">
                <h4>Word Frequency Distribution</h4>
                {topFrequency.length > 0 ? (
                  <div className="xt-chart-list">
                    {topFrequency.map((item) => (
                      <div key={item.text} className="xt-chart-row">
                        <div className="xt-chart-label">{item.text}</div>
                        <div className="xt-chart-bar-wrap">
                          <div
                            className="xt-chart-bar"
                            style={{ width: `${(item.frequency / maxFrequency) * 100}%` }}
                          />
                        </div>
                        <div className="xt-chart-value">{item.frequency}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="xt-viz-placeholder">{isNlpLoading ? 'Generating...' : 'Not available'}</div>
                )}
              </div>
              <div className="xt-viz-box">
                <h4>Document Word Cloud</h4>
                {wordcloudSrc ? (
                  <img src={wordcloudSrc} alt="Word Cloud" className="xt-viz-img" />
                ) : topFrequency.length > 0 ? (
                  <div className="xt-entities-flex">
                    {topFrequency.map((item) => (
                      <span key={item.text} className="xt-entity-tag">
                        {item.text} <span className="xt-entity-type">{item.frequency}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="xt-viz-placeholder">{isNlpLoading ? 'Generating...' : 'Not available'}</div>
                )}
              </div>
              <div className="xt-viz-box">
                <h4>Part-of-Speech Grammatical Distribution</h4>
                {linguisticSrc ? (
                  <img src={linguisticSrc} alt="Linguistic Analysis" className="xt-viz-img" />
                ) : topPos.length > 0 ? (
                  <div className="xt-chart-list">
                    {topPos.map(([label, count]) => (
                      <div key={label} className="xt-chart-row">
                        <div className="xt-chart-label">{label}</div>
                        <div className="xt-chart-bar-wrap">
                          <div
                            className="xt-chart-bar"
                            style={{ width: `${(count / maxPosCount) * 100}%` }}
                          />
                        </div>
                        <div className="xt-chart-value">{count}</div>
                      </div>
                    ))}
                  </div>
                ) : linguisticError ? (
                  <div className="xt-summary-box">{linguisticError}</div>
                ) : (
                  <div className="xt-viz-placeholder">{isNlpLoading ? 'Generating...' : 'Not available'}</div>
                )}
              </div>
            </div>
          </div>
        </React.Fragment>
      )}

      {isGraphFullscreen && knowledgeGraphSrc && (
        <div className="xt-kg-modal-backdrop" role="dialog" aria-modal="true" aria-label="Knowledge graph fullscreen view">
          <div className="xt-kg-modal">
            <div className="xt-kg-modal-header">
              <strong>Knowledge Graph</strong>
              <button
                type="button"
                className="xt-kg-modal-close"
                onClick={() => setIsGraphFullscreen(false)}
                title="Close fullscreen"
                aria-label="Close fullscreen"
              >
                <X size={18} />
              </button>
            </div>
            <div className="xt-kg-modal-body">
              <img
                src={knowledgeGraphSrc}
                alt="Knowledge graph fullscreen"
                className="xt-kg-modal-img"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
