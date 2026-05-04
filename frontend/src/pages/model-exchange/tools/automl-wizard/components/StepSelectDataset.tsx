import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BlobDatasetInfo, DatasetMetadata, DatasetWorkflowInsightResponse } from '../types';
import * as api from '../api';
import { aiSourceDisplay } from '../aiSource';
import CatalogView from '../catalog/CatalogView';

type TaskChoice = 'auto' | 'classification' | 'regression' | 'clustering';
type BlobTeamOption = { value: string; label: string };
type DatasetSourceContext = {
  blobPath?: string;
  blobTeam?: string;
  filename: string;
};

const DEFAULT_BLOB_TEAM_OPTIONS: BlobTeamOption[] = [
  { value: 'feature engineering', label: 'Feature Engineering' },
  { value: 'auto ml', label: 'Auto ML' },
  { value: 'ocr', label: 'OCR' },
];

const formatBlobTeamLabel = (value: string) =>
  value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

interface Props {
  dataset: DatasetMetadata | null;
  onSelect: (ds: DatasetMetadata) => void;
  onCatalogImportComplete?: (ds: DatasetMetadata) => void | Promise<void>;
  onClusteringSelect?: (ds: DatasetMetadata) => void;
  onContinue?: (taskChoice?: TaskChoice) => void | Promise<void>;
  onClearDataset?: () => void;
}

export default function StepSelectDataset({
  dataset,
  onSelect,
  onCatalogImportComplete,
  onClusteringSelect,
  onContinue,
  onClearDataset,
}: Props) {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<DatasetMetadata[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [taskChoice, setTaskChoice] = useState<TaskChoice>('auto');
  const [workflowInsight, setWorkflowInsight] = useState<DatasetWorkflowInsightResponse | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [blobCatalogOpen, setBlobCatalogOpen] = useState(false);
  const [blobItems, setBlobItems] = useState<BlobDatasetInfo[]>([]);
  const [blobLoading, setBlobLoading] = useState(false);
  const [blobImportingPath, setBlobImportingPath] = useState('');
  const [blobSearch, setBlobSearch] = useState('');
  const [blobError, setBlobError] = useState('');
  const [blobTeam, setBlobTeam] = useState('auto ml');
  const [blobTeams, setBlobTeams] = useState<BlobTeamOption[]>(DEFAULT_BLOB_TEAM_OPTIONS);
  const [datasetContexts, setDatasetContexts] = useState<Record<string, DatasetSourceContext>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dataset?.id) {
      setWorkflowInsight(null);
      return;
    }

    let cancelled = false;
    setInsightLoading(true);

    api.getDatasetWorkflowInsight(dataset.id)
      .then((ins) => {
        if (!cancelled) setWorkflowInsight(ins);
      })
      .catch(() => {
        if (!cancelled) setWorkflowInsight(null);
      })
      .finally(() => {
        if (!cancelled) setInsightLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataset?.id]);

  useEffect(() => {
    if (!blobCatalogOpen) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setBlobLoading(true);
      setBlobError('');
      api.listBlobDatasets(blobSearch, 300, blobTeam)
        .then((res) => {
          if (cancelled) return;
          const discovered = (res.teams || [])
            .filter(Boolean)
            .map((teamName) => ({ value: teamName, label: formatBlobTeamLabel(teamName) }));
          const combined = new Map<string, BlobTeamOption>();
          DEFAULT_BLOB_TEAM_OPTIONS.forEach((option) => combined.set(option.value, option));
          discovered.forEach((option) => combined.set(option.value, option));
          setBlobTeams(Array.from(combined.values()));
          setBlobItems(res.items || []);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setBlobItems([]);
          setBlobError(api.formatTeam1AxiosError(err, 'Failed to fetch blob datasets'));
        })
        .finally(() => {
          if (!cancelled) setBlobLoading(false);
        });
    }, blobSearch ? 250 : 0);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [blobCatalogOpen, blobSearch, blobTeam]);

  const updateDatasets = (meta: DatasetMetadata, source?: DatasetSourceContext) => {
    setDatasets((prev) => {
      const filtered = prev.filter((d) => d.id !== meta.id && d.filename !== meta.filename);
      return [...filtered, meta];
    });
    if (source) {
      setDatasetContexts((prev) => ({
        ...prev,
        [meta.id]: source,
      }));
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const ds = await api.uploadDataset(file);
      updateDatasets(ds, { filename: ds.filename });
      onSelect(ds);
    } catch {
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, ds: DatasetMetadata) => {
    e.stopPropagation();
    try {
      await api.deleteDataset(ds.id);
      setDatasets((prev) => prev.filter((d) => d.id !== ds.id));
      setDatasetContexts((prev) => {
        const next = { ...prev };
        delete next[ds.id];
        return next;
      });
    } catch {
      // Ignore delete failures from the picker.
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) handleUpload(file);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatLastModified = (value: string) => {
    if (!value) return 'Unknown date';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'Unknown date';
    return dt.toLocaleString();
  };

  const handleBlobImport = async (item: BlobDatasetInfo) => {
    setBlobImportingPath(item.blob_path);
    setBlobError('');
    try {
      const meta = await api.importBlobDataset(item.blob_path);
      updateDatasets(meta, {
        filename: item.filename,
        blobPath: item.blob_path,
        blobTeam: item.team,
      });
      setBlobCatalogOpen(false);
      if (onCatalogImportComplete) {
        await onCatalogImportComplete(meta);
      } else {
        await onSelect(meta);
      }
    } catch (err: unknown) {
      setBlobError(api.formatTeam1AxiosError(err, 'Failed to import selected blob dataset'));
    } finally {
      setBlobImportingPath('');
    }
  };

  const openDataExchange = () => {
    const context = dataset?.id ? datasetContexts[dataset.id] : undefined;
    void navigate('/Data2Insightai/data', {
      state: {
        openTool: 'feat',
        returnToAutoml: true,
        automlContext: dataset
          ? {
              datasetId: dataset.id,
              datasetName: dataset.filename,
              blobPath: context?.blobPath,
              blobTeam: context?.blobTeam,
            }
          : null,
      },
    });
  };

  const visibleBlobTeams = blobTeams.filter((option) => option.value);

  return (
    <div className="aw-step-content">
      <div className="aw-step-main">

        {dataset && onClearDataset && (
          <button className="aw-back-btn" onClick={onClearDataset}>← Choose Different Dataset</button>
        )}

        {dataset ? (
          <div className="aw-dataset-info">
            <h3 className="aw-dataset-name">{dataset.filename}</h3>
            <p className="aw-dataset-desc">{dataset.description}</p>

            <div className="aw-meta-cards">
              <div className="aw-meta-card">
                <span className="aw-meta-label">Total Rows</span>
                <span className="aw-meta-value">{dataset.total_rows}</span>
              </div>
              <div className="aw-meta-card">
                <span className="aw-meta-label">Total Columns</span>
                <span className="aw-meta-value">{dataset.total_columns}</span>
              </div>
              <div className="aw-meta-card">
                <span className="aw-meta-label">Size</span>
                <span className="aw-meta-value">{formatSize(dataset.size_bytes)}</span>
              </div>
              <div className="aw-meta-card">
                <span className="aw-meta-label">Category</span>
                <span className="aw-badge">{dataset.category}</span>
              </div>
            </div>

            {(insightLoading || workflowInsight) && (
              <div className="aw-dataset-insight">
                {insightLoading && (
                  <p className="aw-dataset-insight-loading">Analyzing dataset with AI (Azure when configured)...</p>
                )}

                {!insightLoading && workflowInsight && (
                  <>
                    <div className="aw-dataset-insight-header">
                      <span className="aw-dataset-insight-title">{workflowInsight.headline}</span>
                      {workflowInsight.source && (
                        <span className={`aw-badge ${aiSourceDisplay(workflowInsight.source).badgeClass}`}>
                          {aiSourceDisplay(workflowInsight.source).label}
                        </span>
                      )}
                    </div>

                    <p className="aw-dataset-insight-detail">{workflowInsight.detail}</p>

                    {(workflowInsight.data_characteristics || '').trim() !== '' && (
                      <div className="aw-insight-block">
                        <h5 className="aw-insight-block-title">What kind of data is this?</h5>
                        <p className="aw-insight-block-body">{workflowInsight.data_characteristics}</p>
                      </div>
                    )}

                    {(workflowInsight.preprocessing_guidance || '').trim() !== '' && (
                      <div className="aw-insight-block">
                        <h5 className="aw-insight-block-title">Preprocessing and data quality</h5>
                        <p className="aw-insight-block-body">{workflowInsight.preprocessing_guidance}</p>
                      </div>
                    )}

                    {(workflowInsight.feature_engineering_guidance || '').trim() !== '' && (
                      <div className="aw-insight-block">
                        <h5 className="aw-insight-block-title">Feature engineering</h5>
                        <p className="aw-insight-block-body">{workflowInsight.feature_engineering_guidance}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="aw-task-picker">
              <label className="aw-task-picker-label">I know the ML task for this dataset:</label>
              <div className="aw-task-picker-pills">
                {(['auto', 'classification', 'regression', 'clustering'] as TaskChoice[]).map((t) => (
                  <button
                    key={t}
                    className={`aw-task-pill ${taskChoice === t ? 'aw-task-pill--active' : ''} ${t !== 'auto' ? `aw-task-pill--${t}` : ''}`}
                    onClick={() => setTaskChoice(t)}
                  >
                    {t === 'auto' ? 'Let AI Decide' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {taskChoice === 'auto' && (
                <p className="aw-task-picker-hint">AI will analyze the dataset and recommend the best task in the next step.</p>
              )}

              {taskChoice === 'clustering' && (
                <p className="aw-task-picker-hint">Dataset will be sent directly to the clustering pipeline without a target column.</p>
              )}
            </div>

            <div className="aw-dataset-exchange-callout">
              <div>
                <h4 className="aw-dataset-exchange-title">Need preprocessing or feature engineering first?</h4>
                <p className="aw-dataset-exchange-copy">
                  Open Data Exchange to clean, transform, or engineer features for this same dataset. If this dataset came from Blob storage, you can continue with the same blob-backed file there and then return to AutoML.
                </p>
              </div>
            </div>

            <div className="aw-dataset-cta-row">
              <button
                type="button"
                className="aw-btn aw-btn--secondary"
                onClick={openDataExchange}
              >
                Data Exchange
              </button>
              <button
                className="aw-btn aw-btn--primary"
                onClick={async () => {
                  if (taskChoice === 'clustering' && onClusteringSelect) {
                    onClusteringSelect(dataset);
                    return;
                  }
                  await onContinue?.(taskChoice);
                }}
              >
                {taskChoice === 'clustering' ? 'Start Clustering Pipeline ->' : 'Continue to Configure Data ->'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`aw-upload-zone ${dragOver ? 'aw-upload-zone--active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
            >
              <div className="aw-upload-icon">CSV</div>
              <p>{uploading ? 'Uploading...' : 'Drag and drop a CSV file here, or click to browse'}</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
            </div>

            <div className="aw-upload-alt">
              <span className="aw-upload-alt-label">or</span>
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--full"
                onClick={() => setCatalogOpen(true)}
              >
                Browse data.gov.in catalog (India)
              </button>
              <span className="aw-upload-alt-divider">or</span>
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--full aw-btn--blob"
                onClick={() => setBlobCatalogOpen(true)}
              >
                Browse datasets from Blob storage
              </button>
            </div>

            {catalogOpen && (
              <div
                className="aw-catalog-modal-backdrop"
                role="presentation"
                onClick={() => setCatalogOpen(false)}
              >
                <div
                  className="aw-catalog-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Government dataset catalog"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="aw-catalog-modal-close"
                    aria-label="Close catalog"
                    onClick={() => setCatalogOpen(false)}
                  >
                    x
                  </button>
                  <CatalogView
                    onDatasetImported={async (meta) => {
                      updateDatasets(meta, { filename: meta.filename });
                      setCatalogOpen(false);
                      if (onCatalogImportComplete) {
                        await onCatalogImportComplete(meta);
                      } else {
                        await onSelect(meta);
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {blobCatalogOpen && (
              <div
                className="aw-catalog-modal-backdrop"
                role="presentation"
                onClick={() => setBlobCatalogOpen(false)}
              >
                <div
                  className="aw-catalog-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Blob dataset catalog"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="aw-catalog-modal-close"
                    aria-label="Close blob catalog"
                    onClick={() => setBlobCatalogOpen(false)}
                  >
                    x
                  </button>
                  <div className="aw-catalog-root">
                    <div className="aw-catalog-main">
                      <h2 className="aw-catalog-title">Blob dataset catalog</h2>
                      <p className="aw-catalog-sub">
                        Choose team folders, then import structured CSV datasets supported by AutoML workflows for classification, regression, and clustering.
                      </p>

                      <div className="aw-blob-toolbar">
                        <div className="aw-blob-toolbar-copy">
                          <p className="aw-blob-support-note">
                            AutoML-compatible files only: classification, regression, and clustering CSVs.
                          </p>
                        </div>
                      </div>

                      <div className="aw-catalog-chip-group aw-catalog-chip-group--blob">
                        <span className="aw-blob-team-label">Team</span>
                        <div className="aw-catalog-chips">
                          {visibleBlobTeams.map((option) => (
                            <button
                              type="button"
                              key={option.value}
                              className={`aw-catalog-chip ${blobTeam === option.value ? 'aw-catalog-chip--on' : ''}`}
                              onClick={() => setBlobTeam(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="aw-catalog-search-wrap">
                        <input
                          className="aw-catalog-search-input"
                          placeholder="Search by folder or filename..."
                          value={blobSearch}
                          onChange={(e) => setBlobSearch(e.target.value)}
                        />
                        {blobSearch && (
                          <button type="button" className="aw-catalog-search-clear" onClick={() => setBlobSearch('')}>
                            x
                          </button>
                        )}
                      </div>

                      <p className="aw-catalog-meta">
                        {blobLoading ? 'Loading blob datasets...' : `${blobItems.length.toLocaleString()} dataset files`}
                      </p>
                      <p className="aw-catalog-meta">
                        Showing {formatBlobTeamLabel(blobTeam)} datasets that fit AutoML classification, regression, and clustering workflows.
                      </p>
                      {blobError && <p className="aw-catalog-meta aw-catalog-meta--error">Error: {blobError}</p>}

                      <div className="aw-catalog-list">
                        {!blobLoading && blobItems.length === 0 && (
                          <p className="aw-catalog-empty">No matching CSV datasets found for the selected team.</p>
                        )}
                        {blobItems.map((item) => (
                          <div key={item.blob_path} className="aw-catalog-row aw-catalog-row--blob">
                            <div>
                              <div className="aw-catalog-row-header">
                                <div className="aw-catalog-row-title">{item.filename}</div>
                                {item.team && <span className="aw-catalog-row-badge">{formatBlobTeamLabel(item.team)}</span>}
                              </div>
                              <div className="aw-catalog-row-desc">
                                {item.folder || '/'} · {formatSize(item.size_bytes)} · {formatLastModified(item.last_modified)}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="aw-btn aw-btn--primary aw-btn--sm"
                              disabled={blobImportingPath === item.blob_path}
                              onClick={() => {
                                void handleBlobImport(item);
                              }}
                            >
                              {blobImportingPath === item.blob_path ? 'Importing...' : 'Import'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {datasets.length > 0 && (
              <div className="aw-dataset-catalog">
                <h4>Or select from existing datasets:</h4>
                <div className="aw-dataset-list">
                  {datasets.map((ds) => (
                    <div key={ds.id} className="aw-dataset-item" onClick={() => onSelect(ds)}>
                      <span className="aw-dataset-item-name">{ds.filename}</span>
                      <div className="aw-dataset-item-right">
                        <span className="aw-dataset-item-meta">{ds.total_rows} rows · {ds.total_columns} cols</span>
                        <button className="aw-dataset-delete-btn" onClick={(e) => handleDelete(e, ds)} title="Delete dataset">x</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="aw-step-sidebar">
        <h4>AutoML Workflow:</h4>
        <ul className="aw-workflow-list">
          <li className="aw-workflow-active">Upload or select dataset</li>
          <li>Preview and configure data columns</li>
          <li>Select ML task and models</li>
          <li>Configure training settings</li>
          <li>Train and compare models</li>
          <li>View results and export</li>
        </ul>
      </div>
    </div>
  );
}
