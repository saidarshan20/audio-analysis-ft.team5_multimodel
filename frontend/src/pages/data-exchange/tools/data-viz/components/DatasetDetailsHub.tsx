import React, { useState, useEffect } from 'react';
import { 
  X, 
  Database, 
  Calendar, 
  Layers, 
  MessageSquare, 
  Table as TableIcon, 
  ChevronRight, 
  Send,
  Loader2,
  FileSpreadsheet
} from 'lucide-react';
import { DatasetEntry, fetchDatasetSample, chatAboutDataset } from '../services';

interface Props {
  dataset: DatasetEntry;
  onClose: () => void;
  onAnalyze?: (dataset: DatasetEntry, records: any[]) => void;
}

const DatasetDetailsHub: React.FC<Props> = ({ dataset, onClose, onAnalyze }) => {
  const [activeTab, setActiveTab] = useState<'info' | 'preview' | 'chat'>('info');
  const [sampleData, setSampleData] = useState<any[]>([]);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const loadSample = async () => {
    if (!dataset.id || sampleData.length > 0) return;
    setSampleLoading(true);
    setSampleError(null);
    try {
      const data = await fetchDatasetSample(dataset.id);
      if (data.error) {
        setSampleError(data.error);
        setSampleData([]);
      } else {
        setSampleData(data.records || []);
        // If we didn't have fields before, try to use whatever the resource API returned
        if ((!dataset.fields || dataset.fields.length === 0) && data.field) {
          dataset.fields = data.field;
        }
      }
    } catch (e: any) {
      console.error(e);
      setSampleError(e.message || 'Failed to connect to data gateway');
      setSampleData([]);
    } finally {
      setSampleLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || chatLoading) return;
    const userMsg = chatMessage.trim();
    setChatMessage('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatLoading(true);

    try {
      const res = await chatAboutDataset(
        dataset.name, 
        dataset.desc, 
        dataset.fields || [], 
        userMsg, 
        chatHistory
      );
      setChatHistory(prev => [...prev, { role: 'assistant', content: res.answer }]);
    } catch (e) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error during analysis.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'preview') loadSample();
  }, [activeTab]);

  return (
    <div className="hub-panel glass-card view-animate-in">
      {/* Header */}
      <div className="hub-header">
        <div className="hub-header-main">
          <div className="hub-type-icon">
            <Database size={20} />
          </div>
          <div className="hub-title-section">
            <h3 className="hub-title">{dataset.name}</h3>
            <span className="hub-subtitle">{dataset.org}</span>
          </div>
        </div>
        <button onClick={onClose} className="hub-close-btn">
          <X size={20} />
        </button>
      </div>

      {/* Tabs */}
      <div className="hub-tabs">
        <button className={`hub-tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>
          Overview
        </button>
        <button className={`hub-tab ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => setActiveTab('preview')}>
          Data Preview
        </button>
        <button className={`hub-tab ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>
          AI Insights
        </button>
      </div>

      {/* Content */}
      <div className="hub-content scrollbar-hidden">
        {activeTab === 'info' && (
          <div className="hub-info-section view-animate-in">
            <div className="hub-meta-grid">
              <div className="hub-meta-card">
                <Calendar size={14} />
                <span>Updated: {dataset.updated || 'Recent'}</span>
              </div>
              <div className="hub-meta-card">
                <Layers size={14} />
                <span>{dataset.fields?.length || 0} Columns</span>
              </div>
            </div>

            <p className="hub-description">{dataset.desc}</p>

            <div className="hub-section-title">Detected Schema</div>
            <div className="hub-schema-grid">
              {dataset.fields?.map((f, i) => (
                <div key={i} className="hub-field-badge">
                  <span className="field-name">{f.name}</span>
                  <span className="field-type">
                    {(f.type || 'unknown').toString().toUpperCase() === 'KEYWORD' ? 'TEXT' : (f.type || 'DATA').toString().toUpperCase()}
                  </span>
                </div>
              ))}
            </div>

            <div className="hub-cta-section" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button 
                className="xt-continue-btn" 
                style={{ width: '100%', justifyContent: 'center', gap: '10px' }} 
                onClick={() => onAnalyze?.(dataset, sampleData)}
                disabled={sampleData.length === 0}
              >
                <FileSpreadsheet size={16} /> Analyze in CSV Tool
              </button>
              <button className="xt-tab active" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setActiveTab('preview')}>
                <TableIcon size={16} /> Explore Sample Records
              </button>
            </div>
          </div>
        )}

        {activeTab === 'preview' && (
          <div className="hub-preview-section view-animate-in">
            {sampleLoading ? (
              <div className="hub-loading">
                <Loader2 className="animate-spin" />
                <span>Fetching records from OGD...</span>
              </div>
            ) : sampleError ? (
              <div className="hub-empty" style={{ color: '#f87171', padding: '20px', textAlign: 'center' }}>
                <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Preview Failed</p>
                <p style={{ fontSize: '12px', opacity: 0.8 }}>{sampleError}</p>
                <button 
                  className="xt-tab active" 
                  style={{ marginTop: '15px', background: 'rgba(248, 113, 113, 0.1)', borderColor: 'rgba(248, 113, 113, 0.2)', color: '#f87171' }}
                  onClick={() => { setSampleData([]); loadSample(); }}
                >
                  Retry Preview
                </button>
              </div>
            ) : sampleData.length > 0 ? (
              <div className="hub-table-wrap">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>Showing up to 50 sample records from {dataset.name}</span>
                  <button 
                    className="xt-tab active" 
                    style={{ fontSize: '11px', padding: '6px 12px', background: 'rgba(251, 140, 54, 0.1)', color: '#fb8c36' }}
                    onClick={() => onAnalyze?.(dataset, sampleData)}
                  >
                    Analyze Full Snapshot
                  </button>
                </div>
                <table className="hub-table">
                  <thead>
                    <tr>
                      {Object.keys(sampleData[0]).slice(0, 5).map(key => (
                        <th key={key}>{key.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleData.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).slice(0, 5).map((val: any, j) => (
                          <td key={j}>{typeof val === 'string' && val.length > 40 ? val.substring(0, 40) + '...' : val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="hub-table-fade" />
              </div>
            ) : (
              <div className="hub-empty">
                No sample records available for this index.
              </div>
            )}
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="hub-chat-section view-animate-in">
            <div className="hub-chat-history scrollbar-hidden">
              {chatHistory.length === 0 && (
                <div className="hub-chat-intro">
                  <MessageSquare size={32} />
                  <p>Ask analytical questions about this dataset. For example:</p>
                  <ul>
                    <li>"What are the primary use cases for these columns?"</li>
                    <li>"How could I cross-reference this with economic data?"</li>
                  </ul>
                </div>
              )}
              {chatHistory.map((m, i) => (
                <div key={i} className={`hub-msg ${m.role}`}>
                  <div className="msg-content">{m.content}</div>
                </div>
              ))}
              {chatLoading && (
                <div className="hub-msg assistant">
                  <div className="msg-content"><Loader2 className="animate-spin" size={14} /> Analyzing metadata...</div>
                </div>
              )}
            </div>
            
            <div className="hub-chat-input-wrap">
              <input 
                value={chatMessage} 
                onChange={e => setChatMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                placeholder="Ask technical question..."
              />
              <button onClick={handleSendMessage} disabled={chatLoading}><Send size={16} /></button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .hub-panel {
          position: absolute;
          right: 0;
          top: 0;
          bottom: 0;
          width: 400px;
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          z-index: 50;
          display: flex;
          flex-direction: column;
          background: rgba(15, 23, 42, 0.95);
          box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
        }
        .hub-header {
          padding: 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .hub-header-main { display: flex; gap: 12px; align-items: center; }
        .hub-type-icon { width: 40px; height: 40px; border-radius: 10px; background: rgba(251, 140, 54, 0.1); color: #fb8c36; display: flex; align-items: center; justify-content: center; }
        .hub-title { font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; }
        .hub-subtitle { font-size: 11px; color: #94a3b8; }
        .hub-close-btn { background: transparent; border: none; color: #64748b; cursor: pointer; transition: color 0.2s; }
        .hub-close-btn:hover { color: #f1f5f9; }
        
        .hub-tabs { display: flex; padding: 0 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
        .hub-tab { flex: 1; padding: 12px; font-size: 12px; background: transparent; border: none; color: #64748b; border-bottom: 2px solid transparent; cursor: pointer; transition: all 0.2s; }
        .hub-tab.active { color: #fb8c36; border-bottom-color: #fb8c36; }
        
        .hub-content { flex: 1; overflow-y: auto; padding: 20px; }
        .hub-meta-grid { display: flex; gap: 10px; margin-bottom: 15px; }
        .hub-meta-card { flex: 1; background: rgba(255, 255, 255, 0.05); padding: 8px 10px; border-radius: 8px; display: flex; align-items: center; gap: 8px; font-size: 11px; color: #94a3b8; }
        .hub-description { font-size: 13px; line-height: 1.6; color: #cbd5e1; margin-bottom: 20px; }
        .hub-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 10px; letter-spacing: 0.05em; }
        .hub-schema-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 25px; }
        .hub-field-badge { background: rgba(51, 65, 85, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); padding: 4px 10px; border-radius: 6px; display: flex; align-items: center; gap: 6px; }
        .field-name { font-size: 11px; color: #e2e8f0; font-weight: 500; }
        .field-type { font-size: 9px; color: #64748b; }
        
        .hub-preview-section { height: 100%; display: flex; flex-direction: column; }
        .hub-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; font-size: 13px; color: #64748b; }
        .hub-table-wrap { position: relative; overflow-x: auto; flex: 1; }
        .hub-table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
        .hub-table th { background: rgba(15, 23, 42, 0.8); position: sticky; top: 0; padding: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; }
        .hub-table td { padding: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); color: #cbd5e1; }
        .hub-table tr:hover { background: rgba(255, 255, 255, 0.02); }
        .hub-table-fade { position: absolute; bottom: 0; left: 0; right: 0; height: 40px; background: linear-gradient(to bottom, transparent, rgba(15, 23, 42, 0.95)); }
        
        .hub-chat-section { display: flex; flex-direction: column; height: 100%; }
        .hub-chat-history { flex: 1; display: flex; flex-direction: column; gap: 15px; margin-bottom: 15px; }
        .hub-chat-intro { text-align: center; padding: 40px 20px; color: #64748b; font-size: 13px; }
        .hub-chat-intro p { margin: 15px 0 10px; }
        .hub-chat-intro ul { text-align: left; list-style: none; padding: 0; opacity: 0.8; }
        .hub-chat-intro li { padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 6px; font-size: 11px; }
        .hub-msg { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
        .hub-msg.user { align-self: flex-end; background: #fb8c36; color: white; }
        .hub-msg.assistant { align-self: flex-start; background: rgba(51, 65, 85, 0.5); color: #e2e8f0; }
        
        .hub-chat-input-wrap { display: flex; gap: 8px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 6px; }
        .hub-chat-input-wrap input { flex: 1; background: transparent; border: none; color: white; font-size: 13px; padding: 8px; }
        .hub-chat-input-wrap input:focus { outline: none; }
        .hub-chat-input-wrap button { width: 34px; height: 34px; border-radius: 8px; background: #fb8c36; border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; }
      `}</style>
    </div>
  );
};

export default DatasetDetailsHub;
