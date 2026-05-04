import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Database, Upload, Loader2, CheckCircle, XCircle, RefreshCcw,
  Download, Plus, RotateCcw, Pencil, Search, FileSpreadsheet, Trash2,
} from 'lucide-react';
import { extractDatasetRow, storeDataHarvesterDatasetToBlob } from '../../utils/ocrApi';
import CatalogView from '../../catalog/CatalogView';
import { DatasetEntry, FetchForAnalysisResult, readFetchedAnalysisCSV } from '../../catalog/services';

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface SchemaColumn {
  name: string;
  description?: string;
  sample_values?: string[];
}

type HarvesterStatus = 'upload' | 'schema_ready' | 'extracting' | 'review' | 'accepted';

interface DatasetIntegratorTabProps {
  selectedDocId: string;
  allResults: any[];
  datasetState: any;
  onDatasetStateChange: (state: any) => void;
}

/* ── CSV Parser ─────────────────────────────────────────────────────────────── */

function parseCSVText(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { columns: [], rows: [] };

  // Simple CSV parse (handles quoted fields)
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const columns = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    columns.forEach((col, idx) => { row[col] = values[idx] || ''; });
    rows.push(row);
  }
  return { columns, rows };
}

/* ── Generate CSV download ──────────────────────────────────────────────────── */

function generateCSV(columns: string[], rows: Record<string, string | null>[]): string {
  const escape = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const header = columns.map(escape).join(',');
  const dataLines = rows.map(row =>
    columns.map(col => escape(row[col] ?? '')).join(',')
  );
  return [header, ...dataLines].join('\n');
}

/* ── Main Component ─────────────────────────────────────────────────────────── */

export const DatasetIntegratorTab: React.FC<DatasetIntegratorTabProps> = ({
  selectedDocId,
  allResults,
  datasetState,
  onDatasetStateChange,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'catalog' | 'harvester'>('harvester');
  // Restore from session or start fresh
  const [status, setStatus] = useState<HarvesterStatus>(datasetState?.status || 'upload');
  const [columns, setColumns] = useState<string[]>(datasetState?.columns || []);
  const [existingRows, setExistingRows] = useState<Record<string, string>[]>(datasetState?.existingRows || []);
  const [sampleValues, setSampleValues] = useState<Record<string, string[]>>(datasetState?.sampleValues || {});
  const [datasetRawFile, setDatasetRawFile] = useState<File | null>(null);
  const [extractedRows, setExtractedRows] = useState<Record<string, string | null>[]>(datasetState?.extractedRows || []);
  const [editingRows, setEditingRows] = useState<Record<string, string | null>[]>(datasetState?.editingRows || []);
  const [addedRows, setAddedRows] = useState<Record<string, string | null>[]>(datasetState?.addedRows || []);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [blobStoreLoading, setBlobStoreLoading] = useState(false);
  const [blobStoreMessage, setBlobStoreMessage] = useState<string | null>(null);
  const [chunksUsed, setChunksUsed] = useState<number>(0);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; col: string } | null>(null);
  const [datasetFileName, setDatasetFileName] = useState<string>(datasetState?.datasetFileName || '');
  const [catalogInfo, setCatalogInfo] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist state changes to parent for session storage
  const persistState = useCallback(() => {
    onDatasetStateChange({
      status,
      columns,
      existingRows,
      sampleValues,
      extractedRows,
      editingRows,
      addedRows,
      datasetFileName,
    });
  }, [status, columns, existingRows, sampleValues, extractedRows, editingRows, addedRows, datasetFileName, onDatasetStateChange]);

  useEffect(() => {
    if (columns.length > 0 || addedRows.length > 0) {
      persistState();
    }
  }, [status, columns, extractedRows, editingRows, addedRows, persistState]);

  /* ── File Upload Handler ───────────────────────────────────────────────── */

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDatasetRawFile(file);
    setBlobStoreMessage(null);

    setDatasetFileName(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase();

    try {
      if (ext === 'csv') {
        const text = await file.text();
        const parsed = parseCSVText(text);
        if (parsed.columns.length === 0) {
          setExtractionError('No columns found in CSV file.');
          return;
        }
        finishParsing(parsed.columns, parsed.rows);
      } else if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
        if (jsonData.length === 0) {
          setExtractionError('No data found in Excel file.');
          return;
        }
        const cols = Object.keys(jsonData[0]);
        const rows = jsonData.map(r => {
          const row: Record<string, string> = {};
          cols.forEach(c => { row[c] = String(r[c] ?? ''); });
          return row;
        });
        finishParsing(cols, rows);
      } else {
        setExtractionError('Unsupported file type. Please upload CSV or Excel (.xlsx/.xls).');
      }
    } catch (err) {
      console.error('File parse error:', err);
      setExtractionError('Failed to parse the uploaded file. Please check the format.');
    }
  };

  const finishParsing = (cols: string[], rows: Record<string, string>[]) => {
    setColumns(cols);
    setExistingRows(rows);
    // Extract sample values (first 3 rows per column)
    const samples: Record<string, string[]> = {};
    cols.forEach(col => {
      samples[col] = rows.slice(0, 3).map(r => r[col] || '').filter(v => v !== '');
    });
    setSampleValues(samples);
    setExtractionError(null);
    setExtractedRows([]);
    setEditingRows([]);
    setStatus('schema_ready');
  };

  const loadCatalogDatasetForHarvester = async (dataset: DatasetEntry, fetchResult?: FetchForAnalysisResult) => {
    if (!fetchResult?.filename) {
      setCatalogInfo(`Fetched for analysis: ${dataset.name}`);
      return;
    }

    setCatalogLoading(true);
    setCatalogInfo(`Loading ${dataset.name} into Data Harvester...`);
    try {
      const csvText = await readFetchedAnalysisCSV(fetchResult.filename);
      const parsed = parseCSVText(csvText);
      if (!parsed.columns.length) {
        setCatalogInfo(`Loaded ${dataset.name}, but no columns were found.`);
        return;
      }

      const loadedFile = new File([csvText], fetchResult.filename, { type: 'text/csv' });
      setDatasetRawFile(loadedFile);
      setDatasetFileName(loadedFile.name);
      setActiveSubTab('harvester');
      finishParsing(parsed.columns, parsed.rows);
      setCatalogInfo(`Loaded into Data Harvester: ${dataset.name} (${parsed.rows.length.toLocaleString()} rows).`);
    } catch (err: any) {
      setCatalogInfo(err?.message || `Unable to load ${dataset.name} into Data Harvester.`);
    } finally {
      setCatalogLoading(false);
    }
  };

  /* ── Extraction Handler ────────────────────────────────────────────────── */

  const handleExtract = async () => {
    setStatus('extracting');
    setIsExtracting(true);
    setExtractionError(null);

    try {
      const targetResults =
        selectedDocId === 'all'
          ? allResults.filter((r: any) => r?.document?.id)
          : allResults.filter((r: any) => r?.document?.id === selectedDocId);

      if (!targetResults.length) {
        setExtractionError(
          selectedDocId === 'all'
            ? 'No processed documents available for extraction.'
            : 'Selected document result not found. Please reprocess and try again.',
        );
        setStatus('schema_ready');
        return;
      }

      const schema: SchemaColumn[] = columns.map(col => ({
        name: col,
        sample_values: sampleValues[col] || [],
      }));

      const mergedRows: Record<string, string | null>[] = [];
      let totalChunksUsed = 0;
      let docsWithRows = 0;
      let lastErrorMessage: string | null = null;

      for (const docResult of targetResults) {
        try {
          const response = await extractDatasetRow({
            document_id: docResult.document.id,
            schema,
            filename: docResult?.document?.filename,
          });
          if (response?.rows && response.rows.length > 0) {
            mergedRows.push(...response.rows);
            totalChunksUsed += Number(response.chunks_used || 0);
            docsWithRows += 1;
          } else if (response?.message) {
            lastErrorMessage = response.message;
          }
        } catch (err: any) {
          lastErrorMessage = err?.message || 'Extraction failed for one or more documents.';
        }
      }

      if (mergedRows.length > 0) {
        setExtractedRows(mergedRows);
        setEditingRows(mergedRows.map((r: Record<string, string | null>) => ({ ...r })));
        setChunksUsed(totalChunksUsed);
        if (selectedDocId === 'all') {
          setCatalogInfo(`Extracted ${mergedRows.length} row(s) from ${docsWithRows} document(s).`);
        }
        setStatus('review');
      } else {
        setExtractionError(lastErrorMessage || 'No data could be extracted from the selected document(s).');
        setStatus('schema_ready');
      }
    } catch (err) {
      console.error('Extraction error:', err);
      setExtractionError('Failed to extract data. Ensure the backend is running and the document is indexed.');
      setStatus('schema_ready');
    } finally {
      setIsExtracting(false);
    }
  };

  /* ── Row Actions ───────────────────────────────────────────────────────── */

  const handleAcceptAll = () => {
    setAddedRows(prev => [...prev, ...editingRows]);
    setExtractedRows([]);
    setEditingRows([]);
    setStatus('accepted');
  };

  const handleAcceptRow = (idx: number) => {
    setAddedRows(prev => [...prev, editingRows[idx]]);
    setEditingRows(prev => prev.filter((_, i) => i !== idx));
    setExtractedRows(prev => prev.filter((_, i) => i !== idx));
    if (editingRows.length <= 1) {
      setStatus('accepted');
    }
  };

  const handleDeclineRow = (idx: number) => {
    setEditingRows(prev => prev.filter((_, i) => i !== idx));
    setExtractedRows(prev => prev.filter((_, i) => i !== idx));
    if (editingRows.length <= 1) {
      setStatus('schema_ready');
    }
  };

  const handleDeclineAll = () => {
    setExtractedRows([]);
    setEditingRows([]);
    setStatus('schema_ready');
  };

  const handleRedo = () => {
    handleExtract();
  };

  const handleCellEdit = (rowIdx: number, col: string, value: string) => {
    setEditingRows(prev => {
      const updated = [...prev];
      updated[rowIdx] = { ...updated[rowIdx], [col]: value };
      return updated;
    });
  };

  const handleStartOver = () => {
    setStatus('upload');
    setColumns([]);
    setExistingRows([]);
    setSampleValues({});
    setExtractedRows([]);
    setEditingRows([]);
    setAddedRows([]);
    setExtractionError(null);
    setDatasetFileName('');
    onDatasetStateChange(null);
  };

  const handleDownload = () => {
    const allRows = [...existingRows, ...addedRows.map(r => {
      const row: Record<string, string> = {};
      columns.forEach(c => { row[c] = r[c] ?? ''; });
      return row;
    })];
    const csv = generateCSV(columns, allRows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = datasetFileName.replace(/\.(xlsx?|csv)$/i, '') + '_enriched.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleStoreToBlob = async () => {
    setBlobStoreMessage(null);
    if (!datasetRawFile) {
      setBlobStoreMessage('Re-upload the dataset file first (raw file not available).');
      return;
    }
    if (!columns.length) {
      setBlobStoreMessage('No dataset columns found to store.');
      return;
    }
    const allRows = [...existingRows, ...addedRows];
    if (!allRows.length) {
      setBlobStoreMessage('No dataset rows available to store.');
      return;
    }
    if (!selectedDocId || selectedDocId === 'all') {
      setBlobStoreMessage('Select a specific document first.');
      return;
    }

    const csv = generateCSV(columns, allRows);
    const baseName = (datasetFileName || 'dataset').replace(/\.(xlsx?|csv)$/i, '');
    const processedFile = new File([csv], `${baseName}_enriched.csv`, { type: 'text/csv' });

    try {
      setBlobStoreLoading(true);
      const res = await storeDataHarvesterDatasetToBlob({
        documentId: selectedDocId,
        rawFile: datasetRawFile,
        processedFile,
      });
      setBlobStoreMessage(`Stored to blob: ${res?.processed_blob ?? 'ok'}`);
    } catch (err: any) {
      setBlobStoreMessage(err?.message || 'Failed to store dataset to blob.');
    } finally {
      setBlobStoreLoading(false);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <div className="xt-tab-panel">
      <div className="xt-tabs" style={{ marginBottom: '16px' }}>
        <button
          className={`xt-tab${activeSubTab === 'harvester' ? ' active' : ''}`}
          onClick={() => setActiveSubTab('harvester')}
        >
          <Database size={16} /> Data Harvester
        </button>
        <button
          className={`xt-tab${activeSubTab === 'catalog' ? ' active' : ''}`}
          onClick={() => setActiveSubTab('catalog')}
        >
          <Search size={16} /> Catalog
        </button>
      </div>

      {activeSubTab === 'catalog' && (
        <div className="xt-dsi-section">
          <div className="xt-dsi-welcome" style={{ marginBottom: '14px' }}>
            <Database size={40} className="xt-dsi-welcome-icon" />
            <h3>Data Harvester Catalog</h3>
            <p>Browse, preview, download, and fetch datasets here without leaving the Data Harvester tab.</p>
          </div>
          {catalogInfo && (
            <div className="xt-dsi-added-summary" style={{ marginBottom: '12px' }}>
              {catalogLoading ? <Loader2 size={16} className="xt-spin" /> : <CheckCircle size={16} />}
              <span>{catalogInfo}</span>
            </div>
          )}
          <CatalogView
            onSelect={() => setCatalogInfo(null)}
            onAnalyzeDataset={async (dataset: DatasetEntry, fetchResult?: FetchForAnalysisResult) => {
              await loadCatalogDatasetForHarvester(dataset, fetchResult);
            }}
          />
        </div>
      )}

      {activeSubTab === 'harvester' && (
      <>
      {/* ── STATUS: UPLOAD ──────────────────────────────────────────────── */}
      {status === 'upload' && (
        <div className="xt-dsi-section">
          <div className="xt-dsi-welcome">
            <Database size={40} className="xt-dsi-welcome-icon" />
            <h3>Data Harvester</h3>
            <p>Upload your dataset (CSV or Excel) and we'll extract matching data from the processed document to add as new rows.</p>
          </div>
          <div
            className="xt-dropzone xt-dsi-upload-zone"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="xt-dropzone-icon">
              <FileSpreadsheet size={28} />
            </div>
            <h3 className="xt-dropzone-title">Upload Dataset</h3>
            <p className="xt-dropzone-subtitle">
              Drop your CSV or Excel file here, or click to browse
            </p>
            <div className="xt-file-badges">
              <span className="xt-file-badge">.csv</span>
              <span className="xt-file-badge">.xlsx</span>
              <span className="xt-file-badge">.xls</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>
          {extractionError && (
            <div className="xt-dsi-error">
              <XCircle size={16} /> {extractionError}
            </div>
          )}
        </div>
      )}

      {/* ── STATUS: SCHEMA READY ────────────────────────────────────────── */}
      {status === 'schema_ready' && (
        <div className="xt-dsi-section">
          <div className="xt-dsi-schema-header">
            <div>
              <h3 className="xt-dsi-schema-title">
                <FileSpreadsheet size={18} /> {datasetFileName}
              </h3>
              <p className="xt-dsi-schema-sub">
                {columns.length} columns · {existingRows.length} existing rows
              </p>
            </div>
            <button className="xt-export-btn outline" onClick={handleStartOver}>
              <RotateCcw size={14} /> Start Over
            </button>
          </div>

          <div className="xt-dsi-schema-card">
            <h4>Dataset Schema</h4>
            <div className="xt-table-scroll">
              <table className="xt-data-table xt-dsi-schema-table">
                <thead>
                  <tr>
                    <th>Column Name</th>
                    <th>Sample Values</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map(col => (
                    <tr key={col}>
                      <td className="xt-dsi-col-name">{col}</td>
                      <td className="xt-dsi-sample-vals">
                        {(sampleValues[col] || []).length > 0
                          ? sampleValues[col].join(', ')
                          : <span className="xt-dsi-empty-val">No samples</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedDocId === 'all' && (
            <div className="xt-dsi-warning">
              <Search size={16} /> All Documents selected: extraction will run across all processed documents.
            </div>
          )}

          <div className="xt-dsi-actions-center">
            <button
              className="xt-start-btn"
              onClick={handleExtract}
            >
              <Search size={18} /> {selectedDocId === 'all' ? 'Extract from All Documents' : 'Extract from Document'}
            </button>
          </div>

          {extractionError && (
            <div className="xt-dsi-error">
              <XCircle size={16} /> {extractionError}
            </div>
          )}

          {addedRows.length > 0 && (
            <div className="xt-dsi-added-summary">
              <CheckCircle size={16} />
              <span>{addedRows.length} row(s) already harvested.</span>
              <button className="xt-dsi-link-btn" onClick={() => setStatus('accepted')}>
                View & Download
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── STATUS: EXTRACTING ──────────────────────────────────────────── */}
      {status === 'extracting' && (
        <div className="xt-dsi-section xt-dsi-extracting">
          <Loader2 size={40} className="xt-spin xt-dsi-extracting-icon" />
          <h3>Analyzing Document</h3>
          <p>Searching for relevant chunks and extracting data...</p>
          <div className="xt-dsi-extracting-steps">
            <span className="xt-dsi-step-item done">✓ Schema loaded ({columns.length} columns)</span>
            <span className="xt-dsi-step-item active">
              <Loader2 size={12} className="xt-spin" /> Searching relevant chunks via FAISS
            </span>
            <span className="xt-dsi-step-item">Sending to AI for extraction</span>
          </div>
        </div>
      )}

      {/* ── STATUS: REVIEW ──────────────────────────────────────────────── */}
      {status === 'review' && editingRows.length > 0 && (
        <div className="xt-dsi-section">
          <div className="xt-dsi-review-header">
            <div>
              <h3 className="xt-dsi-review-title">
                <CheckCircle size={18} className="success-icon" /> Extracted {editingRows.length} Row(s)
              </h3>
              <p className="xt-dsi-review-sub">
                Found from {chunksUsed} relevant chunks · Review and edit before adding to your dataset
              </p>
            </div>
            <div className="xt-dsi-review-actions">
              <button className="xt-export-btn primary" onClick={handleAcceptAll}>
                <CheckCircle size={14} /> Accept All
              </button>
              <button className="xt-export-btn outline" onClick={handleRedo}>
                <RefreshCcw size={14} /> Redo
              </button>
              <button className="xt-export-btn outline" onClick={handleDeclineAll}>
                <XCircle size={14} /> Decline All
              </button>
            </div>
          </div>

          <div className="xt-dsi-review-table-wrap">
            <div className="xt-table-scroll">
              <table className="xt-data-table xt-dsi-review-table">
                <thead>
                  <tr>
                    <th className="xt-dsi-row-num">#</th>
                    {columns.map(col => (
                      <th key={col}>{col}</th>
                    ))}
                    <th className="xt-dsi-row-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {editingRows.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      <td className="xt-dsi-row-num">{rowIdx + 1}</td>
                      {columns.map(col => (
                        <td
                          key={col}
                          className={`xt-dsi-editable-cell ${editingCell?.rowIdx === rowIdx && editingCell?.col === col ? 'editing' : ''}`}
                          onClick={() => setEditingCell({ rowIdx, col })}
                        >
                          {editingCell?.rowIdx === rowIdx && editingCell?.col === col ? (
                            <input
                              className="xt-dsi-cell-input"
                              value={row[col] ?? ''}
                              onChange={e => handleCellEdit(rowIdx, col, e.target.value)}
                              onBlur={() => setEditingCell(null)}
                              onKeyDown={e => { if (e.key === 'Enter') setEditingCell(null); }}
                              autoFocus
                            />
                          ) : (
                            <span className={row[col] ? '' : 'xt-dsi-null-val'}>
                              {row[col] ?? '—'}
                              <Pencil size={10} className="xt-dsi-edit-icon" />
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="xt-dsi-row-actions">
                        <button
                          className="xt-dsi-row-action-btn accept"
                          title="Accept this row"
                          onClick={() => handleAcceptRow(rowIdx)}
                        >
                          <CheckCircle size={14} />
                        </button>
                        <button
                          className="xt-dsi-row-action-btn decline"
                          title="Decline this row"
                          onClick={() => handleDeclineRow(rowIdx)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── STATUS: ACCEPTED ────────────────────────────────────────────── */}
      {status === 'accepted' && (
        <div className="xt-dsi-section">
          <div className="xt-dsi-accepted-header">
            <div>
              <h3 className="xt-dsi-accepted-title">
                <CheckCircle size={18} className="success-icon" /> Dataset Updated
              </h3>
              <p className="xt-dsi-accepted-sub">
                {addedRows.length} new row(s) added · {existingRows.length + addedRows.length} total rows
              </p>
            </div>
            <div className="xt-dsi-accepted-actions">
              <button className="xt-export-btn primary" onClick={handleDownload}>
                <Download size={14} /> Download Dataset
              </button>
              <button className="xt-export-btn outline" onClick={handleStoreToBlob} disabled={blobStoreLoading}>
                {blobStoreLoading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                {blobStoreLoading ? ' Storing…' : ' Store to Blob'}
              </button>
              <button className="xt-export-btn outline" onClick={() => setStatus('schema_ready')}>
                <Plus size={14} /> Extract Another
              </button>
              <button className="xt-export-btn outline" onClick={handleStartOver}>
                <RotateCcw size={14} /> Start Over
              </button>
            </div>
          </div>

          {blobStoreMessage && (
            <div className="xt-dsi-added-summary" style={{ marginTop: 10 }}>
              <RefreshCcw size={16} />
              <span>{blobStoreMessage}</span>
            </div>
          )}

          {/* Preview table showing existing + added rows */}
          <div className="xt-dsi-preview-wrap">
            <h4 className="xt-dsi-preview-title">Dataset Preview</h4>
            <div className="xt-table-scroll">
              <table className="xt-data-table xt-dsi-preview-table">
                <thead>
                  <tr>
                    <th className="xt-dsi-row-num">#</th>
                    {columns.map(col => <th key={col}>{col}</th>)}
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {existingRows.slice(-3).map((row, idx) => (
                    <tr key={`existing-${idx}`} className="xt-dsi-existing-row">
                      <td className="xt-dsi-row-num">{existingRows.length - 2 + idx > 0 ? existingRows.length - 2 + idx : idx + 1}</td>
                      {columns.map(col => <td key={col}>{row[col] || '—'}</td>)}
                      <td><span className="xt-dsi-source-badge existing">Original</span></td>
                    </tr>
                  ))}
                  {existingRows.length > 3 && (
                    <tr className="xt-dsi-ellipsis-row">
                      <td colSpan={columns.length + 2} style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', padding: '8px' }}>
                        ... {existingRows.length - 3} more existing rows ...
                      </td>
                    </tr>
                  )}
                  {addedRows.map((row, idx) => (
                    <tr key={`added-${idx}`} className="xt-dsi-added-row">
                      <td className="xt-dsi-row-num">{existingRows.length + idx + 1}</td>
                      {columns.map(col => <td key={col}>{row[col] ?? '—'}</td>)}
                      <td><span className="xt-dsi-source-badge harvested">Harvested</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};
