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

# Confirmed (agreement-verified) offset for this process. Only set once at
# least two pages independently agree on the same offset — a single page's
# OCR'd folio (especially from the noisy bottom-crop Tesseract fallback) is
# not trusted alone, since one misread would otherwise lock in a wrong global
# offset for the rest of the session (both the pre-scan call with one page,
# and every later call from the loader, share this cache).
_FOLIO_OFFSET_CACHE: int | None = None


def _folio_candidates_for_page(page) -> tuple[int, int] | None:
    """Return ``(pdf_idx, printed_folio)`` for one page, or None if no folio found."""
    label = getattr(page, "label", "")
    match = re.search(r"(\d+)", label)
    if not match:
        return None
    pdf_idx = int(match.group(1))

    candidate_folios: list[int] = []

    # 1. Try main OCR lines (sometimes it's there)
    lines = getattr(page, "lines", []) or []
    for line in lines:
        text = (getattr(line, "text", "") or "").strip()
        if re.fullmatch(r"\d{1,3}", text):
            candidate_folios.append(int(text))

    # 2. If not found, crop bottom 10% and OCR it
    if not candidate_folios and TESSERACT_AVAILABLE:
        image = getattr(page, "image", None)
        if image is not None:
            width, height = image.size
            try:
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
    """True once ``compute_folio_offset`` has locked in an agreement-verified offset."""
    return _FOLIO_OFFSET_CACHE is not None


def compute_folio_offset(pages) -> int:
    """
    Detect the printed-vs-PDF page offset (printed = pdf_index - offset).

    Scans every page passed in (not just the first hit) and only commits to
    an offset — caching it in ``_FOLIO_OFFSET_CACHE`` for reuse — once at
    least two pages independently agree on the same value. With only a
    single page available (e.g. the one-page pre-scan before the real loader
    starts), a tentative offset from that page alone is returned but *not*
    cached, so a later call with more pages can still confirm or correct it.
    """
    global _FOLIO_OFFSET_CACHE
    if _FOLIO_OFFSET_CACHE is not None:
        return _FOLIO_OFFSET_CACHE

    from collections import Counter

    tally: Counter[int] = Counter()
    evidence: dict[int, tuple[int, int]] = {}
    for page in pages:
        found = _folio_candidates_for_page(page)
        if found is None:
            continue
        pdf_idx, folio = found
        offset = pdf_idx - folio
        if -10 <= offset <= 10:
            tally[offset] += 1
            evidence.setdefault(offset, (pdf_idx, folio))

    if not tally:
        return 0

    best_offset, count = tally.most_common(1)[0]
    if count >= 2:
        _FOLIO_OFFSET_CACHE = best_offset
        pdf_idx, folio = evidence[best_offset]
        print(
            f"Offset confirmed by {count} pages (e.g. PDF page {pdf_idx}, "
            f"printed {folio}): {best_offset}",
            flush=True,
        )
        return best_offset

    # Only one page had a readable folio at all — return it as a tentative
    # value without caching, so it can still be reconsidered/confirmed once
    # more pages are available.
    pdf_idx, folio = evidence[best_offset]
    print(
        f"Offset tentatively {best_offset} from a single page so far "
        f"(PDF page {pdf_idx}, printed {folio}) — not yet cached, will "
        "re-check as more pages load.",
        flush=True,
    )
    return best_offset

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

    # Single blob (no newlines): check short head/tail windows
    compact = re.sub(r"\s+", " ", text).strip()
    for window in (compact[:40], compact[-40:]):
        m = _FOLIO_LINE.match(window.strip())
        if m and int(m.group(1)) == folio:
            return True
    return False


def _looks_like_target_folio(page: Any, target_folio: int, *, offset: int = 0) -> bool:
    """
    True if ``page``'s PDF label or clear near-edge printed folio matches
    ``target_folio``. When ``offset`` (printed = PDF index - offset) is known,
    also matches when the page's PDF label equals ``target_folio + offset``,
    so callers can pass a printed/real page number even for pages whose own
    OCR'd folio wasn't found near the edges.
    """
    label_n = pdf_page_number_from_label(getattr(page, "label", "") or "")
    if label_n == target_folio:
        return True
    if offset and label_n == target_folio + offset:
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
    offset=None
) -> tuple[int, int] | None:
    """
    Find the page and line index for a "continued on page N" jump.
    Handles PDF page-number offset automatically.
    """
    
    if not pages:
        return None

    # Compute offset between PDF index and printed folio
    if offset is None:
        offset = compute_folio_offset(pages)
    # rest of the function ... use the `offset` variable

    # Priority 1: exact match (label == target)
    for i, page in enumerate(pages):
        label_n = pdf_page_number_from_label(getattr(page, "label", "") or "")
        if label_n == target_folio:
            return (i, continued_from_line_index(page, source_folio))

    # Priority 2: try target + offset (common due to cover/front matter)
    candidate = target_folio + offset
    if candidate != target_folio:
        for i, page in enumerate(pages):
            label_n = pdf_page_number_from_label(getattr(page, "label", "") or "")
            if label_n == candidate:
                print(f"Adjusted continue target from {target_folio} to {candidate} (offset {offset})")
                return (i, continued_from_line_index(page, source_folio))

    # Priority 3: continued-from pages that also look like target folio (original logic)
    from_idxs = []
    for i, page in enumerate(pages):
        if parse_continued_from(_page_raw_text(page)):
            from_idxs.append(i)

    preferred = [i for i in from_idxs if _looks_like_target_folio(pages[i], target_folio, offset=offset)]
    if preferred:
        i = preferred[0]
        return (i, continued_from_line_index(pages[i], source_folio))

    # Priority 4: any continued-from (fallback)
    if from_idxs:
        i = from_idxs[0]
        return (i, continued_from_line_index(pages[i], source_folio))

    # Priority 5: clear folio near edges
    for i, page in enumerate(pages):
        if _folio_near_edges(_page_raw_text(page), target_folio):
            return (i, continued_from_line_index(page, source_folio))

    return None