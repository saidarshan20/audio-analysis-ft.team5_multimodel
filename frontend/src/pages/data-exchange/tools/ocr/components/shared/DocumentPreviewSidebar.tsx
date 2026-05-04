import React from 'react';
import { Eye, X, FileText } from 'lucide-react';

type DocumentPreviewSidebarProps = {
  sidebarOpen: boolean;
  selectedDocId: string;
  resultData: any;
  files: File[];
  fileObjectUrls: Record<string, string>;
  onClose: () => void;
};

const isImageFile = (f: File) => f.type.startsWith('image/');
const isPdfFile = (f: File) => f.type === 'application/pdf';

export const DocumentPreviewSidebar: React.FC<DocumentPreviewSidebarProps> = ({
  sidebarOpen,
  selectedDocId,
  resultData,
  files,
  fileObjectUrls,
  onClose,
}) => {
  const previewFileName = selectedDocId === 'all' ? null : (resultData?.document?.filename || files[0]?.name || null);
  const previewFile = previewFileName ? files.find(f => f.name === previewFileName) : null;
  const previewObjectUrl = previewFileName ? fileObjectUrls[previewFileName] : null;

  return (
    <aside className={`xt-doc-sidebar${sidebarOpen ? ' is-open' : ''}`}>
      <div className="xt-doc-sidebar-header">
        <span className="xt-doc-sidebar-title">
          <Eye size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Document Preview
        </span>
        <button
          className="xt-doc-sidebar-close"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X size={16} />
        </button>
      </div>
      <div className="xt-doc-sidebar-filename">{selectedDocId === 'all' ? 'Batch Documents' : (previewFileName ?? 'No file')}</div>
      <div className="xt-doc-sidebar-body">
        {selectedDocId === 'all' ? (
          <div className="xt-doc-sidebar-empty">
            <FileText size={36} />
            <p>Select a specific document to preview visually.</p>
          </div>
        ) : previewObjectUrl && previewFile && isImageFile(previewFile) ? (
          <img src={previewObjectUrl} alt={previewFile.name} className="xt-doc-sidebar-img" />
        ) : previewObjectUrl && previewFile && isPdfFile(previewFile) ? (
          <iframe src={previewObjectUrl} title={previewFile.name} className="xt-doc-sidebar-pdf" />
        ) : (
          <div className="xt-doc-sidebar-empty">
            <FileText size={36} />
            <p>Preview file is not available in this loaded session. Re-upload the original document to preview it.</p>
          </div>
        )}
      </div>
    </aside>
  );
};
