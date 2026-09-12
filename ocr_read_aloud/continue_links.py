"""Parse magazine “continued on/from page N” cues and find landing pages."""

from __future__ import annotations

import re
import pytesseract
from typing import Any, Sequence

# continued on page 108 / continued on p. 108 / cont. on page 108 / continued on 108
_CONTINUED_ON = re.compile(
    r"(?:continued|cont(?:'?d|d)?\.?)\s+on\s+(?:(?:page|p\.?|pg\.?)\s*)?(\d{1,4})",
    re.IGNORECASE,
)

# continued from page 14 / continued from p. 14 / cont. from page 14
_CONTINUED_FROM = re.compile(
    r"(?:continued|cont(?:'?d|d)?\.?)\s+from\s+(?:(?:page|p\.?|pg\.?)\s*)?(\d{1,4})",
    re.IGNORECASE,
)

_PAGE_LABEL = re.compile(r"^\s*page\s+(\d+)\b", re.IGNORECASE)

# Clear printed folio: mostly just the number, or "— 108 —" / "- 108 -"
_FOLIO_LINE = re.compile(
    r"^\s*(?:[—\-–~•·*]+\s*)?(\d{1,4})(?:\s*[—\-–~•·*]+)?\s*$",
)
try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    print("WARNING: pytesseract not installed. Offset auto-detection will fail.", flush=True)

# Confirmed offset for this process, once a page with a readable printed
# folio has been found. Reset per-document via reset_folio_offset_cache().
_FOLIO_OFFSET_CACHE: int | None = None

def reset_folio_offset_cache() -> None:
    """Reset the module-level offset cache between runs or tests."""
    global _FOLIO_OFFSET_CACHE
    _FOLIO_OFFSET_CACHE = None

def _folio_candidates_for_page(page) -> tuple[int, int] | None:
    """Return ``(pdf_idx, printed_folio)`` for one page, or None if no folio found."""
    label = getattr(page, "label", "")
    match = re.search(r"(\d+)", label)
    if not match:
        return None
    pdf_idx = int(match.group(1))

    candidate_folios: list[int] = []

    # 1. Try main OCR lines
    lines = getattr(page, "lines", []) or []
    for line in lines:
        text = (getattr(line, "text", "") or "").strip()
        m = _FOLIO_LINE.match(text)
        if m:
            candidate_folios.append(int(m.group(1)))

    # 2. If not found, crop bottom 10% and OCR it
    if not candidate_folios and TESSERACT_AVAILABLE:
        image = getattr(page, "image", None)
        if image is not None:
            width, height = image.size
            try:
                from ocr_read_aloud.ocr import configure_tesseract
                configure_tesseract()

                bottom_crop = image.crop((0, int(height * 0.90), width, height))
                footer_text = pytesseract.image_to_string(bottom_crop, config="--psm 6").strip()
                nums = re.findall(r"\b\d{1,3}\b", footer_text)
                if nums:
                    candidate_folios.append(int(nums[-1]))
            except Exception as exc:
                print(f"  (Bottom OCR error: {exc})", flush=True)

    if not candidate_folios:
        return None
    return pdf_idx, candidate_folios[-1]


def is_folio_offset_confirmed() -> bool:
    """True once ``compute_folio_offset`` has found and cached an offset."""
    return _FOLIO_OFFSET_CACHE is not None


def compute_folio_offset(pages) -> int:
    """
    Detect the printed-vs-PDF page offset (printed = pdf_index - offset).

    Scans ``pages`` in order and commits to the offset from the FIRST page
    with a readable printed folio — no multi-page agreement is required.
    Front-matter pages (cover, inside-cover ads, TOC) are expected to have
    no readable folio and are simply skipped over; feed pages in
    front-to-back order (see the pre-scan sweep in cli.py) so "first found"
    means the first genuinely-numbered page, not an arbitrary later one.
    """
    global _FOLIO_OFFSET_CACHE
    if _FOLIO_OFFSET_CACHE is not None:
        return _FOLIO_OFFSET_CACHE

    for page in pages:
        found = _folio_candidates_for_page(page)
        if found is None:
            continue
        pdf_idx, folio = found
        offset = pdf_idx - folio
        if -10 <= offset <= 10:
            _FOLIO_OFFSET_CACHE = offset
            print(
                f"Offset found on PDF page {pdf_idx} (printed {folio}): {offset}",
                flush=True,
            )
            return offset
    return 0


def parse_continued_on(text: str) -> list[int]:
    """Return target page numbers mentioned by “continued on …” cues."""
    if not text:
        return []
    seen: set[int] = set()
    out: list[int] = []
    for m in _CONTINUED_ON.finditer(text):
        n = int(m.group(1))
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def parse_continued_from(text: str) -> list[int]:
    """Return source page numbers mentioned by “continued from …” cues."""
    if not text:
        return []
    seen: set[int] = set()
    out: list[int] = []
    for m in _CONTINUED_FROM.finditer(text):
        n = int(m.group(1))
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def pdf_page_number_from_label(label: str) -> int | None:
    """Parse PDF index from a label like ``Page 14`` → 14."""
    if not label:
        return None
    m = _PAGE_LABEL.match(label.strip())
    if m:
        return int(m.group(1))
    return None


def _page_raw_text(page: Any) -> str:
    """Best-effort full text from a PageUnit-like object."""
    try:
        t = getattr(page, "text", None)
        if callable(t):
            t = t()
        if isinstance(t, str) and t.strip():
            return t
    except Exception:  # noqa: BLE001
        pass
    parts: list[str] = []
    for attr in ("speakable", "lines"):
        seq = getattr(page, attr, None)
        if not seq:
            continue
        try:
            for ln in seq:
                s = getattr(ln, "text", None)
                if s and str(s).strip():
                    parts.append(str(s).strip())
        except Exception:  # noqa: BLE001
            continue
        if parts:
            break
    return "\n".join(parts)


def _speakable_texts(page: Any) -> list[str]:
    """Line/chunk texts in speaking order (speakable preferred, else lines)."""
    for attr in ("speakable", "lines"):
        seq = getattr(page, attr, None)
        if not seq:
            continue
        try:
            out = []
            for ln in seq:
                s = getattr(ln, "text", None)
                out.append(str(s) if s is not None else "")
            if any(x.strip() for x in out):
                return out
        except Exception:  # noqa: BLE001
            continue
    raw = _page_raw_text(page)
    return [raw] if raw else []


def _folio_near_edges(text: str, folio: int) -> bool:
    """True if ``folio`` appears as a clear standalone page number near edges."""
    if not text:
        return False
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        edge = []
        for ln in lines[:3] + lines[-3:]:
            if ln not in edge:
                edge.append(ln)
        for ln in edge:
            m = _FOLIO_LINE.match(ln)
            if m and int(m.group(1)) == folio:
                return True
        return False

    compact = re.sub(r"\s+", " ", text).strip()
    for window in (compact[:40], compact[-40:]):
        m = _FOLIO_LINE.match(window.strip())
        if m and int(m.group(1)) == folio:
            return True
    return False


def _looks_like_target_folio(page: Any, target_folio: int, *, offset: int = 0) -> bool:
    """
    True if ``page``'s PDF label matches target_folio + offset, or OCR text has the folio.
    """
    label_n = pdf_page_number_from_label(getattr(page, "label", "") or "")
    if offset:
        if label_n == target_folio + offset:
            return True
    else:
        if label_n == target_folio:
            return True
    return _folio_near_edges(_page_raw_text(page), target_folio)


def continued_from_line_index(page: Any, source_folio: int | None = None) -> int:
    """Index of first speakable/line containing “continued from” (else 0)."""
    texts = _speakable_texts(page)
    if source_folio is not None:
        for i, t in enumerate(texts):
            if source_folio in parse_continued_from(t):
                return i
    for i, t in enumerate(texts):
        if parse_continued_from(t):
            return i
    return 0


def find_continue_landing(
    pages: Sequence[Any],
    *,
    target_folio: int,
    source_folio: int | None,
    offset: int | None = None,
) -> tuple[int, int] | None:
    """
    Find the page and line index for a "continued on page N" jump.
    Returns None if the target page has not been loaded yet.
    """
    if not pages:
        return None

    if offset is None:
        offset = compute_folio_offset(pages)

    target_pdf = target_folio + (offset or 0)
    print(f"  [continue] Looking for printed page {target_folio} (target PDF page {target_pdf}, offset {offset})", flush=True)

    # Priority 1: Match target_pdf page
    for i, page in enumerate(pages):
        label_n = pdf_page_number_from_label(getattr(page, "label", "") or "")
        if label_n == target_pdf:
            print(f"  [continue] Found PDF page {label_n} (printed {target_folio})", flush=True)
            return (i, continued_from_line_index(page, source_folio))

    # Priority 2: Pages with continued-from cues that also match target folio
    for i, page in enumerate(pages):
        if parse_continued_from(_page_raw_text(page)):
            if _looks_like_target_folio(page, target_folio, offset=offset or 0):
                print(f"  [continue] Found matching continued-from cue on page index {i}", flush=True)
                return (i, continued_from_line_index(page, source_folio))

    # Priority 3: Clear printed folio near edges in OCR text
    for i, page in enumerate(pages):
        if _folio_near_edges(_page_raw_text(page), target_folio):
            print(f"  [continue] Found printed folio in OCR on page index {i}", flush=True)
            return (i, continued_from_line_index(page, source_folio))

    # Target not loaded yet (do NOT blindly fallback to an unrelated page)
    print(f"  [continue] Target page {target_folio} not loaded yet", flush=True)
    return None