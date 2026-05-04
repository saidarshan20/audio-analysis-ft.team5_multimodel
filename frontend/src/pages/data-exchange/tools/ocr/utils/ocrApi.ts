const API_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000') + '/team3_ocr/api/v1';

export const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('task_type', 'both');

  const response = await fetch(`${API_URL}/ocr/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed for ${file.name}`);
  }

  return response.json();
};

export const getJobStatus = async (jobId: string) => {
  const response = await fetch(`${API_URL}/ocr/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error('Failed to get job status');
  }
  return response.json();
};

export const getJobResult = async (jobId: string) => {
  const response = await fetch(`${API_URL}/ocr/jobs/${jobId}/result`);
  if (!response.ok) {
    throw new Error('Failed to fetch job result');
  }
  return response.json();
};

export const downloadDocumentFile = async (docId: string) => {
  const response = await fetch(`${API_URL}/ocr/documents/${docId}/file`);
  if (!response.ok) {
    throw new Error('Failed to fetch original document file');
  }
  return response.blob();
};

export const analyzeText = async (text: string, analyses: string[]) => {
  const response = await fetch(`${API_URL}/analytics/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, analyses }),
  });
  if (!response.ok) {
    throw new Error('Failed to analyze text');
  }
  return response.json();
};

export const getWordcloud = async (text: string) => {
  const response = await fetch(`${API_URL}/viz/wordcloud`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, width: 800, height: 400 }),
  });
  if (!response.ok) {
    throw new Error('Failed to generate word cloud');
  }
  return response.json();
};

export const getFrequency = async (text: string) => {
  const response = await fetch(`${API_URL}/viz/frequency`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, top_n: 12 }),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch frequency data');
  }
  return response.json();
};

export const getLinguistic = async (text: string) => {
  const response = await fetch(`${API_URL}/viz/linguistic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch linguistic data');
  }
  return response.json();
};

export const getKnowledgeGraph = async (
  relationships: string[],
  engine: 'networkx' | 'graphrag' | 'hybrid' = 'hybrid'
) => {
  const response = await fetch(`${API_URL}/viz/knowledge-graph`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relationships, engine }),
  });
  if (!response.ok) {
    throw new Error('Failed to generate knowledge graph');
  }
  return response.json();
};

export const askDocument = async (payload: any) => {
  const response = await fetch(`${API_URL}/chat/document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Document chat request failed');
  }
  return response.json();
};

export const searchDocuments = async (query: string, topK = 10) => {
  const response = await fetch(`${API_URL}/search/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, top_k: topK }),
  });
  if (!response.ok) {
    throw new Error('Search request failed');
  }
  return response.json();
};

export const saveBackendSession = async (session: any) => {
  const response = await fetch(`${API_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  if (!response.ok) {
    throw new Error('Failed to save session to backend');
  }
  return response.json();
};

export const getBackendSessions = async () => {
  const response = await fetch(`${API_URL}/sessions`);
  if (!response.ok) {
    throw new Error('Failed to list backend sessions');
  }
  return response.json();
};

export const getBackendSession = async (sessionId: string) => {
  const response = await fetch(`${API_URL}/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error('Failed to load backend session');
  }
  return response.json();
};

export const deleteBackendSession = async (sessionId: string) => {
  const response = await fetch(`${API_URL}/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete backend session');
  }
  return response.json();
};

export const extractDatasetRow = async (payload: {
  document_id: string;
  schema: Array<{ name: string; description?: string; sample_values?: string[] }>;
  filename?: string;
}) => {
  const response = await fetch(`${API_URL}/dataset/extract-row`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Dataset extraction failed');
  }
  return response.json();
};

export const storeDataHarvesterDatasetToBlob = async (payload: {
  documentId: string;
  rawFile: File;
  processedFile: File;
}) => {
  const formData = new FormData();
  formData.append('document_id', payload.documentId);
  formData.append('raw_file', payload.rawFile);
  formData.append('processed_file', payload.processedFile);

  const response = await fetch(`${API_URL}/dataset/store-to-blob`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error('Failed to store dataset to blob');
  }
  return response.json();
};
