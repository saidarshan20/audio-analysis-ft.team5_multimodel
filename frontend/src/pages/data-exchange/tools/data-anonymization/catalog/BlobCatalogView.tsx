import { useState, useEffect } from 'react';
import { Cloud, FileSpreadsheet, RefreshCw, ChevronRight, AlertCircle } from 'lucide-react';
import { fetchBlobFiles, BlobFileEntry } from './services';

interface Props {
  onSelect: (blobPath: string, fileName: string) => void;
}

function formatSize(kb: number) {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb.toFixed(0)} KB`;
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['csv', 'xlsx', 'json'].includes(ext)) return <FileSpreadsheet size={16} color="#16a34a" />;
  return <FileSpreadsheet size={16} color="#94a3b8" />;
}

export const BlobCatalogView = ({ onSelect }: Props) => {
  const [files, setFiles] = useState<BlobFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BlobFileEntry | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchBlobFiles();
      if (res.error) setError(res.error);
      else setFiles(res.files ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to list Azure Blob files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="bc-root">
      <style>{`
        .bc-root{display:flex;flex-direction:column;gap:12px;height:420px}
        .bc-header{display:flex;justify-content:space-between;align-items:center}
        .bc-title{font-size:13px;color:#64748b;display:flex;align-items:center;gap:6px}
        .bc-refresh{background:transparent;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;transition:all .15s}
        .bc-refresh:hover{border-color:#fb8c36;color:#fb8c36}
        .bc-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-height:0}
        .bc-row{padding:12px 14px;border:1px solid #f1f5f9;border-radius:12px;background:#f8fafc;display:flex;justify-content:space-between;align-items:center;cursor:pointer;transition:all .15s}
        .bc-row:hover,.bc-row.selected{border-color:#fb8c36;background:#fff7ed}
        .bc-row-left{display:flex;align-items:center;gap:10px;min-width:0}
        .bc-row-info{min-width:0}
        .bc-row-name{font-size:13px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px}
        .bc-row-meta{font-size:11px;color:#94a3b8;margin-top:2px}
        .bc-use-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 12px;background:#fb8c36;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;transition:all .15s}
        .bc-use-btn:hover{background:#e07328}
        .bc-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#94a3b8;font-size:13px}
        .bc-error{display:flex;align-items:center;gap:8px;color:#ef4444;font-size:13px;padding:12px;border:1px solid #fee2e2;border-radius:12px;background:#fef2f2}
        .bc-skeleton{height:52px;background:#f1f5f9;border-radius:12px;animation:pulse 1.4s infinite}
      `}</style>

      <div className="bc-header">
        <div className="bc-title"><Cloud size={15} /> Files in Azure Blob Storage</div>
        <button className="bc-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bc-list">
        {loading && files.length === 0
          ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="bc-skeleton" />)
          : error
          ? (
            <div className="bc-error">
              <AlertCircle size={16} /> {error}
            </div>
          )
          : files.length === 0
          ? (
            <div className="bc-empty">
              <Cloud size={36} />
              <p>No files found in Azure Blob Storage.</p>
              <p style={{ fontSize: 11 }}>Upload a file from your device to get started.</p>
            </div>
          )
          : files.map((file) => (
            <div
              key={file.blob_path}
              className={`bc-row${selected?.blob_path === file.blob_path ? ' selected' : ''}`}
              onClick={() => setSelected(selected?.blob_path === file.blob_path ? null : file)}
            >
              <div className="bc-row-left">
                {fileIcon(file.name)}
                <div className="bc-row-info">
                  <div className="bc-row-name">{file.name}</div>
                  <div className="bc-row-meta">
                    {formatSize(file.size_kb)} · {file.last_modified?.split('T')[0] ?? 'Unknown date'}
                  </div>
                </div>
              </div>
              {selected?.blob_path === file.blob_path && (
                <button
                  className="bc-use-btn"
                  onClick={(e) => { e.stopPropagation(); onSelect(file.blob_path, file.name); }}
                >
                  <ChevronRight size={13} /> Use File
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
};
