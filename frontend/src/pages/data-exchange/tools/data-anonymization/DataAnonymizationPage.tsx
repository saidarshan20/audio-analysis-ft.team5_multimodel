import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Download,
  Eye,
  FileText,
  Globe,
  Image as ImageIcon,
  Lock,
  Play,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  anonymizeImage,
  anonymizeStructured,
  anonymizeUnstructured,
  anonymizeAudio,
  downloadStructuredAnonymizedFile,
  getAnonymizationSamples,
  type AnonymizationSample,
} from './api';
import './ToolPage.css';
import { ClassificationStage } from './ClassificationStage';
import { GovCatalogView } from './catalog/GovCatalogView';
import { BlobCatalogView } from './catalog/BlobCatalogView';
import TryOtherFeatures, { type FeatureKey } from '../../../shared/TryOtherFeatures';

type AnonStep = 'input' | 'classification' | 'techniques' | 'export';
type DatasetTab = 'gov' | 'blob' | 'upload' | 'sample';
type DataKind = 'structured' | 'unstructured' | 'image' | 'audio';
type TechniqueId = 'mask' | 'generalize' | 'anonymize' | 'perturb' | 'suppress' | 'k-anonymize' | 'none' | 'mute' | 'beep' | 'blur' | 'redact';
type DemoSample = AnonymizationSample;

type DataAnonymizationPageProps = {
  onBack: () => void;
  onNavigateFeature?: (feature: Exclude<FeatureKey, 'datasets'>) => void;
};

interface TechniqueOption {
  id: TechniqueId;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
}

interface TechniqueTarget {
  key: string;
  label: string;
  piiType: string;
  sample: string;
  risk?: string;
  dataType?: string;
  nerPiiType?: string | null;
  sensitivity?: string;
  count?: number;
}

interface ActivePreview {
  target: TechniqueTarget;
  technique: TechniqueId;
}

interface PolicyOption {
  id: string;
  label: string;
  region: string;
  icon: string;
  description: string;
}

const POLICIES: PolicyOption[] =[
  // GLOBAL
  { id: 'Global', label: 'Global Standard', region: 'Universal', icon: 'GLB', description: 'Universal PII detection (GDPR, CCPA baseline).' },
  // ASIA & PACIFIC
  { id: 'India', label: 'India Digital-PIPL', region: 'India', icon: 'IN', description: 'Aadhaar, PAN, Voter ID, GSTIN.' },
  { id: 'Singapore', label: 'SG Data Guard', region: 'Singapore', icon: 'SG', description: 'NRIC and FIN identifiers.' },
  { id: 'Japan', label: 'JP Privacy', region: 'Japan', icon: 'JP', description: 'My Number (Individual Number).' },
  { id: 'Australia', label: 'Oz Privacy Pro', region: 'Australia', icon: 'AU', description: 'TFN and Medicare numbers.' },
  { id: 'China', label: 'CN PIPL', region: 'China', icon: 'CN', description: 'Resident Identity Card.' },
  { id: 'UAE', label: 'UAE Data Shield', region: 'UAE', icon: 'UAE', description: 'Emirates ID (EID).' },
  // AMERICAS
  { id: 'US', label: 'US Privacy Plus', region: 'USA', icon: 'US', description: 'SSN and Driver Licenses.' },
  { id: 'Canada', label: 'Canada Shield', region: 'Canada', icon: 'CA', description: 'SIN and Passports.' },
  { id: 'Brazil', label: 'BR LGPD', region: 'Brazil', icon: 'BR', description: 'CPF and CNPJ identifiers.' },
  { id: 'Mexico', label: 'MX Privacy', region: 'Mexico', icon: 'MX', description: 'CURP (Clave Unica).' },
  // EUROPE
  { id: 'Europe', label: 'EU Data Euro', region: 'EU', icon: 'EU', description: 'VAT and IBAN formats.' },
  { id: 'UK', label: 'UK Data Guard', region: 'UK', icon: 'UK', description: 'NHS and NI numbers.' },
  { id: 'Germany', label: 'DE Privacy', region: 'Germany', icon: 'DE', description: 'Steueridentifikationsnummer.' },
  { id: 'France', label: 'FR Data', region: 'France', icon: 'FR', description: 'Numero de Securite Sociale (NIR).' },
  // MEA
  { id: 'SouthAfrica', label: 'ZA POPIA', region: 'South Africa', icon: 'ZA', description: 'ID Number.' },
];

const POLICY_GROUPS =[
  { name: 'Universal', items: ['Global'] },
  { name: 'Asia & Pacific', items:['India', 'Singapore', 'Japan', 'Australia', 'China', 'UAE'] },
  { name: 'Americas', items: ['US', 'Canada', 'Brazil', 'Mexico'] },
  { name: 'Europe', items: ['Europe', 'UK', 'Germany', 'France'] },
  { name: 'Middle East & Africa', items: ['SouthAfrica'] },
];

const STRUCTURED_EXTENSIONS =['csv', 'json', 'xlsx'];
const IMAGE_EXTENSIONS =['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'webp'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a'];
const ACCEPTED_FILE_TYPES = '.csv,.json,.xlsx,.pdf,.txt,.doc,.docx,.png,.jpg,.jpeg,.bmp,.tiff,.webp,.mp3,.wav,.m4a';

// All 6 defined techniques with applicability per data type
const ALL_TECHNIQUES: TechniqueOption[] =[
  {
    id: 'mask',
    icon: 'MASK',
    label: 'Masking',
    shortLabel: 'Mask',
    description: 'Replaces sensitive characters with asterisks while preserving recognisable structure.',
  },
  {
    id: 'generalize',
    icon: 'GEN',
    label: 'Generalization',
    shortLabel: 'Generalize',
    description: 'Replaces specific values with broader categories (e.g. age 28 to "25-30", city to region).',
  },
  {
    id: 'anonymize',
    icon: 'ANON',
    label: 'Anonymization',
    shortLabel: 'Anonymize',
    description: 'Replaces identifiers with consistent artificial ones (John Smith to User_4782).',
  },
  {
    id: 'perturb',
    icon: 'PERT',
    label: 'Data Perturbation',
    shortLabel: 'Perturb',
    description: 'Adds calibrated noise or slight modifications to numerical values (salary 75000 to 76234).',
  },
  {
    id: 'suppress',
    icon: 'SUP',
    label: 'Suppression',
    shortLabel: 'Suppress',
    description: 'Completely removes the field or record from the output.',
  },
  {
    id: 'k-anonymize',
    icon: 'K',
    label: 'K-Anonymity',
    shortLabel: 'K-Anon',
    description: 'Generalises values so each record is indistinguishable from at least k-1 others (zip 400001 to 4000**).',
  },
  {
    id: 'none',
    icon: 'KEEP',
    label: 'Keep As-Is',
    shortLabel: 'Keep',
    description: 'Leave this field unchanged in the output.',
  },
  {
    id: 'blur',
    icon: 'BLUR',
    label: 'Gaussian Blur',
    shortLabel: 'Blur',
    description: 'Apply a heavy blur filter to make the region unrecognizable while keeping context.',
  },
  {
    id: 'mute',
    icon: 'MUTE',
    label: 'Mute Audio',
    shortLabel: 'Mute',
    description: 'Silence the audio segment completely during the duration of the entity.',
  },
  {
    id: 'beep',
    icon: 'BEEP',
    label: 'Bleep Tone',
    shortLabel: 'Bleep',
    description: 'Overlay a standard 1kHz censor bleep tone over the sensitive speech.',
  },
];

// Which techniques apply per data type
const TECHNIQUE_IDS_BY_KIND: Record<DataKind, TechniqueId[]> = {
  structured:['mask', 'generalize', 'anonymize', 'perturb', 'suppress', 'k-anonymize', 'none'],
  unstructured:['mask', 'anonymize', 'suppress', 'generalize', 'none'],
  image:        ['suppress', 'blur', 'none'],
  audio:        ['mute', 'beep', 'none'],
};

const TECHNIQUES: Record<DataKind, TechniqueOption[]> = Object.fromEntries(
  Object.entries(TECHNIQUE_IDS_BY_KIND).map(([kind, ids]) =>[
    kind,
    ids.map(id => ALL_TECHNIQUES.find(t => t.id === id)).filter((t): t is TechniqueOption => t !== undefined),
  ])
) as Record<DataKind, TechniqueOption[]>;

const upper = (value?: string | null) => (value ?? '').toUpperCase();
const titleCase = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const getExtension = (file: File | null) => file?.name.split('.').pop()?.toLowerCase() ?? '';
const withoutExtension = (name?: string) => (name || 'dataset').replace(/\.[^/.]+$/, '');
const getNameExtension = (name?: string) => name?.split('.').pop()?.toLowerCase() ?? '';
const getFileCategory = (file: File | null): DataKind | null => {
  const ext = getExtension(file);
  if (!ext) return null;
  if (STRUCTURED_EXTENSIONS.includes(ext)) return 'structured';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  return 'unstructured';
};

function sanitizeFilename(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function detectDataKind(structuredRaw: any, unstructuredRaw: any, imageRaw: any, audioRaw: any): DataKind {
  if (audioRaw) return 'audio';
  if (structuredRaw) return 'structured';
  if (imageRaw) return 'image';
  return 'unstructured';
}

function getRiskColor(risk?: string) {
  const r = upper(risk);
  if (r === 'HIGH') return '#ef4444';
  if (r === 'MEDIUM') return '#f59e0b';
  return '#22c55e';
}

function getSensitivityBadge(s?: string) {
  const val = upper(s);
  if (val === 'RESTRICTED') return { bg: '#fef2f2', color: '#dc2626', label: 'Restricted' };
  if (val === 'CONFIDENTIAL') return { bg: '#fff7ed', color: '#c2410c', label: 'Confidential' };
  if (val === 'INTERNAL') return { bg: '#eff6ff', color: '#1d4ed8', label: 'Internal' };
  return { bg: '#f0fdf4', color: '#15803d', label: 'Public' };
}

function getTargets(kind: DataKind, structuredRaw: any, unstructuredRaw: any, imageRaw: any, audioRaw?: any): TechniqueTarget[] {
  if (kind === 'audio' && audioRaw) {
      const entities = (audioRaw.entities ??[]) as Array<{ entity_type: string, value: string, score: number }>;
      const uniqueTypes = Array.from(new Set(entities.map(e => e.entity_type)));
      return uniqueTypes.map(t => ({
          key: t,
          label: `Audio: ${titleCase(t)}`,
          piiType: t,
          sample: entities.find(e => e.entity_type === t)?.value ?? 'Voice segment',
          risk: 'HIGH'
      }));
  }
  if (kind === 'structured') {
    const result = structuredRaw?.result ?? {};
    const columns: string[] = result['Column Name'] ??[];
    return columns
      .map((column, index) => ({
        key: column,
        label: column,
        piiType: result['PII_Type_LLM']?.[index] ?? 'NONE',
        nerPiiType: result['PII_Type_NER']?.[index] ?? null,
        dataType: result['Data Types']?.[index] ?? '',
        sample: result['Sample Value']?.[index] ?? '—',
        risk: result['Risk']?.[index] ?? 'LOW',
        sensitivity: result['Sensiivity']?.[index] ?? result['Sensitivity']?.[index] ?? 'PUBLIC',
      }))
      .filter((item) => upper(item.piiType) !== 'NONE');
  }
  if (kind === 'image') {
    const grouped = (imageRaw?.entities ??[]).reduce((acc: Record<string, number>, entity: any) => {
      acc[entity.entity_type] = (acc[entity.entity_type] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped).map(([entityType, count]) => {
      const total = Number(count);
      return ({
        key: entityType,
        label: titleCase(entityType),
        piiType: entityType,
        sample: `${total} region${total > 1 ? 's' : ''} detected`,
        risk: imageRaw?.metrics?.risk_level ?? 'Medium',
        count: total,
      });
    });
  }

  const grouped = (unstructuredRaw?.results ??[]).reduce((acc: Record<string, number>, row: any) => {
    const key = row.llm_pii_type ?? 'UNKNOWN';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(grouped).map(([entityType, count]) => {
    const total = Number(count);
    return ({
      key: entityType,
      label: titleCase(entityType),
      piiType: entityType,
      sample: `${total} occurrence${total > 1 ? 's' : ''} in preview`,
      risk: unstructuredRaw?.metrics?.risk_level ?? 'Medium',
      count: total,
    });
  });
}

function defaultTechnique(kind: DataKind, piiType: string, risk?: string): TechniqueId {
  const p = upper(piiType);
  if (kind === 'image') return 'blur';
  if (kind === 'audio') return 'beep';
  if (p.includes('CREDIT') || p.includes('SSN') || p.includes('PASSPORT')) return 'suppress';
  if (p.includes('PERSON') || p.includes('NAME')) return 'anonymize';
  if (p.includes('EMAIL') || p.includes('PHONE')) return 'mask';
  if (p.includes('AGE') || p.includes('DATE') || p.includes('ZIP') || p.includes('LOCATION')) {
    return kind === 'unstructured' ? 'mask' : 'generalize';
  }
  if (p.includes('SALARY') || p.includes('INCOME') || p.includes('AMOUNT')) return 'perturb';
  if (kind === 'structured' && upper(risk) === 'HIGH') return 'suppress';
  return kind === 'structured' ? 'mask' : 'suppress';
}

function getExamplePreview(technique: TechniqueId, piiType: string, sampleValue: string): { before: string; after: string; note: string } {
  const p = upper(piiType);
  const val = sampleValue && sampleValue !== '—' ? sampleValue : (
    p.includes('EMAIL') ? 'john.doe@company.com' :
    p.includes('PHONE') ? '+91-9876543210' :
    p.includes('PERSON') || p.includes('NAME') ? 'Priya Sharma' :
    p.includes('CREDIT') ? '4532-1234-7821-9009' :
    p.includes('SSN') ? '123-45-6789' :
    p.includes('AGE') ? '28' :
    p.includes('DATE') ? '1985-03-15' :
    p.includes('ZIP') || p.includes('POSTAL') ? '400001' :
    p.includes('LOCATION') || p.includes('CITY') ? 'Mumbai, Maharashtra' :
    p.includes('SALARY') || p.includes('INCOME') ? '75000' :
    p.includes('ACCOUNT') ? 'ACC-0042-7721' :
    'SensitiveValue'
  );

  switch (technique) {
    case 'mask': {
      let after = val;
      if (p.includes('EMAIL')) {
        const [user, domain] = val.split('@');
        after = `${user[0]}${'*'.repeat(Math.max(user.length - 1, 3))}@${domain[0]}${'*'.repeat(Math.max(domain.length - 1, 3))}`;
      } else if (p.includes('PHONE')) {
        after = val.replace(/(\d{4})(\d+)(\d{2})/, '$1-****-**$3');
      } else if (p.includes('CREDIT')) {
        after = `${val.slice(0, 4)}-****-****-${val.slice(-4)}`;
      } else if (val.length > 4) {
        after = `${val.slice(0, 2)}${'*'.repeat(val.length - 4)}${val.slice(-2)}`;
      } else {
        after = '***';
      }
      return { before: val, after, note: 'Sensitive characters replaced with asterisks while preserving structure.' };
    }
    case 'generalize': {
      let after = '[GENERALIZED]';
      if (p.includes('AGE')) after = parseInt(val) ? `${Math.floor(parseInt(val) / 5) * 5}–${Math.floor(parseInt(val) / 5) * 5 + 4}` : '25–30';
      else if (p.includes('DATE')) after = `${val.slice(0, 4).slice(0, 3)}0s`;
      else if (p.includes('ZIP') || p.includes('POSTAL')) after = `${val.slice(0, 3)}**`;
      else if (p.includes('LOCATION') || p.includes('CITY')) after = val.includes(',') ? val.split(',').slice(-1)[0].trim() : 'South India';
      else if (p.includes('SALARY') || p.includes('INCOME')) {
        const n = parseInt(val);
        const floor = Math.floor(n / 25000) * 25000;
        after = n ? `${floor.toLocaleString()}–${(floor + 25000).toLocaleString()}` : '50,000–75,000';
      }
      return { before: val, after, note: 'Specific value replaced with a broader, less identifying category.' };
    }
    case 'anonymize': {
      const seed = val.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      let after = `User_${(seed * 31 % 9000 + 1000).toString().padStart(4, '0')}`;
      if (p.includes('EMAIL')) after = `anon_${(seed * 17 % 9000 + 1000)}@private.org`;
      else if (p.includes('PHONE')) after = `+00-${(seed * 13 % 9000 + 1000)}-${(seed * 7 % 9000 + 1000)}`;
      else if (p.includes('ACCOUNT')) after = `ACC-${(seed * 23 % 9000 + 1000)}-ANON`;
      return { before: val, after, note: 'Replaced with an artificial identifier so the original value is no longer exposed.' };
    }
    case 'perturb': {
      const numericVal = parseFloat(val.replace(/[^0-9.]/g, ''));
      let after = '[PERTURBED]';
      if (!isNaN(numericVal)) {
        const noise = Math.round((numericVal * 0.02) * (Math.random() > 0.5 ? 1 : -1));
        const noisy = numericVal + noise || numericVal + 150;
        after = val.includes('.') ? noisy.toFixed(2) : String(Math.round(noisy));
      } else if (p.includes('DATE')) {
        after = val.slice(0, -2) + String(parseInt(val.slice(-2)) + 3).padStart(2, '0');
      }
      return { before: val, after, note: 'Calibrated statistical noise added. Analytical utility is preserved while exact values are obscured.' };
    }
    case 'suppress':
      return { before: val, after: '[REMOVED]', note: 'The field is entirely removed from the output record.' };
    case 'k-anonymize': {
      let after = '[K-ANON]';
      if (p.includes('ZIP') || p.includes('POSTAL')) after = `${val.slice(0, 3)}**`;
      else if (p.includes('AGE')) { const n = parseInt(val); after = n ? `${Math.floor(n / 5) * 5}–${Math.floor(n / 5) * 5 + 4}` : '25–30'; }
      else if (p.includes('DATE')) after = val.slice(0, 4);
      else if (p.includes('LOCATION') || p.includes('CITY')) after = val.includes(',') ? val.split(',').slice(-1)[0].trim() : 'Region';
      else after = val.slice(0, Math.ceil(val.length / 2)) + '*'.repeat(Math.floor(val.length / 2));
      return { before: val, after, note: 'Value generalised so this record is indistinguishable from at least k−1 similar records.' };
    }
    case 'none':
      return { before: val, after: val, note: 'No transformation applied — the original value is kept in the output.' };
    default:
      return { before: val, after: '[REDACTED]', note: 'Value hidden from output.' };
  }
}

function applyTextTechnique(value: string, technique: TechniqueId, piiType: string) {
  if (!value) return value;
  const ex = getExamplePreview(technique, piiType, value);
  return ex.after;
}

function buildStructuredPreview(rawPreview: Record<string, unknown>[], config: Record<string, TechniqueId>) {
  return rawPreview.map((row) => Object.fromEntries(
    Object.entries(row)
      .filter(([column]) => config[column] !== 'suppress' && config[column] !== 'redact')
      .map(([column, value]) => [column, applyTextTechnique(String(value ?? ''), config[column] ?? 'none', column)])
  ));
}

function buildUnstructuredPreview(preview: string, rows: any[], config: Record<string, TechniqueId>) {
  let next = preview;
  const matches = rows
    .filter((row) => row.text_span && row.llm_pii_type)
    .map((row) => ({ span: row.text_span as string, piiType: row.llm_pii_type as string }));
  for (const match of matches) {
    const replacement = applyTextTechnique(match.span, config[match.piiType] ?? 'none', match.piiType);
    next = next.split(match.span).join(replacement);
  }
  return next;
}

const DataAnonymizationPage = ({ onBack, onNavigateFeature }: DataAnonymizationPageProps) => {
  const [activeStep, setActiveStep] = useState<AnonStep>('input');
  const [activeTab, setActiveTab] = useState<DatasetTab>('gov');
  const[selectedDs, setSelectedDs] = useState<{ id: number; name: string; desc: string; cat: string; isStr: boolean } | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [structuredFile, setStructuredFile] = useState<File | null>(null);
  const [unstructuredFile, setUnstructuredFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const[audioFile, setAudioFile] = useState<File | null>(null);
  const [structuredRaw, setStructuredRaw] = useState<any>(null);
  const [unstructuredRaw, setUnstructuredRaw] = useState<any>(null);
  const [imageRaw, setImageRaw] = useState<any>(null);
  const[audioRaw, setAudioRaw] = useState<any>(null);
  const [activePreview, setActivePreview] = useState<ActivePreview | null>(null);
  const [results, setResults] = useState<any>(null);
  const[error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const[techniqueMap, setTechniqueMap] = useState<Record<string, TechniqueId>>({});
  const[selectedPolicies, setSelectedPolicies] = useState<string[]>(['Global']);
  const[hoveredPolicy, setHoveredPolicy] = useState<string | null>(null);
  const [policyMetadata, setPolicyMetadata] = useState<any>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [policySearch, setPolicySearch] = useState('');
  const [numCopies, setNumCopies] = useState(1);
  const [policyExpanded, setPolicyExpanded] = useState(false);
  const[sampleCatalog, setSampleCatalog] = useState<DemoSample[]>([]);
  const[sampleLoading, setSampleLoading] = useState(false);
  const [activeSample, setActiveSample] = useState<DemoSample | null>(null);

  const kindLabel: Record<DataKind, string> = {
    structured: 'Tabular / Structured',
    unstructured: 'Document / Text',
    image: 'Image',
    audio: 'Audio',
  };

  const togglePolicy = (id: string) => {
    setSelectedPolicies(prev => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter(p => p !== id);
      }
      return[...prev, id];
    });
  };

  const BACKEND_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://127.0.0.1:8766';
  const isSampleMode = Boolean(activeSample);
  const toAbsoluteBackendUrl = (path?: string) => {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
  };

  useEffect(() => {
    fetch(`${BACKEND_URL}/team4/policy-metadata`)
      .then(res => {
        if (!res.ok) throw new Error("Metadata fetch failed");
        return res.json();
      })
      .then(data => setPolicyMetadata(data))
      .catch(err => console.error("Failed to fetch policy metadata", err));
  },[]);

  useEffect(() => {
    let ignore = false;
    setSampleLoading(true);
    getAnonymizationSamples()
      .then((samples) => {
        if (!ignore) setSampleCatalog(samples);
      })
      .catch((err) => {
        if (!ignore) console.error('Failed to fetch anonymization samples', err);
      })
      .finally(() => {
        if (!ignore) setSampleLoading(false);
      });
    return () => { ignore = true; };
  },[]);

  useEffect(() => {
    if (!imageFile) {
      setPreviewImageUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(imageFile);
    setPreviewImageUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [imageFile]);

  const resetClassificationState = () => {
    setStructuredFile(null);
    setUnstructuredFile(null);
    setImageFile(null);
    setAudioFile(null);
    setStructuredRaw(null);
    setUnstructuredRaw(null);
    setImageRaw(null);
    setAudioRaw(null);
    setTechniqueMap({});
    setResults(null);
    setActivePreview(null);
    setActiveSample(null);
  };

  const buildProcessingFile = () => {
    if (!selectedDs) return null;
    if (uploadedFile) return uploadedFile;
    const baseName = sanitizeFilename(selectedDs.name) || 'dataset';
    const extension = selectedDs.isStr ? 'csv' : 'txt';
    const content = selectedDs.isStr
      ? 'id,name,email\n1,John Doe,john@example.com'
      : 'John Doe can be reached at john@example.com or 555-123-4567.';
    return new File([content], `${baseName}.${extension}`, { type: selectedDs.isStr ? 'text/csv' : 'text/plain' });
  };

  const assignProcessingFile = (file: File) => {
    setStructuredFile(null);
    setUnstructuredFile(null);
    setImageFile(null);
    setAudioFile(null);
    const kind = getFileCategory(file);
    if (kind === 'structured') setStructuredFile(file);
    if (kind === 'unstructured') setUnstructuredFile(file);
    if (kind === 'image') setImageFile(file);
    if (kind === 'audio') setAudioFile(file);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setSelectedDs({
      id: Date.now(),
      name: file.name,
      desc: `User upload: ${(file.size / 1024).toFixed(1)} KB`,
      cat: 'Upload',
      isStr: STRUCTURED_EXTENSIONS.includes(getExtension(file)),
    });
    resetClassificationState();
    setError(null);
  };

  const handleClassificationComplete = (structured: unknown, unstructured: unknown, image: unknown, audio: unknown) => {
    setStructuredRaw(structured);
    setUnstructuredRaw(unstructured);
    setImageRaw(image);
    setAudioRaw(audio);
    const kind = detectDataKind(structured, unstructured, image, audio);
    const targets = getTargets(kind, structured, unstructured, image, audio);
    const defaults = Object.fromEntries(targets.map((target) =>[target.key, defaultTechnique(kind, target.piiType, target.risk)]));
    const presetMap = activeSample?.technique_map ? activeSample.technique_map as Record<string, TechniqueId> : {};
    setTechniqueMap({ ...defaults, ...presetMap });
    setActiveStep('techniques');
  };

  const handleSampleSelect = async (sample: DemoSample) => {
    try {
      setError(null);
      setIsProcessing(true);
      resetClassificationState();

      const latestSamples = await getAnonymizationSamples().catch(() => null);
      const resolvedSample = latestSamples?.find((item) => item.id === sample.id) ?? sample;
      if (latestSamples) setSampleCatalog(latestSamples);

      let file: File;
      if (resolvedSample.kind === 'image' || resolvedSample.kind === 'audio') {
        const sourceResponse = await fetch(toAbsoluteBackendUrl(resolvedSample.source_url));
        if (!sourceResponse.ok) throw new Error(`Failed to load sample asset: ${resolvedSample.source_file}`);
        const sourceBlob = await sourceResponse.blob();
        file = new File([sourceBlob], resolvedSample.source_file, { type: sourceBlob.type || undefined });
      } else {
        const placeholder = resolvedSample.kind === 'structured'
          ? 'sample,demo\nstored,true'
          : 'Stored sample document';
        file = new File([placeholder], resolvedSample.source_file, { type: resolvedSample.kind === 'structured' ? 'text/csv' : 'application/pdf' });
      }

      setUploadedFile(file);
      setSelectedDs({
        id: Date.now(),
        name: resolvedSample.source_file,
        desc: resolvedSample.description,
        cat: 'Sample',
        isStr: resolvedSample.kind === 'structured',
      });
      assignProcessingFile(file);
      setSelectedPolicies(resolvedSample.selected_policies?.length ? resolvedSample.selected_policies : ['Global']);
      setActiveSample(resolvedSample);
      setActiveStep('classification');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the sample demo.');
    } finally {
      setIsProcessing(false);
    }
  };

  const PolicySelector = () => {
    const filteredPolicies = POLICIES.filter(p =>
      p.label.toLowerCase().includes(policySearch.toLowerCase()) ||
      p.region.toLowerCase().includes(policySearch.toLowerCase())
    );
    const selectedObjs = POLICIES.filter(p => selectedPolicies.includes(p.id));

    return (
      <div style={{ marginTop: 20 }}>
        <style>{`
          .pol2-card{border:1px solid var(--border-mid);border-radius:16px;overflow:hidden;background:var(--bg-elevated)}
          .pol2-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;user-select:none;gap:12px;transition:background .15s}
          .pol2-header:hover{background:var(--bg-glass-md)}
          .pol2-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}
          .pol2-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;background:rgba(251,140,54,0.12);color:#fb8c36;border:1px solid rgba(251,140,54,0.3);white-space:nowrap}
          .pol2-chip-icon{font-size:13px}
          .pol2-toggle-btn{display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;border:1px solid var(--border-mid);background:var(--bg-surface);color:var(--t-secondary);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .15s}
          .pol2-toggle-btn:hover{border-color:#fb8c36;color:#fb8c36}
          .pol2-body{border-top:1px solid var(--border-mid);padding:16px 18px}
          .pol2-search-wrap{position:relative;margin-bottom:14px}
          .pol2-search-input{width:100%;padding:9px 14px 9px 36px;border:1px solid var(--border-mid);border-radius:10px;font-size:13px;outline:none;transition:all 0.2s;background:var(--bg-surface);color:var(--t-primary)}
          .pol2-search-input:focus{border-color:#fb8c36;box-shadow:0 0 0 2px rgba(251,140,54,0.1)}
          .pol2-search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#94a3b8;pointer-events:none}
          .pol2-group-label{font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted);margin:12px 0 6px}
          .pol2-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px}
          .pol2-item{display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--border-mid);border-radius:10px;cursor:pointer;transition:all .15s;background:var(--bg-surface);text-align:left}
          .pol2-item:hover{border-color:#fb8c36;background:rgba(251,140,54,0.05)}
          .pol2-item.pol2-active{border-color:#fb8c36;background:rgba(251,140,54,0.1);box-shadow:0 2px 8px rgba(251,140,54,0.15)}
          .pol2-flag{font-size:18px;line-height:1;flex-shrink:0}
          .pol2-info{flex:1;min-width:0}
          .pol2-iname{font-size:12px;font-weight:700;color:var(--t-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .pol2-ireg{font-size:10px;font-weight:800;color:#fb8c36;text-transform:uppercase;letter-spacing:.03em}
          .pol2-icheck{width:16px;height:16px;border-radius:50%;border:2px solid var(--border-mid);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
          .pol2-active .pol2-icheck{background:#fb8c36;border-color:#fb8c36;color:#fff}
          .pol2-hint{font-size:11px;color:var(--t-muted);margin-top:10px;line-height:1.5}
        `}</style>

        <div className="pol2-card">
          <div className="pol2-header" onClick={() => setPolicyExpanded(e => !e)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Shield size={15} color="#fb8c36" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--t-secondary)', flexShrink: 0 }}>Compliance Policies</span>
              <div className="pol2-chips">
                {selectedObjs.map(p => (
                  <span key={p.id} className="pol2-chip">
                    <span className="pol2-chip-icon">{p.icon}</span>{p.region}
                  </span>
                ))}
              </div>
            </div>
            <button className="pol2-toggle-btn" onClick={(e) => { e.stopPropagation(); setPolicyExpanded(x => !x); }}>
              {policyExpanded ? 'Collapse' : 'Select Regions'}
            </button>
          </div>

          {policyExpanded && (
            <div className="pol2-body">
              <div className="pol2-search-wrap">
                <Search className="pol2-search-icon" size={15} />
                <input
                  type="text"
                  placeholder="Search country or policy (e.g. India, Brazil…)"
                  className="pol2-search-input"
                  value={policySearch}
                  onChange={(e) => setPolicySearch(e.target.value)}
                />
              </div>
              {POLICY_GROUPS.map(group => {
                const items = filteredPolicies.filter(p => group.items.includes(p.id));
                if (items.length === 0) return null;
                return (
                  <div key={group.name}>
                    <div className="pol2-group-label">{group.name}</div>
                    <div className="pol2-grid">
                      {items.map(p => {
                        const isActive = selectedPolicies.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            className={`pol2-item${isActive ? ' pol2-active' : ''}`}
                            onClick={() => togglePolicy(p.id)}
                          >
                            <span className="pol2-flag">{p.icon}</span>
                            <div className="pol2-info">
                              <div className="pol2-ireg">{p.region}</div>
                              <div className="pol2-iname">{p.label}</div>
                            </div>
                            <div className="pol2-icheck">
                              {isActive && <CheckCircle2 size={10} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="pol2-hint">Global baseline remains active for all runs. Additional regions add jurisdiction-specific PII patterns.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const AIInsightPanel = ({ phase }: { phase: 'techniques' | 'results' }) => {
    const rawSummary =
      structuredRaw?.ai_summary ||
      unstructuredRaw?.ai_summary ||
      imageRaw?.ai_summary ||
      audioRaw?.ai_summary;

    const highRisk   = techniqueTargets.filter(t => upper(t.risk) === 'HIGH').length;
    const medRisk    = techniqueTargets.filter(t => upper(t.risk) === 'MEDIUM').length;
    const lowRisk    = techniqueTargets.filter(t => upper(t.risk) !== 'HIGH' && upper(t.risk) !== 'MEDIUM').length;
    const total      = techniqueTargets.length;
    const protected_ = techniqueTargets.filter(t => techniqueMap[t.key] && techniqueMap[t.key] !== 'none').length;
    const coverage   = total > 0 ? Math.round((protected_ / total) * 100) : 100;

    const confScore = (() => {
      if (currentKind === 'structured') {
        const nerMatches = techniqueTargets.filter(t => t.nerPiiType && t.nerPiiType !== 'null').length;
        return total > 0 ? Math.round(70 + (nerMatches / total) * 28) : 72;
      }
      if (currentKind === 'unstructured') {
        const confirmed = unstructuredRaw?.pii_confirmed ?? 0;
        const candidates = unstructuredRaw?.pii_candidates_found ?? confirmed;
        return candidates > 0 ? Math.round(60 + (confirmed / candidates) * 35) : 75;
      }
      if (currentKind === 'image') return imageRaw?.metrics?.confidence_score
        ? Math.round(imageRaw.metrics.confidence_score * 100)
        : 78;
      if (currentKind === 'audio') return audioRaw?.metrics?.confidence_score
        ? Math.round(audioRaw.metrics.confidence_score * 100)
        : 80;
      return 75;
    })();

    const confColor = confScore >= 85 ? '#22c55e' : confScore >= 70 ? '#f59e0b' : '#ef4444';

    const improvements: string[] = [];
    if (techniqueTargets.some(t => techniqueMap[t.key] === 'none')) {
      improvements.push('Some PII fields are set to "Keep As-Is" — consider masking or suppression before sharing externally.');
    }
    if (highRisk > 0 && techniqueTargets.some(t => upper(t.risk) === 'HIGH' && !['suppress','mask','anonymize'].includes(techniqueMap[t.key]))) {
      improvements.push(`${highRisk} high-risk field(s) could use stronger protection: "Suppress" or "Anonymize" is recommended.`);
    }
    if (currentKind === 'structured' && techniqueTargets.some(t => t.nerPiiType && techniqueMap[t.key] === 'generalize')) {
      improvements.push('NER-confirmed fields benefit from deterministic anonymization rather than generalization for better re-identification resistance.');
    }
    if (coverage === 100 && phase === 'results') {
      improvements.push('All detected PII targets are protected — this dataset is safe for internal sharing.');
    }
    if (improvements.length === 0) {
      improvements.push('Technique selection looks solid. Verify edge-case values in the preview before exporting.');
    }

    return (
      <div className="ai-insight-panel">
        <style>{`
          .ai-insight-panel{border:1px solid rgba(251,140,54,0.3);border-radius:18px;padding:20px 24px;background:linear-gradient(135deg,rgba(251,140,54,0.06) 0%,rgba(139,92,246,0.04) 100%);margin-bottom:22px;position:relative;overflow:hidden}
          .ai-insight-panel::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#fb8c36,#a855f7,#22c55e);border-radius:18px 18px 0 0}
          .aip-top{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
          .aip-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;background:rgba(251,140,54,0.12);color:#fb8c36;border:1px solid rgba(251,140,54,0.25);white-space:nowrap}
          .aip-title{font-size:14px;font-weight:800;color:var(--t-primary);margin:0 0 2px}
          .aip-sub{font-size:12px;color:var(--t-secondary);line-height:1.5;margin:0}
          .aip-body{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:18px}
          @media(max-width:900px){.aip-body{grid-template-columns:1fr 1fr}}
          @media(max-width:600px){.aip-body{grid-template-columns:1fr}}
          .aip-block{background:var(--bg-surface);border:1px solid var(--border-mid);border-radius:12px;padding:14px}
          .aip-block-title{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--t-muted);margin-bottom:10px;display:flex;align-items:center;gap:5px}
          .aip-conf-bar-wrap{height:8px;border-radius:999px;background:var(--border-mid);overflow:hidden;margin:6px 0}
          .aip-conf-bar{height:8px;border-radius:999px;transition:width .6s cubic-bezier(.4,0,.2,1)}
          .aip-conf-num{font-size:22px;font-weight:900;line-height:1}
          .aip-conf-label{font-size:11px;color:var(--t-secondary);margin-top:4px}
          .aip-risk-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px}
          .aip-risk-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
          .aip-risk-name{color:var(--t-secondary);flex:1}
          .aip-risk-count{font-weight:700;color:var(--t-primary)}
          .aip-risk-bar-wrap{height:5px;border-radius:999px;background:var(--border-dim);flex:2;overflow:hidden}
          .aip-risk-bar{height:5px;border-radius:999px}
          .aip-improve-item{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--t-secondary);line-height:1.5;margin-bottom:7px;padding-left:2px}
          .aip-improve-item:last-child{margin-bottom:0}
          .aip-improve-dot{width:5px;height:5px;border-radius:50%;background:#fb8c36;flex-shrink:0;margin-top:5px}
          .aip-summary-text{font-size:12px;color:var(--t-secondary);line-height:1.7;margin:0}
          .aip-cov-ring{position:relative;width:64px;height:64px;flex-shrink:0}
          .aip-cov-svg{transform:rotate(-90deg)}
          .aip-cov-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:var(--t-primary)}
        `}</style>

        <div className="aip-top">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <BrainCircuit size={18} color="#fb8c36" />
              <span className="aip-badge">AI Insight · {kindLabel[currentKind]}</span>
              {phase === 'results' && <span className="aip-badge" style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a', borderColor: 'rgba(34,197,94,0.25)' }}>Run Complete</span>}
            </div>
            <p className="aip-title">
              {phase === 'techniques' ? 'Technique Recommendations & Privacy Analysis' : 'Post-Anonymization Privacy Assessment'}
            </p>
            <p className="aip-sub">
              {rawSummary || (phase === 'techniques'
                ? `${total} PII target${total !== 1 ? 's' : ''} detected across ${kindLabel[currentKind]} data — review technique assignments below before running.`
                : `Anonymization complete. ${protected_} of ${total} PII target${total !== 1 ? 's' : ''} protected (${coverage}% coverage).`)}
            </p>
          </div>

          {/* Coverage donut */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <div className="aip-cov-ring">
              <svg className="aip-cov-svg" width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border-mid)" strokeWidth="7" />
                <circle
                  cx="32" cy="32" r="26" fill="none"
                  stroke={coverage >= 80 ? '#22c55e' : coverage >= 50 ? '#f59e0b' : '#ef4444'}
                  strokeWidth="7"
                  strokeDasharray={`${(coverage / 100) * 163.4} 163.4`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="aip-cov-num">{coverage}%</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--t-muted)' }}>Coverage</span>
          </div>
        </div>

        <div className="aip-body">
          {/* Confidence score */}
          <div className="aip-block">
            <div className="aip-block-title">Detection Confidence</div>
            <div className="aip-conf-num" style={{ color: confColor }}>{confScore}%</div>
            <div className="aip-conf-bar-wrap">
              <div className="aip-conf-bar" style={{ width: `${confScore}%`, background: confColor }} />
            </div>
            <div className="aip-conf-label">
              {confScore >= 85 ? 'High confidence — strong PII signal, LLM + NER agreement.' :
               confScore >= 70 ? 'Moderate confidence — review borderline fields.' :
               'Lower confidence — manual review advised for sensitive fields.'}
            </div>
          </div>

          <div className="aip-block">
            <div className="aip-block-title">Risk Distribution</div>
            {([
              { label: 'High', count: highRisk,  color: '#ef4444' },
              { label: 'Medium', count: medRisk, color: '#f59e0b' },
              { label: 'Low', count: lowRisk,    color: '#22c55e' },
            ] as { label: string; count: number; color: string }[]).map(r => (
              <div key={r.label} className="aip-risk-row">
                <span className="aip-risk-dot" style={{ background: r.color }} />
                <span className="aip-risk-name">{r.label}</span>
                <div className="aip-risk-bar-wrap">
                  <div className="aip-risk-bar" style={{ width: total > 0 ? `${(r.count / total) * 100}%` : '0%', background: r.color }} />
                </div>
                <span className="aip-risk-count">{r.count}</span>
              </div>
            ))} 
            {total === 0 && <p style={{ fontSize: 12, color: 'var(--t-muted)', margin: 0 }}>No PII targets detected.</p>}
          </div>

          <div className="aip-block">
            <div className="aip-block-title">Improvement Tips</div>
            {improvements.map((tip, i) => (
              <div key={i} className="aip-improve-item">
                <span className="aip-improve-dot" />
                {tip}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const currentKind = detectDataKind(structuredRaw, unstructuredRaw, imageRaw, audioRaw);
  const currentFile = structuredFile ?? unstructuredFile ?? imageFile ?? audioFile ?? uploadedFile;
  const techniqueTargets = getTargets(currentKind, structuredRaw, unstructuredRaw, imageRaw, audioRaw);
  const copyRows = useMemo(() => {
    const count = Number(results?.num_copies || 0);
    if (!results?.zip_base64 || count <= 1) return[];
    const sourceName = currentFile?.name || selectedDs?.name || results?.filename || 'dataset';
    const baseName = withoutExtension(sourceName);
    const sourceExt = `.${getExtension(currentFile || null) || (currentKind === 'audio' ? 'wav' : currentKind === 'image' ? 'png' : 'txt')}`;
    const resultExt = `.${getNameExtension(results?.filename) || sourceExt.replace('.', '')}`;

    return Array.from({ length: count }, (_, index) => {
      const copyNum = index + 1;
      if (currentKind === 'structured') return { copyNum, files: `${baseName}_copy_${copyNum}.csv` };
      if (currentKind === 'image') return { copyNum, files: `${baseName}_copy_${copyNum}${sourceExt}` };
      if (currentKind === 'audio') return { copyNum, files: `${baseName}_copy_${copyNum}.wav` };
      if (resultExt === '.txt') return { copyNum, files: `${baseName}_copy_${copyNum}.txt` };
      return { copyNum, files: `${baseName}_copy_${copyNum}${resultExt} + ${baseName}_copy_${copyNum}.txt` };
    });
  }, [results, currentFile, selectedDs, currentKind]);

  const commonMetrics = useMemo(() => {
    if (currentKind === 'structured') {
      const rows = (structuredRaw?.result?.['Column Name'] ?? []) as string[];
      const piiColumns = techniqueTargets.length;
      return {
        piiCount: piiColumns,
        total: rows.length,
        protected: techniqueTargets.filter((target) => techniqueMap[target.key] && techniqueMap[target.key] !== 'none').length,
        risk: techniqueTargets.filter((target) => upper(target.risk) === 'HIGH').length,
      };
    }
    if (currentKind === 'image') {
      return {
        piiCount: (imageRaw?.entities ??[]).length,
        total: (imageRaw?.entities ?? []).length,
        protected: techniqueTargets.filter((target) => techniqueMap[target.key] === 'redact').length,
        risk: imageRaw?.metrics?.risk_score ?? 0,
      };
    }
    if (currentKind === 'audio') {
      return {
        piiCount: (audioRaw?.entities ?? []).length,
        total: (audioRaw?.entities ??[]).length,
        protected: techniqueTargets.filter((target) => techniqueMap[target.key] === 'mute' || techniqueMap[target.key] === 'beep').length,
        risk: audioRaw?.metrics?.risk_score ?? 0,
      };
    }
    return {
      piiCount: unstructuredRaw?.pii_confirmed ?? 0,
      total: unstructuredRaw?.pii_candidates_found ?? 0,
      protected: techniqueTargets.filter((target) => techniqueMap[target.key] && techniqueMap[target.key] !== 'none').length,
      risk: unstructuredRaw?.metrics?.risk_score ?? 0,
    };
  },[currentKind, structuredRaw, imageRaw, audioRaw, unstructuredRaw, techniqueTargets, techniqueMap]);

  const liveStructuredPreview = useMemo(() => buildStructuredPreview(structuredRaw?.raw_preview ?? [], techniqueMap), [structuredRaw, techniqueMap]);
  const liveUnstructuredPreview = useMemo(() => buildUnstructuredPreview(unstructuredRaw?.preview ?? '', unstructuredRaw?.results ??[], techniqueMap), [unstructuredRaw, techniqueMap]);

  const handleRunAnonymization = async () => {
    if (!selectedDs) return;
    setIsProcessing(true);
    setError(null);
    try {
      const fileToProcess = currentFile ?? buildProcessingFile();
      if (!fileToProcess) throw new Error('No file available for anonymization.');
      const config = Object.fromEntries(Object.entries(techniqueMap).filter(([, value]) => value));
      const policy = selectedPolicies.join(',');
      let response;
      if (activeSample?.results) {
        let blobUrl = activeSample.results.blobUrl;
        if (activeSample.result_url) {
          const resultResponse = await fetch(toAbsoluteBackendUrl(activeSample.result_url));
          if (!resultResponse.ok) throw new Error(`Failed to load sample result: ${activeSample.result_file ?? activeSample.results.filename ?? 'sample output'}`);
          const resultBlob = await resultResponse.blob();
          blobUrl = URL.createObjectURL(resultBlob);
        }
        response = {
          ...activeSample.results,
          blobUrl,
        };
      } else if (currentKind === 'structured') response = await anonymizeStructured(fileToProcess, config, policy, numCopies);
      else if (currentKind === 'image') response = await anonymizeImage(fileToProcess, config, policy, numCopies);
      else if (currentKind === 'audio') response = await anonymizeAudio(fileToProcess, config, audioRaw, policy, numCopies);
      else response = await anonymizeUnstructured(fileToProcess, config, policy, numCopies);
      setResults(response);
      setActiveStep('export');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during processing.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!results) return;
    try {
      setIsDownloading(true);
      setError(null);
      if (results?.blobUrl) {
        const link = document.createElement('a');
        link.href = results.blobUrl;
        link.download = results?.filename || `anonymized_${selectedDs?.name ?? 'dataset'}`;
        link.click();
      } else if (currentKind === 'structured' && results?.blob_path && results?.filename) {
        const { blobUrl, filename } = await downloadStructuredAnonymizedFile(results.blob_path, results.filename);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(blobUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleGovDatasetSelect = (file: File, datasetName: string) => {
    setUploadedFile(file);
    setSelectedDs({ id: Date.now(), name: datasetName, desc: 'Fetched from data.gov.in', cat: 'Gov', isStr: true });
    resetClassificationState();
    assignProcessingFile(file);
    setError(null);
    setActiveStep('classification');
  };

  const handleBlobSelect = (blobPath: string, fileName: string) => {
    const markerContent = `__blob_path__:${blobPath}`;
    const file = new File([markerContent], fileName, { type: 'text/csv' });
    setUploadedFile(file);
    setSelectedDs({ id: Date.now(), name: fileName, desc: `From Azure Blob: ${blobPath}`, cat: 'Blob', isStr: true });
    resetClassificationState();
    assignProcessingFile(file);
    setError(null);
    setActiveStep('classification');
  };

  const renderInput = () => (
    <div className="xt-anon-layout fade-in">
      <div className="xt-panel">
        <style>{`
          .inp-tabs{display:flex;gap:0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:20px}
          .inp-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:11px 14px;font-size:13px;font-weight:700;background:#f8fafc;color:#64748b;border:none;cursor:pointer;transition:all .15s;border-right:1px solid #e2e8f0}
          .inp-tab:last-child{border-right:none}
          .inp-tab.active{background:#fff7ed;color:#c2410c}
          .inp-tab:hover:not(.active){background:#fff;color:#334155}
        `}</style>
        <h2 className="xt-panel-title">Select Your Dataset</h2>
        <p className="xt-panel-subtitle">Browse 277k+ government datasets, pick a file from Azure Blob Storage, upload from your device, or walk through a stored sample demo.</p>

        <div className="inp-tabs">
          <button className={`inp-tab${activeTab === 'gov' ? ' active' : ''}`} onClick={() => setActiveTab('gov')}>
            <Globe size={15} /> data.gov.in
          </button>
          <button className={`inp-tab${activeTab === 'blob' ? ' active' : ''}`} onClick={() => setActiveTab('blob')}>
            <Cloud size={15} /> Azure Storage
          </button>
          <button className={`inp-tab${activeTab === 'upload' ? ' active' : ''}`} onClick={() => setActiveTab('upload')}>
            <Upload size={15} /> Upload File
          </button>
          <button className={`inp-tab${activeTab === 'sample' ? ' active' : ''}`} onClick={() => setActiveTab('sample')}>
            <Play size={15} /> Sample Demo
          </button>
        </div>

        {activeTab === 'gov' && <GovCatalogView onSelect={handleGovDatasetSelect} />}
        {activeTab === 'blob' && <BlobCatalogView onSelect={handleBlobSelect} />}
        {activeTab === 'upload' && (
          <>
            <div className="xt-upload-zone">
              <Upload size={36} color="#fb8c36" />
              <p>{uploadedFile ? `Selected: ${uploadedFile.name}` : 'Upload structured (CSV/XLSX/JSON), document (PDF/DOCX/TXT), image (PNG/JPG…), or audio (WAV/MP3)'}</p>
              <input
                id="anonymization-upload-input"
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                onClick={(e) => { e.currentTarget.value = ''; }}
                onChange={handleFileUpload}
                className="xt-visually-hidden-input"
              />
              <label
                htmlFor="anonymization-upload-input"
                className="xt-upload-btn"
                style={{
                  background: 'linear-gradient(135deg, #fb8c36 0%, #f97316 60%, #ea580c 100%)',
                  color: '#fff',
                  boxShadow: '0 4px 18px rgba(251,140,54,0.45), 0 1px 4px rgba(0,0,0,0.12)',
                  border: 'none',
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '.02em',
                  transition: 'transform .15s, box-shadow .15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform='translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow='0 8px 28px rgba(251,140,54,0.55),0 2px 6px rgba(0,0,0,0.14)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform=''; (e.currentTarget as HTMLElement).style.boxShadow='0 4px 18px rgba(251,140,54,0.45),0 1px 4px rgba(0,0,0,0.12)'; }}
              >
                <Upload size={15} /> Browse &amp; Upload File
              </label>
            </div>
            {uploadedFile && selectedDs && (
              <div style={{ marginTop: 18, textAlign: 'right' }}>
                <button
                  className="xt-upload-btn"
                  onClick={() => { assignProcessingFile(uploadedFile); setActiveStep('classification'); }}
                >
                  Continue to Classification <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}

        {activeTab === 'sample' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              {sampleCatalog.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => handleSampleSelect(sample)}
                  disabled={isProcessing}
                  style={{
                    textAlign: 'left',
                    padding: '16px',
                    borderRadius: '14px',
                    border: '1px solid var(--border-mid)',
                    background: 'var(--bg-surface)',
                    cursor: isProcessing ? 'wait' : 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <strong style={{ color: 'var(--t-primary)', fontSize: 15 }}>{sample.label}</strong>
                    <span className="da-pii-badge">{titleCase(sample.kind)}</span>
                  </div>
                  <p style={{ margin: '0 0 12px 0', color: 'var(--t-secondary)', fontSize: 13, lineHeight: 1.6 }}>{sample.description}</p>
                  <div style={{ color: 'var(--t-muted)', fontSize: 12, marginBottom: 12 }}>{sample.source_file}</div>
                  <span className="xt-upload-btn" style={{ width: '100%', justifyContent: 'center' }}>
                    <Play size={14} /> Open Sample
                  </span>
                </button>
              ))}
            </div>
            {sampleLoading ? <p style={{ marginTop: 14, color: 'var(--t-secondary)' }}>Loading sample demos...</p> : null}
            {!sampleLoading && sampleCatalog.length === 0 ? <p style={{ marginTop: 14, color: 'var(--t-secondary)' }}>No sample demos were found in the shared sample folder.</p> : null}
          </div>
        )}
        <PolicySelector />
      </div>

      <div className="xt-workflow-card">
        <p className="xt-workflow-title">About the data sources</p>
        <ul className="xt-workflow-list">
          <li><strong>data.gov.in</strong> — 277k+ live Central Government datasets, searchable by sector.</li>
          <li><strong>Azure Storage</strong> — files already uploaded to your project's Blob container.</li>
          <li><strong>Upload File</strong> — CSV, Excel, JSON, PDF, DOCX, TXT, image, or audio from your device.</li>
          <li><strong>Sample Demo</strong> — precomputed structured, unstructured, image, and audio walkthroughs loaded from `AIKoshIntegrated/sample`.</li>
        </ul>
      </div>
    </div>
  );

  const renderTechniques = () => (
    <div className="xt-panel fade-in">
      <h2 className="xt-panel-title">Technique Configuration</h2>
      <p className="xt-panel-subtitle">
        Select the anonymization technique for each detected PII field.
        Changes are previewed in real-time on the right.
      </p>

      {isSampleMode ? (
        <div className="da-ai-box" style={{ marginTop: 0, marginBottom: 16 }}>
          <p>This sample walkthrough uses stored classifications and stored anonymization results from the shared demo folder. Technique selections are shown as preloaded demo settings.</p>
        </div>
      ) : null}
      <AIInsightPanel phase="techniques" />

      <div className="da-metrics">
        <div className="da-card"><span>Detected PII</span><strong>{commonMetrics.piiCount}</strong></div>
        <div className="da-card"><span>Targets Protected</span><strong>{commonMetrics.protected}</strong></div>
        <div className="da-card"><span>Total Scope</span><strong>{commonMetrics.total}</strong></div>
        <div className="da-card"><span>Risk Signal</span><strong>{commonMetrics.risk}</strong></div>
      </div>

      <div className="da-layout">
        <div className="da-panel">
          <div className="da-section-head"><Lock size={16} /> PII Targets &amp; Techniques</div>

          {techniqueTargets.length > 0 ? (
            <div className="da-table-wrap">
              <table className="da-table">
                <thead>
                  <tr>
                    {currentKind === 'structured' && <th>Column</th>}
                    {currentKind === 'structured' && <th>Data Type</th>}
                    {currentKind !== 'structured' && <th>Entity Type</th>}
                    <th>PII Type (LLM)</th>
                    {currentKind === 'structured' && <th>PII Type (NER)</th>}
                    {currentKind === 'structured' && <th>Sensitivity</th>}
                    <th>Risk</th>
                    <th>Sample Value</th>
                    <th>Technique</th>
                  </tr>
                </thead>
                <tbody>
                  {techniqueTargets.map((target) => {
                    const sens = getSensitivityBadge(target.sensitivity);
                    const riskColor = getRiskColor(target.risk);
                    const availableTechs = TECHNIQUES[currentKind];
                    const selectedTech = techniqueMap[target.key] ?? defaultTechnique(currentKind, target.piiType, target.risk);
                    const isActive = activePreview?.target.key === target.key;
                    return (
                      <tr
                        key={target.key}
                        style={{ background: isActive ? 'var(--bg-glass-md)' : undefined, outline: isActive ? '2px solid #fb8c36' : undefined }}
                        onClick={() => setActivePreview({ target, technique: selectedTech })}
                      >
                        <td><strong>{target.label}</strong></td>
                        {currentKind === 'structured' && (
                          <td><span className="da-dtype">{target.dataType || '—'}</span></td>
                        )}
                        <td>
                          <span className="da-pii-badge">{titleCase(target.piiType)}</span>
                        </td>
                        {currentKind === 'structured' && (
                          <td>
                            {target.nerPiiType
                              ? <span className="da-pii-badge" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{titleCase(target.nerPiiType)}</span>
                              : <span className="da-muted">—</span>}
                          </td>
                        )}
                        {currentKind === 'structured' && (
                          <td>
                            <span className="da-sens-badge" style={{ background: sens.bg, color: sens.color }}>{sens.label}</span>
                          </td>
                        )}
                        <td>
                          <span className="da-risk-badge" style={{ color: riskColor, background: `${riskColor}18` }}>
                            {titleCase(target.risk ?? 'Low')}
                          </span>
                        </td>
                        <td><span className="da-sample">{target.sample}</span></td>
                        <td>
                          <select
                            className="da-tech-select"
                            value={selectedTech}
                            disabled={isSampleMode}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const next = e.target.value as TechniqueId;
                              setTechniqueMap((prev) => ({ ...prev, [target.key]: next }));
                              setActivePreview({ target, technique: next });
                            }}
                          >
                            {availableTechs.map((tech) => (
                              <option key={tech.id} value={tech.id}>{tech.icon} {tech.label}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--t-secondary)', margin: 0, padding: '12px 0' }}>
              No PII targets were detected, so there are no type-specific techniques to apply.
            </p>
          )}

          {activePreview ? (() => {
            const ex = getExamplePreview(activePreview.technique, activePreview.target.piiType, activePreview.target.sample);
            const tech = ALL_TECHNIQUES.find(t => t.id === activePreview.technique)!;
            return (
              <div className="da-example-panel">
                <div className="da-example-head">
                  <span>{tech.icon}</span>
                  <span><strong>{tech.label}</strong> applied to <strong>{activePreview.target.label}</strong></span>
                </div>
                <div className="da-example-row">
                  <div className="da-example-col">
                    <div className="da-example-label">Original value</div>
                    <div className="da-example-val da-example-before">{ex.before}</div>
                  </div>
                  <div className="da-example-arrow">to</div>
                  <div className="da-example-col">
                    <div className="da-example-label">After {tech.label}</div>
                    <div className="da-example-val da-example-after">{ex.after}</div>
                  </div>
                </div>
                <p className="da-example-note">{ex.note}</p>
              </div>
            );
          })() : (
            <div className="da-example-hint">
              <span>Tip:</span>
              <span>Click any row or change a technique dropdown to see a live example of the anonymized value.</span>
            </div>
          )}
        </div>

        <div className="da-panel">
          <div className="da-section-head"><Eye size={16} /> Live Technique Preview</div>
          {currentKind === 'structured' ? (
            <div className="da-table-wrap">
              <table className="da-table">
                <thead><tr>{Object.keys(liveStructuredPreview[0] ?? {}).map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>
                  {liveStructuredPreview.map((row, index) => (
                    <tr key={index}>{Object.entries(row).map(([column, value]) => <td key={`${index}-${column}`}>{String(value ?? '') || '—'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : currentKind === 'image' ? (
            <div className="da-image-preview">
              {previewImageUrl && <img src={previewImageUrl} alt="Uploaded preview" />}
              <p>Image anonymization preview focuses on the detected regions. Regions set to <strong>Redact</strong> will be blocked in the final result.</p>
            </div>
          ) : (
            <div className="da-text-preview">{liveUnstructuredPreview || 'Preview unavailable.'}</div>
          )}

          {currentKind === 'unstructured' && ['pdf', 'docx', 'doc'].includes(getExtension(currentFile)) && (
            <div className="da-ai-box" style={{ marginTop: 16 }}>
              <div className="da-section-head"><FileText size={16} /> Generate Multiple Copies</div>
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'block', marginBottom: 8, color: 'var(--t-primary)', fontSize: 13, fontWeight: 500 }}>
                  Number of anonymized copies to create:
                </label>
                <select
                  value={numCopies}
                  onChange={(e) => setNumCopies(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'copy' : 'copies'}
                    </option>
                  ))}
                </select>
                <p style={{ margin: '8px 0 0 0', fontSize: 12 }}>
                  Generate up to 10 different variations with varied anonymization. All copies will be available as a ZIP download.
                </p>
              </div>
            </div>
          )}

          <button
            className="xt-upload-btn"
            style={{ marginTop: 18, width: '100%', justifyContent: 'center' }}
            onClick={handleRunAnonymization}
            disabled={isProcessing}
          >
            {isProcessing ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}
            {isProcessing ? ' Applying Techniques...' : isSampleMode ? 'Load Stored Sample Results' : 'Apply Selected Techniques'}
          </button>
          {error ? <p style={{ color: '#ef4444', fontSize: 13, marginTop: 12 }}><AlertCircle size={12} /> {error}</p> : null}
        </div>
      </div>
      
      {/* Try Other Features added here */}
      <TryOtherFeatures current="anon" onNavigateFeature={onNavigateFeature} />
      
    </div>
  );

  const renderResults = () => (
    <div className="xt-panel fade-in">
      <div className="xt-success-banner">
        <CheckCircle2 size={40} color="#16a34a" />
        <div>
          <h3>Anonymization Complete</h3>
          <p>The selected techniques were applied to the current data type and the sanitized result is ready.</p>
        </div>
      </div>

      <AIInsightPanel phase="results" />

      <div className="da-metrics">
        <div className="da-card"><span>PII Protected</span><strong>{commonMetrics.protected}</strong></div>
        <div className="da-card"><span>Total PII</span><strong>{commonMetrics.piiCount}</strong></div>
        <div className="da-card"><span>Coverage Score</span><strong>{commonMetrics.piiCount === 0 ? '100%' : `${Math.round((commonMetrics.protected / commonMetrics.piiCount) * 100)}%`}</strong></div>
        <div className="da-card"><span>Download</span><strong>{results?.filename ?? 'Ready'}</strong></div>
      </div>
      <div className="da-layout">
        <div className="da-panel">
          <div className="da-section-head"><FileText size={16} /> Change Report</div>
          <div className="da-table-wrap">
            <table className="da-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>PII Type</th>
                  <th>Sample</th>
                  <th>Applied Technique</th>
                </tr>
              </thead>
              <tbody>
                {techniqueTargets.map((target) => (
                  <tr key={target.key}>
                    <td><strong>{target.label}</strong></td>
                    <td><span className="da-pii-badge">{titleCase(target.piiType)}</span></td>
                    <td><span className="da-sample">{target.sample}</span></td>
                    <td>
                      <span className="da-tech-applied">
                        {TECHNIQUES[currentKind].find((item) => item.id === techniqueMap[target.key])?.label ?? 'Not set'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="da-panel">
          <div className="da-section-head">{currentKind === 'image' ? <ImageIcon size={16} /> : <Eye size={16} />} Changed Data Preview</div>
          {currentKind === 'structured' ? (
            <div className="da-table-wrap">
              <table className="da-table">
                <thead><tr>{Object.keys(results?.masked_preview?.[0] ?? {}).map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>
                  {(results?.masked_preview ??[]).map((row: Record<string, string>, index: number) => (
                    <tr key={index}>{Object.entries(row).map(([column, value]) => <td key={`${index}-${column}`}>{value || '—'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : currentKind === 'image' ? (
            <div className="da-image-preview">
              {results?.blobUrl ? <img src={results.blobUrl} alt="Anonymized result" /> : null}
              <p>Detected regions configured for redaction have been blocked in the output image.</p>
            </div>
          ) : currentKind === 'audio' ? (
            <div className="da-audio-preview" style={{ padding: '24px', background: 'var(--bg-elevated)', borderRadius: '14px', textAlign: 'center', border: '1px solid var(--border-mid)' }}>
              <p style={{ marginBottom: '14px', color: 'var(--t-secondary)', fontSize: '14px', fontWeight: 600 }}>Audio successfully anonymized.</p>
              {results?.blobUrl ? <audio controls src={results.blobUrl} style={{ width: '100%', outline: 'none' }} /> : null}
            </div>
          ) : results?.media_type === 'application/pdf' && results?.blobUrl ? (
            <div className="da-doc-preview">
              <iframe title="Anonymized PDF preview" src={`${results.blobUrl}#page=1&view=FitH`} />
              <p>PDF redaction generated from the integrated document anonymization pipeline.</p>
              {results?.preview ? <div className="da-text-preview">{results.preview}</div> : null}
            </div>
          ) : (
            <div className="da-text-preview">{results?.preview || liveUnstructuredPreview || 'Preview unavailable.'}</div>
          )}

          {copyRows.length > 0 && (
            <div className="da-ai-box" style={{ marginTop: 16 }}>
              <div className="da-section-head"><CheckCircle2 size={16} /> {results.num_copies} Anonymized Copies Generated</div>
              <p style={{ marginBottom: 14, fontSize: 13, color: '#4b5563' }}>
                All {results.num_copies} variations with different anonymization are ready to download as a single ZIP file.
              </p>
              <table className="da-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Copy</th>
                    <th>File</th>
                  </tr>
                </thead>
                <tbody>
                  {copyRows.map((row) => {
                    return (
                      <tr key={row.copyNum}>
                        <td><strong>Copy {row.copyNum}</strong></td>
                        <td><span className="da-sample">{row.files}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="da-downloads">
            {results?.zip_base64 && results?.num_copies > 1 && (
              <button
                className="xt-upload-btn"
                style={{ marginBottom: 10 }}
                onClick={() => {
                  const byteCharacters = atob(results.zip_base64);
                  const byteNumbers = Array.from(byteCharacters).map(char => char.charCodeAt(0));
                  const byteArray = new Uint8Array(byteNumbers);
                  const blob = new Blob([byteArray], { type: 'application/zip' });
                  const link = document.createElement('a');
                  link.href = URL.createObjectURL(blob);
                  link.download = `anonymized_${results.num_copies}_copies.zip`;
                  link.click();
                  URL.revokeObjectURL(link.href);
                }}
              >
                <Download size={14} /> Download All as ZIP
              </button>
            )}
            <button className="xt-upload-btn" onClick={handleDownload} disabled={isDownloading}>
              <Download size={14} /> {isDownloading ? 'Downloading...' : 'Download Sanitized Output'}
            </button>
          </div>
        </div>
      </div>
      
      {/* Try Other Features added here */}
      <TryOtherFeatures current="anon" onNavigateFeature={onNavigateFeature} />
      
    </div>
  );

  return (
    <div className="xt-page">
      <style>{`
        .xt-page{background:var(--bg-root);color:var(--t-primary)}
        .xt-panel,.xt-stepper-card,.xt-workflow-card,.xt-upload-zone{background:var(--bg-surface);border-color:var(--border-mid);color:var(--t-primary)}
        .xt-panel-title,.xt-header-title,.xt-workflow-title{color:var(--t-primary)}
        .xt-panel-subtitle,.xt-header-subtitle,.xt-workflow-list,.xt-back-btn{color:var(--t-secondary)}
        .xt-step-circle{background:var(--bg-elevated);border-color:var(--border-mid);color:var(--t-secondary)}
        .xt-connector{background:var(--border-mid)}
        .xt-tab,.inp-tab,.pol-item{background:var(--bg-elevated)!important;color:var(--t-secondary)!important;border-color:var(--border-mid)!important}
        .xt-tab.active,.inp-tab.active,.pol-item.active{background:var(--bg-surface)!important;color:var(--t-primary)!important;border-color:var(--brand)!important}
        .pol-search-input,.da-tech-select{background:var(--bg-elevated);border-color:var(--border-mid);color:var(--t-primary)}
        .pol-name,.tt-name{color:var(--t-primary)}
        .pol-desc,.tt-coverage{color:var(--t-secondary)}
        .pol-tooltip{background:var(--bg-surface);border-color:var(--brand)}
        .xt-success-banner{background:color-mix(in srgb,var(--accent-green) 12%,var(--bg-surface));border:1px solid color-mix(in srgb,var(--accent-green) 40%,var(--border-mid));color:var(--t-primary)}
        .xt-success-banner h3,.xt-success-banner p{color:var(--t-primary)}
        .da-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:20px 0}
        .da-card{border:1px solid var(--border-mid);border-radius:14px;padding:16px;background:var(--bg-elevated)}
        .da-card span{display:block;color:var(--t-secondary);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
        .da-card strong{display:block;font-size:clamp(22px,2vw,28px);color:var(--t-primary);overflow-wrap:anywhere;word-break:break-word;line-height:1.18;max-width:100%}
        .da-layout{display:grid;grid-template-columns:1.35fr .9fr;gap:20px}
        .da-panel{border:1px solid var(--border-mid);border-radius:16px;padding:18px;background:var(--bg-surface);min-width:0}
        .da-section-head{display:flex;align-items:center;gap:8px;color:var(--t-primary);font-size:15px;font-weight:700;margin-bottom:14px}
        .da-table-wrap{overflow:auto;border:1px solid var(--border-mid);border-radius:14px;margin-bottom:16px;max-height:360px}
        .da-table{width:100%;border-collapse:collapse;min-width:500px;font-size:13px}
        .da-table thead tr{background:var(--bg-elevated)}
        .da-table th{padding:11px 14px;text-align:left;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted);white-space:nowrap;border-bottom:2px solid var(--border-mid)}
        .da-table td{padding:12px 14px;border-top:1px solid var(--border-dim);vertical-align:middle;color:var(--t-primary)}
        .da-table tbody tr:hover{background:var(--bg-glass-md)}
        .da-pii-badge{display:inline-block;background:var(--brand-glow);color:var(--brand-light);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700}
        .da-sens-badge{display:inline-block;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700}
        .da-risk-badge{display:inline-block;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700}
        .da-dtype{color:var(--t-secondary);font-size:12px}
        .da-sample{color:var(--t-secondary);font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
        .da-muted{color:var(--t-muted);font-size:12px}
        .da-tech-select{padding:7px 10px;border-radius:8px;border:1px solid var(--border-mid);font-size:12px;color:var(--t-primary);background:var(--bg-elevated);cursor:pointer;min-width:130px;transition:border-color .15s}
        .da-tech-select:hover{border-color:#fb8c36}
        .da-tech-select:focus{outline:none;border-color:#fb8c36;box-shadow:0 0 0 3px rgba(251,140,54,.12)}
        .da-tech-applied{background:var(--bg-glass-md);color:var(--accent-green);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700}
        .da-tech-legend{margin-top:16px;display:flex;flex-direction:column;gap:5px;padding:12px;background:var(--bg-elevated);border-radius:12px;border:1px solid var(--border-mid)}
        .da-legend-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--t-muted);margin-bottom:4px}
        .da-legend-item{display:flex;gap:8px;align-items:flex-start;padding:4px 0}
        .da-legend-icon{font-size:14px;flex-shrink:0;margin-top:1px}
        .da-legend-name{font-size:12px;font-weight:700;color:var(--t-primary);min-width:130px;flex-shrink:0}
        .da-legend-desc{font-size:12px;color:var(--t-secondary);line-height:1.5}
        .da-example-panel{margin-top:14px;border:2px solid var(--brand);border-radius:14px;padding:14px;background:var(--bg-surface);animation:da-fadein .2s ease}
        @keyframes da-fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        .da-example-head{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;color:var(--t-primary)}
        .da-example-row{display:flex;align-items:center;gap:12px;background:var(--bg-elevated);border:1px solid var(--brand-glow);border-radius:12px;padding:12px 16px}
        .da-example-col{flex:1;min-width:0}
        .da-example-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--t-muted);margin-bottom:5px}
        .da-example-val{font-size:14px;font-weight:700;font-family:monospace;border-radius:8px;padding:6px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .da-example-before{background:var(--bg-glass);color:var(--accent-purple);border:1px solid var(--border-mid)}
        .da-example-after{background:var(--bg-glass-md);color:var(--accent-green);border:1px solid var(--border-bright)}
        .da-example-arrow{font-size:22px;color:var(--brand);font-weight:900;flex-shrink:0}
        .da-example-note{margin:10px 0 0;font-size:12px;color:var(--t-secondary);line-height:1.6;font-style:italic}
        .da-example-hint{display:flex;align-items:center;gap:10px;margin-top:14px;padding:12px;background:var(--bg-elevated);border:1px dashed var(--border-bright);border-radius:12px;color:var(--t-muted);font-size:13px}
        .da-table tbody tr{cursor:pointer;transition:background .12s}
        .da-table tbody tr:hover{background:var(--bg-glass) !important}
        .da-text-preview{min-height:260px;max-height:420px;overflow-y:auto;border:1px solid var(--border-mid);border-radius:14px;padding:16px;background:var(--bg-elevated);white-space:pre-wrap;line-height:1.8;color:var(--t-secondary);font-size:13px}
        .da-image-preview{border:1px solid var(--border-mid);border-radius:14px;padding:14px;background:var(--bg-elevated);max-height:520px;overflow:auto}
        .da-image-preview img{display:block;max-width:100%;max-height:440px;border-radius:10px;margin-bottom:12px}
        .da-doc-preview{border:1px solid var(--border-mid);border-radius:14px;padding:14px;background:var(--bg-elevated);display:flex;flex-direction:column;gap:12px}
        .da-doc-preview iframe{width:100%;min-height:420px;max-height:520px;border:1px solid var(--border-mid);border-radius:10px;background:#fff}
        .da-doc-preview p{margin:0;color:var(--t-secondary);font-size:13px}
        .da-image-preview p,.da-downloads{margin:0;color:var(--t-secondary);font-size:13px}
        .da-downloads{margin-top:18px}
        .da-ai-box{border:1px solid var(--border-mid);border-radius:14px;padding:14px;background:var(--bg-elevated);margin-top:14px}
        .da-ai-box p{margin:6px 0 0;color:var(--t-secondary);font-size:13px;line-height:1.6}
        .da-report-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--border-mid);border-radius:12px;background:var(--bg-elevated)}
        .da-report-row p{margin:6px 0 0;color:var(--t-secondary);font-size:13px}
        @media (max-width:1100px){.da-metrics,.da-layout{grid-template-columns:1fr}}
        .xt-success-banner{margin-bottom:20px}
      `}</style>

      <button className="xt-back-btn" onClick={onBack}><ArrowLeft size={14} /> Back to Data Tools</button>

      <div className="xt-header">
        <div className="xt-header-icon"><Shield size={26} /></div>
        <div>
          <h1 className="xt-header-title">Data Anonymization</h1>
          <p className="xt-header-subtitle">Type-aware classification, tabular technique selection, and results reporting for structured, text, and image data.</p>
        </div>
      </div>

      <div className="xt-stepper-card">
        <div className="xt-stepper">
          {[
            { id: 'input', label: 'Data Input', Icon: Upload },
            { id: 'classification', label: 'Classification', Icon: Shield },
            { id: 'techniques', label: 'Techniques', Icon: Lock },
            { id: 'export', label: 'Results', Icon: Download },
          ].map((step, index, all) => {
            const isActive = step.id === activeStep;
            const done = all.findIndex((item) => item.id === activeStep) > index;
            return (
              <div key={step.id} style={{ display: 'flex', flex: index === all.length - 1 ? 0 : 1, alignItems: 'flex-start' }}>
                <div className="xt-step" onClick={() => { if (done || isActive) setActiveStep(step.id as AnonStep); }} style={{ cursor: done || isActive ? 'pointer' : 'default' }}>
                  <div className={`xt-step-circle${isActive ? ' active' : done ? ' done' : ''}`}><step.Icon size={20} /></div>
                  <span className={`xt-step-label${isActive ? ' active' : ''}`}>{step.label}</span>
                </div>
                {index < all.length - 1 ? <div className={`xt-connector${done ? ' done' : ''}`} /> : null}
              </div>
            );
          })}
        </div>
      </div>

      {activeStep === 'input' ? renderInput() : null}
      {activeStep === 'classification' ? (
        <ClassificationStage
          structuredFile={structuredFile}
          unstructuredFile={unstructuredFile}
          imageFile={imageFile}
          audioFile={audioFile}
          policy={selectedPolicies?.join(',') || 'Global'}
          sampleData={activeSample ? { id: activeSample.id, kind: activeSample.kind, classification: activeSample.classification } : null}
          onComplete={handleClassificationComplete}
          onBack={() => setActiveStep('input')}
        />
      ) : null}
      {activeStep === 'techniques' ? renderTechniques() : null}
      {activeStep === 'export' ? renderResults() : null}
    </div>
  );
};

export default DataAnonymizationPage;