/**
 * Project Management & Activity Tracking — Frontend API Service
 * Single-user, no auth headers needed.
 */

const API = 'http://localhost:8766';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectStep {
  id: number;
  tool_key: string;
  started_at: string;
  ended_at: string | null;
  metadata_json: string | null;
}

export interface Project {
  id: number;
  name: string;
  status: 'active' | 'completed';
  starting_tool: string;
  created_at: string;
  completed_at: string | null;
  steps: ProjectStep[];
  total_duration_seconds: number;
  module_count: number;
}

export interface ActivityItem {
  id: number;
  project_id: number | null;
  tool_key: string | null;
  action: string;
  description: string;
  timestamp: string;
  project_name: string | null;
}

// ── Tool label/icon helpers ──────────────────────────────────────────────────

export const TOOL_LABELS: Record<string, string> = {
  ocr: 'OCR Conversion',
  viz: 'Data Visualization',
  feat: 'Feature Engineering',
  anon: 'Data Anonymization',
  automl: 'AutoML',
};

export const TOOL_ICONS: Record<string, string> = {
  ocr: '📄',
  viz: '📊',
  feat: '✨',
  anon: '🔒',
  automl: '🤖',
};

export const TOOL_COLORS: Record<string, string> = {
  ocr: '#38bdf8',
  viz: '#a78bfa',
  feat: '#34d399',
  anon: '#f87171',
  automl: '#fb923c',
};

// ── Duration formatting ──────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (hours < 24) return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHr = hours % 24;
  return remainHr > 0 ? `${days}d ${remainHr}h` : `${days}d`;
}

// ── Relative time ────────────────────────────────────────────────────────────

export function formatRelativeTime(iso: string): string {
  // Ensure the date string is parsed as UTC if it lacks timezone info (which SQLite strips out)
  let parsedIso = iso;
  if (!iso.endsWith('Z') && !iso.includes('+') && !iso.match(/-\d{2}:\d{2}$/)) {
    parsedIso += 'Z';
  }
  const t = Date.parse(parsedIso);
  if (isNaN(t)) return '';
  const diffMs = Date.now() - t;
  const sec = Math.max(0, Math.floor(diffMs / 1000)); // prevent negative times if clocks slightly off
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── API Calls ────────────────────────────────────────────────────────────────

export async function createProject(name: string, startingTool: string): Promise<Project> {
  const res = await fetch(`${API}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, starting_tool: startingTool }),
  });
  if (!res.ok) throw new Error('Failed to create project');
  return res.json();
}

export async function getProjects(status?: string): Promise<Project[]> {
  const url = status ? `${API}/api/projects?status=${status}` : `${API}/api/projects`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch projects');
  const data = await res.json();
  return data.projects;
}

export async function getProjectDetail(projectId: number): Promise<Project> {
  const res = await fetch(`${API}/api/projects/${projectId}`);
  if (!res.ok) throw new Error('Failed to fetch project');
  return res.json();
}

export async function completeProject(projectId: number): Promise<Project> {
  const res = await fetch(`${API}/api/projects/${projectId}/complete`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to complete project');
  return res.json();
}

export async function deleteProject(projectId: number): Promise<void> {
  const res = await fetch(`${API}/api/projects/${projectId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete project');
}

export async function startStep(projectId: number, toolKey: string): Promise<{ id: number; tool_key: string; started_at: string }> {
  const res = await fetch(`${API}/api/projects/${projectId}/steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_key: toolKey }),
  });
  if (!res.ok) throw new Error('Failed to start step');
  return res.json();
}

export async function endStep(projectId: number, stepId: number): Promise<void> {
  const res = await fetch(`${API}/api/projects/${projectId}/steps/${stepId}/end`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to end step');
}

export async function closeAllOpenSteps(): Promise<void> {
  try {
    // Use fetch with keepalive for reliability on page unload
    await fetch(`${API}/api/projects/close-all-open`, { method: 'POST', keepalive: true });
  } catch {
    // Best effort on unload
  }
}

export async function getRecentActivity(limit = 20): Promise<ActivityItem[]> {
  const res = await fetch(`${API}/api/activity?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch activity');
  const data = await res.json();
  return data.activities;
}

export async function logActivity(
  action: string,
  description: string,
  projectId?: number,
  toolKey?: string,
): Promise<void> {
  await fetch(`${API}/api/activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId ?? null,
      tool_key: toolKey ?? null,
      action,
      description,
    }),
  });
}

// ── Browser unload hook (auto-complete all active projects) ──────────────────

let _unloadRegistered = false;

export function registerUnloadHandler() {
  if (_unloadRegistered) return;
  _unloadRegistered = true;

  window.addEventListener('beforeunload', () => {
    closeAllOpenSteps();
  });
}
