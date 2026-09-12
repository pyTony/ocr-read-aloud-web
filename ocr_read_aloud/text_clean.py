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
    Join line strings into one paragraph, removing end-of-line hyphenation.

    If the previous line ends with a letter + hyphen (or soft hyphen) and the
    next line starts with a *lowercase* letter, join without the hyphen or a
    space (``mi-`` + ``crocomputer`` → ``microcomputer``), unless the next
    token looks like a hyphenated-compound connector (``state-`` + ``of-the-art``
    → ``state-of-the-art``).

    If the next line starts with an uppercase letter, keep the hyphen (often a
    compound / proper continuation).
    """
    cleaned = [(ln or "").rstrip() for ln in lines if (ln or "").strip()]
    if not cleaned:
        return ""
    out = cleaned[0]
    for nxt in cleaned[1:]:
        nxt_s = nxt.lstrip()
        if not nxt_s:
            continue
        if nxt_s[0] in ".,;:!?%)]}" or nxt_s.startswith(("'", "’")):
            out = out.rstrip() + nxt_s
            continue
        m = _EOL_HYPHEN.match(out)
        if m and nxt_s[0].isalpha():
            head = m.group("head")
            tok = _first_token(nxt_s)
            if nxt_s[0].islower() and tok not in _COMPOUND_NEXT:
                # End-of-line split: drop hyphen, no space.
                out = head + nxt_s
            else:
                # Capital or compound connector — keep hyphen.
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
    # Generic: any remaining run of 2+ underscores is a divider line -> silent space
    (re.compile(r"_{2,}"), " "),
]
_MULTI_SPACE_CLEAN = re.compile(r"[ \t]{2,}")

# Bookkeeping sign markers: Finnish/Swedish/German invoices write the sign
# AFTER the amount ("12,45-" = credit, "12,34+" = debit). SAPI reads a
# leading "-" as "miinus" but drops a trailing "-" as punctuation, so the
# minus is silently lost. Move the sign in front before speech.
#
# The number must contain a decimal separator — that keeps the pattern
# from mangling ranges like "1976-1977", "pages 12-14", or dates.
_TRAILING_SIGN = re.compile(
    r"(?P<num>\d+[.,]\d+)\s*(?P<sign>[-−+])(?=$|\s|[,;.)\]])"
)


def normalize_accounting_signs(text: str) -> str:
    """Move trailing +/- on decimal numbers to the front so SAPI reads them.

    ``12,45-`` → ``-12,45``
    ``12.34+`` → ``+12.34``
    ``1976-1977`` → unchanged (no decimal separator)
    ``pages 12-14`` → unchanged (no decimal separator)
    """
    if not text or not any(c in text for c in "-−+"):
        return text

    def _repl(m: re.Match[str]) -> str:
        sign = "-" if m.group("sign") in "-−" else "+"
        return f"{sign}{m.group('num')}"

    return _TRAILING_SIGN.sub(_repl, text)

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

# Apostrophe contractions only. Keys MUST be lowercase — expand_contractions()
# always looks up text.lower(), and restores capitalization on output itself,
# so a capitalized key here (e.g. "I'll") would simply never match.
_CONTRACTIONS = {
    "you'll": "you will", "we'll": "we will", "they'll": "they will",
    "i'll": "I will", "he'll": "he will", "she'll": "she will",
    "it'll": "it will", "that'll": "that will", "there'll": "there will",
    "you're": "you are", "we're": "we are", "they're": "they are",
    "it's": "it is", "that's": "that is", "what's": "what is",
    "who's": "who is", "here's": "here is", "there's": "there is",
    "let's": "let us",
    "you've": "you have", "we've": "we have", "they've": "they have",
    "i've": "I have",
    "you'd": "you would", "we'd": "we would", "i'd": "I would",
    "don't": "do not", "doesn't": "does not", "didn't": "did not",
    "won't": "will not", "wouldn't": "would not", "can't": "cannot",
    "couldn't": "could not", "shouldn't": "should not",
    "isn't": "is not", "aren't": "are not",
    "wasn't": "was not", "weren't": "were not",
    "haven't": "have not", "hasn't": "has not", "hadn't": "had not",
}


def expand_contractions(text: str) -> str:
    """Expand common English contractions so SAPI doesn't mangle apostrophes."""
    import re
    if not text:
        return text
    t = text.replace("\u2019", "'").replace("\u2018", "'")
    def _repl(m):
        word = m.group(0)
        low = word.lower()
        expansion = _CONTRACTIONS.get(low)
        if expansion is None:
            return word
        if word[0].isupper() and not expansion[0].isupper():
            return expansion[0].upper() + expansion[1:]
        return expansion
    pattern = r"\b[A-Za-z]+(?:'[a-z]+|n't)\b"
    return re.sub(pattern, _repl, t)


# Plain (non-apostrophe) abbreviations. Keys are lowercase, matched
# case-insensitively; capitalization of the *first* letter of the match is
# restored on output the same way expand_contractions does. Period after the
# abbreviation is optional in the input and never required or produced.
#
# "no" and "in" are deliberately NOT here as whole-word entries — they're far
# too common as ordinary English words ("no thanks", "in the house") to
# safely replace everywhere. They're handled separately, only in the narrow
# numeric contexts where they actually mean number/inches (see
# _NUMERIC_ABBREVIATIONS below).
_ABBREVIATIONS = {
    "ea": "each", "etc": "et cetera", "vs": "versus",
    "approx": "approximately", "dept": "department", "est": "established",
    "ft": "feet", "lb": "pounds", "oz": "ounces", "pt": "point",
    "sec": "second", "sq": "square",
    "jan": "January", "feb": "February", "mar": "March", "apr": "April",
    "jun": "June", "jul": "July", "aug": "August",
    "sep": "September", "sept": "September", "oct": "October",
    "nov": "November", "dec": "December",
}
_ABBREV_PATTERN = re.compile(
    # \b right after the letters (always a real boundary there), THEN an
    # optional trailing period — not \.?\b, which fails to match the period
    # when it's followed by a space/comma: "." next to " " is two non-word
    # characters, so \b can never sit between them.
    r"\b(" + "|".join(re.escape(k) for k in _ABBREVIATIONS) + r")\b\.?",
    re.IGNORECASE,
)
# "i.e." kept separate: the only entry that's periods-in-the-middle, not a
# trailing period, so it can't share _ABBREV_PATTERN's shape.
_IE_PATTERN = re.compile(r"\bi\.e\.?\b", re.IGNORECASE)

# Narrow numeric-context expansions for words too common to touch globally.
# Only fires directly before/after a number, e.g. "No. 5" -> "Number 5",
# "3 in." -> "3 inches", "ca. 1976" -> "about 1976". Bare "no"/"in"/"ca"
# elsewhere in a sentence is left untouched.
_NUMERIC_ABBREVIATIONS = [
    (re.compile(r"\bNo\.\s*(?=\d)", re.IGNORECASE), "Number "),
    (re.compile(r"(?<=\d)\s*in\.(?=\s|$)", re.IGNORECASE), " inches"),
    (re.compile(r"\bca\.\s*(?=\d)", re.IGNORECASE), "about "),
    # Quote-mark unit shorthand: 3" -> 3 inches, 6' -> 6 feet. Must run
    # before sanitize_for_speech(), which strips quote/apostrophe chars
    # entirely and would erase this signal first.
    (re.compile(r'(?<=\d)\s*"'), " inches"),
    (re.compile(r"(?<=\d)\s*'(?!\w)"), " feet"),
]


def expand_abbreviations(text: str) -> str:
    """Expand unit/date/Latin abbreviations so SAPI reads them as words."""
    if not text:
        return text
    t = text

    def _repl(m: re.Match[str]) -> str:
        word = m.group(1)
        expansion = _ABBREVIATIONS.get(word.lower())
        if expansion is None:
            return m.group(0)
        if word[0].isupper() and not expansion[0].isupper():
            return expansion[0].upper() + expansion[1:]
        return expansion

    t = _ABBREV_PATTERN.sub(_repl, t)
    t = _IE_PATTERN.sub("that is", t)
    for pat, repl in _NUMERIC_ABBREVIATIONS:
        t = pat.sub(repl, t)
    return t

def sanitize_for_speech(text: str) -> str:
    """Strip quotes and drop possessive apostrophes so SAPI reads cleanly."""
    import re
    if not text:
        return text
    t = text
    # Normalize smart quotes to straight, then remove all quote marks
    for ch in ('"', '"', '"', "'", "'"):
        t = t.replace(ch, "")
    t = t.replace('"', "")
    # Drop possessive apostrophe: word's -> words
    t = re.sub(r"\b([A-Za-z]+)'s\b", r"\1s", t)
    # Drop any remaining apostrophes between letters (belt and braces)
    t = re.sub(r"(\w)'(\w)", r"\1\2", t)
    return t

def join_theme_words(text: str) -> str:
    """Join runs of single ALL-CAPS words onto one line
    (SPEECH / SYNTHESIS / BY / COMPUTER -> SPEECH SYNTHESIS BY COMPUTER)."""
    if not text:
        return text
    out: list[str] = []
    buf: list[str] = []
    for raw in text.split("\n"):
        w = raw.strip()
        if w and w.isalpha() and w.isupper() and 2 <= len(w) <= 15:
            buf.append(w)
        else:
            if len(buf) >= 2:
                out.append(" ".join(buf))
            elif buf:
                out.extend(buf)
            buf = []
            out.append(raw)
    if len(buf) >= 2:
        out.append(" ".join(buf))
    elif buf:
        out.extend(buf)
    return "\n".join(out)


# Last-resort safety net: OCR noise dense enough that speaking it aloud is
# worse than silently skipping it (e.g. a dense parts-catalog ad column that
# OCR'd as symbol soup). This catches what _vision_hint_for_page's page-level
# noise check misses — a single bad chunk on an otherwise-clean page never
# moves that page-wide average enough to trigger it. Deliberately
# conservative: requires 2+ independent signals together, so legitimate
# short/technical lines ("12 VDC Relay SPDT 4 amp $1.25 ea.") aren't silenced.
_LONG_DASH_RUN = re.compile(r"[-\u2013\u2014]{4,}")
_MIDWORD_PUNCT = re.compile(r"\w[\"'(),;:](?!\s|$)")
_GARBAGE_COMMON_SHORT = frozenset(
    {
        "a", "i", "an", "am", "pm", "no", "in", "on", "at", "to", "of", "or",
        "is", "it", "as", "by", "up", "so", "ok", "us", "we", "ea", "ft",
        "lb", "oz", "pt", "sq", "vs", "dc", "ac", "hz",
    }
)


def looks_like_speech_garbage(text: str) -> bool:
    """True if ``text`` looks like OCR noise rather than real words/numbers."""
    t = (text or "").strip()
    if not t or len(t) < 8:
        return False
    if _LONG_DASH_RUN.search(t):
        return True
    tokens = t.split()
    if not tokens:
        return False
    tiny = sum(
        1 for w in tokens
        if len(re.sub(r"[^\w]", "", w)) <= 2
        and w.lower().strip(".,;:!?\"'()") not in _GARBAGE_COMMON_SHORT
    )
    tiny_ratio = tiny / len(tokens)
    midword_hits = len(_MIDWORD_PUNCT.findall(t))
    alpha_ratio = sum(1 for c in t if c.isalpha()) / max(1, len(t))
    signals = 0
    if tiny_ratio > 0.45:
        signals += 1
    if midword_hits >= 3:
        signals += 1
    if alpha_ratio < 0.35:
        signals += 1
    return signals >= 2
