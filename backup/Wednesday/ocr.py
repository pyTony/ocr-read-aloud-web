"""OCR via Tesseract (pytesseract). Fully local — no cloud APIs."""

from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

from PIL import Image

# Supported language CLI tokens -> Tesseract lang codes
LANG_MAP = {
    "fin": "fin",
    "eng": "eng",
    "fin+eng": "fin+eng",
    "eng+fin": "eng+fin",
}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp"}


class OcrError(RuntimeError):
    """Raised when OCR cannot run (missing Tesseract, bad image, etc.)."""


@dataclass(frozen=True)
class OcrLine:
    """One line of recognized text with bounding box in image pixel coords."""

    text: str
    left: int
    top: int
    width: int
    height: int

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        """(left, top, width, height) — same as fields."""
        return (self.left, self.top, self.width, self.height)

    @property
    def xyxy(self) -> tuple[int, int, int, int]:
        """(x0, y0, x1, y1) absolute corners."""
        return (self.left, self.top, self.left + self.width, self.top + self.height)



def _line_mid_x(ln: OcrLine) -> float:
    return ln.left + ln.width / 2.0


def lines_share_column(a: OcrLine, b: OcrLine) -> bool:
    """True if two lines look like the same text column (not across a gutter)."""
    a0, a1 = a.left, a.left + a.width
    b0, b1 = b.left, b.left + b.width
    overlap = min(a1, b1) - max(a0, b0)
    min_w = max(1.0, float(min(a.width, b.width)))
    max_w = max(1.0, float(max(a.width, b.width)))
    # Clear horizontal overlap → same column
    if overlap >= 0.15 * min_w:
        return True
    gap = max(0.0, max(a0, b0) - min(a1, b1))
    # Distinct gutters between magazine columns — never merge across
    if overlap <= 0 and gap > max(28.0, 0.08 * max_w):
        return False
    # Midpoints far apart relative to widths → different columns
    mid_a = (a0 + a1) / 2.0
    mid_b = (b0 + b1) / 2.0
    if abs(mid_a - mid_b) > 0.55 * max(min_w, max_w * 0.5) and overlap < 0.05 * min_w:
        return False
    return overlap > 0


def _cluster_columns_by_centers(
    values: list[float],
    *,
    min_gap: float,
    min_per_col: int = 3,
) -> list[tuple[float, float]]:
    """
    Split sorted 1D centers into columns at large gaps.
    Returns list of (x_min, x_max) ranges covering each column (inclusive pads).
    """
    if len(values) < min_per_col * 2:
        return []
    xs = sorted(values)
    span = xs[-1] - xs[0]
    if span < 120:
        return []

    # Gaps between consecutive centers
    gaps = [(xs[i + 1] - xs[i], i) for i in range(len(xs) - 1)]
    # Keep gaps that look like gutters
    gutters = [(g, i) for g, i in gaps if g >= min_gap]
    if not gutters:
        return []

    # Use all gutters above threshold, but merge tiny columns afterward
    cuts = sorted(i for g, i in gutters)
    # Build clusters as slices of xs between cuts
    bounds: list[tuple[int, int]] = []  # index ranges into xs
    start = 0
    for cut_i in cuts:
        bounds.append((start, cut_i + 1))  # xs[start:cut_i+1]
        start = cut_i + 1
    bounds.append((start, len(xs)))

    cols = []
    for a, b in bounds:
        cluster = xs[a:b]
        if len(cluster) < min_per_col:
            continue
        cols.append((cluster[0] - 1.0, cluster[-1] + 1.0))

    if len(cols) < 2:
        return []
    return cols


def _assign_columns(lines: list[OcrLine]) -> list[list[OcrLine]] | None:
    """
    Partition lines into 2+ columns when clear gutters exist.
    Returns None for single-column layouts.

    Works for dense OCR lines and sparser PDF text-layer paragraph blocks
    (Letters / multi-column magazine pages often have only a handful of blocks).
    """
    if len(lines) < 4:
        return None

    lefts = [ln.left for ln in lines]
    rights = [ln.left + ln.width for ln in lines]
    page_w = max(rights) - min(lefts)
    if page_w < 200:
        return None

    centers = [_line_mid_x(ln) for ln in lines]
    # For 3-col small print, gutters are narrower — scale with page and median line width
    widths = sorted(max(1, ln.width) for ln in lines)
    med_w = widths[len(widths) // 2]
    min_gap = max(28.0, min(0.12 * page_w, 0.55 * med_w))
    # PDF paragraph blocks: allow 2 lines/col; dense OCR keeps 3
    min_per = 2 if len(lines) < 12 else 3

    ranges = _cluster_columns_by_centers(
        centers, min_gap=min_gap, min_per_col=min_per
    )
    if len(ranges) < 2:
        return None

    cols: list[list[OcrLine]] = [[] for _ in ranges]
    for ln in lines:
        mid = _line_mid_x(ln)
        placed = False
        for i, (lo, hi) in enumerate(ranges):
            if lo <= mid <= hi:
                cols[i].append(ln)
                placed = True
                break
        if not placed:
            # Assign to nearest column
            dists = [abs(mid - (lo + hi) / 2.0) for lo, hi in ranges]
            cols[dists.index(min(dists))].append(ln)

    cols = [c for c in cols if len(c) >= min_per]
    if len(cols) < 2:
        return None
    return cols


def _looks_like_page_title(
    ln: OcrLine,
    *,
    page_top: int,
    med_h: float,
    page_w: float,
) -> bool:
    """
    True for decorative / lead titles that must speak before column body.

    Centered large titles often sit in the middle column-x and otherwise get
    sorted after the entire left column — move them to the front instead.
    """
    text = (ln.text or "").strip()
    if len(text) < 4:
        return False
    low = text.lower()
    if low.startswith(("continued ", "cont. ", "cont ", "advertisement")):
        return False
    words = text.split()
    if len(words) > 14:
        return False
    # Near the visual top of the page content
    near_top = ln.top <= page_top + max(100, int(med_h * 6))
    if not near_top:
        return False
    tall = ln.height >= max(14.0, med_h * 1.55)
    wide = ln.width >= 0.4 * page_w
    # Title-ish casing: leading capital, not a long sentence ending with .
    titleish = text[0].isupper() and not (text.endswith(".") and len(words) > 8)
    few = len(words) <= 12
    if tall and few:
        return True
    if wide and few and titleish:
        return True
    if tall and wide:
        return True
    return False


def promote_page_titles(lines: list[OcrLine]) -> list[OcrLine]:
    """Move top-of-page heading lines ahead of body / column text."""
    if len(lines) < 2:
        return list(lines)
    tops = [ln.top for ln in lines]
    heights = sorted(max(1, ln.height) for ln in lines)
    med_h = float(heights[len(heights) // 2])
    page_top = min(tops)
    lefts = [ln.left for ln in lines]
    rights = [ln.left + ln.width for ln in lines]
    page_w = float(max(rights) - min(lefts)) if rights and lefts else 1.0

    titles: list[OcrLine] = []
    body: list[OcrLine] = []
    for ln in lines:
        if _looks_like_page_title(
            ln, page_top=page_top, med_h=med_h, page_w=page_w
        ):
            titles.append(ln)
        else:
            body.append(ln)
    if not titles:
        return list(lines)
    titles.sort(key=lambda ln: (ln.top, ln.left))
    return titles + body


_RULE_CHARS = set("-_─━—–═−~")


def _line_mid_y(ln: OcrLine) -> float:
    return ln.top + ln.height / 2.0


def _is_horizontal_rule_line(ln: OcrLine, *, page_w: float) -> bool:
    """Near-full-width short line of dashes / box-drawing / underscores."""
    text = (ln.text or "").strip()
    if len(text) < 3:
        return False
    compact = "".join(c for c in text if not c.isspace())
    if len(compact) < 3:
        return False
    rule_frac = sum(1 for c in compact if c in _RULE_CHARS) / len(compact)
    if rule_frac < 0.85:
        return False
    return ln.width >= 0.55 * max(page_w, 1.0)


def _detect_horizontal_split_y(lines: list[OcrLine], *, med_h: float) -> float | None:
    """
    Y midpoint of one clear page-wide unused vertical gap, else None.

    Gap must be >= ~2.5× median line height with no line bboxes in that
    band (merged globally). Optional near-full-width rule line also counts.
    """
    if len(lines) < 4:
        return None
    lefts = [ln.left for ln in lines]
    rights = [ln.left + ln.width for ln in lines]
    page_w = float(max(rights) - min(lefts)) if rights and lefts else 1.0

    for ln in lines:
        if _is_horizontal_rule_line(ln, page_w=page_w):
            return _line_mid_y(ln)

    # A graphical divider is often absent from OCR. A gap around one normal
    # line height is enough when it separates two populated page bands.
    min_gap = max(40.0, float(med_h) * 1.0)
    intervals = sorted(
        (float(ln.top), float(ln.top + max(1, ln.height))) for ln in lines
    )
    merged: list[list[float]] = []
    for y0, y1 in intervals:
        if not merged or y0 > merged[-1][1]:
            merged.append([y0, y1])
        else:
            merged[-1][1] = max(merged[-1][1], y1)
    if len(merged) < 2:
        return None

    best_gap = 0.0
    best_mid: float | None = None
    for i in range(len(merged) - 1):
        gap = merged[i + 1][0] - merged[i][1]
        if gap < min_gap:
            continue
        if gap > best_gap:
            best_gap = gap
            best_mid = (merged[i][1] + merged[i + 1][0]) / 2.0
    if best_mid is None:
        return None

    above_n = sum(1 for ln in lines if _line_mid_y(ln) < best_mid)
    below_n = sum(1 for ln in lines if _line_mid_y(ln) >= best_mid)
    if above_n < 1 or below_n < 1:
        return None
    return best_mid


def _sort_lines_column_then_down(lines: list[OcrLine]) -> list[OcrLine]:
    """Title promote + column-then-down (one band / full page)."""
    if not lines:
        return []

    heights = [max(1, ln.height) for ln in lines]
    heights.sort()
    med_h = heights[len(heights) // 2]
    band = max(4, int(med_h * 0.6))

    def row_key(ln: OcrLine) -> tuple[int, int]:
        return (ln.top // band, ln.left)

    # Split titles out before column clustering so they are not trapped
    # in the "right" column after the left column body.
    promoted = promote_page_titles(list(lines))
    page_top = min(ln.top for ln in promoted)
    lefts = [ln.left for ln in promoted]
    rights = [ln.left + ln.width for ln in promoted]
    page_w = float(max(rights) - min(lefts)) if rights else 1.0
    n_title = 0
    for ln in promoted:
        if _looks_like_page_title(
            ln, page_top=page_top, med_h=float(med_h), page_w=page_w
        ):
            n_title += 1
        else:
            break
    titles = promoted[:n_title]
    body = promoted[n_title:]

    columns = _assign_columns(list(body)) if body else None
    if not columns:
        ordered_body = sorted(body, key=row_key)
    else:
        columns.sort(key=lambda col: sum(_line_mid_x(ln) for ln in col) / len(col))
        ordered_body = []
        for col in columns:
            ordered_body.extend(sorted(col, key=lambda ln: (ln.top, ln.left)))
    return titles + ordered_body


def sort_lines_reading_order(lines: list[OcrLine]) -> list[OcrLine]:
    """
    Sort lines for natural reading.

    Prefer strict **column-then-down**: cluster by mid-x gutters, then
    left-to-right columns, top-to-bottom within each column. Avoids
    interleaving right-column bottoms with center mid-page (Letters).

    When a clear **horizontal split** exists (page-wide unused vertical gap
    or a near-full-width rule line), sort the above band fully before the
    below band so magazine top+columns are not mixed with a bottom block.

    Single-column pages stay top-to-bottom (then left-to-right within a
    row band). Full-width / decorative titles near the top are promoted
    ahead of column body so they are not spoken after the left column.
    """
    if not lines:
        return []

    heights = [max(1, ln.height) for ln in lines]
    heights.sort()
    med_h = float(heights[len(heights) // 2])

    lefts = [ln.left for ln in lines]
    rights = [ln.left + ln.width for ln in lines]
    page_w = float(max(rights) - min(lefts)) if rights and lefts else 1.0

    split_y = _detect_horizontal_split_y(lines, med_h=med_h)
    if split_y is None:
        return _sort_lines_column_then_down(lines)

    above: list[OcrLine] = []
    below: list[OcrLine] = []
    for ln in lines:
        if _is_horizontal_rule_line(ln, page_w=page_w):
            # Divider: exclude from speak order
            continue
        if _line_mid_y(ln) < split_y:
            above.append(ln)
        else:
            below.append(ln)
    if not above or not below:
        return _sort_lines_column_then_down(lines)
    return _sort_lines_column_then_down(above) + _sort_lines_column_then_down(below)


def normalize_lang(lang: str) -> str:
    """Map CLI language string to a Tesseract --lang value."""
    key = lang.strip().lower().replace(" ", "")
    if key in LANG_MAP:
        return LANG_MAP[key]
    # Allow raw tesseract codes like "fin+eng"
    return key


def find_tesseract() -> str | None:
    """Locate the tesseract executable (PATH or common Windows install paths)."""
    found = shutil.which("tesseract")
    if found:
        return found

    if sys.platform == "win32":
        candidates = [
            Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
            Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
            Path.home() / r"AppData\Local\Programs\Tesseract-OCR\tesseract.exe",
        ]
        for c in candidates:
            if c.is_file():
                return str(c)
    return None


def configure_tesseract() -> str:
    """
    Ensure pytesseract can find the Tesseract binary.
    Returns the path used.
    """
    try:
        import pytesseract
    except ImportError as exc:
        raise OcrError(
            "pytesseract is not installed. Run: pip install pytesseract"
        ) from exc

    path = find_tesseract()
    if not path:
        raise OcrError(
            "Tesseract-OCR was not found.\n"
            "Install from https://github.com/UB-Mannheim/tesseract/wiki\n"
            "Include Finnish (fin) and English (eng) language packs, "
            "and add the install folder to PATH\n"
            "(or place tesseract.exe under 'C:\\Program Files\\Tesseract-OCR')."
        )

    pytesseract.pytesseract.tesseract_cmd = path
    return path


def list_tesseract_langs() -> list[str]:
    """Return language codes installed in Tesseract."""
    import pytesseract

    configure_tesseract()
    try:
        return sorted(pytesseract.get_languages(config=""))
    except Exception as exc:  # noqa: BLE001
        raise OcrError(f"Could not list Tesseract languages: {exc}") from exc


def _prepare_image(image: Image.Image, *, contrast: bool = False) -> Image.Image:
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    if contrast:
        try:
            from PIL import ImageOps

            image = ImageOps.autocontrast(image.convert("L")).convert("RGB")
        except Exception:  # noqa: BLE001
            pass
    return image

def _vision_hint_for_page(page, *, model: str, host: str) -> str:
    """Transcribe difficult pages or crops using the local vision model."""
    image = getattr(page, "image", None)
    if image is None:
        return ""

    lines = list(getattr(page, "lines", []) or [])
    raw = " ".join(ln.text for ln in lines if getattr(ln, "text", None)).strip()
    words = raw.split()

    # Determine if the current OCR text is garbage / hatching art noise:
    # - Sparse (< 15 words)
    # - Mostly short 1-2 char fragments (> 50% tiny words)
    # - Very low alphanumeric ratio (< 50%)
    tiny_words = sum(1 for w in words if len(w) <= 2)
    alphanumeric_chars = sum(1 for c in raw if c.isalnum())
    is_noise = (
        len(words) < 15
        or (len(words) > 0 and (tiny_words / len(words)) > 0.50)
        or (len(raw) > 0 and (alphanumeric_chars / len(raw)) < 0.50)
    )

    # If it is page 1 (cover) or the OCR is garbage, pass the FULL image to the vision model
    is_first_page = getattr(page, "label", "").lower().startswith(("page 1", "image 1"))
    if is_first_page or is_noise:
        try:
            print("  (Transcribing full page with vision model…)", flush=True)
            res = ollama_vision_ocr(
                image,
                raw if not is_noise else "",
                model=model,
                host=host,
            )
            if res and res.strip():
                return res.strip()
        except Exception as exc:  # noqa: BLE001
            print(f"  (Vision OCR full-page failed: {exc})", flush=True)

    if not lines:
        return ""

    # Fallback to localized crops for dense pages with small suspicious areas
    suspicious = [
        line for line in lines
        if len(line.text or "") >= 35
        and (
            sum(
                not (ch.isalnum() or ch.isspace() or ch in ".,;:!?'-")
                for ch in line.text
            ) > max(3, len(line.text) * 0.08)
            or sum(len(token) <= 2 for token in line.text.split()) >= 4
        )
    ]
    if not suspicious:
        return ""
    suspicious.sort(key=lambda line: (line.top, line.left))
    groups: list[list] = []
    for line in suspicious:
        if groups and line.top - (groups[-1][-1].top + groups[-1][-1].height) <= 2 * line.height:
            groups[-1].append(line)
        else:
            groups.append([line])
    hints: list[str] = []
    for group in groups[:4]:
        left = max(0, min(line.left for line in group) - 24)
        top = max(0, min(line.top for line in group) - 24)
        right = min(image.width, max(line.left + line.width for line in group) + 24)
        bottom = min(image.height, max(line.top + line.height for line in group) + 24)
        if right <= left or bottom <= top:
            continue
        raw_crop = "\n".join(line.text for line in group)
        try:
            hints.append(
                ollama_vision_ocr(
                    image.crop((left, top, right, bottom)),
                    raw_crop,
                    model=model,
                    host=host,
                )
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  (Vision OCR skipped: {exc})", flush=True)
    return "\n\n".join(hints)

def ocr_image(image: Image.Image, lang: str = "fin+eng") -> str:
    """
    Run OCR on a PIL Image. Returns recognized text (may be empty).
    """
    import pytesseract

    configure_tesseract()
    tess_lang = normalize_lang(lang)
    image = _prepare_image(image)

    try:
        text = pytesseract.image_to_string(image, lang=tess_lang)
    except pytesseract.TesseractError as exc:
        msg = str(exc)
        if "Error opening data file" in msg or "Failed loading language" in msg:
            raise OcrError(
                f"Tesseract language pack missing for '{tess_lang}'.\n"
                "Reinstall Tesseract with Finnish (fin) and/or English (eng) packs.\n"
                f"Details: {exc}"
            ) from exc
        raise OcrError(f"Tesseract OCR failed: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise OcrError(f"OCR failed: {exc}") from exc

    return (text or "").strip()


def ocr_image_lines(image: Image.Image, lang: str = "fin+eng") -> list[OcrLine]:
    """
    Run OCR and return lines with bounding boxes (Tesseract image coords).

    Uses image_to_data; prefers level==4 (LINE). If no LINE rows appear,
    words (level==5) are merged into lines by line_num within each block.
    """
    import pytesseract

    configure_tesseract()
    tess_lang = normalize_lang(lang)
    image = _prepare_image(image)

    try:
        data = pytesseract.image_to_data(
            image, lang=tess_lang, output_type=pytesseract.Output.DICT
        )
    except pytesseract.TesseractError as exc:
        msg = str(exc)
        if "Error opening data file" in msg or "Failed loading language" in msg:
            raise OcrError(
                f"Tesseract language pack missing for '{tess_lang}'.\n"
                "Reinstall Tesseract with Finnish (fin) and/or English (eng) packs.\n"
                f"Details: {exc}"
            ) from exc
        raise OcrError(f"Tesseract OCR failed: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise OcrError(f"OCR failed: {exc}") from exc

    n = len(data.get("text") or [])
    if n == 0:
        return []

    # Prefer explicit LINE level (4)
    lines: list[OcrLine] = []
    for i in range(n):
        try:
            level = int(data["level"][i])
        except (KeyError, ValueError, TypeError):
            continue
        if level != 4:
            continue
        text = (data["text"][i] or "").strip()
        if not text:
            continue
        try:
            left = int(data["left"][i])
            top = int(data["top"][i])
            width = int(data["width"][i])
            height = int(data["height"][i])
        except (KeyError, ValueError, TypeError):
            continue
        if width <= 0 or height <= 0:
            continue
        lines.append(OcrLine(text=text, left=left, top=top, width=width, height=height))

    if lines:
        return sort_lines_reading_order(lines)

    # Fallback: merge words (level 5) into lines by (block_num, par_num, line_num)
    from collections import defaultdict

    buckets: dict[tuple[int, int, int], list[tuple[int, int, int, int, str]]] = defaultdict(
        list
    )
    for i in range(n):
        try:
            level = int(data["level"][i])
        except (KeyError, ValueError, TypeError):
            continue
        if level != 5:
            continue
        text = (data["text"][i] or "").strip()
        if not text:
            continue
        try:
            key = (
                int(data["block_num"][i]),
                int(data["par_num"][i]),
                int(data["line_num"][i]),
            )
            left = int(data["left"][i])
            top = int(data["top"][i])
            width = int(data["width"][i])
            height = int(data["height"][i])
        except (KeyError, ValueError, TypeError):
            continue
        if width <= 0 or height <= 0:
            continue
        buckets[key].append((left, top, width, height, text))

    merged: list[OcrLine] = []
    for key in sorted(buckets.keys()):
        words = buckets[key]
        if not words:
            continue
        x0 = min(w[0] for w in words)
        y0 = min(w[1] for w in words)
        x1 = max(w[0] + w[2] for w in words)
        y1 = max(w[1] + w[3] for w in words)
        text = " ".join(w[4] for w in words)
        merged.append(
            OcrLine(text=text, left=x0, top=y0, width=x1 - x0, height=y1 - y0)
        )
    return sort_lines_reading_order(merged)


def ocr_image_path(path: Path | str, lang: str = "fin+eng") -> str:
    """Load an image from disk and OCR it."""
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"Image not found: {p}")
    try:
        with Image.open(p) as im:
            im.load()
            return ocr_image(im.copy(), lang=lang)
    except FileNotFoundError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise OcrError(f"Could not open image {p}: {exc}") from exc


def _load_image(path: Path) -> Image.Image:
    with Image.open(path) as im:
        im.load()
        return im.copy()


def collect_image_paths(folder: Path | str) -> list[Path]:
    """Sorted list of image files in a folder (non-recursive)."""
    root = Path(folder)
    if not root.is_dir():
        raise NotADirectoryError(f"Not a folder: {root}")
    files = [
        p
        for p in root.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    ]
    return sorted(files, key=lambda x: x.name.lower())


def is_image_path(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTENSIONS


def is_pdf_path(path: Path) -> bool:
    return path.suffix.lower() == ".pdf"


def iter_ocr_units(
    path: Path,
    *,
    lang: str = "fin+eng",
    start_page: int = 1,
    end_page: int | None = None,
    dpi: int = 250,
) -> Iterable[tuple[str, str]]:
    """
    Yield (label, text) for each OCR unit.

    - PDF: one unit per page (label like 'Page 3')
    - Single image: one unit
    - Folder: one unit per image file
    """
    for label, _img, lines in iter_ocr_pages(
        path, lang=lang, start_page=start_page, end_page=end_page, dpi=dpi
    ):
        text = "\n".join(ln.text for ln in lines if ln.text).strip()
        yield label, text


def iter_ocr_pages(
    path: Path,
    *,
    lang: str = "fin+eng",
    start_page: int = 1,
    end_page: int | None = None,
    dpi: int = 250,
) -> Iterator[tuple[str, Image.Image, list[OcrLine]]]:
    """
    Yield (label, PIL.Image, list[OcrLine]) for each page/image unit.

    Same start/end/dpi semantics as iter_ocr_units. For PDFs, prefers an
    embedded text layer (scaled to render DPI) when non-empty; otherwise
    falls back to Tesseract line OCR.
    """
    from ocr_read_aloud.pdf_pages import iter_pdf_pages_with_lines

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Path not found: {path}")

    if path.is_dir():
        images = collect_image_paths(path)
        if not images:
            raise OcrError(f"No supported images in folder: {path}")
        first = max(1, start_page)
        last = len(images) if end_page is None else min(end_page, len(images))
        for i, img_path in enumerate(images[first - 1 : last], start=first):
            img = _load_image(img_path)
            lines = ocr_image_lines(img, lang=lang)
            label = f"Image {i}/{len(images)}: {img_path.name}"
            yield label, img, lines
        return

    if is_pdf_path(path):
        for page_no, img, text_lines in iter_pdf_pages_with_lines(
            path, dpi=dpi, start_page=start_page, end_page=end_page
        ):
            # Prefer embedded text layer when present; else Tesseract
            lines = text_lines if text_lines else ocr_image_lines(img, lang=lang)
            yield f"Page {page_no}", img, lines
        return

    if is_image_path(path):
        img = _load_image(path)
        lines = ocr_image_lines(img, lang=lang)
        yield path.name, img, lines
        return

    raise OcrError(
        f"Unsupported input: {path}\n"
        "Use a PDF, an image "
        f"({', '.join(sorted(IMAGE_EXTENSIONS))}), or a folder of images."
    )