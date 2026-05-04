# AI Kosh: PII Detection & Anonymization Module

## Overview
The AI Kosh Anonymization Module is an enterprise-grade privacy engine designed to detect and protect Personally Identifiable Information (PII) across multi-modal data streams. It leverages a cascading detection pipeline and versatile anonymization techniques to ensure regulatory compliance (GDPR, DPDP, CCPA, etc.) while maintaining data utility.

---

## 🛡️ Multi-modal Support
The module supports four primary data categories:
1. **Structured Data**: CSV, JSON, and XLSX files.
2. **Unstructured Data**: PDF, DOCX, and TXT documents.
3. **Visual Data**: PNG, JPG, JPEG, BMP, TIFF, and WEBP images.
4. **Audio Data**: MP3, WAV, and M4A voice recordings.

---

## 🔍 The Cascading Detection Pipeline
AI Kosh uses a three-tier architecture to ensure high recall and precision:

### 1. Regex Layer (Fast Pattern Matching)
- Uses high-speed regular expressions for deterministic formats (IDs, Emails, Phones).
- Aligned with **OpenPIIMap** for regional accuracy.
- Supports **16+ regional policies** including India (Aadhaar, PAN), US (SSN), UK (NHS No), and more.

### 2. NER Layer (Natural Language Depth)
- Powered by **Microsoft Presidio** and **SpaCy** (`en_core_web_lg`).
- Identifies contextual entities like `PERSON_NAME`, `LOCATION`, and `ORGANIZATION`.
- Includes custom recognizers for specific regional identities (e.g., Australian TFN, Japanese MyNumber).

### 3. LLM Layer (Cognitive Intelligence)
- Integrates **Azure OpenAI (GPT-4o)** for complex analysis.
- **Column Inference**: Identifies PII types from headers even when values are obfuscated.
- **Contextual Redaction**: Redacts PII where structural patterns are absent.
- **Smart Summarization**: Provides human-readable privacy risk summaries.

---

## ✂️ Anonymization Techniques
The engine provides granular control over how sensitive data is processed:

| Technique | Description | Example (Input: `John Doe`) |
| :--- | :--- | :--- |
| **Suppress / Redact** | Complete removal or black-boxing of the value. | `[REMOVED]` or `██████` |
| **Mask** | Partial obfuscation while retaining some context. | `Jo** ***` |
| **Pseudonymize** | Deterministic replacement using a consistent seed. | `User_8271` |
| **Generalize** | Coarsening the value to a higher-level category. | `[PERSON CATEGORY]` |
| **Perturb** | Adding small statistical noise to numerical data. | `24` -> `26` (±3% variance) |
| **k-Anonymization** | Structural suppression to meet k-anonymity sets. | `411037` -> `411***` |

---

## 🌍 Regional Compliance Policies
The module dynamically adapts its detection rules based on the selected jurisdiction:

- **India**: Digital Personal Data Protection Act (DPDP) 2023.
- **Global**: GDPR / CCPA Baseline.
- **US**: HIPAA / Privacy Act.
- **Other Regions**: UK, Canada, Australia, Singapore, Japan, China, UAE, Brazil, Mexico, Germany, France, South Africa.

---

## ⚙️ Core Components
- **`router.py`**: FastAPI endpoints for classification and anonymization tasks.
- **`services.py`**: Core logic for Azure Doc Intelligence integration, LLM services, and image redaction.
- **`utils.py`**: Policy configurations, regex patterns, and deterministic anonymization logic.
- **`audio_service.py`**: Audio transcription (Faster-Whisper), time-mapping, and signal processing (Bleep/Silence).

---

## 🚀 Resilience & Fallbacks
The system is built to be robust in air-gapped or restricted environments:
- **OCR**: Prefers **Azure Document Intelligence**; falls back to local **Tesseract OCR**.
- **Detection**: Prefers **Azure OpenAI**; falls back to **Presidio + Regex** for local processing.
- **Storage**: Prefers **Azure Blob Storage**; falls back to **Local Filesystem** storage.
- **Audio**: Uses **Faster-Whisper** for local high-performance transcription.

---

## 🧩 Integration Flow
1. **Upload**: User uploads a file through the React Frontend.
2. **Classification**:
    - Metadata is extracted (Headers/Transcript/OCR).
    - Cascading detection runs (Regex -> Presidio -> LLM).
    - Privacy Metrics (Risk Score, Density) are calculated.
3. **Configuration**: User reviews detected PII and selects anonymization techniques per entity type.
4. **Processing**: The backend applies the techniques and generates the protected file.
5. **Download**: The user downloads the anonymized asset with a detailed visual privacy report.
