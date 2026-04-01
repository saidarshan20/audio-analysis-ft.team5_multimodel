# Kosh – Multimodal Data Visualization

## Azure Credentials

Copy `.env.example` to `.env` and fill in your Azure credentials:

```bash
cp .env.example .env
```

## Quick Start

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/docs` for the interactive API explorer.
