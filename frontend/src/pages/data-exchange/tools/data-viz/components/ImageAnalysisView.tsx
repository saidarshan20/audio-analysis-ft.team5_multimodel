import { useState, useRef } from 'react';
import {
  BarChart2, Image as ImageIcon, Sparkles, Layers, Search,
  MessageCircle, Loader2, Send, SearchCheck, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  MultiImageAnalysisResponse, ImageZipAnalysisResponse,
  ImageQAResponse, ImageSearchResult,
  askAboutImage, askAboutExistingImage, searchImages,
} from '../services';

interface Props {
  imgResult: MultiImageAnalysisResponse | null;
  imgZipResult: ImageZipAnalysisResponse | null;
  imgTokens: { input: number; output: number; total: number };
  imgDuration: number;
  imgModel: string;
}

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

const ImageAnalysisView = ({ imgResult, imgZipResult, imgTokens, imgDuration, imgModel }: Props) => {
  const [selectedClusterPoint, setSelectedClusterPoint] = useState<any | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

  // Image Q&A state
  const [qaFile, setQaFile] = useState<File | null>(null);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaLoading, setQaLoading] = useState(false);
  const [qaAnswer, setQaAnswer] = useState<ImageQAResponse | null>(null);
  const qaFileRef = useRef<HTMLInputElement>(null);
  const [selectedImageForQA, setSelectedImageForQA] = useState<{ path: string; filename: string } | null>(null);

  // Image search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const handleImageQA = async () => {
    if (!qaQuestion.trim()) return;
    setQaLoading(true);
    try {
      let res: ImageQAResponse;
      if (selectedImageForQA) {
        res = await askAboutExistingImage(selectedImageForQA.path, qaQuestion.trim());
      } else if (qaFile) {
        res = await askAboutImage(qaFile, qaQuestion.trim());
      } else {
        toast.error('Please select an image first');
        setQaLoading(false);
        return;
      }
      setQaAnswer(res);
      toast.success('AI answered your question!');
    } catch (err: any) {
      toast.error(err.message || 'Q&A failed');
    } finally {
      setQaLoading(false);
    }
  };

  const handleImageSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      let captions: Array<{ filename: string; caption: string }> = [];
      if (imgResult) {
        captions = imgResult.results.map(r => ({ filename: r.filename, caption: r.caption }));
      } else if (imgZipResult) {
        captions = imgZipResult.result.clusters.map(c => ({ filename: c.filename, caption: c.description || '' }));
      }
      if (captions.length === 0) {
        toast.error('No image metadata available to search');
        return;
      }
      const res = await searchImages(searchQuery.trim(), captions);
      setSearchResults(res.results);
      setShowSearchResults(true);
      toast.success(`Found ${res.results.length} matching images`);
    } catch (err: any) {
      toast.error(err.message || 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <>
      {/* ── Single Image Result ── */}
      {imgResult && (
        <div className="img-analysis-view">
          <div className="viz-row">
            <div className="scatter-box result-card">
              <h4><BarChart2 size={16} /> UMAP Projection</h4>
              <p className="viz-desc">Semantic clustering of uploaded images based on CLIP embeddings.</p>
              <div className="scatter-plot">
                <svg viewBox="0 0 100 100" className="umap-svg">
                  {imgResult.projection?.map((p, i) => (
                    <circle
                      key={i}
                      cx={50 + p.x * 10}
                      cy={50 + p.y * 10}
                      r="1.5"
                      fill={`var(--cluster-${p.cluster % 5})`}
                      className="dot"
                    >
                      <title>{p.filename} (Cluster {p.cluster})</title>
                    </circle>
                  ))}
                </svg>
              </div>
            </div>
            <div className="clusters-box result-card">
              <h4>Clusters</h4>
              <div className="cluster-list">
                {imgResult.clusters?.map(c => (
                  <div key={c.cluster_id} className="cluster-item">
                    <span className="cluster-dot" style={{ background: `var(--cluster-${c.cluster_id % 5})` }}></span>
                    <div>
                      <strong>{c.description}</strong>
                      <span>{c.count} images</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="image-grid">
            {imgResult.results?.map((res, i) => (
              <div key={i} className="img-card result-card">
                <div className="img-thumbnail">
                  <ImageIcon size={24} color="#334155" />
                  <span className="filename-small">{res.filename}</span>
                </div>
                <div className="img-details">
                  <p className="caption">"{res.caption}"</p>
                  <div className="detections">
                    {res.detections?.slice(0, 3).map((d, j) => (
                      <span key={j} className="det-tag">{d.label} {Math.round(d.confidence * 100)}%</span>
                    ))}
                    {res.detections && res.detections.length > 3 && <span className="det-tag">+{res.detections.length - 3} more</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ZIP Image Analysis Result ── */}
      {imgZipResult && (
        <div className="img-analysis-view">
          {/* Metrics Strip */}
          <div className="metrics-strip with-margin">
            {[
              { icon: <ImageIcon size={13} />, label: 'Processing time', value: `${imgDuration.toFixed(1)}s`, sub: 'ML pipeline' },
              { icon: <ImageIcon size={13} />, label: 'Images processed', value: imgZipResult.processed_count.toString(), sub: 'from batch/ZIP' },
              { icon: <ImageIcon size={13} />, label: 'LLM tokens used', value: imgTokens.total.toLocaleString(), sub: `${imgTokens.input.toLocaleString()} in / ${imgTokens.output.toLocaleString()} out` },
              { icon: <ImageIcon size={13} />, label: 'Model', value: imgModel.replace('llama-3.1-70b-versatile', 'Llama 3.1 70B') || 'Llama 3.1 70B', sub: 'via Groq' },
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

          <div className="viz-row">
            <div className="scatter-box result-card">
              <h4><BarChart2 size={20} /> Multi-Dimensional Semantic Analysis</h4>
              <p className="viz-desc">Visualizing semantic relationships across your image collection using advanced clustering algorithms.</p>
              <div style={{ marginTop: '20px', background: '#020617', padding: '20px', borderRadius: '16px', border: '1px solid #1e293b', display: 'flex', justifyContent: 'center', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.5)' }}>
                <img
                  src={`${BASE_URL}/${imgZipResult.result?.plot_file_path}`}
                  alt="Cluster Plot"
                  style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '8px', objectFit: 'contain' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            </div>
            <div className="clusters-box result-card">
              <h4 style={{ fontSize: '18px', fontWeight: 700 }}>Cluster Insights</h4>
              <p className="viz-desc">Aggregated statistics from the processed ZIP batch ({imgZipResult.processed_count} total images).</p>
              <div className="cluster-list">
                {imgZipResult.result?.cluster_summaries?.map((c, idx) => (
                  <div key={idx} className="cluster-item" style={{ alignItems: 'flex-start' }}>
                    <span className="cluster-dot" style={{ background: `var(--cluster-${c.cluster_id % 5})`, display: 'inline-block', marginTop: '6px' }}></span>
                    <div style={{ width: '100%' }}>
                      <strong style={{ color: '#fb8c36', display: 'block', fontSize: '14px', marginBottom: '4px' }}>{c.description}</strong>
                      <span className="theme-subtext" style={{ margin: '8px 0 4px', display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Detected Contexts:</span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {imgZipResult.result?.clusters?.filter(p => p.cluster_id === c.cluster_id).slice(0, 1).map(p => (
                          p.objects?.slice(0, 4).map((obj, i) => (
                            <span key={i} className="chip theme-chip" style={{ fontSize: '9px' }}>{obj.label}</span>
                          ))
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Semantic Category Explorer */}
          <div style={{ padding: '40px 0 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h3 className="theme-heading" style={{ margin: 0, fontSize: '20px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Layers size={24} color="#f59e0b" /> Semantic Category Explorer
                </h3>
                <p className="theme-subtext" style={{ fontSize: '13px', marginTop: '4px' }}>AI-organized content themes. Click to filter the gallery below.</p>
              </div>
              {selectedCategory !== null && (
                <button
                  className="qa-send-btn"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '6px 12px', height: 'auto', fontSize: '12px' }}
                  onClick={() => setSelectedCategory(null)}
                >
                  Clear Filter
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
              {imgZipResult.result?.cluster_summaries?.map((sum, i) => (
                <div
                  key={i}
                  className={`ai-intel-card ${selectedCategory === sum.cluster_id ? 'active-category' : ''}`}
                  style={{
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    border: selectedCategory === sum.cluster_id ? '2px solid #fb8c36' : undefined,
                    background: selectedCategory === sum.cluster_id ? 'rgba(251, 140, 54, 0.05)' : undefined
                  }}
                  onClick={() => setSelectedCategory(sum.cluster_id)}
                >
                  <div style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: `var(--cluster-${sum.cluster_id % 5})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                        <ImageIcon size={20} color="#fff" />
                      </div>
                      <span className="theme-subtext" style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>{sum.count} Items</span>
                    </div>
                    <h4 className="theme-heading" style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>{sum.description}</h4>
                    <div className="theme-progress-bg" style={{ marginTop: '12px', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, (sum.count / imgZipResult.processed_count) * 100)}%`, background: `var(--cluster-${sum.cluster_id % 5})` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Annotated Detection Gallery */}
          <div style={{ padding: '40px 0 20px' }}>
            <h3 className="theme-heading" style={{ marginBottom: '24px', fontSize: '20px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ImageIcon size={24} color="#60a5fa" /> Annotated Detection Gallery
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '24px' }}>
              {imgZipResult.result?.clusters?.filter(c => selectedCategory === null || c.cluster_id === selectedCategory).map((c, i) => (
                <div key={i} className="premium-gallery-card" onClick={() => setSelectedClusterPoint(c)} style={{ cursor: 'pointer' }}>
                  <div style={{ overflow: 'hidden', position: 'relative' }}>
                    {c.annotated_image_path ? (
                      <img
                        className="premium-gallery-img"
                        src={`${BASE_URL}/${c.annotated_image_path}`}
                        alt={c.filename}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="premium-gallery-img" style={{ background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '12px' }}>No Tracking Data</div>
                    )}
                    <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                      <span className="premium-cluster-badge" style={{ color: '#fff', background: `var(--cluster-${c.cluster_id % 5})`, border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(4px)', fontSize: '10px' }}>
                        {imgZipResult.result?.cluster_summaries?.find(s => s.cluster_id === c.cluster_id)?.description || `Group ${c.cluster_id}`}
                      </span>
                    </div>
                  </div>
                  <div className="premium-gallery-info">
                    <span className="theme-heading" style={{ display: 'block', fontSize: '14px', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: '12px' }}>
                      {c.filename}
                    </span>
                    <div className="premium-gallery-meta">
                      <span className="theme-subtext" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Search size={14} /> {c.objects?.length || 0} Objects
                      </span>
                      <button
                        className="qa-send-btn"
                        style={{ height: '28px', width: 'auto', padding: '0 10px', fontSize: '11px', gap: '6px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedImageForQA({ path: c.annotated_image_path || '', filename: c.filename });
                          setQaAnswer(null);
                          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                        }}
                      >
                        <MessageCircle size={12} /> Ask AI
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── AI Intelligence Section (Q&A + Search) ── */}
      {(imgResult || imgZipResult) && (
        <div className="ai-intelligence-section">
          <h3 className="theme-heading" style={{ fontSize: '22px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <Sparkles size={24} color="#fb8c36" /> Intelligent Visual Reasoning
          </h3>
          <p className="theme-subtext" style={{ fontSize: '14px', marginBottom: '28px' }}>Contextual Multimodal Intelligence — Ask questions about images or perform a semantic lookup across your analyzed collection.</p>

          <div className="ai-intel-grid">
            {/* Image Q&A Card */}
            <div className="ai-intel-card">
              <div className="ai-intel-card-header">
                <div className="ai-intel-icon qa-icon">
                  <MessageCircle size={20} />
                </div>
                <div>
                  <h4>Image Q&A</h4>
                  <p>{selectedImageForQA ? `Querying: ${selectedImageForQA.filename}` : 'Upload an image and ask any question about it'}</p>
                </div>
              </div>

              <div className="ai-intel-body">
                {selectedImageForQA && (
                  <div className="qa-upload-zone" style={{ borderColor: '#60a5fa', background: 'rgba(96, 165, 250, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 15px', cursor: 'default' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <ImageIcon size={18} color="#60a5fa" />
                      <span style={{ color: '#f8fafc', fontSize: '13px', fontWeight: 600 }}>{selectedImageForQA.filename}</span>
                    </div>
                    <button
                      onClick={() => setSelectedImageForQA(null)}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
                    >
                      Switch to Upload
                    </button>
                  </div>
                )}

                {!selectedImageForQA && (
                  <div className="qa-upload-zone" onClick={() => qaFileRef.current?.click()}>
                    <input
                      type="file"
                      ref={qaFileRef}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { setQaFile(f); setQaAnswer(null); toast.success(`Selected: ${f.name}`); }
                      }}
                      style={{ display: 'none' }}
                      accept="image/*"
                    />
                    {qaFile ? (
                      <div className="qa-file-selected">
                        <ImageIcon size={16} color="#fb8c36" />
                        <span>{qaFile.name}</span>
                      </div>
                    ) : (
                      <>
                        <Upload size={18} color="#94a3b8" />
                        <span style={{ color: '#94a3b8', fontSize: '13px' }}>Click to select an image</span>
                      </>
                    )}
                  </div>
                )}

                <div className="qa-input-row">
                  <input
                    type="text"
                    className="qa-question-input"
                    placeholder="Ask anything... e.g. 'Is there a safety violation?'"
                    value={qaQuestion}
                    onChange={(e) => setQaQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (qaFile || selectedImageForQA) && qaQuestion.trim()) {
                        e.preventDefault();
                        handleImageQA();
                      }
                    }}
                  />
                  <button
                    className="qa-send-btn"
                    disabled={(!qaFile && !selectedImageForQA) || !qaQuestion.trim() || qaLoading}
                    onClick={handleImageQA}
                  >
                    {qaLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>

                {qaAnswer && (
                  <div className="qa-answer-box">
                    <div className="qa-answer-label">
                      <Sparkles size={12} color="#fb8c36" />
                      AI Response
                    </div>
                    <p>{qaAnswer.answer}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Smart Search Card */}
            <div className="ai-intel-card">
              <div className="ai-intel-card-header">
                <div className="ai-intel-icon search-icon">
                  <SearchCheck size={20} />
                </div>
                <div>
                  <h4>Smart Image Search</h4>
                  <p>Search your analyzed images with natural language</p>
                </div>
              </div>

              <div className="ai-intel-body">
                <div className="qa-input-row">
                  <input
                    type="text"
                    className="qa-question-input"
                    placeholder="e.g. 'sunset with a bridge' or 'most industrial photos'"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchQuery.trim() && (imgResult || imgZipResult)) {
                        e.preventDefault();
                        handleImageSearch();
                      }
                    }}
                  />
                  <button
                    className="qa-send-btn search-btn"
                    disabled={!searchQuery.trim() || searchLoading || (!imgResult && !imgZipResult)}
                    onClick={handleImageSearch}
                  >
                    {searchLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  </button>
                </div>

                {showSearchResults && searchResults.length > 0 && (
                  <div className="search-results-list" style={{ maxHeight: '500px' }}>
                    {searchResults.map((sr, idx) => {
                      let imgPath = null;
                      if (imgZipResult) {
                        const pt = imgZipResult.result.clusters.find(c => c.filename === sr.filename);
                        if (pt?.annotated_image_path) imgPath = `${BASE_URL}/${pt.annotated_image_path}`;
                      }
                      return (
                        <div key={idx} className="search-result-item" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {imgPath && (
                            <div className="search-result-thumb" style={{ width: '100%', height: '180px', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                              <img src={imgPath} alt={sr.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', transition: 'transform 0.3s' }} onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.05)')} onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')} />
                            </div>
                          )}
                          <div>
                            <div className="search-result-rank">
                              <span className="search-rank-num">#{idx + 1}</span>
                              <div className="search-score-bar">
                                <div className="search-score-fill" style={{ width: `${sr.relevance_score * 10}%` }} />
                              </div>
                              <span className="search-score-label">{sr.relevance_score}/10</span>
                            </div>
                            <div className="search-result-info" style={{ marginTop: '8px' }}>
                              <strong style={{ display: 'block', fontSize: '13px' }}>{sr.filename}</strong>
                              <span className="search-result-reason" style={{ fontSize: '11px', display: 'block', marginTop: '4px' }}>{sr.reason}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {showSearchResults && searchResults.length === 0 && (
                  <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', marginTop: '16px' }}>
                    No images matched your query.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cluster Point Detail Modal ── */}
      {selectedClusterPoint && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(2, 6, 23, 0.9)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}
          onClick={() => setSelectedClusterPoint(null)}
        >
          <div
            style={{ background: '#0f172a', borderRadius: '16px', border: '1px solid #1e293b', width: '100%', maxWidth: '1000px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '20px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' }}>
              <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '18px' }}>{selectedClusterPoint?.filename}</h3>
              <button
                onClick={() => setSelectedClusterPoint(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '28px', padding: 0, lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#020617', padding: '20px', overflow: 'auto' }}>
                {selectedClusterPoint?.annotated_image_path ? (
                  <img src={`${BASE_URL}/${selectedClusterPoint.annotated_image_path}`} alt="Full size" style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '4px' }} />
                ) : (
                  <div style={{ color: '#64748b' }}>No Tracking Data</div>
                )}
              </div>
              <div style={{ width: '350px', display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', overflowY: 'auto', background: '#0f172a', borderLeft: '1px solid #1e293b' }}>
                <div>
                  <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>AI Caption</span>
                  <p style={{ margin: '8px 0 0', color: '#f1f5f9', fontSize: '15px', lineHeight: '1.5', background: 'rgba(30, 41, 59, 0.5)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    {selectedClusterPoint?.description || 'No caption available.'}
                  </p>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Detected Objects ({selectedClusterPoint?.objects?.length || 0})</span>
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '15px', background: 'rgba(30, 41, 59, 0.5)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    {selectedClusterPoint?.objects?.map((obj: any, idx: number) => (
                      <span key={idx} style={{ background: '#334155', color: '#f8fafc', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', border: '1px solid #475569' }}>
                        {obj.label} <span style={{ color: '#60a5fa', marginLeft: '4px', fontWeight: 'bold' }}>{Math.round(obj.confidence * 100)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Assigned Cluster</span>
                  <div style={{ marginTop: '8px', padding: '12px 15px', background: `var(--cluster-${(selectedClusterPoint?.cluster_id || 0) % 5})`, color: '#fff', borderRadius: '8px', fontWeight: 'bold', display: 'inline-block', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                    Cluster {selectedClusterPoint?.cluster_id}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ImageAnalysisView;
