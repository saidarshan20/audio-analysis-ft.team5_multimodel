/**
 * AudioAnalysisView.tsx — Redesigned tabbed audio analysis result display.
 * Tabs: NLP & Context | AI Chat & Search | Advanced Analysis
 *
 * Changes from v1:
 * - Decision-first NLP tab (verdict + core signals + actions)
 * - Executive Breakdown card (summary + tone/topic chips + KEY TAKEAWAYS bullets)
 * - Toggleable transcript (default collapsed, scroll only if >6 segments)
 * - Sentiment compact card in core signals row
 * - Segment Analytics card (decisions/agreements + questions/disagreements)
 * - Topic Segments card
 * - Speaker gender badge (pitch-based)
 * - Advanced tab always expanded with top-line metric summary
 * - AI chat: fixed scroll area + enriched context (not just transcript)
 * - Cleanliness replaces Noise in quality metrics
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import WaveSurfer from 'wavesurfer.js';
import {
  Play, Pause, FileText, Hash, MapPin, Activity,
  MessageCircle, Send, Loader2, List, Users,
  ChevronDown, ChevronUp,
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

// ── Gender badge colors ────────────────────────────────────────────────────────
const genderStyle = (tag: string): React.CSSProperties => {
  if (tag === 'Likely Male')   return { background: 'rgba(59,130,246,0.15)',  color: '#60a5fa',  border: '1px solid rgba(59,130,246,0.3)'  };
  if (tag === 'Likely Female') return { background: 'rgba(236,72,153,0.15)',  color: '#f472b6',  border: '1px solid rgba(236,72,153,0.3)'  };
  return                              { background: 'rgba(100,116,139,0.15)', color: '#94a3b8',  border: '1px solid rgba(100,116,139,0.3)' };
};

const ALL_SUGGESTIONS = [
  'What is the speaker likely gender and why?',
  'What are the main topics discussed?',
  'What decisions or action items were mentioned?',
  'Summarize the overall tone and emotion of the recording.',
];

const AudioAnalysisView = ({ result, file }: Props) => {
  const [activeTab, setActiveTab]         = useState<'nlp' | 'chat' | 'acoustic'>('nlp');
  const [isPlaying, setIsPlaying]         = useState(false);
  const [currentTime, setCurrentTime]     = useState(0);
  const waveformRef  = useRef<HTMLDivElement>(null);
  const wavesurfer   = useRef<WaveSurfer | null>(null);
  const [chatMessages, setChatMessages]   = useState<AudioChatMessage[]>([]);
  const [chatInput,    setChatInput]      = useState('');
  const [chatLoading,  setChatLoading]    = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [qualityExpanded, setQualityExpanded] = useState(false);
  // Transcript collapsed by default
  const [transcriptOpen,  setTranscriptOpen]  = useState(false);
  // Suggestion UX state
  const [usedSuggestions,    setUsedSuggestions]    = useState<Set<string>>(new Set());
  const [suggestionsHidden,  setSuggestionsHidden]  = useState(false);

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
      const url = URL.createObjectURL(file);
      wavesurfer.current = WaveSurfer.create({
        container:     waveformRef.current,
        waveColor:     '#4f46e5',
        progressColor: '#818cf8',
        cursorColor:   '#c7d2fe',
        barWidth: 2,
        barGap: 1.5,
        barRadius: 2,
        height: 68,
      });
      wavesurfer.current.load(url);
      wavesurfer.current.on('play',       () => setIsPlaying(true));
      wavesurfer.current.on('pause',      () => setIsPlaying(false));
      wavesurfer.current.on('timeupdate', (t: number) => setCurrentTime(t));
      return () => {
        wavesurfer.current?.destroy();
        URL.revokeObjectURL(url);
      };
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

  // ── Enriched AI chat context ───────────────────────────────────────────────
  const buildChatContext = (): string => {
    const ta = result.text_analysis;
    const lines: string[] = [];

    lines.push('=== AUDIO ANALYSIS CONTEXT ===\n');

    // Basic meta
    lines.push(`Duration: ${formatTime(result.duration)} | Language: ${result.language || 'unknown'}`);
    if (result.features) {
      lines.push(`Sample Rate: ${result.features.sample_rate} Hz | Channels: ${result.features.num_channels === 1 ? 'Mono' : 'Stereo'}`);
    }

    // Speaker gender
    if (result.speaker_metrics && Object.keys(result.speaker_metrics).length > 0) {
      lines.push('\n--- SPEAKER INFO ---');
      for (const [sp, m] of Object.entries(result.speaker_metrics)) {
        const gender = (m as any).gender_tag || '';
        const pitch  = (m as any).pitch_mean ? `${(m as any).pitch_mean} Hz` : '';
        lines.push(`${sp}: ${gender}${pitch ? ` (pitch ~${pitch})` : ''} | ${Math.round((m as any).dominance_ratio * 100)}% airtime | ${Math.round((m as any).wpm)} WPM`);
      }
      if (result.interruption_count) {
        lines.push(`Interruptions detected: ${result.interruption_count}`);
      }
    }

    // Audio quality
    lines.push(`\n--- AUDIO QUALITY ---`);
    lines.push(`Score: ${quality.score}/100 (${quality.rating}) | SNR: ${quality.snrDb} dB | Source: ${quality.source}${quality.showEstimatedBadge ? ' (estimated)' : ''}`);
    lines.push(quality.summary);

    // NLP analysis
    if (ta) {
      lines.push('\n--- NLP ANALYSIS ---');
      if (ta.emotion)  lines.push(`Emotion: ${ta.emotion}`);
      if (ta.tone)     lines.push(`Tone: ${ta.tone}`);
      if (ta.domain)   lines.push(`Domain: ${ta.domain}`);
      if (ta.topic)    lines.push(`Topic: ${ta.topic}`);
      const sent = ta.sentiment;
      lines.push(`Sentiment: ${sent.overall_label} (Positive: ${Math.round(sent.positive * 100)}%, Neutral: ${Math.round(sent.neutral * 100)}%, Negative: ${Math.round(sent.negative * 100)}%)`);

      if (ta.bullet_points?.length) {
        lines.push('\nKey Takeaways:');
        ta.bullet_points.forEach(bp => lines.push(`  • ${bp}`));
      }
      if (ta.decisions?.length) {
        lines.push('\nDecisions: ' + ta.decisions.join('; '));
      }
      if (ta.agreements?.length) {
        lines.push('Agreements: ' + ta.agreements.join('; '));
      }
      if (ta.action_items?.length) {
        lines.push('\nAction Items:');
        ta.action_items.forEach(ai => lines.push(`  → ${ai}`));
      }
      if (ta.word_count) {
        lines.push(`\nWord Count: ${ta.word_count} | Sentences: ${ta.sentence_count}`);
      }
    }

    lines.push('\n=== TRANSCRIPT ===\n');
    lines.push(result.transcript_text || '(no transcript)');

    return lines.join('\n');
  };

  const handleSendChat = async (overrideQ?: string) => {
    const q = (overrideQ ?? chatInput).trim();
    if (!q || chatLoading) return;
    // Mark suggestion as used if it came from a chip
    if (overrideQ) setUsedSuggestions(prev => new Set([...prev, overrideQ]));
    const newHistory: AudioChatMessage[] = [...chatMessages, { role: 'user', content: q }];
    setChatMessages(newHistory);
    setChatInput('');
    setChatLoading(true);
    try {
      const ctx = buildChatContext();
      const resp = await submitAudioChat(ctx, chatMessages, q);
      setChatMessages([...newHistory, { role: 'assistant', content: resp.answer }]);
    } catch (e: any) {
      setChatMessages([...newHistory, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Remaining suggestions = all that haven't been used yet
  const remainingSuggestions = ALL_SUGGESTIONS.filter(q => !usedSuggestions.has(q));

  const sentimentLabel = result.text_analysis?.sentiment?.overall_label ?? 'neutral';
  const qualityStatusColor = quality.score >= 70 ? '#4ade80' : quality.score >= 40 ? '#fbbf24' : '#f87171';
  const qualityStatusBorder = quality.score >= 70 ? 'rgba(34,197,94,0.35)' : quality.score >= 40 ? 'rgba(251,191,36,0.35)' : 'rgba(239,68,68,0.35)';
  const unscoredAudio = !!result.audio_quality && (result.audio_quality.overall_score === null || result.audio_quality.overall_score === undefined);

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer', border: 'none',
    background: active ? 'rgba(99,102,241,0.2)' : 'transparent',
    color:      active ? '#818cf8' : '#64748b',
    transition: 'all 0.15s',
  });

  const CARD: React.CSSProperties = {
    background: 'rgba(15,23,42,0.7)',
    border: '1px solid rgba(30,41,59,0.8)',
    borderRadius: '12px',
    padding: '1rem',
  };

  const ta = result.text_analysis;

  // Transcript scrollable only if >6 segments
  const transcriptScrollable = result.segments.length > 6;

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
        {result.language && result.language.toLowerCase() !== 'en' && (
          <span className="chip" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)', fontSize: '12px', padding: '5px 12px' }}>
            🌐 {result.language}
          </span>
        )}
      </div>



      {/* ── Audio playback card ── */}
      {file && (
        <div style={{ background: 'rgba(15,23,42,0.65)', border: '1px solid rgba(30,41,59,0.9)', borderRadius: '22px', padding: '1rem 1.1rem 0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <button
              onClick={togglePlay}
              style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#4f46e5', color: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} style={{ marginLeft: '2px' }} />}
            </button>
            <div style={{ width: '1px', alignSelf: 'stretch', background: 'rgba(148,163,184,0.35)' }} />
            <div ref={waveformRef} style={{ flex: 1, minWidth: 0 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.45rem', fontSize: '11px', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(result.features?.duration ?? result.duration)}</span>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(15,23,42,0.6)', borderRadius: '10px', padding: '4px' }}>
          <button style={TAB_STYLE(activeTab === 'nlp')} onClick={() => setActiveTab('nlp')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><List size={13} /> NLP &amp; Context</span>
          </button>
          <button style={TAB_STYLE(activeTab === 'chat')} onClick={() => setActiveTab('chat')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MessageCircle size={13} /> AI Chat &amp; Search</span>
          </button>
          <button style={TAB_STYLE(activeTab === 'acoustic')} onClick={() => setActiveTab('acoustic')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Activity size={13} /> Advanced Analysis</span>
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB 1 — NLP & Context                                                 */}
      {activeTab === 'nlp' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            style={{
              ...CARD,
              borderLeft: `4px solid ${qualityStatusColor}`,
              borderColor: qualityStatusBorder,
              background: 'linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.65))',
            }}
          >
            {result.verdict?.title ? (
              <>
                <div style={{ fontSize: '26px', fontWeight: 800, lineHeight: 1.1, color: '#e2e8f0', marginBottom: '0.45rem' }}>
                  {result.verdict.title}
                </div>
                <p style={{ margin: 0, fontSize: '14px', color: '#cbd5e1', lineHeight: 1.6 }}>
                  {result.verdict.description || 'Audio analysis is complete. Review the core signals below for a quick decision.'}
                </p>
              </>
            ) : (
              <>
                <div style={{ width: '42%', height: '12px', borderRadius: '999px', background: 'rgba(148,163,184,0.25)', marginBottom: '0.65rem' }} />
                <div style={{ width: '88%', height: '10px', borderRadius: '999px', background: 'rgba(148,163,184,0.18)' }} />
              </>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.9rem' }}>
            <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => setQualityExpanded(v => !v)}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#64748b', fontWeight: 700, marginBottom: '0.25rem' }}>Quality Score</div>
                  {unscoredAudio ? (
                    <>
                      <div style={{ fontSize: '20px', color: '#fbbf24', fontWeight: 700 }}>Unscored</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>Audio not detected as speech</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '22px', color: '#e2e8f0', fontWeight: 800 }}>{quality.score} / 100</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{result.interpretation?.noise_label || quality.rating}</div>
                    </>
                  )}
                </div>
                {qualityExpanded ? <ChevronUp size={18} color="#94a3b8" /> : <ChevronDown size={18} color="#94a3b8" />}
              </button>
              {qualityExpanded && !unscoredAudio && (
                <div style={{ borderTop: '1px solid #1e293b', padding: '0.75rem 1rem 1rem', display: 'grid', gap: '0.65rem' }}>
                  {Object.entries(quality.metrics).map(([key, val]) => (
                    <div key={key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                        <span style={{ textTransform: 'capitalize' }}>{key}</span>
                        <span>{val}%</span>
                      </div>
                      <div style={{ height: '6px', background: '#1e293b', borderRadius: '6px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${val}%`, background: val >= 70 ? '#4ade80' : val >= 40 ? '#fbbf24' : '#f87171' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...CARD }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#64748b', fontWeight: 700, marginBottom: '0.35rem' }}>Emotion</div>
              <div style={{ fontSize: '24px', color: '#e2e8f0', fontWeight: 800, lineHeight: 1.1 }}>{ta?.emotion || 'Unknown'}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '0.35rem', textTransform: 'capitalize' }}>{ta?.tone || ta?.environment || '—'}</div>
            </div>

            <div style={{ ...CARD }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#64748b', fontWeight: 700, marginBottom: '0.35rem' }}>Sentiment</div>
              <div style={{ fontSize: '24px', color: '#e2e8f0', fontWeight: 800, lineHeight: 1.1, textTransform: 'capitalize' }}>{sentimentLabel}</div>
              {ta?.sentiment && (
                <>
                  <div style={{ height: '8px', width: '100%', display: 'flex', borderRadius: '4px', overflow: 'hidden', background: '#1e293b', marginTop: '0.55rem' }}>
                    <div style={{ width: `${ta.sentiment.positive * 100}%`, background: 'linear-gradient(90deg, #22c55e, #4ade80)' }} />
                    <div style={{ width: `${ta.sentiment.neutral * 100}%`, background: '#475569' }} />
                    <div style={{ width: `${ta.sentiment.negative * 100}%`, background: 'linear-gradient(90deg, #f87171, #ef4444)' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: '#64748b' }}>
                    <span>+{(ta.sentiment.positive * 100).toFixed(0)}%</span>
                    <span>{(ta.sentiment.neutral * 100).toFixed(0)}%</span>
                    <span>-{(ta.sentiment.negative * 100).toFixed(0)}%</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {(result.recommended_actions?.length ?? 0) > 0 && (
            <div style={{ ...CARD, padding: '0.8rem 1rem' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#64748b', fontWeight: 700, marginBottom: '0.5rem' }}>Recommended Actions</div>
              <div style={{ display: 'grid', gap: '0.35rem' }}>
                {result.recommended_actions?.map((action, idx) => (
                  <div key={idx} style={{ fontSize: '13px', color: '#cbd5e1', display: 'flex', gap: '0.55rem' }}>
                    <span style={{ color: '#818cf8' }}>→</span>
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {ta && (() => {
                const bulletPoints = ta.bullet_points ?? [];
                const normTone = ta.tone?.trim() || '';
                const normDomain = ta.domain?.trim() || '';
                const normTopic = ta.topic?.trim() || '';
                const seen = new Set<string>();
                const chips: { label: string; style: React.CSSProperties }[] = [];
                const addChip = (val: string, style: React.CSSProperties) => {
                  if (!val) return;
                  const key = val.toLowerCase();
                  if (!seen.has(key)) { seen.add(key); chips.push({ label: val, style }); }
                };
                addChip(normTone, { fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', fontWeight: 600 });
                addChip(normDomain, { fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: 'rgba(20,184,166,0.15)', color: '#2dd4bf', border: '1px solid rgba(20,184,166,0.3)', fontWeight: 600 });
                addChip(normTopic, { fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)', fontWeight: 600 });
                return (
                  <div style={{ ...CARD }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '6px' }}>
                      <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#64748b', fontWeight: 700 }}>Executive Breakdown</span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {chips.map((c, i) => <span key={i} style={c.style}>{c.label}</span>)}
                      </div>
                    </div>
                    <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.7, margin: '0 0 0.75rem' }}>{ta.summary}</p>
                    {bulletPoints.length > 0 && (
                      <div style={{ borderLeft: '2px solid rgba(99,102,241,0.4)', paddingLeft: '0.75rem', marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#64748b', fontWeight: 700, marginBottom: '0.4rem' }}>Key Takeaways</div>
                        <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {bulletPoints.map((bp, i) => (
                            <li key={i} style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.5 }}>{bp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div style={{ marginTop: '0.35rem', paddingTop: '0.55rem', borderTop: '1px solid #1e293b', display: 'flex', gap: '0.8rem', flexWrap: 'wrap', fontSize: '11px', color: '#64748b' }}>
                      <span>Words: <strong style={{ color: '#94a3b8' }}>{ta.word_count || result.transcript_text.split(/\s+/).filter(Boolean).length}</strong></span>
                      <span>Duration: <strong style={{ color: '#94a3b8' }}>{formatTime(result.duration)}</strong></span>
                      <span>Segments: <strong style={{ color: '#94a3b8' }}>{result.segments.length}</strong></span>
                    </div>
                  </div>
                );
              })()}

              <div style={{ ...CARD, padding: '0' }}>
                <button
                  onClick={() => setTranscriptOpen(o => !o)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, color: '#818cf8' }}>
                    <FileText size={15} /> Interactive Transcript
                    <span style={{ fontSize: '11px', color: '#475569', fontWeight: 400 }}>({result.segments.length} segments)</span>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {!transcriptOpen && result.segments.length > 0 && (
                      <span style={{ fontSize: '11px', color: '#475569' }}>Click to expand</span>
                    )}
                    {transcriptOpen ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
                  </div>
                </button>

                {transcriptOpen && (
                  <div style={{ padding: '0 0.75rem 0.75rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', ...(transcriptScrollable ? { maxHeight: '340px', overflowY: 'auto', paddingRight: '0.25rem' } : {}) }}>
                      {result.segments.map((seg, i) => {
                        const isCurrent = currentTime >= seg.start && currentTime <= seg.end;
                        return (
                          <div
                            key={i}
                            onClick={() => seekTo(seg.start)}
                            style={{ display: 'flex', gap: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', cursor: 'pointer', background: isCurrent ? 'rgba(99,102,241,0.12)' : 'rgba(30,41,59,0.5)', transition: 'background 0.2s', borderLeft: `3px solid ${getSpeakerColor(seg.speaker)}` }}
                          >
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
                )}
              </div>

              {(ta?.action_items?.length || ta?.decisions?.length) ? (
                <div style={{ ...CARD }}>
                  {ta?.action_items?.length ? (
                    <>
                      <h4 style={{ fontSize: '10px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '0.5rem', marginTop: 0, letterSpacing: '0.8px' }}>Action Items</h4>
                      <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem' }}>
                        {ta.action_items.map((item, i) => <li key={i} style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6 }}>{item}</li>)}
                      </ul>
                    </>
                  ) : null}
                  {ta?.decisions?.length ? (
                    <>
                      <h4 style={{ fontSize: '10px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '0.5rem', marginTop: 0, letterSpacing: '0.8px' }}>Decisions</h4>
                      <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                        {ta.decisions.map((d, i) => <li key={i} style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6 }}>{d}</li>)}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Segment Analytics */}
            {ta && (
              <div style={{ ...CARD }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.75rem' }}>
                  <FileText size={13} color="#818cf8" />
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#818cf8', fontWeight: 700 }}>Segment Analytics</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Decisions & Agreements</div>
                    {[...(ta.decisions || []), ...(ta.agreements || [])].length > 0
                      ? [...(ta.decisions || []), ...(ta.agreements || [])].map((item, i) => (
                          <div key={i} style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '8px', borderLeft: '2px solid #22c55e' }}>{item}</div>
                        ))
                      : <div style={{ fontSize: '12px', color: '#475569', fontStyle: 'italic' }}>No explicit decisions detected.</div>
                    }
                  </div>
                  <div>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Questions & Disagreements</div>
                    {[...(ta.questions || []), ...(ta.disagreements || [])].length > 0
                      ? [...(ta.questions || []), ...(ta.disagreements || [])].map((item, i) => (
                          <div key={i} style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '8px', borderLeft: '2px solid #f87171' }}>{item}</div>
                        ))
                      : <div style={{ fontSize: '12px', color: '#475569', fontStyle: 'italic' }}>No questions detected.</div>
                    }
                  </div>
                </div>
              </div>
            )}

            {/* Topic Segments */}
            {ta?.topic_segments?.length ? (
              <div style={{ ...CARD }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#94a3b8', fontWeight: 700, marginBottom: '0.75rem' }}>Topic Segments</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {ta.topic_segments.slice(0, 6).map((seg, i) => (
                    <div key={i} style={{ padding: '0.5rem 0.75rem', background: 'rgba(30,41,59,0.6)', borderRadius: '8px', border: '1px solid rgba(30,41,59,0.8)' }}>
                      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700, color: '#818cf8', marginBottom: '2px' }}>{seg.topic}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.4 }}>{seg.segment}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}



            {/* Entities */}
            {ta?.entities && ta.entities.length > 0 && (
              <div style={{ ...CARD }}>
                <h4 style={{ fontSize: '10px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Entities</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {ta.entities.slice(0, 15).map((e: any) => (
                    <span key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '11px', padding: '0.25rem 0.5rem', background: '#1e293b', borderRadius: '6px', border: '1px solid #334155', color: '#cbd5e1' }}>
                      {e.type === 'Person' ? <Hash size={11} /> : e.type === 'Place' ? <MapPin size={11} /> : <Activity size={11} />}
                      {e.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Key Phrases */}
            {ta?.top_keyphrases?.length ? (
              <div style={{ ...CARD }}>
                <h4 style={{ fontSize: '10px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Key Phrases</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {ta.top_keyphrases.slice(0, 12).map((p, i) => (
                    <span key={i} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>{p}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB 2 — AI Chat & Search                                               */}
      {activeTab === 'chat' && (
        <div className="result-card" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', height: '420px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', marginTop: 0, flexShrink: 0 }}>
            <MessageCircle size={14} /> Ask About This Recording
          </h3>

          {/* Fixed-height scrollable chat area */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.65rem', paddingRight: '0.25rem' }}>
            {chatMessages.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span style={{ fontSize: '12px', color: '#334155', fontStyle: 'italic' }}>Ask me anything about this recording…</span>
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '82%', padding: '0.55rem 0.85rem', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: msg.role === 'user' ? 'rgba(99,102,241,0.2)' : 'rgba(30,41,59,0.8)', border: `1px solid ${msg.role === 'user' ? 'rgba(99,102,241,0.3)' : '#1e293b'}`, fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', gap: '4px', padding: '0.55rem 0.85rem' }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#818cf8', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Suggestions tray — only visible when not loading */}
          {!chatLoading && remainingSuggestions.length > 0 && (
            <div style={{ flexShrink: 0, marginBottom: '0.5rem' }}>
              {/* Suggestions pills — expand above the toggle */}
              {!suggestionsHidden && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '4px' }}>
                  {remainingSuggestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendChat(q)}
                      style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '8px', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {/* Single toggle button — always at the same position */}
              <button
                onClick={() => setSuggestionsHidden(h => !h)}
                style={{ fontSize: '10px', color: '#475569', background: 'none', border: '1px solid #1e293b', borderRadius: '6px', cursor: 'pointer', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {suggestionsHidden
                  ? <><ChevronUp size={10} /> Show suggestions</>  
                  : <><ChevronDown size={10} /> Hide</>}
              </button>
            </div>
          )}

          {/* Input row */}
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendChat()}
              placeholder="Ask anything about this recording…"
              disabled={chatLoading}
              style={{ flex: 1, padding: '0.55rem 0.85rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: '13px', outline: 'none' }}
            />
            <button onClick={() => handleSendChat()} disabled={chatLoading || !chatInput.trim()} style={{ padding: '0.55rem 0.9rem', borderRadius: '8px', background: chatLoading ? '#334155' : '#4f46e5', color: 'white', border: 'none', cursor: chatLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
              {chatLoading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              Send
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB 3 — Advanced Analysis                                              */}
      {activeTab === 'acoustic' && (
        <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
          <div
            style={{ width: '100%', padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '13px', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <Activity size={14} /> Advanced Analysis
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                SNR: {quality.snrDb} dB · Tempo: {Math.round(result.features?.tempo ?? 0)} BPM · Centroid: {((result.features?.spectral_centroid_mean ?? 0) / 1000).toFixed(1)} kHz
              </span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #1e293b', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {result.features?.waveform && <WaveformCanvas waveform={result.features.waveform} currentTime={currentTime} duration={result.features.duration} />}
                {result.features?.energy && <EnergyChart energy={result.features.energy} currentTime={currentTime} />}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {result.features?.spectrogram && (
                  <SpectrogramCanvas
                    spectrogram={result.features.spectrogram}
                    currentTime={currentTime}
                    duration={result.features.duration}
                    title="STFT Spectrogram"
                  />
                )}
                {result.features?.mel_spectrogram ? (
                  <SpectrogramCanvas
                    spectrogram={result.features.mel_spectrogram}
                    currentTime={currentTime}
                    duration={result.features.duration}
                    title="Mel Spectrogram"
                  />
                ) : result.features?.spectrogram ? (
                  <div className="result-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px', flexDirection: 'column', gap: '0.5rem' }}>
                    <Activity size={24} color="#334155" />
                    <span style={{ fontSize: '12px', color: '#475569' }}>Mel Spectrogram not available</span>
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {result.features && (
                  <div className="result-card" style={{ padding: '0.85rem 1.1rem 1.1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '13px', fontWeight: 600, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.65rem' }}>
                      <Activity size={14} /> Key Acoustic Signals
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.65rem' }}>
                      <div style={{ padding: '0.75rem', background: 'rgba(30,41,59,0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                        <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>Est. Tempo</div>
                        <div style={{ fontSize: '17px', fontWeight: 700, color: '#e2e8f0' }}>{result.features.tempo} <span style={{ fontSize: '11px', fontWeight: 400, color: '#64748b' }}>BPM</span></div>
                      </div>
                      <div style={{ padding: '0.75rem', background: 'rgba(30,41,59,0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                        <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>Spectral Centroid</div>
                        <div style={{ fontSize: '17px', fontWeight: 700, color: '#e2e8f0' }}>{Math.round(result.features.spectral_centroid_mean ?? 0)} <span style={{ fontSize: '11px', fontWeight: 400, color: '#64748b' }}>Hz</span></div>
                      </div>
                      <div style={{ padding: '0.75rem', background: 'rgba(30,41,59,0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                        <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>Sample Rate</div>
                        <div style={{ fontSize: '17px', fontWeight: 700, color: '#e2e8f0' }}>{result.features.sample_rate / 1000} <span style={{ fontSize: '11px', fontWeight: 400, color: '#64748b' }}>kHz</span></div>
                      </div>
                      {result.features.pitch_mean && (
                        <div style={{ padding: '0.75rem', background: 'rgba(30,41,59,0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                          <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>Mean Pitch</div>
                          <div style={{ fontSize: '17px', fontWeight: 700, color: '#e2e8f0' }}>{result.features.pitch_mean} <span style={{ fontSize: '11px', fontWeight: 400, color: '#64748b' }}>Hz</span></div>
                          {result.features.gender_tag && (
                            <div style={{ marginTop: '5px' }}>
                              <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '99px', fontWeight: 600, ...genderStyle(result.features.gender_tag) }}>
                                {result.features.gender_tag}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="result-card" style={{ padding: '1.25rem' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', marginTop: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <Users size={14} /> Speaker Analytics
                  </h3>
                  {result.speaker_metrics && Object.entries(result.speaker_metrics).map(([sp, m]: [string, any]) => (
                    <div key={sp} style={{ background: 'rgba(15,23,42,0.6)', borderRadius: '10px', padding: '0.85rem', marginBottom: '8px', border: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                        <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: getSpeakerColor(sp), flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>{sp}</span>
                        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#64748b' }}>{result.segments.filter(s => s.speaker === sp).length} segs</span>
                      </div>
                      {m.gender_tag && (
                        <div style={{ marginBottom: '8px' }}>
                          <span style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '99px', fontWeight: 700, ...genderStyle(m.gender_tag) }}>
                            {m.gender_tag}
                          </span>
                          {m.pitch_mean && <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '6px' }}>~{m.pitch_mean} Hz</span>}
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                        <div style={{ background: 'rgba(30,41,59,0.6)', borderRadius: '6px', padding: '5px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0' }}>{(m.dominance_ratio * 100).toFixed(0)}%</div>
                          <div style={{ fontSize: '9px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Airtime</div>
                        </div>
                        <div style={{ background: 'rgba(30,41,59,0.6)', borderRadius: '6px', padding: '5px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0' }}>{Math.round(m.wpm)}</div>
                          <div style={{ fontSize: '9px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.3px' }}>WPM</div>
                        </div>
                        <div style={{ background: 'rgba(30,41,59,0.6)', borderRadius: '6px', padding: '5px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0' }}>{(m.participation_ratio * 100).toFixed(0)}%</div>
                          <div style={{ fontSize: '9px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Activity</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {result.interruption_count !== undefined && result.interruption_count > 0 && (
                    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #1e293b', fontSize: '12px', color: '#64748b' }}>
                      ⚡ Interruptions: {result.interruption_count}
                    </div>
                  )}
                </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioAnalysisView;
