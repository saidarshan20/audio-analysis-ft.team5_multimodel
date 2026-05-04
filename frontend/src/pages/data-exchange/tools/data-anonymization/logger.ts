type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  details?: unknown;
}

const LOG_STORAGE_KEY = 'app_event_logs';
const LOG_LIMIT = 300;

function persist(entry: LogEntry) {
  try {
    const existing = sessionStorage.getItem(LOG_STORAGE_KEY);
    const parsed = existing ? (JSON.parse(existing) as LogEntry[]) : [];
    parsed.push(entry);
    sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(parsed.slice(-LOG_LIMIT)));
  } catch {
    // Ignore storage failures so logging never breaks the UI.
  }
}

function write(level: LogLevel, event: string, details?: unknown) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    details,
  };

  persist(entry);
  const prefix = `[app:${level}] ${event}`;
  if (details !== undefined) {
    console[level](prefix, details);
  } else {
    console[level](prefix);
  }
}

export const appLogger = {
  debug: (event: string, details?: unknown) => write('debug', event, details),
  info: (event: string, details?: unknown) => write('info', event, details),
  warn: (event: string, details?: unknown) => write('warn', event, details),
  error: (event: string, details?: unknown) => write('error', event, details),
};

export function clearAppLogs() {
  sessionStorage.removeItem(LOG_STORAGE_KEY);
}
