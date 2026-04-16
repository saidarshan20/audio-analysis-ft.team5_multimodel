/**
 * services.ts - API calls for Team 5 (Multimodal / Data Visualization)
 * Connects to the FastAPI backend endpoints /team5/analyze and /team5/code-analyze
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

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
}

export interface AudioAnalysisResult {
  duration: number;
  segments: SpeakerSegment[];
  transcript_text: string;
  features?: AudioFeatures;
  text_analysis: {
    summary: string;
    sentiment: { positive: number; negative: number; neutral: number; overall_label: string };
    entities: Array<{ id: string; label: string; type: string }>;
    timeline: Array<{ date: string; description: string }>;
    locations: Array<{ name: string; lat: number; lng: number }>;
  } | null;
}

export interface AudioAnalysisResponse {
  status: string;
  filename: string;
  content_type: string;
  result: AudioAnalysisResult;
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
  video_caption: string;
  clip_scenes: ClipScene[];
  groq_summary: string;
  sentiment_analysis: string;
  transcript: { full_text: string; segments: Array<{ start: number; end: number; text: string }>; language: string };
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
