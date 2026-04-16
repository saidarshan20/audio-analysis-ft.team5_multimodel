import { useState, useRef, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import {
  ArrowLeft, BarChart2, Database, Upload, Search, Loader2, FileText, Code2,
  Sparkles, Image as ImageIcon, FileSpreadsheet, Music, Video, ArrowRight,
  Activity, Clock, Zap, Cpu, Network, MessageCircle, SearchCheck, Send, Layers,
  Play, Pause, Hash, MapPin
} from 'lucide-react';
import { toast } from 'sonner';
import '../ToolPage.css';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
import {
  analyzeTextFile,
  analyzeCodebase,
  analyzeGithubRepo,
  analyzeImagesBatch,
  askAboutImage,
  askAboutImageCollection,
  askAboutExistingImage,
  searchImages,
  analyzeAudio,
  analyzeVideo,
  fetchDatasets,
  GroundedImageRecord,
  DatasetEntry,
  TextAnalysisResult,
  CodeAnalysisResult,
  MultiImageAnalysisResponse,
  ImageZipAnalysisResponse,
  ImageCollectionQAResponse,
  ImageQAResponse,
  ImageSearchResult,
  AudioAnalysisResponse,
  VideoAnalysisResult,
} from './services';
import MermaidDiagram from "../../../../components/MermaidDiagram";

type HistoryItem = {
  id: string;
  type: FileType | 'github';
  label: string;
  timestamp: number;
  data: TextAnalysisResult | CodeAnalysisResult | MultiImageAnalysisResponse;
};

type ZipClusterPoint = ImageZipAnalysisResponse['result']['clusters'][number];

type VisualRecord = GroundedImageRecord & {
  annotated_image_path?: string | null;
  cluster_id: number;
  object_count: number;
  object_details: Array<{ label: string; confidence: number; bbox?: number[] }>;
};

// ── Mermaid compiler (gitdiagram-style) ──────────────────────────────────────

const MID_PREFIX = 'nd_';
const safeId = (id: string) => MID_PREFIX + id.replace(/[^a-zA-Z0-9]/g, '_');

// 6-tone dark-theme palette cycling by group
const GROUP_TONES = ['toneBlue', 'toneAmber', 'toneMint', 'toneRose', 'toneIndigo', 'toneTeal'];

const SHAPE_DELIMITERS: Record<string, [string, string]> = {
  database: ['[("', '")]'],
  circle: ['(("', '"))'],
  hexagon: ['{{\"', '"}}'],
  queue: ['[/"', '"/]'],
  document: ['["', '"]'],
  box: ['["', '"]'],
};

function mermaidNode(n: any, indent: string): string {
  const id = safeId(n.id);
  const label = (n.label ?? '').replace(/"/g, "'");
  const typeHint = n.type && n.type !== n.label ? `<br/><small>${n.type.replace(/"/g, "'")}</small>` : '';
  const [s, e] = SHAPE_DELIMITERS[n.shape] ?? SHAPE_DELIMITERS.box;
  return `${indent}${id}${s}${label}${typeHint}${e}\n`;
}

const generateMermaidGraph = (arch: any): string => {
  if (!arch) return '';
  const nodes: any[] = arch.nodes ?? [];
  const groups: any[] = arch.groups ?? [];
  const edges: any[] = arch.edges ?? [];
  if (nodes.length === 0) return '';

  // group → tone class
  const groupTone: Record<string, string> = {};
  groups.forEach((g, i) => { groupTone[g.id] = GROUP_TONES[i % GROUP_TONES.length]; });

  // bucket nodes by group
  const byGroup: Record<string, any[]> = {};
  const ungrouped: any[] = [];
  nodes.forEach(n => {
    if (n.group_id && groups.find(g => g.id === n.group_id)) {
      (byGroup[n.group_id] ??= []).push(n);
    } else {
      ungrouped.push(n);
    }
  });

  let chart = 'flowchart TD\n';

  // subgraphs for groups
  groups.forEach(g => {
    const members = byGroup[g.id] ?? [];
    if (members.length === 0) return;
    const sgId = safeId(g.id);
    chart += `  subgraph ${sgId} ["${g.label.replace(/"/g, "'")}"]\n`;
    members.forEach(n => { chart += mermaidNode(n, '    '); });
    chart += `  end\n`;
  });

  // ungrouped nodes
  ungrouped.forEach(n => { chart += mermaidNode(n, '  '); });

  // edges
  edges.forEach(e => {
    const src = safeId(e.source);
    const tgt = safeId(e.target);
    const lbl = e.label ? `|"${(e.label ?? '').replace(/"/g, "'")}"| ` : '';
    const arrow = e.style === 'dashed' ? '-.->' : '-->';
    chart += `  ${src} ${arrow}${lbl}${tgt}\n`;
  });

  // class definitions (dark-theme palette)
  chart += `
  classDef toneBlue   fill:#1e3a5f,stroke:#3b82f6,color:#bfdbfe,stroke-width:2px
  classDef toneAmber  fill:#451a03,stroke:#f59e0b,color:#fde68a,stroke-width:2px
  classDef toneMint   fill:#064e3b,stroke:#10b981,color:#a7f3d0,stroke-width:2px
  classDef toneRose   fill:#4c0519,stroke:#f43f5e,color:#fecdd3,stroke-width:2px
  classDef toneIndigo fill:#1e1b4b,stroke:#6366f1,color:#c7d2fe,stroke-width:2px
  classDef toneTeal   fill:#042f2e,stroke:#14b8a6,color:#99f6e4,stroke-width:2px
  classDef toneGray   fill:#1e293b,stroke:#64748b,color:#cbd5e1,stroke-width:2px
  classDef default    fill:#1e293b,stroke:#fb8c36,color:#f8fafc,stroke-width:2px\n`;

  // apply tones to nodes
  nodes.forEach(n => {
    const tone = n.group_id && groupTone[n.group_id] ? groupTone[n.group_id] : 'toneGray';
    chart += `  class ${safeId(n.id)} ${tone}\n`;
  });

  // style subgraphs
  groups.forEach(g => {
    chart += `  style ${safeId(g.id)} fill:#0a0f1a,stroke:#334155,stroke-dasharray:5 5,color:#94a3b8\n`;
  });

  return chart;
};

type DatasetTab = 'catalog' | 'upload';
type FileType = 'csv' | 'text' | 'pdf' | 'images' | 'images-zip' | 'videos' | 'music' | 'code';

const FILE_TYPES: { id: FileType; label: string; desc: string; icon: any }[] = [
  { id: 'csv', label: 'CSV Data', desc: 'Tabular data & spreadsheets', icon: FileSpreadsheet },
  { id: 'text', label: 'Text File', desc: 'Plain text & documents', icon: FileText },
  { id: 'pdf', label: 'PDF Doc', desc: 'PDF reports & exports', icon: Search },
  { id: 'images-zip', label: 'Visual Intelligence', desc: 'Single image, Batch, or ZIP', icon: ImageIcon },
  { id: 'code', label: 'Codebase', desc: 'ZIP repo analysis', icon: Code2 },
  { id: 'videos', label: 'Videos', desc: 'Video streams & files', icon: Video },
  { id: 'music', label: 'Audio', desc: 'Voice & sound analysis', icon: Music },
];


const DataVizPage = ({ onBack }: { onBack: () => void }) => {
  const [activeTab, setActiveTab] = useState<DatasetTab>('catalog');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // -- Wizard State --
  const [fileType, setFileType] = useState<FileType>('images-zip');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [githubUrl, setGithubUrl] = useState('');

  // -- Analysis State --
  const [loading, setLoading] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [textResult, setTextResult] = useState<TextAnalysisResult | null>(null);
  const [codeResult, setCodeResult] = useState<CodeAnalysisResult | null>(null);
  const [chatMsgs, setChatMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const qaRef = useRef<HTMLDivElement>(null);
  const collectionQaRef = useRef<HTMLDivElement>(null);
  const [imgResult, setImgResult] = useState<MultiImageAnalysisResponse | null>(null);
  const [imgZipResult, setImgZipResult] = useState<ImageZipAnalysisResponse | null>(null);
  const [imgTokens, setImgTokens] = useState({ input: 0, output: 0, total: 0 });
  const [imgDuration, setImgDuration] = useState(0);
  const [imgModel, setImgModel] = useState('');
  const [selectedClusterPoint, setSelectedClusterPoint] = useState<any | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('kosh_analysis_history');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse history", e);
        return [];
      }
    }
    return [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── NEW: Image Q&A State ──
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

  // ── Audio State ──
  const [audioResult, setAudioResult] = useState<AudioAnalysisResponse | null>(null);

  // ── Catalog State ──
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [datasetsTotal, setDatasetsTotal] = useState(0);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsOffset, setDatasetsOffset] = useState(0);

  const loadDatasets = async (query: string, offset: number) => {
    setDatasetsLoading(true);
    try {
      const page = await fetchDatasets(query, offset, 20);
      setDatasetsTotal(page.total);
      setDatasets(prev => offset === 0 ? page.results : [...prev, ...page.results]);
      setDatasetsOffset(offset);
    } catch {
      // silently keep existing results
    } finally {
      setDatasetsLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => loadDatasets(search, 0), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (activeTab === 'catalog' && datasets.length === 0) {
      loadDatasets('', 0);
    }
  }, [activeTab]);

  // ── Video State ──
  const [videoResult, setVideoResult] = useState<VideoAnalysisResult | null>(null);
  const [expandedVidObject, setExpandedVidObject] = useState<string | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<{ second: number; box: number[] } | null>(null);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [videoTab, setVideoTab] = useState<'video' | 'audio' | 'text'>('video');
  const videoRef = useRef<HTMLVideoElement>(null);

  // Create VTT subtitle object URL when result arrives
  useEffect(() => {
    if (videoResult?.transcript?.vtt_content) {
      const blob = new Blob([videoResult.transcript.vtt_content], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);
      setSubtitleUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setSubtitleUrl(null);
  }, [videoResult]);

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

  const saveToHistory = (type: HistoryItem['type'], data: any, label: string) => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      type,
      label,
      timestamp: Date.now(),
      data
    };
    const updated = [newItem, ...history].slice(0, 10); // Keep last 10
    setHistory(updated);
    localStorage.setItem('kosh_analysis_history', JSON.stringify(updated));
  };

  const loadHistoryItem = (item: HistoryItem) => {
    // Clear current results
    setTextResult(null);
    setCodeResult(null);
    setChatMsgs([]); setChatInput('');
    setImgResult(null);
    setImgZipResult(null);
    setCollectionAnswer(null);
    setCollectionQuestion('');
    setCompareSelection([]);
    setSearchResults([]);
    setShowSearchResults(false);

    // Filter type to restorer
    if (item.type === 'code' || item.type === 'github') {
      setCodeResult(item.data as CodeAnalysisResult);
    } else if (item.type === 'images') {
      setImgResult(item.data as MultiImageAnalysisResponse);
    } else {
      setTextResult(item.data as TextAnalysisResult);
    }
    setShowHistory(false);
    toast.success(`Restored analysis: ${item.label}`);
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    localStorage.setItem('kosh_analysis_history', JSON.stringify(updated));
  };

  const handleDownloadResult = () => {
    const activeData = textResult || codeResult || imgResult;
    if (!activeData) return;

    const blob = new Blob([JSON.stringify(activeData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kosh_analysis_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Analysis results exported as JSON");
  };

  // -- Mock Data for Samples --
  const MOCK_IMG_RESULT: MultiImageAnalysisResponse = {
    results: [
      { filename: 'scenic_view.jpg', caption: 'A beautiful mountain range with a clear blue lake at sunset.', detections: [{ x1: 0, y1: 0, x2: 10, y2: 10, label: 'Mountain', confidence: 0.98 }] },
      { filename: 'city_street.jpg', caption: 'Busy city intersection with yellow taxis and tall skyscrapers.', detections: [{ x1: 0, y1: 0, x2: 10, y2: 10, label: 'Car', confidence: 0.95 }] },
      { filename: 'tech_office.jpg', caption: 'A modern open-plan office with developers working on multiple monitors.', detections: [{ x1: 0, y1: 0, x2: 10, y2: 10, label: 'Person', confidence: 0.92 }] },
    ],
    projection: [
      { x: -2, y: 3, cluster: 0, filename: 'scenic_view.jpg' },
      { x: 4, y: -1, cluster: 1, filename: 'city_street.jpg' },
      { x: 3.5, y: -2, cluster: 1, filename: 'tech_office.jpg' },
    ],
    clusters: [
      { cluster_id: 0, description: 'Nature & Landscapes', count: 1 },
      { cluster_id: 1, description: 'Urban & Technology', count: 2 },
    ]
  };

  const MOCK_TEXT_RESULT: TextAnalysisResult = {
    summary: "The AI Kosh project aims to build a state-of-the-art multimodal analysis platform. This document outlines the core architecture, including the integration of YOLO for vision and transformer models for text summarization. Key focus areas are real-time processing and modular scalability.",
    sentiment: { positive: 0.8, negative: 0.05, neutral: 0.15, overall_label: 'Positive' },
    entities: [],
    kg_nodes: [],
    kg_edges: [],
    timeline: [
      { date: '2026-01-01', description: 'Project Kickoff' },
      { date: '2026-03-15', description: 'Core Engine V1 Alpha' },
    ],
    locations: []
  };

  const MOCK_CODE_RESULT: CodeAnalysisResult = {
    filename: 'sample_ecommerce.zip',
    file_count: 42,
    architecture: {
      title: 'E-commerce Microservices Platform',
      summary: 'A distributed system built with Node.js microservices and a React storefront. Services communicate via REST APIs with JWT-based authentication. Uses PostgreSQL for persistence and Redis for session caching.',
      tech_stack: ['Node.js', 'React', 'PostgreSQL', 'Redis', 'Docker'],
      detected_patterns: ['Microservices', 'RESTful API', 'JWT Authentication', 'Repository Pattern'],
      groups: [
        { id: 'frontend', label: 'Frontend' },
        { id: 'api', label: 'API Services' },
        { id: 'data', label: 'Data Layer' },
      ],
      nodes: [
        { id: 'storefront', label: 'Web Storefront', type: 'React SPA', description: 'Responsive React-based user interface with cart and checkout.', group_id: 'frontend', path: 'store/App.jsx', shape: 'box' },
        { id: 'auth-svc', label: 'Auth Service', type: 'Node.js service', description: 'Handles user login, JWT issuance and verification.', group_id: 'api', path: 'auth/src/index.js', shape: 'box' },
        { id: 'catalog-svc', label: 'Catalog Service', type: 'Node.js service', description: 'Manages product listings and inventory via REST.', group_id: 'api', path: 'catalog/routes.js', shape: 'box' },
        { id: 'order-svc', label: 'Order Service', type: 'Node.js service', description: 'Processes orders and triggers payment flow.', group_id: 'api', shape: 'box' },
        { id: 'postgres', label: 'PostgreSQL', type: 'Relational DB', description: 'Primary persistent store for users, products, orders.', group_id: 'data', shape: 'database' },
        { id: 'redis', label: 'Redis Cache', type: 'In-memory store', description: 'Session cache and rate limiting.', group_id: 'data', shape: 'database' },
        { id: 'stripe-api', label: 'Stripe API', type: 'External payment API', description: 'Processes card payments and refunds.', group_id: '', shape: 'hexagon' },
      ],
      edges: [
        { source: 'storefront', target: 'auth-svc', label: 'login / token', style: 'solid' },
        { source: 'storefront', target: 'catalog-svc', label: 'browse products', style: 'solid' },
        { source: 'storefront', target: 'order-svc', label: 'place order', style: 'solid' },
        { source: 'auth-svc', target: 'redis', label: 'session cache', style: 'solid' },
        { source: 'auth-svc', target: 'postgres', label: 'user lookup', style: 'solid' },
        { source: 'catalog-svc', target: 'postgres', label: 'SQL query', style: 'solid' },
        { source: 'order-svc', target: 'postgres', label: 'write order', style: 'solid' },
        { source: 'order-svc', target: 'stripe-api', label: 'charge card', style: 'dashed' },
      ],
    },
    details: {
      key_files: [
        { file_path: 'auth/src/index.js', component: 'Auth Service', summary: 'Entry point for JWT auth middleware. Exposes /login and /verify routes.', key_functions: ['verifyToken: validates JWT signature and expiry', 'login: validates credentials and issues signed JWT'] },
        { file_path: 'catalog/routes.js', component: 'Catalog Service', summary: 'Defines REST endpoints for product queries and inventory management.', key_functions: ['listProducts: paginated product listing with filters', 'getProduct: single product fetch with inventory check'] }
      ],
      flow: [
        { step: 1, description: 'Browser loads Web Storefront (React SPA via CDN).' },
        { step: 2, description: 'User submits credentials → POST /login → Auth Service → validates against PostgreSQL → returns signed JWT.' },
        { step: 3, description: 'Storefront stores JWT in memory, attaches as Authorization header on subsequent API calls.' },
        { step: 4, description: 'Browse products → GET /products → Catalog Service → SQL query PostgreSQL → paginated JSON response.' },
        { step: 5, description: 'Checkout → POST /orders → Order Service → writes order to PostgreSQL → calls Stripe API async → returns order ID.' }
      ],
      tech_debt: [
        'auth/src/jwt.js: JWT secret loaded from process.env without validation — app silently uses empty string if unset.',
        'catalog/routes.js: listProducts lacks pagination — full table scan on large datasets.',
        'No inter-service authentication — any internal service can call any other without credentials.'
      ],
      security_risks: [
        'catalog/routes.js: search query built with string interpolation — SQL injection vector.',
        'auth/src/index.js: JWT tokens never blacklisted on logout — stolen tokens remain valid until expiry.'
      ],
      recommendations: [
        'Add input validation with Joi or Zod on all API routes before business logic.',
        'Implement token blacklist (Redis set) on logout to invalidate stolen tokens.',
        'Add inter-service mTLS or shared secret headers to prevent unauthorized internal calls.'
      ]
    }
  };


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
    if (!chatInput.trim() || !codeResult || chatLoading) return;
    const question = chatInput.trim();
    const userMsg = { role: 'user' as const, content: question };
    setChatMsgs(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    try {
      const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
      const res = await fetch(`${BASE}/team5/code-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          context: buildCodeContext(codeResult),
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

  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
      toast.success(`${files.length} file(s) selected`);
    }
  };

  const handleUseSample = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      if (fileType === 'code') {
        setCodeResult(MOCK_CODE_RESULT);
        saveToHistory('code', MOCK_CODE_RESULT, 'Sample: Codebase');
        toast.success("Loaded Codebase Sample");
      } else if (['csv', 'text', 'pdf'].includes(fileType)) {
        setTextResult(MOCK_TEXT_RESULT);
        saveToHistory(fileType as any, MOCK_TEXT_RESULT, `Sample: ${fileType.toUpperCase()}`);
        toast.success(`Loaded ${fileType.toUpperCase()} Sample`);
      } else {
        toast.info(`Sample for ${fileType} coming soon!`);
      }
    }, 800);
  };

  const handleContinue = async () => {
    const usingGithub = fileType === 'code' && githubUrl.trim().length > 5;

    if (selectedFiles.length === 0 && !usingGithub) {
      toast.error("Please select a file or provide a valid GitHub URL");
      return;
    }

    setLoading(true);
    setAnalysisStep('init');
    setProgressMsg('Initializing analysis pipeline...');
    setTextResult(null);
    setCodeResult(null);
    setChatMsgs([]); setChatInput('');
    setImgResult(null);
    setImgZipResult(null);
    setImgTokens({ input: 0, output: 0, total: 0 });
    setImgDuration(0);
    setImgModel('');
    setSelectedClusterPoint(null);
    setSelectedCategory(null);
    setCollectionAnswer(null);
    setCollectionQuestion('');
    setCompareSelection([]);
    setSearchResults([]);
    setShowSearchResults(false);
    setQaAnswer(null);

    const onProgress = (step: string, msg: string) => {
      setAnalysisStep(step);
      setProgressMsg(msg);
      toast.loading(msg, { id: 'analysis' });
    };

    // 1) Github Fast-Path
    if (usingGithub) {
      try {
        const res = await analyzeGithubRepo(githubUrl, onProgress);
        setCodeResult(res);
        saveToHistory('github', res, `Repo: ${githubUrl.split('/').pop()}`);
        toast.success('GitHub analysis complete!', { id: 'analysis' });
      } catch (err: any) {
        toast.error(err.message || 'GitHub Analysis failed', { id: 'analysis' });
      } finally {
        setLoading(false);
        setAnalysisStep('');
      }
      return;
    }

    // 2) Standard File Processing
    const files = selectedFiles;
    const isZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');
    const isDoc = files.length === 1 && (files[0].name.toLowerCase().endsWith('.pdf') || files[0].name.toLowerCase().endsWith('.txt'));

    try {
      if (fileType === 'code' && isZip) {
        toast.loading('Analyzing codebase architecture...', { id: 'analysis' });
        const res = await analyzeCodebase(files[0], onProgress);
        setCodeResult(res);
        saveToHistory('code', res, files[0].name);
        toast.success('Code analysis complete!', { id: 'analysis' });
      } else if (isDoc) {
        toast.loading('Extracting insights from document...', { id: 'analysis' });
        const res = await analyzeTextFile(files[0]);
        setTextResult(res);
        saveToHistory(fileType as any, res, files[0].name);
        toast.success('Document analysis complete!', { id: 'analysis' });
      } else if (fileType === 'images-zip' && (isZip || files.every(f => f.type.startsWith('image/')))) {
        toast.loading(`Processing Visual Intel Batch...`, { id: 'analysis' });
        const res = await analyzeImagesBatch(files);
        setImgZipResult(res);

        // --- Store Performance Metrics ---
        if (res.result?.metadata) {
          setImgDuration(res.result.metadata.total_duration_sec);
          setImgTokens({
            input: res.result.metadata.input_tokens,
            output: res.result.metadata.output_tokens,
            total: res.result.metadata.total_tokens
          });
          setImgModel(res.result.metadata.model);
        }

        toast.success(`Analysis complete! Processed ${res.processed_count} images.`, { id: 'analysis' });
      } else if (fileType === 'music') {
        toast.loading('Transcribing & analyzing audio...', { id: 'analysis' });
        const res = await analyzeAudio(files[0]);
        setAudioResult(res);
        toast.success('Audio analysis complete!', { id: 'analysis' });
      } else if (fileType === 'videos') {
        toast.loading('Running video analysis (YOLO + BLIP + CLIP)...', { id: 'analysis' });
        const res = await analyzeVideo(files[0]);
        setVideoResult(res);
        toast.success('Video analysis complete!', { id: 'analysis' });
      } else {
        toast.error('Unsupported file combo.', { id: 'analysis' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Analysis failed', { id: 'analysis' });
    } finally {
      setLoading(false);
      setAnalysisStep('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="xt-page">
      <button className="xt-back-btn" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Data Tools
      </button>

      {/* Header */}
      <div className="xt-dataviz-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', position: 'relative', zIndex: 1 }}>
          <div className="xt-header-icon" style={{ width: '64px', height: '64px', borderRadius: '18px' }}>
            <BarChart2 size={32} />
          </div>
          <div>
            <h1 className="xt-header-title" style={{ fontSize: '32px' }}>Data Visualization & Analysis</h1>
            <p className="xt-header-subtitle" style={{ fontSize: '16px' }}>Analyze Documents or Codebases with Multi-modal AI</p>
          </div>
        </div>
      </div>

      {/* Dataset selection panel */}
      <div className="xt-panel">
        <div className="xt-tabs">
          <button
            className={`xt-tab${activeTab === 'catalog' ? ' active' : ''}`}
            onClick={() => setActiveTab('catalog')}
          >
            <Database size={15} /> Data Catalog
          </button>
          <button
            className={`xt-tab${activeTab === 'upload' ? ' active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            <Upload size={15} /> AI Analysis (Upload)
          </button>
        </div>

        {activeTab === 'catalog' && (
          <div className="view-animate-in">
            <h2 className="xt-panel-title">Explore Dataset Catalog</h2>
            <div className="xt-search-wrap">
              <Search size={15} className="xt-search-icon" />
              <input
                className="xt-search-input"
                placeholder="Search datasets by name, description, or tags..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <p className="xt-count">
              {datasetsLoading && datasets.length === 0
                ? 'Loading datasets…'
                : `Found ${datasetsTotal.toLocaleString()} datasets`}
            </p>
            <div className="xt-dataset-list">
              {datasetsLoading && datasets.length === 0
                ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="xt-dataset-row" style={{ opacity: 0.4, pointerEvents: 'none' }}>
                    <div className="xt-dataset-info">
                      <span className="xt-dataset-name" style={{ background: 'var(--border-bright)', borderRadius: 4, color: 'transparent', userSelect: 'none' }}>Loading dataset title placeholder</span>
                      <span className="xt-dataset-desc" style={{ background: 'var(--border-mid)', borderRadius: 4, color: 'transparent', userSelect: 'none' }}>Loading description text here…</span>
                    </div>
                    <span className="xt-dataset-badge" style={{ background: 'var(--border-bright)', color: 'transparent' }}>Category</span>
                  </div>
                ))
                : datasets.map((d, i) => (
                  <div
                    key={`${d.name}-${i}`}
                    className={`xt-dataset-row${selected === d.name ? ' selected' : ''}`}
                    onClick={() => setSelected(d.name)}
                  >
                    <div className="xt-dataset-info">
                      <span className="xt-dataset-name">{d.name}</span>
                      <span className="xt-dataset-desc">{d.desc}</span>
                    </div>
                    <span className="xt-dataset-badge">{d.category}</span>
                  </div>
                ))}
            </div>
            {datasets.length > 0 && datasets.length < datasetsTotal && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                <button
                  className="xt-tab"
                  style={{ background: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.2)', padding: '8px 24px', cursor: datasetsLoading ? 'not-allowed' : 'pointer', opacity: datasetsLoading ? 0.6 : 1 }}
                  onClick={() => !datasetsLoading && loadDatasets(search, datasetsOffset + 20)}
                  disabled={datasetsLoading}
                >
                  {datasetsLoading ? 'Loading…' : `Load More (${datasets.length} / ${datasetsTotal.toLocaleString()})`}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="view-animate-in" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div />
              {history.length > 0 && !textResult && !codeResult && !imgResult && !imgZipResult && (
                <button
                  className="xt-tab"
                  style={{ background: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.2)' }}
                  onClick={() => setShowHistory(!showHistory)}
                >
                  {showHistory ? 'Hide History' : `Past Analyses (${history.length})`}
                </button>
              )}
            </div>

            {showHistory && (
              <div className="history-panel glass-card" style={{ marginBottom: '20px', padding: '15px' }}>
                <h3 style={{ fontSize: '14px', marginBottom: '12px', color: '#fb8c36' }}>Local Analysis History</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {history.map(item => (
                    <div
                      key={item.id}
                      className="history-item"
                      onClick={() => loadHistoryItem(item)}
                      style={{
                        background: 'var(--border-mid)',
                        padding: '10px 15px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        border: '1px solid var(--border-bright)'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '13px' }}>{item.label}</div>
                        <div style={{ fontSize: '10px', color: 'var(--t-secondary)' }}>
                          {item.type.toUpperCase()} • {new Date(item.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={(e) => deleteHistoryItem(item.id, e)}
                        style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '5px' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!textResult && !codeResult && !imgResult && !imgZipResult && !audioResult && !videoResult ? (
              <div className="wizard-container" style={{ boxShadow: 'none', border: 'none', background: 'transparent', padding: '0px 0' }}>
                {/* Step 1: Type Selection */}
                <div className="wizard-header" style={{ textAlign: 'left', marginBottom: '24px' }}>
                  <h2 style={{ fontSize: '20px', fontWeight: 700 }}>1. Select Analysis Type</h2>
                  <p style={{ color: 'var(--t-secondary)' }}>Choose the format of the data you want to analyze with AI.</p>
                </div>
                <div className="type-grid">
                  {FILE_TYPES.map(type => (
                    <div
                      key={type.id}
                      className={`type-card${fileType === type.id ? ' active' : ''}`}
                      onClick={() => setFileType(type.id)}
                    >
                      <div className="icon-box">
                        <type.icon size={24} />
                      </div>
                      <span className="type-label">{type.label}</span>
                      <span className="type-desc">{type.desc}</span>
                    </div>
                  ))}
                </div>

                {/* Step 2: Action Area */}
                <div className="wizard-header" style={{ textAlign: 'left', marginBottom: '24px', marginTop: '40px' }}>
                  <h2 style={{ fontSize: '20px', fontWeight: 700 }}>2. Provide Dataset</h2>
                  <p style={{ color: 'var(--t-secondary)' }}>Upload your own files or use a curated sample for demonstration.</p>
                </div>

                <div className="action-grid" style={{ gridTemplateColumns: fileType === 'code' ? '1fr 1fr 200px' : '1fr 200px' }}>
                  <div
                    className={`action-area ${loading && selectedFiles.length > 0 ? 'active-loading' : ''}`}
                    onClick={() => !loading && fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={onFilesSelected}
                      style={{ display: 'none' }}
                      multiple={fileType !== 'music' && fileType !== 'videos'}
                      accept={
                        fileType === 'music'
                          ? '.mp3,.wav,.m4a,.ogg,.flac,audio/*'
                          : fileType === 'videos'
                            ? '.mp4,.mov,.avi,.mkv,.webm,video/*'
                            : '.txt,.pdf,.zip,image/*'
                      }
                    />
                    <div className="action-icon">
                      {loading && selectedFiles.length > 0 ? <Loader2 size={32} className="animate-spin" /> : <Upload size={32} />}
                    </div>
                    <div className="action-title">
                      {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) selected` : 'Upload local files'}
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--t-secondary)', marginTop: '4px' }}>
                      {fileType === 'music' ? 'Supports .mp3, .wav, .m4a, .ogg, .flac' : fileType === 'videos' ? 'Supports .mp4, .mov, .avi, .mkv' : 'Supports .zip, .txt, .pdf, images'}
                    </p>
                  </div>

                  {fileType === 'code' && (
                    <div
                      className={`action-area ${loading && githubUrl.trim().length > 5 ? 'active-loading' : ''}`}
                      style={{ cursor: 'default' }}
                    >
                      <div className="action-icon">
                        {loading && githubUrl.trim().length > 5 ? <Loader2 size={32} className="animate-spin" /> : <Code2 size={32} />}
                      </div>
                      <div className="action-title">GitHub Repository</div>
                      <input
                        type="url"
                        className="xt-search-input"
                        placeholder="https://github.com/..."
                        value={githubUrl}
                        onChange={(e) => setGithubUrl(e.target.value)}
                        style={{ width: '100%', height: '42px', fontSize: '13px' }}
                      />
                      <button
                        onClick={() => setGithubUrl('https://github.com/tiangolo/fastapi')}
                        style={{ marginTop: '12px', fontSize: '12px', color: '#fb8c36', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                      >
                        Try: tiangolo/fastapi
                      </button>
                    </div>
                  )}

                  <div className="action-area" style={{ cursor: 'default', justifyContent: 'center' }}>
                    <div className="action-icon">
                      <Database size={32} />
                    </div>
                    <div className="action-title">Quick Demo</div>
                    <button className="sample-file-btn" onClick={handleUseSample} disabled={loading} style={{ width: '100%', padding: '12px', marginTop: '8px' }}>
                      Use Sample
                    </button>
                  </div>
                </div>

                {/* Step 3: Footer */}
                <div className="wizard-footer" style={{ marginTop: '40px', flexDirection: 'column', alignItems: 'center' }}>
                  {loading && (fileType === 'code') && (
                    <div className="analysis-progress-simple" style={{ width: '100%', maxWidth: '550px', marginBottom: '32px' }}>
                      <div className="progress-steps" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', position: 'relative' }}>
                        {['Cloning', 'Graphing', 'Architecture', 'Analysis'].map((step, idx) => {
                          const steps = ['cloning', 'graphing', 'arch', 'details'];
                          const currentIdx = steps.indexOf(analysisStep);
                          const isActive = idx === currentIdx;
                          const isDone = idx < currentIdx;

                          return (
                            <div key={idx} style={{
                              color: isActive ? '#fb8c36' : isDone ? '#4ade80' : 'var(--t-muted)',
                              fontSize: '12px',
                              fontWeight: isActive ? 600 : 400,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '6px',
                              flex: 1,
                              transition: 'all 0.3s ease'
                            }}>
                              <div style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                border: `1.5px solid ${isActive ? '#fb8c36' : isDone ? '#4ade80' : 'var(--border-bright)'}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                background: isActive ? 'rgba(251, 140, 54, 0.05)' : 'transparent',
                              }}>
                                {isDone ? '✓' : isActive ? <Loader2 size={10} className="animate-spin" /> : idx + 1}
                              </div>
                              <span>{step}</span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="progress-bar-bg" style={{ height: '4px', background: 'var(--bg-root)', borderRadius: '2px', overflow: 'hidden', border: '1px solid var(--border-mid)' }}>
                        <div className="progress-bar-fill" style={{
                          height: '100%',
                          background: '#fb8c36',
                          width: analysisStep === 'cloning' || analysisStep === 'extracting' ? '15%' : analysisStep === 'graphing' ? '40%' : analysisStep === 'arch' ? '70%' : analysisStep === 'details' ? '90%' : '0%',
                          transition: 'width 0.8s'
                        }}></div>
                      </div>
                      <p style={{ fontSize: '11px', color: 'var(--t-muted)', marginTop: '10px', textAlign: 'center' }}>{progressMsg}</p>
                    </div>
                  )}

                  <button
                    className="continue-btn"
                    onClick={handleContinue}
                    disabled={loading || (selectedFiles.length === 0 && !(fileType === 'code' && githubUrl.trim().length > 5))}
                    style={{
                      maxWidth: '220px',
                      padding: '12px 24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      background: loading ? 'var(--border-mid)' : 'var(--brand-orange)',
                      opacity: loading ? 0.8 : 1,
                      boxShadow: loading ? 'none' : '0 4px 12px rgba(251, 140, 54, 0.2)'
                    }}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Analyzing...</span>
                      </>
                    ) : (
                      <>
                        <span>Run Analysis</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="analysis-results">
                <div className="results-header">
                  <h3>Analysis Results</h3>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      className="xt-tab"
                      style={{ background: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.2)' }}
                      onClick={handleDownloadResult}
                    >
                      Download JSON
                    </button>
                    <button className="xt-upload-btn" onClick={() => { setTextResult(null); setCodeResult(null); setChatMsgs([]); setChatInput(''); setImgResult(null); setImgZipResult(null); setImgTokens({ input: 0, output: 0, total: 0 }); setImgDuration(0); setImgModel(''); setAudioResult(null); setVideoResult(null); setExpandedVidObject(null); setActiveHighlight(null); setVideoTab('video'); setSelectedFiles([]); setShowHistory(false); setSelectedCategory(null); setSelectedClusterPoint(null); setCollectionAnswer(null); setCollectionQuestion(''); setCompareSelection([]); setSearchResults([]); setShowSearchResults(false); setQaAnswer(null); }}>
                      Analyze Another File
                    </button>
                  </div>
                </div>

                {/* Text Analysis Result */}
                {textResult && (
                  <div className="result-card">
                    <div className="summary-section">
                      <h4><Sparkles size={16} /> Summary</h4>
                      <p>{textResult.summary}</p>
                    </div>
                    <div className="stats-grid">
                      <div className="stat-pill positive">Positive: {(textResult.sentiment.positive * 100).toFixed(0)}%</div>
                      <div className="stat-pill negative">Negative: {(textResult.sentiment.negative * 100).toFixed(0)}%</div>
                      <div className="stat-pill neutral">Neutral: {(textResult.sentiment.neutral * 100).toFixed(0)}%</div>
                    </div>
                    {textResult.timeline && textResult.timeline.length > 0 && (
                      <div className="timeline-section">
                        <h4>Timeline</h4>
                        <div className="timeline-list">
                          {textResult.timeline.map((ev, i) => (
                            <div key={i} className="timeline-item">
                              <span className="date">{ev.date}</span>
                              <span className="desc">{ev.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Code Analysis Result */}
                {codeResult && (
                  <div className="code-analysis-view">
                    {/* ── Analysis run stats strip ── */}
                    <div className="metrics-strip">
                      {[
                        {
                          icon: <Clock size={13} />,
                          label: 'Analysis time',
                          value: `${(codeResult.metadata?.total_duration_sec || 0).toFixed(1)}s`,
                          sub: '3-pass pipeline',
                        },
                        {
                          icon: <FileText size={13} />,
                          label: 'Files scanned',
                          value: codeResult.file_count.toLocaleString(),
                          sub: `${codeResult.metadata?.nodes_count ?? 0} source files parsed`,
                        },
                        {
                          icon: <Network size={13} />,
                          label: 'Diagram',
                          value: `${codeResult.architecture?.nodes?.length ?? 0} nodes`,
                          sub: `${codeResult.architecture?.groups?.length ?? 0} groups · ${codeResult.architecture?.edges?.length ?? 0} edges`,
                        },
                        {
                          icon: <Zap size={13} />,
                          label: 'LLM tokens used',
                          value: (codeResult.metadata?.total_tokens ?? 0).toLocaleString(),
                          sub: `${(codeResult.metadata?.input_tokens ?? 0).toLocaleString()} in / ${(codeResult.metadata?.output_tokens ?? 0).toLocaleString()} out`,
                        },
                        {
                          icon: <Cpu size={13} />,
                          label: 'Model',
                          value: (codeResult.metadata?.arch_model ?? 'Groq Llama 3').replace('llama-3.3-70b-versatile', 'Llama 3.3 70B'),
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

                    {/* ── Architecture Map: full-width, zoomable, right after metrics ── */}
                    {(codeResult.architecture?.nodes?.length ?? 0) > 0 && (
                      <div className="result-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '20px 24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-mid)' }}>
                          <h4 style={{ margin: 0, color: '#fb8c36', fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Network size={18} /> System Architecture Map
                          </h4>
                          <span style={{ fontSize: 11, color: 'var(--t-muted)' }}>
                            {codeResult.architecture.groups?.length ?? 0} groups · {codeResult.architecture.nodes.length} nodes · {codeResult.architecture.edges?.length ?? 0} edges
                          </span>
                        </div>
                        <div style={{ height: 540, background: 'var(--bg-root)' }}>
                          <MermaidDiagram chart={generateMermaidGraph(codeResult.architecture)} />
                        </div>
                      </div>
                    )}

                    {/* ── Summary + Patterns + Tech stack | Process Flow ── */}
                    <div className="viz-row">
                      <div className="result-card" style={{ flex: 1 }}>
                        <div className="summary-section">
                          <h4><Code2 size={20} /> {codeResult.architecture?.title}</h4>
                          <p>{codeResult.architecture?.summary}</p>
                        </div>

                        {/* Tech stack chips */}
                        {(codeResult.architecture?.tech_stack?.length ?? 0) > 0 && (
                          <div style={{ marginTop: '16px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {codeResult.architecture.tech_stack.map((t, i) => (
                              <span key={i} className="chip" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', borderColor: 'rgba(99,102,241,0.3)', padding: '4px 10px', fontSize: '11px' }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        )}

                        {codeResult.architecture?.detected_patterns && codeResult.architecture.detected_patterns.length > 0 && (
                          <div style={{ marginTop: '16px' }}>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {codeResult.architecture.detected_patterns.map((p, i) => (
                                <span key={i} className="chip" style={{ background: 'rgba(251, 140, 54, 0.1)', color: '#fb8c36', borderColor: 'rgba(251, 140, 54, 0.3)', padding: '4px 10px', fontSize: '11px' }}>
                                  <Sparkles size={10} /> {p}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Node cards grouped by group */}
                        {(() => {
                          const nodes = codeResult.architecture?.nodes ?? [];
                          const groups = codeResult.architecture?.groups ?? [];
                          if (nodes.length === 0) return null;
                          const groupMap = Object.fromEntries(groups.map(g => [g.id, g.label]));
                          const TONE_COLORS: Record<string, string> = {
                            toneBlue: '#3b82f6', toneAmber: '#f59e0b', toneMint: '#10b981',
                            toneRose: '#f43f5e', toneIndigo: '#6366f1', toneTeal: '#14b8a6',
                          };
                          const groupColor = (gid: string) => {
                            const idx = groups.findIndex(g => g.id === gid);
                            return Object.values(TONE_COLORS)[idx % 6] ?? 'var(--t-muted)';
                          };
                          // group nodes by group_id
                          const sections: { label: string; color: string; nodes: any[] }[] = [];
                          groups.forEach(g => {
                            const members = nodes.filter(n => n.group_id === g.id);
                            if (members.length) sections.push({ label: g.label, color: groupColor(g.id), nodes: members });
                          });
                          const ungrouped = nodes.filter(n => !n.group_id || !groupMap[n.group_id]);
                          if (ungrouped.length) sections.push({ label: 'Other', color: 'var(--t-muted)', nodes: ungrouped });

                          return sections.map(sec => (
                            <div key={sec.label} style={{ marginTop: '24px' }}>
                              <h4 style={{ color: sec.color, fontSize: '13px', fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: sec.color, display: 'inline-block' }} />
                                {sec.label}
                              </h4>
                              <div className="components-grid">
                                {sec.nodes.map(n => (
                                  <div key={n.id} className="comp-item" style={{ borderColor: sec.color + '33' }}>
                                    <strong style={{ color: 'var(--t-primary)' }}>{n.label}</strong>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0 8px' }}>
                                      <span style={{ fontSize: '10px', color: 'var(--t-secondary)', fontWeight: 700 }}>{n.type}</span>
                                      {n.shape && n.shape !== 'box' && <span style={{ color: sec.color, fontSize: '10px', fontWeight: 700 }}>{n.shape}</span>}
                                    </div>
                                    <p style={{ color: 'var(--t-secondary)', fontSize: '12px', margin: 0 }}>{n.description}</p>
                                    {n.path && (
                                      <div style={{ marginTop: '10px' }}>
                                        <span className="chip" style={{ fontSize: '10px', padding: '2px 8px', color: sec.color, borderColor: sec.color + '44' }}>{n.path.split('/').pop()}</span>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ));
                        })()}

                      </div>

                      {/* Process Flow — alongside summary */}
                      <div className="result-card" style={{ width: '300px', flexShrink: 0 }}>
                        <h4 style={{ color: '#fb8c36', marginTop: 0, fontSize: '16px', fontWeight: 700 }}>Process Flow</h4>
                        <div className="timeline-list">
                          {codeResult.details?.flow?.map(f => (
                            <div key={f.step} className="timeline-item" style={{ border: 'none', background: 'transparent', paddingLeft: 0 }}>
                              <span className="date" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>Step {f.step}</span>
                              <span className="desc" style={{ display: 'block', marginTop: '4px', lineHeight: 1.5, color: 'var(--t-secondary)', fontSize: '12px' }}>{f.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ── Components full-width ── */}
                    {(codeResult.architecture?.nodes?.length ?? 0) > 0 && (() => {
                      const nodes = codeResult.architecture.nodes;
                      const groups = codeResult.architecture.groups ?? [];
                      const groupMap = Object.fromEntries(groups.map(g => [g.id, g.label]));
                      const TONE_COLORS: Record<string, string> = {
                        toneBlue: '#3b82f6', toneAmber: '#f59e0b', toneMint: '#10b981',
                        toneRose: '#f43f5e', toneIndigo: '#6366f1', toneTeal: '#14b8a6',
                      };
                      const groupColor = (gid: string) => Object.values(TONE_COLORS)[groups.findIndex(g => g.id === gid) % 6] ?? 'var(--t-muted)';
                      const sections: { label: string; color: string; nodes: any[] }[] = [];
                      groups.forEach(g => {
                        const members = nodes.filter(n => n.group_id === g.id);
                        if (members.length) sections.push({ label: g.label, color: groupColor(g.id), nodes: members });
                      });
                      const ungrouped = nodes.filter(n => !n.group_id || !groupMap[n.group_id]);
                      if (ungrouped.length) sections.push({ label: 'Other', color: 'var(--t-muted)', nodes: ungrouped });

                      return (
                        <div className="result-card">
                          <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '20px', fontSize: '16px', fontWeight: 700 }}>Architecture Components</h4>
                          {sections.map(sec => (
                            <div key={sec.label} style={{ marginBottom: '20px' }}>
                              <div style={{ fontSize: '11px', fontWeight: 700, color: sec.color, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: sec.color, display: 'inline-block' }} />
                                {sec.label}
                              </div>
                              <div className="components-grid">
                                {sec.nodes.map(n => (
                                  <div key={n.id} className="comp-item" style={{ borderColor: sec.color + '33' }}>
                                    <strong style={{ color: 'var(--t-primary)', fontSize: '13px' }}>{n.label}</strong>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 6px' }}>
                                      <span style={{ fontSize: '10px', color: 'var(--t-secondary)' }}>{n.type}</span>
                                      {n.shape && n.shape !== 'box' && <span style={{ color: sec.color, fontSize: '10px', fontWeight: 700 }}>{n.shape}</span>}
                                    </div>
                                    <p style={{ color: 'var(--t-secondary)', fontSize: '12px', margin: 0 }}>{n.description}</p>
                                    {n.path && <span className="chip" style={{ marginTop: 8, fontSize: '10px', padding: '2px 8px', color: sec.color, borderColor: sec.color + '44', display: 'inline-block' }}>{n.path.split('/').pop()}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* ── Data flows + Debt + Risks in one row ── */}
                    <div className="viz-row">
                      {(codeResult.architecture?.edges?.length ?? 0) > 0 && (
                        <div className="result-card" style={{ flex: 1 }}>
                          <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '14px', fontSize: '15px', fontWeight: 700 }}>Data Flows</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {codeResult.architecture.edges.map((e, idx) => {
                              const srcNode = codeResult.architecture.nodes.find(n => n.id === e.source);
                              const tgtNode = codeResult.architecture.nodes.find(n => n.id === e.target);
                              return (
                                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <span style={{ color: '#60a5fa', fontWeight: 600 }}>{srcNode?.label ?? e.source}</span>
                                  <ArrowRight size={11} color={e.style === 'dashed' ? 'var(--t-muted)' : '#fb8c36'} />
                                  <span style={{ color: '#4ade80', fontWeight: 600 }}>{tgtNode?.label ?? e.target}</span>
                                  {e.label && <span style={{ color: 'var(--t-muted)', fontStyle: 'italic', marginLeft: 'auto', fontSize: '10px' }}>{e.label}</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {codeResult.details?.tech_debt && codeResult.details.tech_debt.length > 0 && (
                        <div className="result-card" style={{ flex: 1, border: '1px solid rgba(244,114,182,0.3)' }}>
                          <h4 style={{ color: '#f472b6', marginTop: 0, fontSize: '15px', fontWeight: 700 }}>Technical Debt</h4>
                          <ul style={{ margin: '10px 0 0', paddingLeft: '18px', color: 'var(--t-secondary)', fontSize: '12px', lineHeight: 1.6 }}>
                            {codeResult.details.tech_debt.map((dt, i) => <li key={i}>{dt}</li>)}
                          </ul>
                        </div>
                      )}
                      {codeResult.details?.security_risks && codeResult.details.security_risks.length > 0 && (
                        <div className="result-card" style={{ flex: 1, border: '1px solid rgba(239,68,68,0.3)' }}>
                          <h4 style={{ color: '#f87171', marginTop: 0, fontSize: '15px', fontWeight: 700 }}>Security Risks</h4>
                          <ul style={{ margin: '10px 0 0', paddingLeft: '18px', color: 'var(--t-secondary)', fontSize: '12px', lineHeight: 1.6 }}>
                            {codeResult.details.security_risks.map((sr, i) => <li key={i}>{sr}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* ── Key files ── */}
                    {codeResult.details?.key_files && codeResult.details.key_files.length > 0 && (
                      <div className="result-card">
                        <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '20px', fontSize: '16px', fontWeight: 700 }}>Deep Analysis: Core Modules</h4>
                        <div className="key-files-grid">
                          {codeResult.details.key_files.map((kf, i) => (
                            <div key={i} className="key-file-card">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                <FileText size={14} color="#fb8c36" />
                                <div style={{ fontWeight: '700', color: 'var(--t-primary)', fontSize: '13px' }}>{kf.file_path}</div>
                              </div>
                              <p style={{ color: 'var(--t-secondary)', fontSize: '12px', marginBottom: '12px', lineHeight: 1.5 }}>{kf.summary}</p>
                              {kf.key_functions && kf.key_functions.length > 0 && (
                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                  <div style={{ fontSize: '10px', color: '#fb8c36', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '1px', fontWeight: 800 }}>Methods</div>
                                  <ul style={{ margin: 0, paddingLeft: '14px', color: 'var(--t-secondary)', fontSize: '11px', lineHeight: 1.5 }}>
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
                          <p style={{ color: 'var(--t-muted)', fontSize: '12px', margin: 0 }}>
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
                            color: 'var(--t-primary)',
                            lineHeight: 1.5,
                          }}>
                            {m.content}
                          </div>
                        ))}
                        {chatLoading && (
                          <div style={{ alignSelf: 'flex-start', color: 'var(--t-muted)', fontSize: '12px' }}>Thinking…</div>
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
                            borderRadius: '8px', padding: '8px 12px', color: 'var(--t-primary)', fontSize: '12px', outline: 'none',
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
                )}

                {/* Single Image Result */}
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

                {/* Audio Analysis Result */}
                {audioResult && (
                  <AudioResultView result={audioResult.result} file={selectedFiles[0]} />
                )}

                {/* Video Analysis Result */}
                {videoResult && (
                  <div className="video-analysis-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    {/* TABS Navigation */}
                    <div style={{ display: 'flex', gap: '10px', borderBottom: '1px solid var(--border-mid)', paddingBottom: '10px', marginBottom: '10px' }}>
                      <button onClick={() => setVideoTab('video')} style={{ padding: '8px 16px', background: videoTab === 'video' ? '#fb8c36' : 'transparent', color: videoTab === 'video' ? '#fff' : 'var(--t-secondary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🎬 Video Insights</button>
                      <button onClick={() => setVideoTab('audio')} style={{ padding: '8px 16px', background: videoTab === 'audio' ? '#22d3ee' : 'transparent', color: videoTab === 'audio' ? '#fff' : 'var(--t-secondary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🎵 Audio Analysis</button>
                      <button onClick={() => setVideoTab('text')} style={{ padding: '8px 16px', background: videoTab === 'text' ? '#4ade80' : 'transparent', color: videoTab === 'text' ? '#fff' : 'var(--t-secondary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📝 Text Analysis</button>
                    </div>

                    {/* VIDEO INSIGHTS TAB */}
                    <div style={{ display: videoTab === 'video' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
                      {/* Groq AI Summary */}
                      {videoResult.groq_summary && (
                        <div className="result-card" style={{ borderLeft: '4px solid #fb8c36' }}>
                          <h4 style={{ color: '#fb8c36', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>🚀 AI Video Summary (Groq LLM)</h4>
                          <p style={{ color: 'var(--t-primary)', fontSize: '14px', lineHeight: 1.6, margin: '10px 0 0' }}>{videoResult.groq_summary}</p>
                          {videoResult.sentiment_analysis && (
                            <div style={{ marginTop: '15px', padding: '12px', background: 'rgba(56,189,248,0.1)', borderLeft: '4px solid #38bdf8', borderRadius: '4px' }}>
                              <h5 style={{ margin: '0 0 5px 0', color: '#38bdf8', fontSize: '12px', textTransform: 'uppercase' }}>Video Sentiment</h5>
                              <p style={{ margin: 0, color: 'var(--t-primary)', fontSize: '13px' }}>{videoResult.sentiment_analysis.replace('Sentiment Analysis:', '')}</p>
                            </div>
                          )}
                          {videoResult.video_caption && (
                            <div style={{ marginTop: '15px', padding: '12px', background: 'rgba(96,165,250,0.1)', borderLeft: '4px solid #60a5fa', borderRadius: '4px' }}>
                              <h5 style={{ margin: '0 0 5px 0', color: '#60a5fa', fontSize: '12px', textTransform: 'uppercase' }}>BLIP Video Caption</h5>
                              <p style={{ margin: 0, color: 'var(--t-primary)', fontSize: '13px', fontStyle: 'italic' }}>"{videoResult.video_caption}"</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Video Player */}
                      <div className="result-card">
                        <h4 style={{ color: '#fb8c36', marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Video size={16} /> Object Detection Video (YOLOv8)
                        </h4>
                        <p className="viz-desc">Analyzed {videoResult.keyframes_analyzed || '?'} keyframes over {videoResult.duration_seconds || '?'}s duration.</p>
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
                              <source src={videoResult.video_url ? `${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}${videoResult.video_url}` : ''} type="video/mp4" />
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
                      {videoResult.object_details && Object.keys(videoResult.object_details).length > 0 && (
                        <div className="result-card">
                          <h4 style={{ color: '#4ade80', marginTop: 0, fontSize: '13px', marginBottom: '15px' }}>🎯 Object Detection Details Tracker</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {Object.entries(videoResult.object_details).map(([objName, occurrences]) => {
                              const isExpanded = expandedVidObject === objName;
                              return (
                                <div key={objName} style={{ background: 'var(--bg-root)', border: '1px solid var(--border-mid)', borderRadius: '8px', overflow: 'hidden' }}>
                                  <div onClick={() => setExpandedVidObject(isExpanded ? null : objName)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px', cursor: 'pointer', background: isExpanded ? 'var(--bg-elevated)' : 'transparent' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <span style={{ color: 'var(--t-primary)', fontWeight: 'bold', textTransform: 'capitalize', fontSize: '14px' }}>{objName}</span>
                                      <span style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>{occurrences.length} instances tracked</span>
                                    </div>
                                    <span style={{ color: 'var(--t-secondary)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                                  </div>
                                  {isExpanded && (
                                    <div style={{ padding: '15px', borderTop: '1px solid var(--border-mid)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '15px', background: 'var(--bg-root)' }}>
                                      {occurrences.map((occ, i) => (
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
                                          style={{ background: 'var(--border-mid)', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', cursor: 'pointer', border: '1px solid transparent', transition: 'border 0.1s' }}
                                          onMouseEnter={e => (e.currentTarget.style.border = '1px solid #ef4444')}
                                          onMouseLeave={e => (e.currentTarget.style.border = '1px solid transparent')}
                                        >
                                          <div style={{ color: '#fb8c36', fontSize: '11px', fontWeight: 'bold', width: '100%', textAlign: 'center' }}>⏱ t={occ.second}s</div>
                                          {occ.image ? (
                                            <div style={{ width: '100px', height: '100px', background: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                              <img src={occ.image} alt={objName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                            </div>
                                          ) : (
                                            <div style={{ width: '100px', height: '100px', background: 'var(--bg-elevated)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontSize: '10px' }}>No Image</div>
                                          )}
                                          <div style={{ color: 'var(--t-secondary)', fontSize: '10px' }}>Conf: {Math.round(occ.confidence * 100)}%</div>
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

                      {/* Fallback: simple object bar chart when no object_details */}
                      {!videoResult.object_details && Object.keys(videoResult.detected_objects).length > 0 && (
                        <div className="result-card">
                          <h4 style={{ marginTop: 0 }}>Detected Objects</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                            {Object.entries(videoResult.detected_objects).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 12).map(([label, count]) => {
                              const max = Math.max(...Object.values(videoResult.detected_objects) as number[]);
                              return (
                                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ color: 'var(--t-primary)', fontSize: '13px', minWidth: '100px' }}>{label}</span>
                                  <div style={{ flex: 1, height: '6px', background: 'var(--border-mid)', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${((count as number) / max) * 100}%`, background: '#6366f1', borderRadius: '3px' }} />
                                  </div>
                                  <span style={{ color: 'var(--t-muted)', fontSize: '12px' }}>{count as number}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* CLIP Scenes */}
                      {videoResult.clip_scenes?.length > 0 && (
                        <div className="result-card">
                          <h4 style={{ marginTop: 0 }}>Scene Classification (CLIP)</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto', marginTop: '8px' }}>
                            {videoResult.clip_scenes.map((s, i) => (
                              <div key={i} style={{ display: 'flex', gap: '10px', padding: '6px 10px', background: 'var(--bg-elevated)', borderRadius: '6px', border: '1px solid var(--border-mid)', alignItems: 'center' }}>
                                <span style={{ color: 'var(--t-muted)', fontSize: '11px', minWidth: '28px' }}>{s.second}s</span>
                                <span style={{ color: 'var(--t-secondary)', fontSize: '13px', flex: 1 }}>{s.scene}</span>
                                <span style={{ color: '#6366f1', fontSize: '11px' }}>{(s.score * 100).toFixed(0)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* AUDIO ANALYSIS TAB */}
                    <div style={{ display: videoTab === 'audio' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
                      {videoResult.transcript?.full_text && videoResult.transcript.full_text !== 'No audio track found in this video.' ? (
                        <>
                          <div className="result-card" style={{ borderLeft: '4px solid #22d3ee' }}>
                            <h4 style={{ color: '#22d3ee', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                              🎤 Whisper Audio Transcript
                              {videoResult.transcript.language && videoResult.transcript.language !== 'unknown' && (
                                <span style={{ fontSize: '10px', background: '#164e63', padding: '2px 8px', borderRadius: '12px', color: '#67e8f9' }}>{videoResult.transcript.language.toUpperCase()}</span>
                              )}
                            </h4>
                            <div style={{ background: 'var(--border-mid)', borderRadius: '8px', padding: '15px', margin: '10px 0', fontSize: '13px', color: 'var(--t-primary)', lineHeight: 1.7 }}>{videoResult.transcript.full_text}</div>
                            {videoResult.transcript.segments && videoResult.transcript.segments.length > 0 && (
                              <div style={{ marginTop: '15px' }}>
                                <p style={{ color: 'var(--t-secondary)', fontSize: '11px', marginBottom: '8px' }}>Timestamped Segments:</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                                  {videoResult.transcript.segments.map((seg, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '12px', padding: '8px 10px', background: i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--border-mid)', borderRadius: '6px', alignItems: 'flex-start' }}>
                                      <div style={{ minWidth: '60px', color: '#22d3ee', fontWeight: 'bold', fontSize: '11px' }}>{seg.start}s – {seg.end}s</div>
                                      <span style={{ color: 'var(--t-primary)', lineHeight: 1.4 }}>{seg.text}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          {videoResult.transcript.audio_plots && Object.keys(videoResult.transcript.audio_plots).length > 0 && (
                            <div className="result-card" style={{ borderLeft: '4px solid #f472b6' }}>
                              <h4 style={{ color: '#f472b6', marginTop: 0, marginBottom: '15px' }}>🎛️ Acoustic Spectral Analysis</h4>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {videoResult.transcript.audio_plots.waveform && (
                                  <div style={{ background: 'var(--bg-root)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-mid)' }}>
                                    <h5 style={{ color: 'var(--t-secondary)', fontSize: '11px', margin: '0 0 10px', textTransform: 'uppercase' }}>Waveform Plot</h5>
                                    <img src={videoResult.transcript.audio_plots.waveform} alt="Waveform" style={{ width: '100%', borderRadius: '4px' }} />
                                  </div>
                                )}
                                {videoResult.transcript.audio_plots.spectrogram && (
                                  <div style={{ background: 'var(--bg-root)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-mid)' }}>
                                    <h5 style={{ color: 'var(--t-secondary)', fontSize: '11px', margin: '0 0 10px', textTransform: 'uppercase' }}>Frequency Spectrogram</h5>
                                    <img src={videoResult.transcript.audio_plots.spectrogram} alt="Spectrogram" style={{ width: '100%', borderRadius: '4px' }} />
                                  </div>
                                )}
                                {videoResult.transcript.audio_plots.energy && (
                                  <div style={{ background: 'var(--bg-root)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-mid)' }}>
                                    <h5 style={{ color: 'var(--t-secondary)', fontSize: '11px', margin: '0 0 10px', textTransform: 'uppercase' }}>RMS Energy Detection</h5>
                                    <img src={videoResult.transcript.audio_plots.energy} alt="Energy Graph" style={{ width: '100%', borderRadius: '4px' }} />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="result-card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t-secondary)' }}>
                          <p>No audio track was found or transcribed for this video.</p>
                        </div>
                      )}
                    </div>

                    {/* TEXT ANALYSIS TAB */}
                    <div style={{ display: videoTab === 'text' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
                      {videoResult.sentiment_analysis && (
                        <div className="result-card" style={{ borderLeft: '4px solid #38bdf8' }}>
                          <h4 style={{ color: '#38bdf8', marginTop: 0, marginBottom: '10px' }}>📊 Video Sentiment Analysis</h4>
                          <p style={{ margin: 0, color: 'var(--t-primary)', fontSize: '14px', background: 'var(--bg-root)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-mid)' }}>{videoResult.sentiment_analysis.replace('Sentiment Analysis:', '')}</p>
                        </div>
                      )}
                      {videoResult.transcript?.full_text && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
                          {videoResult.transcript.entities && videoResult.transcript.entities.length > 0 && (
                            <div style={{ background: 'var(--bg-root)', border: '1px solid var(--border-mid)', borderRadius: '8px', padding: '15px' }}>
                              <h5 style={{ color: '#4ade80', marginTop: 0, marginBottom: '15px', fontSize: '13px' }}>🏷️ Extracted Entities (SpaCy)</h5>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                                {videoResult.transcript.entities.map((ent, i) => (
                                  <div key={i}>
                                    <span style={{ fontSize: '11px', color: 'var(--t-secondary)', textTransform: 'uppercase', fontWeight: 'bold' }}>{ent.label}</span>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                      {ent.items.map((item, j) => <span key={j} style={{ background: 'var(--border-mid)', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', color: 'var(--t-primary)', border: '1px solid var(--border-bright)' }}>{item}</span>)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {videoResult.transcript.topics && videoResult.transcript.topics.length > 0 && (
                            <div style={{ background: 'var(--bg-root)', border: '1px solid var(--border-mid)', borderRadius: '8px', padding: '15px' }}>
                              <h5 style={{ color: '#c084fc', marginTop: 0, marginBottom: '15px', fontSize: '13px' }}>📊 Discussion Topics (BERTopic)</h5>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                                {videoResult.transcript.topics.map((top, i) => (
                                  <div key={i} style={{ background: 'var(--border-mid)', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-bright)' }}>
                                    <span style={{ color: 'var(--t-primary)', fontWeight: 'bold' }}>{top.name}</span>
                                    <span style={{ background: 'var(--border-bright)', color: 'var(--t-secondary)', padding: '2px 8px', borderRadius: '10px', fontSize: '10px' }}>{top.count} segments</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {!videoResult.sentiment_analysis && !videoResult.transcript?.entities?.length && !videoResult.transcript?.topics?.length && (
                        <div className="result-card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t-secondary)' }}>
                          <p>No text analysis data available for this video.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedClusterPoint && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(2, 6, 23, 0.9)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}
          onClick={() => setSelectedClusterPoint(null)}
        >
          <div
            style={{ background: 'var(--bg-elevated)', borderRadius: '16px', border: '1px solid var(--border-mid)', width: '100%', maxWidth: '1000px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '20px', borderBottom: '1px solid var(--border-mid)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--border-mid)' }}>
              <h3 style={{ margin: 0, color: 'var(--t-primary)', fontSize: '18px' }}>{selectedClusterPoint?.filename}</h3>
              <button
                onClick={() => setSelectedClusterPoint(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--t-secondary)', cursor: 'pointer', fontSize: '28px', padding: 0, lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-root)', padding: '20px', overflow: 'auto' }}>
                {selectedClusterPoint?.annotated_image_path ? (
                  <img src={`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/${selectedClusterPoint.annotated_image_path}`} alt="Full size" style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '4px' }} />
                ) : (
                  <div style={{ color: 'var(--t-muted)' }}>No Tracking Data</div>
                )}
              </div>
              <div style={{ width: '350px', display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', overflowY: 'auto', background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border-mid)' }}>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--t-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>AI Caption</span>
                  <p style={{ margin: '8px 0 0', color: 'var(--t-primary)', fontSize: '15px', lineHeight: '1.5', background: 'rgba(30, 41, 59, 0.5)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    {selectedClusterPoint?.description || "No caption available."}
                  </p>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--t-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Detected Objects ({selectedClusterPoint?.objects?.length || 0})</span>
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '15px', background: 'rgba(30, 41, 59, 0.5)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    {selectedClusterPoint?.objects?.map((obj: any, idx: number) => (
                      <span key={idx} style={{ background: 'var(--border-bright)', color: 'var(--t-primary)', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', border: '1px solid var(--t-muted)' }}>
                        {obj.label} <span style={{ color: '#60a5fa', marginLeft: '4px', fontWeight: 'bold' }}>{Math.round(obj.confidence * 100)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--t-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Assigned Cluster</span>
                  <div style={{ marginTop: '8px', padding: '12px 15px', background: `var(--cluster-${(selectedClusterPoint?.cluster_id || 0) % 5})`, color: '#fff', borderRadius: '8px', fontWeight: 'bold', display: 'inline-block', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                    Cluster {selectedClusterPoint?.cluster_id}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default DataVizPage;

// ── AudioResultView ───────────────────────────────────────────────────────────
const AudioResultView = ({ result, file }: { result: AudioAnalysisResponse['result']; file?: File }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);

  const getSpeakerColor = (speaker: string) => {
    const hash = speaker.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    return colors[hash % colors.length];
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (file && waveformRef.current) {
      wavesurfer.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#4f46e5',
        progressColor: '#818cf8',
        cursorColor: '#c7d2fe',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 80,
      });
      const url = URL.createObjectURL(file);
      wavesurfer.current.load(url);
      wavesurfer.current.on('play', () => setIsPlaying(true));
      wavesurfer.current.on('pause', () => setIsPlaying(false));
      wavesurfer.current.on('timeupdate', (t: number) => setCurrentTime(t));
      return () => { wavesurfer.current?.destroy(); };
    }
  }, [file]);

  const togglePlay = () => wavesurfer.current?.playPause();
  const seekTo = (time: number) => { wavesurfer.current?.setTime(time); wavesurfer.current?.play(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>

      {/* Metadata chips */}
      {result.features && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            `🎵 ${result.features.sample_rate.toLocaleString()} Hz`,
            `⏱ ${formatTime(result.features.duration)}`,
            result.features.num_channels === 1 ? '🔊 Mono' : '🔊 Stereo',
          ].map(label => (
            <span key={label} style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', fontSize: '12px', padding: '5px 12px', borderRadius: '99px' }}>{label}</span>
          ))}
          <span style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)', fontSize: '12px', padding: '5px 12px', borderRadius: '99px' }}>
            {result.segments.length} segments
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>

        {/* LEFT: player + waveform + energy + transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {file && (
            <div className="result-card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                <button onClick={togglePlay} style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#4f46e5', color: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: '3px' }} />}
                </button>
                <div style={{ flex: 1 }} ref={waveformRef} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--t-muted)' }}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(result.features?.duration ?? result.duration)}</span>
              </div>
            </div>
          )}

          {result.features?.waveform && (
            <WaveformCanvas waveform={result.features.waveform} currentTime={currentTime} duration={result.features.duration} />
          )}

          {result.features?.energy && (
            <EnergyChart energy={result.features.energy} currentTime={currentTime} />
          )}

          {/* Transcript */}
          <div className="result-card">
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', marginTop: 0 }}>
              <FileText size={16} /> Transcript
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '380px', overflowY: 'auto' }}>
              {result.segments.map((seg, i) => {
                const isCurrent = currentTime >= seg.start && currentTime <= seg.end;
                return (
                  <div key={i} onClick={() => seekTo(seg.start)} style={{ display: 'flex', gap: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', cursor: 'pointer', background: isCurrent ? 'rgba(99,102,241,0.12)' : 'rgba(30,41,59,0.5)', transition: 'background 0.2s', borderLeft: `3px solid ${getSpeakerColor(seg.speaker)}` }}>
                    <div style={{ flexShrink: 0, width: '40px', fontSize: '11px', color: 'var(--t-muted)', paddingTop: '2px' }}>{formatTime(seg.start)}</div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: getSpeakerColor(seg.speaker), marginBottom: '2px' }}>{seg.speaker}</div>
                      <div style={{ fontSize: '13px', color: 'var(--t-primary)', lineHeight: 1.5 }}>{seg.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: spectrogram + speakers + NLP */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {result.features?.spectrogram && (
            <SpectrogramCanvas spectrogram={result.features.spectrogram} currentTime={currentTime} duration={result.features.duration} />
          )}

          {/* Speaker legend */}
          {(() => {
            const speakers = Array.from(new Set(result.segments.map(s => s.speaker)));
            return (
              <div className="result-card" style={{ padding: '1rem' }}>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Speakers</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {speakers.map(sp => (
                    <div key={sp} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0, background: getSpeakerColor(sp) }} />
                      <span style={{ color: 'var(--t-primary)' }}>{sp}</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--t-muted)', fontSize: '11px' }}>{result.segments.filter(s => s.speaker === sp).length} segs</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* NLP analysis */}
          {result.text_analysis && (
            <>
              <div className="result-card" style={{ padding: '1rem' }}>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 600, marginBottom: '0.5rem', marginTop: 0, letterSpacing: '0.5px' }}>Executive Summary</h4>
                <p style={{ fontSize: '13px', color: 'var(--t-secondary)', lineHeight: 1.6, margin: '0 0 1rem' }}>{result.text_analysis.summary}</p>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Sentiment</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize', background: result.text_analysis.sentiment.overall_label === 'positive' ? 'rgba(34,197,94,0.15)' : result.text_analysis.sentiment.overall_label === 'negative' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.1)', color: result.text_analysis.sentiment.overall_label === 'positive' ? '#4ade80' : result.text_analysis.sentiment.overall_label === 'negative' ? '#f87171' : 'var(--t-secondary)' }}>
                    {result.text_analysis.sentiment.overall_label}
                  </span>
                </div>
                <div style={{ height: '8px', width: '100%', display: 'flex', borderRadius: '4px', overflow: 'hidden', background: 'var(--border-mid)' }}>
                  <div style={{ width: `${result.text_analysis.sentiment.positive * 100}%`, background: '#22c55e' }} />
                  <div style={{ width: `${result.text_analysis.sentiment.neutral * 100}%`, background: 'var(--t-muted)' }} />
                  <div style={{ width: `${result.text_analysis.sentiment.negative * 100}%`, background: '#ef4444' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: 'var(--t-muted)' }}>
                  <span>+{(result.text_analysis.sentiment.positive * 100).toFixed(0)}%</span>
                  <span>{(result.text_analysis.sentiment.neutral * 100).toFixed(0)}%</span>
                  <span>-{(result.text_analysis.sentiment.negative * 100).toFixed(0)}%</span>
                </div>
              </div>

              {result.text_analysis.entities.length > 0 && (
                <div className="result-card" style={{ padding: '1rem' }}>
                  <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Entities</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {result.text_analysis.entities.slice(0, 15).map((e: any) => (
                      <span key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '11px', padding: '0.25rem 0.5rem', background: 'var(--border-mid)', borderRadius: '6px', border: '1px solid var(--border-bright)', color: 'var(--t-secondary)' }}>
                        {e.type === 'Person' ? <Hash size={11} /> : e.type === 'Place' ? <MapPin size={11} /> : <Activity size={11} />}
                        {e.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── WaveformCanvas ────────────────────────────────────────────────────────────
const WaveformCanvas = ({ waveform, currentTime, duration }: {
  waveform: import('./services').WaveformData;
  currentTime: number;
  duration: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const n = waveform.amplitudes.length;
    const midY = H / 2;
    const barW = Math.max(1, W / n);
    const progress = duration > 0 ? currentTime / duration : 0;
    for (let i = 0; i < n; i++) {
      const amp = Math.abs(waveform.amplitudes[i]);
      const barH = amp * midY * 0.9;
      ctx.fillStyle = i / n <= progress ? '#818cf8' : 'var(--border-bright)';
      ctx.fillRect((i / n) * W, midY - barH, barW - 0.5, barH * 2);
    }
  }, [waveform, currentTime, duration]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>Waveform (normalized)</h4>
      <canvas ref={canvasRef} width={600} height={80} style={{ width: '100%', height: '80px', borderRadius: '6px', background: 'var(--bg-root)' }} />
    </div>
  );
};

// ── SpectrogramCanvas ─────────────────────────────────────────────────────────
const SpectrogramCanvas = ({ spectrogram, currentTime, duration }: {
  spectrogram: import('./services').SpectrogramData;
  currentTime: number;
  duration: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrogram) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const freqBins = spectrogram.magnitude_db.length;
    const timeBins = spectrogram.time_bins.length;
    const W = canvas.width, H = canvas.height;
    const cellW = W / timeBins, cellH = H / freqBins;
    for (let f = 0; f < freqBins; f++) {
      for (let t = 0; t < timeBins; t++) {
        const intensity = (spectrogram.magnitude_db[f][t] + 80) / 80;
        const r = Math.round(Math.min(255, intensity * 2 * 255));
        const g = Math.round(Math.min(255, intensity * 1.5 * 255));
        const b = Math.round(Math.max(0, (1 - intensity * 2) * 255));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(t * cellW, (freqBins - 1 - f) * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
    if (duration > 0) {
      const x = (currentTime / duration) * W;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }, [spectrogram, currentTime, duration]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>STFT Spectrogram</h4>
      <canvas ref={canvasRef} width={300} height={160} style={{ width: '100%', height: '160px', borderRadius: '6px', imageRendering: 'pixelated' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--t-muted)', marginTop: '4px' }}>
        <span>0 Hz</span><span>8 kHz (frequency axis)</span>
      </div>
    </div>
  );
};

// ── EnergyChart ───────────────────────────────────────────────────────────────
const EnergyChart = ({ energy, currentTime }: {
  energy: import('./services').EnergyData;
  currentTime: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !energy) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const n = energy.rms_values.length;
    const barW = Math.max(1, W / n);
    for (let i = 0; i < n; i++) {
      const barH = energy.rms_values[i] * H * 0.9;
      const played = energy.timestamps[i] <= currentTime;
      const alpha = 0.4 + energy.rms_values[i] * 0.6;
      ctx.fillStyle = played ? `rgba(251,140,54,${alpha})` : `rgba(71,85,105,${alpha})`;
      ctx.fillRect((i / n) * W, H - barH, barW - 0.5, barH);
    }
  }, [energy, currentTime]);

  return (
    <div className="result-card" style={{ padding: '1rem' }}>
      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, letterSpacing: '0.5px' }}>RMS Energy</h4>
      <canvas ref={canvasRef} width={600} height={60} style={{ width: '100%', height: '60px', borderRadius: '6px', background: '#020617' }} />
    </div>
  );
};
