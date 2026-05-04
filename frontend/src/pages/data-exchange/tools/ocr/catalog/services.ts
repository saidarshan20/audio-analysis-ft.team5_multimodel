// ============================================================
// CATALOG SERVICES — data.gov.in API wrappers (via backend proxy)
// ============================================================

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';
// Backend catalog API now lives under Team3 OCR module.
// (Old Team5 router removed.)
const BASE_URL = API_BASE.replace(/\/$/, '') + '/team3_ocr/api/v1/catalog';

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

/** Paginated catalog listing */
export async function fetchDatasets(q: string, offset: number, limit: number, sector = ''): Promise<DatasetPage> {
  const params = new URLSearchParams({ q, offset: String(offset), limit: String(limit), sector });
  const res = await fetch(`${BASE_URL}/datasets?${params}`);
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  return res.json();
}

/** Sample rows for in-browser preview */
export async function fetchDatasetSample(
  indexId: string,
  limit = 500,
): Promise<{ records: any[]; field?: any[]; total?: number; [k: string]: any }> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${BASE_URL}/datasets/sample/${encodeURIComponent(indexId)}?${params}`);
  if (!res.ok) throw new Error(`Sample fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Downloads the full dataset server-to-server and saves it to the backend workspace.
 * Streams NDJSON progress events — call onProgress to update UI in real time.
 */
export async function fetchDatasetForAnalysis(
  indexId: string,
  datasetName: string,
  onProgress?: (e: FetchProgressEvent) => void,
  maxRows = 100_000,
): Promise<FetchForAnalysisResult> {
  const res = await fetch(`${BASE_URL}/datasets/fetch-for-analysis`, {
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

/** Reads a previously fetched analysis CSV from backend workspace. */
export async function readFetchedAnalysisCSV(filename: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/datasets/fetch-for-analysis/file/${encodeURIComponent(filename)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Load failed: ${res.status}` }));
    throw new Error(err.detail || `Load failed: ${res.status}`);
  }
  return res.text();
}

/** Trigger a full CSV download to the browser (API key stays server-side) */
export function downloadDatasetCSV(indexId: string, datasetName: string): void {
  const safeName = encodeURIComponent(datasetName.slice(0, 60));
  const url = `${BASE_URL}/datasets/download/${encodeURIComponent(indexId)}?filename=${safeName}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${datasetName.slice(0, 60)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** AI chat about a dataset using its metadata as LLM context */
export async function chatAboutDataset(
  name: string,
  desc: string,
  fields: any[],
  question: string,
  history: any[] = [],
): Promise<{ answer: string; model?: string }> {
  const res = await fetch(`${BASE_URL}/datasets/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_name: name, description: desc, fields, question, history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Chat failed: ${res.status}` }));
    throw new Error(err.detail || `Chat failed: ${res.status}`);
  }
  return res.json();
}
