# Backend Setup

> **Tip:** For a better reading experience, open this file in VS Code and press `Ctrl + Shift + V` to preview it.

## 1. Create & Activate Virtual Environment

```bash
python -m venv venv
venv\Scripts\activate
```

## 2. Install Dependencies

```bash
pip install -r req1.txt -r req2.txt -r req3.txt -r req4.txt -r req4new.txt -r req5.txt -r req5new.txt -r requirements.txt
```

> This may take a while due to the large number of dependencies across all teams.

---

## 3. FFmpeg Setup *(Required for Team 5 — Multimodal Analysis)*

If you run into any issues with this section, reach out to Team 5.

1. Go to [https://www.gyan.dev/ffmpeg/builds/](https://www.gyan.dev/ffmpeg/builds/)
2. Under **Release Builds**, download `ffmpeg-release-essentials.zip`
3. Extract the zip and copy the folder into your **backend root folder**
4. Open your `.env` file and update the following paths:

```env
FFMPEG_DIR=<path-to>/ffmpeg-8.1-essentials_build/bin
FFMPEG_PATH=<path-to>/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe
FFPROBE_PATH=<path-to>/ffmpeg-8.1-essentials_build/bin/ffprobe.exe
```

**How to get the correct paths:**
- Open File Explorer and navigate to your backend folder
- You'll see the `ffmpeg-8.1-essentials_build` folder — open it, then open `bin`
- Right-click on the `bin` folder → **Copy as path** → paste it as `FFMPEG_DIR`
- Inside `bin`, right-click `ffmpeg.exe` → **Copy as path** → paste it as `FFMPEG_PATH`
- Inside `bin`, right-click `ffprobe.exe` → **Copy as path** → paste it as `FFPROBE_PATH`

> **Important:** Replace all backslashes (`\`) with forward slashes (`/`) in the paths.

---

## 4. Tesseract OCR Setup *(Required for Team 4)*

If you have any doubts, reach out to Team 4.

Download and install Tesseract from the link below (just follow the on-screen steps):

[tesseract-ocr-w64-setup-5.5.0.exe](https://github.com/tesseract-ocr/tesseract/releases/download/5.5.0/tesseract-ocr-w64-setup-5.5.0.20241111.exe)

---

## 5. Run the Backend

```bash
uvicorn main:app --reload --port 8766
```

> You can use any available port. If you change the port, make sure to update it in the frontend as well (use VS Code's find & replace to do this quickly).

> **Note:** The first startup may take longer than usual. Several modules load large local files on boot, and Teams 4 and 5 have audio/video dependencies that add to the startup time. Wait until you see `Application startup complete` in the terminal.

---

# Frontend Setup

```bash
npm install
npm run dev
```