/**
 * services.ts - API calls for Team 5 (Multimodal / Data Visualization)
 * Connects to the FastAPI backend endpoints /team5/analyze and /team5/code-analyze
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// ── data.gov.in Catalog ──────────────────────────────────────────────────────

export interface DatasetEntry {
  name: string;
  desc: string;
  category: string;
  org: string;
  id?: string;
  fields?: Array<{ name: string; type?: string; description?: string }>;
  updated?: string;
}

export interface DatasetPage {
  total: number;
  results: DatasetEntry[];
  error?: string;
}

export async function fetchDatasets(q: string, offset: number, limit: number, sector: string = ''): Promise<DatasetPage> {
  const params = new URLSearchParams({ q, offset: String(offset), limit: String(limit), sector });
  const response = await fetch(`${BASE_URL}/team5/datasets?${params}`);
  if (!response.ok) throw new Error(`Dataset fetch failed: ${response.status}`);
  return response.json();
}

export async function fetchDatasetSample(indexId: string): Promise<{ records: any[], [key: string]: any }> {
  // encoding the indexId as it might contain path-like chars
  const response = await fetch(`${BASE_URL}/team5/datasets/sample/${encodeURIComponent(indexId)}`);
  if (!response.ok) throw new Error(`Sample fetch failed: ${response.status}`);
  return response.json();
}

export interface FetchForAnalysisResult {
  filename: string;
  rows_fetched: number;
  total_available: number | null;
  truncated: boolean;
}

export interface FetchProgressEvent {
  rows_fetched: number;
  total: number | null;
  pct: number;
}

/**
 * Downloads the full dataset from data.gov.in into Team 4's workspace server-to-server.
 * Streams NDJSON progress events — call onProgress to update UI in real time.
 * Throws on error events from the backend.
 */
export async function fetchDatasetForAnalysis(
  indexId: string,
  datasetName: string,
  onProgress?: (e: FetchProgressEvent) => void,
  maxRows = 100_000,
): Promise<FetchForAnalysisResult> {
  const response = await fetch(`${BASE_URL}/team5/datasets/fetch-for-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index_id: indexId, dataset_name: datasetName, max_rows: maxRows }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Fetch failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
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
            filename:        event.filename,
            rows_fetched:    event.rows_fetched,
            total_available: event.total_available,
            truncated:       event.truncated,
          };
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // malformed line — skip
        throw e;
      }
    }
  }

  if (!result) throw new Error('Dataset fetch completed without a result event.');
  return result;
}

/**
 * Triggers a full CSV download for a data.gov.in dataset.
 * The backend paginates through the API and streams the file —
 * the API key never leaves the server.
 */
export function downloadDatasetCSV(indexId: string, datasetName: string): void {
  const safeName = encodeURIComponent(datasetName.slice(0, 60));
  const url = `${BASE_URL}/team5/datasets/download/${encodeURIComponent(indexId)}?filename=${safeName}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${datasetName.slice(0, 60)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function chatAboutDataset(
  name: string, 
  desc: string, 
  fields: any[], 
  question: string, 
  history: any[] = []
): Promise<{ answer: string }> {
  const response = await fetch(`${BASE_URL}/team5/datasets/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_name: name, description: desc, fields, question, history }),
  });
  if (!response.ok) throw new Error(`Chat failed: ${response.status}`);
  return response.json();
}

export interface TextAnalysisResult {
  summary: string;
  sentiment: {
    positive: number;
    negative: number;
    neutral: number;
    overall_label: string;
  };
  entities: Array<{ id: string; label: string; type: string }>;
  kg_nodes: Array<{ id: string; label: string; type: string }>;
  kg_edges: Array<{ source: string; target: string; relation: string }>;
  timeline: Array<{ date: string; description: string }>;
  locations: Array<{ name: string; lat: number; lng: number }>;
  word_count?: number;
  char_count?: number;
  sentence_count?: number;
  conversation_score?: number;
  environment?: string;
  emotion?: string;
  tone?: string;
  domain?: string;
  bullet_points?: string[];
  action_items?: string[];
  topic?: string;
  theme?: string;
  sentence_sentiments?: Array<{ sentence: string; sentiment: string }>;
  top_keyphrases?: string[];
  top_keywords?: string[];
  decisions?: string[];
  agreements?: string[];
  questions?: string[];
  unanswered_questions?: string[];
  disagreements?: string[];
  topic_segments?: Array<{ topic: string; segment: string }>;
}

export interface DiagramGroup {
  id: string;
  label: string;
}

export interface DiagramNode {
  id: string;
  label: string;
  type: string;
  description: string;
  group_id: string;
  path?: string;
  shape: 'box' | 'database' | 'queue' | 'document' | 'circle' | 'hexagon';
}

export interface DiagramEdge {
  source: string;
  target: string;
  label: string;
  style: 'solid' | 'dashed';
}

export interface CodeAnalysisResult {
  filename: string;
  file_count: number;
  architecture: {
    title: string;
    summary: string;
    tech_stack: string[];
    detected_patterns: string[];
    groups: DiagramGroup[];
    nodes: DiagramNode[];
    edges: DiagramEdge[];
  };
  details: {
    key_files: Array<{
      file_path: string;
      component: string;
      summary: string;
      key_functions: string[];
    }>;
    flow: Array<{
      step: number;
      description: string;
    }>;
    tech_debt?: string[];
    security_risks?: string[];
    recommendations?: string[];
  };
  metadata?: {
    nodes_count: number;
    edges_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    total_duration_sec: number;
    arch_model?: string;
    detail_model?: string;
    context_chars?: number;
  };
}

// ── Team 4: Data Visualization Types ──────────────────────────────────────

export interface ColumnStat {
  name: string;
  type: 'numeric' | 'categorical';
  null_count: number;
  unique_count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  std_dev: number | null;
  top_category: string | null;
}

export interface CSVAnalysisResult {
  filename: string;
  total_rows: number;
  total_cols: number;
  columns: string[];
  preview_rows: any[];
  column_stats: ColumnStat[];
}

export interface ChartDataResponse {
  chart_type: string;
  x_axis: string;
  y_axis: string;
  data: any[];
}

export interface ImageAnalysisResult {
  filename: string;
  caption: string;
  detections: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    label: string;
    confidence: number;
  }>;
}

export interface MultiImageAnalysisResponse {
  results: ImageAnalysisResult[];
  projection: Array<{
    x: number;
    y: number;
    cluster: number;
    filename: string;
  }>;
  clusters: Array<{
    cluster_id: number;
    description: string;
    count: number;
  }>;
}

export interface ImageZipAnalysisResponse {
  status: string;
  processed_count: number;
  result: {
    clusters: Array<{
      filename: string;
      cluster_id: number;
      umap_x: number;
      umap_y: number;
      objects: Array<{ label: string; confidence: number; bbox: number[] }>;
      description: string | null;
      annotated_image_path: string | null;
      metadata?: {
        make?: string;
        model?: string;
        lens?: string;
        focal_length?: string;
        focal_length_35mm?: string;
        aperture?: string;
        shutter_speed?: string;
        iso?: string;
        datetime?: string;
        gps?: { lat: number; lng: number; altitude?: number };
        width?: number;
        height?: number;
      };
    }>;
    cluster_summaries: Array<{
      cluster_id: number;
      description: string;
      count: number;
    }>;
    plot_file_path: string;
    metadata?: {
      total_duration_sec: number;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      model: string;
    };
  };
}

/**
 * Uploads a .txt or .pdf file for multi-modal text analysis
 */
export async function analyzeTextFile(file: File): Promise<TextAnalysisResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/team5/analyze`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Upload failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.result;
}

/**
 * Uploads a .zip codebase for architecture and flow analysis via stream
 */
export async function analyzeCodebase(
  file: File, 
  onProgress?: (step: string, message: string) => void
): Promise<CodeAnalysisResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/team5/code-analyze`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Code analysis failed with status ${response.status}`);
  }

  return processAnalysisStream(response, onProgress);
}

/**
 * Executes a codebase structure analysis targeting a public GitHub repository via stream
 */
export async function analyzeGithubRepo(
  url: string,
  onProgress?: (step: string, message: string) => void
): Promise<CodeAnalysisResult> {
  const response = await fetch(`${BASE_URL}/team5/code-analyze/github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: url }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `GitHub analysis failed with status ${response.status}`);
  }

  return processAnalysisStream(response, onProgress);
}

/**
 * Helper to process the NDJSON stream from the backend
 */
async function processAnalysisStream(
  response: Response, 
  onProgress?: (step: string, message: string) => void
): Promise<CodeAnalysisResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let result: CodeAnalysisResult | null = null;
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.type === 'progress') {
          onProgress?.(data.step, data.message);
        } else if (data.type === 'result') {
          result = data.payload;
        } else if (data.type === 'error') {
          throw new Error(data.message);
        }
      } catch (e) {
        console.error("Error parsing stream line:", e, line);
      }
    }
  }

  if (!result) throw new Error("Analysis completed without result");
  return result;
}

/**
 * Uploads multiple images for object detection, captioning, and clustering
 */
export async function analyzeImages(files: File[]): Promise<MultiImageAnalysisResponse> {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));

  const response = await fetch(`${BASE_URL}/team5/analyze-images`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Image analysis failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Uploads a .zip file OR multiple images for batched multi-modal visual intelligence
 */
export async function analyzeImagesBatch(files: File[]): Promise<ImageZipAnalysisResponse> {
  const formData = new FormData();
  
  // Use 'files' key for both cases to match backend expectation
  files.forEach(f => formData.append('files', f));

  const response = await fetch(`${BASE_URL}/team5/image-analyze-batch`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Visual analysis failed with status ${response.status}`);
  }

  return response.json();
}

// ──────────────────────────────────────────────
//  NEW: Groq-powered Image Intelligence APIs
// ──────────────────────────────────────────────

export interface ImageQAResponse {
  status: string;
  filename: string;
  question: string;
  answer: string;
}

export interface ImageSearchResult {
  filename: string;
  caption: string;
  relevance_score: number;
  reason: string;
  matched_on: string[];
}

export interface ImageSearchResponse {
  status: string;
  query: string;
  total_searched: number;
  results: ImageSearchResult[];
}

export interface GroundedImageRecord {
  filename: string;
  caption: string;
  objects: string[];
  cluster: number;
  cluster_description?: string;
}

export interface CollectionAnswerEvidence {
  filename: string;
  reason: string;
}

export interface ImageCollectionQAResponse {
  status: string;
  question: string;
  answer: string;
  supporting_results: CollectionAnswerEvidence[];
  follow_up_suggestions: string[];
}

/**
 * Ask a question about an image that was already processed from a ZIP
 */
export async function askAboutExistingImage(imagePath: string, question: string): Promise<ImageQAResponse> {
  const response = await fetch(`${BASE_URL}/team5/image-ask-existing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath, question: question }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Existing Image Q&A failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Ask a question about an image using Groq Vision AI
 */
export async function askAboutImage(file: File, question: string): Promise<ImageQAResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('question', question);

  const response = await fetch(`${BASE_URL}/team5/image-ask`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Image Q&A failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Search images using natural language query powered by Groq
 */
export async function searchImages(
  query: string,
  images: GroundedImageRecord[]
): Promise<ImageSearchResponse> {
  const response = await fetch(`${BASE_URL}/team5/image-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, images }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Image search failed with status ${response.status}`);
  }

  return response.json();
}

export async function askAboutImageCollection(
  question: string,
  images: GroundedImageRecord[]
): Promise<ImageCollectionQAResponse> {
  const response = await fetch(`${BASE_URL}/team5/image-collection-ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, images }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Collection Q&A failed with status ${response.status}`);
  }

  return response.json();
}

// ── Audio Analysis Types ──────────────────────────────────────────────────────

export interface SpeakerSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface WaveformData {
  timestamps: number[];
  amplitudes: number[];
}

export interface SpectrogramData {
  time_bins: number[];
  freq_bins: number[];
  magnitude_db: number[][];
}

export interface EnergyData {
  timestamps: number[];
  rms_values: number[];
}

export interface AudioFeatures {
  sample_rate: number;
  duration: number;
  num_channels: number;
  waveform: WaveformData;
  spectrogram: SpectrogramData;
  energy: EnergyData;
  tempo?: number;
  spectral_centroid_mean?: number;
  mel_spectrogram?: SpectrogramData;
  pitch_mean?: number;
  pitch_std?: number;
  gender_tag?: string;
}

export interface AudioFeaturesResponse {
  status: string;
  filename: string;
  content_type: string;
  result: AudioFeatures;
}

export interface AudioQualityMetrics {
  snr: number | null;
  loudness: number | null;
  clarity: number | null;
  cleanliness: number | null;
}

export interface AudioQuality {
  score_version?: string;
  content_type?: 'speech' | 'non_speech' | 'silent' | string;
  is_speech_present?: boolean;
  duration_warning?: boolean;
  confidence?: number;
  overall_score?: number | null;
  composite_percent?: number | null;
  rating?: string;
  summary?: string;
  snr_db?: number | null;
  clip_ratio?: number;
  speech_frame_ratio?: number;
  metrics?: AudioQualityMetrics;
}

export interface SpeakerMetrics {
  dominance_ratio: number;
  wpm: number;
  participation_ratio: number;
  pitch_mean?: number;
  gender_tag?: string;
}
export interface AudioAnalysisResult {
  duration: number;
  segments: SpeakerSegment[];
  transcript_text: string;
  features?: AudioFeatures;
  text_analysis: TextAnalysisResult | null;
  audio_quality?: AudioQuality;
  language?: string;
  speaker_metrics?: Record<string, SpeakerMetrics>;
  interruption_count?: number;
  // ── Decision layer ─────────────────────────────────────────
  verdict?: AudioVerdict;
  recommended_actions?: string[];
  interpretation?: AudioInterpretation;
}

export interface AudioAnalysisResponse {
  status: string;
  filename: string;
  content_type: string;
  result: AudioAnalysisResult;
}

// ── Decision Layer Types ─────────────────────────────────────

export interface AudioVerdict {
  /** LLM-generated punchy title, e.g. "Low Quality Audio | Nostalgic Tone" */
  title: string;
  /** 1-2 sentence plain-english explanation */
  description: string;
}

export interface AudioInterpretation {
  /** "High Noise" | "Moderate Noise" | "Clean Audio" | "Unscored" */
  noise_label: string;
  /** "Too Quiet" | "Normal" | "Too Loud" | "Unscored" */
  loudness_label: string;
  /** "Low" | "Moderate" | "High" | "Unscored" */
  clarity_label: string;
  /** "Slow" | "Normal" | "Fast" */
  speech_rate_label: string;
  /** Fraction of total duration that is silence [0, 1] */
  silence_ratio: number;
  /** Overall WPM */
  speech_rate: number;
}

export interface AudioVerdictResponse {
  verdict: AudioVerdict;
  recommended_actions: string[];
}

/**
 * Uploads an audio file (.mp3, .wav, .m4a, etc.) for transcription,
 * speaker diarization, and text analysis.
 */
export async function analyzeAudio(file: File): Promise<AudioAnalysisResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/team5/analyze-audio`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Audio analysis failed with status ${response.status}`);
  }

  return response.json();
}

// ── Video Analysis Types & API ────────────────────────────────────────────────

export interface ClipScene {
  second: number;
  scene: string;
  score: number;
}

export interface VideoAnalysisResult {
  duration_seconds: number;
  keyframes_analyzed: number;
  detected_objects: Record<string, number>;
  object_details?: Record<string, Array<{
    second: number;
    confidence: number;
    image?: string;
    box_2d?: number[];
  }>>;
  video_caption: string;
  clip_scenes: ClipScene[];
  groq_summary: string;
  sentiment_analysis: string;
  transcript?: {
    full_text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    language?: string;
    vtt_content?: string;
    entities?: Array<{ label: string; items: string[] }>;
    topics?: Array<{ name: string; count: number }>;
    audio_plots?: { waveform?: string; spectrogram?: string; energy?: string };
  };
  video_url?: string;
}

export async function analyzeVideo(file: File): Promise<VideoAnalysisResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/team5/video-analyze`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Video analysis failed with status ${response.status}`);
  }

  return response.json();
}

// ── Audio Chat ────────────────────────────────────────────────────────────────

export interface AudioChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AudioChatResponse {
  answer: string;
  model: string;
}

/**
 * Ask a question about an audio transcript using multi-turn LLM chat
 */
export async function submitAudioChat(
  transcriptText: string,
  history: AudioChatMessage[],
  question: string
): Promise<AudioChatResponse> {
  const response = await fetch(`${BASE_URL}/team5/audio-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript_text: transcriptText, history, question }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Audio chat failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Fetches pre-computed analysis metadata for the demo video (huhu_analyzed.mp4)
 */
export async function fetchAudioVerdict(params: {
  snr?: number | null;
  noise_label?: string;
  loudness_label?: string;
  clarity_label?: string;
  speech_rate?: number | null;
  speech_rate_label?: string;
  silence_ratio?: number | null;
  sentiment?: string;
  emotion?: string;
  quality_score?: number | null;
  quality_rating?: string;
  duration_sec?: number | null;
}): Promise<AudioVerdictResponse> {
  const response = await fetch(`${BASE_URL}/team5/audio-verdict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Verdict fetch failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Fetches pre-computed analysis metadata for the demo video (huhu_analyzed.mp4)
 */
export async function fetchVideoDemoMetadata(): Promise<VideoAnalysisResult> {
  const response = await fetch(`${BASE_URL}/team5/demo-video-metadata`);
  if (!response.ok) {
    throw new Error(`Failed to fetch demo metadata: ${response.status}`);
  }
  return response.json();
}

/**
 * Returns the URL for streaming the analyzed demo video
 */
export function getVideoDemoStreamUrl(): string {
  return `${BASE_URL}/team5/demo-video-stream`;
}

// ── Team 4: Visualization API ───────────────────────────────────────────────

/**
 * Uploads a CSV/Excel file to Team 4's scratchpad for visualization analysis
 */
export async function uploadDatasetTeam4(file: File): Promise<{ message: string; data: { filename: string; columns: string[] } }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/team4/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || `Upload failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Gets first 100 rows and column-level statistics from Team 4
 */
export async function getPreviewTeam4(filename: string): Promise<CSVAnalysisResult> {
  const response = await fetch(`${BASE_URL}/team4/preview?filename=${encodeURIComponent(filename)}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Preview failed' }));
    throw new Error(err.detail || `Preview failed with status ${response.status}`);
  }
  return response.json();
}

/**
 * Gets chart-ready data from Team 4 based on axis and type selection
 */
export async function getChartDataTeam4(
  filename: string, 
  xAxis: string, 
  yAxis: string, 
  chartType: string
): Promise<ChartDataResponse> {
  const response = await fetch(`${BASE_URL}/team4/visualize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, x_axis: xAxis, y_axis: yAxis, chart_type: chartType }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Visualization failed' }));
    throw new Error(err.detail || `Visualization failed with status ${response.status}`);
  }

  return response.json();
}
