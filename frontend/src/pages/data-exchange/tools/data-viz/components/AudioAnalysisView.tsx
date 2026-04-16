/**
 * AudioAnalysisView.tsx — Tabbed audio analysis result display.
 * Tabs: NLP & Context | AI Chat | Acoustic & Dynamics
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import WaveSurfer from 'wavesurfer.js';
import {
  Play, Pause, FileText, Hash, MapPin, Activity,
  MessageCircle, Send, Loader2, List, Star, Users,
} from 'lucide-react';
import { AudioAnalysisResult, AudioChatMessage, submitAudioChat } from '../services';
import { deriveAudioQuality } from '../utils/audio-quality';
import WaveformCanvas    from './canvas/WaveformCanvas';
import SpectrogramCanvas from './canvas/SpectrogramCanvas';
import EnergyChart       from './canvas/EnergyChart';
import '../../ToolPage.css';

interface Props {
  result: AudioAnalysisResult;
  file?: File;
}

const AudioAnalysisView = ({ result, file }: Props) => {
  const [activeTab, setActiveTab]     = useState<'nlp' | 'chat' | 'acoustic'>('nlp');
  const [isPlaying, setIsPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const waveformRef  = useRef<HTMLDivElement>(null);
  const wavesurfer   = useRef<WaveSurfer | null>(null);
  const [chatMessages, setChatMessages] = useState<AudioChatMessage[]>([]);
  const [chatInput,    setChatInput]    = useState('');
  const [chatLoading,  setChatLoading]  = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const quality = useMemo(() => deriveAudioQuality(result), [result]);

  const getSpeakerColor = (speaker: string) => {
    const hash   = speaker.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    return colors[hash % colors.length];
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  // WaveSurfer setup
  useEffect(() => {
    if (file && waveformRef.current) {
      wavesurfer.current = WaveSurfer.create({
        container:     waveformRef.current,
        waveColor:     '#4f46e5',
        progressColor: '#818cf8',
        cursorColor:   '#c7d2fe',
        barWidth: 2, barGap: 1, barRadius: 2,
        height: 80,
      });
      const url = URL.createObjectURL(file);
      wavesurfer.current.load(url);
      wavesurfer.current.on('play',       () => setIsPlaying(true));
      wavesurfer.current.on('pause',      () => setIsPlaying(false));
      wavesurfer.current.on('timeupdate', (t: number) => setCurrentTime(t));
      return () => { wavesurfer.current?.destroy(); };
    }
  }, [file]);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const togglePlay = () => wavesurfer.current?.playPause();
  const seekTo     = (time: number) => {
    wavesurfer.current?.setTime(time);
    wavesurfer.current?.play();
  };

  const handleSendChat = async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    const newHistory: AudioChatMessage[] = [...chatMessages, { role: 'user', content: q }];
    setChatMessages(newHistory);
    setChatInput('');
    setChatLoading(true);
    try {
      const resp = await submitAudioChat(result.transcript_text, chatMessages, q);
      setChatMessages([...newHistory, { role: 'assistant', content: resp.answer }]);
    } catch (e: any) {
      setChatMessages([...newHistory, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const SUGGESTED_QUESTIONS = [
    'What are the main topics discussed?',
    'Who speaks the most and what do they say?',
    'What decisions or action items were mentioned?',
    'Summarize any disagreements or conflicts.',
  ];

  const sentimentLabel = result.text_analysis?.sentiment?.overall_label ?? 'neutral';
  const sentimentColor = sentimentLabel === 'positive' ? '#4ade80' : sentimentLabel === 'negative' ? '#f87171' : '#94a3b8';
  const sentimentBg    = sentimentLabel === 'positive' ? 'rgba(34,197,94,0.15)' : sentimentLabel === 'negative' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.1)';

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer', border: 'none',
    background: active ? 'rgba(99,102,241,0.2)' : 'transparent',
    color:      active ? '#818cf8' : '#64748b',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1.5rem' }}>

      {/* ── Metadata chips ── */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {result.features && <>
          <span className="chip" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', fontSize: '12px', padding: '5px 12px' }}>
            🎵 {result.features.sample_rate.toLocaleString()} Hz
          </span>
          <span className="chip" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', fontSize: '12px', padding: '5px 12px' }}>
            ⏱ {formatTime(result.features.duration)}
          </span>
          <span className="chip" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', fontSize: '12px', padding: '5px 12px' }}>
            {result.features.num_channels === 1 ? '🔊 Mono' : '🔊 Stereo'}
          </span>
        </>}
        <span className="chip" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)', fontSize: '12px', padding: '5px 12px' }}>
          {result.segments.length} segments
        </span>
        {result.language && (
          <span className="chip" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)', fontSize: '12px', padding: '5px 12px' }}>
            🌐 {result.language}
          </span>
        )}
        <span className="chip" style={{
          background: quality.score >= 70 ? 'rgba(34,197,94,0.12)' : quality.score >= 40 ? 'rgba(251,191,36,0.12)' : 'rgba(239,68,68,0.12)',
          color:      quality.score >= 70 ? '#4ade80' : quality.score >= 40 ? '#fbbf24' : '#f87171',
          border: `1px solid ${quality.score >= 70 ? 'rgba(34,197,94,0.3)' : quality.score >= 40 ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)'}`,
          fontSize: '12px', padding: '5px 12px',
        }}>
          ⭐ Quality: {quality.rating} ({quality.score}/100)
        </span>
      </div>

      {/* ── WaveSurfer player ── */}
      {file && (
        <div className="result-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
            <button onClick={togglePlay} style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#4f46e5', color: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: '3px' }} />}
            </button>
            <div style={{ flex: 1 }} ref={waveformRef} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(result.features?.duration ?? result.duration)}</span>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: '4px', background: 'rgba(15,23,42,0.6)', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
        <button style={TAB_STYLE(activeTab === 'nlp')} onClick={() => setActiveTab('nlp')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><List size={13} /> NLP &amp; Context</span>
        </button>
        <button style={TAB_STYLE(activeTab === 'chat')} onClick={() => setActiveTab('chat')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MessageCircle size={13} /> AI Chat</span>
        </button>
        <button style={TAB_STYLE(activeTab === 'acoustic')} onClick={() => setActiveTab('acoustic')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Activity size={13} /> Acoustic &amp; Dynamics</span>
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 1 — NLP & Context                                         */}
      {activeTab === 'nlp' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>
          {/* LEFT: transcript + action items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="result-card">
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', marginTop: 0 }}>
                <FileText size={16} /> Transcript
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '420px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                {result.segments.map((seg, i) => {
                  const isCurrent = currentTime >= seg.start && currentTime <= seg.end;
                  return (
                    <div key={i} onClick={() => seekTo(seg.start)} style={{ display: 'flex', gap: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', cursor: 'pointer', background: isCurrent ? 'rgba(99,102,241,0.12)' : 'rgba(30,41,59,0.5)', transition: 'background 0.2s', borderLeft: `3px solid ${getSpeakerColor(seg.speaker)}` }}>
                      <div style={{ flexShrink: 0, width: '40px', fontSize: '11px', color: '#64748b', paddingTop: '2px' }}>{formatTime(seg.start)}</div>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: getSpeakerColor(seg.speaker), marginBottom: '2px' }}>{seg.speaker}</div>
                        <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 }}>{seg.text}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {(result.text_analysis?.action_items?.length || result.text_analysis?.decisions?.length) ? (
              <div className="result-card" style={{ padding: '1rem' }}>
                {result.text_analysis?.action_items?.length ? (
                  <>
                    <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem', marginTop: 0, letterSpacing: '0.5px' }}>Action Items</h4>
                    <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem' }}>
                      {result.text_analysis.action_items.map((item, i) => <li key={i} style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6 }}>{item}</li>)}
                    </ul>
                  </>
                ) : null}
                {result.text_analysis?.decisions?.length ? (
                  <>
                    <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem', marginTop: 0, letterSpacing: '0.5px' }}>Decisions</h4>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                      {result.text_analysis.decisions.map((d, i) => <li key={i} style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6 }}>{d}</li>)}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* RIGHT: summary + sentiment + speakers + entities */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {result.text_analysis && (
              <div className="result-card" style={{ padding: '1rem' }}>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem', marginTop: 0, letterSpacing: '0.5px' }}>Summary</h4>
                <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6, margin: '0 0 1rem' }}>{result.text_analysis.summary}</p>
                {(result.text_analysis.emotion || result.text_analysis.tone || result.text_analysis.domain) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '0.75rem' }}>
                    {result.text_analysis.emotion && <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>😊 {result.text_analysis.emotion}</span>}
                    {result.text_analysis.tone   && <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(20,184,166,0.15)',  color: '#2dd4bf', border: '1px solid rgba(20,184,166,0.3)'  }}>🎭 {result.text_analysis.tone}</span>}
                    {result.text_analysis.domain && <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(245,158,11,0.15)',  color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)'  }}>🏷️ {result.text_analysis.domain}</span>}
                  </div>
                )}
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem', marginTop: 0, letterSpacing: '0.5px' }}>Sentiment</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize', background: sentimentBg, color: sentimentColor }}>{sentimentLabel}</span>
                  {result.text_analysis.conversation_score !== undefined && (
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Conv. score: {result.text_analysis.conversation_score}/10</span>
                  )}
                </div>
                <div style={{ height: '8px', width: '100%', display: 'flex', borderRadius: '4px', overflow: 'hidden', background: '#1e293b' }}>
                  <div style={{ width: `${result.text_analysis.sentiment.positive * 100}%`, background: '#22c55e' }} />
                  <div style={{ width: `${result.text_analysis.sentiment.neutral  * 100}%`, background: '#475569' }} />
                  <div style={{ width: `${result.text_analysis.sentiment.negative * 100}%`, background: '#ef4444' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: '#64748b' }}>
                  <span>+{(result.text_analysis.sentiment.positive * 100).toFixed(0)}%</span>
                  <span>{(result.text_analysis.sentiment.neutral * 100).toFixed(0)}%</span>
                  <span>-{(result.text_analysis.sentiment.negative * 100).toFixed(0)}%</span>
                </div>
              </div>
            )}

            {result.segments.length > 0 && (() => {
              const speakers = Array.from(new Set(result.segments.map(s => s.speaker)));
              return (
                <div className="result-card" style={{ padding: '1rem' }}>
                  <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Users size={12} /> Speakers</span>
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {speakers.map(sp => {
                      const m = result.speaker_metrics?.[sp];
                      return (
                        <div key={sp}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', marginBottom: '4px' }}>
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0, background: getSpeakerColor(sp) }} />
                            <span style={{ color: '#e2e8f0' }}>{sp}</span>
                            <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '11px' }}>{result.segments.filter(s => s.speaker === sp).length} segs</span>
                          </div>
                          {m && (
                            <div style={{ paddingLeft: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', color: '#64748b' }}>Dom: {((m.dominance_ratio ?? 0) * 100).toFixed(0)}%</span>
                              <span style={{ fontSize: '10px', color: '#64748b' }}>WPM: {Math.round(m.wpm ?? 0)}</span>
                              <span style={{ fontSize: '10px', color: '#64748b' }}>Part: {((m.participation_ratio ?? 0) * 100).toFixed(0)}%</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {result.interruption_count !== undefined && (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #1e293b', fontSize: '12px', color: '#64748b' }}>
                      ⚡ Interruptions: {result.interruption_count}
                    </div>
                  )}
                </div>
              );
            })()}

            {result.text_analysis?.entities && result.text_analysis.entities.length > 0 && (
              <div className="result-card" style={{ padding: '1rem' }}>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Entities</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {result.text_analysis.entities.slice(0, 15).map((e: any) => (
                    <span key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '11px', padding: '0.25rem 0.5rem', background: '#1e293b', borderRadius: '6px', border: '1px solid #334155', color: '#cbd5e1' }}>
                      {e.type === 'Person' ? <Hash size={11} /> : e.type === 'Place' ? <MapPin size={11} /> : <Activity size={11} />}
                      {e.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.text_analysis?.top_keyphrases?.length ? (
              <div className="result-card" style={{ padding: '1rem' }}>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Key Phrases</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {result.text_analysis.top_keyphrases.slice(0, 12).map((p, i) => (
                    <span key={i} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>{p}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 2 — AI Chat                                                */}
      {activeTab === 'chat' && (
        <div className="result-card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', marginTop: 0 }}>
            <MessageCircle size={16} /> Ask About This Recording
          </h3>

          {chatMessages.length === 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 0.75rem' }}>Suggested questions:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button key={i} onClick={() => setChatInput(q)} style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '8px', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)', cursor: 'pointer' }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem', paddingRight: '0.25rem' }}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '80%', padding: '0.6rem 0.9rem', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: msg.role === 'user' ? 'rgba(99,102,241,0.2)' : 'rgba(30,41,59,0.8)', border: `1px solid ${msg.role === 'user' ? 'rgba(99,102,241,0.3)' : '#1e293b'}`, fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', gap: '4px', padding: '0.6rem 0.9rem' }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#818cf8', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendChat()}
              placeholder="Ask anything about the recording…"
              disabled={chatLoading}
              style={{ flex: 1, padding: '0.6rem 0.9rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: '13px', outline: 'none' }}
            />
            <button onClick={handleSendChat} disabled={chatLoading || !chatInput.trim()} style={{ padding: '0.6rem 1rem', borderRadius: '8px', background: chatLoading ? '#334155' : '#4f46e5', color: 'white', border: 'none', cursor: chatLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
              {chatLoading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              Send
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 3 — Acoustic & Dynamics                                    */}
      {activeTab === 'acoustic' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Quality scorecard */}
          <div className="result-card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', marginTop: 0 }}>
              <Star size={16} /> Audio Quality Analysis
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
              <div style={{ position: 'relative', width: '80px', height: '80px', flexShrink: 0 }}>
                <svg viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)', width: '80px', height: '80px' }}>
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#1e293b" strokeWidth="8" />
                  <circle cx="40" cy="40" r="32" fill="none"
                    stroke={quality.score >= 70 ? '#4ade80' : quality.score >= 40 ? '#fbbf24' : '#f87171'}
                    strokeWidth="8"
                    strokeDasharray={`${(quality.score / 100) * 201} 201`}
                    strokeLinecap="round" />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>{quality.score}</span>
                  <span style={{ fontSize: '9px', color: '#64748b' }}>/ 100</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px' }}>{quality.rating}</div>
                <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>{quality.summary}</div>
                {quality.snrDb > 0 && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>SNR: {quality.snrDb} dB</div>}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {Object.entries(quality.metrics).map(([key, val]) => (
                <div key={key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                    <span style={{ textTransform: 'capitalize' }}>{key}</span>
                    <span>{val}%</span>
                  </div>
                  <div style={{ height: '6px', background: '#1e293b', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${val}%`, background: val >= 70 ? '#4ade80' : val >= 40 ? '#fbbf24' : '#f87171', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {result.features?.waveform  && <WaveformCanvas waveform={result.features.waveform}   currentTime={currentTime} duration={result.features.duration} />}
            {result.features?.energy    && <EnergyChart    energy={result.features.energy}        currentTime={currentTime} />}
          </div>

          {/* New Acoustic Features Panel (Ported) */}
          {result.features && (
            <div className="result-card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', marginTop: 0 }}>
                <Activity size={16} /> Key Acoustic Signals
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: 'rgba(30,41,59,0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Estimated Tempo</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>{result.features.tempo} <span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>BPM</span></div>
                </div>
                <div style={{ padding: '1rem', background: 'rgba(30,41,59,0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Spectral Centroid</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>{Math.round(result.features.spectral_centroid_mean ?? 0)} <span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>Hz</span></div>
                </div>
                <div style={{ padding: '1rem', background: 'rgba(30,41,59,0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Sample Rate</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>{result.features.sample_rate / 1000} <span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>kHz</span></div>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: result.features?.mel_spectrogram ? '1fr 1fr' : '1fr', gap: '1rem' }}>
            {result.features?.spectrogram     && <SpectrogramCanvas spectrogram={result.features.spectrogram}     currentTime={currentTime} duration={result.features.duration} title="STFT Spectrogram" />}
            {result.features?.mel_spectrogram && <SpectrogramCanvas spectrogram={result.features.mel_spectrogram} currentTime={currentTime} duration={result.features.duration} title="Mel Spectrogram" />}
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioAnalysisView;
