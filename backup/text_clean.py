"""Shared text cleanup for OCR / PDF lines before speech."""

from __future__ import annotations

import re

# Soft hyphen (U+00AD) and ASCII hyphen/minus used at end-of-line splits.
_EOL_HYPHEN = re.compile(
    r"^(?P<head>.*?\w)[\-\u00ad]\s*$",
    re.UNICODE,
)
_INLINE_DEHYPHEN = re.compile(
    r"(?P<a>\w)[\-\u00ad]\s+(?P<b>[a-zà-öø-ÿ][\w\-]*)",
    re.UNICODE,
)
# Keep hyphen before these (hyphenated compounds: state-of-the-art).
_COMPOUND_NEXT = frozenset(
    {
        "a",
        "an",
        "and",
        "as",
        "at",
        "based",
        "by",
        "for",
        "from",
        "in",
        "like",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
    }
)


def _first_token(s: str) -> str:
    # Word only (no hyphens) so "of-the-art" → "of" for compound checks.
    m = re.match(r"[\w]+", s or "", re.UNICODE)
    return (m.group(0) if m else "").lower()


def join_lines_dehyphenate(lines: list[str]) -> str:
    """
    Join line strings into one paragraph while keeping real sentence breaks.

    This does two things:
    - strips end-of-line hyphenation like ``mi-`` + ``crocomputer`` → ``microcomputer``
    - keeps lowercase continuation fragments together for reading, so OCR line
      breaks inside the same sentence do not create artificial pauses.

    If the next line starts with an uppercase letter, it is treated as a new
    sentence/paragraph boundary and kept separated.
    """
    cleaned = [(ln or "").rstrip() for ln in lines if (ln or "").strip()]
    if not cleaned:
        return ""

    out = cleaned[0]
    for nxt in cleaned[1:]:
        nxt_s = nxt.lstrip()
        if not nxt_s:
            continue

        # Lowercase continuation fragments are usually the same sentence split by
        # OCR line wrapping; keep them together instead of forcing a pause.
        if nxt_s[0].islower():
            trimmed = out.rstrip()
            if trimmed.endswith(" ."):
                out = trimmed[:-2] + " " + nxt_s
            elif trimmed.endswith("."):
                out = trimmed[:-1] + " " + nxt_s
            else:
                out = trimmed + " " + nxt_s
            continue

        m = _EOL_HYPHEN.match(out)
        if m and nxt_s[0].isalpha():
            head = m.group("head")
            tok = _first_token(nxt_s)
            if nxt_s[0].islower() and tok not in _COMPOUND_NEXT:
                out = head + nxt_s
            else:
                out = head + "-" + nxt_s
        else:
            out = out.rstrip() + " " + nxt_s
    return out.strip()

def join_cover_theme_lines(text: str) -> str:
    """Join consecutive single-word ALL-CAPS lines into one (SPEECH/SYNTHESIS/BY/COMPUTER)."""
    import re
    lines = text.split("\n")
    out: list[str] = []
    buf: list[str] = []
    for ln in lines:
        w = ln.strip()
        # single alphabetic ALL-CAPS word, no punctuation
        if w and w.isalpha() and w.isupper() and len(w) >= 2:
            buf.append(w)
        else:
            if len(buf) >= 2:
                out.append(" ".join(buf))
            elif buf:
                out.extend(buf)
            buf = []
            out.append(ln)
    if len(buf) >= 2:
        out.append(" ".join(buf))
    elif buf:
        out.extend(buf)
    return "\n".join(out)

def dehyphenate_inline(text: str) -> str:
    """
    Remove hyphen + whitespace splits inside already-joined text when the
    second part starts with a lowercase letter (``mi- cro`` → ``micro``),
    keeping compound connectors (``state- of-the-art`` → ``state-of-the-art``).
    """
    if not text:
        return ""
    prev = None
    cur = text.replace("\u00ad", "-")

    def _repl(m: re.Match[str]) -> str:
        b = m.group("b")
        tok = _first_token(b)
        if tok in _COMPOUND_NEXT:
            return f"{m.group('a')}-{b}"
        return f"{m.group('a')}{b}"

    for _ in range(32):
        if cur == prev:
            break
        prev = cur
        cur = _INLINE_DEHYPHEN.sub(_repl, cur)
    return cur


# Form fill-in lines (OCR underscores). Longest/most specific first.
_FORM_BLANKS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\$\s*_{2,}"), " dollar amount here "),
    (re.compile(r"(?i)\bNAME\s*_{2,}"), " your name here "),
    (re.compile(r"(?i)\bADDRESS\s*_{2,}"), " your address here "),
    (re.compile(r"(?i)\b(?:ZIP(?:\s*CODE)?|POSTAL\s*CODE)\s*_{2,}"), " ZIP code here "),
    (re.compile(r"(?i)\bCITY\s*_{2,}"), " city here "),
    (re.compile(r"(?i)\b(?:PHONE|TEL(?:EPHONE)?)\s*_{2,}"), " phone number here "),
    (re.compile(r"(?i)\bE-?MAIL\s*_{2,}"), " email here "),
    (re.compile(r"(?i)\b(?:COMPANY|ORG(?:ANIZATION)?)\s*_{2,}"), " company name here "),
    (re.compile(r"(?i)\bDATE\s*_{2,}"), " date here "),
    (re.compile(r"(?i)\bSIGNATURE\s*_{2,}"), " signature here "),
    # Generic: any remaining run of 2+ underscores
    (re.compile(r"_{2,}"), " line to fill in "),
]
_MULTI_SPACE_CLEAN = re.compile(r"[ \t]{2,}")


def expand_form_blanks(text: str) -> str:
    """Turn OCR underscore fill-ins into spoken/caption phrases.

    Examples: ``$____`` → ``dollar amount here``; ``NAME ____`` → ``your name here``;
    bare ``____`` → ``line to fill in``.
    """
    if not text or "_" not in text:
        return text or ""
    out = text
    for pat, repl in _FORM_BLANKS:
        out = pat.sub(repl, out)
    return _MULTI_SPACE_CLEAN.sub(" ", out).strip()
