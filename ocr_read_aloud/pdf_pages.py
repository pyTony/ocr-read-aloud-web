"""Render PDF pages to images with PyMuPDF; optional embedded text-layer lines."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Iterator

from PIL import Image

if TYPE_CHECKING:
    from ocr_read_aloud.ocr import OcrLine

# Default render DPI for scanned-page OCR quality
DEFAULT_DPI = 250


def _open_fitz():
    try:
        import pymupdf as fitz
    except ImportError as exc:
        raise ImportError(
            "PyMuPDF (pymupdf) is required for PDF support. "
            "Install with: pip install pymupdf"
        ) from exc
    return fitz


def render_pdf_pages(
    pdf_path: Path | str,
    *,
    dpi: int = DEFAULT_DPI,
    start_page: int = 1,
    end_page: int | None = None,
) -> Iterator[tuple[int, Image.Image]]:
    """
    Yield (1-based page_number, PIL Image) for each page in range.

    Pages are rendered as RGB pixmaps at the given DPI.
    """
    fitz = _open_fitz()
    path = Path(pdf_path)
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")

    doc = fitz.open(path)
    try:
        total = doc.page_count
        if total < 1:
            raise ValueError(f"PDF has no pages: {path}")

        first = max(1, start_page)
        last = total if end_page is None else min(end_page, total)
        if first > last:
            raise ValueError(
                f"Invalid page range: start={first}, end={last}, total={total}"
            )

        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        for page_index in range(first - 1, last):
            page = doc.load_page(page_index)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            mode = "RGB" if pix.n >= 3 else "L"
            img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
            if mode == "L":
                img = img.convert("RGB")
            yield page_index + 1, img
    finally:
        doc.close()


def lines_from_pdf_page(page, *, dpi: int = DEFAULT_DPI) -> list[OcrLine]:
    """
    Extract speak units from an open PyMuPDF page via get_text("dict").

    Each PDF text *block* becomes one OcrLine (joined lines + union bbox).
    That keeps paragraphs intact for TTS instead of scattering short lines.
    Blocks are then ordered with column-aware reading order (2- and 3-col).

    Coordinates are scaled from PDF points (72 dpi) to the given render DPI.
    Returns [] when the page has no extractable text layer.
    """
    from ocr_read_aloud.ocr import OcrLine, sort_lines_reading_order

    scale = dpi / 72.0
    try:
        try:
            data = page.get_text("dict", sort=True)
        except TypeError:
            data = page.get_text("dict")
    except Exception:  # noqa: BLE001
        return []

    paragraphs: list[OcrLine] = []
    for block in data.get("blocks") or []:
        if block.get("type", 0) != 0:
            continue
        line_texts: list[str] = []
        x0 = y0 = x1 = y1 = None
        for line in block.get("lines") or []:
            spans = line.get("spans") or []
            parts: list[str] = []
            for s in spans:
                frag = s.get("text") or ""
                if not frag:
                    continue
                if (
                    parts
                    and parts[-1]
                    and not parts[-1].endswith((" ", "-", "/"))
                    and not frag.startswith((" ", ",", ".", ";", ":", "!", "?", "'"))
                    and parts[-1][-1].isalnum()
                    and frag[0].isalnum()
                ):
                    parts.append(" ")
                parts.append(frag)
            text = "".join(parts).strip()
            if not text:
                continue
            line_texts.append(text)
            bbox = line.get("bbox")
            if not bbox or len(bbox) < 4:
                continue
            lx0, ly0, lx1, ly1 = bbox[:4]
            x0 = lx0 if x0 is None else min(x0, lx0)
            y0 = ly0 if y0 is None else min(y0, ly0)
            x1 = lx1 if x1 is None else max(x1, lx1)
            y1 = ly1 if y1 is None else max(y1, ly1)
        if not line_texts:
            continue
        # Prefer block bbox when present
        bb = block.get("bbox")
        if bb and len(bb) >= 4:
            x0, y0, x1, y1 = bb[:4]
        if x0 is None:
            continue
        from ocr_read_aloud.text_clean import join_lines_dehyphenate

        joined = join_lines_dehyphenate(line_texts)
        # Soft paragraph breaks: keep sentence flow as one speak unit
        left = int(round(x0 * scale))
        top = int(round(y0 * scale))
        width = max(1, int(round((x1 - x0) * scale)))
        height = max(1, int(round((y1 - y0) * scale)))
        paragraphs.append(
            OcrLine(text=joined, left=left, top=top, width=width, height=height)
        )

    if not paragraphs:
        return []
    return sort_lines_reading_order(paragraphs)


def extract_pdf_page_lines(
    pdf_path: Path | str,
    page_no: int,
    *,
    dpi: int = DEFAULT_DPI,
) -> list[OcrLine]:
    """
    Extract text-layer lines for a single 1-based page, scaled to render DPI.
    Returns [] if the page has no usable text layer.
    """
    fitz = _open_fitz()
    path = Path(pdf_path)
    doc = fitz.open(path)
    try:
        if page_no < 1 or page_no > doc.page_count:
            return []
        page = doc.load_page(page_no - 1)
        return lines_from_pdf_page(page, dpi=dpi)
    finally:
        doc.close()


def iter_pdf_pages_with_lines(
    pdf_path: Path | str,
    *,
    dpi: int = DEFAULT_DPI,
    start_page: int = 1,
    end_page: int | None = None,
) -> Iterator[tuple[int, Image.Image, list[OcrLine]]]:
    """
    Yield (page_no, image, text_layer_lines) opening the PDF once.

    text_layer_lines may be empty for scanned pages (caller should OCR).
    """
    fitz = _open_fitz()
    path = Path(pdf_path)
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")

    doc = fitz.open(path)
    try:
        total = doc.page_count
        if total < 1:
            raise ValueError(f"PDF has no pages: {path}")

        first = max(1, start_page)
        last = total if end_page is None else min(end_page, total)
        if first > last:
            raise ValueError(
                f"Invalid page range: start={first}, end={last}, total={total}"
            )

        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        for page_index in range(first - 1, last):
            page = doc.load_page(page_index)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            mode = "RGB" if pix.n >= 3 else "L"
            img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
            if mode == "L":
                img = img.convert("RGB")
            lines = lines_from_pdf_page(page, dpi=dpi)
            yield page_index + 1, img, lines
    finally:
        doc.close()


def pdf_page_count(pdf_path: Path | str) -> int:
    """Return the number of pages in a PDF."""
    fitz = _open_fitz()
    path = Path(pdf_path)
    doc = fitz.open(path)
    try:
        return doc.page_count
    finally:
        doc.close()
