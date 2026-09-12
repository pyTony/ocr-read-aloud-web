"""Detect full-page ad inserts and find article skip landings."""

from __future__ import annotations

import re
from typing import Any, Sequence

from ocr_read_aloud.continue_links import (
    parse_continued_from,
    parse_continued_on,
    pdf_page_number_from_label,
)

# Advertising / coupon / promo language (OCR-noisy, case-insensitive).
_AD_CUES = re.compile(
    r"(?i)(?:"
    r"\b(?:"
    r"advertisement|advertising|advertorial|sponsored|"
    r"circle\s+(?:the\s+)?number|"
    r"coupon|%\s*off|percent\s+off|discount|"
    r"call\s+(?:now|today)|order\s+now|buy\s+now|"
    r"limited\s+time|special\s+offer|subscribe\s+now|"
    r"toll[\s-]*free|1[\s\-]*800|save\s+\$|free\s+shipping|"
    r"while\s+supplies\s+last|act\s+now|"
    r"buy|order|offer|price|free|shipping|"
    r"money\s+order|cashier'?s\s+check|enclosed\s+is\s+my|"
    r"ship\s+me\s+to|reader\s+service"
    r")\b|"
    r"www\.|\$"
    r")"
)

# Shouty full-page ad headlines (BYTE-era color-monitor ads, etc.).
_SHOUT_WORDS = re.compile(
    r"(?i)(?:"
    r"\bunbelievable\b|\bincredible\b|\bamazing\b|\bintroducing\b|"
    r"new!|only\s*\$"
    r")"
)
_BANG_RUN = re.compile(r"!{3,}")

# Weak sentence/prose markers
_SENTENCE_END = re.compile(r"[.!?…]")


def page_plain_text(page: Any) -> str:
    """Best-effort text from a PageUnit-like object."""
    try:
        t = getattr(page, "text", None)
        if callable(t):
            t = t()
        if isinstance(t, str) and t.strip():
            return t
    except Exception:  # noqa: BLE001
        pass
    parts: list[str] = []
    for attr in ("lines", "speakable"):
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


def folio_of(page: Any) -> int | None:
    """Printed/PDF folio from label, else None."""
    return pdf_page_number_from_label(getattr(page, "label", "") or "")


def _prose_score(text: str) -> float:
    """Rough 0..1 score: higher means more article-like body prose."""
    raw = (text or "").strip()
    if not raw:
        return 0.0
    words = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}", raw)
    if not words:
        return 0.0
    sentences = max(1, len(_SENTENCE_END.findall(raw)))
    avg_len = sum(len(w) for w in words) / max(1, len(words))
    caps = sum(1 for w in words if w.isupper() and len(w) >= 3)
    caps_ratio = caps / max(1, len(words))
    # Prefer longer average words, more sentence punctuation, fewer ALL-CAPS shouts
    score = 0.0
    score += min(0.4, len(words) / 80.0)
    score += min(0.3, sentences / 6.0)
    score += 0.2 if avg_len >= 4.2 else 0.0
    score -= min(0.4, caps_ratio * 0.8)
    return max(0.0, min(1.0, score))



def _ad_word_density(text: str) -> float:
    """Fraction of words that match advertising cue patterns."""
    raw = (text or "").strip()
    if not raw:
        return 0.0
    words = re.findall(r"\S+", raw)
    if not words:
        return 0.0
    cue_hits = len(_AD_CUES.findall(raw))
    return cue_hits / len(words)


_FORM_AD = re.compile(
    r"(?i)(?:enclosed\s+is\s+my|cashier'?s\s+check|money\s+order|"
    r"personal\s+check|ship\s+me\s+to|circle\s+the\s+number|"
    r"reader\s+service|bingo\s+card)"
)


def looks_like_form_ad(page: Any) -> bool:
    """Order / subscription / bingo-card style pages (often mid-issue ads)."""
    text = page_plain_text(page)
    if parse_continued_from(text):
        return False
    unders = len(re.findall(r"_{2,}", text))
    if unders >= 3:
        return True
    if unders >= 1 and _FORM_AD.search(text):
        return True
    if _FORM_AD.search(text) and _prose_score(text) < 0.55:
        return True
    return False


def looks_like_ad(page: Any) -> bool:
    """
    True if the page looks like a dominant/full-page advertisement.

    Safe default: False when unsure. Pages with “continued from” are never ads.
    BYTE-era ads often lack the word “advertisement” — short/low-prose pages
    with shouty caps or sparse OCR also count.
    """
    text = page_plain_text(page)
    if parse_continued_from(text):
        return False
    # Long article with a jump cue is not an ad
    if parse_continued_on(text) and len(text) > 250 and _prose_score(text) >= 0.35:
        return False

    chars = len(text.strip())
    ad_hits = len(_AD_CUES.findall(text))
    prose = _prose_score(text)
    words = re.findall(r"\S+", text)
    caps = sum(1 for w in words if len(w) >= 3 and w.isupper())
    word_n = len(words)
    density = _ad_word_density(text)
    alpha_tokens = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}", text)
    caps_alpha = sum(1 for w in alpha_tokens if w.isupper() and len(w) >= 2)
    caps_ratio = caps_alpha / max(1, len(alpha_tokens))
    bang_n = text.count("!")

    # Cheap BYTE full-page ad signals (shouty headline + sparse OCR)
    if _BANG_RUN.search(text) or bang_n >= 4:
        return True
    if _SHOUT_WORDS.search(text):
        return True
    if word_n < 80 and alpha_tokens and caps_ratio >= 0.25:
        return True

    if ad_hits >= 2:
        return True
    if ad_hits >= 1 and chars < 450 and prose < 0.45:
        return True
    # Cue density: enough ad language relative to word count (≥5%)
    if density >= 0.05 and word_n >= 12:
        return True
    # Fragmented short lines (coupon / bingo-card OCR layout)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) >= 6 and prose < 0.45:
        words_per_line = [len(re.findall(r"\S+", ln)) for ln in lines]
        avg_wpl = sum(words_per_line) / len(words_per_line)
        if avg_wpl <= 3.5:
            return True
    # Very short / image-heavy OCR with little prose
    if chars < 90 and prose < 0.25:
        return True
    if chars < 220 and caps >= 6 and prose < 0.3:
        return True
    if chars < 160 and ad_hits >= 1:
        return True
    # Sparse / image-ish page: little extractable text relative to a full page
    if chars < 280 and prose < 0.28 and word_n < 45:
        return True
    if chars < 350 and prose < 0.22 and caps >= 4:
        return True
    if looks_like_form_ad(page):
        return True
    return False


def _weak_mid_page(page: Any) -> bool:
    """True if middle page is weak/non-prose (likely ad) even without ad cue regex."""
    if looks_like_ad(page):
        return True
    if looks_like_article_body(page):
        return False
    if getattr(page, "skip_as_ad", False):
        text0 = page_plain_text(page)
        if not parse_continued_from(text0):
            return True
    text = page_plain_text(page)
    if parse_continued_from(text):
        return False
    chars = len(text.strip())
    prose = _prose_score(text)
    # Short or low-prose insert between consecutive folios
    if chars < 400 and prose < 0.35:
        return True
    if chars < 600 and prose < 0.28:
        return True
    return False


def looks_like_article_body(page: Any) -> bool:
    """True if page has enough prose to be article continuation (not an ad)."""
    if looks_like_ad(page):
        return False
    text = page_plain_text(page)
    if parse_continued_from(text):
        return True
    return len(text.strip()) >= 120 and _prose_score(text) >= 0.35


def _continued_from_line_index(page: Any, source_folio: int | None) -> int:
    from ocr_read_aloud.continue_links import continued_from_line_index

    return continued_from_line_index(page, source_folio)

def find_ad_skip(
    pages: Sequence[Any],
    current_idx: int,
    *,
    source_folio: int | None,
    offset: int = 0,
) -> tuple[int, int, int] | None:
    if current_idx < 0 or current_idx + 2 >= len(pages):
        return None

    ad_idx = current_idx + 1
    cont_idx = current_idx + 2
    ad_page = pages[ad_idx]
    cont_page = pages[cont_idx]
    source_text = page_plain_text(pages[current_idx])
    ad_text = page_plain_text(ad_page)
    cont_text = page_plain_text(cont_page)

    # Never skip if next page continues this article
    ad_from = parse_continued_from(ad_text)
    if source_folio is not None and source_folio in ad_from:
        return None
    if ad_from:
        return None

    cont_from = parse_continued_from(cont_text)
    source_on = parse_continued_on(source_text)

    # Physical page numbers (PDF labels)
    cur_pdf = pdf_page_number_from_label(getattr(pages[current_idx], "label", "") or "")
    ad_pdf = pdf_page_number_from_label(getattr(ad_page, "label", "") or "")
    cont_pdf = pdf_page_number_from_label(getattr(cont_page, "label", "") or "")

    # Printed page numbers for link comparison with parsed cues
    cur_printed = source_folio if source_folio is not None else (
        (cur_pdf - offset) if (cur_pdf is not None and offset) else cur_pdf
    )
    cont_printed = (cont_pdf - offset) if (cont_pdf is not None and offset) else cont_pdf

    linked_to_source = (
        (cur_printed is not None and cur_printed in cont_from)
        or (cont_printed is not None and cont_printed in source_on)
    )
    if not linked_to_source:
        return None

    continues = False
    if cur_printed is not None and cur_printed in cont_from:
        continues = True
    elif cont_from and looks_like_ad(ad_page):
        continues = True

    # Physical folio adjacency in the PDF: P, P+1, P+2
    folio_insert = (
        cur_pdf is not None
        and ad_pdf == cur_pdf + 1
        and cont_pdf == cur_pdf + 2
    )

    if not continues:
        mid_ad = (
            looks_like_ad(ad_page)
            or looks_like_form_ad(ad_page)
            or _weak_mid_page(ad_page)
            or bool(getattr(ad_page, "skip_as_ad", False))
        )
        cont_ok = looks_like_article_body(cont_page) or bool(cont_from)
        form_or_flag = looks_like_form_ad(ad_page) or bool(
            getattr(ad_page, "skip_as_ad", False)
        )
        if folio_insert and mid_ad and cont_ok:
            continues = True
        elif folio_insert and _weak_mid_page(ad_page) and (
            looks_like_article_body(cont_page)
            or (cur_printed is not None and cur_printed in cont_from)
            or bool(cont_from)
        ):
            continues = True
        elif folio_insert and looks_like_ad(ad_page) and looks_like_article_body(cont_page):
            continues = True
        elif (
            mid_ad
            and looks_like_article_body(cont_page)
            and (folio_insert or cur_printed is not None)
        ):
            continues = True
        elif form_or_flag and looks_like_article_body(cont_page):
            continues = True
        elif mid_ad and looks_like_article_body(cont_page) and form_or_flag:
            continues = True
        elif (looks_like_ad(ad_page) or looks_like_form_ad(ad_page)) and (
            looks_like_article_body(cont_page) or bool(cont_from)
        ):
            continues = True
        else:
            return None

    if (
        looks_like_ad(ad_page)
        or looks_like_form_ad(ad_page)
        or _weak_mid_page(ad_page)
        or bool(getattr(ad_page, "skip_as_ad", False))
    ):
        pass
    elif cur_printed is not None and cur_printed in cont_from:
        pass
    elif folio_insert and cont_from and not looks_like_article_body(ad_page):
        if len(ad_text.strip()) > 500 and _prose_score(ad_text) >= 0.4:
            return None
    else:
        return None

    line = _continued_from_line_index(cont_page, source_folio)
    return (ad_idx, cont_idx, line)