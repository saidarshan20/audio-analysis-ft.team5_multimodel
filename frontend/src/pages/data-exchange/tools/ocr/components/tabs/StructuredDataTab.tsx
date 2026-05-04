import React from 'react';
import { TableProperties, Download } from 'lucide-react';

interface StructuredDataTabProps {
  selectedDocId: string;
  resultData: any;
  pages: any[];
  hasTables: boolean;
  downloadStringAsFile: (content: string, filename: string, type?: string) => void;
}

export const StructuredDataTab: React.FC<StructuredDataTabProps> = ({
  selectedDocId,
  resultData,
  pages,
  hasTables,
  downloadStringAsFile,
}) => {
  const parseAsciiTablesFromText = (text: string): Array<{ rows: string[][]; confidence: number | null }> => {
    if (!text || !text.includes('[TABLE START]')) return [];
    const blocks = text.match(/\[TABLE START\][\s\S]*?\[TABLE END\]/g) || [];

    return blocks
      .map((block) => {
        const lines = block
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        const rows = lines
          .filter((l) => l.startsWith('|') && l.endsWith('|'))
          .map((l) => l.slice(1, -1).split('|').map((c) => c.trim()));

        return rows.length > 0 ? { rows, confidence: null } : null;
      })
      .filter((t): t is { rows: string[][]; confidence: number | null } => !!t);
  };

  const pagesWithTables = pages.map((page: any) => {
    const apiTables = Array.isArray(page.tables) ? page.tables : [];
    const textTables = apiTables.length === 0 ? parseAsciiTablesFromText(page.text || '') : [];
    return {
      ...page,
      effectiveTables: apiTables.length > 0 ? apiTables : textTables,
    };
  });

  const effectiveHasTables = pagesWithTables.some((p: any) => Array.isArray(p.effectiveTables) && p.effectiveTables.length > 0);

  return (
    <div className="xt-tab-panel">
      {selectedDocId === 'all' ? (
        <div className="xt-empty-state" style={{ textAlign: 'center', padding: '40px' }}>
          <TableProperties size={48} style={{ opacity: 0.3, marginBottom: '16px', display: 'inline-block' }} />
          <p style={{ color: '#718096', fontSize: '15px' }}>Please select a specific document to view its structured data.</p>
        </div>
      ) : (
        <React.Fragment>
          <div className="xt-panel-header">
            <h3>Structured Data Extracted</h3>
            <button
              className="xt-export-btn primary"
              onClick={() => downloadStringAsFile(JSON.stringify(resultData, null, 2), `${resultData?.document?.filename}_raw.json`, 'application/json')}
            >
              📦 Payload JSON
            </button>
          </div>

          {effectiveHasTables || hasTables ? (
            <div className="xt-tables-container">
              {pagesWithTables.map((page: any) => (
                page.effectiveTables?.map((tb: any, tbIdx: number) => {
                  const rows: any[][] = tb.rows || [];
                  if (rows.length === 0) return null;

                  // Normalise any cell value (null, NaN string, number) → string
                  const cellStr = (v: any): string => {
                    if (v === null || v === undefined) return '';
                    const s = String(v);
                    return s === 'NaN' ? '' : s;
                  };

                  const cleanRows = rows.map(r => (r || []).map(cellStr));

                  const hasHeader = cleanRows.length > 1;
                  const headers = hasHeader ? cleanRows[0] : cleanRows[0].map((_: any, i: number) => `Col ${i + 1}`);
                  const bodyRows = hasHeader ? cleanRows.slice(1) : cleanRows;

                  const downloadCsv = () => {
                    const csv = cleanRows.map(r => r.map((c: string) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
                    downloadStringAsFile(csv, `${resultData?.document?.filename}_table_p${page.page_number}_${tbIdx}.csv`, 'text/csv');
                  };

                  return (
                    <div key={`p${page.page_number}_t${tbIdx}`} className="xt-table-wrapper">
                      <div className="xt-table-header-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <h4>Table from Page {page.page_number}</h4>
                          {tb.confidence !== null && tb.confidence !== undefined && (
                            (() => {
                              const percentage = Math.round(tb.confidence * 100);
                              let color = '#48bb78'; // Green
                              if (percentage < 70) color = '#f6e05e'; // Yellow
                              if (percentage < 40) color = '#f56565'; // Red
                              return (
                                <span style={{ 
                                  fontSize: '11px', 
                                  color: color, 
                                  backgroundColor: `${color}15`, 
                                  padding: '2px 8px', 
                                  borderRadius: '4px',
                                  fontWeight: 600,
                                  border: `1px solid ${color}30`
                                }}>
                                  {percentage}% Match
                                </span>
                              );
                            })()
                          )}
                        </div>
                        <button className="xt-export-btn small" onClick={downloadCsv}><Download size={12}/> CSV</button>
                      </div>
                      <div className="xt-table-scroll">
                        <table className="xt-data-table">
                          <thead>
                            <tr>
                              {headers.map((h: string, i: number) => <th key={i}>{h || `Field ${i + 1}`}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {bodyRows.map((row: string[], rIdx: number) => (
                              <tr key={rIdx}>
                                {row.map((cell: string, cIdx: number) => <td key={cIdx}>{cell}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })
              ))}
            </div>
          ) : (
            <div className="xt-empty-state">
              No tabular data was detected in this document. Check the Raw Text tab for extracted text.
            </div>
          )}
        </React.Fragment>
      )}
    </div>
  );
};
