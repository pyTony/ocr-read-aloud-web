# Running OCR Magazine Read-Aloud Locally (100% Free, Unlimited Usage)

You can run this application entirely on your own computer with zero cloud fees, zero API subscriptions, full offline privacy, and unlimited document processing.

---

## 🚀 How to Get the Code on Your Computer

### Option A: Download ZIP (Simplest)
1. In the AI Studio top menu, click **Export / Settings** → **Download ZIP**.
2. Save and extract the `.zip` file to a folder on your computer (e.g. `C:\Users\admin\Downloads\ocr-read-aloud`).
3. Open **PowerShell** or **Command Prompt** and navigate directly into the extracted folder:
   ```powershell
   cd C:\Users\admin\Downloads\ocr-read-aloud
   ```
   *(Note: Make sure your terminal is inside the folder containing `package.json`, not in `C:\Users\admin` directly!)*

### Option B: Git Clone
If you exported to GitHub or cloned the repository:
```bash
git clone <your-repository-url>
cd ocr-read-aloud
```

---

## ⚡ Quick 1-Minute Setup & Execution

### 1. Prerequisites
- **Node.js** (v18 or newer): Download from [nodejs.org](https://nodejs.org/)
- *(Optional)* **Ollama**: For 100% local, offline AI proofreading without paying for API tokens ([ollama.com](https://ollama.com))

### 2. Run the Local Setup Script

- **Windows:**
  Double-click `run-local.bat` or run in PowerShell inside the project directory:
  ```powershell
  cd path\to\ocr-read-aloud
  .\run-local.bat
  ```

- **Linux / macOS / WSL:**
  ```bash
  chmod +x install-local.sh
  ./install-local.sh
  ```

- **Manual (Any OS):**
  ```bash
  npm install
  npm run dev
  ```

### 3. Open in Web Browser
Open **http://localhost:3000** in Chrome, Edge, Firefox, or Safari.
*(Note: Terminal log shows both `http://localhost:3000` and `http://0.0.0.0:3000`. `0.0.0.0` is the network bind address; always use **http://localhost:3000** in your web browser).*

---

## 📄 File Processing & PDF Worker Fix
- **PDF Upload & Drag-and-Drop:** PDF files are rendered using CDN-backed `pdf.worker.js`. Drag-and-drop and the "Browse File" buttons process PDFs instantly without fake worker errors.
- **Image Scans:** Run Tesseract.js directly inside your browser without uploading to external servers.
- **Text & Markdown:** Instant reading with split-sentence teleprompter and paragraph navigation.

---

## 🧠 AI Proofreading & Cleanup Modes (No Extra Costs)

1. **Offline Rule-Based Dehyphenation & Repair (Built-in, Zero Token Cost):**
   - Automatically repairs broken hyphenated words (e.g. `syn- thesi zer` → `synthesizer`), merges split words, and strips table border pipes `|` and repeating headers/footers.
   - Runs 100% locally in your browser and Node server with instant speed.

2. **Free Local Ollama / LM Studio:**
   - Install Ollama from [ollama.com](https://ollama.com).
   - Start Ollama with browser access enabled: `OLLAMA_ORIGINS="*" ollama serve`
   - In the app, click **⚙ (AI Settings)** and select **Ollama LLM** (default host `http://127.0.0.1:11434`).

3. **Google Gemini (Free Tier / Personal Key):**
   - If using Google AI Studio free tier, get a free API key at [aistudio.google.com](https://aistudio.google.com).
   - Enter it in **⚙ (AI Settings)**. It is saved securely in your browser session.
   - If quota is exhausted or rate limited, the application automatically falls back to **Offline Rules** with clear visual feedback so you never get stuck.

---

## 🗣️ Text-to-Speech & Speech Synthesis
The app uses your browser's built-in Web Speech API or OS-level native voices (Natural Microsoft voices, Apple Siri/Samantha, or Chromium voices) at zero cost with no external audio server required.

