import { useState, useRef } from 'react';
import {
  Clock, FileText, Network, Zap, Cpu, Code2, Sparkles,
  ArrowRight, MessageCircle,
} from 'lucide-react';
import { CodeAnalysisResult } from '../services';
import { generateMermaidGraph } from '../utils/mermaid-helpers';
import MermaidDiagram from '../../../../../components/MermaidDiagram';

interface Props {
  result: CodeAnalysisResult;
}

const TONE_COLORS: Record<string, string> = {
  toneBlue: '#3b82f6', toneAmber: '#f59e0b', toneMint: '#10b981',
  toneRose: '#f43f5e', toneIndigo: '#6366f1', toneTeal: '#14b8a6',
};

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? 'http://localhost:9080').replace(/\/$/, '');

const CodeAnalysisView = ({ result }: Props) => {
  const [chatMsgs, setChatMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const buildCodeContext = (r: CodeAnalysisResult): string => {
    const lines: string[] = [];
    lines.push(`PROJECT: ${r.architecture?.title || r.filename}`);
    lines.push(`SUMMARY: ${r.architecture?.summary || ''}`);
    lines.push(`TECH STACK: ${(r.architecture?.tech_stack || []).join(', ')}`);
    lines.push(`PATTERNS: ${(r.architecture?.detected_patterns || []).join(', ')}`);
    (r.architecture?.nodes || []).slice(0, 15).forEach(n =>
      lines.push(`COMPONENT: ${n.label} (${n.type}) — ${n.description || ''} [${n.path || ''}]`)
    );
    (r.details?.key_files || []).slice(0, 8).forEach(f =>
      lines.push(`FILE: ${f.file_path} — ${f.summary}`)
    );
    (r.details?.tech_debt || []).slice(0, 5).forEach(d => lines.push(`DEBT: ${d}`));
    (r.details?.security_risks || []).slice(0, 5).forEach(s => lines.push(`RISK: ${s}`));
    return lines.join('\n');
  };

  const handleCodeChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const question = chatInput.trim();
    const userMsg = { role: 'user' as const, content: question };
    setChatMsgs(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    try {
      const res = await fetch(`${BASE_URL}/team5/code-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          context: buildCodeContext(result),
          history: chatMsgs.slice(-6),
        }),
      });
      const data = await res.json();
      setChatMsgs(prev => [...prev, { role: 'assistant', content: data.answer || 'No response.' }]);
    } catch {
      setChatMsgs(prev => [...prev, { role: 'assistant', content: 'Error contacting AI. Please try again.' }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  const groupColor = (groups: any[], gid: string) => {
    const idx = groups.findIndex((g: any) => g.id === gid);
    return Object.values(TONE_COLORS)[idx % 6] ?? '#64748b';
  };

  const buildSections = (nodes: any[], groups: any[]) => {
    const groupMap = Object.fromEntries(groups.map((g: any) => [g.id, g.label]));
    const sections: { label: string; color: string; nodes: any[] }[] = [];
    groups.forEach((g: any) => {
      const members = nodes.filter((n: any) => n.group_id === g.id);
      if (members.length) sections.push({ label: g.label, color: groupColor(groups, g.id), nodes: members });
    });
    const ungrouped = nodes.filter((n: any) => !n.group_id || !groupMap[n.group_id]);
    if (ungrouped.length) sections.push({ label: 'Other', color: '#64748b', nodes: ungrouped });
    return sections;
  };

  const nodes = result.architecture?.nodes ?? [];
  const groups = result.architecture?.groups ?? [];

  return (
    <div className="code-analysis-view">
      {/* ── Analysis run stats strip ── */}
      <div className="metrics-strip">
        {[
          {
            icon: <Clock size={13} />,
            label: 'Analysis time',
            value: `${(result.metadata?.total_duration_sec || 0).toFixed(1)}s`,
            sub: '3-pass pipeline',
          },
          {
            icon: <FileText size={13} />,
            label: 'Files scanned',
            value: result.file_count.toLocaleString(),
            sub: `${result.metadata?.nodes_count ?? 0} source files parsed`,
          },
          {
            icon: <Network size={13} />,
            label: 'Diagram',
            value: `${result.architecture?.nodes?.length ?? 0} nodes`,
            sub: `${result.architecture?.groups?.length ?? 0} groups · ${result.architecture?.edges?.length ?? 0} edges`,
          },
          {
            icon: <Zap size={13} />,
            label: 'LLM tokens used',
            value: (result.metadata?.total_tokens ?? 0).toLocaleString(),
            sub: `${(result.metadata?.input_tokens ?? 0).toLocaleString()} in / ${(result.metadata?.output_tokens ?? 0).toLocaleString()} out`,
          },
          {
            icon: <Cpu size={13} />,
            label: 'Model',
            value: (result.metadata?.arch_model ?? 'Groq Llama 3').replace('llama-3.3-70b-versatile', 'Llama 3.3 70B'),
            sub: 'via Groq',
          },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <span className="metric-card-icon">{s.icon}</span>
            <div className="metric-card-content">
              <div className="metric-card-label">{s.label}</div>
              <div className="metric-card-value">{s.value}</div>
              <div className="metric-card-sub">{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Architecture Map ── */}
      {nodes.length > 0 && (
        <div className="result-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b' }}>
            <h4 style={{ margin: 0, color: '#fb8c36', fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Network size={18} /> System Architecture Map
            </h4>
            <span style={{ fontSize: 11, color: '#475569' }}>
              {groups.length ?? 0} groups · {nodes.length} nodes · {result.architecture.edges?.length ?? 0} edges
            </span>
          </div>
          <div style={{ height: 540, background: '#020617' }}>
            <MermaidDiagram chart={generateMermaidGraph(result.architecture)} />
          </div>
        </div>
      )}

      {/* ── Summary + Patterns + Tech stack | Process Flow ── */}
      <div className="viz-row">
        <div className="result-card" style={{ flex: 1 }}>
          <div className="summary-section">
            <h4><Code2 size={20} /> {result.architecture?.title}</h4>
            <p>{result.architecture?.summary}</p>
          </div>

          {(result.architecture?.tech_stack?.length ?? 0) > 0 && (
            <div style={{ marginTop: '16px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {result.architecture.tech_stack.map((t, i) => (
                <span key={i} className="chip" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', borderColor: 'rgba(99,102,241,0.3)', padding: '4px 10px', fontSize: '11px' }}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {result.architecture?.detected_patterns && result.architecture.detected_patterns.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {result.architecture.detected_patterns.map((p, i) => (
                  <span key={i} className="chip" style={{ background: 'rgba(251, 140, 54, 0.1)', color: '#fb8c36', borderColor: 'rgba(251, 140, 54, 0.3)', padding: '4px 10px', fontSize: '11px' }}>
                    <Sparkles size={10} /> {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Node cards grouped by group */}
          {nodes.length > 0 && buildSections(nodes, groups).map(sec => (
            <div key={sec.label} style={{ marginTop: '24px' }}>
              <h4 style={{ color: sec.color, fontSize: '13px', fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: sec.color, display: 'inline-block' }} />
                {sec.label}
              </h4>
              <div className="components-grid">
                {sec.nodes.map((n: any) => (
                  <div key={n.id} className="comp-item" style={{ borderColor: sec.color + '33' }}>
                    <strong style={{ color: '#f1f5f9' }}>{n.label}</strong>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0 8px' }}>
                      <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700 }}>{n.type}</span>
                      {n.shape && n.shape !== 'box' && <span style={{ color: sec.color, fontSize: '10px', fontWeight: 700 }}>{n.shape}</span>}
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0 }}>{n.description}</p>
                    {n.path && (
                      <div style={{ marginTop: '10px' }}>
                        <span className="chip" style={{ fontSize: '10px', padding: '2px 8px', color: sec.color, borderColor: sec.color + '44' }}>{n.path.split('/').pop()}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Process Flow */}
        <div className="result-card" style={{ width: '300px', flexShrink: 0 }}>
          <h4 style={{ color: '#fb8c36', marginTop: 0, fontSize: '16px', fontWeight: 700 }}>Process Flow</h4>
          <div className="timeline-list">
            {result.details?.flow?.map(f => (
              <div key={f.step} className="timeline-item" style={{ border: 'none', background: 'transparent', paddingLeft: 0 }}>
                <span className="date" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>Step {f.step}</span>
                <span className="desc" style={{ display: 'block', marginTop: '4px', lineHeight: 1.5, color: '#94a3b8', fontSize: '12px' }}>{f.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Architecture Components full-width ── */}
      {nodes.length > 0 && (
        <div className="result-card">
          <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '20px', fontSize: '16px', fontWeight: 700 }}>Architecture Components</h4>
          {buildSections(nodes, groups).map(sec => (
            <div key={sec.label} style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: sec.color, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: sec.color, display: 'inline-block' }} />
                {sec.label}
              </div>
              <div className="components-grid">
                {sec.nodes.map((n: any) => (
                  <div key={n.id} className="comp-item" style={{ borderColor: sec.color + '33' }}>
                    <strong style={{ color: '#f1f5f9', fontSize: '13px' }}>{n.label}</strong>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 6px' }}>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>{n.type}</span>
                      {n.shape && n.shape !== 'box' && <span style={{ color: sec.color, fontSize: '10px', fontWeight: 700 }}>{n.shape}</span>}
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0 }}>{n.description}</p>
                    {n.path && <span className="chip" style={{ marginTop: 8, fontSize: '10px', padding: '2px 8px', color: sec.color, borderColor: sec.color + '44', display: 'inline-block' }}>{n.path.split('/').pop()}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Data flows + Debt + Risks ── */}
      <div className="viz-row">
        {(result.architecture?.edges?.length ?? 0) > 0 && (
          <div className="result-card" style={{ flex: 1 }}>
            <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '14px', fontSize: '15px', fontWeight: 700 }}>Data Flows</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {result.architecture.edges.map((e: any, idx: number) => {
                const srcNode = nodes.find((n: any) => n.id === e.source);
                const tgtNode = nodes.find((n: any) => n.id === e.target);
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: '#60a5fa', fontWeight: 600 }}>{srcNode?.label ?? e.source}</span>
                    <ArrowRight size={11} color={e.style === 'dashed' ? '#64748b' : '#fb8c36'} />
                    <span style={{ color: '#4ade80', fontWeight: 600 }}>{tgtNode?.label ?? e.target}</span>
                    {e.label && <span style={{ color: '#64748b', fontStyle: 'italic', marginLeft: 'auto', fontSize: '10px' }}>{e.label}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {result.details?.tech_debt && result.details.tech_debt.length > 0 && (
          <div className="result-card" style={{ flex: 1, border: '1px solid rgba(244,114,182,0.3)' }}>
            <h4 style={{ color: '#f472b6', marginTop: 0, fontSize: '15px', fontWeight: 700 }}>Technical Debt</h4>
            <ul style={{ margin: '10px 0 0', paddingLeft: '18px', color: '#cbd5e1', fontSize: '12px', lineHeight: 1.6 }}>
              {result.details.tech_debt.map((dt, i) => <li key={i}>{dt}</li>)}
            </ul>
          </div>
        )}
        {result.details?.security_risks && result.details.security_risks.length > 0 && (
          <div className="result-card" style={{ flex: 1, border: '1px solid rgba(239,68,68,0.3)' }}>
            <h4 style={{ color: '#f87171', marginTop: 0, fontSize: '15px', fontWeight: 700 }}>Security Risks</h4>
            <ul style={{ margin: '10px 0 0', paddingLeft: '18px', color: '#cbd5e1', fontSize: '12px', lineHeight: 1.6 }}>
              {result.details.security_risks.map((sr, i) => <li key={i}>{sr}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* ── Key files ── */}
      {result.details?.key_files && result.details.key_files.length > 0 && (
        <div className="result-card">
          <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '20px', fontSize: '16px', fontWeight: 700 }}>Deep Analysis: Core Modules</h4>
          <div className="key-files-grid">
            {result.details.key_files.map((kf, i) => (
              <div key={i} className="key-file-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <FileText size={14} color="#fb8c36" />
                  <div style={{ fontWeight: '700', color: '#f1f5f9', fontSize: '13px' }}>{kf.file_path}</div>
                </div>
                <p style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '12px', lineHeight: 1.5 }}>{kf.summary}</p>
                {kf.key_functions && kf.key_functions.length > 0 && (
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '10px', color: '#fb8c36', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '1px', fontWeight: 800 }}>Methods</div>
                    <ul style={{ margin: 0, paddingLeft: '14px', color: '#cbd5e1', fontSize: '11px', lineHeight: 1.5 }}>
                      {kf.key_functions.map((func, j) => <li key={j}>{func}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Codebase Chat ── */}
      <div className="result-card" style={{ marginTop: '8px' }}>
        <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageCircle size={16} color="#fb8c36" /> Ask About This Codebase
        </h4>
        <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
          {chatMsgs.length === 0 && (
            <p style={{ color: '#475569', fontSize: '12px', margin: 0 }}>
              Ask anything — architecture decisions, data flows, security risks, tech debt…
            </p>
          )}
          {chatMsgs.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? 'rgba(251,140,54,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${m.role === 'user' ? 'rgba(251,140,54,0.3)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '10px',
              padding: '8px 12px',
              fontSize: '12px',
              color: '#e2e8f0',
              lineHeight: 1.5,
            }}>
              {m.content}
            </div>
          ))}
          {chatLoading && (
            <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: '12px' }}>Thinking…</div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleCodeChat()}
            placeholder="e.g. How does authentication work?"
            disabled={chatLoading}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', padding: '8px 12px', color: '#f1f5f9', fontSize: '12px', outline: 'none',
            }}
          />
          <button
            onClick={handleCodeChat}
            disabled={chatLoading || !chatInput.trim()}
            style={{
              background: '#fb8c36', border: 'none', borderRadius: '8px', padding: '8px 14px',
              color: '#fff', fontSize: '12px', fontWeight: 600, cursor: chatLoading ? 'not-allowed' : 'pointer',
              opacity: chatLoading || !chatInput.trim() ? 0.5 : 1,
            }}
          >
            {chatLoading ? '…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CodeAnalysisView;
