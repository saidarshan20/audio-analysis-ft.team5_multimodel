import { useRef, useState, useEffect } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Database, Target, UploadCloud, X, Zap, Download, Upload, Copy, Check, Play, Trash2, Clock } from 'lucide-react';
import { API_BASE_URL } from '../utils/api';
import './FeatureEngineering.css';
import CatalogView from './catalog/CatalogView';
import { fetchDatasetForAnalysis, DatasetEntry } from './catalog/services';

type SelectDatasetResult = {
  sessionId: string;
  info?: Record<string, unknown>;
  profile?: Record<string, unknown>;
};

type SavedSession = {
  session_id: string;
  dataset_name: string;
  current_step: string;
  current_stage: number;
  updated_at: string;
  rows: number;
  cols: number;
};

type SelectDatasetStepProps = {
  onNext: (result: SelectDatasetResult) => void;
  username?: string;
  onResume?: (sessionId: string) => void;
};

type FileItem = {
  id: string;
  filename: string;
  full_path: string;
  folder: string;
  size: string;
  last_modified: string;
};

const SelectDatasetStep = ({ onNext, username, onResume }: SelectDatasetStepProps) => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'team_outputs' | 'upload'>('upload');
  const [isHovering, setIsHovering] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [targetCol, setTargetCol] = useState('');
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const Outputtabs = ["All", "Anonymization", "Feature Eng"] as const;
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeOutputTab, setActiveOutputTab] = useState<typeof Outputtabs[number]>("All");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [samples] = useState([
    { id: 'housing', name: 'Housing Prices', category: 'Outliers & Regression', icon: <Target size={14} /> }
  ]);

  // ─── Saved sessions (resume workflow) ───────────────────────────────────
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{pct: number, rows: number} | null>(null);

  useEffect(() => {
    setSessionsLoading(true);
    fetch(`${API_BASE_URL}/team2_feature_eng/sessions`)
      .then((res) => res.json())
      .then((data) => setSavedSessions(data.sessions ?? []))
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }, []);

  const handleDeleteSession = async (sid: string) => {
    try {
      await fetch(`${API_BASE_URL}/team2_feature_eng/sessions/${sid}`, { method: 'DELETE' });
      setSavedSessions((prev) => prev.filter((s) => s.session_id !== sid));
    } catch {
      // silent
    }
  };

  const handleCatalogSelect = async (dataset: DatasetEntry) => {
    setIsUploading(true);
    setError(null);
    setUploadProgress(null);
    try {
      const result = await fetchDatasetForAnalysis(
        dataset.id || dataset.name, 
        dataset.name, 
        username,
        (progress) => setUploadProgress({ pct: progress.pct, rows: progress.rows_fetched })
      );
      setUploadProgress(null); // Clear progress when switching to profiling phase
      const sessionId = result.session_id ?? result.filename;
      const profileRes = await fetch(`${API_BASE_URL}/team2_feature_eng/profile/${sessionId}`);
      const profileData = (await profileRes.json()) as Record<string, unknown>;
      if (!profileRes.ok) throw new Error('Failed to profile dataset');

      const overview = (profileData.overview as Record<string, unknown>) || {};
      
      onNext({
        sessionId,
        info: {
          name: dataset.name || 'Catalog Dataset',
          rows: overview.rows ?? 0,
          columns: overview.columns ?? 0,
        },
        profile: profileData,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch dataset';
      setError(message);
    } finally {
      setIsUploading(false);
    }
  };


  const extractHeaders = (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setAvailableColumns([]);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event: ProgressEvent<FileReader>) => {
      const text = event.target?.result;
      if (typeof text !== 'string') {
        setAvailableColumns([]);
        return;
      }

      const firstLine = text.split('\n')[0];
      if (!firstLine) {
        setAvailableColumns([]);
        return;
      }

      const cols = firstLine.split(',').map((col: string) => col.trim().replace(/^"|"$/g, ''));
      setAvailableColumns(cols.filter((col: string) => col.length > 0));
    };
    reader.readAsText(selectedFile.slice(0, 1024 * 10));
  };

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setTargetCol('');
    extractHeaders(selectedFile);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    handleFileSelect(e.target.files[0]);
  };

  const uploadToBackend = async (selectedFile?: File) => {
    const fileToUpload = selectedFile ?? file;

    if (!fileToUpload) {
      fileInputRef.current?.click();
      return;
    }

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', fileToUpload);
    if (targetCol.trim()) {
      formData.append('target_col', targetCol.trim());
    }
    if (username) {
      formData.append('username', username);
    }

    try {
      const uploadRes = await fetch(`${API_BASE_URL}/team2_feature_eng/upload`, {
        method: 'POST',
        body: formData,
      });

      const uploadData = (await uploadRes.json()) as Record<string, unknown>;
      if (!uploadRes.ok) {
        const detail = typeof uploadData.detail === 'string' ? uploadData.detail : 'Upload failed';
        throw new Error(detail);
      }

      const sessionId = typeof uploadData.session_id === 'string' ? uploadData.session_id : '';
      if (!sessionId) throw new Error('Missing session id from upload response');

      const profileRes = await fetch(`${API_BASE_URL}/team2_feature_eng/profile/${sessionId}`);
      const profileData = (await profileRes.json()) as Record<string, unknown>;
      if (!profileRes.ok) throw new Error('Failed to profile dataset');

      onNext({
        sessionId,
        info: (uploadData.info as Record<string, unknown>) ?? {},
        profile: profileData,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
    } finally {
      setIsUploading(false);
    }
  };

  const onDropFile = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(false);

    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    handleFileSelect(e.dataTransfer.files[0]);
  };

  // Fetch from backend
  useEffect(() => {
    const fetchFiles = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/team2_feature_eng/team-outputs`);
        if (!res.ok) throw new Error("Failed to fetch files");

        const data = await res.json();
        setFiles(data.datasets || []);
      } catch (err) {
        console.error("Error fetching files:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, []);


  const handleLoadSample = async (sampleId: string) => {
    setIsUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('sample_id', sampleId);
      if (username) formData.append('username', username);

      const res = await fetch(`${API_BASE_URL}/team2_feature_eng/samples/load?sample_id=${sampleId}`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to load sample");

      onNext({
        sessionId: data.session_id,
        info: data.info,
        profile: data.profile
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // Filter logic
  const filteredFiles =
    activeOutputTab === "All"
      ? files
      : files.filter((f) =>
          f.folder.toLowerCase() ===
          (activeOutputTab === "Feature Eng"
            ? "feature eng"
            : activeOutputTab.toLowerCase())
        );

  // Download handler
  const handleDownload = (file: FileItem) => {
    const url = `${API_BASE_URL}/team2_feature_eng/download-team-outputs?blob_path=${encodeURIComponent(
      file.full_path
    )}`;

    window.open(url, "_blank");
  };

  return (
    <div className="card main-content text-center" style={{ position: 'relative' }}>
      
      {/* ─── Resume Saved Sessions Button (Top Left) ────────────────────── */}
      {savedSessions.length > 0 && (
        <button 
          className="btn btn-outline btn-sm"
          onClick={() => setShowResumeModal(true)}
          style={{ 
            position: 'absolute', top: '24px', left: '24px', 
            padding: '6px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px',
            color: 'var(--primary)', borderColor: 'var(--primary)', backgroundColor: 'transparent'
          }}
          title="Resume a previous session"
        >
          <Clock size={15} /> Resume Session ({savedSessions.length})
        </button>
      )}

      <h2 className="mb-4" style={{ fontSize: '24px', fontWeight: 'bold', marginTop: savedSessions.length > 0 ? '12px' : '0' }}>
        Select Your Dataset
      </h2>
      <p className="text-muted mb-8 text-sm">
        Upload a CSV or Excel file to begin AI-powered feature engineering
      </p>

      <div className="flex" style={{ borderBottom: '1px solid var(--border-color)', marginBottom: '32px' }}>
        <div
          onClick={() => setActiveTab('catalog')}
          style={{
            flex: 1,
            padding: '16px',
            cursor: 'pointer',
            borderBottom: activeTab === 'catalog' ? '2px solid var(--primary)' : '2px solid transparent',
            color: activeTab === 'catalog' ? 'var(--primary)' : 'var(--text-muted)',
          }}
        >
          <Database size={18} style={{ display: 'inline', marginRight: '8px' }} />
          <span style={{ fontWeight: 500 }}>Catalog</span>
        </div>
        <div
          onClick={() => setActiveTab('team_outputs')}
          style={{
            flex: 1,
            padding: '16px',
            cursor: 'pointer',
            borderBottom: activeTab === 'team_outputs' ? '2px solid var(--primary)' : '2px solid transparent',
            color: activeTab === 'team_outputs' ? 'var(--primary)' : 'var(--text-muted)',
          }}
        >
          <Zap size={18} style={{ display: 'inline', marginRight: '8px' }} />
          <span style={{ fontWeight: 500 }}>Azure Blob Storage</span>
        </div>
        <div
          onClick={() => setActiveTab('upload')}
          style={{
            flex: 1,
            padding: '16px',
            cursor: 'pointer',
            borderBottom: activeTab === 'upload' ? '2px solid var(--primary)' : '2px solid transparent',
            color: activeTab === 'upload' ? 'var(--primary)' : 'var(--text-muted)',
          }}
        >
          <UploadCloud size={18} style={{ display: 'inline', marginRight: '8px' }} />
          <span style={{ fontWeight: 500 }}>Upload Dataset</span>
        </div>
      </div>

      {activeTab === 'upload' && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsHovering(true);
            }}
            onDragLeave={() => setIsHovering(false)}
            onDrop={onDropFile}
            style={{
              border: `2px dashed ${isHovering ? 'var(--primary)' : file ? '#10b981' : 'var(--border-color)'}`,
              borderRadius: '12px',
              padding: '48px',
              backgroundColor: isHovering ? 'var(--surface-warn-soft)' : file ? 'var(--surface-success-soft)' : 'var(--surface-soft)',
              transition: 'all 0.2s',
              marginBottom: '24px',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: '64px',
                height: '64px',
                backgroundColor: file ? 'var(--surface-success-strong)' : 'var(--surface-muted)',
                borderRadius: '12px',
                marginBottom: '16px',
              }}
            >
              <UploadCloud size={32} color={file ? '#16a34a' : 'var(--text-muted)'} />
            </div>

            <h3 className="mb-4" style={{ fontWeight: 600, fontSize: '18px' }}>
              {file ? `✓ ${file.name}` : 'Upload Your Dataset'}
            </h3>
            <p className="text-muted mb-8 text-sm">
              {file
                ? 'File selected. Click "Upload & Process" below to continue.'
                : 'Drag & drop a CSV or Excel file here, or click the button below'}
            </p>

            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '8px' }}>
              <button
                className="btn btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud size={16} /> Choose File
              </button>

              <button
                className="btn btn-outline"
                onClick={() => !isUploading && handleLoadSample('housing')}
                disabled={isUploading}
                style={{ 
                  borderColor: 'var(--primary)', 
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Zap size={16} /> Use Sample Data
              </button>
            </div>

            {file && (
              <button
                onClick={() => {
                  setFile(null);
                  setError(null);
                  setAvailableColumns([]);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  marginTop: '4px'
                }}
              >
                <X size={14} style={{ display: 'inline', marginRight: '4px' }} /> Clear Selection
              </button>
            )}
          </div>

          {/* Manual Upload Settings - Only shown if a file is selected */}
          <div
            style={{
              marginBottom: '24px',
              textAlign: 'left',
              background: 'var(--surface-soft)',
              padding: '16px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              display: file ? 'block' : 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Target size={16} color="var(--primary)" />
              <label style={{ fontWeight: 600, fontSize: '14px' }}>Target Column (Optional)</label>
            </div>
            {availableColumns.length > 0 ? (
              <select
                value={targetCol}
                onChange={(e) => setTargetCol(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  fontSize: '14px',
                  backgroundColor: 'var(--bg-panel)',
                }}
              >
                <option value="">-- Let AI Auto-Detect --</option>
                {availableColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={targetCol}
                onChange={(e) => setTargetCol(e.target.value)}
                placeholder="e.g., price"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  fontSize: '14px',
                }}
              />
            )}
          </div>

          {error && (
            <div style={{ color: 'var(--text-danger)', marginBottom: '16px', fontSize: '14px' }}>
              ⚠️ {error}
            </div>
          )}

          {file && (
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '14px' }}
              onClick={() => uploadToBackend()}
              disabled={isUploading}
            >
              <UploadCloud size={16} />
              {isUploading ? 'Uploading & Profiling...' : 'Upload & Process Dataset'}
            </button>
          )}
        </>
      )}

      {/* Team Outputs */}
      {activeTab === 'team_outputs' && (
        <div className="fe-to-container">

          {/* Filter tabs */}
          <div className="fe-to-tabs">
            {Outputtabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveOutputTab(tab)}
                className={`fe-to-tab${activeOutputTab === tab ? ' active' : ''}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Content */}
          {loading ? (
            <div className="fe-to-empty">Loading files…</div>
          ) : filteredFiles.length === 0 ? (
            <div className="fe-to-empty">No files found</div>
          ) : (
            <div className="fe-to-list">
              {filteredFiles.map((file) => (
                <div key={file.id} className="fe-to-row">
                  {/* File info */}
                  <div className="fe-to-info">
                    <div className="fe-to-name">{file.filename}</div>
                    <div className="fe-to-meta">
                      <span className="fe-to-folder-badge">
                        {file.folder === 'feature eng' ? 'Feature Eng' : 'Anonymization'}
                      </span>
                      <span className="fe-to-meta-sep">•</span>
                      <span>{file.size}</span>
                      <span className="fe-to-meta-sep">•</span>
                      <span>{file.last_modified}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="fe-to-actions">
                    <button
                      className={`fe-to-btn${copiedId === file.id ? ' fe-to-btn--copied' : ''}`}
                      title="Copy filename"
                      onClick={() => {
                        void navigator.clipboard.writeText(file.filename);
                        setCopiedId(file.id);
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                    >
                      {copiedId === file.id ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                    <button
                      className="fe-to-btn"
                      title="Download"
                      onClick={() => handleDownload(file)}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className="fe-to-btn"
                      title="Use as input"
                      onClick={async () => {
                        try {
                          const response = await fetch(
                            `${API_BASE_URL}/team2_feature_eng/download-team-outputs?blob_path=${encodeURIComponent(file.full_path)}`
                          );
                          if (!response.ok) throw new Error('Download failed');
                          const blob = await response.blob();
                          const fileObj = new File([blob], file.filename);
                          await uploadToBackend(fileObj);
                        } catch (err: unknown) {
                          const message = err instanceof Error ? err.message : 'Failed to upload file';
                          setError(message);
                        }
                      }}
                    >
                      <Upload size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'catalog' && (
        <div className="text-left" style={{ padding: '32px' }}>
          <CatalogView onAnalyzeDataset={handleCatalogSelect} />
        </div>
      )}

      {/* ─── Resume Modal ─────────────────────────────────────────────── */}
      {showResumeModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            width: '90%', maxWidth: '600px',
            maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '20px 24px', borderBottom: '1px solid var(--border-color)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={20} color="var(--primary)" />
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text-color)' }}>Resume Previous Session</h3>
              </div>
              <button 
                onClick={() => setShowResumeModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p className="text-sm text-muted" style={{ marginBottom: '8px' }}>
                Pick up right where you left off. Older sessions are automatically removed after 1 month.
              </p>
              {savedSessions.map((s) => {
                const stepLabels: Record<string, string> = {
                  profile: 'Data Profile', quality: 'Data Quality', generate: 'Feature Generation',
                  preview: 'Data Preview', export: 'Export',
                };
                const stepLabel = stepLabels[s.current_step] ?? s.current_step;
                const timeAgo = (() => {
                  try {
                    const diff = Date.now() - new Date(s.updated_at).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    return `${Math.floor(hrs / 24)}d ago`;
                  } catch { return ''; }
                })();

                return (
                  <div
                    key={s.session_id}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: '14px',
                      padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--surface-soft)', textAlign: 'left'
                    }}
                  >
                    <div style={{ width: '100%', wordBreak: 'break-word' }}>
                      <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-color)', lineHeight: '1.4' }}>{s.dataset_name || 'Untitled'}</div>
                      <div className="text-sm text-muted" style={{ marginTop: '8px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{
                          display: 'inline-block', padding: '4px 8px', borderRadius: '4px', fontSize: '12px',
                          backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-color)', fontWeight: 500,
                        }}>
                          {stepLabel}{s.current_step === 'generate' ? ` (Stage ${s.current_stage + 1}/5)` : ''}
                        </span>
                        {s.rows > 0 && <span>{s.rows.toLocaleString()} rows · {s.cols.toLocaleString()} cols</span>}
                        {timeAgo && <span style={{ opacity: 0.8 }}>· {timeAgo}</span>}
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-start' }}>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ padding: '8px 12px', color: 'var(--text-muted)' }}
                        onClick={() => handleDeleteSession(s.session_id)}
                        title="Delete session"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => {
                          setShowResumeModal(false);
                          onResume?.(s.session_id);
                        }}
                      >
                        <Play size={14} /> Resume
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Full Screen Loading Overlay ────────────────────────────────────────── */}
      {isUploading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)',
          zIndex: 99999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            width: '48px', height: '48px', border: '4px solid var(--surface-muted)', 
            borderTopColor: 'var(--primary)', borderRadius: '50%', 
            animation: 'spin 1s linear infinite', marginBottom: '24px'
          }} />
          <h3 style={{ margin: 0, color: '#fff', fontWeight: 600, fontSize: '20px' }}>
            {uploadProgress ? `Downloading Dataset... ${uploadProgress.pct}%` : 'Analyzing & Profiling...'}
          </h3>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: '8px', fontSize: '15px' }}>
            {uploadProgress 
              ? `${uploadProgress.rows.toLocaleString()} rows fetched securely` 
              : 'Extracting data quality metrics and feature intelligence. This may take a moment.'}
          </p>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }',
        }}
      />
    </div>
  );
};

export default SelectDatasetStep;
