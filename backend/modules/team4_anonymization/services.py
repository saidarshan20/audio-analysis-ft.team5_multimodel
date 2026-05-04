import os
import io
import ssl

try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context
import re
import json
import logging
import shutil
import pandas as pd
import numpy as np
# ── Azure imports commented out (not available / using free alternatives) ──
# from azure.ai.formrecognizer import DocumentAnalysisClient
# from azure.core.credentials import AzureKeyCredential
# from azure.storage.blob import BlobServiceClient
# from openai import AzureOpenAI
# ── Free alternative: Groq (llama-3.3-70b-versatile) for LLM tasks ─────────
try:
    from groq import Groq as GroqClient
    _GROQ_AVAILABLE = True
except ImportError:
    _GROQ_AVAILABLE = False

# ── EasyOCR: deep-learning OCR replacing Azure Document Intelligence ─────────
# Loaded lazily on first use to avoid heavy startup cost (~100 MB model).
_easyocr_reader = None

def _get_easyocr_reader():
    """Lazy singleton for EasyOCR reader (CPU, English)."""
    global _easyocr_reader
    if _easyocr_reader is None:
        try:
            import easyocr
            _easyocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
            logging.getLogger("uvicorn.error").info("EasyOCR reader loaded successfully.")
        except ImportError:
            logging.getLogger("uvicorn.error").warning(
                "easyocr not installed. Run: pip install easyocr. Falling back to Tesseract."
            )
    return _easyocr_reader
from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from dotenv import load_dotenv
from .utils import POLICY_CONFIG, filtered_analyze, _is_false_positive, MIN_SCORE

load_dotenv()
logger = logging.getLogger("uvicorn.error")

# ── AzureDocIntelService: Azure implementation commented out. ─────────────
# The class is kept as a stub that routes directly to the local Tesseract
# fallback (pytesseract + pdfplumber) which was already the fallback path.
# No Azure credentials required.
class AzureDocIntelService:
    def __init__(self):
        # Azure Document Intelligence is DISABLED — using local OCR only
        # self.endpoint = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "")
        # self.key = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY", "")
        self.client = None  # Always None — forces local Tesseract/pdfplumber path
        logger.info("AzureDocIntelService: Azure disabled — using local OCR (pytesseract/pdfplumber).")

    def extract_text(self, file_bytes: bytes) -> str:
        """
        Quick full-text extraction for non-image files.
        For images, delegates to extract_words_with_boxes which uses EasyOCR.
        For PDFs/DOCX/TXT the marker below causes utils.extract_text() to use
        pdfplumber / python-docx / plain read — no change needed there.
        """
        # Return error marker → utils.extract_text() falls through to
        # pdfplumber (PDF), python-docx (DOCX), or plain read (TXT).
        return "[Error: Azure Doc Intelligence disabled. Using local text extraction.]"

    def extract_words_with_boxes(self, file_bytes: bytes) -> dict:
        """
        Returns full concatenated text AND a list of words with bounding boxes.

        Priority:
          1. EasyOCR  — deep-learning OCR (CRAFT detector + CRNN recogniser).
                        Best free accuracy; handles complex fonts, rotations,
                        low-resolution scans much better than Tesseract.
          2. Tesseract — classical OCR fallback if EasyOCR is unavailable.

        Output format mirrors the old Azure Doc Intelligence response so the
        rest of the pipeline (detect_entities, image redaction) needs no changes.
        """
        import io
        from PIL import Image
        import numpy as np

        img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        img_np = np.array(img)

        # ── 1. Try EasyOCR (deep learning, best accuracy) ────────────────────
        reader = _get_easyocr_reader()
        if reader is not None:
            try:
                # detail=1 → returns (bbox, text, confidence)
                # paragraph=False → word-level results
                results = reader.readtext(img_np, detail=1, paragraph=False)

                text_acc = []
                words_data = []
                curr_offset = 0

                for (bbox, text, conf) in results:
                    txt = text.strip()
                    if not txt or conf < 0.2:  # skip very low-confidence detections
                        continue

                    # bbox = [[x1,y1],[x2,y1],[x2,y2],[x1,y2]] (quadrilateral)
                    xs = [p[0] for p in bbox]
                    ys = [p[1] for p in bbox]
                    left   = int(min(xs))
                    top    = int(min(ys))
                    width  = int(max(xs) - min(xs))
                    height = int(max(ys) - min(ys))

                    words_data.append({
                        "text":   txt,
                        "left":   left,
                        "top":    top,
                        "width":  width,
                        "height": height,
                        "offset": curr_offset,
                        "length": len(txt),
                        "confidence": round(conf, 3),
                    })
                    text_acc.append(txt)
                    curr_offset += len(txt) + 1

                if words_data:  # only return if EasyOCR found something
                    logger.info("EasyOCR extracted %d words from image.", len(words_data))
                    return {"text": " ".join(text_acc), "words": words_data}

                logger.warning("EasyOCR returned no words; trying Tesseract fallback.")
            except Exception as e:
                logger.error("EasyOCR failed (%s); falling back to Tesseract.", e)

        # ── 2. Fallback: Tesseract OCR ────────────────────────────────────────
        try:
            import pytesseract

            data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

            text_acc = []
            words_data = []
            curr_offset = 0

            for i in range(len(data["text"])):
                txt = data["text"][i].strip()
                if not txt:
                    continue

                words_data.append({
                    "text":   txt,
                    "left":   data["left"][i],
                    "top":    data["top"][i],
                    "width":  data["width"][i],
                    "height": data["height"][i],
                    "offset": curr_offset,
                    "length": len(txt),
                })
                text_acc.append(txt)
                curr_offset += len(txt) + 1

            logger.info("Tesseract extracted %d words from image.", len(words_data))
            return {"text": " ".join(text_acc), "words": words_data}

        except Exception as te:
            logger.error("Tesseract OCR also failed: %s", te)
            return {"text": "", "words": []}

# ── AzureBlobStorageService: Azure Blob Storage disabled. ────────────────
# All file I/O now uses the local filesystem. The public API (upload_input_file,
# upload_file, get_file, etc.) is preserved so router.py needs no changes.
class AzureBlobStorageService:
    # ── Folder constants (mirrored locally) ──────────────────────────────────
    INPUTS_FOLDER  = "Team4AnonymizationInputs"
    OUTPUTS_FOLDER = "Team4AnonymizationOutputs"
    SAMPLES_FOLDER = "Team4AnonymizationSamples"

    def __init__(self):
        # Azure credentials commented out — local storage only
        # self.account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "")
        # self.account_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY", "")
        # self.container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "aikosh-v2")
        self.client = None  # Always None — local path is used in all methods

        # Local directories mirror the original blob folder structure
        self.local_inputs_dir  = f"uploads/{self.INPUTS_FOLDER}"
        self.local_outputs_dir = f"uploads/{self.OUTPUTS_FOLDER}"
        self.local_samples_dir = f"uploads/{self.SAMPLES_FOLDER}"
        os.makedirs(self.local_inputs_dir,  exist_ok=True)
        os.makedirs(self.local_outputs_dir, exist_ok=True)
        os.makedirs(self.local_samples_dir, exist_ok=True)

        logger.info("AzureBlobStorageService: Azure disabled — using local filesystem storage.")
        # ── Removed Azure BlobServiceClient initialization ───────────────────
        # Previously:
        #   blob_service_client = BlobServiceClient.from_connection_string(...)
        #   self.client = blob_service_client.get_container_client(...)

    def _upload(self, content_bytes: bytes, blob_name: str, local_dir: str, filename: str) -> str:
        """Internal helper: try Azure first, fall back to local disk."""
        if self.client:
            try:
                blob_client = self.client.get_blob_client(blob_name)
                blob_client.upload_blob(content_bytes, overwrite=True)
                logger.info("blob.upload.success path=%s size=%d", blob_name, len(content_bytes))
                return blob_name
            except Exception as e:
                logger.error("Azure Blob Upload Failed: %s — falling back to local disk.", e)

        local_path = os.path.join(local_dir, filename)
        try:
            with open(local_path, "wb") as f:
                f.write(content_bytes)
            logger.info("blob.upload.local path=%s", local_path)
            return f"local_file:{local_dir}/{filename}"
        except Exception as le:
            logger.error("Critical: Local Write Failed: %s", le)
            return f"storage_failure_{filename}"

    def upload_input_file(self, content_bytes: bytes, filename: str) -> str:
        """
        Store a raw uploaded file in Team4AnonymizationInputs/.
        Returns the blob path (or local_file: path on fallback).
        """
        blob_name = f"{self.INPUTS_FOLDER}/{filename}"
        return self._upload(content_bytes, blob_name, self.local_inputs_dir, filename)

    def upload_file(self, content_bytes: bytes, filename: str) -> str:
        """
        Store an anonymized output file in Team4AnonymizationOutputs/.
        Returns the blob path (or local_file: path on fallback).
        """
        blob_name = f"{self.OUTPUTS_FOLDER}/{filename}"
        return self._upload(content_bytes, blob_name, self.local_outputs_dir, filename)

    def upload_sample_file(self, content_bytes: bytes, filename: str) -> str:
        """
        Store a sample/demo asset in Team4AnonymizationSamples/.
        Returns the blob path (or local_file: path on fallback).
        """
        blob_name = f"{self.SAMPLES_FOLDER}/{filename}"
        return self._upload(content_bytes, blob_name, self.local_samples_dir, filename)

    def get_file(self, blob_name: str) -> bytes:
        # Handle local fallback paths
        if blob_name.startswith("local_file:"):
            local_path = blob_name.split(":", 1)[1]
            with open(local_path, "rb") as f:
                return f.read()

        # Try Azure
        if not self.client:
            raise Exception("Blob client not initialized and no local file found.")

        try:
            blob_client = self.client.get_blob_client(blob_name)
            return blob_client.download_blob().readall()
        except Exception as e:
            logger.error("Azure Blob Read Failed: %s — trying local fallback.", e)
            # Last resort: check outputs dir by filename
            local_filename = blob_name.split("/")[-1]
            for local_dir in [self.local_outputs_dir, self.local_inputs_dir, self.local_samples_dir]:
                local_path = os.path.join(local_dir, local_filename)
                if os.path.exists(local_path):
                    with open(local_path, "rb") as f:
                        return f.read()
            raise Exception(f"File not found in Azure or Local storage: {str(e)}")

    def get_sample_file(self, filename: str) -> bytes:
        return self.get_file(f"{self.SAMPLES_FOLDER}/{filename}")

    def sample_blob_name(self, filename: str) -> str:
        return f"{self.SAMPLES_FOLDER}/{filename}"


class PresidioService:
    def __init__(self, config, threshold=0.7):
        self.config = config
        self.threshold = threshold
        self._analyzer = None

    @property
    def analyzer(self):
        if self._analyzer is None:
            from presidio_analyzer import AnalyzerEngine
            from presidio_analyzer.nlp_engine import NlpEngineProvider
            provider = NlpEngineProvider(nlp_configuration=self.config)
            nlp_engine = provider.create_engine()
            self._analyzer = AnalyzerEngine(nlp_engine=nlp_engine)
        return self._analyzer

    def regex_detect(self, value, policy="Global"):
        """
        Optimized regex detection with false-positive filtering.
        """
        from .utils import POLICY_CONFIG, _is_false_positive
        val_str = str(value)
        patterns = POLICY_CONFIG.get("Global", {}).copy()
        p_list = policy if isinstance(policy, list) else [p.strip() for p in policy.split(",")]
        for p in p_list:
            if p != "Global":
                patterns.update(POLICY_CONFIG.get(p, {}))

        for pii_type, pattern in patterns.items():
            match = re.search(pattern, val_str)
            if match:
                # Apply the same thorough filtering logic
                if not _is_false_positive(val_str, pii_type, 0.85):
                    return pii_type
        return None


    def analyze_text(self, text, policy="Global"):
        """
        Runs Presidio analysis and filters results using the refined logic in utils.
        """
        from .utils import _is_false_positive, _allowed_policy_entities
        str_text = str(text)
        results = self.analyzer.analyze(text=str_text, language="en", entities=None, score_threshold=self.threshold)
        allowed = _allowed_policy_entities(policy)
        return [
            r for r in results
            if r.entity_type in allowed and not _is_false_positive(str_text[r.start:r.end], r.entity_type, r.score)
        ]

# ── LLMPIIService: Azure OpenAI replaced with Groq (free tier). ──────────
# Groq provides llama-3.3-70b-versatile for free — same JSON-mode capability.
# Set GROQ_API_KEY in .env (already present). Falls back to rule-based logic
# if Groq is also unavailable.
class LLMPIIService:
    def __init__(self):
        # ── Azure OpenAI credentials commented out ───────────────────────────
        # self.endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        # self.key = os.getenv("AZURE_OPENAI_API_KEY", "")
        # self.deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4o")
        # self.api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")

        # ── Groq configuration (free, high-quality) ──────────────────────────
        self.groq_api_key = os.getenv("GROQ_API_KEY", "")
        self.groq_model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        self.client = None

        if not _GROQ_AVAILABLE:
            logger.warning("LLMPIIService: 'groq' package not installed. Run: pip install groq. Using rule-based fallback.")
        elif not self.groq_api_key:
            logger.warning("LLMPIIService: GROQ_API_KEY not set in .env. Using rule-based fallback.")
        else:
            try:
                import httpx
                http_client = httpx.Client(verify=False)
                self.client = GroqClient(api_key=self.groq_api_key, http_client=http_client)
                logger.info(f"LLMPIIService: Groq client initialized (model={self.groq_model}).")
            except Exception as e:
                logger.error(f"Failed to init Groq client: {e}")

    def _rule_based_pii_inference(self, column_names: list) -> dict:
        """
        Fallback logic to infer PII types from column names when LLM is unavailable.
        """
        inference = {}
        for col in column_names:
            c = col.lower()
            res = {"pii_type": "NONE", "confidence": 0.4, "sensitivity_level": "PUBLIC", "risk": "LOW"}
            
            if any(k in c for k in ["email", "mail"]):
                res = {"pii_type": "EMAIL_ADDRESS", "confidence": 0.8, "sensitivity_level": "CONFIDENTIAL", "risk": "MEDIUM"}
            elif any(k in c for k in ["name", "fname", "lname", "person"]):
                res = {"pii_type": "PERSON_NAME", "confidence": 0.8, "sensitivity_level": "CONFIDENTIAL", "risk": "MEDIUM"}
            elif any(k in c for k in ["phone", "tel", "mobile"]):
                res = {"pii_type": "PHONE_NUMBER", "confidence": 0.8, "sensitivity_level": "CONFIDENTIAL", "risk": "MEDIUM"}
            elif any(k in c for k in ["ssn", "social security", "tax"]):
                res = {"pii_type": "SSN", "confidence": 0.9, "sensitivity_level": "RESTRICTED", "risk": "HIGH"}
            elif any(k in c for k in ["address", "street", "city", "location"]):
                res = {"pii_type": "LOCATION", "confidence": 0.7, "sensitivity_level": "CONFIDENTIAL", "risk": "LOW"}
            elif any(k in c for k in ["card", "cc_", "credit"]):
                res = {"pii_type": "CREDIT_CARD", "confidence": 0.9, "sensitivity_level": "RESTRICTED", "risk": "HIGH"}
            
            inference[col] = res
        return inference

    def pii_detection(self, column_names : list, policy: str = "Global"):
        if not self.client:
            logger.warning("Groq LLM client not available. Using rule-based fallback.")
            return self._rule_based_pii_inference(column_names)
        
        prompt = f"""You are a strict PII detection expert with a low false-positive tolerance.
You are currently enforcing the '{policy}' privacy policy for this dataset.

Analyze the following CSV column names and determine the PII type for EACH column.
Only flag columns whose values would DIRECTLY identify or locate a real individual.

Columns: {column_names}

STRICT RULES:
1. Demographic labels are NOT PII -> mark NONE:
   - Gender/sex columns (male, female, M, F, gender, sex) -> NONE
   - Age group ranges (18-25, Senior, Adult) -> NONE
   - Status fields (active, inactive, yes/no, category, type) -> NONE
2. Only flag a 'name' column if it stores a PERSON'S name, not a product/item name.
3. Location is only PII if it is someone's HOME or WORK address - not a store/region.
4. City, State, Country, or Region columns are LOCATION (Risk: LOW). NEVER mark 'city' as PERSON_NAME.
5. Financial indicators like Credit Score or CIBIL score are CREDIT_SCORE.
6. If confidence < 0.6, assign NONE.

PII Types: EMAIL_ADDRESS, PHONE_NUMBER, PERSON_NAME, CREDIT_CARD, SSN, LOCATION,
           DATE_OF_BIRTH, IP_ADDRESS, PASSPORT, DRIVER_LICENSE, BANK_ACCOUNT, CREDIT_SCORE,
           AADHAAR, PAN_CARD, VOTER_ID, GSTIN, NHS_NUMBER, NI_NUMBER, IBAN, NONE

Sensitivity: RESTRICTED | CONFIDENTIAL | INTERNAL | PUBLIC
Risk: HIGH | MEDIUM | LOW
Confidence: 0.85-0.95 (strong) | 0.6-0.85 (moderate) | <0.6 -> use NONE

Return ONLY JSON: {{"column_name": {{"pii_type": "TYPE", "confidence": 0.XX, "sensitivity_level": "LEVEL", "risk": "LEVEL"}}}}"""
            
        try:
            # Groq uses OpenAI-compatible interface; response_format=json_object supported
            response = self.client.chat.completions.create(
                model=self.groq_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=1000,
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)

        except json.JSONDecodeError as e:
            logger.error(f"LLM returned invalid JSON: {e}")
            return self._rule_based_pii_inference(column_names)

        except Exception as e:
            logger.error(f"PII Detection LLM Error (Connectivity/Auth): {e}")
            # Silently fallback to rule-based logic to avoid breaking UI (especially on 403/Forbidden)
            return self._rule_based_pii_inference(column_names)

    def contextual_anonymize(self, text: str) -> str:
        if not self.client:
            return f"[GROQ LLM NOT CONFIGURED]: {text[:100]}... (Using local Presidio redaction)"
            
        system_prompt = (
            "You are a strict PII masking engine. redact all names, organizations, contact info, "
            "and sensitive data with [REDACTED]. Return ONLY the anonymized text."
        )
        
        try:
            response = self.client.chat.completions.create(
                model=self.groq_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text}
                ],
                temperature=0.0
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Groq Redaction Error: {e}")
            return text  # Fallback: return original, local models will catch PII later

    def extract_pii_candidates(self, text: str) -> list:
        if not self.client:
            logger.warning("Groq LLM client not available. Returning empty candidates list.")
            return []
            
        system_prompt = """You are a PII identification expert.
        Analyze the following text and return a JSON list containing ONLY exact substrings that appear to be Personally Identifiable Information (PII).
        Include names, email addresses, phone numbers, SSNs, credit card numbers, physical addresses, IP addresses, driver license, bank account, organization, etc.
        Return the result strictly as a JSON object with a single key 'candidates' whose value is a list of strings representing the exact substrings found.
        Example response: {"candidates": ["John Doe", "john.doe@example.com", "555-1234"]}
        """
        
        try:
            response = self.client.chat.completions.create(
                model=self.groq_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text}
                ],
                temperature=0.0,
                response_format={"type": "json_object"}
            )
            response_json = json.loads(response.choices[0].message.content)
            return response_json.get("candidates", [])
        except Exception as e:
            logger.error(f"Groq Candidate Extraction Error: {e}")
            return []

    def summarize_pii_findings(self, entities: list) -> str:
        """
        Generates a concise AI summary of detected PII.
        Uses a rule-based fallback if the LLM fails.
        """
        if not entities:
            return "No sensitive Personally Identifiable Information (PII) was detected in the document."

        # Rule-based fallback summary
        type_counts = {}
        for ent in entities:
            t = ent if isinstance(ent, str) else ent.get('entity', ent.get('entity_type', 'Unknown'))
            type_counts[t] = type_counts.get(t, 0) + 1
        
        summary_parts = [f"{count} {t}" for t, count in type_counts.items()]
        fallback = f"Detected {len(entities)} sensitive items including {', '.join(summary_parts[:3])}. Risk level is evaluated based on data density."

        # Performance Optimization: If the entity list is too large, the rule-based fallback is more efficient.
        # This saves Groq tokens and prevents rate-limit issues on large documents.
        if not self.client or len(entities) > 30:
            return fallback

        prompt = f"""You are a data privacy compliance assistant. 
Review the following list of extracted PII entities from a document. 
List: {json.dumps(entities)}

Provide a very concise, professional 1-2 sentence summary of what was found, and the general risk level. 
Do not mention the exact raw values. Just mention the counts and types of entities found."""

        try:
            response = self.client.chat.completions.create(
                model=self.groq_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Groq Summarization Error: {e}")
            return fallback

    def calculate_privacy_metrics(self, entities: list, text_length: int) -> dict:
        """
        Calculates multi-dimensional privacy metrics for the dashboard.
        """
        if not entities:
            return {
                "risk_score": 0,
                "pii_density": 0,
                "risk_level": "Low",
                "compliance_check": "Pass",
                "top_entity": "None"
            }

        # Weighting for sensitivity
        weights = {
            "SSN": 10, "CREDIT_CARD": 10, "PASSPORT": 10,
            "EMAIL": 5, "PHONE": 5, "PERSON": 5, "LOCATION": 3,
            "DATE_TIME": 2, "ORGANIZATION": 2
        }

        total_weight = 0
        type_counts = {}
        for ent in entities:
            # Handle different nested structures
            etype = ent if isinstance(ent, str) else ent.get('entity', ent.get('entity_type', 'Unknown'))
            total_weight += weights.get(etype, 5)
            type_counts[etype] = type_counts.get(etype, 0) + 1

        # PII Density (matches per 1000 characters)
        density = (len(entities) / text_length * 1000) if text_length > 0 else 0
        
        # Risk Score (0-100) - Exponentially grows with density and weights
        risk_score = min(100, int((total_weight * 2) + (density * 5)))
        
        risk_level = "High" if risk_score > 60 else ("Medium" if risk_score > 30 else "Low")
        
        top_entity = max(type_counts, key=type_counts.get) if type_counts else "None"
        
        # Compliance indicators
        sensitive_types = {"SSN", "CREDIT_CARD", "PASSPORT", "BANK_ACCOUNT"}
        has_sensitive = any(t in sensitive_types for t in type_counts)
        
        return {
            "risk_score": risk_score,
            "pii_density": round(density, 2),
            "risk_level": risk_level,
            "top_entity": top_entity,
            "compliance_flags": ["GDPR-S" if has_sensitive else "GDPR-Basic"],
            "total_count": len(entities)
        }

class StructuredDataEngine:
    def __init__(self):
        self._analyzer = None
        self._anonymizer = None

    @property
    def analyzer(self):
        if self._analyzer is None:
            try:
                from .utils import analyzer as _global_analyzer
                self._analyzer = _global_analyzer
            except Exception as e:
                logger.error(f"Failed to initialize Presidio Analyzer: {e}. Falling back to basic masking.")
                self._analyzer = "FAILED"
        return self._analyzer

    @property
    def anonymizer(self):
        if self._anonymizer is None:
            try:
                self._anonymizer = AnonymizerEngine()
            except Exception as e:
                logger.error(f"Failed to initialize Presidio Anonymizer: {e}")
                self._anonymizer = "FAILED"
        return self._anonymizer

    def process_and_profile(self, df: pd.DataFrame, config: dict = None) -> tuple[pd.DataFrame, dict]:
        stats = {}
        stats['num_rows'] = int(df.shape[0])
        stats['num_cols'] = int(df.shape[1])
        # Ensure missing_percent is a serializable float
        raw_missing = (df.isnull().sum().sum() / (df.shape[0] * df.shape[1]) * 100) if df.size > 0 else 0
        stats['missing_percent'] = float(np.nan_to_num(raw_missing))
        
        distribution = {}
        for col in df.select_dtypes(include=[np.number]).columns:
            # Handle NaN/Inf in statistics which break JSON serialization
            try:
                d_min = float(df[col].min()) if not df[col].empty else 0
                d_max = float(df[col].max()) if not df[col].empty else 0
                d_mean = float(df[col].mean()) if not df[col].empty else 0
                
                distribution[col] = {
                    "min": float(np.nan_to_num(d_min)),
                    "max": float(np.nan_to_num(d_max)),
                    "mean": float(np.nan_to_num(d_mean))
                }
            except Exception:
                distribution[col] = {"min": 0, "max": 0, "mean": 0}

        stats['distributions'] = distribution

        df_masked = df.copy()
        from .utils import apply_technique_to_value

        # Resolve column types once per column to assist in precise anonymization/generalization
        col_types = {}
        from .utils import filtered_analyze
        for col in df_masked.columns:
            # 1. Check column name hints
            col_lower = col.lower()
            if "age" in col_lower: col_types[col] = "AGE"
            elif any(k in col_lower for k in ("date", "time", "dob", "birth")): col_types[col] = "DATE"
            elif any(k in col_lower for k in ("city", "country", "location", "address", "state", "zip", "post")): col_types[col] = "LOCATION"
            elif any(k in col_lower for k in ("mail", "email")): col_types[col] = "EMAIL"
            elif any(k in col_lower for k in ("phone", "mobile", "tel")): col_types[col] = "PHONE"
            else:
                # 2. Sample first non-null value to detect type via NLP
                sample_series = df[col].dropna().head(3)
                detected = "UNKNOWN"
                for sample in sample_series:
                    res = filtered_analyze(str(sample))
                    if res:
                        detected = res[0].entity_type
                        break
                col_types[col] = detected

        # Performance optimization: Mapping techniques algebraically to the column
        # without running heavy ML extractors (AnalyzerEngine) per cell.
        for col in df_masked.columns:
            # If config is missing entirely, fallback to suppress/replace for safety.
            # If config is present but col is not, it means the user explicitly left it as 'none' or it was 'NONE' PII.
            technique = config.get(col, "none").lower() if config is not None else "suppress"
            etype = col_types.get(col, "UNKNOWN")
            
            if technique == "none":
                continue

            if technique == "suppress" or technique == "redact":
                df_masked.drop(columns=[col], inplace=True)
                continue
            
            # Apply technique to everything using our unified function
            if df_masked[col].dtype == 'object' or df_masked[col].dtype.name == 'category':
                df_masked[col] = df_masked[col].apply(
                    lambda x: apply_technique_to_value(str(x), technique, etype) if pd.notnull(x) and str(x).strip() else x
                )
            else:
                # Numeric column - cast to string then apply, or if it's perturb, pass it through format
                df_masked[col] = df_masked[col].apply(
                    lambda x: apply_technique_to_value(str(x), technique, etype) if pd.notnull(x) else x
                )
        
        return df_masked, stats


class ImageRedactorService:
    """
    Redacts PII from images using Presidio's ImageRedactorEngine + Tesseract OCR.
    Supports PNG, JPG, JPEG, BMP, TIFF, and WEBP.
    """
    SUPPORTED_FORMATS = {"image/png", "image/jpeg", "image/jpg", "image/bmp",
                         "image/tiff", "image/webp"}
    SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp"}

    def __init__(self, fill_color: tuple = (0, 0, 0)):
        """
        fill_color: RGB tuple used to paint over detected PII regions.
                    Default is black (0, 0, 0).
        """
        self.fill_color = fill_color
        self._engine = None
        self._analyzer_engine = None
        self._engine_error: str | None = None
        self._doc_intel = None
        self._init_engine()

    @property
    def doc_intel(self):
        if self._doc_intel is None:
            self._doc_intel = AzureDocIntelService()
        return self._doc_intel

    def _find_tesseract_cmd(self) -> str | None:
        configured_path = os.getenv("TESSERACT_CMD")
        if configured_path and os.path.exists(configured_path):
            return configured_path

        path_cmd = shutil.which("tesseract")
        if path_cmd:
            return path_cmd

        if os.name != "nt":
            return None

        local_appdata = os.getenv("LOCALAPPDATA")
        user_profile = os.path.expanduser("~")
        common_paths = [
            os.path.join(local_appdata, "Programs", "Tesseract-OCR", "tesseract.exe")
            if local_appdata else None,
            os.path.join(user_profile, "AppData", "Local", "Programs", "Tesseract-OCR", "tesseract.exe"),
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ]

        for candidate in common_paths:
            if candidate and os.path.exists(candidate):
                return candidate

        return None

    def _init_engine(self):
        try:
            import pytesseract
            from presidio_image_redactor import ImageRedactorEngine, ImageAnalyzerEngine
            tesseract_path = self._find_tesseract_cmd()
            if tesseract_path:
                pytesseract.pytesseract.tesseract_cmd = tesseract_path
            else:
                expected_user_path = os.path.join(
                    os.path.expanduser("~"),
                    "AppData",
                    "Local",
                    "Programs",
                    "Tesseract-OCR",
                    "tesseract.exe",
                )
                raise RuntimeError(
                    "Tesseract OCR is required for image anonymization but was not found. "
                    "Install Tesseract and either add it to PATH or set TESSERACT_CMD to the full "
                    "path to tesseract.exe. Expected Windows locations include "
                    f"'{expected_user_path}', "
                    "'C:\\Program Files\\Tesseract-OCR\\tesseract.exe', and "
                    "'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe'."
                )

            from .utils import analyzer as _base_analyzer

            # ── Wrap ImageAnalyzerEngine to post-filter false positives ────
            class _FilteredImageAnalyzerEngine(ImageAnalyzerEngine):
                """
                Subclass that strips false positives (e.g. 'male' as PERSON)
                from image OCR results before returning bounding boxes.
                """
                def analyze(self, image, **kwargs):
                    raw_results = super().analyze(image, **kwargs)
                    import pytesseract
                    from PIL import Image as _PILImage
                    # Extract full OCR text to resolve spans -> actual strings
                    try:
                        ocr_text = pytesseract.image_to_string(image)
                    except Exception:
                        ocr_text = ""

                    filtered = []
                    for res in raw_results:
                        # ImageAnalyzerEngine returns ImageRecognizerResult with .text attribute
                        span_text = getattr(res, "text", "") or ""
                        if not span_text and ocr_text:
                            # Fallback: try to extract text from bounding box coords via OCR data
                            span_text = ""
                        if _is_false_positive(span_text, res.entity_type, res.score):
                            logger.debug(
                                "Image FP filtered: '%s' as %s (score=%.2f)",
                                span_text, res.entity_type, res.score
                            )
                            continue
                        filtered.append(res)
                    return filtered

            self._engine = ImageRedactorEngine()
            self._analyzer_engine = _FilteredImageAnalyzerEngine(analyzer_engine=_base_analyzer)
            logger.info("Presidio Image engines initialised using SHARED filtered analyzer.")
        except ImportError as e:
            self._engine_error = (
                "presidio-image-redactor is not installed. "
                "Run: pip install presidio-image-redactor Pillow pytesseract"
            )
            logger.error(self._engine_error)
        except Exception as e:
            self._engine_error = f"Failed to init ImageRedactorEngine: {e}"
            logger.error(self._engine_error)

    def redact(self, image_bytes: bytes, filename: str) -> tuple[bytes, dict]:
        """
        Detects PII in the image and paints filled rectangles over each hit.

        Returns:
            (redacted_image_bytes, metadata_dict)
            metadata_dict keys: entities_found (int), format (str), error (str|None)
        """
        import io
        from PIL import Image

        ext = os.path.splitext(filename)[1].lower()
        if ext not in self.SUPPORTED_EXTENSIONS:
            return image_bytes, {
                "entities_found": 0,
                "format": ext,
                "error": f"Unsupported image extension '{ext}'. "
                         f"Supported: {', '.join(self.SUPPORTED_EXTENSIONS)}"
            }

        if self._engine is None:
            return image_bytes, {
                "entities_found": 0,
                "format": ext,
                "error": self._engine_error or "ImageRedactorEngine not available."
            }

        try:
            pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            redacted_pil = self._engine.redact(
                image=pil_image,
                fill=self.fill_color
            )

            # Convert back to bytes in the original format
            fmt_map = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG",
                       ".bmp": "BMP", ".tiff": "TIFF", ".webp": "WEBP"}
            save_fmt = fmt_map.get(ext, "PNG")

            out_buf = io.BytesIO()
            redacted_pil.save(out_buf, format=save_fmt)
            out_bytes = out_buf.getvalue()

            # Count entities by comparing pixel differences roughly
            # (Presidio doesn't expose entity count directly via this API)
            metadata = {
                "entities_found": "detected & redacted",
                "format": save_fmt,
                "original_size_kb": round(len(image_bytes) / 1024, 1),
                "redacted_size_kb": round(len(out_bytes) / 1024, 1),
                "error": None
            }
            return out_bytes, metadata

        except Exception as e:
            logger.error(f"Image redaction failed: {e}")
            return image_bytes, {
                "entities_found": 0,
                "format": ext,
                "error": str(e)
            }

    def detect_entities(self, image_bytes: bytes, policy: str = "Global") -> list[dict]:
        """
        Analyzes image using Azure Document Intelligence and returns metadata (category, score, bounding box).
        """
        entities = []
            
        try:
            # --- 1. OCR with Azure Document Intelligence ---
            full_text = ""
            words_data = []
            
            try:
                doc_intel_results = self.doc_intel.extract_words_with_boxes(image_bytes)
                full_text = doc_intel_results.get("text", "")
                words_data = doc_intel_results.get("words", [])
            except Exception as ocr_err:
                logger.warning(f"Image OCR (Azure Doc Intel) unavailable or failed: {ocr_err}. Skipping OCR-based PII detection.")

            if full_text and words_data:
                # --- 2. Run highly-tuned Global NLP Engine on extracted text ---
                from .utils import filtered_analyze
                nlp_results = filtered_analyze(full_text, policy=policy)

                # --- 3. Intersect NLP Character Spans with Azure Polygons ---
                for res in nlp_results:
                    matching_words = [
                        w for w in words_data 
                        if (w["offset"] <= res.end) and ((w["offset"] + w["length"]) >= res.start)
                    ]
                    
                    if not matching_words:
                        continue

                    # Sort words by vertical position to detect line breaks
                    sorted_words = sorted(matching_words, key=lambda x: x["top"])
                    
                    # Group words into physical lines
                    lines = []
                    for w in sorted_words:
                        # If vertical gap is more than half the word height, it's a new line
                        if not lines or w["top"] > (lines[-1]["top"] + lines[-1]["height"] * 0.7):
                            lines.append({
                                "left": w["left"],
                                "top": w["top"],
                                "width": w["width"],
                                "height": w["height"],
                                "right": w["left"] + w["width"]
                            })
                        else:
                            # Update line bounds
                            lines[-1]["left"] = min(lines[-1]["left"], w["left"])
                            lines[-1]["top"] = min(lines[-1]["top"], w["top"])
                            lines[-1]["right"] = max(lines[-1]["right"], w["left"] + w["width"])
                            lines[-1]["width"] = lines[-1]["right"] - lines[-1]["left"]
                            lines[-1]["height"] = max(lines[-1]["height"], w["height"])

                    # Add an entity for each physical line detected
                    for line in lines:
                        entities.append({
                            "entity_type": res.entity_type,
                            "score": res.score,
                            "left": line["left"],
                            "top": line["top"],
                            "width": line["width"],
                            "height": line["height"]
                        })
            
            # --- 4. YOLOv8 Object Detection (Distant People & Cars) ---
            try:
                from ultralytics import YOLO
                import io
                from PIL import Image

                # Use a cached model instance if possible or just initialize once
                if not hasattr(self, "_yolo_model"):
                    self._yolo_model = YOLO("yolov8m.pt") # Upgraded to medium model for better person/car detection
                
                yolo_model = self._yolo_model
                
                # Run inference
                pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                results = yolo_model.predict(pil_image, conf=0.25, verbose=False)
                
                if results and len(results) > 0:
                    for box in results[0].boxes:
                        class_id = int(box.cls[0].item())
                        # COCO classes: 0 = person, 2 = car, 3 = motorcycle, 5 = bus, 7 = truck
                        if class_id in [0, 2, 3, 5, 7]:
                            x1, y1, x2, y2 = box.xyxy[0].tolist()
                            entity_name = "PERSON" if class_id == 0 else "VEHICLE/PLATE"
                            entities.append({
                                "entity_type": entity_name,
                                "score": float(box.conf[0].item()),
                                "left": int(x1),
                                "top": int(y1),
                                "width": int(x2 - x1),
                                "height": int(y2 - y1)
                            })
                            
            except Exception as yolo_err:
                logger.error(f"YOLO detection failed: {yolo_err}")

            return entities
        except Exception as e:
            logger.error(f"Image analysis failed: {e}")
            return []

    def redact_with_config(self, image_bytes: bytes, filename: str, config: dict, policy: str = "Global") -> tuple[bytes, dict]:
        """
        Granular redaction based on user technique mapping.
        """
        from PIL import Image, ImageDraw, ImageFilter
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        draw = ImageDraw.Draw(pil_image)
        
        entities = self.detect_entities(image_bytes, policy=policy)
        redact_count = 0
        
        for ent in entities:
            # Technique check
            technique = config.get(ent["entity_type"], "redact")
            if technique == "none" or technique == "keep":
                continue
                
            box = (ent["left"], ent["top"], ent["left"] + ent["width"], ent["top"] + ent["height"])
            
            if technique == "blur" or technique == "mask":
                region = pil_image.crop(box)
                blurred_region = region.filter(ImageFilter.GaussianBlur(radius=25))
                pil_image.paste(blurred_region, box)
            else:
                draw.rectangle(box, fill=self.fill_color)
                
            redact_count += 1
            
        out_buf = io.BytesIO()
        pil_image.save(out_buf, format="PNG") # Default to PNG for safety
        return out_buf.getvalue(), {
            "entities_found": redact_count,
            "format": "PNG",
            "error": None
        }
