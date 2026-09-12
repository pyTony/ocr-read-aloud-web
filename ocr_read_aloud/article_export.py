"""Infer articles and export selected OCR pages as text or searchable PDF."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Sequence

from ocr_read_aloud.ad_pages import folio_of, looks_like_ad, page_plain_text
from ocr_read_aloud.continue_links import (
    parse_continued_from,
    parse_continued_on,
    pdf_page_number_from_label,
)

# YYYY-MM or YYYY_MM in path components (magazine issues).
_ISSUE_DATE = re.compile(
    r"(?i)(?:^|[_\-\s])((?:19|20)\d{2})[_\-](0?[1-9]|1[0-2])(?:$|[_\-\s])"
)
_BAD_FS = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_MULTI_SPACE = re.compile(r"\s+")
_CONT_NOISE = re.compile(
    r"(?i)^\s*(?:continued\s+(?:on|from)|cont\.?\s+(?:on|from))"
)


def magazine_issue_ym(source: Path | str | None) -> str | None:
    """Return ``YYYY-MM`` if the source path looks like a magazine issue."""
    if source is None:
        return None
    p = Path(source)
    # Search filename + parent folder names
    parts = [p.stem] + [x for x in p.parts[-4:]]
    blob = " ".join(parts)
    m = _ISSUE_DATE.search(blob.replace(" ", "_"))
    if not m:
        m = _ISSUE_DATE.search(blob)
    if not m:
        return None
    year, month = m.group(1), int(m.group(2))
    return f"{year}-{month:02d}"


def sanitize_filename_stem(title: str, *, max_len: int = 80) -> str:
    """Filesystem-safe stem: strip path chars, collapse spaces, truncate."""
    s = (title or "").strip()
    s = _BAD_FS.sub("", s)
    s = s.replace("\n", " ").replace("\r", " ")
    s = _MULTI_SPACE.sub(" ", s).strip(" .")
    if not s:
        return "untitled"
    if len(s) > max_len:
        s = s[: max_len - 1].rstrip(" .") + "…"
    return s


def infer_page_title(page: Any, *, fallback: str = "untitled") -> str:
    """
    Infer a title from the first heading-like / substantial line on a page.

    Prefers shorter ALL-CAPS or Title Case lines near the top; skips
    continued-on/from noise and bare folios.
    """
    texts: list[str] = []
    # Prefer raw OCR lines (pre-merge) for headings
    seq = getattr(page, "lines", None) or getattr(page, "speakable", None) or []
    try:
        for ln in seq:
            t = getattr(ln, "text", None)
            if t and str(t).strip():
                texts.append(str(t).strip())
    except Exception:  # noqa: BLE001
        texts = []
    if not texts:
        blob = page_plain_text(page)
        texts = [ln.strip() for ln in blob.splitlines() if ln.strip()]

    candidates: list[tuple[float, str]] = []
    for i, line in enumerate(texts[:12]):
        if _CONT_NOISE.search(line):
            continue
        if re.fullmatch(r"\d{1,4}", line):
            continue
        if len(line) < 3:
            continue
        # Score: prefer earlier, moderate length, heading-ish
        score = 10.0 - i * 0.5
        if 8 <= len(line) <= 60:
            score += 3.0
        elif len(line) > 80:
            score -= 2.0
        letters = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]", line)
        if letters and sum(1 for c in letters if c.isupper()) / max(1, len(letters)) > 0.7:
            score += 2.0  # ALL-CAPS heading
        if line[:1].isupper() and " " in line and not line.endswith("."):
            score += 1.5
        candidates.append((score, line))

    if not candidates:
        return fallback
    candidates.sort(key=lambda x: -x[0])
    return candidates[0][1]


def article_page_indices(
    pages: Sequence[Any],
    start_idx: int,
    *,
    skipped_ads: Sequence[int] | None = None,
) -> list[int]:
    """
    Walk the story chain from ``start_idx`` via continued-on/from and
    contiguous non-ad neighbors (skipping known ad inserts).
    """
    if not pages or start_idx < 0 or start_idx >= len(pages):
        return []
    skipped = set(skipped_ads or [])
    n = len(pages)

    # Expand backward: pages that continue-into current, or contiguous non-ads
    visited: set[int] = set()
    seed = start_idx
    # If start is an ad, only that page
    if start_idx in skipped or looks_like_ad(pages[start_idx]):
        # Only treat as single-ad if it's a known skipped ad or clearly ad-like
        # without article continue cues
        text0 = page_plain_text(pages[start_idx])
        if start_idx in skipped or (
            looks_like_ad(pages[start_idx]) and not parse_continued_from(text0)
        ):
            return [start_idx]

    # BFS/walk chain
    chain = {seed}
    # Walk backward
    changed = True
    while changed:
        changed = False
        for i in list(chain):
            # previous contiguous non-ad
            j = i - 1
            while j >= 0 and j in skipped:
                j -= 1
            if j >= 0 and j not in chain and not looks_like_ad(pages[j]):
                # Link if continued-on from j targets i, or continued-from on i
                # mentions j's folio, or contiguous folios
                if _pages_linked(pages, j, i) or _contiguous_article(pages, j, i, skipped):
                    chain.add(j)
                    changed = True
            # also: any page whose continued-on lands on this folio
            fi = folio_of(pages[i])
            for j in range(n):
                if j in chain or j in skipped or looks_like_ad(pages[j]):
                    continue
                ons = parse_continued_on(page_plain_text(pages[j]))
                if fi is not None and fi in ons:
                    chain.add(j)
                    changed = True

    # Walk forward
    changed = True
    while changed:
        changed = False
        for i in list(chain):
            j = i + 1
            while j < n and j in skipped:
                j += 1
            if j < n and j not in chain and not looks_like_ad(pages[j]):
                if _pages_linked(pages, i, j) or _contiguous_article(pages, i, j, skipped):
                    chain.add(j)
                    changed = True
            # continued-on from i
            ons = parse_continued_on(page_plain_text(pages[i]))
            for j in range(n):
                if j in chain or j in skipped:
                    continue
                fj = folio_of(pages[j])
                if fj is not None and fj in ons and not looks_like_ad(pages[j]):
                    chain.add(j)
                    changed = True

    return sorted(chain)


def _pages_linked(pages: Sequence[Any], earlier: int, later: int) -> bool:
    a = pages[earlier]
    b = pages[later]
    fa, fb = folio_of(a), folio_of(b)
    ons = parse_continued_on(page_plain_text(a))
    frs = parse_continued_from(page_plain_text(b))
    if fb is not None and fb in ons:
        return True
    if fa is not None and fa in frs:
        return True
    if frs and ons:
        # weak: both have continue cues
        return True
    return False


def _contiguous_article(
    pages: Sequence[Any], a: int, b: int, skipped: set[int]
) -> bool:
    """True if a and b are adjacent in article order ignoring skipped ads."""
    if abs(a - b) == 1 and a not in skipped and b not in skipped:
        return not looks_like_ad(pages[a]) and not looks_like_ad(pages[b])
    lo, hi = min(a, b), max(a, b)
    if hi - lo == 2 and (lo + 1) in skipped:
        return not looks_like_ad(pages[lo]) and not looks_like_ad(pages[hi])
    fa, fb = folio_of(pages[a]), folio_of(pages[b])
    if fa is not None and fb is not None and abs(fa - fb) == 1:
        return True
    if fa is not None and fb is not None and abs(fa - fb) == 2:
        # gap of one folio — likely ad insert
        return True
    return False


def default_article_save_path(
    source: Path | str | None,
    pages: Sequence[Any],
    indices: Sequence[int],
    *,
    is_ad: bool = False,
) -> Path:
    """
    Build default save path next to source using inferred title + issue date.

    Examples: ``Speech Synthesis - 1976-08.txt``, ``Ad p.13 - 1976-08.txt``.
    """
    src = Path(source) if source is not None else Path("article")
    base_dir = src.parent if src.suffix else (src if src.is_dir() else src.parent)
    if not indices:
        stem = "untitled"
        folio = 0
        lead = None
    else:
        lead = pages[indices[0]]
        folio = folio_of(lead) or (indices[0] + 1)
        if is_ad:
            title = infer_page_title(lead, fallback=f"Ad p.{folio}")
            # If title is generic body, prefer Ad p.N
            if len(title) > 60 or title.lower().startswith("continued"):
                title = f"Ad p.{folio}"
            elif not title.lower().startswith("ad"):
                # keep inferred headline for ads when short
                pass
        else:
            title = infer_page_title(lead, fallback=f"Article p.{folio}")
        stem = sanitize_filename_stem(title)

    ym = magazine_issue_ym(src)
    if ym:
        filename = f"{stem} - {ym}.txt"
    else:
        filename = f"{stem}.txt"
    return base_dir / filename


def format_pages_dump(pages: Sequence[Any], indices: Sequence[int]) -> str:
    """Format selected pages like document_text / proof cache."""
    blocks: list[str] = []
    for i in indices:
        if i < 0 or i >= len(pages):
            continue
        page = pages[i]
        label = getattr(page, "label", f"Page {i + 1}")
        raw = "\n".join(
            getattr(ln, "text", "") for ln in getattr(page, "lines", []) if getattr(ln, "text", None)
        ).strip()
        if not raw:
            raw = page_plain_text(page).strip()
        if raw:
            blocks.append(f"=== {label} ===\n{raw}\n")
        else:
            blocks.append(f"=== {label} ===\n")
    return "\n".join(blocks).strip() + ("\n" if blocks else "")


def save_pages_pdf(
    path: Path | str,
    pages: Sequence[Any],
    indices: Sequence[int],
) -> Path:
    """Save page images with an invisible, searchable OCR text layer."""
    try:
        import pymupdf as fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required for PDF export") from exc

    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    try:
        for index in indices:
            if index < 0 or index >= len(pages):
                continue
            page = pages[index]
            image = getattr(page, "image", None)
            if image is None:
                continue
            width_px, height_px = image.size
            width_pt = 612.0
            height_pt = width_pt * height_px / max(1, width_px)
            pdf_page = doc.new_page(width=width_pt, height=height_pt)
            import io

            image_bytes = io.BytesIO()
            image.save(image_bytes, format="PNG")
            pdf_page.insert_image(pdf_page.rect, stream=image_bytes.getvalue())
            for line in getattr(page, "lines", []) or []:
                text = str(getattr(line, "text", "") or "").strip()
                if not text:
                    continue
                scale_x = width_pt / max(1, width_px)
                scale_y = height_pt / max(1, height_px)
                rect = fitz.Rect(
                    line.left * scale_x,
                    line.top * scale_y,
                    (line.left + line.width) * scale_x,
                    (line.top + line.height) * scale_y,
                )
                fontsize = max(4.0, rect.height * 0.8)
                pdf_page.insert_text(
                    (rect.x0, max(fontsize, rect.y1)),
                    text,
                    fontsize=fontsize,
                    fontname="helv",
                    render_mode=3,
                )
        if not doc.page_count:
            raise ValueError("Nothing to export")
        doc.save(out)
    finally:
        doc.close()
    return out
