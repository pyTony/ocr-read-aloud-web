"""Parse/write proofread cache files (``{stem}.txt`` page dump format)."""

from __future__ import annotations

import re
from typing import Mapping

# === Page 12 ===  or  === cover ===
_SECTION_HDR = re.compile(r"^===\s*(.+?)\s*===\s*$", re.MULTILINE)


def parse_proof_cache(text: str) -> dict[str, str]:
    """
    Parse ``=== label ===`` sections into ``{label: body}``.

    Labels are stripped; bodies keep internal newlines (stripped outer).
    """
    if not text:
        return {}
    matches = list(_SECTION_HDR.finditer(text))
    if not matches:
        return {}
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        label = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip("\n")
        # Trim a single trailing blank line style
        body = body.strip()
        out[label] = body
    return out


def format_proof_cache(sections: Mapping[str, str]) -> str:
    """Format sections like ``document_text()`` / Save output."""
    blocks: list[str] = []
    for label, body in sections.items():
        raw = (body or "").strip()
        if raw:
            blocks.append(f"=== {label} ===\n{raw}\n")
        else:
            blocks.append(f"=== {label} ===\n")
    return "\n".join(blocks).strip() + ("\n" if blocks else "")


def lookup_cached_text(sections: Mapping[str, str], label: str) -> str | None:
    """Match by exact label, then case-insensitive, then ``Page N`` folio."""
    if not sections:
        return None
    if label in sections:
        return sections[label]
    low = {k.lower(): v for k, v in sections.items()}
    if label.lower() in low:
        return low[label.lower()]
    # Folio match: label "Page 12" ↔ section "Page 12"
    m = re.match(r"^\s*page\s+(\d+)\b", label, re.IGNORECASE)
    if m:
        folio = m.group(1)
        for k, v in sections.items():
            km = re.match(r"^\s*page\s+(\d+)\b", k, re.IGNORECASE)
            if km and km.group(1) == folio:
                return v
    return None
