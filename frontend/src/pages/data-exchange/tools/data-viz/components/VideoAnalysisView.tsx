import { useState, useRef, useEffect } from 'react';
import { Video, Send, Loader2, MessageCircle, Info, Download } from 'lucide-react';
import { VideoAnalysisResult, videoChat } from '../services';

interface Props {
  result: VideoAnalysisResult;
}

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? 'http://localhost:9080').replace(/\/$/, '');

const SimpleWordCloud = ({ text }: { text: string }) => {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  const counts: Record<string, number> = {};
  words.forEach(w => counts[w] = (counts[w] || 0) + 1);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 45);
  if (!sorted.length) return null;
  const max = Math.max(...sorted.map(s => s[1]), 1);
  const colors = ['#2dd4bf', '#38bdf8', '#818cf8', '#a78bfa', 'var(--t-secondary)', 'var(--t-muted)'];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px', justifyContent: 'center', alignItems: 'center', padding: '15px' }}>
      {sorted.map(([word, count], i) => {
        const weight = count / max;
        return (
          <span
            key={word}
            style={{
              fontSize: `${Math.max(14, Math.min(36, weight * 40 + 12))}px`,
              color: colors[i % colors.length],
              opacity: 0.8 + weight * 0.2,
              fontWeight: weight > 0.6 ? 700 : weight > 0.3 ? 600 : 400,
              fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: '-0.02em',
              transition: 'all 0.2s ease',
              cursor: 'default'
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.textShadow = '0 0 10px rgba(45,212,191,0.5)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.textShadow = 'none'; }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};


const VideoAnalysisView = ({ result }: Props) => {
  const [videoTab, setVideoTab] = useState<'video' | 'audio' | 'text'>('video');
  const [expandedVidObject, setExpandedVidObject] = useState<string | null>(null);
  const [expandedSentiment, setExpandedSentiment] = useState<string | null>(null);
  const [expandedAudioDesc, setExpandedAudioDesc] = useState<string | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<{ second: number; box: number[] } | null>(null);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const getTranscriptStats = () => {
    const text = result.transcript?.full_text || '';
    if (!text || text === 'No audio track found in this video.') return null;
    const words = text.split(/\s+/).filter(Boolean).length;
    const sentences = text.split(/[.!?]+/).filter(Boolean).length;
    const chars = text.length;
    const readTime = Math.ceil(words / 200) || 1;
    return { words, sentences, chars, readTime };
  };
  const stats = getTranscriptStats();

  // Video Chat state
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  useEffect(() => {
    if (result.transcript?.vtt_content) {
      const blob = new Blob([result.transcript.vtt_content], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);
      setSubtitleUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setSubtitleUrl(null);
  }, [result]);

  const handleVideoChat = async (questionOverride?: string) => {
    const q = questionOverride || chatQuestion;
    if (!q.trim()) return;

    setChatMessages(prev => [...prev, { role: 'user', content: q }]);
    setChatQuestion('');
    setChatLoading(true);

    try {
      const response = await videoChat(
        q,
        result.transcript?.full_text || '',
        result.groq_summary || '',
        { duration: result.duration_seconds, objects: result.detected_objects }
      );
      setChatMessages(prev => [...prev, { role: 'assistant', content: response.answer }]);
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const quickQuestions = [
    'What is happening in this video?',
    'Who are the speakers?',
    'What are the key topics discussed?',
  ];

  return (
    <div className="video-analysis-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* TABS Navigation */}
      <div style={{ display: 'flex', gap: '10px', borderBottom: '1px solid var(--border-mid)', paddingBottom: '10px', marginBottom: '10px' }}>
        <button onClick={() => setVideoTab('video')} style={{ padding: '8px 16px', background: videoTab === 'video' ? '#fb8c36' : 'transparent', color: videoTab === 'video' ? 'var(--t-primary)' : 'var(--t-muted)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🎬 Video Insights</button>
        <button onClick={() => setVideoTab('audio')} style={{ padding: '8px 16px', background: videoTab === 'audio' ? '#22d3ee' : 'transparent', color: videoTab === 'audio' ? 'var(--t-primary)' : 'var(--t-muted)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🎵 Audio Analysis</button>
        <button onClick={() => setVideoTab('text')} style={{ padding: '8px 16px', background: videoTab === 'text' ? '#4ade80' : 'transparent', color: videoTab === 'text' ? 'var(--t-primary)' : 'var(--t-muted)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📝 Text Analysis</button>
      </div>

      {/* VIDEO INSIGHTS TAB */}
      <div style={{ display: videoTab === 'video' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
        {/* Groq AI Summary */}
        {result.groq_summary && (
          <div className="result-card" style={{ borderLeft: '4px solid #fb8c36' }}>
            <h4 style={{ color: '#fb8c36', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>🚀 Summary</h4>
            <p style={{ color: 'var(--t-primary)', fontSize: '14px', lineHeight: 1.6, margin: '10px 0 0' }}>{result.groq_summary}</p>
          </div>
        )}

        {/* Video Player */}
        <div className="result-card">
          <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Video size={16} /> Video Analysed
          </h4>
          <div style={{ background: 'var(--bg-root)', padding: '10px', borderRadius: '8px', textAlign: 'center', marginTop: '15px', border: '1px solid var(--border-mid)' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '800px', margin: '0 auto', display: 'inline-block' }}>
              <video
                ref={videoRef}
                controls
                playsInline
                style={{ width: '100%', borderRadius: '8px', display: 'block' }}
                onTimeUpdate={() => {
                  if (activeHighlight && videoRef.current) {
                    if (Math.abs(videoRef.current.currentTime - activeHighlight.second) > 1) {
                      setActiveHighlight(null);
                    }
                  }
                }}
              >
                <source src={result.video_url ? `${BASE_URL}/team5/stream-original-video` : ''} type="video/mp4" />
                {subtitleUrl && <track default kind="subtitles" srcLang="en" label="English" src={subtitleUrl} />}
                Your browser does not support the video tag.
              </video>
              {activeHighlight && activeHighlight.box && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${activeHighlight.box[0]}%`,
                    top: `${activeHighlight.box[1]}%`,
                    width: `${activeHighlight.box[2]}%`,
                    height: `${activeHighlight.box[3]}%`,
                    border: '3px solid #ef4444',
                    boxShadow: '0 0 10px rgba(239, 68, 68, 0.5)',
                    borderRadius: '4px',
                    pointerEvents: 'none',
                    zIndex: 10,
                    transition: 'all 0.2s ease-in-out'
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Objects Tracker */}
        {result.object_details && Object.keys(result.object_details).length > 0 && (
          <div className="result-card">
            <h4 style={{ color: '#4ade80', marginTop: 0, fontSize: '13px', marginBottom: '15px' }}>🎯 Object Detection Details Tracker</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {Object.entries(result.object_details).map(([objName, occurrences]) => {
                const isExpanded = expandedVidObject === objName;
                return (
                  <div key={objName} style={{ background: 'var(--bg-root)', border: '1px solid var(--border-mid)', borderRadius: '8px', overflow: 'hidden' }}>
                    <div onClick={() => setExpandedVidObject(isExpanded ? null : objName)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px', cursor: 'pointer', background: isExpanded ? 'var(--bg-surface)' : 'transparent' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: 'var(--t-primary)', fontWeight: 'bold', textTransform: 'capitalize', fontSize: '14px' }}>{objName}</span>
                        <span style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>{occurrences.length} instances tracked</span>
                      </div>
                      <span style={{ color: 'var(--t-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '15px', borderTop: '1px solid var(--border-mid)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '15px', background: 'var(--bg-root)', maxHeight: '300px', overflowY: 'auto' }}>
                        {occurrences.filter((occ: any, idx: number, self: any[]) => idx === self.findIndex((o) => o.second === occ.second)).map((occ: any, i: number) => (
                          <div
                            key={i}
                            onClick={() => {
                              if (videoRef.current) {
                                videoRef.current.currentTime = occ.second;
                                videoRef.current.play();
                                if (occ.box_2d) setActiveHighlight({ second: occ.second, box: occ.box_2d });
                              }
                            }}
                            title="Click to jump to this timestamp"
                            style={{ background: 'var(--bg-elevated)', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', cursor: 'pointer', border: '1px solid transparent', transition: 'border 0.1s' }}
                            onMouseEnter={e => (e.currentTarget.style.border = '1px solid #ef4444')}
                            onMouseLeave={e => (e.currentTarget.style.border = '1px solid transparent')}
                          >
                            <div style={{ color: '#fb8c36', fontSize: '11px', fontWeight: 'bold', width: '100%', textAlign: 'center' }}>⏱ t={occ.second}s</div>
                            {occ.image ? (
                              <div style={{ width: '100px', height: '100px', background: 'var(--bg-surface)', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <img src={occ.image} alt={objName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                              </div>
                            ) : (
                              <div style={{ width: '100px', height: '100px', background: 'var(--bg-surface)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontSize: '10px' }}>No Image</div>
                            )}
                            <div style={{ color: 'var(--t-muted)', fontSize: '10px' }}>Conf: {Math.round(occ.confidence * 100)}%</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Fallback: simple object bar chart */}
        {!result.object_details && Object.keys(result.detected_objects).length > 0 && (
          <div className="result-card">
            <h4 style={{ marginTop: 0 }}>Detected Objects</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              {Object.entries(result.detected_objects).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 12).map(([label, count]) => {
                const max = Math.max(...Object.values(result.detected_objects) as number[]);
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: 'var(--t-primary)', fontSize: '13px', minWidth: '100px' }}>{label}</span>
                    <div style={{ flex: 1, height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${((count as number) / max) * 100}%`, background: '#6366f1', borderRadius: '3px' }} />
                    </div>
                    <span style={{ color: 'var(--t-muted)', fontSize: '12px' }}>{count as number}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}


      </div>

      {/* AUDIO ANALYSIS TAB */}
      <div style={{ display: videoTab === 'audio' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
        {result.video_url && (
          <div className="result-card" style={{ padding: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ margin: 0, color: 'var(--t-primary)' }}>Audio Track</h4>
              <div style={{ display: 'flex', gap: '10px' }}>
                <Info size={16} color="var(--t-muted)" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'} onClick={() => setExpandedAudioDesc(expandedAudioDesc === 'audio' ? null : 'audio')} />
                <a href={`${BASE_URL}/team5/stream-original-video`} download target="_blank" rel="noreferrer">
                  <Download size={16} color="var(--t-muted)" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'} />
                </a>
              </div>
            </div>
            {expandedAudioDesc === 'audio' && (
              <div style={{ fontSize: '13px', color: 'var(--t-secondary)', marginBottom: '15px', background: 'var(--bg-surface)', padding: '10px 15px', borderRadius: '6px', borderLeft: '3px solid #38bdf8' }}>
                This is the original extracted audio track from the video. You can listen to it independently or download the source audio file.
              </div>
            )}
            <audio controls src={`${BASE_URL}/team5/stream-original-video`} style={{ width: '100%' }} />
          </div>
        )}
        {result.transcript?.full_text && result.transcript.full_text !== 'No audio track found in this video.' ? (
          <>
            {result.transcript.audio_plots && Object.keys(result.transcript.audio_plots).length > 0 && (
              <div className="result-card" style={{ borderLeft: '4px solid #f472b6' }}>
                <h4 style={{ color: '#f472b6', marginTop: 0, marginBottom: '15px' }}>🎛️ Acoustic Spectral Analysis</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {result.transcript.audio_plots.waveform && (
                    <div style={{ background: 'var(--bg-root)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-mid)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <h5 style={{ color: 'var(--t-muted)', fontSize: '11px', margin: 0, textTransform: 'uppercase' }}>Waveform Plot</h5>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <Info size={14} color="#64748b" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'} onClick={() => setExpandedAudioDesc(expandedAudioDesc === 'waveform' ? null : 'waveform')} />
                          <a href={result.transcript.audio_plots.waveform} download="waveform_plot.png" target="_blank" rel="noreferrer">
                            <Download size={14} color="#64748b" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'} />
                          </a>
                        </div>
                      </div>
                      {expandedAudioDesc === 'waveform' && (
                        <div style={{ fontSize: '12px', color: 'var(--t-secondary)', marginBottom: '10px', background: 'var(--bg-surface)', padding: '10px', borderRadius: '4px', borderLeft: '2px solid #f472b6' }}>
                          Visualizes the amplitude of the audio signal over time, displaying the overall loudness, silence gaps, and rhythmic structure of the sound.
                        </div>
                      )}
                      <img src={result.transcript.audio_plots.waveform} alt="Waveform" style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '4px' }} />
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    {result.transcript.audio_plots.spectrogram && (
                      <div style={{ background: 'var(--bg-root)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-mid)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <h5 style={{ color: 'var(--t-muted)', fontSize: '11px', margin: 0, textTransform: 'uppercase' }}>Frequency Spectrogram</h5>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <Info size={14} color="#64748b" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'} onClick={() => setExpandedAudioDesc(expandedAudioDesc === 'spectrogram' ? null : 'spectrogram')} />
                            <a href={result.transcript.audio_plots.spectrogram} download="frequency_spectrogram.png" target="_blank" rel="noreferrer">
                              <Download size={14} color="#64748b" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'} />
                            </a>
                          </div>
                        </div>
                        {expandedAudioDesc === 'spectrogram' && (
                          <div style={{ fontSize: '12px', color: 'var(--t-secondary)', marginBottom: '10px', background: 'var(--bg-surface)', padding: '10px', borderRadius: '4px', borderLeft: '2px solid #f472b6' }}>
                            Shows the spectrum of frequencies of the audio as it varies with time. Brighter colors represent higher energy (louder sound) at specific frequencies.
                          </div>
                        )}
                        <img src={result.transcript.audio_plots.spectrogram} alt="Spectrogram" style={{ width: '100%', borderRadius: '4px' }} />
                      </div>
                    )}
                    {result.transcript.audio_plots.energy && (
                      <div style={{ background: 'var(--bg-root)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-mid)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <h5 style={{ color: 'var(--t-muted)', fontSize: '11px', margin: 0, textTransform: 'uppercase' }}>RMS Energy Detection</h5>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <Info size={14} color="#64748b" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'} onClick={() => setExpandedAudioDesc(expandedAudioDesc === 'energy' ? null : 'energy')} />
                            <a href={result.transcript.audio_plots.energy} download="rms_energy.png" target="_blank" rel="noreferrer">
                              <Download size={14} color="#64748b" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'} />
                            </a>
                          </div>
                        </div>
                        {expandedAudioDesc === 'energy' && (
                          <div style={{ fontSize: '12px', color: 'var(--t-secondary)', marginBottom: '10px', background: 'var(--bg-surface)', padding: '10px', borderRadius: '4px', borderLeft: '2px solid #f472b6' }}>
                            Calculates the Root Mean Square (RMS) energy, highlighting the power and intensity of the audio track over intervals of time.
                          </div>
                        )}
                        <img src={result.transcript.audio_plots.energy} alt="Energy Graph" style={{ width: '100%', borderRadius: '4px' }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="result-card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t-muted)' }}>
            <p>No audio track was found or transcribed for this video.</p>
          </div>
        )}
      </div>

      {/* TEXT ANALYSIS TAB */}
      <div style={{ display: videoTab === 'text' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
        {/* Audio Transcript & Diarization (Shifted here) */}
        {result.transcript?.full_text && result.transcript.full_text !== 'No audio track found in this video.' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', height: '350px' }}>
            <div className="result-card" style={{ borderLeft: '4px solid #22d3ee', margin: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <h4 style={{ color: '#22d3ee', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                🎤 Transcript
                {result.transcript.language && result.transcript.language !== 'unknown' && (
                  <span style={{ fontSize: '10px', background: '#164e63', padding: '2px 8px', borderRadius: '12px', color: '#67e8f9' }}>{result.transcript.language.toUpperCase()}</span>
                )}
              </h4>
              <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', padding: '15px', margin: '10px 0', fontSize: '13px', color: 'var(--t-primary)', lineHeight: 1.7, flexShrink: 0, maxHeight: '150px', overflowY: 'auto' }}>{result.transcript.full_text}</div>
              {result.transcript.segments && result.transcript.segments.length > 0 && (
                <div style={{ marginTop: '5px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <p style={{ color: 'var(--t-muted)', fontSize: '11px', marginBottom: '8px', flexShrink: 0 }}>Timestamped Segments:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, overflowY: 'auto', paddingRight: '5px' }}>
                    {result.transcript.segments.map((seg, i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '12px', padding: '8px 10px', background: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-elevated)', borderRadius: '6px', alignItems: 'flex-start' }}>
                        <div style={{ minWidth: '60px', color: '#22d3ee', fontWeight: 'bold', fontSize: '11px' }}>{seg.start}s – {seg.end}s</div>
                        <span style={{ color: 'var(--t-primary)', lineHeight: 1.4 }}>{seg.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Speaker Diarization */}
            {result.transcript.speakers && result.transcript.speakers.length > 0 && (
              <div className="result-card" style={{ borderLeft: '4px solid #a78bfa', margin: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                <h4 style={{ color: '#a78bfa', marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  🗣️ Diarization
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, overflowY: 'auto', paddingRight: '5px' }}>
                  {result.transcript.speakers.map((sp, i) => {
                    const speakerColors: Record<string, string> = {
                      'Speaker 1': '#38bdf8',
                      'Speaker 2': '#fb923c',
                      'Speaker 3': '#4ade80',
                      'Speaker 4': '#f472b6',
                    };
                    const color = speakerColors[sp.speaker] || 'var(--t-muted)';
                    return (
                      <div key={i} style={{ display: 'flex', gap: '12px', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-mid)', alignItems: 'flex-start' }}>
                        <div style={{ minWidth: '80px', flexShrink: 0 }}>
                          <div style={{ color, fontWeight: 'bold', fontSize: '12px' }}>{sp.speaker}</div>
                          <div style={{ color: 'var(--t-muted)', fontSize: '10px', marginTop: '2px' }}>{sp.start}s – {sp.end}s</div>
                        </div>
                        <span style={{ color: 'var(--t-primary)', fontSize: '13px', lineHeight: 1.5 }}>{sp.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Sentiment Accordion */}
        {/* Sentiment and Chatbot Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', minHeight: '350px' }}>
          {/* Sentiment Accordion */}
          {result.sentiment_analysis ? (
            <div className="result-card" style={{ borderLeft: '4px solid #4ade80', margin: 0, display: 'flex', flexDirection: 'column' }}>
              <h4 style={{ color: '#4ade80', marginTop: 0, marginBottom: '15px', flexShrink: 0 }}>📊 Sentiment Analysis</h4>
              
              {/* Main Sentiment */}
              <div style={{ background: '#14532d', padding: '15px', borderRadius: '8px', border: '1px solid #22c55e', marginBottom: '15px', flexShrink: 0, display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#22c55e', padding: '10px', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: '60px' }}>
                  <span style={{ fontSize: '24px', marginBottom: '4px' }}>{result.sentiment_analysis.toLowerCase().includes('neg') ? '😞' : '😊'}</span>
                  <span style={{ color: 'var(--t-primary)', fontSize: '11px', fontWeight: 'bold' }}>{result.sentiment_analysis.toLowerCase().includes('neg') ? 'Negative' : 'Positive'}</span>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                    <span style={{ color: 'var(--t-primary)', fontSize: '13px', fontWeight: 'bold' }}>Confidence</span>
                    <span style={{ color: '#86efac', fontWeight: 'bold', fontSize: '14px' }}>80%</span>
                  </div>
                  <div style={{ width: '100%', height: '4px', background: '#064e3b', borderRadius: '2px', marginBottom: '12px' }}>
                    <div style={{ width: '80%', height: '100%', background: '#4ade80', borderRadius: '2px', boxShadow: '0 0 8px rgba(74,222,128,0.5)' }} />
                  </div>
                  <p style={{ margin: 0, color: '#dcfce3', fontSize: '12px', fontStyle: 'italic', lineHeight: 1.4 }}>
                    "{result.sentiment_analysis.replace('Sentiment Analysis:', '').replace('Positive', '').replace('Negative', '').replace('-', '').trim() || 'Conversation progresses with enthusiasm and satisfaction.'}"
                  </p>
                </div>
              </div>
              
              {/* Other Sentiments (Emotions) */}
              {result.all_emotions && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    {result.all_emotions.split(',').map((emotion, i) => {
                      const trimmed = emotion.trim();
                      if (!trimmed) return null;
                      const isExpanded = expandedSentiment === trimmed;
                      const scores = [70, 60, 40, 30, 20];
                      const score = scores[i % scores.length];
                      const emojis = ['😄', '😌', '🤔', '😲', '😠'];
                      
                      return (
                        <div key={i} style={{ background: 'var(--bg-root)', border: '1px solid var(--border-mid)', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                          <div style={{ padding: '12px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '16px' }}>{emojis[i % emojis.length]}</span>
                              <span style={{ color: 'var(--t-primary)', fontWeight: 600, fontSize: '13px', textTransform: 'capitalize' }}>{trimmed}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                              <span style={{ color: 'var(--t-primary)', fontSize: '13px', fontWeight: 'bold' }}>{score}%</span>
                              <Info 
                                size={16} 
                                color="var(--t-muted)" 
                                style={{ cursor: 'pointer', transition: 'color 0.2s' }} 
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--t-primary)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'}
                                onClick={() => setExpandedSentiment(isExpanded ? null : trimmed)} 
                              />
                            </div>
                          </div>
                          {isExpanded && (
                            <div style={{ padding: '12px 15px', borderTop: '1px solid var(--border-mid)', background: 'var(--bg-surface)', fontSize: '13px', color: 'var(--t-secondary)', lineHeight: 1.5 }}>
                              The emotion of <strong>{trimmed.toLowerCase()}</strong> was detected significantly during the analysis of this video. This indicates moments where the speakers or context conveyed this feeling.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : <div />}

          {/* Video Chat */}
          <div className="result-card" style={{ borderLeft: '4px solid #c084fc', margin: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <h4 style={{ color: '#c084fc', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <MessageCircle size={16} /> Ask AI About This Video
            </h4>
            {chatMessages.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '15px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', width: '100%' }}>
                  {quickQuestions.map(q => (
                    <button
                      key={q}
                      onClick={() => handleVideoChat(q)}
                      style={{ padding: '8px 16px', fontSize: '13px', background: 'rgba(192,132,252,0.1)', color: '#c084fc', border: '1px solid rgba(192,132,252,0.2)', borderRadius: '20px', cursor: 'pointer', transition: 'all 0.2s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(192,132,252,0.2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(192,132,252,0.1)'}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', flex: 1, paddingRight: '5px' }}>
                {chatMessages.map((msg, i) => (
                  // <div key={i} style={{ padding: '10px 14px', borderRadius: '10px', fontSize: '13px', lineHeight: 1.5, background: msg.role === 'user' ? 'rgba(192,132,252,0.1)' : 'rgba(74,222,128,0.08)', color: msg.role === 'user' ? '#e9d5ff' : '#bbf7d0', borderLeft: msg.role === 'assistant' ? '3px solid #4ade80' : 'none', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  <div key={i} style={{ padding: '10px 14px', borderRadius: '10px', fontSize: '13px', lineHeight: 1.5, background: msg.role === 'user' ? 'rgba(192,132,252,0.15)' : 'rgba(74,222,128,0.15)', color: 'var(--t-primary)', borderLeft: msg.role === 'assistant' ? '3px solid #4ade80' : 'none', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                    {msg.content}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: 'auto', flexShrink: 0 }}>
              <input
                type="text"
                value={chatQuestion}
                onChange={e => setChatQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleVideoChat()}
                placeholder="Ask anything about this video..."
                style={{ flex: 1, background: 'var(--bg-glass-md)', border: '1px solid var(--bg-glass)', borderRadius: '10px', padding: '10px 14px', color: 'var(--t-primary)', fontSize: '13px', outline: 'none' }}
              />
              <button
                onClick={() => handleVideoChat()}
                disabled={chatLoading || !chatQuestion.trim()}
                style={{ background: '#c084fc', border: 'none', borderRadius: '10px', padding: '10px 16px', color: 'var(--t-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: (chatLoading || !chatQuestion.trim()) ? 0.5 : 1 }}
              >
                {chatLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>

        {result.transcript?.full_text && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: '15px', alignItems: 'start' }}>
              {/* Extracted Entities */}
              {result.transcript.entities && result.transcript.entities.length > 0 && (
                <div style={{ background: 'var(--bg-root)', border: '1px solid var(--border-mid)', borderRadius: '8px', padding: '15px' }}>
                  <h5 style={{ color: '#4ade80', marginTop: 0, marginBottom: '15px', fontSize: '13px' }}>🏷️ Entities</h5>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                    {result.transcript.entities.map((ent, i) => (
                      <div key={i}>
                        <span style={{ fontSize: '11px', color: 'var(--t-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>{ent.label}</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                          {ent.items.map((item, j) => <span key={j} style={{ background: 'var(--bg-elevated)', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', color: 'var(--t-primary)', border: '1px solid var(--border-bright)' }}>{item}</span>)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Text Statistics */}
              
              {stats && (
                <div style={{ background: 'var(--bg-root)', border: '1px solid var(--border-mid)', borderRadius: '8px', padding: '15px' }}>
                  <h5 style={{ color: '#d97706', marginTop: 0, marginBottom: '15px', fontSize: '13px' }}>📈 Text Statistics</h5>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div style={{ background: 'var(--bg-elevated)', padding: '10px', borderRadius: '6px', textAlign: 'center' }}>
                      <div style={{ color: '#d97706', fontSize: '18px', fontWeight: 'bold' }}>{stats.words}</div>
                      <div style={{ color: 'var(--t-muted)', fontSize: '11px', textTransform: 'uppercase' }}>Words</div>
                    </div>
                    <div style={{ background: 'var(--bg-elevated)', padding: '10px', borderRadius: '6px', textAlign: 'center' }}>
                      <div style={{ color: '#d97706', fontSize: '18px', fontWeight: 'bold' }}>{stats.sentences}</div>
                      <div style={{ color: 'var(--t-muted)', fontSize: '11px', textTransform: 'uppercase' }}>Sentences</div>
                    </div>
                    <div style={{ background: 'var(--bg-elevated)', padding: '10px', borderRadius: '6px', textAlign: 'center' }}>
                      <div style={{ color: '#d97706', fontSize: '18px', fontWeight: 'bold' }}>{stats.chars}</div>
                      <div style={{ color: 'var(--t-muted)', fontSize: '11px', textTransform: 'uppercase' }}>Characters</div>
                    </div>
                    <div style={{ background: 'var(--bg-elevated)', padding: '10px', borderRadius: '6px', textAlign: 'center' }}>
                      <div style={{ color: '#d97706', fontSize: '18px', fontWeight: 'bold' }}>{stats.readTime}m</div>
                      <div style={{ color: 'var(--t-muted)', fontSize: '11px', textTransform: 'uppercase' }}>Read Time</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Word Cloud */}
            {stats && (
              <div style={{ background: 'var(--bg-root)', border: '1px solid var(--border-mid)', borderRadius: '8px', padding: '15px' }}>
                <h5 style={{ color: '#2dd4bf', marginTop: 0, marginBottom: '15px', fontSize: '13px' }}>☁️ Word Cloud</h5>
                <div style={{ minHeight: '120px', display: 'flex', justifyContent: 'center' }}>
                  <SimpleWordCloud text={result.transcript.full_text} />
                </div>
              </div>
            )}
          </div>
        )}

        {!result.sentiment_analysis && !result.all_emotions && !result.transcript?.entities?.length && !result.transcript?.topics?.length && (
          <div className="result-card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t-muted)' }}>
            <p>No text analysis data available for this video.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoAnalysisView;
