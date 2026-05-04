import React, { RefObject, useEffect, useState } from 'react';
import { Upload, FileText, File, FileImage, Play, Clock, Inbox, Trash2, FolderOpen } from 'lucide-react';
import { getAllSessions, deleteSession, OcrSession } from '../../utils/sessionStorage';

interface UploadSectionProps {
  files: File[];
  fileInputRef: RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onStartPipeline: () => void;
  onLoadSession: (session: OcrSession) => void;
}

export const UploadSection: React.FC<UploadSectionProps> = ({
  files,
  fileInputRef,
  onFileChange,
  onDrop,
  onDragOver,
  onStartPipeline,
  onLoadSession,
}) => {
  const [sessions, setSessions] = useState<OcrSession[]>([]);

  const fetchSessions = async () => {
    try {
      const data = await getAllSessions();
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions', error);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleDeleteSession = async (session: OcrSession) => {
    if (window.confirm(`Are you sure you want to delete session "${session.name}"?`)) {
      await deleteSession(session.id, !!session.is_backend);
      fetchSessions();
    }
  };

  return (
    <div className="xt-upload-section">
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 500px' }}>
          <div
            className={`xt-dropzone ${files.length > 0 ? 'has-file' : ''}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              multiple
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".png,.jpg,.jpeg,.pdf"
              onChange={onFileChange}
            />
            {files.length > 0 ? (
              <div className="xt-file-selected">
                <FileText size={32} />
                <h3 className="xt-dropzone-title">{files.length} document(s) ready</h3>
                <p className="xt-dropzone-subtitle">{files.map(f => f.name).join(', ').substring(0, 50)}{files.length > 1 && '...'}</p>
                <div className="xt-replace-btn">Click or drag here to replace</div>
              </div>
            ) : (
              <>
                <div className="xt-dropzone-icon">
                  <Upload size={28} />
                </div>
                <h3 className="xt-dropzone-title">Drop files here or click to browse</h3>
                <p className="xt-dropzone-subtitle">
                  Upload single files or drag a folder for bulk processing
                </p>
                <div className="xt-file-badges">
                  <span className="xt-file-badge"><File size={13} /> PDF</span>
                  <span className="xt-file-badge"><FileImage size={13} /> PNG, JPG</span>
                  <span className="xt-max-size">• Max 50MB per file</span>
                </div>
              </>
            )}
          </div>

          <div className="xt-action-row">
            <button
              className="xt-start-btn"
              disabled={files.length === 0}
              onClick={onStartPipeline}
            >
              <Play size={16} /> Start AI Pipeline
            </button>
          </div>
        </div>

        {/* Load Session Column */}
        <div className="xt-panel" style={{ flex: '1 1 300px', minHeight: '300px', padding: '24px' }}>
          <h3 className="xt-workflow-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
            <FolderOpen size={18} /> Saved Sessions
          </h3>

          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 20px' }}>
              <Inbox size={32} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: '14px' }}>No saved sessions found. Once you analyze documents, you can save them to resume later.</p>
            </div>
          ) : (
            <div className="xt-dataset-list" style={{ border: 'none', background: 'transparent' }}>
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="xt-dataset-row"
                  style={{ padding: '12px 0' }}
                >
                  <div className="xt-dataset-info" style={{ cursor: 'pointer' }} onClick={() => onLoadSession(session)}>
                    <div className="xt-dataset-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {session.name}
                      {session.is_backend && (
                        <span title="Stored on Server" style={{ color: '#0ea5e9', display: 'flex' }}>
                           <Upload size={12} />
                        </span>
                      )}
                    </div>
                    <div className="xt-dataset-desc" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                      <Clock size={12} />
                      {new Date(session.timestamp).toLocaleDateString()} {new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(session); }}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '6px', opacity: 0.7 }}
                    title="Delete Session"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};