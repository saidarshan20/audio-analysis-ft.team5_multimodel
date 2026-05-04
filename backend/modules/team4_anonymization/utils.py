import pdfplumber
from docx import Document
import re
from faker import Faker
from presidio_analyzer import AnalyzerEngine, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider
import io

# ── Policy-specific Regex configurations ──────────────────────────────────
import json
import os

# Load Policy Configuration and Metadata from external JSON (OpenPIIMap aligned)
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_POLICY_FILE = os.path.join(_BASE_DIR, "pii_policies.json")

try:
    with open(_POLICY_FILE, "r") as f:
        _policy_data = json.load(f)
        POLICY_CONFIG = _policy_data.get("config", {})
        POLICY_METADATA = _policy_data.get("metadata", {})
except Exception as e:
    # Fallback to minimal config if file missing
    print(f"Warning: Could not load pii_policies.json: {e}")
    POLICY_CONFIG = {"Global": {"EMAIL": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"}}
    POLICY_METADATA = {"Global": {"law": "GDPR", "summary": "Minimal fallback"}}


# Initialization of Patterns and NLP Engine
DEFAULT_PATTERNS = {}
for p in POLICY_CONFIG.values():

    DEFAULT_PATTERNS.update(p)

configuration = {
    "nlp_engine_name": "spacy",
    "models": [
        {"lang_code": "en", "model_name": "en_core_web_lg"}
    ],
}

provider = NlpEngineProvider(nlp_configuration=configuration)
nlp_engine = provider.create_engine()
from presidio_analyzer import PatternRecognizer, Pattern
analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])

for entity_name, pattern_str in DEFAULT_PATTERNS.items():
    pattern = Pattern(name=f"{entity_name}_pattern", regex=pattern_str, score=0.85)
    recognizer = PatternRecognizer(supported_entity=entity_name, patterns=[pattern])
    analyzer.registry.add_recognizer(recognizer)

MAJOR_CITIES = ["pune", "mumbai", "delhi", "bangalore", "chennai", "kolkata", "hyderabad", "ahmedabad", "jaipur", "surat", "bengaluru", "noida", "gurgaon", "chandigarh", "lucknow", "kanpur", "new york", "london", "paris", "tokyo", "berlin", "dubai", "singapore", "sydney", "toronto", "chicago", "los angeles", "san francisco", "seattle", "boston", "austin"]
city_recognizer = PatternRecognizer(supported_entity="LOCATION", deny_list=MAJOR_CITIES)
analyzer.registry.add_recognizer(city_recognizer)

MIN_SCORE = 0.75
FALSE_POSITIVE_WORDS = frozenset({
    "hello", "testing", "test", "is", "audio", "portal", "with", "credit", "card", "male", "female", "m", "f", "gender", "sex", "man", "woman", "boy", "girl", "he", "she", "his", "her", "they", "them", "mr", "mrs", "ms", "dr", "prof", "sir", "madam", "miss", "master", 
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec", 
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "wed", "thu", "fri", "sat", "sun", 
    "yes", "no", "true", "false", "status", "type", "name", "value", "total", "amount", "number", "count", "rate", "score", "index", "new", "old", "open", "close", "active", "inactive", "available", "good", "bad", "high", "low", "medium", "average", "general", "id", "ids", "code", "data", "info", "none", "null", "na", "n/a", "north", "south", "east", "west", "central", 
    "the", "a", "an", "this", "that", "these", "those", "it", "usd", "inr", "gbp", "eur", "kg", "km", "cm", "mm", "lbs",
    # Scientific / Technical Paper False Positives
    "vol", "volume", "issue", "journal", "conference", "proceedings", "abstract", "keywords", "today", "yesterday", "tomorrow",
    "lstm", "rnn", "cnn", "bert", "transformer", "word2vec", "encoder", "decoder", "layers", "model", "algorithm", "corpus", "dataset", "kaggle",
    "fig", "figure", "tab", "table", "ref", "reference", "et", "al", "et al", "ibid", "viz", "sri", "ieee", "acm", "springer", "cham", "elsevier"
})

def _allowed_policy_entities(policy="Global"):
    p_list = policy if isinstance(policy, list) else [p.strip() for p in policy.split(",")]
    allowed = set(POLICY_CONFIG.get("Global", {}).keys())
    allowed.update({
        "PERSON",
        "PERSON_NAME",
        "LOCATION",
        "GPE",
        "DATE_TIME",
        "DATE",
        "EMAIL_ADDRESS",
        "PHONE_NUMBER",
        "NRP",
        "URL",
    })
    for p in p_list:
        if p != "Global" and p in POLICY_CONFIG:
            allowed.update(POLICY_CONFIG[p].keys())
    return allowed


def _is_false_positive(text_span, entity_type, score):
    span = text_span.strip()
    span_lower = span.lower()
    effective_min = 0.4 if entity_type == "PERSON" else MIN_SCORE
    if score < effective_min: return True
    
    # Check against blacklist
    if span_lower in FALSE_POSITIVE_WORDS: return True
    if any(stop in span_lower for stop in ["also one of", "the years", "the last decade", "recent years"]): return True

    # Reject purely alphabetical identifiers for numeric/mixed types
    numeric_ids = ["PASSPORT", "US_LICENSE", "AADHAAR", "PAN_CARD", "VOTER_ID", "SSN", "CREDIT_CARD", "UK_PASSPORT", "NHS_NUMBER"]
    if entity_type in numeric_ids:
        # If it's just letters and no numbers, it's highly likely a false positive common word
        if not re.search(r"\d", span): return True
        # If it's a known technical term like 'word2vec', ignore it even if it has digits
        if any(tech in span_lower for tech in ["word2vec", "lstm", "bert"]): return True
        if len(span) < 5: return True

    # Special handling for YEARS (e.g. "2021") - often not PII in research papers
    if entity_type in ("DATE", "DATE_TIME"):
        # Ignore standalone numbers that aren't clearly dates (like long timestamps or indices)
        if re.fullmatch(r"[\d.,-]+", span):
            if not re.fullmatch(r"\d{4}", span): return True # Not a year
            return True # It is a year, but we ignore standalone years in research papers
        if span_lower in ("today", "now", "current"): return True
        # Reject things like "1075842030037.JavaMail"
        if ".javamail" in span_lower or ".php" in span_lower: return True

    if entity_type == "PERSON":
        if len(span) < 4: return True
        # Reject citation fragments like "Liu et al" or "Majeed et al"
        if "et al" in span_lower: return True
        if re.fullmatch(r"[\d\s.,-]+", span): return True
        # Reject technical names like "Byte-mLSTM"
        if any(tech in span_lower for tech in ["lstm", "algorithm", "corpus", "encoder", "decoder"]): return True
        # A name shouldn't start with a lowercase letter if it's short
        if span[0].islower() and len(span) < 10: return True

    if entity_type == "LOCATION":
        if re.fullmatch(r"\d+", span): return True
        if span_lower in ("vol", "vol.", "fig", "fig.", "page", "pp."): return True
        # Reject citations like "Springer, Cham" in scientific context if desired, 
        # but "Springer" is a publisher. Users often want this kept. 
        # For now, let's keep it but filter common paper-section-like locations.

    
    # Reject single digits or very short numbers falsely flagged as IDs or Phones
    if entity_type != "ID_NUMBER" and re.fullmatch(r"[\d\s.,-]+", span) and len(re.sub(r"\D", "", span)) < 4:
        return True
        
    return False

def filtered_analyze(text, policy="Global"):
    results = analyzer.analyze(text=text, language="en")
    allowed = _allowed_policy_entities(policy)
    
    filtered = []
    for r in results:
        if r.entity_type not in allowed:
            continue
            
        # Extract the original text span
        span_text = text[r.start:r.end]
        
        # Post-process PERSON entities to remove trailing gender indicators often swallowed by OCR line-merging
        if r.entity_type == "PERSON":
            # Strip trailing " Male", " Female" (case insensitive)
            cleaned_span = re.sub(r"(?i)\s+(Male|Female)$", "", span_text)
            if cleaned_span != span_text:
                r.end = r.start + len(cleaned_span)
                span_text = cleaned_span

        if not _is_false_positive(span_text, r.entity_type, r.score):
            filtered.append(r)
            
    return filtered

fake = Faker()

def extract_text(file_path, file_type, raw_bytes=None, doc_intel_service=None):
    if doc_intel_service and raw_bytes:
        try:
            intel_text = doc_intel_service.extract_text(raw_bytes)
            if intel_text and not intel_text.startswith("[Error"): return intel_text
        except: pass
    text = ""
    if file_type == "pdf":
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages: text += page.extract_text() or ""
    elif file_type == "docx":
        doc = Document(file_path)
        for para in doc.paragraphs: text += para.text + "\n"
    elif file_type == "txt":
        with open(file_path, "r", encoding="utf-8", errors="replace") as f: text = f.read()
    return text

def clean_text(text):
    lines = text.split('\n')
    cleaned_lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in lines]
    return '\n'.join(line for line in cleaned_lines if line)

def regex_detect(text, policy="Global"):
    results = []
    # Handle multiple policies passed as comma-separated string or list
    p_list = policy if isinstance(policy, list) else [p.strip() for p in policy.split(",")]
    
    patterns = POLICY_CONFIG.get("Global", {}).copy()
    for p in p_list:
        if p != "Global":
            patterns.update(POLICY_CONFIG.get(p, {}))

    for entity, pattern in patterns.items():
        for match in re.finditer(pattern, text):
            results.append({"entity": entity, "value": match.group(), "start": match.start(), "end": match.end()})
    return results

def presidio_detect(text, policy="Global"):
    results = filtered_analyze(text, policy=policy)
    normalized = []
    for res in results:
        start, end = res.start, res.end
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end - 1].isspace():
            end -= 1
        if start >= end:
            continue
        normalized.append({"entity": res.entity_type, "start": start, "end": end, "score": res.score, "value": text[start:end]})
    return normalized

def contextual_name_detect(text):
    """
    Catch simple self-identification phrases that NLP models can miss in short
    documents, e.g. "my name is madan" or "name: Priya Sharma", and catch numeric IDs.
    """
    results = []
    stop_words = {
        "my", "name", "is", "am", "i", "work", "phone", "number", "email",
        "address", "passport", "data", "ntt", "company", "the", "and", "a", "an",
        "testing", "calling", "with", "from", "for", "to", "are", "was", "were",
        "this", "here", "speaking", "audio", "anonymizer", "portal", "credit", "card"
    }
    patterns = [
        r"\b(?:my[ \t]+name[ \t]+is|i[ \t]+am|i'm|name[ \t]*[:=-]|this[ \t]+is)[ \t]+([A-Za-z][A-Za-z.'-]*(?:[ \t]+[A-Za-z][A-Za-z.'-]*){0,4})",
        r"\b(?:patient|customer|employee|student|applicant)[ \t]+name[ \t]*[:=-][ \t]*([A-Za-z][A-Za-z.'-]*(?:[ \t]+[A-Za-z][A-Za-z.'-]*){0,4})",
        # Academic author pattern: catches "FirstName LastName1", "F. LastName2", or "FirstName M. LastName3"
        r"\b([A-Z][a-z.'-]*(?:[ \t]+[A-Z][a-z.'-]*){1,5}\d)\b",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE if "name" in pattern else 0):
            # For academic pattern, it's group 1 directly
            value = (match.group(1) if match.lastindex >= 1 else match.group(0)).strip().strip(" .,:;-")
            tokens = [token.strip(" .,:;-") for token in value.split()]
            
            clean_tokens = []
            for token in tokens:
                if token.lower() in stop_words:
                    break
                clean_tokens.append(token)
                
            if not clean_tokens:
                continue
                
            clean_value = " ".join(clean_tokens)
            # For academic names, we ALLOW the trailing digit
            is_academic = re.search(r"\d$", clean_value)
            if len(clean_value) < 3:
                continue
            if not is_academic and re.search(r"\d", clean_value):
                continue
                
            start = match.start(1) if match.lastindex >= 1 else match.start(0)
            end = start + len(clean_value)
            results.append({
                "entity": "PERSON",
                "start": start,
                "end": end,
                "score": 0.92 if is_academic else 0.88,
                "value": clean_value,
                "source": "CONTEXT",
            })

            
    # Catch IDs (like Portal ID, Customer ID, etc.)
    for match in re.finditer(r"\b(?:portal|customer|employee|patient|user|client|account)[ \t]+id[ \t]*(?:is|:|=|-)?[ \t]*([\d ,.-]+)\b", text, flags=re.IGNORECASE):
        value = match.group(1).strip(" .,:;-")
        # Ensure it has at least one digit and isn't just punctuation
        if not re.search(r"\d", value):
            continue
        start = match.start(1)
        end = start + len(value)
        results.append({
            "entity": "ID_NUMBER",
            "start": start,
            "end": end,
            "score": 0.9,
            "value": value,
            "source": "CONTEXT",
        })
            
    for match in re.finditer(r"\b(?:phone|mobile|contact|telephone)(?:[ \t]+number)?[ \t]*(?:is|:|=|-)?[ \t]*(\+?\d[\d \t().-]{4,18}\d)\b", text, flags=re.IGNORECASE):
        value = match.group(1).strip()
        digits = re.sub(r"\D", "", value)
        if 5 <= len(digits) <= 15:
            start = match.start(1)
            end = start + len(value)
            results.append({
                "entity": "PHONE",
                "start": start,
                "end": end,
                "score": 0.9,
                "value": value,
                "source": "CONTEXT",
            })
    return results

def merge_results(regex_res, presidio_res):
    all_res = sorted(regex_res + presidio_res, key=lambda x: (x['start'], -(x['end'] - x['start'])))
    merged = []
    
    # Regional prefixes that confer higher priority
    REGION_PREFIXES = ("UK_", "US_", "INDIA_", "PAN_", "AADHAAR", "NHS_", "NI_")

    for current in all_res:
        if not merged:
            merged.append(current)
            continue
            
        previous = merged[-1]
        
        # Overlap check
        if current['start'] < previous['end']:
            # Exact match - Apply Priority
            if current['start'] == previous['start'] and current['end'] == previous['end']:
                p_type = previous['entity'].upper()
                c_type = current['entity'].upper()
                
                # If current has a regional prefix and previous doesn't, swap
                has_p_prefix = any(p_type.startswith(pre) for pre in REGION_PREFIXES)
                has_c_prefix = any(c_type.startswith(pre) for pre in REGION_PREFIXES)
                
                if has_c_prefix and not has_p_prefix:
                    merged[-1] = current
                # If both or neither have prefixes, keep the one with higher score (if available)
                elif has_c_prefix == has_p_prefix:
                    if current.get('score', 0) > previous.get('score', 0):
                        merged[-1] = current
                continue # Skip adding as duplicate
            
            # Partial overlap - Take the longest match
            if (current['end'] - current['start']) > (previous['end'] - previous['start']):
                merged[-1] = current
            # Else discard the shorter/nested current match
        else:
            merged.append(current)
            
    return merged

def apply_technique_to_value(val, current_mode, entity_type="UNKNOWN"):
    import random
    current_mode = {
        "anonymize": "pseudonymize",
        "anonymization": "pseudonymize",
        "fake": "pseudonymize",
        "hash": "pseudonymize",
    }.get(current_mode, current_mode)
    if current_mode == "none": return val
    if current_mode == "suppress": return "[REMOVED]"
    elif current_mode == "mask":
        if "@" in val:
            parts = val.split("@")
            user, domain = parts[0], parts[1] if len(parts) > 1 else ""
            return f"{user[0]}{'*' * max(len(user)-1, 3)}@{domain[0]}{'*' * max(len(domain)-1, 3)}" if domain else f"{user[0]}***"
        else: return (val[:2] + "*" * (len(val) - 4) + val[-2:]) if len(val) > 4 else "***"
    elif current_mode == "pseudonymize":
        seed = sum(ord(c) for c in val)
        if entity_type in ("EMAIL", "EMAIL_ADDRESS"): return f"anon_{seed * 17 % 9000 + 1000}@private.org"
        elif entity_type in ("PHONE", "PHONE_NUMBER"): return f"+00-{seed * 13 % 9000 + 1000}-{seed * 7 % 9000 + 1000}"
        else: return f"User_{(seed * 31 % 9000 + 1000):04d}"
    elif current_mode == "generalize":
        if entity_type in ("AGE",) and re.match(r"^\d{1,3}$", val.strip()):
            age = int(val.strip())
            lo = (age // 5) * 5
            return f"{lo}\u2013{lo+4}"
        elif entity_type in ("DATE_TIME", "DATE"): return val[:4] + "s" if len(val) >= 4 else "[DATE RANGE]"
        elif entity_type in ("LOCATION", "GPE", "CITY"):
            parts = val.split(",")
            return parts[-1].strip() if len(parts) > 1 else "[REGION]"
        else: return f"[{entity_type} CATEGORY]"
    elif current_mode == "perturb":
        numeric_match = re.search(r"-?\d+(\.\d+)?", val)
        if numeric_match:
            original_num = float(numeric_match.group())
            noise = round(original_num * random.uniform(-0.03, 0.03))
            return val[:numeric_match.start()] + str(int(original_num + noise)) + val[numeric_match.end():]
        else: return "[PERTURBED]"
    elif current_mode == "k-anonymize":
        if re.match(r"^\d{4,6}$", val.strip()): return val[:3] + "**"
        elif re.match(r"^\d{1,3}$", val.strip()):
            age = int(val.strip())
            lo = (age // 5) * 5
            return f"{lo}\u2013{lo+4}"
        else:
            half = max(1, len(val) // 2)
            return val[:half] + "*" * (len(val) - half)
    return "[REMOVED]"

def anonymize_text(text, entities, mode="suppress", mode_map=None):
    _ALIAS = {
        "redact": "suppress",
        "replace": "suppress",
        "hash": "pseudonymize",
        "fake": "pseudonymize",
        "anonymize": "pseudonymize",
        "anonymization": "pseudonymize",
    }
    res = text
    for ent in sorted(entities, key=lambda x: x['start'], reverse=True):
        start, end = ent["start"], ent["end"]
        entity_type = ent["entity"]
        val = res[start:end]
        current_mode = mode
        if mode_map: current_mode = mode_map.get(entity_type, mode_map.get("DEFAULT", mode))
        current_mode = _ALIAS.get(current_mode, current_mode)
        if current_mode == "none": continue
        replacement = apply_technique_to_value(val, current_mode, entity_type)
        res = res[:start] + replacement + res[end:]
    return res

def anonymize_docx_file(input_bytes, entities, mode_map=None):
    import io
    from docx import Document
    doc = Document(io.BytesIO(input_bytes))
    pii_values = sorted(list(set([e['value'] for e in entities if e.get('value')])), key=len, reverse=True)
    def apply_redaction(text):
        if not text: return text
        new_text = text
        for val in pii_values:
            if val in new_text:
                ent = next((e for e in entities if e['value'] == val), None)
                if not ent: continue
                mode = mode_map.get(ent['entity'], mode_map.get("DEFAULT", "suppress")) if mode_map else "suppress"
                if mode == "none": continue
                replacement = apply_technique_to_value(val, mode, ent['entity'])
                new_text = new_text.replace(val, replacement)
        return new_text
    for para in doc.paragraphs:
        if para.text: para.text = apply_redaction(para.text)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs: para.text = apply_redaction(para.text)
    out_io = io.BytesIO()
    doc.save(out_io)
    return out_io.getvalue()

def anonymize_pdf_file(input_bytes, entities, mode_map=None, policy="Global"):
    import io
    import fitz
    doc = fitz.open(stream=input_bytes, filetype="pdf")
    pii_values = sorted(list(set([e['value'] for e in entities if e.get('value')])), key=len, reverse=True)
    redaction_count = 0
    for page in doc:
        for val in pii_values:
            ent = next((e for e in entities if e['value'] == val), None)
            if not ent: continue
            mode = mode_map.get(ent['entity'], mode_map.get("DEFAULT", "suppress")) if mode_map else "suppress"
            if mode == "none": continue
            for rect in page.search_for(val):
                redaction_count += 1
                if mode == "suppress" or mode == "redact": page.add_redact_annot(rect, fill=(0, 0, 0))
                else: page.add_redact_annot(rect, text=apply_technique_to_value(val, mode, ent['entity']), fill=(1, 1, 1), fontname="helv", fontsize=8)
        page.apply_redactions()
    if pii_values and redaction_count == 0:
        doc.close()
        raise ValueError("No searchable PDF text spans matched detected PII")
    out_bytes = doc.write()
    doc.close()
    return out_bytes
