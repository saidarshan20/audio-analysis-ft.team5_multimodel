import { useState, useRef, useEffect } from 'react';
import { Video } from 'lucide-react';
import { VideoAnalysisResult } from '../services';

interface Props {
  result: VideoAnalysisResult;
}

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8742';

const VideoAnalysisView = ({ result }: Props) => {
  const [videoTab, setVideoTab] = useState<'video' | 'audio' | 'text'>('video');
  const [expandedVidObject, setExpandedVidObject] = useState<string | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<{ second: number; box: number[] } | null>(null);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (result.transcript?.vtt_content) {
      const blob = new Blob([result.transcript.vtt_content], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);
      setSubtitleUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setSubtitleUrl(null);
  }, [result]);

  return (
    <div className="video-analysis-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* TABS Navigation */}
      <div style={{ display: 'flex', gap: '10px', borderBottom: '1px solid #1e293b', paddingBottom: '10px', marginBottom: '10px' }}>
        <button onClick={() => setVideoTab('video')} style={{ padding: '8px 16px', background: videoTab === 'video' ? '#fb8c36' : 'transparent', color: videoTab === 'video' ? '#fff' : '#94a3b8', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🎬 Video Insights</button>
        <button onClick={() => setVideoTab('audio')} style={{ padding: '8px 16px', background: videoTab === 'audio' ? '#22d3ee' : 'transparent', color: videoTab === 'audio' ? '#fff' : '#94a3b8', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🎵 Audio Analysis</button>
        <button onClick={() => setVideoTab('text')} style={{ padding: '8px 16px', background: videoTab === 'text' ? '#4ade80' : 'transparent', color: videoTab === 'text' ? '#fff' : '#94a3b8', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📝 Text Analysis</button>
      </div>

      {/* VIDEO INSIGHTS TAB */}
      <div style={{ display: videoTab === 'video' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
        {/* Groq AI Summary */}
        {result.groq_summary && (
          <div className="result-card" style={{ borderLeft: '4px solid #fb8c36' }}>
            <h4 style={{ color: '#fb8c36', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>🚀 AI Video Summary (Groq LLM)</h4>
            <p style={{ color: '#f1f5f9', fontSize: '14px', lineHeight: 1.6, margin: '10px 0 0' }}>{result.groq_summary}</p>
            {result.sentiment_analysis && (
              <div style={{ marginTop: '15px', padding: '12px', background: 'rgba(56,189,248,0.1)', borderLeft: '4px solid #38bdf8', borderRadius: '4px' }}>
                <h5 style={{ margin: '0 0 5px 0', color: '#38bdf8', fontSize: '12px', textTransform: 'uppercase' }}>Video Sentiment</h5>
                <p style={{ margin: 0, color: '#f8fafc', fontSize: '13px' }}>{result.sentiment_analysis.replace('Sentiment Analysis:', '')}</p>
              </div>
            )}
            {result.video_caption && (
              <div style={{ marginTop: '15px', padding: '12px', background: 'rgba(96,165,250,0.1)', borderLeft: '4px solid #60a5fa', borderRadius: '4px' }}>
                <h5 style={{ margin: '0 0 5px 0', color: '#60a5fa', fontSize: '12px', textTransform: 'uppercase' }}>BLIP Video Caption</h5>
                <p style={{ margin: 0, color: '#f8fafc', fontSize: '13px', fontStyle: 'italic' }}>"{result.video_caption}"</p>
              </div>
            )}
          </div>
        )}

        {/* Video Player */}
        <div className="result-card">
          <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Video size={16} /> Object Detection Video (YOLOv8)
          </h4>
          <p className="viz-desc">Analyzed {result.keyframes_analyzed || '?'} keyframes over {result.duration_seconds || '?'}s duration.</p>
          <div style={{ background: '#020617', padding: '10px', borderRadius: '8px', textAlign: 'center', marginTop: '15px', border: '1px solid #1e293b' }}>
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
                <source src={result.video_url ? `${BASE_URL}${result.video_url}` : ''} type="video/mp4" />
                {subtitleUrl && <track default kind="subtitles" srcLang="en" label="English" src={subtitleUrl} />}
                Your browser does not support the video tag.
              </video>
              {activeHighlight && activeHighlight.box && activeHighlight.box.length === 4 && (
                <div style={{ position: 'absolute', top: `${activeHighlight.box[1]}%`, left: `${activeHighlight.box[0]}%`, width: `${activeHighlight.box[2]}%`, height: `${activeHighlight.box[3]}%`, border: '3px solid #ef4444', borderRadius: '4px', pointerEvents: 'none', boxShadow: '0 0 12px rgba(239,68,68,0.8), inset 0 0 8px rgba(239,68,68,0.5)', zIndex: 10, transition: 'all 0.2s ease-out' }} />
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
                  <div key={objName} style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: '8px', overflow: 'hidden' }}>
                    <div onClick={() => setExpandedVidObject(isExpanded ? null : objName)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px', cursor: 'pointer', background: isExpanded ? '#0f172a' : 'transparent' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#f1f5f9', fontWeight: 'bold', textTransform: 'capitalize', fontSize: '14px' }}>{objName}</span>
                        <span style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>{occurrences.length} instances tracked</span>
                      </div>
                      <span style={{ color: '#94a3b8', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '15px', borderTop: '1px solid #1e293b', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '15px', background: '#020617' }}>
                        {occurrences.map((occ: any, i: number) => (
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
                            style={{ background: '#1e293b', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', cursor: 'pointer', border: '1px solid transparent', transition: 'border 0.1s' }}
                            onMouseEnter={e => (e.currentTarget.style.border = '1px solid #ef4444')}
                            onMouseLeave={e => (e.currentTarget.style.border = '1px solid transparent')}
                          >
                            <div style={{ color: '#fb8c36', fontSize: '11px', fontWeight: 'bold', width: '100%', textAlign: 'center' }}>⏱ t={occ.second}s</div>
                            {occ.image ? (
                              <div style={{ width: '100px', height: '100px', background: '#0f172a', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <img src={occ.image} alt={objName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                              </div>
                            ) : (
                              <div style={{ width: '100px', height: '100px', background: '#0f172a', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '10px' }}>No Image</div>
                            )}
                            <div style={{ color: '#94a3b8', fontSize: '10px' }}>Conf: {Math.round(occ.confidence * 100)}%</div>
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
                    <span style={{ color: '#e2e8f0', fontSize: '13px', minWidth: '100px' }}>{label}</span>
                    <div style={{ flex: 1, height: '6px', background: '#1e293b', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${((count as number) / max) * 100}%`, background: '#6366f1', borderRadius: '3px' }} />
                    </div>
                    <span style={{ color: '#64748b', fontSize: '12px' }}>{count as number}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CLIP Scenes */}
        {result.clip_scenes?.length > 0 && (
          <div className="result-card">
            <h4 style={{ marginTop: 0 }}>Scene Classification (CLIP)</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto', marginTop: '8px' }}>
              {result.clip_scenes.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', padding: '6px 10px', background: '#0f172a', borderRadius: '6px', border: '1px solid #1e293b', alignItems: 'center' }}>
                  <span style={{ color: '#475569', fontSize: '11px', minWidth: '28px' }}>{s.second}s</span>
                  <span style={{ color: '#cbd5e1', fontSize: '13px', flex: 1 }}>{s.scene}</span>
                  <span style={{ color: '#6366f1', fontSize: '11px' }}>{(s.score * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* AUDIO ANALYSIS TAB */}
      <div style={{ display: videoTab === 'audio' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
        {result.transcript?.full_text && result.transcript.full_text !== 'No audio track found in this video.' ? (
          <>
            <div className="result-card" style={{ borderLeft: '4px solid #22d3ee' }}>
              <h4 style={{ color: '#22d3ee', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                🎤 Whisper Audio Transcript
                {result.transcript.language && result.transcript.language !== 'unknown' && (
                  <span style={{ fontSize: '10px', background: '#164e63', padding: '2px 8px', borderRadius: '12px', color: '#67e8f9' }}>{result.transcript.language.toUpperCase()}</span>
                )}
              </h4>
              <div style={{ background: '#1e293b', borderRadius: '8px', padding: '15px', margin: '10px 0', fontSize: '13px', color: '#f1f5f9', lineHeight: 1.7 }}>{result.transcript.full_text}</div>
              {result.transcript.segments && result.transcript.segments.length > 0 && (
                <div style={{ marginTop: '15px' }}>
                  <p style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '8px' }}>Timestamped Segments:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                    {result.transcript.segments.map((seg, i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '12px', padding: '8px 10px', background: i % 2 === 0 ? '#0f172a' : '#1e293b', borderRadius: '6px', alignItems: 'flex-start' }}>
                        <div style={{ minWidth: '60px', color: '#22d3ee', fontWeight: 'bold', fontSize: '11px' }}>{seg.start}s – {seg.end}s</div>
                        <span style={{ color: '#e2e8f0', lineHeight: 1.4 }}>{seg.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {result.transcript.audio_plots && Object.keys(result.transcript.audio_plots).length > 0 && (
              <div className="result-card" style={{ borderLeft: '4px solid #f472b6' }}>
                <h4 style={{ color: '#f472b6', marginTop: 0, marginBottom: '15px' }}>🎛️ Acoustic Spectral Analysis</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {result.transcript.audio_plots.waveform && (
                    <div style={{ background: '#020617', padding: '10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                      <h5 style={{ color: '#94a3b8', fontSize: '11px', margin: '0 0 10px', textTransform: 'uppercase' }}>Waveform Plot</h5>
                      <img src={result.transcript.audio_plots.waveform} alt="Waveform" style={{ width: '100%', borderRadius: '4px' }} />
                    </div>
                  )}
                  {result.transcript.audio_plots.spectrogram && (
                    <div style={{ background: '#020617', padding: '10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                      <h5 style={{ color: '#94a3b8', fontSize: '11px', margin: '0 0 10px', textTransform: 'uppercase' }}>Frequency Spectrogram</h5>
                      <img src={result.transcript.audio_plots.spectrogram} alt="Spectrogram" style={{ width: '100%', borderRadius: '4px' }} />
                    </div>
                  )}
                  {result.transcript.audio_plots.energy && (
                    <div style={{ background: '#020617', padding: '10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                      <h5 style={{ color: '#94a3b8', fontSize: '11px', margin: '0 0 10px', textTransform: 'uppercase' }}>RMS Energy Detection</h5>
                      <img src={result.transcript.audio_plots.energy} alt="Energy Graph" style={{ width: '100%', borderRadius: '4px' }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="result-card" style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
            <p>No audio track was found or transcribed for this video.</p>
          </div>
        )}
      </div>

      {/* TEXT ANALYSIS TAB */}
      <div style={{ display: videoTab === 'text' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
        {result.sentiment_analysis && (
          <div className="result-card" style={{ borderLeft: '4px solid #38bdf8' }}>
            <h4 style={{ color: '#38bdf8', marginTop: 0, marginBottom: '10px' }}>📊 Video Sentiment Analysis</h4>
            <p style={{ margin: 0, color: '#f8fafc', fontSize: '14px', background: '#020617', padding: '15px', borderRadius: '8px', border: '1px solid #1e293b' }}>{result.sentiment_analysis.replace('Sentiment Analysis:', '')}</p>
          </div>
        )}
        {result.transcript?.full_text && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
            {result.transcript.entities && result.transcript.entities.length > 0 && (
              <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: '8px', padding: '15px' }}>
                <h5 style={{ color: '#4ade80', marginTop: 0, marginBottom: '15px', fontSize: '13px' }}>🏷️ Extracted Entities (SpaCy)</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                  {result.transcript.entities.map((ent, i) => (
                    <div key={i}>
                      <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 'bold' }}>{ent.label}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                        {ent.items.map((item, j) => <span key={j} style={{ background: '#1e293b', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', color: '#e2e8f0', border: '1px solid #334155' }}>{item}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.transcript.topics && result.transcript.topics.length > 0 && (
              <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: '8px', padding: '15px' }}>
                <h5 style={{ color: '#c084fc', marginTop: 0, marginBottom: '15px', fontSize: '13px' }}>📊 Discussion Topics (BERTopic)</h5>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                  {result.transcript.topics.map((top, i) => (
                    <div key={i} style={{ background: '#1e293b', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #334155' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{top.name}</span>
                      <span style={{ background: '#334155', color: '#94a3b8', padding: '2px 8px', borderRadius: '10px', fontSize: '10px' }}>{top.count} segments</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {!result.sentiment_analysis && !result.transcript?.entities?.length && !result.transcript?.topics?.length && (
          <div className="result-card" style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
            <p>No text analysis data available for this video.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoAnalysisView;
