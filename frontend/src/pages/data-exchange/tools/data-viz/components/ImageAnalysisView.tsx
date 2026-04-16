import { useState, useRef } from 'react';
import {
  BarChart2, Image as ImageIcon, Sparkles, Layers, Search,
  MessageCircle, Loader2, Send, SearchCheck, Upload, Play, Columns, ArrowRight, X, AlertCircle,
  Clock, Zap, Cpu
} from 'lucide-react';
import { toast } from 'sonner';
import {
  MultiImageAnalysisResponse, ImageZipAnalysisResponse, ImageQAResponse, ImageSearchResult,
  askAboutImage, askAboutExistingImage, searchImages, askAboutImageCollection,
  ImageCollectionQAResponse, GroundedImageRecord
} from '../services';

export interface VisualRecord {
  filename: string;
  caption: string;
  objects: string[];
  cluster: number;
  cluster_id: number;
  cluster_description?: string;
  annotated_image_path: string | null;
  object_count: number;
  object_details: { label: string; confidence: number; bbox: number[] }[];
}

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
  
  const qaRef = useRef<HTMLDivElement>(null);
  const collectionQaRef = useRef<HTMLDivElement>(null);
  const [qaFile, setQaFile] = useState<File | null>(null);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaLoading, setQaLoading] = useState(false);
  const [qaAnswer, setQaAnswer] = useState<ImageQAResponse | null>(null);
  const qaFileRef = useRef<HTMLInputElement>(null);
  const [selectedImageForQA, setSelectedImageForQA] = useState<{ path: string, filename: string } | null>(null);

  // ── NEW: Image Search State ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [collectionQuestion, setCollectionQuestion] = useState('');
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionAnswer, setCollectionAnswer] = useState<ImageCollectionQAResponse | null>(null);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);


  const zipClusterLabelMap: Record<number, string> = {};
  imgZipResult?.result.cluster_summaries?.forEach(summary => {
    zipClusterLabelMap[summary.cluster_id] = summary.description;
  });

  const projectionClusterMap: Record<string, number> = {};
  imgResult?.projection?.forEach(point => {
    projectionClusterMap[point.filename] = point.cluster;
  });

  const singleClusterLabelMap: Record<number, string> = {};
  imgResult?.clusters?.forEach(cluster => {
    singleClusterLabelMap[cluster.cluster_id] = cluster.description;
  });

  const visualRecords: VisualRecord[] = imgZipResult
    ? imgZipResult.result.clusters.map(point => ({
        filename: point.filename,
        caption: point.description || '',
        objects: point.objects.map(obj => obj.label),
        cluster: point.cluster_id,
        cluster_id: point.cluster_id,
        cluster_description: zipClusterLabelMap[point.cluster_id] || `Group ${point.cluster_id}`,
        annotated_image_path: point.annotated_image_path,
        object_count: point.objects.length,
        object_details: point.objects,
      }))
    : imgResult
      ? imgResult.results.map(result => {
          const clusterId = projectionClusterMap[result.filename] ?? 0;
          return {
            filename: result.filename,
            caption: result.caption,
            objects: result.detections.map(detection => detection.label),
            cluster: clusterId,
            cluster_id: clusterId,
            cluster_description: singleClusterLabelMap[clusterId] || `Group ${clusterId}`,
            annotated_image_path: null,
            object_count: result.detections.length,
            object_details: result.detections.map(detection => ({
              label: detection.label,
              confidence: detection.confidence,
              bbox: [detection.x1, detection.y1, detection.x2, detection.y2],
            })),
          };
        })
      : [];

  const collectionPrompts = [
    'Which images should I review first?',
    'Summarize the main themes in this batch.',
    'Which images look unusual compared with the rest?',
  ];

  const totalObjects = visualRecords.reduce((sum, record) => sum + record.object_count, 0);
  const objectCounts = visualRecords.reduce<Record<string, number>>((acc, record) => {
    record.objects.forEach(label => {
      acc[label] = (acc[label] || 0) + 1;
    });
    return acc;
  }, {});
  const topObjects = Object.entries(objectCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const clusterCounts = imgZipResult?.result.cluster_summaries?.length
    ? imgZipResult.result.cluster_summaries
    : imgResult?.clusters ?? [];
  const dominantCluster = clusterCounts.slice().sort((a, b) => b.count - a.count)[0] ?? null;
  const lowObjectCoverage = visualRecords.filter(record => record.object_count === 0).length;
  const averageObjectsPerImage = visualRecords.length ? (totalObjects / visualRecords.length) : 0;
  const coveragePercent = visualRecords.length ? Math.round(((visualRecords.length - lowObjectCoverage) / visualRecords.length) * 100) : 0;

  const getRecordByFilename = (filename: string) => visualRecords.find(record => record.filename === filename) || null;

  const openRecordByFilename = (filename: string) => {
    if (!imgZipResult) return;
    const point = imgZipResult.result.clusters.find(cluster => cluster.filename === filename);
    if (point) setSelectedClusterPoint(point);
  };

  const toggleCompareSelection = (filename: string) => {
    setCompareSelection(prev => {
      if (prev.includes(filename)) {
        return prev.filter(item => item !== filename);
      }
      if (prev.length >= 2) {
        toast.info('Compare supports two images at a time. Replacing the oldest selection.');
        return [prev[1], filename];
      }
      return [...prev, filename];
    });
  };

  const selectedCompareRecords = compareSelection
    .map(filename => getRecordByFilename(filename))
    .filter((record): record is VisualRecord => Boolean(record));

  const [leftCompare, rightCompare] = selectedCompareRecords;
  const sharedObjects = leftCompare && rightCompare
    ? leftCompare.objects.filter(label => rightCompare.objects.includes(label)).filter((label, index, arr) => arr.indexOf(label) === index)
    : [];
  const leftOnlyObjects = leftCompare && rightCompare
    ? leftCompare.objects.filter(label => !rightCompare.objects.includes(label)).filter((label, index, arr) => arr.indexOf(label) === index)
    : [];
  const rightOnlyObjects = leftCompare && rightCompare
    ? rightCompare.objects.filter(label => !leftCompare.objects.includes(label)).filter((label, index, arr) => arr.indexOf(label) === index)
    : [];
  const compareNarrative = leftCompare && rightCompare
    ? `${leftCompare.filename} is grounded in ${leftCompare.cluster_description}, while ${rightCompare.filename} sits in ${rightCompare.cluster_description}. ${
        sharedObjects.length
          ? `They overlap on ${sharedObjects.join(', ')}.`
          : 'They do not share detected object labels.'
      } ${
        leftOnlyObjects.length
          ? `${leftCompare.filename} stands out with ${leftOnlyObjects.slice(0, 4).join(', ')}.`
          : ''
      } ${
        rightOnlyObjects.length
          ? `${rightCompare.filename} stands out with ${rightOnlyObjects.slice(0, 4).join(', ')}.`
          : ''
      }`.trim()
    : '';

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
      if (visualRecords.length === 0) {
        toast.error("No image metadata available to search");
        return;
      }

      const res = await searchImages(searchQuery.trim(), visualRecords);
      setSearchResults(res.results);
      setShowSearchResults(true);
      toast.success(`Found ${res.results.length} matching images`);
    } catch (err: any) {
      toast.error(err.message || 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleCollectionQA = async (presetQuestion?: string) => {
    const question = (presetQuestion || collectionQuestion).trim();
    if (!question) return;
    if (visualRecords.length === 0) {
      toast.error('Analyze a batch of images first');
      return;
    }

    setCollectionLoading(true);
    try {
      const res = await askAboutImageCollection(question, visualRecords);
      setCollectionQuestion(question);
      setCollectionAnswer(res);
      toast.success('Collection insights ready');
    } catch (err: any) {
      toast.error(err.message || 'Collection Q&A failed');
    } finally {
      setCollectionLoading(false);
    }
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
            <ImageIcon size={24} color="var(--border-bright)" />
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

{/* ZIP Image Analysis Result */}
{imgZipResult && (
  <div className="img-analysis-view">
    {/* ── Image Analysis Metrics Strip ── */}
    <div className="metrics-strip with-margin">
      {[
        {
          icon: <Clock size={13} />,
          label: 'Processing time',
          value: `${imgDuration.toFixed(1)}s`,
          sub: 'ML pipeline',
        },
        {
          icon: <ImageIcon size={13} />,
          label: 'Images processed',
          value: imgZipResult.processed_count.toString(),
          sub: 'from batch/ZIP',
        },
        {
          icon: <Zap size={13} />,
          label: 'LLM tokens used',
          value: imgTokens.total.toLocaleString(),
          sub: `${imgTokens.input.toLocaleString()} in / ${imgTokens.output.toLocaleString()} out`,
        },
        {
          icon: <Cpu size={13} />,
          label: 'Model',
          value: imgModel.replace('llama-3.1-70b-versatile', 'Llama 3.1 70B') || 'Llama 3.1 70B',
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

    <div className="result-card" style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', marginBottom: '18px', flexWrap: 'wrap' }}>
        <div>
          <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Sparkles size={18} color="#fb8c36" /> Batch Summary Insights
          </h4>
          <p className="viz-desc" style={{ marginTop: '8px' }}>
            Quick collection-level takeaways generated from captions, detections, and cluster groupings.
          </p>
        </div>
        <button
          className="qa-send-btn"
          style={{ width: 'auto', padding: '0 14px', fontSize: '12px' }}
          disabled={collectionLoading || visualRecords.length === 0}
          onClick={() => {
            handleCollectionQA('Summarize the main themes, notable outliers, and strongest review priorities in this image batch.');
            setTimeout(() => collectionQaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
          }}
        >
          {collectionLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          AI Summary
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        {[
          {
            label: 'Dominant theme',
            value: dominantCluster?.description || 'Not enough data',
            sub: dominantCluster ? `${dominantCluster.count} images in the largest cluster` : 'Waiting on clustering',
          },
          {
            label: 'Top detected objects',
            value: topObjects.length ? topObjects.slice(0, 3).map(([label]) => label).join(', ') : 'No objects detected',
            sub: topObjects.length ? `${topObjects[0][1]} occurrences for the top label` : 'No detections yet',
          },
          {
            label: 'Detection coverage',
            value: `${coveragePercent}%`,
            sub: `${visualRecords.length - lowObjectCoverage}/${visualRecords.length || 0} images contain detections`,
          },
          {
            label: 'Object richness',
            value: `${averageObjectsPerImage.toFixed(1)} avg`,
            sub: `${totalObjects} total objects across ${visualRecords.length || 0} images`,
          },
        ].map((insight, idx) => (
          <div key={idx} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '14px', padding: '16px' }}>
            <div style={{ color: 'var(--t-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>{insight.label}</div>
            <div style={{ color: 'var(--t-primary)', fontSize: '16px', fontWeight: 700, lineHeight: 1.4 }}>{insight.value}</div>
            <div style={{ color: 'var(--t-muted)', fontSize: '12px', marginTop: '8px' }}>{insight.sub}</div>
          </div>
        ))}
      </div>
    </div>


    <div className="viz-row">
      <div className="scatter-box result-card">
        <h4><BarChart2 size={20} /> Multi-Dimensional Semantic Analysis</h4>
        <p className="viz-desc">Visualizing semantic relationships across your image collection using advanced clustering algorithms.</p>
        <div style={{ marginTop: '20px', background: 'var(--bg-root)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border-mid)', display: 'flex', justifyContent: 'center', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.5)' }}>
          <img
            src={`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/${imgZipResult.result?.plot_file_path}`}
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

    {/* 5th Thing: Semantic Category Explorer */}
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
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  background: `var(--cluster-${sum.cluster_id % 5})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}>
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
                  src={`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/${c.annotated_image_path}`}
                  alt={c.filename}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="premium-gallery-img" style={{ background: 'var(--border-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontSize: '12px' }}>No Tracking Data</div>
              )}
              <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                <span className="premium-cluster-badge" style={{
                  color: '#fff',
                  background: `var(--cluster-${c.cluster_id % 5})`,
                  border: `1px solid rgba(255,255,255,0.3)`,
                  backdropFilter: 'blur(4px)',
                  fontSize: '10px'
                }}>
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="qa-send-btn"
                    style={{ height: '28px', width: 'auto', padding: '0 10px', fontSize: '11px', gap: '6px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCompareSelection(c.filename);
                    }}
                  >
                    {compareSelection.includes(c.filename) ? 'Selected' : 'Compare'}
                  </button>
                  <button
                    className="qa-send-btn"
                    style={{ height: '28px', width: 'auto', padding: '0 10px', fontSize: '11px', gap: '6px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedImageForQA({ path: c.annotated_image_path || '', filename: c.filename });
                      setQaAnswer(null);
                      setTimeout(() => qaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                    }}
                  >
                    <MessageCircle size={12} /> Ask AI
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
)}

{(imgResult || imgZipResult) && (
  <div className="ai-intelligence-section">
    <h3 className="theme-heading" style={{ fontSize: '22px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
      <Sparkles size={24} color="#fb8c36" /> Intelligent Visual Reasoning
    </h3>
    <p className="theme-subtext" style={{ fontSize: '14px', marginBottom: '28px' }}>Contextual Multimodal Intelligence — Ask questions about images or perform a semantic lookup across your analyzed collection.</p>

    <div className="ai-intel-grid">
      {/* ── Image Q&A Card ── */}
      <div className="ai-intel-card" ref={qaRef}>
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
                <span style={{ color: 'var(--t-primary)', fontSize: '13px', fontWeight: 600 }}>{selectedImageForQA.filename}</span>
              </div>
              <button
                onClick={() => setSelectedImageForQA(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--t-secondary)', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
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
                  <Upload size={18} color="var(--t-secondary)" />
                  <span style={{ color: 'var(--t-secondary)', fontSize: '13px' }}>Click to select an image</span>
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

      {/* ── Smart Search Card ── */}
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
                // Find image path from either imgResult or imgZipResult
                let imgPath = null;
                if (imgZipResult) {
                  const pt = imgZipResult.result.clusters.find(c => c.filename === sr.filename);
                  if (pt?.annotated_image_path) imgPath = `${BASE_URL}/${pt.annotated_image_path}`;
                }

                return (
                  <div key={idx} className="search-result-item" style={{ display: 'flex', flexDirection: 'column', gap: '12px', cursor: imgZipResult ? 'pointer' : 'default' }} onClick={() => imgZipResult && openRecordByFilename(sr.filename)}>
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
                        {sr.matched_on?.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                            {sr.matched_on.map(signal => (
                              <span key={signal} className="chip theme-chip" style={{ fontSize: '10px' }}>{signal}</span>
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                          <button
                            className="qa-send-btn"
                            style={{ height: '28px', width: 'auto', padding: '0 10px', fontSize: '11px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCompareSelection(sr.filename);
                            }}
                          >
                            {compareSelection.includes(sr.filename) ? 'Selected' : 'Compare'}
                          </button>
                          {imgZipResult && (
                            <button
                              className="qa-send-btn"
                              style={{ height: '28px', width: 'auto', padding: '0 10px', fontSize: '11px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                openRecordByFilename(sr.filename);
                              }}
                            >
                              Open
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {showSearchResults && searchResults.length === 0 && (
            <p style={{ color: 'var(--t-secondary)', fontSize: '13px', textAlign: 'center', marginTop: '16px' }}>
              No images matched your query.
            </p>
          )}
        </div>
      </div>

      <div className="ai-intel-card" ref={collectionQaRef} style={{ gridColumn: '1 / -1', width: '100%' }}>
        <div className="ai-intel-card-header">
          <div className="ai-intel-icon qa-icon">
            <Sparkles size={20} />
          </div>
          <div>
            <h4>Collection Q&A</h4>
            <p>Ask questions about the whole analyzed batch, not just one image.</p>
          </div>
        </div>

        <div className="ai-intel-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
            {collectionPrompts.map(prompt => (
              <button
                key={prompt}
                className="qa-send-btn"
                style={{ width: 'auto', padding: '0 12px', fontSize: '11px', height: '32px' }}
                disabled={collectionLoading || visualRecords.length === 0}
                onClick={() => handleCollectionQA(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="qa-input-row">
            <input
              type="text"
              className="qa-question-input"
              placeholder="e.g. 'Which images should I review first for safety issues?'"
              value={collectionQuestion}
              onChange={(e) => setCollectionQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && collectionQuestion.trim()) {
                  e.preventDefault();
                  handleCollectionQA();
                }
              }}
            />
            <button
              className="qa-send-btn"
              disabled={!collectionQuestion.trim() || collectionLoading || visualRecords.length === 0}
              onClick={() => handleCollectionQA()}
            >
              {collectionLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>

          {collectionAnswer && (
            <div className="qa-answer-box" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div className="qa-answer-label">
                  <Sparkles size={12} color="#fb8c36" />
                  Batch Answer
                </div>
                <p>{collectionAnswer.answer}</p>
              </div>

              {collectionAnswer.supporting_results?.length > 0 && (
                <div>
                  <div className="qa-answer-label">
                    <SearchCheck size={12} color="#60a5fa" />
                    Supporting Images
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                    {collectionAnswer.supporting_results.map(item => (
                      <button
                        key={item.filename}
                        style={{ textAlign: 'left', background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '10px', padding: '10px 12px', cursor: imgZipResult ? 'pointer' : 'default' }}
                        onClick={() => imgZipResult && openRecordByFilename(item.filename)}
                      >
                        <div style={{ color: 'var(--t-primary)', fontSize: '13px', fontWeight: 700 }}>{item.filename}</div>
                        <div style={{ color: 'var(--t-secondary)', fontSize: '12px', marginTop: '4px' }}>{item.reason}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {collectionAnswer.follow_up_suggestions?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {collectionAnswer.follow_up_suggestions.map(prompt => (
                    <button
                      key={prompt}
                      className="qa-send-btn"
                      style={{ width: 'auto', padding: '0 12px', fontSize: '11px', height: '30px' }}
                      onClick={() => {
                        setCollectionQuestion(prompt);
                        handleCollectionQA(prompt);
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
)}

{(imgResult || imgZipResult) && (
  <div className="result-card" style={{ marginTop: '24px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '18px' }}>
      <div>
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ArrowRight size={18} color="#60a5fa" /> Side-by-Side Compare
        </h4>
        <p className="viz-desc" style={{ marginTop: '8px' }}>
          Select any two images from the gallery or search results to compare themes, clusters, and detected objects.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <span className="theme-subtext" style={{ fontSize: '12px' }}>{compareSelection.length}/2 selected</span>
        {compareSelection.length > 0 && (
          <button
            className="qa-send-btn"
            style={{ width: 'auto', padding: '0 12px', fontSize: '11px', height: '30px' }}
            onClick={() => setCompareSelection([])}
          >
            Clear
          </button>
        )}
      </div>
    </div>

    {selectedCompareRecords.length < 2 ? (
      <div style={{ padding: '24px', border: '1px dashed var(--border-bright)', borderRadius: '14px', color: 'var(--t-secondary)', textAlign: 'center' }}>
        Pick two images to unlock the comparison panel.
      </div>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}>
        {selectedCompareRecords.map(record => (
          <div key={record.filename} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '14px', padding: '16px' }}>
            {record.annotated_image_path ? (
              <img
                src={`${BASE_URL}/${record.annotated_image_path}`}
                alt={record.filename}
                style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '10px', marginBottom: '14px' }}
              />
            ) : (
              <div style={{ width: '100%', height: '180px', borderRadius: '10px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border-mid)', color: 'var(--t-muted)' }}>
                Preview unavailable
              </div>
            )}
            <div style={{ color: 'var(--t-primary)', fontWeight: 700, fontSize: '15px' }}>{record.filename}</div>
            <div style={{ color: 'var(--t-secondary)', fontSize: '12px', marginTop: '6px' }}>{record.cluster_description}</div>
            <p style={{ color: 'var(--t-secondary)', fontSize: '13px', lineHeight: 1.5, marginTop: '12px' }}>{record.caption || 'No caption available.'}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
              {record.object_details.length > 0 ? record.object_details.map((objectDetail, idx) => (
                <span key={`${record.filename}-${objectDetail.label}-${idx}`} className="chip theme-chip" style={{ fontSize: '10px' }}>
                  {objectDetail.label} {Math.round(objectDetail.confidence * 100)}%
                </span>
              )) : (
                <span className="theme-subtext" style={{ fontSize: '12px' }}>No detected objects</span>
              )}
            </div>
          </div>
        ))}
      </div>
    )}

    {selectedCompareRecords.length === 2 && (
      <div style={{ marginTop: '18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '14px', padding: '16px' }}>
          <div style={{ color: 'var(--t-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Shared Objects</div>
          <div style={{ color: 'var(--t-primary)', fontSize: '14px', lineHeight: 1.6 }}>
            {sharedObjects.length ? sharedObjects.join(', ') : 'No shared object labels'}
          </div>
        </div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '14px', padding: '16px' }}>
          <div style={{ color: 'var(--t-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
            {leftCompare?.filename} only
          </div>
          <div style={{ color: 'var(--t-primary)', fontSize: '14px', lineHeight: 1.6 }}>
            {leftOnlyObjects.length ? leftOnlyObjects.join(', ') : 'No unique object labels'}
          </div>
        </div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '14px', padding: '16px' }}>
          <div style={{ color: 'var(--t-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
            {rightCompare?.filename} only
          </div>
          <div style={{ color: 'var(--t-primary)', fontSize: '14px', lineHeight: 1.6 }}>
            {rightOnlyObjects.length ? rightOnlyObjects.join(', ') : 'No unique object labels'}
          </div>
        </div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '14px', padding: '16px' }}>
          <div style={{ color: 'var(--t-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Comparison Readout</div>
          <div style={{ color: 'var(--t-primary)', fontSize: '14px', lineHeight: 1.6 }}>{compareNarrative}</div>
        </div>
      </div>
    )}
  </div>
)}

    </div>
  );
};

export default ImageAnalysisView;
