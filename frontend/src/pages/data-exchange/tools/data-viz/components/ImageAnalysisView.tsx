import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  BarChart2, 
  Image as ImageIcon, 
  MapPin, 
  Search, 
  Sparkles, 
  ArrowRight, 
  Clock, 
  Zap, 
  Cpu, 
  MessageCircle, 
  Send, 
  Loader2, 
  Upload, 
  SearchCheck, 
  Layers,
  ChevronRight,
  Maximize2,
  Info
} from 'lucide-react';
import { 
  ScatterChart, 
  Scatter, 
  XAxis, 
  YAxis, 
  ZAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell, 
  Label 
} from 'recharts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from 'react-hot-toast';
import { 
  MultiImageAnalysisResponse, ImageZipAnalysisResponse, ImageQAResponse, ImageSearchResult,
  askAboutExistingImage, searchImages, askAboutImageCollection,
  ImageCollectionQAResponse
} from '../services';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8742';

interface VisualRecord {
  filename: string;
  caption: string;
  objects: string[];
  cluster: number;
  cluster_id: number;
  cluster_description: string;
  annotated_image_path: string | null;
  object_count: number;
  object_details: any[];
  metadata?: any;
  x?: number;
  y?: number;
}

interface Props {
  imgResult?: MultiImageAnalysisResponse | null;
  imgZipResult?: ImageZipAnalysisResponse | null;
  imgTokens: { input: number; output: number; total: number };
  imgDuration: number;
  imgModel: string;
}

/**
 * ImageMetadataPanel - A detailed view of a single image's metadata and object detection
 */
const ImageMetadataPanel = ({ record, onClose }: { record: VisualRecord, onClose: () => void }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const meta = record.metadata;

  useEffect(() => {
    if (record.metadata?.gps?.lat && record.metadata?.gps?.lng && mapRef.current && !mapInstance.current) {
      const { lat, lng } = record.metadata.gps;

      // Initialize map
      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([lat, lng], 13);
      
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapInstance.current);
      
      const customIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: #fb8c36; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(251,140,54,0.5);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      L.marker([lat, lng], { icon: customIcon }).addTo(mapInstance.current);
    }
    
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [record]);

  return (
    <div className="metadata-panel-overlay" onClick={onClose}>
      <div className="metadata-panel-content animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <div className="header-title">
            <ImageIcon size={20} color="#fb8c36" />
            <h3>{record.filename}</h3>
          </div>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="panel-body custom-scrollbar">
          <div className="panel-grid">
            <div className="main-preview">
              {record.annotated_image_path ? (
                <img src={`${BASE_URL}/${record.annotated_image_path}`} alt={record.filename} className="full-img" />
              ) : (
                <div className="no-img-placeholder">
                  <ImageIcon size={48} />
                  <span>Annotated Preview Unavailable</span>
                </div>
              )}
            </div>

            <div className="side-metadata">
              <div className="info-section">
                <div className="section-title"><Sparkles size={14} /> AI Insight</div>
                <div className="ai-caption">"{record.caption}"</div>
              </div>

              <div className="info-section">
                <div className="section-title"><Layers size={14} /> Objects Detected ({record.object_count})</div>
                <div className="object-chips">
                  {record.object_details.map((obj, i) => (
                    <span key={i} className="chip theme-chip">
                      {obj.label} {Math.round(obj.confidence * 100)}%
                    </span>
                  ))}
                </div>
              </div>

              {meta?.gps && (
                <div className="info-section">
                  <div className="section-title"><MapPin size={14} /> GPS Location</div>
                  <div ref={mapRef} className="mini-map"></div>
                  <div className="gps-box">
                    <span>Lat: {meta.gps.lat.toFixed(6)}</span>
                    <span>Lng: {meta.gps.lng.toFixed(6)}</span>
                  </div>
                </div>
              )}

              {!meta?.gps && (
                <div className="info-section no-gps">
                  <div className="section-title"><MapPin size={14} /> Location</div>
                  <div className="empty-state">No GPS metadata found in this image.</div>
                </div>
              )}

              {meta?.exif && (
                <div className="info-section">
                  <div className="section-title"><Info size={14} /> Technical Metadata</div>
                  <div className="exif-grid">
                    {Object.entries(meta.exif).slice(0, 8).map(([k, v]) => (
                      <div key={k} className="exif-item">
                        <span className="exif-label">{k}</span>
                        <span className="exif-value">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * GlobalCollectionMap - Visualizes all images with GPS data on a single interactive map
 */
const GlobalCollectionMap = ({
  records,
  onSelectRecord
}: {
  records: VisualRecord[],
  onSelectRecord: (filename: string) => void
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (mapRef.current && !mapInstance.current) {
      const geoTaggedRecords = records.filter(r => r.metadata?.gps?.lat && r.metadata?.gps?.lng);
      if (geoTaggedRecords.length === 0) return;

      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([geoTaggedRecords[0].metadata.gps.lat, geoTaggedRecords[0].metadata.gps.lng], 4);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapInstance.current);

      geoTaggedRecords.forEach(r => {
        const marker = L.circleMarker([r.metadata.gps.lat, r.metadata.gps.lng], {
          radius: 8,
          fillColor: '#fb8c36',
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(mapInstance.current!);

        marker.bindPopup(`
          <div style="font-family: Inter, sans-serif; padding: 10px; width: 180px;">
            <strong style="display:block;margin-bottom:5px;">${r.filename}</strong>
            <img src="${BASE_URL}/${r.annotated_image_path}" style="width:100%;border-radius:4px;margin-bottom:8px;" />
            <button id="marker-btn-${r.filename.replace(/[^a-zA-Z0-9]/g, '_')}" style="background:#fb8c36;color:white;border:none;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:10px;width:100%;font-weight:600;">View Intelligence</button>
          </div>
        `);

        marker.on('popupopen', () => {
          const btnId = `marker-btn-${r.filename.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const btn = document.getElementById(btnId);
          if (btn) {
            btn.onclick = () => onSelectRecord(r.filename);
          }
        });
      });

      L.control.zoom({ position: 'topright' }).addTo(mapInstance.current);

      // Fit bounds if multiple points
      if (geoTaggedRecords.length > 1) {
        const bounds = L.latLngBounds(geoTaggedRecords.map(r => [r.metadata!.gps!.lat as number, r.metadata!.gps!.lng as number]));
        mapInstance.current.fitBounds(bounds, { padding: [50, 50] });
      }
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [records, onSelectRecord]);

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }}></div>;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '12px', padding: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', maxWidth: '200px', zIndex: 100 }}>
        {data.annotated_image_path ? (
          <img
            src={`${BASE_URL}/${data.annotated_image_path}`}
            style={{ width: '100%', borderRadius: '6px', marginBottom: '8px' }}
            alt={data.filename}
          />
        ) : (
          <div style={{ width: '100%', height: '100px', background: 'var(--border-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', marginBottom: '8px' }}>
            <ImageIcon size={24} color="var(--t-muted)" />
          </div>
        )}
        <div style={{ color: 'var(--t-primary)', fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>{data.filename}</div>
        <div style={{ color: 'var(--t-secondary)', fontSize: '11px', lineHeight: '1.4' }}>{data.caption?.substring(0, 80)}...</div>
        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {data.objects?.slice(0, 3).map((obj: string, i: number) => (
            <span key={i} className="chip theme-chip" style={{ fontSize: '9px', padding: '2px 5px' }}>{obj}</span>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const ImageAnalysisView = ({ imgResult, imgZipResult, imgTokens, imgDuration, imgModel }: Props) => {
  const [selectedClusterPoint, setSelectedClusterPoint] = useState<any | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

  const qaRef = useRef<HTMLDivElement>(null);
  const collectionQaRef = useRef<HTMLDivElement>(null);
  const [qaFile, setQaFile] = useState<File | null>(null);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaLoading, setQaLoading] = useState(false);
  const [qaAnswer, setQaAnswer] = useState<ImageQAResponse | null>(null);
  const [selectedImageForQA, setSelectedImageForQA] = useState<{ path: string, filename: string } | null>(null);
  const qaFileRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const [collectionQuestion, setCollectionQuestion] = useState('');
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionAnswer, setCollectionAnswer] = useState<ImageCollectionQAResponse | null>(null);

  const [vizMode, setVizMode] = useState<'semantic' | 'geographic'>('semantic');
  const [imageTab, setImageTab] = useState<'overview' | 'explorer' | 'intelligence'>('overview');
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  const zipClusterLabelMap = useMemo(() => {
    const map: Record<number, string> = {};
    imgZipResult?.result.cluster_summaries.forEach(s => { map[s.cluster_id] = s.description; });
    return map;
  }, [imgZipResult]);

  const singleClusterLabelMap = useMemo(() => {
    const map: Record<number, string> = {};
    imgResult?.clusters?.forEach(c => { map[c.cluster_id] = c.description; });
    return map;
  }, [imgResult]);

  const projectionClusterMap = useMemo(() => {
    const map: Record<string, number> = {};
    imgResult?.projection?.forEach(p => { map[p.filename] = p.cluster; });
    return map;
  }, [imgResult]);

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
      metadata: point.metadata,
      x: point.umap_x,
      y: point.umap_y,
    }))
    : imgResult
      ? imgResult.results.map(result => {
        const clusterId = projectionClusterMap[result.filename] ?? 0;
        const projectionPoint = imgResult.projection?.find(p => p.filename === result.filename);
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
          x: projectionPoint?.x,
          y: projectionPoint?.y,
        };
      })
      : [];

  const collectionPrompts = [
    "Summarize the main visual themes in this batch.",
    "Are there any safety concerns visible?",
    "Which images are the most industrial in nature?",
    "Show me images featuring equipment."
  ];

  const totalObjects = visualRecords.reduce((sum, r) => sum + r.object_count, 0);
  const averageObjectsPerImage = visualRecords.length ? totalObjects / visualRecords.length : 0;
  const topObjects = useMemo(() => {
    const counts: Record<string, number> = {};
    visualRecords.forEach(r => r.objects.forEach(o => { counts[o] = (counts[o] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [visualRecords]);

  const dominantCluster = useMemo(() => {
    if (imgZipResult) return [...imgZipResult.result.cluster_summaries].sort((a, b) => b.count - a.count)[0];
    if (imgResult && imgResult.clusters) return [...imgResult.clusters].sort((a, b) => b.count - a.count)[0];
    return null;
  }, [imgResult, imgZipResult]);

  const lowObjectCoverage = visualRecords.filter(r => r.object_count === 0).length;
  const coveragePercent = visualRecords.length ? Math.round(((visualRecords.length - lowObjectCoverage) / visualRecords.length) * 100) : 0;

  const toggleCompareSelection = (filename: string) => {
    setCompareSelection(prev => {
      if (prev.includes(filename)) return prev.filter(f => f !== filename);
      if (prev.length >= 2) {
        toast.error('You can only compare two images at a time.');
        return prev;
      }
      return [...prev, filename];
    });
  };

  const selectedCompareRecords = visualRecords.filter(r => compareSelection.includes(r.filename));
  const leftCompare = selectedCompareRecords[0];
  const rightCompare = selectedCompareRecords[1];

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
    ? `${leftCompare.filename} is grounded in ${leftCompare.cluster_description}, while ${rightCompare.filename} sits in ${rightCompare.cluster_description}. ${sharedObjects.length
        ? `They overlap on ${sharedObjects.join(', ')}.`
        : 'They do not share detected object labels.'
      } ${leftOnlyObjects.length
        ? `${leftCompare.filename} stands out with ${leftOnlyObjects.slice(0, 4).join(', ')}.`
        : ''
      } ${rightOnlyObjects.length
        ? `${rightCompare.filename} stands out with ${rightOnlyObjects.slice(0, 4).join(', ')}.`
        : ''
      }`.trim()
    : '';

  const handleImageQA = async () => {
    if ((!qaFile && !selectedImageForQA) || !qaQuestion.trim()) return;
    setQaLoading(true);
    try {
      if (selectedImageForQA) {
        const res = await askAboutExistingImage(selectedImageForQA.filename, qaQuestion);
        setQaAnswer(res);
      } else if (qaFile) {
        const formData = new FormData();
        formData.append('file', qaFile);
        formData.append('question', qaQuestion);
        const response = await fetch(`${BASE_URL}/team5/image-qa`, { method: 'POST', body: formData });
        const res = await response.json();
        setQaAnswer(res);
      }
    } catch (err) {
      toast.error('Failed to get answer from AI');
    } finally {
      setQaLoading(false);
    }
  };

  const handleImageSearch = async () => {
    if (!searchQuery.trim() || (!imgResult && !imgZipResult)) return;
    setSearchLoading(true);
    try {
      const paths = visualRecords.map(r => r.filename);
      const res = await searchImages(paths, searchQuery);
      setSearchResults(res);
      setShowSearchResults(true);
    } catch (err) {
      toast.error('Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleCollectionQA = async (query?: string) => {
    const q = query || collectionQuestion;
    if (!q.trim() || visualRecords.length === 0) return;
    setCollectionLoading(true);
    try {
      const paths = visualRecords.map(r => r.filename);
      const res = await askAboutImageCollection(paths, q);
      setCollectionAnswer(res);
    } catch (err) {
      toast.error('Collection analysis failed');
    } finally {
      setCollectionLoading(false);
    }
  };

  const openRecordByFilename = (filename: string) => {
    const rec = visualRecords.find(r => r.filename === filename);
    if (rec) setSelectedClusterPoint(rec);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Tabs Navigation ── */}
      <div className="tab-navigation" style={{ 
        display: 'flex', 
        gap: '8px', 
        padding: '6px', 
        background: 'var(--bg-elevated)', 
        borderRadius: '16px',
        border: '1px solid var(--border-mid)',
        width: 'fit-content',
        marginBottom: '10px'
      }}>
        {[
          { id: 'overview', label: 'Batch Overview', icon: <BarChart2 size={16} /> },
          { id: 'explorer', label: 'Gallery & Explorer', icon: <ImageIcon size={16} /> },
          { id: 'intelligence', label: 'AI Intelligence', icon: <Sparkles size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setImageTab(tab.id as any)}
            className={`tab-btn ${imageTab === tab.id ? 'active' : ''}`}
            style={{
              padding: '10px 18px',
              borderRadius: '12px',
              border: 'none',
              background: imageTab === tab.id ? '#fb8c36' : 'transparent',
              color: imageTab === tab.id ? '#fff' : 'var(--t-secondary)',
              cursor: 'pointer',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              fontSize: '13px'
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {imageTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {imgZipResult && (
            <div className="img-analysis-view">
              {/* Metrics Strip */}
              <div className="metrics-strip with-margin">
                {[
                  { icon: <Clock size={13} />, label: 'Processing time', value: `${imgDuration.toFixed(1)}s`, sub: 'ML pipeline' },
                  { icon: <ImageIcon size={13} />, label: 'Images processed', value: imgZipResult.processed_count.toString(), sub: 'from batch/ZIP' },
                  { icon: <Zap size={13} />, label: 'LLM tokens used', value: imgTokens.total.toLocaleString(), sub: `${imgTokens.input.toLocaleString()} in / ${imgTokens.output.toLocaleString()} out` },
                  { icon: <Cpu size={13} />, label: 'Model', value: imgModel.replace('llama-3.1-70b-versatile', 'Llama 3.1 70B') || 'Llama 3.1 70B', sub: 'via Groq' },
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

              {/* Insights Grid */}
              <div className="result-card" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', marginBottom: '18px', flexWrap: 'wrap' }}>
                  <div>
                    <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Sparkles size={18} color="#fb8c36" /> Batch Summary Insights
                    </h4>
                    <p className="viz-desc" style={{ marginTop: '8px' }}>Collection-level takeaways from detections and clusters.</p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                  {[
                    { label: 'Dominant theme', value: dominantCluster?.description || 'Not enough data', sub: dominantCluster ? `${dominantCluster.count} images` : 'Waiting...' },
                    { label: 'Top detected objects', value: topObjects.length ? topObjects.slice(0, 3).map(([label]) => label).join(', ') : 'None', sub: topObjects.length ? `${topObjects[0][1]} occurrences` : 'No detections' },
                    { label: 'Detection coverage', value: `${coveragePercent}%`, sub: `${visualRecords.length - lowObjectCoverage} images with objects` },
                    { label: 'Object richness', value: `${averageObjectsPerImage.toFixed(1)} avg`, sub: `${totalObjects} total objects` },
                  ].map((insight, idx) => (
                    <div key={idx} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '14px', padding: '16px' }}>
                      <div style={{ color: 'var(--t-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>{insight.label}</div>
                      <div style={{ color: 'var(--t-primary)', fontSize: '16px', fontWeight: 700, lineHeight: 1.4 }}>{insight.value}</div>
                      <div style={{ color: 'var(--t-muted)', fontSize: '12px', marginTop: '8px' }}>{insight.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Visualization Row */}
              <div className="viz-row">
                <div className="scatter-box result-card" style={{ flex: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4>{vizMode === 'semantic' ? <><BarChart2 size={18} /> Semantic Analysis</> : <><MapPin size={18} /> Geospatial Dist.</>}</h4>
                    <div className="tab-pill-container" style={{ display: 'flex', background: 'var(--bg-root)', padding: '3px', borderRadius: '10px' }}>
                      <button onClick={() => setVizMode('semantic')} style={{ padding: '5px 12px', fontSize: '11px', border: 'none', background: vizMode === 'semantic' ? 'var(--bg-elevated)' : 'transparent', color: vizMode === 'semantic' ? '#fb8c36' : 'var(--t-secondary)', cursor: 'pointer' }}>Semantic</button>
                      <button onClick={() => setVizMode('geographic')} style={{ padding: '5px 12px', fontSize: '11px', border: 'none', background: vizMode === 'geographic' ? 'var(--bg-elevated)' : 'transparent', color: vizMode === 'geographic' ? '#fb8c36' : 'var(--t-secondary)', cursor: 'pointer' }}>Geographic</button>
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-root)', height: '400px', borderRadius: '16px', position: 'relative', overflow: 'hidden' }}>
                    {vizMode === 'semantic' ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                          <XAxis type="number" dataKey="x" hide />
                          <YAxis type="number" dataKey="y" hide />
                          <Tooltip content={<CustomTooltip />} />
                          <Scatter name="Images" data={visualRecords} onClick={(e) => openRecordByFilename(e.filename)}>
                            {visualRecords.map((entry, index) => <Cell key={index} fill={`var(--cluster-${entry.cluster % 5})`} />)}
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    ) : <GlobalCollectionMap records={visualRecords} onSelectRecord={openRecordByFilename} />}
                  </div>
                </div>
                <div className="clusters-box result-card" style={{ flex: 1 }}>
                  <h4 style={{ fontSize: '18px' }}>Cluster Insights</h4>
                  <div className="cluster-list">
                    {imgZipResult.result?.cluster_summaries?.map((c, idx) => (
                      <div key={idx} className="cluster-item">
                        <span className="cluster-dot" style={{ background: `var(--cluster-${c.cluster_id % 5})` }}></span>
                        <div>
                          <strong>{c.description}</strong>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                            {visualRecords.filter(r => r.cluster_id === c.cluster_id).slice(0, 1).map(r => r.objects.slice(0, 3).map((o, i) => (
                              <span key={i} className="chip theme-chip" style={{ fontSize: '9px' }}>{o}</span>
                            )))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {imageTab === 'explorer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="theme-heading"><Layers size={24} color="#f59e0b" /> Semantic Explorer</h3>
            {selectedCategory !== null && <button className="qa-send-btn" onClick={() => setSelectedCategory(null)} style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>Clear Filter</button>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
            {imgZipResult?.result?.cluster_summaries?.map((sum, i) => (
              <div key={i} className={`ai-intel-card ${selectedCategory === sum.cluster_id ? 'active-category' : ''}`} onClick={() => setSelectedCategory(sum.cluster_id)} style={{ cursor: 'pointer', border: selectedCategory === sum.cluster_id ? '2px solid #fb8c36' : '1px solid var(--border-mid)' }}>
                <div style={{ padding: '16px' }}>
                  <div style={{ background: `var(--cluster-${sum.cluster_id % 5})`, width: '32px', height: '32px', borderRadius: '8px', marginBottom: '12px' }} />
                  <h4 style={{ margin: 0, fontSize: '14px' }}>{sum.description}</h4>
                  <div style={{ fontSize: '11px', color: 'var(--t-muted)', marginTop: '8px' }}>{sum.count} items</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '24px', marginTop: '20px' }}>
            {visualRecords.filter(r => selectedCategory === null || r.cluster_id === selectedCategory).map((r, i) => (
              <div key={i} className="premium-gallery-card" onClick={() => setSelectedClusterPoint(r)}>
                <div style={{ height: '180px', overflow: 'hidden' }}>
                  {r.annotated_image_path ? (
                    <img src={`${BASE_URL}/${r.annotated_image_path}`} className="premium-gallery-img" />
                  ) : <div className="premium-gallery-img no-preview">No Preview</div>}
                </div>
                <div className="premium-gallery-info">
                  <span className="theme-heading" style={{ fontSize: '14px' }}>{r.filename}</span>
                  <div className="premium-gallery-meta">
                    <span className="theme-subtext"><Search size={12} /> {r.object_count} Labels</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="qa-send-btn" style={{ height: '26px', fontSize: '10px' }} onClick={(e) => { e.stopPropagation(); toggleCompareSelection(r.filename); }}>
                        {compareSelection.includes(r.filename) ? 'Selected' : 'Compare'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {imageTab === 'intelligence' && (
        <div className="ai-intelligence-section">
          <div className="ai-intel-grid">
            {/* Q&A Card */}
            <div className="ai-intel-card" ref={qaRef}>
              <div className="ai-intel-card-header">
                <div className="ai-intel-icon qa-icon"><MessageCircle size={20} /></div>
                <div><h4>Image-Specific Q&A</h4><p>Select from gallery or upload to ask details.</p></div>
              </div>
              <div className="ai-intel-body">
                {selectedImageForQA ? (
                  <div className="qa-upload-zone" style={{ borderColor: '#60a5fa', background: 'rgba(96,165,250,0.05)', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><ImageIcon size={18} color="#60a5fa" /><span>{selectedImageForQA.filename}</span></div>
                    <button onClick={() => setSelectedImageForQA(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}>Reset</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="qa-upload-zone" onClick={() => qaFileRef.current?.click()}>
                      <input type="file" ref={qaFileRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) setQaFile(f); }} style={{ display: 'none' }} />
                      <Upload size={18} /><span>{qaFile ? qaFile.name : 'Select or drop image'}</span>
                    </div>
                    {visualRecords.length > 0 && (
                      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '5px' }}>
                        {visualRecords.map(r => (
                          <div key={r.filename} onClick={() => { setSelectedImageForQA({ path: r.annotated_image_path || '', filename: r.filename }); setQaFile(null); }} style={{ minWidth: '60px', height: '60px', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', border: '2px solid transparent' }}>
                            <img src={`${BASE_URL}/${r.annotated_image_path}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="qa-input-row" style={{ marginTop: '15px' }}>
                  <input type="text" className="qa-question-input" placeholder="Ask AI..." value={qaQuestion} onChange={(e) => setQaQuestion(e.target.value)} />
                  <button className="qa-send-btn" onClick={handleImageQA}>{qaLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
                </div>
                {qaAnswer && <div className="qa-answer-box"><p>{qaAnswer.answer}</p></div>}
              </div>
            </div>

            {/* Smart Search Card */}
            <div className="ai-intel-card">
              <div className="ai-intel-card-header">
                <div className="ai-intel-icon search-icon"><Search size={20} /></div>
                <div><h4>Semantic Search</h4><p>Find images by natural description.</p></div>
              </div>
              <div className="ai-intel-body">
                <div className="qa-input-row">
                  <input type="text" className="qa-question-input" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                  <button className="qa-send-btn" onClick={handleImageSearch}>{searchLoading ? <Loader2 size={16} className="animate-spin" /> : <SearchCheck size={16} />}</button>
                </div>
                {showSearchResults && <div className="search-results-list" style={{ marginTop: '15px' }}>
                  {searchResults.map((sr, i) => (
                    <div key={i} className="search-result-item" onClick={() => openRecordByFilename(sr.filename)}>
                      <strong>{sr.filename}</strong><p style={{ fontSize: '11px' }}>{sr.reason}</p>
                    </div>
                  ))}
                </div>}
              </div>
            </div>

            {/* Collection Q&A */}
            <div className="ai-intel-card" style={{ gridColumn: '1 / -1' }}>
              <div className="ai-intel-card-header">
                <div className="ai-intel-icon qa-icon"><Sparkles size={20} /></div>
                <div><h4>Batch Intelligence</h4><p>Inquire about the entire dataset.</p></div>
              </div>
              <div className="ai-intel-body">
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '15px' }}>
                  {collectionPrompts.map(p => <button key={p} className="qa-send-btn" style={{ width: 'auto', padding: '0 12px', fontSize: '11px' }} onClick={() => handleCollectionQA(p)}>{p}</button>)}
                </div>
                <div className="qa-input-row">
                  <input type="text" className="qa-question-input" placeholder="Analyze batch..." value={collectionQuestion} onChange={(e) => setCollectionQuestion(e.target.value)} />
                  <button className="qa-send-btn" onClick={() => handleCollectionQA()}>{collectionLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
                </div>
                {collectionAnswer && <div className="qa-answer-box"><p>{collectionAnswer.answer}</p></div>}
              </div>
            </div>
          </div>
          
          {/* Comparison Panel */}
          {selectedCompareRecords.length === 2 && (
            <div className="result-card" style={{ marginTop: '30px' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><ArrowRight size={18} color="#60a5fa" /> Comparison Analysis</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
                {selectedCompareRecords.map(r => (
                  <div key={r.filename} style={{ background: 'var(--bg-root)', padding: '15px', borderRadius: '12px' }}>
                    <img src={`${BASE_URL}/${r.annotated_image_path}`} style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '8px' }} />
                    <h5 style={{ marginTop: '10px' }}>{r.filename}</h5>
                    <p style={{ fontSize: '12px' }}>{r.caption}</p>
                  </div>
                ))}
              </div>
              <div className="qa-answer-box" style={{ marginTop: '20px' }}><p>{compareNarrative}</p></div>
            </div>
          )}
        </div>
      )}

      {selectedClusterPoint && <ImageMetadataPanel record={visualRecords.find(r => r.filename === selectedClusterPoint.filename) || selectedClusterPoint} onClose={() => setSelectedClusterPoint(null)} />}
    </div>
  );
};

export default ImageAnalysisView;
