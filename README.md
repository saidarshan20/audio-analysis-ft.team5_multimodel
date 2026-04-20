# AI Kosh – Multimodal Data Visualization

## Project Structure

```
Kosh_V2/
├── .env                          # Environment variables
├── requirements.txt              # Global dependencies
├── main.py                       # Integration Team entry point
├── shared_workspace/             # Data bridge (auto-created)
│   ├── 1_raw_uploads/
│   ├── 2_processed_data/
│   └── 3_models/
├── core/                         # Integration Team
│   ├── auth_router.py
│   ├── auth_utils.py
│   ├── core_db.py
│   ├── core_models.py
│   └── dashboard_router.py
└── modules/                      # 5 Team Modules
    ├── team1_automl/
    ├── team2_feature_eng/
    ├── team3_ocr/
    ├── team4_anonymization/
    └── team5_multimodal/
```

## Quick Start

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8742
```

Open `http://localhost:8742/docs` for the interactive API explorer.

## Team Local Testing

Each team can run independently:

```bash
cd modules/team5_multimodal
python run_local.py   # → http://localhost:8005/docs
```
## 🔧 FFmpeg Setup (Required for Audio Processing)

Download FFmpeg from:
https://www.gyan.dev/ffmpeg/builds/

Extract into project root:

audio-analysis-ft.team5_multimodel/
└── ffmpeg-8.1-essentials_build/

No need to add to PATH — the app config handles it.