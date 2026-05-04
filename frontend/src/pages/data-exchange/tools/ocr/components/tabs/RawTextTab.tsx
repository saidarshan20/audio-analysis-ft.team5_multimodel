import React from 'react';
import { FileText, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface RawTextTabProps {
  selectedDocId: string;
  resultData: any;
  fullText: string;
  downloadStringAsFile: (content: string, filename: string, type?: string) => void;
}

export const RawTextTab: React.FC<RawTextTabProps> = ({
  selectedDocId,
  resultData,
  fullText,
  downloadStringAsFile,
}) => {
  return (
    <div className="xt-tab-panel">
      {selectedDocId === 'all' ? (
        <div className="xt-empty-state" style={{ textAlign: 'center', padding: '40px' }}>
          <FileText size={48} style={{ opacity: 0.3, marginBottom: '16px', display: 'inline-block' }} />
          <p style={{ color: '#718096', fontSize: '15px' }}>Please select a specific document from the dropdown above to view its extracted text.</p>
        </div>
      ) : (
        <React.Fragment>
          <div className="xt-panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h3>Extracted Document Text</h3>
              {resultData?.document?.pages && (
                (() => {
                  const pages = resultData.document.pages;
                  const validConfidences = pages
                    .map((p: any) => p.confidence)
                    .filter((c: any) => c !== null && c !== undefined);

                  if (validConfidences.length > 0) {
                    const avgConfidence = validConfidences.reduce((a: number, b: number) => a + b, 0) / validConfidences.length;
                    const percentage = Math.round(avgConfidence * 100);
                    
                    let color = '#48bb78'; // Green
                    if (percentage < 70) color = '#f6e05e'; // Yellow
                    if (percentage < 40) color = '#f56565'; // Red

                    return (
                      <div 
                        title={`Average OCR confidence across ${pages.length} pages: ${percentage}%`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '4px 10px',
                          backgroundColor: `${color}15`,
                          border: `1px solid ${color}40`,
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: color
                        }}
                      >
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color }} />
                        {percentage}% Confidence
                      </div>
                    );
                  }
                  return null;
                })()
              )}
            </div>
            <div className="xt-panel-actions">
              <button
                className="xt-export-btn"
                onClick={() => downloadStringAsFile(fullText, `${resultData?.document?.filename}.txt`)}
              >
                <Download size={14} /> .TXT
              </button>
              <button
                className="xt-export-btn outline"
                onClick={() => {
                  const html = `<html><body><h2>${resultData?.document?.filename}</h2><pre>${fullText}</pre></body></html>`;
                  downloadStringAsFile(html, `${resultData?.document?.filename}.html`, 'text/html');
                }}
              >
                <Download size={14} /> .HTML
              </button>
            </div>
          </div>
          <div className="xt-markdown-view">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {fullText}
            </ReactMarkdown>
          </div>
        </React.Fragment>
      )}
    </div>
  );
};