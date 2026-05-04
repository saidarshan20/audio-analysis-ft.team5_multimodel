import React from 'react';
import { ArrowLeft, ScanLine, AlertCircle, PanelRight, RefreshCcw } from 'lucide-react';
import './ToolPage.css';
import { Stepper } from './components/shared/Stepper';
import { UploadSection } from './components/steps/UploadSection';
import { ProcessingSection } from './components/steps/ProcessingSection';
import { ResultsSection } from './components/steps/ResultsSection';
import { DocumentPreviewSidebar } from './components/shared/DocumentPreviewSidebar';
import { GlobalSearch } from './components/shared/GlobalSearch';
import { useFileUpload } from './hooks/useFileUpload';
import { useOcrPipeline } from './hooks/useOcrPipeline';
import { useAiInsights } from './hooks/useAiInsights';
import { useChat } from './hooks/useChat';
import { useSearch } from './hooks/useSearch';
import { saveSession, loadSession, OcrSession } from './utils/sessionStorage';
import { downloadDocumentFile } from './utils/ocrApi';
import type { FeatureKey } from '../../../shared/TryOtherFeatures';

const SINGLE_DOCUMENT_SUGGESTIONS = [
  'What is this document about?',
  'Summarize the key points',
  'Are there any important dates or deadlines?',
];

const ALL_DOCUMENT_SUGGESTIONS = [
  'Summarize each document briefly',
  'What topics appear across all documents?',
  'What are the main differences between these documents?',
];

type OcrPageProps = {
  onBack: () => void;
  onNavigateFeature?: (feature: Exclude<FeatureKey, 'datasets'>) => void;
};

const OcrPage = ({ onBack, onNavigateFeature }: OcrPageProps) => {
  const {
    files,
    setFiles,
    fileObjectUrls,
    fileInputRef,
    handleFileChange,
    handleDrop,
    handleDragOver,
  } = useFileUpload();

  const {
    activeStep,
    progress,
    statusText,
    errorText,
    allResults,
    selectedDocId,
    activeTab,
    setSelectedDocId,
    setActiveTab,
    startPipeline,
    stopPipeline,
    setAllResults,
    setActiveStep,
  } = useOcrPipeline(files);

  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [datasetState, setDatasetState] = React.useState<any>(null);

  const {
    nlpData,
    wordcloudSrc,
    linguisticSrc,
    linguisticError,
    knowledgeGraphSrc,
    frequencyData,
    linguisticData,
    isNlpLoading,
    aiInsightsCache,
    setAiInsightsCache,
  } = useAiInsights(selectedDocId, allResults);

  const {
    chatHistories,
    expandedSourcesHistories,
    getChatMessages,
    getExpandedSources,
    chatInput,
    setChatInput,
    isChatLoading,
    chatEndRef,
    sendChatMessage,
    toggleSourceExpansion,
    setChatHistories,
    setExpandedSourcesHistories,
  } = useChat();

  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    searchOpen,
    setSearchOpen,
    searchDocuments,
  } = useSearch();

  const chatMessages = getChatMessages(selectedDocId);
  const expandedSources = getExpandedSources(selectedDocId);
  const canShowPreviewToggle = files.length > 0 || (activeStep === 'results' && allResults.length > 0);
  const isAllDocumentsSelected = selectedDocId === 'all';
  const chatSuggestions = isAllDocumentsSelected ? ALL_DOCUMENT_SUGGESTIONS : SINGLE_DOCUMENT_SUGGESTIONS;
  const chatEmptyTitle = isAllDocumentsSelected
    ? 'Ask anything about these documents'
    : 'Ask anything about this document';
  const chatEmptyDescription = isAllDocumentsSelected
    ? "I'll compare and search across the selected document set to answer your question."
    : "I'll search through the document content and answer your questions using AI.";

  // Helper to trigger file downloads
  const downloadStringAsFile = (content: string, filename: string, type: string = 'text/plain') => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  // Compute variables for results display
  const resultData = selectedDocId === 'all'
    ? { document: { pages: [], filename: files.map((f: File) => f.name).join(', ') } }
    : allResults.find((r: any) => r.document.id === selectedDocId);

  const pages = resultData?.document?.pages || [];
  const fullText = pages.map((p: any) => p.text || "").join('\n\n');
  const confidences = pages.map((p: any) => p.confidence).filter((c: any) => c !== undefined && c !== null);
  const overallConfidence = confidences.length ? confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length : 0;
  const qaScore = overallConfidence >= 0.85 ? "High" : overallConfidence >= 0.6 ? "Medium" : "Low";
  const documentType = resultData?.document?.filename?.split('.').pop()?.toUpperCase() || "UNKNOWN";
  const language = resultData?.ai_insights?.language || {};
  const summary = resultData?.ai_insights?.summary || "No summary generated.";
  const entities = resultData?.ai_insights?.entities || [];
  const topFrequency = frequencyData.slice(0, 10);
  const maxFrequency = topFrequency.length ? Math.max(...topFrequency.map((item: { frequency: number }) => item.frequency), 1) : 1;
  const topPos = Object.entries(linguisticData as Record<string, number>).slice(0, 10);
  const maxPosCount = topPos.length ? Math.max(...topPos.map(([, count]) => count), 1) : 1;

  // Check if tables exist
  let hasTables = false;
  pages.forEach((p: any) => {
    if (p.tables && p.tables.length > 0) hasTables = true;
  });

  const handleSendChat = () => {
    const question = chatInput.trim();
    if (!question || isChatLoading) return;
    sendChatMessage(selectedDocId, resultData, allResults, question, chatMessages);
  };

  const handleSearch = () => {
    searchDocuments();
  };

  const handleSaveSession = async (name: string) => {
    try {
      const session: OcrSession = {
        id: crypto.randomUUID(),
        name,
        timestamp: Date.now(),
        allResults,
        sessionFiles: files,
        chatHistories,
        expandedSources: expandedSourcesHistories,
        aiInsightsCache,
        datasetState,
      };
      
      await saveSession(session);
      alert('Session saved successfully!');
    } catch (error) {
      console.error(error);
      alert('Failed to save session.');
    }
  };

  const handleLoadSession = async (session: OcrSession) => {
    let fullSession = session;
    if (session.is_backend && (!session.allResults || session.allResults.length === 0)) {
      const loaded = await loadSession(session.id, true);
      if (loaded) fullSession = loaded;
    }

    const loadSessionFiles = async () => {
      if (fullSession.sessionFiles && fullSession.sessionFiles.length > 0) {
        setFiles(fullSession.sessionFiles);
        return;
      }

      const docs = (fullSession.allResults || [])
        .map((r: any) => ({
          id: r?.document?.id,
          filename: r?.document?.filename || 'document',
        }))
        .filter((d: any) => d.id);

      const uniqueDocs = docs.filter(
        (doc: any, idx: number) => docs.findIndex((x: any) => x.id === doc.id) === idx,
      );

      if (!uniqueDocs.length) {
        setFiles([]);
        return;
      }

      const downloadedFiles = await Promise.all(
        uniqueDocs.map(async (doc: any) => {
          try {
            const blob = await downloadDocumentFile(doc.id);
            return new File([blob], doc.filename, { type: blob.type || 'application/octet-stream' });
          } catch (error) {
            console.warn(`Failed to restore file preview for ${doc.filename}:`, error);
            return null;
          }
        }),
      );

      setFiles(downloadedFiles.filter(Boolean) as File[]);
    };

    await loadSessionFiles();

    setAllResults(fullSession.allResults);
    setChatHistories(fullSession.chatHistories || {});
    setExpandedSourcesHistories(fullSession.expandedSources || {});
    if (fullSession.aiInsightsCache && setAiInsightsCache) {
      setAiInsightsCache(fullSession.aiInsightsCache);
    }
    if (fullSession.datasetState) {
      setDatasetState(fullSession.datasetState);
    }
    setActiveStep('results');
  };

  const handleReset = () => {
    setFiles([]);
    setAllResults([]);
    setActiveStep('upload');
    setSelectedDocId('all');
    setDatasetState(null);
  };

  return (
    <div className={`xt-page-layout${sidebarOpen ? ' sidebar-open' : ''}`}>
    <div className="xt-page">
      <button className="xt-back-btn" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Data Tools
      </button>

      {/* Header */}
      <div className="xt-header">
        <div className="xt-header-icon">
          <ScanLine size={26} />
        </div>
        <div>
          <h1 className="xt-header-title">Intelligent Document Extraction</h1>
          <p className="xt-header-subtitle">
            Transform documents into structured data with AI-powered vision
          </p>
        </div>
      </div>

      {/* Actions row above Stepper */}
      {activeStep !== 'upload' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <button
            onClick={handleReset}
            className="xt-export-btn outline"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px' }}
          >
            <RefreshCcw size={14} /> New Extraction
          </button>
        </div>
      )}

      {/* Stepper */}
      <Stepper activeStep={activeStep} />

      {errorText && (
        <div className="xt-error-banner">
          <AlertCircle size={18} /> {errorText}
        </div>
      )}

      {/* STEP 1: UPLOAD */}
      {activeStep === 'upload' && (
        <UploadSection
          files={files}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onStartPipeline={startPipeline}
          onLoadSession={handleLoadSession}
        />
      )}

      {/* STEP 2: PROCESSING */}
      {activeStep === 'processing' && (
        <ProcessingSection
          progress={progress}
          statusText={statusText}
          onCancel={stopPipeline}
        />
      )}

      {/* STEP 3: RESULTS */}
      {activeStep === 'results' && allResults.length > 0 && (
        <ResultsSection
          files={files}
          allResults={allResults}
          selectedDocId={selectedDocId}
          activeTab={activeTab}
          resultData={resultData}
          pages={pages}
          fullText={fullText}
          hasTables={hasTables}
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
          chatMessages={chatMessages}
          expandedSources={expandedSources}
          chatInput={chatInput}
          isChatLoading={isChatLoading}
          chatEmptyTitle={chatEmptyTitle}
          chatEmptyDescription={chatEmptyDescription}
          chatSuggestions={chatSuggestions}
          chatEndRef={chatEndRef}
          onSelectedDocIdChange={setSelectedDocId}
          onActiveTabChange={setActiveTab}
          onChatInputChange={setChatInput}
          onSendMessage={handleSendChat}
          onToggleSources={(messageIndex: number) => toggleSourceExpansion(selectedDocId, messageIndex)}
          onSuggestionClick={(suggestion: string) => setChatInput(suggestion)}
          downloadStringAsFile={downloadStringAsFile}
          onSaveSession={handleSaveSession}
          datasetState={datasetState}
          onDatasetStateChange={setDatasetState}
          onNavigateFeature={onNavigateFeature}
        />
      )}

      {/* ── Global Document Search Bar ── */}
      <GlobalSearch
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        isSearching={isSearching}
        searchResults={searchResults}
        onToggleOpen={() => setSearchOpen((v: boolean) => !v)}
        onQueryChange={setSearchQuery}
        onSearch={handleSearch}
      />

    </div>

      {/* Floating sidebar toggle — visible when a file is loaded */}
      {canShowPreviewToggle && (
        <button
          className={`xt-sidebar-toggle${sidebarOpen ? ' is-active' : ''}`}
          onClick={() => setSidebarOpen((v: boolean) => !v)}
          title={sidebarOpen ? 'Hide document preview' : 'Show document preview'}
          aria-label="Toggle document preview sidebar"
        >
          <PanelRight size={18} />
          <span>{sidebarOpen ? 'Hide Preview' : 'View Document'}</span>
        </button>
      )}
      <DocumentPreviewSidebar
        sidebarOpen={sidebarOpen}
        selectedDocId={selectedDocId}
        resultData={resultData}
        files={files}
        fileObjectUrls={fileObjectUrls}
        onClose={() => setSidebarOpen(false)}
      />
    </div>
  );
};

export default OcrPage;
