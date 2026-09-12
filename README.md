### 1.5.9
- **Horizontal split reading order:** when a page has a clear page-wide vertical gap (or rule line), speak everything above before below (magazine top columns vs bottom block).
- **Go… / Ctrl+G:** jump to a printed folio or 1-based PDF page index.

### 1.5.8
- **Cont→ / ←Back:** after Cont→ lands, the same button returns to the origin page.

### 1.5.6
- **Find (next):** Ctrl+F / clickable one-line OCR hits to jump playback — deferred to save quota.

- Form blanks: contextual underscore fill-ins for speech/caption.

# OCR Read Aloud

Local utility for **Windows 10/11**: OCR text from scanned PDFs and images, then read it aloud with the system voice (SAPI5).

- **No cloud APIs** — Tesseract OCR + Windows Speech (pyttsx3); optional local **Ollama** proofread
- Inputs: PDF (rasterized page-by-page), single image, or folder of images
- Languages: Finnish + English (`fin+eng` by default)
- Optional simple GUI

> Developed/packaged on Linux; **run and verify TTS/SAPI on Windows**. OCR can be smoke-tested wherever Tesseract is installed.

**See [ARCHITECTURE.md](ARCHITECTURE.md)** for a short map of the package (modules, PDF→OCR→proof→speakables→player/TTS data flow, controls, and cache files). Useful for humans and LLM agents before diving into the code.

## Requirements

| Component | Notes |
|-----------|--------|
| Windows 10 or 11 | Target platform |
| Python 3.11+ | Add to PATH during install |
| Tesseract-OCR | With **Finnish (fin)** and **English (eng)** language packs |
| Finnish TTS voice | Optional but recommended (Windows Speech settings) |
| Ollama (optional) | Local proofread; tray app or `ollama serve` on `127.0.0.1:11434` |

## Install (Windows)

### 1. Python

Install Python 3.11+ from https://www.python.org/downloads/  
Check **“Add python.exe to PATH”**.

### 2. This project

```bat
cd path\to\ocr-read-aloud
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Or editable install:

```bat
pip install -e .
```

### 3. Tesseract-OCR

1. Download the Windows installer (UB Mannheim builds are common):  
   https://github.com/UB-Mannheim/tesseract/wiki
2. During setup, select **Additional language data** → **Finnish** and **English**.
3. Default install path: `C:\Program Files\Tesseract-OCR\`
4. Add that folder to your user **PATH**, *or* leave it at the default — the app also checks common install locations.

Verify in a new terminal:

```bat
tesseract --version
tesseract --list-langs
```

You should see `fin` and `eng`.

### 4. Finnish voice (TTS)

1. **Settings → Time & language → Speech** (or **Language & region → Speech**)
2. Install / select a **Finnish** voice if available.
3. List voices from this tool:

```bat
python -m ocr_read_aloud --list-voices
```

Use `--voice` with a substring of the voice name if needed.

## Usage (CLI)

```bat
REM Activate venv first if you use one
.venv\Scripts\activate

REM PDF — OCR + speak page by page (default lang fin+eng)
python -m ocr_read_aloud scan.pdf

REM Image
python -m ocr_read_aloud photo.jpg --lang fin

REM Folder of images
python -m ocr_read_aloud C:\scans\pages --lang eng

REM OCR only, save text beside source (creates scan.ocr.txt)
python -m ocr_read_aloud scan.pdf --no-speak --save-text

REM OCR + local Ollama proofread, save text, no speak
python -m ocr_read_aloud scan.pdf --lang eng --proofread --no-speak --save-text

REM Page range (1-based, inclusive)
python -m ocr_read_aloud scan.pdf --start-page 2 --end-page 5

REM Voice and rate
python -m ocr_read_aloud scan.pdf --voice Finnish --rate 170

REM List TTS voices / OCR languages
python -m ocr_read_aloud --list-voices
python -m ocr_read_aloud --list-langs
```

### CLI options

| Option | Description |
|--------|-------------|
| `path` | PDF, image (jpg/jpeg/png/tif/tiff/webp/bmp), or folder |
| `--lang` | `fin`, `eng`, or `fin+eng` (default) |
| `--voice` | Substring filter for TTS voice |
| `--rate` | Speech rate (pyttsx3; often ~150–200) |
| `--list-voices` | Print voices and exit |
| `--list-langs` | Print Tesseract languages and exit |
| `--no-speak` | OCR only |
| `--preview` / `--no-preview` | Show / hide the reading preview while speaking (default: on for Windows) |
| `--save-text` | Write `.ocr.txt` next to the file (or `ocr_output.txt` in a folder) |
| `--proofread` | Lightly proofread OCR via **local Ollama** per page (interleaved; no API key) |
| `--no-cache` | Do not read/write auto proofread cache `{stem}.txt` beside the source |
| `--ollama-model` | Ollama model name (default `gemma4:e2b`) |
| `--ollama-host` | Ollama HTTP base URL (default `http://127.0.0.1:11434`) |
| `--start-page` / `--end-page` | Page or image index range (1-based) |
| `--dpi` | PDF render DPI (default 250; ~200–300 recommended) |

## GUI

```bat
python -m ocr_read_aloud.gui
```

Pick a file (or folder), set language / voice filter, **Start** / **Stop**. Recognized text appears in the window; speech runs on a background thread. With **Preview** checked, a second small window tracks the spoken line on the page.

## Reading preview / player

While speaking, a small **Reading…** window shows the page with the spoken region highlighted, plus transport controls (not always-on-top):

| Control | Action | Keys |
|---------|--------|------|
| **Stop** | Stop speaking and end playback | `Esc`, media **Stop** |
| **Pause** / **Play** | Halt mid-line or between lines; resume from the current sentence | `Space`, media **Play/Pause** |
| **Rew** / **Fwd** | Previous / next **sentence** (within a proofread page block too) | `←` `→`, media **Prev/Next track** |
| **Para** (no buttons) | Previous / next **paragraph** (speakable chunk) | `↑` `↓`, `Tab` / `Shift+Tab` |
| **PgUp** / **PgDn** | Previous / next page (or image unit), continue from para 1 / sentence 1 | `PageUp` `PageDown` only |
| **Save** | Write full OCR/read text to `{stem}.ocr.txt` beside the source (or ask for a path) | `Ctrl+S` |
| **Proof** | Proofread pages via local Ollama one-by-one (live playlist updates) | — |
| **Cont→** / **→N** / **←Back** | Jump to “continued on page N”; same button then returns to the origin page | `c`, `Ctrl+J` |
| **Ad←** / **Art→** | Visit an auto-skipped ad insert, or return to the article | `a` |
| **Art** | Save current article (or ad) with title-based filename next to the PDF | `Ctrl+Shift+S` |
| **Voice** | Pick among installed TTS voices (SAPI / pyttsx3); applies to the next Speak | — |

Media keys use Windows multimedia keys (`VK_MEDIA_*` / `XF86Audio*`) when the preview window can receive them. Focus the preview window if a key does nothing.

Enabled by default on Windows when speaking; use `--no-preview` (or `--no-speak`) to disable. **CLI opens the player after the first page is OCR'd** (later pages keep loading/proofing in the background; Tk mainloop stays on the main thread on Windows). The GUI has a **Preview** checkbox. If tkinter is missing, OCR/TTS still run and a one-line warning is printed.

## Ollama proofread (optional, local)

`--proofread` and the player **Proof** button send OCR text to a **local** Ollama HTTP API (`http://127.0.0.1:11434`) to lightly clean OCR garbage for TTS. **No cloud API key** is required.

With `--proofread`, OCR and proofreading are **interleaved**: each page is queued for Ollama as soon as it is OCR'd (one Ollama call at a time). The player opens after the **first** page is ready so you can page through the issue while later pages are still OCR'ing/proofing. Proofed text hot-swaps into the live playlist per page.

**v1.5.8:** Cont→ / ←Back — after a successful continue jump, the same button returns to the starting page (not a chained continue).

**v1.5.5:** Mid-article ad skip — when F+2 has “continued from” matching source folio F, always treat F+1 as a skippable ad insert (BYTE long marketing OCR no longer blocks ↓/`para_fwd`/PgDn). Safety net: if forward nav still lands on ``skip_as_ad`` / ad-queue page, jump one more page.

**v1.5.4:** BYTE Letters polish — end-of-line **dehyphenation**; stricter **column-then-down** reading order; mid-article **ad auto-skip** on forward read/↓/PgDn (PgUp can still land on the ad); highly visible **“Skipped ad — push Ad← to see/read it!”** + orange Ad← flash; proofread marks ads with ``[[SKIP_AS_AD]]`` into an **ad queue** (right-click Ad← for list); caption lockstep is **one Speak() per sentence** (no wall-clock caption timer) so pause/resume keeps **caption ↔ `_sent_idx` ↔ speech** aligned. Sentence-level preview highlight remains a follow-up.

**TODO (not in 1.5.5):** **Save as PDF** — keep original page images and embed proofread OCR as a searchable/selectable text layer (invisible/behind; standard OCR PDF).

**v1.5.3:** Player **Voice** button — choose an installed TTS speaker at runtime (no restart; next Speak uses the new voice). CLI `--voice` remains the initial selection.

**v1.5.2:** Navigation — `←`/`→` (and Rew/Fwd / media prev/next) step by **sentence**; `↑`/`↓` and `Tab`/`Shift+Tab` step by **paragraph** (speakable chunk); `PageUp`/`PageDown` only for pages. Speaking resumes from the selected sentence; caption follows it.

**v1.5.0:** Magazine reading — **Cont→** (“continued on page N”), **Ad←** for auto-skipped ad inserts, decorative titles promoted to the **front** of speak order (not after the left column), auto proofread cache `{stem}.txt` for the next session, **Art** saves the current article/ad with an inferred title (+ issue `YYYY-MM` when the path looks like a magazine). Player is **not** always-on-top.

**v1.4.2:** If proof finishes while that page is still speaking, the new text is **deferred until you leave the page** (no mid-page restart / full-page re-read). Single-column body text is spoken as continuous paragraph chunks (one SAPI Speak per chunk); the top caption still advances sentence-by-sentence during that Speak.

1. Install [Ollama for Windows](https://ollama.com/) (typical path: `C:\Users\<you>\AppData\Local\Programs\Ollama`).
2. Keep the Ollama app running (system tray / hidden icons) so the API is up, or run `ollama serve`.
3. Pull a model if needed, e.g. `ollama pull gemma4:e2b` (the default).
4. Run with `--proofread`, or open the player and click **Proof**.

If Ollama is unreachable, the tool prints a clear warning and continues with raw OCR.

### Proofread cache (`{stem}.txt`)

The full magazine dump is auto-saved as `{stem}.txt` next to the PDF (separate from manual **Save** → `{stem}.ocr.txt`). The next session loads matching `=== Page N ===` sections so speech uses proofed text without re-running Ollama; `--proofread` only fills gaps. `--no-cache` disables read/write. **Art** exports just the current article/ad.

**Default model:** `gemma4:e2b` (fast enough for per-page proof while browsing). Override with `--ollama-model` if you prefer another tag.

Progress updates about every 1–2 seconds (`Page i/n · chunk j/k · elapsed · chars out`). **Ctrl+C** (CLI) or **Stop** / **Esc** (player) cancels proofread; interrupting a stuck HTTP read may take a couple of seconds because stream reads use a short socket timeout. Cancelled proofread keeps already-proofed pages and raw OCR for the rest.

```bat
python -m ocr_read_aloud scan.pdf --lang eng --proofread --no-speak --save-text
python -m ocr_read_aloud scan.pdf --proofread --ollama-model gemma4:e2b
```

## How it works

1. **PDF**: each page is rendered to an RGB image with **PyMuPDF** at ~250 DPI. If the page has an extractable text layer (`get_text("dict")`), those line boxes (scaled to render DPI) are preferred; otherwise Tesseract OCR provides line boxes (good for true scans).
2. **OCR**: **pytesseract** → local **Tesseract** (`fin` / `eng` / `fin+eng`), including line bounding boxes via `image_to_data`.
3. **Proofread (optional)**: local **Ollama** lightly cleans OCR text for TTS per page, interleaved with OCR (`--proofread` or player **Proof**).
4. **TTS**: **pyttsx3** → Windows **SAPI5**, speaking line-by-line so the preview can track. Prefers a Finnish voice when `--voice` is omitted.
5. **Preview / player**: transport (**Save** / **Art** / **Proof** / **Voice** / **Cont→** / **Ad←**); titles promoted before column body.

## Why not WinRT OCR?

There is no widely maintained pure-pip WinRT OCR package that is as straightforward as Tesseract for a small offline CLI. This project uses **Tesseract + pytesseract** for reliable local OCR on Windows. WinRT OCR is **not** used.

## Smoke test (optional)

A synthetic test image can be generated (PIL):

```bat
python tests\make_sample_image.py
python -m ocr_read_aloud tests\sample_ocr.png --no-speak --lang eng
```

On Linux (dev machine), install `tesseract-ocr` + language packs to try OCR only; TTS may need `espeak` and is not the supported target.

## Project layout

```
ocr-read-aloud/
  pyproject.toml
  requirements.txt
  README.md
  ocr_read_aloud/
    __init__.py
    __main__.py
    cli.py
    ocr.py
    tts.py
    text_clean.py
    pdf_pages.py
    preview.py
    player.py
    article_export.py
    proof_cache.py
    ad_pages.py
    continue_links.py
    proofread.py
    io_util.py
    gui.py
  tests/
    make_sample_image.py
```

## License

MIT
