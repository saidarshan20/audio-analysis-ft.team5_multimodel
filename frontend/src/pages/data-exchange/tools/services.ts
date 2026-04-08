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

export interface CodeAnalysisResult {
  filename: string;
  file_count: number;
  architecture: {
    title: string;
    summary: string;
    detected_patterns: string[];
    components: Array<{
      id: string;
      name: string;
      type: string;
      layer: string; // presentation | application | domain | infrastructure | other
      description: string;
      files: string[];
    }>;
    connections: Array<{
      source: string;
      target: string;
      type: string;
      description: string;
    }>;
  };
  details: {
    key_files: Array<{
      file_path: string;
      summary: string;
      key_functions: string[];
    }>;
    flow: Array<{
      step: number;
      description: string;
    }>;
    tech_debt?: string[];
    security_risks?: string[];
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
    plot_file_path: string;
  };
}

export interface SpeakerSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

// ── Acoustic Feature Types (Task 1 output) ─────────────────────────────────
export interface WaveformData {
  timestamps: number[];   // time in seconds (down-sampled ~1000 pts)
  amplitudes: number[];   // normalized [-1, 1]
}

export interface SpectrogramData {
  time_bins: number[];             // seconds (100 bins)
  freq_bins: number[];             // Hz (128 bins)
  magnitude_db: number[][];        // [freq_idx][time_idx] clipped to [-80, 0] dB
}

export interface EnergyData {
  timestamps: number[];  // seconds
  rms_values: number[];  // normalized [0, 1]
}

export interface MFCCData {
  timestamps: number[];
  coefficients: number[][];  // [mfcc_idx][time_idx], 13 coefficients
}

export interface AudioFeatures {
  sample_rate: number;
  duration: number;
  num_channels: number;
  waveform: WaveformData;
  spectrogram: SpectrogramData;
  energy: EnergyData;
  mfcc?: MFCCData;
}

export interface AudioAnalysisResult {
  duration: number;
  segments: SpeakerSegment[];
  transcript_text: string;
  text_analysis: TextAnalysisResult | null;
  features?: AudioFeatures;  // ← acoustic features from Task 1
}

export interface AudioAnalysisResponse {
  status: string;
  filename: string;
  content_type: string;
  result: AudioAnalysisResult;
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
 * Uploads a .zip file for batched multi-modal image analysis
 */
export async function analyzeImagesZip(file: File): Promise<ImageZipAnalysisResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/team5/image-analyze-zip`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `ZIP Image analysis failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Uploads an audio file for speaker diarization and text analysis
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

/**
 * Lightweight acoustic feature extraction — no Whisper/diarization.
 * Returns waveform, spectrogram, and RMS energy data for visualization.
 * Works even without HF_TOKEN or heavy model downloads.
 */
export async function extractAudioFeatures(file: File): Promise<{
  status: string;
  filename: string;
  content_type: string;
  result: AudioFeatures;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/team5/audio-features`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Feature extraction failed with status ${response.status}`);
  }

  return response.json();
}
