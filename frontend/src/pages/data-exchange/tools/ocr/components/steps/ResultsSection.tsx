import React, { useState } from 'react';
import { CheckCircle, ScrollText, TableProperties, BrainCircuit, MessageCircle, Save, Database } from 'lucide-react';
import { RawTextTab } from '../tabs/RawTextTab';
import { StructuredDataTab } from '../tabs/StructuredDataTab';
import { AiInsightsTab } from '../tabs/AiInsightsTab';
import { AskDocumentTab } from '../tabs/AskDocumentTab';
import { DatasetIntegratorTab } from '../tabs/DatasetIntegratorTab';
import TryOtherFeatures, { type FeatureKey } from '../../../../../shared/TryOtherFeatures';

type ResultTab = 'raw_text' | 'structured_data' | 'ai_insights' | 'ask_document' | 'dataset_integrator';

interface ResultsSectionProps {
  files: File[];
  allResults: any[];
  selectedDocId: string;
  activeTab: ResultTab;
  resultData: any;
  pages: any[];
  fullText: string;
  hasTables: boolean;
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
  chatMessages: Array<{ role: 'user' | 'assistant'; content: string; sources?: Array<{ text_snippet: string; score: number }> }>;
  expandedSources: Record<number, boolean>;
  chatInput: string;
  isChatLoading: boolean;
  chatEmptyTitle: string;
  chatEmptyDescription: string;
  chatSuggestions: string[];
  chatEndRef: React.RefObject<HTMLDivElement>;
  onSelectedDocIdChange: (value: string) => void;
  onActiveTabChange: (tab: ResultTab) => void;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  onToggleSources: (messageIndex: number) => void;
  onSuggestionClick: (suggestion: string) => void;
  downloadStringAsFile: (content: string, filename: string, type?: string) => void;
  onSaveSession: (name: string) => void;
  datasetState: any;
  onDatasetStateChange: (state: any) => void;
  onNavigateFeature?: (feature: Exclude<FeatureKey, 'datasets'>) => void;
}

export const ResultsSection: React.FC<ResultsSectionProps> = ({
  files,
  allResults,
  selectedDocId,
  activeTab,
  resultData,
  pages,
  fullText,
  hasTables,
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
  chatMessages,
  expandedSources,
  chatInput,
  isChatLoading,
  chatEmptyTitle,
  chatEmptyDescription,
  chatSuggestions,
  chatEndRef,
  onSelectedDocIdChange,
  onActiveTabChange,
  onChatInputChange,
  onSendMessage,
  onToggleSources,
  onSuggestionClick,
  downloadStringAsFile,
  onSaveSession,
  datasetState,
  onDatasetStateChange,
  onNavigateFeature,
}) => {
  const [sessionName, setSessionName] = useState('');

  const handleSaveSession = () => {
    if (sessionName && sessionName.trim()) {
      onSaveSession(sessionName.trim());
      setSessionName('');
    }
  };

  return (
    <div className="xt-results-section fade-in">
      <div className="xt-results-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="xt-results-success">
          <CheckCircle size={24} className="success-icon" />
          <div>
            <h3 className="xt-results-title">Analysis Complete</h3>
            <p className="xt-results-subtitle">Successfully processed <b>{allResults.length} document(s)</b></p>
          </div>
        </div>
        <div className="xt-doc-selector" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: '#4a5568' }}>Select Document:</label>
          <select
            value={selectedDocId}
            onChange={(e) => {
              onSelectedDocIdChange(e.target.value);
              if (e.target.value === 'all' && activeTab !== 'ask_document') {
                onActiveTabChange('ask_document');
              }
            }}
            style={{
              padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0',
              backgroundColor: '#fff', fontSize: '14px', outline: 'none', cursor: 'pointer',
              minWidth: '220px'
            }}
          >
            <option value="all">All Documents (Batch Chat)</option>
            {allResults.map(r => (
              <option key={r.document.id} value={r.document.id}>
                {r.document.filename}
              </option>
            ))}
          </select>

          {selectedDocId !== 'all' && resultData?.document?.pages && (
            (() => {
              const pages = resultData.document.pages;
              const validConfidences = pages
                .map((p: any) => p.confidence)
                .filter((c: any) => c !== null && c !== undefined);

              if (validConfidences.length > 0) {
                const avgConfidence = validConfidences.reduce((a: number, b: number) => a + b, 0) / validConfidences.length;
                const percentage = Math.round(avgConfidence * 100);
                
                let color = '#10b981'; // Emerald-500
                if (percentage < 75) color = '#f59e0b'; // Amber-500
                if (percentage < 50) color = '#ef4444'; // Red-500

                return (
                  <div 
                    title={`Average OCR confidence for this document: ${percentage}%`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      backgroundColor: `${color}10`,
                      border: `1px solid ${color}30`,
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: color,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    {percentage}% Accuracy
                  </div>
                );
              }
              return null;
            })()
          )}

          <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0', margin: '0 8px' }} />
          <input
            type="text"
            placeholder="Enter session name..."
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            style={{
              padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0',
              backgroundColor: '#fff', fontSize: '14px', outline: 'none',
              minWidth: '180px'
            }}
          />
          <button
            onClick={handleSaveSession}
            disabled={!sessionName.trim()}
            className="xt-export-btn primary"
            style={{
               opacity: !sessionName.trim() ? 0.5 : 1, 
               cursor: !sessionName.trim() ? 'not-allowed' : 'pointer',
               padding: '8px 16px',
               height: '36px'
            }}
          >
            <Save size={14} /> Save Session
          </button>
        </div>
      </div>

      {/* ── Tab descriptions map ── */}
      {(() => {
        const TAB_DESCRIPTIONS: Record<string, { icon: React.ReactNode; label: string; description: string }> = {
          raw_text: {
            icon: <ScrollText size={15} />,
            label: 'Raw Text & Exports',
            description:
              'View the full plain-text extracted from every page of your document. Copy the text directly or download it as a .txt or .docx file for use in other applications.',
          },
          structured_data: {
            icon: <TableProperties size={15} />,
            label: 'Structured Data',
            description:
              'See any tables and key-value pairs detected inside your document, neatly organised into rows and columns. Export the results as a CSV or JSON file for downstream analysis.',
          },
          ai_insights: {
            icon: <BrainCircuit size={15} />,
            label: 'AI Insights',
            description:
              'AI-generated analysis of your document: an auto-summary, named-entity recognition, word-frequency charts, a word cloud, linguistic breakdowns, and an interactive knowledge graph.',
          },
          ask_document: {
            icon: <MessageCircle size={15} />,
            label: 'Ask Document',
            description:
              'Chat with your document using AI. Ask questions in plain language and get answers grounded in the actual document content — with source snippets shown for transparency.',
          },
          dataset_integrator: {
            icon: <Database size={15} />,
            label: 'Data Harvester',
            description:
              'Define a custom schema and let the AI extract structured records from your document into a table you can edit, filter, and export. Perfect for turning unstructured reports into datasets.',
          },
        };

        const current = TAB_DESCRIPTIONS[activeTab];
        return (
          <>
            <div className="xt-tabs">
              <button
                className={`xt-tab ${activeTab === 'raw_text' ? 'active' : ''}`}
                onClick={() => onActiveTabChange('raw_text')}
                title="View and download the raw extracted text from your document."
              >
                <ScrollText size={16} /> Raw Text & Exports
              </button>
              <button
                className={`xt-tab ${activeTab === 'structured_data' ? 'active' : ''}`}
                onClick={() => onActiveTabChange('structured_data')}
                title="View tables and key-value pairs detected in your document."
              >
                <TableProperties size={16} /> Structured Data
              </button>
              <button
                className={`xt-tab ${activeTab === 'ai_insights' ? 'active' : ''}`}
                onClick={() => onActiveTabChange('ai_insights')}
                title="See AI-generated summaries, entities, word clouds, and more."
              >
                <BrainCircuit size={16} /> AI Insights
              </button>
              <button
                className={`xt-tab ${activeTab === 'ask_document' ? 'active' : ''}`}
                onClick={() => onActiveTabChange('ask_document')}
                title="Ask questions about the document in plain language."
              >
                <MessageCircle size={16} /> Ask Document
              </button>
              <button
                className={`xt-tab ${activeTab === 'dataset_integrator' ? 'active' : ''}`}
                onClick={() => onActiveTabChange('dataset_integrator')}
                title="Extract structured data records from your document into a custom dataset."
              >
                <Database size={16} /> Data Harvester
              </button>
            </div>

            {/* ── Active-tab description banner ── */}
            {current && (
              <div className="xt-tab-desc-banner">
                <span className="xt-tab-desc-icon">{current.icon}</span>
                <div className="xt-tab-desc-body">
                  <span className="xt-tab-desc-label">{current.label}</span>
                  <span className="xt-tab-desc-text">{current.description}</span>
                </div>
              </div>
            )}
          </>
        );
      })()}

      <div className="xt-tab-content">
        {activeTab === 'raw_text' && (
          <RawTextTab
            selectedDocId={selectedDocId}
            resultData={resultData}
            fullText={fullText}
            downloadStringAsFile={downloadStringAsFile}
          />
        )}

        {activeTab === 'structured_data' && (
          <StructuredDataTab
            selectedDocId={selectedDocId}
            resultData={resultData}
            pages={pages}
            hasTables={hasTables}
            downloadStringAsFile={downloadStringAsFile}
          />
        )}

        {activeTab === 'ai_insights' && (
          <AiInsightsTab
            selectedDocId={selectedDocId}
            language={language}
            qaScore={qaScore}
            documentType={documentType}
            nlpData={nlpData}
            summary={summary}
            entities={entities}
            isNlpLoading={isNlpLoading}
            topFrequency={topFrequency}
            maxFrequency={maxFrequency}
            wordcloudSrc={wordcloudSrc}
            linguisticSrc={linguisticSrc}
            knowledgeGraphSrc={knowledgeGraphSrc}
            topPos={topPos}
            maxPosCount={maxPosCount}
            linguisticError={linguisticError}
          />
        )}

        {activeTab === 'ask_document' && (
          <AskDocumentTab
            selectedDocId={selectedDocId}
            chatMessages={chatMessages}
            expandedSources={expandedSources}
            chatInput={chatInput}
            isChatLoading={isChatLoading}
            chatEmptyTitle={chatEmptyTitle}
            chatEmptyDescription={chatEmptyDescription}
            chatSuggestions={chatSuggestions}
            chatEndRef={chatEndRef}
            onChatInputChange={onChatInputChange}
            onSendMessage={onSendMessage}
            onToggleSources={onToggleSources}
            onSuggestionClick={onSuggestionClick}
          />
        )}

        {activeTab === 'dataset_integrator' && (
          <DatasetIntegratorTab
            selectedDocId={selectedDocId}
            allResults={allResults}
            datasetState={datasetState}
            onDatasetStateChange={onDatasetStateChange}
          />
        )}
      </div>

      <TryOtherFeatures current="ocr" onNavigateFeature={onNavigateFeature} />
    </div>
  );
};
