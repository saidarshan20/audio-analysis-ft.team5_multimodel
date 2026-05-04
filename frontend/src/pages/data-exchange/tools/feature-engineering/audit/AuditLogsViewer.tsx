import { useEffect, useState } from 'react';
import '../FeatureEngineering.css'; // Adjust path if needed

type AuditLog = {
  id: number;
  user_id: number;
  session_id: string;
  action_type: string;
  action_category: string;
  details: Record<string, unknown> | null;
  timestamp: string;
};

type AuditLogsResponse = {
  total: number;
  logs: AuditLog[];
};

type AuditLogsViewerProps = {
  sessionId?: string;
};

import { API_BASE_URL } from '../../utils/api';

// Helper function to generate human-readable messages in active voice
const generateMessage = (log: AuditLog): string => {
  const userText = "You"; // Could be dynamically replaced with user profile name

  const actionMessages: Record<string, (log: AuditLog) => string> = {
    upload_dataset: () => {
      const filename = log.details?.filename || 'a file';
      const rows = log.details?.rows;
      const columns = log.details?.columns;
      if (rows && columns) {
        return `${userText} uploaded dataset '${filename}' (${rows} rows, ${columns} columns)`;
      }
      return `${userText} uploaded dataset '${filename}'`;
    },
    apply_fixes: () => {
      const count = Number(log.details?.fix_count) || 0;
      if (count > 0) {
        return `${userText} applied ${count} data quality fix${count !== 1 ? 'es' : ''} to the dataset`;
      }
      return `${userText} applied data quality fixes to the dataset`;
    },
    regenerate_fix: () => {
      return `${userText} asked AI to regenerate a data quality fix`;
    },
    apply_features: () => {
      const count = Number(log.details?.feature_count) || 0;
      if (count > 0) {
        return `${userText} created ${count} new engineered feature${count !== 1 ? 's' : ''}`;
      }
      return `${userText} applied feature creation to the dataset`;
    },
    regenerate_feature: () => {
      return `${userText} asked AI to regenerate a new feature suggestion`;
    },
    apply_transformations: () => {
      const count = Number(log.details?.transformation_count) || 0;
      const filename = log.details?.filename || 'dataset';
      
      // Don't display if no transformations were applied
      if (count === 0) return '';
      
      return `${userText} applied ${count} transformation${count !== 1 ? 's' : ''} to '${filename}'`;
    },
    regenerate_transformation: () => {
      return `${userText} asked AI to regenerate a transformation suggestion`;
    },
    apply_extractions: () => {
      const count = Number(log.details?.extraction_count) || 0;
      const filename = log.details?.filename || 'dataset';
      
      // Don't display if no extractions were applied
      if (count === 0) return '';
      
      return `${userText} extracted ${count} feature${count !== 1 ? 's' : ''} from '${filename}'`;
    },
    regenerate_extraction: () => {
      return `${userText} asked AI to regenerate an extraction suggestion`;
    },
    apply_scaling: () => {
      const count = Number(log.details?.scaling_count) || 0;
      if (count > 0) {
        return `${userText} applied scaling to ${count} feature${count !== 1 ? 's' : ''}`;
      }
      return `${userText} applied scaling to the dataset`;
    },
    regenerate_scaling: () => {
      return `${userText} asked AI to regenerate a scaling suggestion`;
    },
    apply_selection: () => {
      const count = Number(log.details?.drop_count) || 0;
      if (count > 0) {
        return `${userText} dropped ${count} feature${count !== 1 ? 's' : ''} from the dataset`;
      }
      return `${userText} dropped features from the dataset`;
    },
    regenerate_selection: () => {
      return `${userText} asked AI to regenerate a feature drop suggestion`;
    },
    apply_custom_transform: () => {
      const prompt = log.details?.prompt;
      if (prompt) {
        return `${userText} applied a custom transformation: "${prompt}"`;
      }
      return `${userText} applied a custom transformation`;
    }
  };

  const messageGenerator = actionMessages[log.action_type];
  if (messageGenerator) {
    return messageGenerator(log);
  }

  // Default message format
  const fallbackType = log.action_type ? String(log.action_type).replace(/_/g, ' ') : 'An';
  return `${userText} performed ${fallbackType} operation`;
};

// Helper function to format time as HH:MM AM/PM
const formatTime = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();
    return `${hours}:${minutesStr} ${ampm}`;
  } catch {
    return timestamp;
  }
};

const AuditLogsViewer = ({ sessionId }: AuditLogsViewerProps) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  
  const logsPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(total / logsPerPage));

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (sessionId) params.append('session_id', sessionId);
      params.append('limit', logsPerPage.toString());
      params.append('offset', ((currentPage - 1) * logsPerPage).toString());

      // Try to get token if it exists in your app context
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(
        `${API_BASE_URL}/team2_feature_eng/audit-logs?${params.toString()}`,
        { 
          credentials: 'omit', // Adjust to include if using cookies
          headers
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch logs: ${response.statusText}`);
      }

      const data: AuditLogsResponse = await response.json();
      
      // Add message field to each log and filter out empty messages
      const logsWithMessages = data.logs
        .map(log => ({
          ...log,
          message: generateMessage(log)
        }))
        .filter(log => (log as AuditLog & { message: string }).message !== '');
      
      setLogs(logsWithMessages as AuditLog[]);
      setTotal(data.total); // Fix: use total from API instead of page length
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch audit logs');
      console.error('Error fetching audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch logs on mount and when page changes
  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, currentPage]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs();
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  return (
    <div className="audit-logs-box">
      <div className="audit-logs-header">
        <h3>Activity Log</h3>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="audit-logs-content">
        {loading && logs.length === 0 ? (
          <div className="loading-logs">Loading activity logs...</div>
        ) : logs.length === 0 ? (
          <div className="no-logs">No activity logs yet</div>
        ) : (
          logs.map((log, index) => (
            <div key={log.id} className="log-entry">
              <div className="log-number">{(currentPage - 1) * logsPerPage + index + 1}</div>
              <div className="log-details">
                <div className="log-action">{(log as AuditLog & { message: string }).message}</div>
                <div className="log-time">{formatTime(log.timestamp)}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="pagination-footer">
        <button 
          onClick={() => handlePageChange(currentPage - 1)} 
          disabled={currentPage === 1}
          className="pagination-btn"
        >
          ← Previous
        </button>
        <span className="page-info">Page {currentPage} of {totalPages}</span>
        <button 
          onClick={() => handlePageChange(currentPage + 1)} 
          disabled={currentPage === totalPages}
          className="pagination-btn"
        >
          Next →
        </button>
      </div>
    </div>
  );
};

export default AuditLogsViewer;
