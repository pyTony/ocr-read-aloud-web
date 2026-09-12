# Architecture — OCR Read Aloud

**Version:** 1.5.9  
**Purpose:** Local Windows utility — OCR scanned PDFs/images (Tesseract), optional local Ollama proofread, then speak with SAPI5/pyttsx3 while showing a page preview + live caption.

See **README.md** for install, CLI flags, and user controls.

## Package layout (`ocr_read_aloud/`)

| Module | Role |
|--------|------|
| `__init__.py` | Package version (`__version__`). |
| `__main__.py` | `python -m ocr_read_aloud` entry. |
| `cli.py` | Argparse CLI: load input, OCR/stream pages, launch player. |
| `gui.py` | Simple tkinter file picker / launch UI. |
| `pdf_pages.py` | Render PDF pages to images (PyMuPDF). |
| `ocr.py` | Tesseract OCR → `OcrLine` boxes; reading-order helpers. |
| `text_clean.py` | Dehyphenation and shared text cleanup before speech. |
| `proofread.py` | Local Ollama proofread; `[[SKIP_AS_AD]]` marker. |
| `proof_cache.py` | Parse/write `{stem}.txt` proof cache sections. |
| `player.py` | `PageUnit` + `PlaybackController` (seek/pause/TTS/caption). |
| `preview.py` | Tk player window: preview, caption, transport, media keys. |
| `tts.py` | Windows SAPI5 speaker (threaded) / pyttsx3 fallback. |
| `continue_links.py` | “Continued on/from page N” parse + landing lookup. |
| `ad_pages.py` | Mid-article ad detect + auto-skip landing. |
| `article_export.py` | Save Art/Ad text; title/issue path helpers. |
| `io_util.py` | Shared path helpers (no CLI/preview imports). |

## Data flow

```
PDF / image / image-folder
    → pdf_pages (raster) or image load
    → ocr (Tesseract lines) + text_clean
    → optional proofread (Ollama) → proof_cache `{stem}.txt`
    → PageUnit.lines → speakable chunks (merge nearby lines)
    → PlaybackController.run()
         → one Speak() per sentence; caption = current sentence
         → preview show_region (chunk bbox) + set_caption
```

Streaming: CLI can append pages while the player is already speaking (`append_page` / `set_expect_more_pages`).

## Key controls (player)

- **← / →** — previous / next **sentence** (`_sent_idx`)
- **↑ / ↓**, Tab — previous / next **paragraph** (speakable chunk)
- **PgUp / PgDn** — page; forward may **auto-skip** mid-article ads
- **Cont→** / **←Back** — jump to “continued on page N” landing; same button returns to origin
- **Ad←** — visit skipped/queued ad; resume article
- **Pause** — leaves `_sent_idx` on the sentence that was speaking
- **Voice / Proof / Art** — runtime voice, Ollama proof, save article/ad

## Cache / sidecar files

- **`{pdf_stem}.txt`** — proofread cache (page sections); merged across partial sessions
- **Save Art / Save Ad** — article or ad text next to the source (title + optional `YYYY-MM`)

## Caption lockstep (1.5.4)

`_speak_chunk_with_caption` speaks **one sentence at a time**. Before each Speak it sets `_sent_idx` and the top caption. No wall-clock caption timer. Pause/seek interrupt leaves `_sent_idx` on (or moved to) the intended sentence; `run()` advances the chunk only when the sentence loop completes without pause/seek.

## Ad skip (1.5.5)

When F+2 continues from source folio F, `find_ad_skip` always treats F+1 as a skippable insert (long OCR marketing prose no longer blocks). Player safety net jumps past a landed `skip_as_ad` / queued ad on forward nav.

## Deferred

Save as PDF with original page images + searchable proofread text layer — see note in `article_export.py` / README (still TODO; not in 1.5.5).

## Planned
- Find-in-OCR: one-line clickable hits (Ctrl+F) — next release.
- PDF export with searchable OCR text layer.
