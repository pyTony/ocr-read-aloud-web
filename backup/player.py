"""Playback controller: speak pages/lines with pause, seek, and paging."""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from PIL import Image

from ocr_read_aloud.ad_pages import find_ad_skip, folio_of, looks_like_ad, looks_like_form_ad
from ocr_read_aloud.text_clean import expand_form_blanks
from ocr_read_aloud.article_export import (
    article_page_indices,
    default_article_save_path,
    format_pages_dump,
    save_pages_pdf,
)
from ocr_read_aloud.continue_links import (
    _looks_like_target_folio,
    find_continue_landing,
    parse_continued_from,
    parse_continued_on,
    pdf_page_number_from_label,
)
from ocr_read_aloud.ocr import OcrLine
from ocr_read_aloud.proof_cache import (
    format_proof_cache,
    lookup_cached_text,
    parse_proof_cache,
)
from ocr_read_aloud.tts import Speaker, list_voices as tts_list_voices



_SENTENCE_SPLIT = re.compile(
    r"(?<=[.!?…])\s+(?=[\"\'“‘(\[]?[A-ZÄÖÅÀ-Ö0-9])"
)


def _split_into_sentences(text: str) -> list[str]:
    """Split a speak chunk into sentence-sized units for TTS + caption lockstep."""
    raw = (text or "").strip()
    if not raw:
        return []
    # Normalize whitespace but keep paragraph breaks as soft splits
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r"\n{2,}", "\n", raw)
    pieces: list[str] = []
    for para in raw.split("\n"):
        para = para.strip()
        if not para:
            continue
        parts = _SENTENCE_SPLIT.split(para)
        buf = ""
        for part in parts:
            part = part.strip()
            if not part:
                continue
            # Re-attach short fragments (e.g. "Dr." leftovers) to next if too short
            if buf and len(buf) < 12 and not buf.endswith((".", "!", "?", "…")):
                buf = f"{buf} {part}"
            elif buf:
                pieces.append(buf)
                buf = part
            else:
                buf = part
        if buf:
            pieces.append(buf)
    # Drop tiny leftovers
    return [p for p in pieces if p.strip()]


def _merge_lines_to_chunks(
    lines: list[OcrLine],
    *,
    max_chars: int = 1200,
    gap_factor: float = 3.2,
) -> list[OcrLine]:
    """
    Merge consecutive OCR lines into larger speak chunks.

    SAPI has noticeable startup cost per Speak() call; short lines cause
    long gaps. Merge nearby lines (small vertical gap) up to max_chars.
    """
    from ocr_read_aloud.ocr import sort_lines_reading_order

    raw = [ln for ln in lines if ln.text and ln.text.strip()]
    if not raw:
        return []
    raw = sort_lines_reading_order(raw)

    def flush(group: list[OcrLine]) -> OcrLine:
        from ocr_read_aloud.text_clean import join_lines_dehyphenate

        text = join_lines_dehyphenate([g.text.strip() for g in group])
        x0 = min(g.left for g in group)
        y0 = min(g.top for g in group)
        x1 = max(g.left + g.width for g in group)
        y1 = max(g.top + g.height for g in group)
        return OcrLine(text=text, left=x0, top=y0, width=x1 - x0, height=y1 - y0)

    from ocr_read_aloud.ocr import lines_share_column

    chunks: list[OcrLine] = []
    cur: list[OcrLine] = [raw[0]]
    for ln in raw[1:]:
        prev = cur[-1]
        gap = ln.top - (prev.top + prev.height)
        avg_h = max(1.0, (prev.height + ln.height) / 2.0)
        cur_len = sum(len(g.text) for g in cur) + 1 + len(ln.text)
        same_col = lines_share_column(prev, ln)
        if (
            same_col
            and gap <= avg_h * gap_factor
            and cur_len <= max_chars
        ):
            cur.append(ln)
        else:
            chunks.append(flush(cur))
            cur = [ln]
    chunks.append(flush(cur))
    return chunks


@dataclass
class PageUnit:
    """One OCR/page unit ready for playback."""

    label: str
    image: Image.Image
    lines: list[OcrLine]
    # Set by proofread when the model marks the page as a mid-article ad.
    skip_as_ad: bool = False

    @property
    def speakable(self) -> list[OcrLine]:
        """Speak units: merged OCR line chunks. Falls back to friendly note for covers/noise."""
        import re as _re
        chunks = _merge_lines_to_chunks(self.lines)

        # Detect rubbish: text that is mostly non-alphanumeric (like "= = =")
        combined = " ".join(getattr(c, "text", "") or "" for c in chunks)
        if combined:
            real = sum(1 for ch in combined if ch.isalnum())
            alpha_ratio = real / max(1, len(combined))
            if real < 20 or alpha_ratio < 0.5:
                # Try to name the issue from the source filename (e.g., 1976_08_...)
                src = str(getattr(self, "_source_path", "") or self.label)
                m = _re.search(r"(19\d{2})[_-](\d{2})", src)
                if m:
                    year, month_num = m.groups()
                    months = {
                        "01": "January", "02": "February", "03": "March", "04": "April",
                        "05": "May", "06": "June", "07": "July", "08": "August",
                        "09": "September", "10": "October", "11": "November", "12": "December",
                    }
                    month = months.get(month_num)
                    if month:
                        text = f"{month} {year} cover."
                        return [OcrLine(text=text, left=0, top=0, width=100, height=40)]
                # Nothing to say about this page
                return []
        return chunks

    @property
    def text(self) -> str:
        return "\n".join(ln.text for ln in self.speakable).strip()


class PlaybackController:
    """
    Drives chunk-by-chunk TTS across preloaded PageUnits (merged lines).

    Thread-safe control methods (stop/pause/play/rew/fwd/para_*/page_up/page_down)
    may be called from the UI thread while run() executes on a worker.
    rew/fwd step by sentence; para_rew/para_fwd by speakable chunk; page_* by page.
    """

    def __init__(
        self,
        pages: Sequence[PageUnit],
        speaker: Speaker,
        *,
        preview: object | None = None,
        on_status: Callable[[str], None] | None = None,
        on_line: Callable[[int, int, OcrLine | None], None] | None = None,
        default_save_path: Path | str | None = None,
        document_text: str | None = None,
        proof_cache_path: Path | str | None = None,
        use_proof_cache: bool = True,
        source_path: Path | str | None = None,
                skip_ad_pages: bool = True,
        page_offset: int = 0,
    ) -> None:
        self._pages = list(pages)
        self._page_offset = page_offset
        self._speaker = speaker
        self._preview = preview
        self._on_status = on_status
        self._on_line = on_line
        self._default_save_path = (
            Path(default_save_path) if default_save_path is not None else None
        )
        # Optional prebuilt dump text; if None, built from pages on demand.
        self._document_text_override = document_text
        self._use_proof_cache = bool(use_proof_cache)
        self._proof_cache_path: Path | None = (
            Path(proof_cache_path) if proof_cache_path is not None else None
        )
        self._source_path: Path | None = (
            Path(source_path) if source_path is not None else None
        )
        self._skip_ad_pages = bool(skip_ad_pages)
        self._proof_cache_sections: dict[str, str] = {}
        if self._use_proof_cache and self._proof_cache_path is not None:
            try:
                if self._proof_cache_path.is_file():
                    self._proof_cache_sections = parse_proof_cache(
                        self._proof_cache_path.read_text(encoding="utf-8")
                    )
            except Exception as exc:  # noqa: BLE001
                print(f"Warning: could not read proof cache: {exc}")

        self._lock = threading.Lock()
        self._page_idx = 0
        self._line_idx = 0
        self._sent_idx = 0  # sentence index within current speakable chunk
        self._paused = False
        self._stopped = False
        self._interrupt = threading.Event()  # break out of current utterance wait
        self._wake = threading.Event()  # wake from pause wait
        self._wake.set()
        self._running = False
        # Per-page proof flags; proofread_done is True iff all True (and pages exist).
        self._page_proofed: list[bool] = [False] * len(self._pages)
        # When True, run() waits at end-of-pages for append_page (streaming OCR).
        self._expect_more_pages = False
        # Proof text waiting until we leave the page currently being spoken.
        self._deferred_proof: dict[int, str] = {}
        # Active “continued on page N” cue for the current chunk (UI Cont→).
        self._active_continue_to: int | None = None
        self._active_continue_from: int | None = None
        # Pending jump while target page is still streaming in.
        self._pending_continue: tuple[int, int | None] | None = None
        # Pending goto while target page is still streaming in.
        self._pending_goto: int | None = None
        # Avoid repeating Cont→N status hint for the same chunk.
        self._continue_hint_key: tuple[int, int, int] | None = None
        # Skipped ad page indices (article auto-skip); visit via Ad←.
        self._skipped_ads: list[int] = []
        # Proof/heuristic ad page indices (queue for Ad← / Ad menu).
        self._ad_queue: list[int] = []
        self._ad_skip_notice: bool = False
        self._ad_skip_notice_page: int | None = None
        # Resume article position after visiting a skipped ad.
        self._resume_after_ad: tuple[int, int] | None = None
        # Resume origin after Cont→ jump (←Back on the same button).
        self._resume_after_continue: tuple[int, int] | None = None

    # --- public state ---

    @property
    def page_count(self) -> int:
        return len(self._pages)

    @property
    def page_index(self) -> int:
        with self._lock:
            return self._page_idx

    @property
    def line_index(self) -> int:
        with self._lock:
            return self._line_idx

    @property
    def paused(self) -> bool:
        with self._lock:
            return self._paused

    @property
    def stopped(self) -> bool:
        with self._lock:
            return self._stopped

    def position_label(self) -> str:
        with self._lock:
            p, li, si = self._page_idx, self._line_idx, self._sent_idx
            if not self._pages or p >= len(self._pages):
                return ""
            page = self._pages[p]
            sents = self._sentences_at(p, li)
        import re
        m = re.search(r"(\d+)", page.label or "")
        if m:
            printed = int(m.group(1)) - self._page_offset
            if printed <= 0:
                label = "Cover" if p == 0 else "Page 1"
            else:
                label = f"Page {printed}"
        else:
            label = page.label
        if len(sents) > 1:
            return f"{label} · sentence {min(si, len(sents) - 1) + 1}/{len(sents)}"
        return label
    
    @property
    def default_save_path(self) -> Path | None:
        return self._default_save_path

    @property
    def proofread_done(self) -> bool:
        with self._lock:
            return bool(self._page_proofed) and all(self._page_proofed)

    def set_expect_more_pages(self, expect: bool) -> None:
        """Tell run() whether more pages may still be appended (streaming OCR)."""
        with self._lock:
            self._expect_more_pages = bool(expect)
            pending = self._pending_continue
            pending_goto = self._pending_goto
        if not expect:
            # Wake run loop if it was waiting for more pages.
            self._wake.set()
            if pending is not None:
                # Final chance: jump if landing appeared, else report not found.
                if not self._try_pending_continue():
                    with self._lock:
                        still = self._pending_continue
                        if still is not None:
                            target = still[0]
                            self._pending_continue = None
                            self._status(f"Continue page {target} not found")
            if pending_goto is not None:
                if not self._try_pending_goto():
                    with self._lock:
                        if self._pending_goto == pending_goto:
                            self._pending_goto = None
                            self._status(f"Go… · page {pending_goto} not found")

    def document_text(self) -> str:
        """Full OCR/read text (same shape as CLI dump / --save-text)."""
        self._flush_all_deferred_proofs()
        if self._document_text_override is not None:
            return self._document_text_override
        blocks: list[str] = []
        for page in self._pages:
            raw = "\n".join(ln.text for ln in page.lines if ln.text).strip()
            if raw:
                blocks.append(f"=== {page.label} ===\n{raw}\n")
            else:
                blocks.append(f"=== {page.label} ===\n")
        return "\n".join(blocks).strip() + ("\n" if blocks else "")

    def save_text(self, path: Path | str | None = None) -> Path:
        """
        Write full document text to ``path`` (or default_save_path).

        If neither is set, raises ValueError (UI should ask via filedialog).
        """
        out = Path(path) if path is not None else self._default_save_path
        if out is None:
            raise ValueError("No save path; choose a file location.")
        text = self.document_text()
        if not text.endswith("\n"):
            text = text + "\n"
        out.write_text(text, encoding="utf-8")
        self._status(f"Saved: {out}")
        return out

    def save_pdf(self, path: Path | str | None = None) -> Path:
        """Save the whole loaded document as an image PDF with OCR text."""
        out = Path(path) if path is not None else (
            self._default_save_path.with_suffix(".pdf")
            if self._default_save_path is not None
            else None
        )
        if out is None:
            raise ValueError("No save path; choose a file location.")
        with self._lock:
            pages = list(self._pages)
        result = save_pages_pdf(out, pages, range(len(pages)))
        self._status(f"Saved PDF: {result}")
        return result


    def current_article_indices(self) -> list[int]:
        """Page indices for the current article (or single ad if on a skipped ad)."""
        with self._lock:
            p = self._page_idx
            pages = list(self._pages)
            skipped = list(self._skipped_ads)
        return article_page_indices(pages, p, skipped_ads=skipped)

    def is_viewing_ad(self) -> bool:
        """True when current page is a skipped ad."""
        with self._lock:
            return self._page_idx in self._skipped_ads

    def default_article_save_path(self) -> Path:
        """Default path for Save Art / Save Ad next to the source PDF."""
        with self._lock:
            pages = list(self._pages)
            skipped = list(self._skipped_ads)
            p = self._page_idx
            source = self._source_path or self._default_save_path
        is_ad = p in skipped
        indices = [p] if is_ad else article_page_indices(pages, p, skipped_ads=skipped)
        if source is None:
            source = Path("article")
        return default_article_save_path(source, pages, indices, is_ad=is_ad)

    def save_article(self, path: Path | str | None = None) -> Path:
        """
        Save current article (story chain) or current ad page text.

        Default filename uses inferred title + magazine ``YYYY-MM`` when the
        source path looks like an issue. Full-magazine cache is unchanged.
        """
        with self._lock:
            pages = list(self._pages)
            skipped = list(self._skipped_ads)
            p = self._page_idx
        is_ad = p in skipped
        indices = [p] if is_ad else article_page_indices(pages, p, skipped_ads=skipped)
        if not indices:
            raise ValueError("Nothing to save")
        out = Path(path) if path is not None else self.default_article_save_path()
        body = format_pages_dump(pages, indices)
        if not body.endswith("\n"):
            body = body + "\n"
        out.write_text(body, encoding="utf-8")
        kind = "ad" if is_ad else "article"
        self._status(f"Saved {kind} · {out}")
        return out

    def save_article_pdf(self, path: Path | str | None = None) -> Path:
        """Save the current article (or ad) as an image PDF with OCR text."""
        with self._lock:
            pages = list(self._pages)
            skipped = list(self._skipped_ads)
            p = self._page_idx
        is_ad = p in skipped
        indices = [p] if is_ad else article_page_indices(pages, p, skipped_ads=skipped)
        if not indices:
            raise ValueError("Nothing to export")
        if path is None:
            text_path = self.default_article_save_path()
            path = text_path.with_suffix(".pdf")
        result = save_pages_pdf(path, pages, indices)
        self._status(f"Saved {'ad' if is_ad else 'article'} PDF · {result}")
        return result

    def append_page(self, page: PageUnit) -> None:
        """
        Thread-safe append of a newly OCR'd page. Does not change page index.

        Invalidates any document_text override. Safe while run() is speaking.
        If a continue-jump is waiting for this folio, auto-jump when landing found.
        """
        with self._lock:
            self._pages.append(page)
            self._page_proofed.append(False)
            self._document_text_override = None
            pending = self._pending_continue
            pending_goto = self._pending_goto
        with self._lock:
            n = len(self._pages)
        self._wake.set()
        self._status(f"OCR page ready · {n} loaded")
        if pending is not None:
            self._try_pending_continue()
        if pending_goto is not None:
            self._try_pending_goto()

    def mark_page_proofed(self, index: int) -> None:
        """Mark a page as proof-attempted (success, skip, or failed) without changing text."""
        with self._lock:
            if 0 <= index < len(self._page_proofed):
                self._page_proofed[index] = True

    def _lines_from_proof_text(self, page: PageUnit, new_text: str) -> list[OcrLine]:
        """
        Build speakable paragraph OcrLines from proofread text.

        Honors a leading ``[[SKIP_AS_AD]]`` marker (sets ``page.skip_as_ad``).
        Blank-line-separated paragraphs become separate lines spaced so merge
        keeps them as distinct speakable chunks.
        """
        from ocr_read_aloud.proofread import parse_proof_page_text
        from ocr_read_aloud.text_clean import dehyphenate_inline

        body, is_ad = parse_proof_page_text(new_text or "")
        page.skip_as_ad = bool(is_ad)
        if not body:
            return []
        left, top = 0, 0
        try:
            w, h = page.image.size
            width, height = int(w), int(h)
        except Exception:  # noqa: BLE001
            if page.lines:
                x0 = min(ln.left for ln in page.lines)
                y0 = min(ln.top for ln in page.lines)
                x1 = max(ln.left + ln.width for ln in page.lines)
                y1 = max(ln.top + ln.height for ln in page.lines)
                left, top, width, height = x0, y0, x1 - x0, y1 - y0
            else:
                width, height = 100, 40
        paras = [dehyphenate_inline(p.strip()) for p in body.split("\n\n") if p.strip()]
        if not paras:
            paras = [body]
        # Space paragraphs far apart vertically so _merge_lines_to_chunks
        # does not glue them into one mega-chunk (gap_factor ~3.2).
        line_h = max(24, height // max(4, len(paras) * 2))
        gap = max(120, int(line_h * 5))
        out: list[OcrLine] = []
        y = top
        for para in paras:
            out.append(
                OcrLine(text=para, left=left, top=y, width=width, height=line_h)
            )
            y += gap
        return out

    def replace_one_page_text(
        self, index: int, text: str, *, mark_proofed: bool = True
    ) -> None:
        """
        Replace one page's OCR lines with proofread text (single paragraph OcrLine).

        If currently speaking that page, apply the correction and restart that
        page from its beginning so playback and preview use the corrected text.
        Does not jump the page index. Marks that page proofed when mark_proofed.
        """
        with self._lock:
            if index < 0 or index >= len(self._pages):
                return
            n_pages = len(self._pages)
            speaking_this = self._page_idx == index and self._running
            if mark_proofed and index < len(self._page_proofed):
                self._page_proofed[index] = True
            self._document_text_override = None
            page = self._pages[index]
            page.lines = self._lines_from_proof_text(page, text)
            if getattr(page, "skip_as_ad", False) and index not in self._ad_queue:
                self._ad_queue.append(index)
            self._deferred_proof.pop(index, None)
            if speaking_this:
                self._line_idx = 0
                self._sent_idx = 0
            all_done = bool(self._page_proofed) and all(self._page_proofed)
        if speaking_this:
            folio = self._folio_for_index(index)
            self._seek_interrupt()
            self._refresh_preview(update_region=True)
            status = f"Proof applied · page {folio} (restarting corrected text)"
            if all_done:
                status = f"Proof applied · page {folio} (all pages queued)"
            self._status(status)
            self._write_proof_cache()
            return
        folio = self._folio_for_index(index)
        status = f"Proof applied · page {folio} ({index + 1}/{n_pages} in session)"
        if all_done:
            status = "Proofread applied"
        self._status(status)
        self._write_proof_cache()

    def _flush_deferred_proof(self, index: int) -> None:
        """Apply deferred proof text for ``index`` into page.lines (no seek)."""
        with self._lock:
            text = self._deferred_proof.pop(index, None)
            if text is None:
                return
            if index < 0 or index >= len(self._pages):
                return
            page = self._pages[index]
            page.lines = self._lines_from_proof_text(page, text)
            if getattr(page, "skip_as_ad", False):
                if index not in self._ad_queue:
                    self._ad_queue.append(index)
            self._document_text_override = None
            still_on = self._page_idx == index and self._running
        if still_on:
            # Leaving-page callers should not hit this; avoid interrupt if they do.
            return
        self._write_proof_cache()

    def _flush_all_deferred_proofs(self) -> None:
        with self._lock:
            indices = list(self._deferred_proof.keys())
        for i in indices:
            self._flush_deferred_proof(i)

    def replace_page_texts(self, page_texts: Sequence[str]) -> None:
        """
        Replace each page's OCR lines with proofread text.

        Resets line index to 0 on the current page via the first replace that
        matches; marks all replaced pages proofed.
        """
        n = min(len(self._pages), len(page_texts))
        for i in range(n):
            self.replace_one_page_text(i, page_texts[i], mark_proofed=True)
        # Ensure any trailing pages without new text stay as-is but if we replaced
        # all existing pages, status already set. Force line reset once at end.
        with self._lock:
            self._line_idx = 0
            self._sent_idx = 0
            self._document_text_override = None
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status("Proofread applied")

    def apply_proofread(
        self,
        *,
        model: str | None = None,
        host: str | None = None,
        on_progress: Callable[[str], None] | None = None,
    ) -> bool:
        """
        Proofread each page via local Ollama one at a time; apply immediately.

        Returns True if every page was proofed successfully. On cancel, leaves
        already-proofed pages as-is and returns False. On total Ollama failure
        on the first non-empty page, returns False (keeps raw OCR). Later-page
        failures warn and leave that page raw (still marked attempted).
        Safe to call from a worker thread.
        """
        from ocr_read_aloud.proofread import (
            DEFAULT_OLLAMA_HOST,
            DEFAULT_OLLAMA_MODEL,
            ProofreadCancelled,
            ProofreadError,
            clear_proofread_cancel,
            proofread_text,
            warn_and_continue,
        )

        model = model or DEFAULT_OLLAMA_MODEL
        host = host or DEFAULT_OLLAMA_HOST
        clear_proofread_cancel()
        progress = on_progress or (lambda m: self._status(m))

        with self._lock:
            snapshot = list(self._pages)
        n = len(snapshot)
        if n == 0:
            return False

        any_applied = False
        first_failure = True
        for i, page in enumerate(snapshot):
            raw = "\n".join(ln.text for ln in page.lines if ln.text).strip()
            if not raw:
                self.mark_page_proofed(i)
                continue
            try:
                folio = pdf_page_number_from_label(page.label) or (i + 1)
                fixed = proofread_text(
                    raw,
                    model=model,
                    host=host,
                    on_progress=progress,
                    page_index=int(folio),
                    page_count=n,
                )
            except ProofreadCancelled:
                self._status("Proofread cancelled")
                return False
            except ProofreadError as exc:
                if first_failure and not any_applied:
                    warn_and_continue(str(exc) + " Continuing with raw OCR.")
                    self._status("Proofread failed — using raw OCR")
                    return False
                warn_and_continue(
                    f"Proofread failed on page {i + 1}: {exc}. Keeping raw OCR."
                )
                self.mark_page_proofed(i)
                first_failure = False
                continue
            except Exception as exc:  # noqa: BLE001
                if first_failure and not any_applied:
                    warn_and_continue(
                        f"Proofread error: {exc}. Continuing with raw OCR."
                    )
                    self._status("Proofread failed — using raw OCR")
                    return False
                warn_and_continue(
                    f"Proofread error on page {i + 1}: {exc}. Keeping raw OCR."
                )
                self.mark_page_proofed(i)
                first_failure = False
                continue
            self.replace_one_page_text(i, fixed, mark_proofed=True)
            any_applied = True
            first_failure = False
        return self.proofread_done

    # --- controls (UI thread) ---

    def stop(self) -> None:
        with self._lock:
            self._stopped = True
            self._paused = False
        self._wake.set()
        self._interrupt.set()
        # Abort in-progress Ollama proofread (Proof button / --proofread worker).
        try:
            from ocr_read_aloud.proofread import set_proofread_cancel

            set_proofread_cancel(True)
        except Exception:  # noqa: BLE001
            pass
        try:
            self._speaker.stop()
        except Exception:  # noqa: BLE001
            pass
        self._status("Stopped")

    def pause(self) -> None:
        with self._lock:
            if self._stopped:
                return
            self._paused = True
        self._interrupt.set()
        try:
            self._speaker.stop()
        except Exception:  # noqa: BLE001
            pass
        self._wake.clear()
        self._status("Paused")
        # _sent_idx stays on the sentence that was speaking; refresh caption.
        self._refresh_preview(update_region=True)

    def play(self) -> None:
        """Resume from the current line (or start if not running externally)."""
        with self._lock:
            if self._stopped:
                # Allow resume only if run() still active; clear stop for mid-run
                # resume after accidental stop is not supported — run() exits.
                return
            was_paused = self._paused
            self._paused = False
        if was_paused:
            self._interrupt.clear()
            self._wake.set()
            self._status("Playing")
            self._refresh_preview(update_region=True)

    def toggle_pause(self) -> None:
        with self._lock:
            paused = self._paused
            stopped = self._stopped
        if stopped:
            return
        if paused:
            self.play()
        else:
            self.pause()

    def set_voice(self, filter_or_id: str) -> str:
        """Apply a TTS voice at runtime; status shows Voice · {name}."""
        # Interrupt current utterance so the next Speak uses the new voice.
        try:
            self._speaker.stop()
        except Exception:  # noqa: BLE001
            pass
        try:
            name = self._speaker.set_voice(filter_or_id or None)
        except Exception as exc:  # noqa: BLE001
            self._status(f"Voice failed · {exc}")
            raise
        self._status(f"Voice · {name}")
        return name

    def list_voices(self) -> list:
        """Passthrough of installed TTS voices for the player UI."""
        return tts_list_voices()

    def current_voice_name(self) -> str:
        """Best-effort name of the active TTS voice."""
        sp = self._speaker
        if hasattr(sp, "current_voice_name"):
            try:
                return str(sp.current_voice_name() or "")
            except Exception:  # noqa: BLE001
                return ""
        return ""


    def _sentences_at(self, page_idx: int, line_idx: int) -> list[str]:
        """Sentence units for the speakable chunk at ``(page_idx, line_idx)``."""
        if page_idx < 0 or page_idx >= len(self._pages):
            return []
        lines = self._pages[page_idx].speakable
        if line_idx < 0 or line_idx >= len(lines):
            return []
        text = expand_form_blanks((lines[line_idx].text or "").strip())
        if not text:
            return []
        return _split_into_sentences(text) or [text]

    def _clamp_sent_idx(self) -> None:
        """Clamp ``_sent_idx`` for the current page/line. Caller holds the lock."""
        sents = self._sentences_at(self._page_idx, self._line_idx)
        n = len(sents)
        if n <= 0:
            self._sent_idx = 0
        else:
            self._sent_idx = max(0, min(self._sent_idx, n - 1))

    def _current_sentence_text(self, line: OcrLine | None = None) -> str:
        """Caption text for the current sentence index within ``line`` (or current chunk)."""
        with self._lock:
            p, li, si = self._page_idx, self._line_idx, self._sent_idx
        if line is None:
            if not self._pages or p >= len(self._pages):
                return ""
            lines = self._pages[p].speakable
            if not lines or li < 0 or li >= len(lines):
                return ""
            line = lines[li]
        text = (line.text or "").strip()
        if not text:
            return ""
        sents = _split_into_sentences(text) or [text]
        if not sents:
            return ""
        si = max(0, min(si, len(sents) - 1))
        return sents[si]

    def rew(self) -> None:
        """Go to previous sentence (or previous chunk's last sentence)."""
        left_page: int | None = None
        with self._lock:
            if self._stopped or not self._pages:
                return
            old_page = self._page_idx
            if self._sent_idx > 0:
                self._sent_idx -= 1
            elif self._line_idx > 0:
                self._line_idx -= 1
                prev = self._sentences_at(self._page_idx, self._line_idx)
                self._sent_idx = max(0, len(prev) - 1)
            elif self._page_idx > 0:
                self._page_idx -= 1
                lines = self._pages[self._page_idx].speakable
                self._line_idx = max(0, len(lines) - 1)
                prev = self._sentences_at(self._page_idx, self._line_idx)
                self._sent_idx = max(0, len(prev) - 1)
            else:
                self._sent_idx = 0
            self._clamp_sent_idx()
            sents = self._sentences_at(self._page_idx, self._line_idx)
            si = self._sent_idx
            if self._page_idx != old_page:
                left_page = old_page
        if left_page is not None:
            self._after_nav_page_change(left_page)
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        with self._lock:
            sents = self._sentences_at(self._page_idx, self._line_idx)
            si = self._sent_idx
        n = max(1, len(sents))
        self._status(f"Sentence {si + 1}/{n} · {self.position_label()}")

    def fwd(self) -> None:
        """Go to next sentence (or next chunk's first sentence)."""
        left_page: int | None = None
        with self._lock:
            if self._stopped or not self._pages:
                return
            old_page = self._page_idx
            sents = self._sentences_at(self._page_idx, self._line_idx)
            if self._sent_idx + 1 < len(sents):
                self._sent_idx += 1
            else:
                page = self._pages[self._page_idx]
                n = len(page.speakable)
                if self._line_idx + 1 < n:
                    self._line_idx += 1
                    self._sent_idx = 0
                elif self._page_idx + 1 < len(self._pages):
                    self._page_idx += 1
                    self._line_idx = 0
                    self._sent_idx = 0
                # else stay on last sentence
            self._clamp_sent_idx()
            sents = self._sentences_at(self._page_idx, self._line_idx)
            si = self._sent_idx
            if self._page_idx != old_page:
                left_page = old_page
        if left_page is not None:
            self._after_nav_page_change(left_page)
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        with self._lock:
            sents = self._sentences_at(self._page_idx, self._line_idx)
            si = self._sent_idx
        n = max(1, len(sents))
        self._status(f"Sentence {si + 1}/{n} · {self.position_label()}")

    def para_rew(self) -> None:
        """Go to previous speakable chunk (paragraph); reset sentence index."""
        left_page: int | None = None
        with self._lock:
            if self._stopped or not self._pages:
                return
            old_page = self._page_idx
            if self._line_idx > 0:
                self._line_idx -= 1
            elif self._page_idx > 0:
                self._page_idx -= 1
                lines = self._pages[self._page_idx].speakable
                self._line_idx = max(0, len(lines) - 1)
            else:
                self._line_idx = 0
            self._sent_idx = 0
            if self._page_idx != old_page:
                left_page = old_page
        if left_page is not None:
            self._after_nav_page_change(left_page)
            with self._lock:
                # Backward hop lands on last chunk; para_rew wants start of that chunk
                self._sent_idx = 0
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status(f"Para ← · {self.position_label()}")

    def para_fwd(self) -> None:
        """Go to next speakable chunk (paragraph); reset sentence index."""
        left_page: int | None = None
        with self._lock:
            if self._stopped or not self._pages:
                return
            old_page = self._page_idx
            page = self._pages[self._page_idx]
            n = len(page.speakable)
            if self._line_idx + 1 < n:
                self._line_idx += 1
                self._sent_idx = 0
            elif self._page_idx + 1 < len(self._pages):
                self._page_idx += 1
                self._line_idx = 0
                self._sent_idx = 0
            else:
                self._sent_idx = 0
            if self._page_idx != old_page:
                left_page = old_page
        if left_page is not None:
            self._after_nav_page_change(left_page)
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status(f"Para → · {self.position_label()}")

    def page_up(self) -> None:
        left_page: int | None = None
        with self._lock:
            if self._stopped or not self._pages:
                return
            if self._page_idx > 0:
                left_page = self._page_idx
                self._page_idx -= 1
                self._line_idx = 0
                self._sent_idx = 0
        if left_page is not None:
            self._after_nav_page_change(left_page)
            with self._lock:
                self._line_idx = 0
                self._sent_idx = 0
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status(f"Page Up · {self.position_label()}")

    def page_down(self) -> None:
        left_page: int | None = None
        with self._lock:
            if self._stopped or not self._pages:
                return
            if self._page_idx + 1 < len(self._pages):
                left_page = self._page_idx
                self._page_idx += 1
                self._line_idx = 0
                self._sent_idx = 0
        if left_page is not None:
            self._after_nav_page_change(left_page)
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status(f"Page Down · {self.position_label()}")

    def _find_page_target(
        self, pages: Sequence[PageUnit], number: int, *, allow_heuristic: bool = True
    ) -> int | None:
        """
        Find a loaded page by printed folio, PDF label, or session index.

        Applies ``self._page_offset`` (printed page = PDF index - offset) so
        that typing a real/printed page number lands correctly even when
        front matter/covers shift the printed numbering away from the raw
        PDF page index. Mirrors the offset handling already used by
        ``find_continue_landing`` for the automatic continue-link jump.
        """
        offset = self._page_offset
        # Priority 1: exact printed-folio match (OCR'd footer number).
        for i, page in enumerate(pages):
            if folio_of(page) == number:
                return i
        # Priority 2: offset-adjusted PDF index guess, only if no page's own
        # OCR'd folio clearly disagrees with it.
        if offset:
            candidate = number + offset - 1  # 0-based PDF index guess
            if 0 <= candidate < len(pages):
                existing = folio_of(pages[candidate])
                if existing is None or existing == number:
                    return candidate
        # Priority 3: heuristic near-edge folio match, offset-aware.
        if allow_heuristic:
            for i, page in enumerate(pages):
                try:
                    if _looks_like_target_folio(page, number, offset=offset):
                        return i
                except Exception:  # noqa: BLE001
                    continue
        # Priority 4: raw 1-based index guess — only safe when no offset is
        # known; with a nonzero offset, an unqualified guess is more likely
        # wrong than useful, so report "not found" instead of mis-landing.
        if not offset and number <= len(pages):
            return number - 1
        return None

    def _try_pending_goto(self) -> bool:
        """Resolve a goto target after another streamed page is appended."""
        with self._lock:
            target = self._pending_goto
            pages = list(self._pages)
        if target is None:
            return False
        if self._find_page_target(pages, target, allow_heuristic=False) is None:
            return False
        return self.goto_page(target)

    def goto_page(self, folio_or_index: int | str) -> bool:
        """
        Jump to a page by printed folio or 1-based PDF/session index.

        Prefer ``folio_of(page)`` match, then clear printed folio near edges,
        else treat ``n`` as 1-based playlist index. Resets line/sentence to 0.
        """
        try:
            n = int(str(folio_or_index).strip())
        except (TypeError, ValueError):
            self._status("Go… · enter a page number")
            return False
        if n < 1:
            self._status("Go… · page number must be ≥ 1")
            return False

        with self._lock:
            if self._stopped or not self._pages:
                return False
            pages = list(self._pages)
            target = self._find_page_target(pages, n)
            left = None
            if target is None:
                if self._expect_more_pages:
                    self._pending_goto = n
                    self._status(f"Waiting for page {n}…")
                    return False
            else:
                self._pending_goto = None
                left = self._page_idx if self._page_idx != target else None
                self._page_idx = target
                self._line_idx = 0
                self._sent_idx = 0

        if target is None:
            self._status(f"Go… · page {n} not found")
            return False
        if left is not None:
            self._after_nav_page_change(left, auto_skip=False)
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status(f"Go · {self.position_label()}")
        return True

    def current_continue_target(self) -> tuple[int, int] | None:
        """
        Return ``(target_folio, source_folio_or_0)`` for the Cont→ UI, or None.
        """
        with self._lock:
            target = self._active_continue_to
            if target is None and self._pending_continue is not None:
                target = self._pending_continue[0]
                src = self._pending_continue[1]
                return (target, int(src or 0))
            if target is None:
                return None
            src = self._active_continue_from
            return (target, int(src or 0))

    def continue_button_mode(self) -> str | None:
        """``'resume'`` if ←Back should return to Cont→ origin; ``'forward'`` for Cont→; else None."""
        with self._lock:
            resume = self._resume_after_continue
            if resume is not None and self._page_idx != resume[0]:
                return "resume"
            if self._active_continue_to is not None or self._pending_continue is not None:
                return "forward"
            return None

    def resume_after_continue(self) -> bool:
        """Return to the page/line saved when Cont→ jumped forward."""
        with self._lock:
            resume = self._resume_after_continue
            if resume is None or self._stopped:
                return False
            new_p, new_l = resume
            if new_p < 0 or new_p >= len(self._pages):
                self._resume_after_continue = None
                return False
            left = self._page_idx if self._page_idx != new_p else None
            self._page_idx = new_p
            self._line_idx = max(0, new_l)
            self._sent_idx = 0
            self._resume_after_continue = None
        if left is not None:
            self._flush_deferred_proof(left)
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status("Back · continue origin")
        return True

    def jump_continue(self) -> bool:
        """
        Cont→ / ←Back toggle: jump to “continued on page N”, or return to origin.

        While ``_resume_after_continue`` is set and the current page is not that
        origin, the same control resumes instead of chaining another continue.

        Returns True if the landing page was found and jumped to. If the target
        is not loaded yet but more pages are expected, arms a pending jump and
        returns False. Returns False also when no cue / not found after load.
        """
        if self.continue_button_mode() == "resume":
            return self.resume_after_continue()

        with self._lock:
            if self._stopped or not self._pages:
                return False
            p_idx = self._page_idx
            page = self._pages[p_idx] if 0 <= p_idx < len(self._pages) else None
            target = self._active_continue_to
            source = self._active_continue_from
            expect_more = self._expect_more_pages

        if page is not None:
            # Re-parse current page if active target missing
            page_text = page.text or ""
            ons = parse_continued_on(page_text)
            if target is None and ons:
                target = ons[0]
            if source is None:
                source = pdf_page_number_from_label(page.label)
            if source is None:
                froms = parse_continued_from(page_text)
                # Unusual on a “continued on” page, but allow
                if froms:
                    source = froms[0]

        if target is None:
            with self._lock:
                if self._pending_continue is not None:
                    target = self._pending_continue[0]
                    source = self._pending_continue[1]
            if target is None:
                self._status("No continued-on cue")
                return False

        return self._jump_to_continue(target, source, expect_more=expect_more)

    def _jump_to_continue(
        self,
        target: int,
        source: int | None,
        *,
        expect_more: bool | None = None,
    ) -> bool:
        with self._lock:
            pages = list(self._pages)
            if expect_more is None:
                expect_more = self._expect_more_pages

        landing = find_continue_landing(
            pages, target_folio=target, source_folio=source,
            offset=self._page_offset,
        )
        if landing is not None:
            new_p, new_l = landing
            left_page: int | None = None
            with self._lock:
                self._pending_continue = None
                origin = (self._page_idx, self._line_idx)
                if new_p != self._page_idx:
                    left_page = self._page_idx
                self._page_idx = new_p
                self._line_idx = max(0, new_l)
                self._sent_idx = 0
                # Remember origin for ←Back (same Cont→ button); do not chain.
                if origin[0] != new_p:
                    self._resume_after_continue = origin
            if left_page is not None:
                self._flush_deferred_proof(left_page)
            self._seek_interrupt()
            self._refresh_preview(update_region=True)
            self._status(f"Jumped · continued on {target}")
            return True

        if expect_more:
            with self._lock:
                self._pending_continue = (target, source)
            self._status(f"Waiting for page {target}…")
            return False

        with self._lock:
            self._pending_continue = None
        self._status(f"Continue page {target} not found")
        return False

    def _try_pending_continue(self) -> bool:
        """If a pending continue landing is now available, jump to it."""
        with self._lock:
            pending = self._pending_continue
            expect_more = self._expect_more_pages
        if pending is None:
            return False
        target, source = pending
        landing = find_continue_landing(
            list(self._pages), target_folio=target, source_folio=source,
            offset=self._page_offset,
        )
        if landing is None:
            return False
        return self._jump_to_continue(target, source, expect_more=expect_more)

    def _update_active_continue(
        self, page: PageUnit, line: OcrLine | None, *, p_idx: int, l_idx: int
    ) -> None:
        """Scan current page/line for “continued on” and update Cont→ state."""
        texts: list[str] = []
        if line is not None and line.text:
            texts.append(line.text)
        try:
            page_text = page.text or ""
        except Exception:  # noqa: BLE001
            page_text = ""
        if page_text:
            texts.append(page_text)
        blob = "\n".join(texts)
        ons = parse_continued_on(blob)
        source = pdf_page_number_from_label(page.label)
        with self._lock:
            if ons:
                self._active_continue_to = ons[0]
                self._active_continue_from = source
                hint_key = (p_idx, l_idx, ons[0])
                already = self._continue_hint_key == hint_key
                self._continue_hint_key = hint_key
            else:
                # Keep pending target visible in UI; clear live cue if none.
                self._active_continue_to = None
                self._active_continue_from = None
                already = True  # no new hint
                hint_key = None
        if ons and not already:
            # Light status/caption hint once per chunk
            n = ons[0]
            prev = self._preview
            if prev is not None and hasattr(prev, "set_status"):
                try:
                    # Prefer not to clobber stronger statuses; only hint lightly.
                    prev.set_status(f"Cont→{n} available")
                except Exception:  # noqa: BLE001
                    pass


    # --- proofread cache ---

    def _folio_for_index(self, index: int) -> int:
        """PDF/printed page number from label, else playlist index+1."""
        with self._lock:
            if 0 <= index < len(self._pages):
                label = self._pages[index].label
            else:
                return index + 1
        n = pdf_page_number_from_label(label)
        return int(n) if n else index + 1

    def apply_cached_proof(self, index: int) -> bool:
        """Apply cached proof text for page ``index`` if present. Returns True if applied."""
        if not self._use_proof_cache or not self._proof_cache_sections:
            return False
        with self._lock:
            if index < 0 or index >= len(self._pages):
                return False
            label = self._pages[index].label
        cached = lookup_cached_text(self._proof_cache_sections, label)
        if cached is None or not str(cached).strip():
            return False
        self.replace_one_page_text(index, cached, mark_proofed=True)
        return True

    def cached_text_for_label(self, label: str) -> str | None:
        """Return cached proof body for ``label``, or None."""
        if not self._use_proof_cache:
            return None
        return lookup_cached_text(self._proof_cache_sections, label)

    def _write_proof_cache(self) -> None:
        """Best-effort update of ``{stem}.txt``, merging into any existing cache.

        Partial sessions (``--start-page`` / ``--end-page``) must not wipe other
        pages already stored in the cache file.
        """
        if not self._use_proof_cache or self._proof_cache_path is None:
            return
        try:
            sections: dict[str, str] = {}
            try:
                if self._proof_cache_path.is_file():
                    sections.update(
                        parse_proof_cache(
                            self._proof_cache_path.read_text(encoding="utf-8")
                        )
                    )
            except Exception:  # noqa: BLE001
                pass
            sections.update(self._proof_cache_sections)
            with self._lock:
                pages = list(self._pages)
            for page in pages:
                raw = "\n".join(ln.text for ln in page.lines if ln.text).strip()
                sections[page.label] = raw
                self._proof_cache_sections[page.label] = raw
            body = format_proof_cache(sections)
            self._proof_cache_path.write_text(body, encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not write proof cache: {exc}")
            try:
                self._status(f"Proof cache write failed: {exc}")
            except Exception:  # noqa: BLE001
                pass

    def current_skipped_ad(self) -> tuple[int, int] | None:
        """
        Return ``(page_index, folio_or_0)`` for Ad← UI, or None.

        Prefers last auto-skipped ad; falls back to last proof/heuristic ad-queue
        entry so Ad← works even before a skip happens.
        """
        with self._lock:
            if self._resume_after_ad is not None and self._skipped_ads:
                # Prefer the ad we're visiting if current page is a skipped ad
                if self._page_idx in self._skipped_ads:
                    idx = self._page_idx
                else:
                    idx = self._skipped_ads[-1]
            elif self._skipped_ads:
                idx = self._skipped_ads[-1]
            elif self._ad_queue:
                idx = self._ad_queue[-1]
            else:
                return None
            if idx < 0 or idx >= len(self._pages):
                return None
            folio = folio_of(self._pages[idx]) or 0
            return (idx, int(folio))

    def ad_button_mode(self) -> str | None:
        """``'resume'`` if Art→ should return to article; ``'visit'`` for Ad←; else None."""
        with self._lock:
            if (
                self._resume_after_ad is not None
                and self._skipped_ads
                and self._page_idx in self._skipped_ads
            ):
                return "resume"
            if self._skipped_ads or self._ad_queue:
                return "visit"
            return None

    def jump_ad(self) -> bool:
        """Visit last skipped ad, or resume article if already on that ad."""
        mode = self.ad_button_mode()
        if mode == "resume":
            return self.resume_after_ad()
        if mode == "visit":
            return self.jump_skipped_ad()
        self._status("No skipped ad")
        return False

    def jump_skipped_ad(self) -> bool:
        """Jump to the most recently skipped (or queued) ad; remember resume point."""
        with self._lock:
            if self._stopped:
                return False
            if self._skipped_ads:
                ad_idx = self._skipped_ads[-1]
            elif self._ad_queue:
                ad_idx = self._ad_queue[-1]
            else:
                return False
            if ad_idx < 0 or ad_idx >= len(self._pages):
                return False
            # Resume where we are now (article continue page)
            self._resume_after_ad = (self._page_idx, self._line_idx)
            left = self._page_idx if self._page_idx != ad_idx else None
            self._page_idx = ad_idx
            self._line_idx = 0
            self._sent_idx = 0
            folio = folio_of(self._pages[ad_idx]) or 0
            self._ad_skip_notice = False
            self._ad_skip_notice_page = None
        if left is not None:
            self._flush_deferred_proof(left)
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status(f"Ad · p.{folio}" if folio else "Ad page")
        return True

    def jump_ad_at(self, ad_idx: int) -> bool:
        """Jump to a specific ad-queue page (from the Ad← menu)."""
        with self._lock:
            if self._stopped or ad_idx < 0 or ad_idx >= len(self._pages):
                return False
            if ad_idx not in self._ad_queue:
                self._ad_queue.append(ad_idx)
            # Make this the "last skipped" target for jump_skipped_ad
            self._skipped_ads = [i for i in self._skipped_ads if i != ad_idx] + [ad_idx]
        return self.jump_skipped_ad()

    def resume_after_ad(self) -> bool:
        """Return to the article position saved when Ad← was used."""
        with self._lock:
            resume = self._resume_after_ad
            if resume is None or self._stopped:
                return False
            new_p, new_l = resume
            if new_p < 0 or new_p >= len(self._pages):
                self._resume_after_ad = None
                return False
            left = self._page_idx if self._page_idx != new_p else None
            self._page_idx = new_p
            self._line_idx = max(0, new_l)
            self._sent_idx = 0
            self._resume_after_ad = None
        if left is not None:
            self._flush_deferred_proof(left)
        self._seek_interrupt()
        self._refresh_preview(update_region=True)
        self._status("Resumed article")
        return True

    def _after_nav_page_change(self, old_page: int, *, auto_skip: bool = True) -> None:
        """
        After nav changes the page: flush deferred proof.

        Forward (↓ / → / PgDn / autoplay): auto-skip mid-article ads.
        Backward (PgUp / ←): allow landing on the ad (manual access).
        """
        with self._lock:
            new_page = self._page_idx
        if new_page == old_page:
            return
        self._flush_deferred_proof(old_page)
        if new_page > old_page and auto_skip and self._skip_ad_pages:
            self._try_ad_skip_from(old_page)
        else:
            # Backward: keep ad landing; clear flash notice if leaving continue page
            self._maybe_clear_ad_skip_notice()

    def _enqueue_ad(self, ad_idx: int) -> None:
        """Record ad page in skip list + discovery queue (deduped, order preserved)."""
        with self._lock:
            if ad_idx not in self._skipped_ads:
                self._skipped_ads.append(ad_idx)
            if ad_idx not in self._ad_queue:
                self._ad_queue.append(ad_idx)

    def _note_possible_standalone_ad(self, page: PageUnit, idx: int) -> None:
        """
        Record a page that looks like an ad but was reached by normal
        playback rather than an ad-skip (i.e. it does not interrupt an
        article's continuation, per policy: standalone commercial pages are
        read normally, not skipped).

        Adds it only to ``_ad_queue`` (for ad_queue()/jump_ad() navigation)
        and deliberately *not* to ``_skipped_ads``, so ``is_viewing_ad()``
        correctly stays False while it's being read normally.
        """
        try:
            is_ad = (
                bool(getattr(page, "skip_as_ad", False))
                or looks_like_ad(page)
                or looks_like_form_ad(page)
            )
        except Exception:  # noqa: BLE001
            return
        if not is_ad:
            return
        with self._lock:
            if idx not in self._ad_queue:
                self._ad_queue.append(idx)

    def ad_queue(self) -> list[tuple[int, int]]:
        """Return ``[(page_index, folio_or_0), ...]`` for known ad pages."""
        with self._lock:
            out: list[tuple[int, int]] = []
            for idx in self._ad_queue:
                if 0 <= idx < len(self._pages):
                    out.append((idx, int(folio_of(self._pages[idx]) or 0)))
            return out

    def ad_skip_notice_active(self) -> bool:
        with self._lock:
            return bool(self._ad_skip_notice)

    def clear_ad_skip_notice(self) -> None:
        with self._lock:
            self._ad_skip_notice = False
            self._ad_skip_notice_page = None

    def _maybe_clear_ad_skip_notice(self) -> None:
        with self._lock:
            if not self._ad_skip_notice:
                return
            notice_page = self._ad_skip_notice_page
            cur = self._page_idx
            # Dismiss when user leaves the continue landing (or opens the ad).
            if notice_page is not None and cur != notice_page and cur not in self._skipped_ads:
                self._ad_skip_notice = False
                self._ad_skip_notice_page = None

    def _notify_ad_skipped(self, ad_idx: int, cont_idx: int) -> None:
        with self._lock:
            self._ad_skip_notice = True
            self._ad_skip_notice_page = cont_idx
            folio = folio_of(self._pages[ad_idx]) if 0 <= ad_idx < len(self._pages) else None
        msg = "Skipped ad — push Ad← to see/read it!"
        if folio:
            msg = f"Skipped ad p.{folio} — push Ad← to see/read it!"
        self._status(msg)
        prev = self._preview
        if prev is not None and hasattr(prev, "flash_ad_skip_notice"):
            try:
                prev.flash_ad_skip_notice(msg)
            except Exception:  # noqa: BLE001
                pass

    def _try_ad_skip_from(self, left_page_idx: int) -> tuple[int, int] | None:
        """
        If advancing from ``left_page_idx`` should skip an ad, return
        ``(continue_page_idx, continue_line_idx)`` and record the ad.
        Caller must hold no lock (this method takes the lock).

        Consumes a run of *consecutive* ad-like pages in one call (not just a
        single page) so a multi-page ad block (e.g. two full-page ads back to
        back) is skipped in full instead of reading the second ad page aloud
        before it gets a chance to be noticed on the next transition.
        """
        if not self._skip_ad_pages:
            return None
        with self._lock:
            pages = list(self._pages)
            if left_page_idx < 0 or left_page_idx >= len(pages):
                return None
            source = folio_of(pages[left_page_idx])
            skip = find_ad_skip(pages, left_page_idx, source_folio=source)
            if skip is not None:
                ad_idx, cont_idx, cont_line = skip
            else:
                # Safety net: land page still looks like ad/form → jump + notify
                cur = self._page_idx
                if cur < 0 or cur >= len(pages) or cur + 1 >= len(pages):
                    return None
                land = pages[cur]
                on_ad = (
                    bool(getattr(land, "skip_as_ad", False))
                    or cur in self._ad_queue
                    or cur in self._skipped_ads
                    or looks_like_ad(land)
                    or looks_like_form_ad(land)
                )
                if not on_ad:
                    return None
                ad_idx, cont_idx, cont_line = cur, cur + 1, 0

            # Consume a run of further consecutive ad-like pages so the whole
            # block is skipped at once, not one page per call.
            skipped_run = [ad_idx]
            while cont_line == 0 and cont_idx < len(pages) and cont_idx != ad_idx:
                candidate = pages[cont_idx]
                still_ad = (
                    bool(getattr(candidate, "skip_as_ad", False))
                    or looks_like_ad(candidate)
                    or looks_like_form_ad(candidate)
                )
                if not still_ad:
                    break
                skipped_run.append(cont_idx)
                cont_idx += 1

            self._page_idx = cont_idx
            self._line_idx = max(0, cont_line)
            self._sent_idx = 0
        for idx in skipped_run:
            self._enqueue_ad(idx)
        self._notify_ad_skipped(skipped_run[-1], cont_idx)
        return (cont_idx, cont_line)

    def _seek_interrupt(self) -> None:
        """Interrupt current utterance so the loop picks up the new index."""
        self._interrupt.set()
        try:
            self._speaker.stop()
        except Exception:  # noqa: BLE001
            pass
        # If paused, stay paused but show new region; if playing, continue.
        with self._lock:
            paused = self._paused
        if not paused:
            self._interrupt.clear()
            self._wake.set()

    # --- run loop (worker / CLI thread) ---

    def run(self) -> None:
        """
        Speak from current position until end or stop().
        Blocks. Honors pause / seek / page controls.
        """
        if not self._pages:
            return
        self._running = True
        with self._lock:
            self._stopped = False
            self._paused = False
            self._page_idx = max(0, min(self._page_idx, len(self._pages) - 1))
            self._line_idx = max(0, self._line_idx)
            self._clamp_sent_idx()
        self._interrupt.clear()
        self._wake.set()
        self._status("Playing")
        self._refresh_preview(update_region=True)

        try:
            while True:
                with self._lock:
                    if self._stopped:
                        break
                    p_idx = self._page_idx
                    l_idx = self._line_idx
                    paused = self._paused

                with self._lock:
                    n_pages = len(self._pages)
                    expect_more = self._expect_more_pages
                if p_idx >= n_pages:
                    if expect_more:
                        # Wait for append_page / set_expect_more_pages(False)
                        self._wake.clear()
                        self._wake.wait(timeout=0.25)
                        self._wake.set()
                        continue
                    break

                # Wait while paused
                if paused:
                    self._wake.wait(timeout=0.2)
                    continue

                page = self._pages[p_idx]
                # Track standalone ads (not interrupting any article, so they
                # are read normally per policy) so they still show up for
                # navigation via ad_queue()/jump_ad(), without marking them
                # as "skipped" (is_viewing_ad() must stay False for these).
                if l_idx == 0 and p_idx not in self._ad_queue:
                    self._note_possible_standalone_ad(page, p_idx)
                lines = page.speakable
                if not lines:
                    # skip empty page
                    left_page: int | None = None
                    with self._lock:
                        if self._page_idx == p_idx:
                            left_page = self._page_idx
                            self._page_idx += 1
                            self._line_idx = 0
                            self._sent_idx = 0
                    if left_page is not None:
                        self._flush_deferred_proof(left_page)
                    continue

                if l_idx >= len(lines):
                    left_page = None
                    with self._lock:
                        if self._page_idx == p_idx:
                            left_page = self._page_idx
                            self._page_idx += 1
                            self._line_idx = 0
                            self._sent_idx = 0
                    if left_page is not None:
                        self._flush_deferred_proof(left_page)
                    continue

                line = lines[l_idx]
                # Paragraph/chunk highlight (bbox); caption advances per sentence below.
                self._refresh_preview(update_region=True, page=page, line=line, l_idx=l_idx)
                if self._on_line:
                    try:
                        self._on_line(p_idx, l_idx, line)
                    except Exception:  # noqa: BLE001
                        pass

                self._interrupt.clear()
                # One Speak() per sentence; caption lockstep with _sent_idx.
                completed = False
                try:
                    completed = self._speak_chunk_with_caption(line.text)
                except Exception as exc:  # noqa: BLE001
                    print(f"Warning: speak failed: {exc}")

                # If interrupted for pause: stay on same line / sentence
                left_page = None
                should_break = False
                with self._lock:
                    if self._stopped:
                        break
                    if self._paused:
                        continue
                    # Seek / mid-chunk break: indices already updated; don't advance
                    if (
                        not completed
                        or self._page_idx != p_idx
                        or self._line_idx != l_idx
                    ):
                        continue
                    # Advance to next chunk / page; sentence index resets
                    self._line_idx += 1
                    self._sent_idx = 0
                    if self._line_idx >= len(lines):
                        left_page = self._page_idx
                        # Tentative next page; may be overridden by ad skip below
                        self._page_idx += 1
                        self._line_idx = 0
                        self._sent_idx = 0
                    if self._page_idx >= len(self._pages) and not self._expect_more_pages:
                        should_break = True
                if left_page is not None:
                    self._flush_deferred_proof(left_page)
                    self._maybe_clear_ad_skip_notice()
                    # Auto-skip ad insert between article pages when safe
                    skipped = self._try_ad_skip_from(left_page)
                    if skipped is not None:
                        should_break = False
                        with self._lock:
                            if (
                                self._page_idx >= len(self._pages)
                                and not self._expect_more_pages
                            ):
                                should_break = True
                if should_break:
                    break

                # No artificial pause between chunks (SAPI already paces speech)
        finally:
            self._running = False
            with self._lock:
                done = not self._stopped
            self._status("Done" if done else "Stopped")

    def _speak_chunk_with_caption(self, text: str) -> bool:
        """Speak remaining sentences one Speak() each; caption lockstep with ``_sent_idx``.

        Before each ``speak(sentence)``: set ``_sent_idx`` and update the top caption.
        No wall-clock caption timer. On pause/interrupt, leaves ``_sent_idx`` on the
        sentence that was speaking. Returns True if all remaining sentences finished
        without pause/seek/stop; False if the mid-chunk loop breaks early (run() continues).
        """
        full = expand_form_blanks((text or "").strip())
        if not full:
            return True
        sentences = _split_into_sentences(full) or [full]
        with self._lock:
            start = max(0, min(self._sent_idx, len(sentences) - 1))
            self._sent_idx = start
            p0, l0 = self._page_idx, self._line_idx

        def set_caption(msg: str) -> None:
            prev = self._preview
            if prev is not None and hasattr(prev, "set_caption"):
                try:
                    prev.set_caption(msg)
                except Exception:  # noqa: BLE001
                    pass

        for i in range(start, len(sentences)):
            with self._lock:
                if self._stopped or self._paused:
                    return False
                if self._page_idx != p0 or self._line_idx != l0:
                    return False
                # Seek moved sentence cursor mid-chunk — do not clobber.
                expected_prev = start if i == start else (i - 1)
                if self._sent_idx != expected_prev and self._sent_idx != i:
                    return False
                self._sent_idx = i
            set_caption(sentences[i])
            self._speaker.speak(sentences[i])
            with self._lock:
                if self._stopped or self._paused:
                    return False
                if self._page_idx != p0 or self._line_idx != l0:
                    return False
                if self._sent_idx != i:
                    # Seek during this sentence; leave their _sent_idx alone.
                    return False
        return True

    def _status(self, msg: str) -> None:
        if self._on_status:
            try:
                self._on_status(msg)
            except Exception:  # noqa: BLE001
                pass
        prev = self._preview
        if prev is not None and hasattr(prev, "set_status"):
            try:
                prev.set_status(msg)
            except Exception:  # noqa: BLE001
                pass

    def _refresh_preview(
        self,
        *,
        update_region: bool = False,
        page: PageUnit | None = None,
        line: OcrLine | None = None,
        l_idx: int | None = None,
    ) -> None:
        with self._lock:
            p_idx = self._page_idx
            li = self._line_idx if l_idx is None else l_idx
        if page is None:
            if not self._pages or p_idx >= len(self._pages):
                return
            page = self._pages[p_idx]
        lines = page.speakable
        if line is None and lines and 0 <= li < len(lines):
            line = lines[li]

        # Cont→ cue tracking works even without a preview window.
        self._update_active_continue(page, line, p_idx=p_idx, l_idx=li)

        prev = self._preview
        if prev is None:
            return

        try:
            if hasattr(prev, "set_position"):
                prev.set_position(self.position_label())
            # Caption = current sentence within the speakable chunk.
            if line is not None and hasattr(prev, "set_caption"):
                prev.set_caption(self._current_sentence_text(line) or line.text)
            elif hasattr(prev, "set_caption"):
                prev.set_caption(page.label)
            if line is not None and update_region and hasattr(prev, "show_region"):
                prev.show_region(page.image, line.bbox)
            elif update_region and hasattr(prev, "show_page"):
                prev.show_page(page.image)
        except Exception:  # noqa: BLE001
            pass