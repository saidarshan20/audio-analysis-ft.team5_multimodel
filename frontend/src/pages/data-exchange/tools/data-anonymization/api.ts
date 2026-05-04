// API Base URL (FastAPI)
import { appLogger } from './logger';

const BASE_URL = 'http://127.0.0.1:8766';

export interface AnonymizationSample {
  id: string;
  label: string;
  kind: 'structured' | 'unstructured' | 'image' | 'audio';
  description: string;
  source_file: string;
  result_file?: string;
  source_url?: string;
  result_url?: string;
  selected_policies?: string[];
  technique_map?: Record<string, string>;
  classification?: any;
  results?: any;
}

async function parseError(response: Response, fallback: string) {
  const error = await response.json().catch(() => ({ detail: fallback }));
  return error.detail || fallback;
}

async function loggedFetch(input: string, init: RequestInit, meta: Record<string, unknown>) {
  const startedAt = performance.now();
  appLogger.info('api.request.start', { url: input, method: init.method || 'GET', ...meta });

  try {
    const response = await fetch(input, init);
    const durationMs = Math.round(performance.now() - startedAt);
    appLogger.info('api.request.complete', {
      url: input,
      method: init.method || 'GET',
      status: response.status,
      ok: response.ok,
      durationMs,
      ...meta,
    });
    return response;
  } catch (error) {
    appLogger.error('api.request.failed', {
      url: input,
      method: init.method || 'GET',
      error: error instanceof Error ? error.message : String(error),
      ...meta,
    });
    throw error;
  }
}

export async function downloadStructuredAnonymizedFile(blobPath: string, filename: string) {
  const url = new URL(`${BASE_URL}/team4/download`);
  url.searchParams.set('path', blobPath);
  url.searchParams.set('filename', filename);

  const response = await loggedFetch(url.toString(), {
    method: 'GET',
  }, { feature: 'anonymization.downloadStructured', filename });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Download failed.'));
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}

export async function getAnonymizationSamples(): Promise<AnonymizationSample[]> {
  const response = await loggedFetch(`${BASE_URL}/team4/samples/anonymization`, {
    method: 'GET',
  }, { feature: 'anonymization.samples' });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to load anonymization samples.'));
  }

  const payload = await response.json();
  return payload.samples ?? [];
}

export async function classifyStructured(file: File, policy: string = 'Global') {
  const formData = new FormData();
  formData.append('file', file);

  const url = new URL(`${BASE_URL}/team4/api/anonymization/pii-detection-structured`);
  url.searchParams.set('policy', policy);

  const response = await loggedFetch(url.toString(), {
    method: 'POST',
    body: formData,
  }, { feature: 'anonymization.classifyStructured', filename: file.name, size: file.size, policy });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Classification failed.'));
  }

  return response.json();
}

export async function classifyUnstructured(file: File, policy: string = 'Global') {
  const formData = new FormData();
  formData.append('file', file);

  const url = new URL(`${BASE_URL}/team4/api/anonymization/pii-detection-unstructured`);
  url.searchParams.set('policy', policy);

  const response = await loggedFetch(url.toString(), {
    method: 'POST',
    body: formData,
  }, { feature: 'anonymization.classifyUnstructured', filename: file.name, size: file.size, policy });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Unstructured classification failed.'));
  }

  return response.json();
}

export async function classifyImage(file: File, policy: string = 'Global') {
  const formData = new FormData();
  formData.append('file', file);

  const url = new URL(`${BASE_URL}/team4/api/anonymization/pii-detection-image`);
  url.searchParams.set('policy', policy);

  const response = await loggedFetch(url.toString(), {
    method: 'POST',
    body: formData,
  }, { feature: 'anonymization.classifyImage', filename: file.name, size: file.size, policy });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Image classification failed.'));
  }

  return response.json();
}

export async function anonymizeStructured(file: File, configMapping?: Record<string, string>, policy: string = 'Global', numCopies: number = 1) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('policy', policy);
  formData.append('num_copies', String(numCopies));
  if (configMapping) {
    formData.append('config', JSON.stringify(configMapping));
  }

  const response = await loggedFetch(`${BASE_URL}/team4/anonymize/structured`, {
    method: 'POST',
    body: formData,
  }, {
    feature: 'anonymization.runStructured',
    filename: file.name,
    size: file.size,
    configKeys: configMapping ? Object.keys(configMapping) : [],
    policy,
  });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Anonymization failed.'));
  }

  return response.json();
}

export async function anonymizeUnstructured(file: File, configMapping?: Record<string, string>, policy: string = 'Global', numCopies: number = 1) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('policy', policy);
  formData.append('num_copies', String(numCopies));
  if (configMapping) {
    formData.append('config', JSON.stringify(configMapping));
  }
  formData.append('mode', 'suppress');

  const response = await loggedFetch(`${BASE_URL}/team4/anonymize/unstructured`, {
    method: 'POST',
    body: formData,
  }, {
    feature: 'anonymization.runUnstructured',
    filename: file.name,
    size: file.size,
    configKeys: configMapping ? Object.keys(configMapping) : [],
    policy,
  });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Unstructured anonymization failed.'));
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    let blobUrl = '';
    if (payload.output_base64) {
      const binary = atob(payload.output_base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: payload.media_type || 'application/octet-stream' });
      blobUrl = URL.createObjectURL(blob);
    }
    return {
      ...payload,
      blobUrl,
      filename: payload.filename || `anonymized_${file.name}`,
      entitiesFound: String(payload.entities?.length ?? payload.entity_summary?.length ?? 'Processed'),
    };
  }

  // Backward-compatible handling for older StreamingResponse versions.
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  
  return {
    blobUrl,
    filename: `anonymized_${file.name}`,
    entitiesFound: response.headers.get('X-Anonymized-Entities') || 'Processed'
  };
}

/**
 * Sends an image to the backend Presidio image redactor.
 * Returns an object with:
 *   - blobUrl: a local object URL for the redacted image (use in <img src> or for download)
 *   - originalSizeKb, redactedSizeKb, format: metadata from response headers
 *   - filename: suggested download filename
 */
export async function anonymizeImage(file: File, configMapping?: Record<string, string>, policy: string = 'Global', numCopies: number = 1): Promise<{
  blobUrl: string;
  filename: string;
  output_base64?: string;
  media_type?: string;
  zip_base64?: string;
  num_copies?: number;
  [key: string]: any;
}> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('policy', policy);
  formData.append('num_copies', String(numCopies));
  if (configMapping) {
    formData.append('config', JSON.stringify(configMapping));
  }

  const response = await loggedFetch(`${BASE_URL}/team4/anonymize/image`, {
    method: 'POST',
    body: formData,
  }, {
    feature: 'anonymization.runImage',
    filename: file.name,
    size: file.size,
    configKeys: configMapping ? Object.keys(configMapping) : [],
    policy,
  });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Image redaction failed.'));
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    let blobUrl = '';
    if (payload.output_base64) {
      const binary = atob(payload.output_base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: payload.media_type || 'image/png' });
      blobUrl = URL.createObjectURL(blob);
    }
    return {
      ...payload,
      blobUrl,
      filename: payload.filename || `redacted_${file.name}`,
    };
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  return {
    blobUrl,
    filename: response.headers.get('X-Filename') || `redacted_${file.name}`,
  };
}

export async function anonymizeAudio(file: File, configMapping?: Record<string, string>, detectionResult?: any, policy: string = 'Global', numCopies: number = 1) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('policy', policy);
  formData.append('num_copies', String(numCopies));
  if (configMapping) formData.append('config', JSON.stringify(configMapping));
  if (detectionResult) formData.append('detection_result', JSON.stringify(detectionResult));

  const response = await loggedFetch(`${BASE_URL}/team4/anonymize/audio`, {
    method: 'POST',
    body: formData,
  }, {
    feature: 'anonymization.runAudio',
    filename: file.name,
    size: file.size,
    policy,
  });

  if (!response.ok) {
    throw new Error(await parseError(response, 'Audio anonymization failed.'));
  }

  const payload = await response.json();
  let blobUrl = '';
  if (payload.output_base64) {
    const binary = atob(payload.output_base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: payload.media_type || 'audio/wav' });
    blobUrl = URL.createObjectURL(blob);
  }
  return {
    ...payload,
    blobUrl,
    filename: payload.filename || `redacted_${file.name.replace(/\.[^/.]+$/, "")}.wav`,
  };
}
