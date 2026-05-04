// ============================================================
// CATALOG SERVICES — data.gov.in + Azure Blob API wrappers
// All requests proxied through the FastAPI backend (API key stays server-side)
// ============================================================

const BASE_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://127.0.0.1:8766';
const TEAM4 = `${BASE_URL}/team4`;

// ── Types ────────────────────────────────────────────────────

export interface DatasetEntry {
  name: string;
  desc: string;
  category: string;
  org: string;
  id?: string;
  fields?: Array<{ name: string; type?: string }>;
  updated?: string;
}

export interface DatasetPage {
  total: number;
  results: DatasetEntry[];
  error?: string;
}

export interface FetchProgressEvent {
  rows_fetched: number;
  total: number | null;
  pct: number;
}

export interface FetchForAnalysisResult {
  filename: string;
  rows_fetched: number;
  total_available: number | null;
  truncated: boolean;
}

export interface BlobFileEntry {
  name: string;
  blob_path: string;
  size_kb: number;
  last_modified?: string;
}

// ── data.gov.in catalog ──────────────────────────────────────

/** Paginated catalog listing from data.gov.in */
export async function fetchDatasets(
  q: string,
  offset: number,
  limit: number,
  sector = '',
): Promise<DatasetPage> {
  const params = new URLSearchParams({ q, offset: String(offset), limit: String(limit), sector });
  const res = await fetch(`${TEAM4}/datasets?${params}`);
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  return res.json();
}

/** Sample rows for in-browser preview */
export async function fetchDatasetSample(
  indexId: string,
): Promise<{ records: any[]; [key: string]: any }> {
  const res = await fetch(`${TEAM4}/datasets/sample/${encodeURIComponent(indexId)}`);
  if (!res.ok) throw new Error(`Sample fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Downloads the full dataset server-to-server and saves it to the backend workspace.
 * Streams NDJSON progress events.
 */
export async function fetchDatasetForAnalysis(
  indexId: string,
  datasetName: string,
  onProgress?: (e: FetchProgressEvent) => void,
  maxRows = 100_000,
): Promise<FetchForAnalysisResult> {
  const res = await fetch(`${TEAM4}/datasets/fetch-for-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index_id: indexId, dataset_name: datasetName, max_rows: maxRows }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Fetch failed: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let result: FetchForAnalysisResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'progress') {
          onProgress?.({ rows_fetched: event.rows_fetched, total: event.total, pct: event.pct });
        } else if (event.type === 'complete') {
          result = {
            filename: event.filename,
            rows_fetched: event.rows_fetched,
            total_available: event.total_available,
            truncated: event.truncated,
          };
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (!result) throw new Error('Dataset fetch completed without a result event.');
  return result;
}

/** Trigger a full CSV download to the browser (API key stays server-side) */
export function downloadDatasetCSV(indexId: string, datasetName: string): void {
  const safeName = encodeURIComponent(datasetName.slice(0, 60));
  const url = `${TEAM4}/datasets/download/${encodeURIComponent(indexId)}?filename=${safeName}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${datasetName.slice(0, 60)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Azure Blob Storage catalog ───────────────────────────────

/** List CSV/JSON/XLSX files stored in Azure Blob storage */
export async function fetchBlobFiles(): Promise<{ files: BlobFileEntry[]; error?: string }> {
  const res = await fetch(`${TEAM4}/blob-files`);
  if (!res.ok) throw new Error(`Blob listing failed: ${res.status}`);
  return res.json();
}
