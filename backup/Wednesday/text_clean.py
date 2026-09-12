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

def merge_short_fragments(text: str) -> str:
    """
    Merge consecutive short alphabetic tokens (1-3 letters) into one word
    if the result is at least 5 chars and contains a vowel.
    Example: "publ ish ers" -> "publishers"
    """
    import re
    words = text.split()
    if len(words) < 2:
        return text

    # Common short words that should never be merged (keep as separate words)
    common = {
        "a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is",
        "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we",
        "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
        "her", "was", "one", "our", "out", "has", "him", "his", "how", "its",
        "may", "new", "now", "old", "see", "two", "way", "who", "boy", "did",
        "yet", "she", "say", "get", "let", "put", "ask", "own", "too", "any",
    }

    result = []
    i = 0
    while i < len(words):
        token = words[i]
        # If token is short (<=3) and alphabetic and not a common word
        if (len(token) <= 3 and token.isalpha() and token.lower() not in common):
            combined = token
            j = i + 1
            # Collect subsequent short alphabetic tokens (<=3) not common
            while (j < len(words) and len(words[j]) <= 3 and words[j].isalpha()
                   and words[j].lower() not in common):
                combined += words[j]
                j += 1
            # Only merge if combined is long enough and has a vowel
            if len(combined) >= 5 and re.search(r'[aeiouy]', combined, re.I):
                result.append(combined)
                i = j
                continue
            else:
                result.append(token)
                i += 1
        else:
            result.append(token)
            i += 1

    return " ".join(result)

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
