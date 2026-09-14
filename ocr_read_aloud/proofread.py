"""Local Ollama proofreading for OCR text (no cloud API keys)."""

from __future__ import annotations

import json
import base64
import io
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Callable

DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen3.5:9b-q4_K_M"
DEFAULT_OLLAMA_VISION_MODEL = "qwen2.5vl:latest"

# Soft limit per prompt chunk (characters). Smaller chunks → more frequent
# page/chunk progress updates during long local model runs.
_DEFAULT_CHUNK_CHARS = 2000

# How often to push progress while tokens stream in (seconds).
_PROGRESS_INTERVAL_S = 1.25

# Short socket read timeout so cancel / Ctrl+C can be noticed between reads.
# A stuck HTTP read may therefore take up to ~this long to interrupt.
_STREAM_READ_TIMEOUT_S = 2.0

# [IMPROVEMENT: OCR-SPLIT-REPAIR - BEGIN]
# Upgraded system prompt explicitly mandating aggressive split-word & dehyphenation repair.
# (Original prompt preserved below for backtracking reference):
# _ORIGINAL_SYSTEM_PROMPT = (
#     "You lightly proofread OCR text meant for text-to-speech. "
#     "Fix OCR garbage, join broken words split across lines or by accidental spaces "
#     "inside a word (for example 'do ing' -> 'doing' and 'mag az in e' -> 'magazine'), "
#     "and keep the meaning. "
#     "Insert blank lines between sensible paragraphs for TTS pacing. "
#     "Preserve the input reading order exactly; never move a section or column. "
#     "Do NOT summarize, shorten, expand, or invent content. "
#     "Preserve structure and any page/section markers (e.g. === Page N ===). "
#     "If this page is clearly a full-page advertisement interrupting an article "
#     "(product pitch, coupon, dealer list, little article prose), begin the output "
#     "with the exact line [[SKIP_AS_AD]] then the cleaned ad text. "
#     "If unsure, do not use that marker. "
#     "Return plain text only — no markdown fences, no commentary."
# )
_SYSTEM_PROMPT = (
    "You are an expert OCR proofreader and editor for scanned publications and magazines. "
    "PRIMARY MANDATE: AGGRESSIVELY REPAIR SPLIT WORDS AND DEHYPHENATE. "
    "1. Hyphenated word splits across line breaks or within lines: "
    "Always merge words broken with a hyphen, dropping the hyphen (e.g. 'micro- processor' -> 'microprocessor', "
    "'com- puter' -> 'computer', 'pro- gramming' -> 'programming', 'syn- thesis' -> 'synthesis', "
    "'inter- face' -> 'interface', 'cir- cuits' -> 'circuits', 'tieto- kone' -> 'tietokone', "
    "'järjes- telmä' -> 'järjestelmä'). Keep true compounds like 'state-of-the-art'. "
    "2. Accidental spaces inside words: "
    "Merge accidental spaces inside words or between syllables (e.g. 'do ing' -> 'doing', "
    "'mag az in e' -> 'magazine', 'speec h' -> 'speech', 'oper ation' -> 'operation', 'com puter' -> 'computer'). "
    "3. Cleanliness and TTS Structure: "
    "Remove stray OCR artifacts and scan speckles. Insert blank lines between natural paragraphs. "
    "Strictly preserve reading order and meaning. Do NOT summarize or invent new text. "
    "Preserve page/section markers (e.g. === Page N ===). "
    "4. If this page is strictly an advertisement, start with [[SKIP_AS_AD]]. Return plain text only."
)
# [IMPROVEMENT: OCR-SPLIT-REPAIR - END]

def parse_proof_page_text(text: str) -> tuple[str, bool]:
    """
    Split proofread page output into ``(body, is_ad)``.

    A leading ``[[SKIP_AS_AD]]`` line (or prefix) marks a mid-article ad page.
    """
    import re

    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not raw:
        return "", False
    lines = raw.split("\n")
    if lines and re.match(r"^\s*\[\[SKIP_AS_AD\]\]\s*$", lines[0], re.I):
        body = "\n".join(lines[1:]).strip()
        return body, True
    if re.match(r"^\s*\[\[SKIP_AS_AD\]\]\s*", raw, re.I):
        body = re.sub(r"^\s*\[\[SKIP_AS_AD\]\]\s*", "", raw, count=1, flags=re.I).strip()
        return body, True
    return raw, False

# Module-level cancel flag (CLI Ctrl+C / preview Stop / Esc).
_cancel_event = threading.Event()


class ProofreadError(RuntimeError):
    """Raised when Ollama proofreading fails hard (caller may treat as warning)."""


class ProofreadCancelled(ProofreadError):
    """Raised when proofread is cancelled via Ctrl+C, Stop, or set_proofread_cancel."""


def set_proofread_cancel(cancelled: bool = True) -> None:
    """Set or clear the global proofread cancel flag."""
    if cancelled:
        _cancel_event.set()
    else:
        _cancel_event.clear()


def clear_proofread_cancel() -> None:
    """Clear the global proofread cancel flag (call before starting a run)."""
    _cancel_event.clear()


def is_proofread_cancelled() -> bool:
    """True if proofread cancel has been requested."""
    return _cancel_event.is_set()


def _check_cancel() -> None:
    if _cancel_event.is_set():
        raise ProofreadCancelled("Cancelled")


def _chat_url(host: str) -> str:
    return host.rstrip("/") + "/api/chat"


def ollama_available(host: str = DEFAULT_OLLAMA_HOST, timeout: float = 2.0) -> bool:
    """True if Ollama responds on the given host (GET /api/tags)."""
    url = host.rstrip("/") + "/api/tags"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except Exception:  # noqa: BLE001
        return False


def _strip_fences(text: str) -> str:
    """Remove accidental markdown code fences from model output."""
    s = text.strip()
    if s.startswith("```"):
        lines = s.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    return s


def _set_socket_timeout(resp: object, timeout: float) -> None:
    """Best-effort short read timeout on an urllib HTTPResponse."""
    try:
        fp = getattr(resp, "fp", None)
        raw = getattr(fp, "raw", None) if fp is not None else None
        sock = getattr(raw, "_sock", None) if raw is not None else None
        if sock is not None and hasattr(sock, "settimeout"):
            sock.settimeout(timeout)
            return
    except Exception:  # noqa: BLE001
        pass
    try:
        # http.client.HTTPResponse sometimes exposes .fp as the socket file
        fp = getattr(resp, "fp", None)
        if fp is not None and hasattr(fp, "settimeout"):
            fp.settimeout(timeout)
    except Exception:  # noqa: BLE001
        pass


def _is_timeout_exc(exc: BaseException) -> bool:
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return True
    # Some platforms wrap timeouts in OSError / URLError
    msg = str(exc).lower()
    return "timed out" in msg or "timeout" in msg


def gemini_proofread_text(
    text: str,
    *,
    api_key: str | None = None,
    model: str = "gemini-2.5-flash",
) -> str:
    """Proofread OCR text using Google Gemini API."""
    import os
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ProofreadError("GEMINI_API_KEY environment variable is required for Gemini proofreading.")
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": f"OCR TEXT TO PROOFREAD:\n{text}"}]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": _SYSTEM_PROMPT}]
        },
        "generationConfig": {
            "temperature": 0.1
        }
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates", [])
            if not candidates:
                return text
            parts = candidates[0].get("content", {}).get("parts", [])
            output = "".join(p.get("text", "") for p in parts).strip()
            if not output:
                return text
            cleaned = _strip_fences(output)
            from ocr_read_aloud.text_clean import repair_split_words_and_dehyphenate
            return repair_split_words_and_dehyphenate(cleaned)
    except Exception as exc:
        raise ProofreadError(f"Gemini API request failed: {exc}")


def _ollama_chat_stream(
    text: str,
    *,
    model: str,
    host: str,
    timeout: float = 300.0,
    on_stream_progress: Callable[[int, float], None] | None = None,
    visual_hint: str | None = None,
) -> str:
    """
    Call Ollama /api/chat with stream=true; return assistant message content.

    Invokes on_stream_progress(chars_out, elapsed_s) about every 1–1.5s while
    tokens arrive. Checks the cancel flag between socket reads (short timeout).
    """
    user_content = "Proofread the following OCR text for TTS. Return only the corrected plain text:\n\n" + text
    if visual_hint:
        user_content += (
            "\n\nA vision OCR pass inspected the difficult region below. "
            "Use it as evidence to correct the matching OCR passage, but do not "
            "copy unrelated commentary:\n\n" + visual_hint
        )
    payload = {
        "model": model,
        "stream": True,
        "think": False,  # <-- suppress reasoning tokens on thinking models
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": user_content,
            },
        ],
        "options": {
            # Discourage creative rewrites
            "temperature": 0.1,
            "num_ctx": 4096,
            "num_predict": 1500,
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        _chat_url(host),
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    _check_cancel()
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.URLError as exc:
        raise ProofreadError(
            f"Cannot reach Ollama at {host} ({exc}). "
            "Start it with `ollama serve` (or the Ollama app), then retry."
        ) from exc
    except TimeoutError as exc:
        raise ProofreadError(
            f"Ollama timed out at {host}. Try a smaller model or shorter pages."
        ) from exc

    parts: list[str] = []
    chars_out = 0
    t0 = time.monotonic()
    last_progress_at = 0.0

    def emit_progress(*, force: bool = False) -> None:
        nonlocal last_progress_at
        if on_stream_progress is None:
            return
        now = time.monotonic()
        if not force and (now - last_progress_at) < _PROGRESS_INTERVAL_S:
            return
        last_progress_at = now
        try:
            on_stream_progress(chars_out, now - t0)
        except Exception:  # noqa: BLE001
            pass

    try:
        _set_socket_timeout(resp, _STREAM_READ_TIMEOUT_S)
        emit_progress(force=True)

        while True:
            _check_cancel()
            try:
                raw_line = resp.readline()
            except KeyboardInterrupt:
                set_proofread_cancel(True)
                raise ProofreadCancelled("Cancelled") from None
            except Exception as exc:  # noqa: BLE001
                if _is_timeout_exc(exc):
                    # Between tokens / slow model — refresh progress & re-check cancel
                    emit_progress()
                    continue
                raise ProofreadError(f"Ollama stream read failed: {exc}") from exc

            if not raw_line:
                break

            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ProofreadError(f"Invalid JSON from Ollama stream: {exc}") from exc

            if obj.get("error"):
                raise ProofreadError(f"Ollama error: {obj['error']}")

            message = obj.get("message") or {}
            piece = message.get("content") or ""
            if not piece and isinstance(obj.get("response"), str):
                piece = obj["response"]
            if piece:
                parts.append(piece)
                chars_out += len(piece)
                emit_progress()

            if obj.get("done"):
                break
    finally:
        try:
            resp.close()
        except Exception:  # noqa: BLE001
            pass

    _check_cancel()
    emit_progress(force=True)
    content = "".join(parts).strip()
    if not content:
        raise ProofreadError("Ollama returned empty proofread text.")
    return _strip_fences(content)


def ollama_vision_ocr(
    image: object,
    raw_text: str,
    *,
    model: str = DEFAULT_OLLAMA_VISION_MODEL,
    host: str = DEFAULT_OLLAMA_HOST,
) -> str:
    """Ask a local vision model to transcribe one difficult page crop."""
    try:
        image_bytes = io.BytesIO()
        image.save(image_bytes, format="PNG")  # type: ignore[attr-defined]
        encoded = base64.b64encode(image_bytes.getvalue()).decode("ascii")
    except Exception as exc:  # noqa: BLE001
        raise ProofreadError(f"Could not encode vision crop: {exc}") from exc
    
    hint = (raw_text or "").strip()
    if hint:
        user_text = (
            "You are transcribing a scanned MAGAZINE PAGE for a "
            "text-to-speech reader.\n\n"
            "Rules:\n"
            "- Transcribe ALL visible printed text on the page, top to "
            "bottom, left to right.\n"
            "- INCLUDE large masthead / cover title text (magazine name, "
            "issue number, date, price, headline) — the largest text on "
            "the page is the most important, not the least.\n"
            "- INCLUDE body text, captions, headings, and pull-quotes.\n"
            "- INCLUDE text inside advertisement boxes, order forms, coupons, "
            "catalog listings, tables, or grid boxes even if they have borders "
            "or drawings around them. Only ignore text inside pure non-prose "
            "illustrations (like labels inside a circuit diagram, map "
            "coordinates, or chart axis titles if they are not part of "
            "readable paragraphs/catalog items).\n"
            "- Preserve paragraph breaks as blank lines.\n"
            "- Do not describe pictures or layout. Do not comment.\n"
            "- Do not invent section headers like '=== Page N ==='.\n"
            "- Return plain text only.\n\n"
            "Local OCR output for cross-reference (may be garbled):\n" + hint
        )
    else:
        user_text = (
            "You are transcribing a scanned MAGAZINE PAGE for a "
            "text-to-speech reader.\n\n"
            "Rules:\n"
            "- Transcribe ALL visible printed text on the page, top to "
            "bottom, left to right.\n"
            "- INCLUDE large masthead / cover title text (magazine name, "
            "issue number, date, price, headline) — the largest text on "
            "the page is the most important, not the least.\n"
            "- INCLUDE body text, captions, headings, and pull-quotes.\n"
            "- INCLUDE text inside advertisement boxes, order forms, coupons, "
            "catalog listings, tables, or grid boxes even if they have borders "
            "or drawings around them. Only ignore text inside pure non-prose "
            "illustrations (like labels inside a circuit diagram, map "
            "coordinates, or chart axis titles if they are not part of "
            "readable paragraphs/catalog items).\n"
            "- Preserve paragraph breaks as blank lines.\n"
            "- Do not describe pictures or layout. Do not comment.\n"
            "- Do not invent section headers like '=== Page N ==='.\n"
            "Preserve table rows and columns exactly as they appear; do not "
            "merge, split, or omit any row. Keep numeric columns in order.\n"
            "- Return plain text only."
        )
    payload = {
        "model": model,
        "stream": False,
        "think": False,
        "messages": [{
            "role": "user",
            "content": user_text,
            "images": [encoded],
        }],
        "options": {"temperature": 0.0},
    }
    req = urllib.request.Request(
        _chat_url(host),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300.0) as resp:
            obj = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ProofreadError(f"Vision OCR failed with {model}: {exc}") from exc
    content = ((obj.get("message") or {}).get("content") or "").strip()
    if not content:
        raise ProofreadError(f"Vision model {model} returned empty text")
    return _strip_fences(content)


def _chunk_text(text: str, max_chars: int = _DEFAULT_CHUNK_CHARS) -> list[str]:
    """Split text into chunks on paragraph/blank-line boundaries when possible."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    parts: list[str] = []
    # Prefer blank-line paragraphs, else hard newlines
    paragraphs = text.split("\n\n")
    buf = ""
    for para in paragraphs:
        candidate = para if not buf else buf + "\n\n" + para
        if len(candidate) <= max_chars:
            buf = candidate
            continue
        if buf:
            parts.append(buf)
            buf = ""
        if len(para) <= max_chars:
            buf = para
            continue
        # Hard-split oversized paragraph by lines, then by char length
        lines = para.splitlines() or [para]
        for line in lines:
            while len(line) > max_chars:
                if buf:
                    parts.append(buf)
                    buf = ""
                parts.append(line[:max_chars])
                line = line[max_chars:]
            if not line:
                continue
            if not buf:
                buf = line
            elif len(buf) + 1 + len(line) <= max_chars:
                buf = buf + "\n" + line
            else:
                parts.append(buf)
                buf = line
        if buf:
            parts.append(buf)
            buf = ""
    if buf:
        parts.append(buf)
    return parts


def _format_progress(
    *,
    page_i: int | None,
    page_n: int | None,
    chunk_j: int,
    chunk_k: int,
    elapsed_s: float,
    chars_out: int,
) -> str:
    """Nested progress: Page i/n · chunk j/k · elapsed · chars out."""
    bits: list[str] = []
    if page_i is not None and page_n is not None:
        bits.append(f"Page {page_i}/{page_n}")
    bits.append(f"chunk {chunk_j}/{chunk_k}")
    bits.append(f"{elapsed_s:.0f}s")
    bits.append(f"{chars_out} chars out")
    return " · ".join(bits)


def proofread_text(
    text: str,
    *,
    model: str = DEFAULT_OLLAMA_MODEL,
    host: str = DEFAULT_OLLAMA_HOST,
    on_progress: Callable[[str], None] | None = None,
    chunk_chars: int = _DEFAULT_CHUNK_CHARS,
    page_index: int | None = None,
    page_count: int | None = None,
    visual_hint: str | None = None,
) -> str:
    """
    Proofread OCR text via local Ollama (streaming). Returns corrected text.

    Raises ProofreadError / ProofreadCancelled on failure or cancel
    (caller may catch and keep raw OCR).
    """
    text = (text or "").strip()
    if not text:
        return ""

    if model.startswith("gemini-") or "gemini" in model.lower():
        if on_progress:
            on_progress("Calling Google Gemini proofread...")
        try:
            return gemini_proofread_text(text, model=model)
        except Exception as exc:
            raise ProofreadError(f"Gemini proofread failed: {exc}")

    _check_cancel()
    chunks = _chunk_text(text, max_chars=chunk_chars)
    if not chunks:
        return ""

    out: list[str] = []
    k = len(chunks)
    for j, chunk in enumerate(chunks, start=1):
        _check_cancel()

        def report(chars_out: int, elapsed_s: float, _j: int = j, _k: int = k) -> None:
            if not on_progress:
                return
            msg = _format_progress(
                page_i=page_index,
                page_n=page_count,
                chunk_j=_j,
                chunk_k=_k,
                elapsed_s=elapsed_s,
                chars_out=chars_out,
            )
            try:
                on_progress(msg)
            except Exception:  # noqa: BLE001
                pass

        # Immediate status before the HTTP call so the UI is not silent
        report(0, 0.0)
        fixed = _ollama_chat_stream(
            chunk,
            model=model,
            host=host,
            on_stream_progress=report if on_progress else None,
            visual_hint=visual_hint if j == 1 else None,
        )
        out.append(fixed)
    joined = "\n\n".join(out).strip()

    # [IMPROVEMENT: OCR-SPLIT-REPAIR - BEGIN]
    # Post-process proofread text with split-word & dehyphenation repair
    try:
        from ocr_read_aloud.text_clean import repair_split_words_and_dehyphenate
        joined = repair_split_words_and_dehyphenate(joined)
    except Exception:
        pass
    # [IMPROVEMENT: OCR-SPLIT-REPAIR - END]

    return joined



def proofread_one_page(
    text: str,
    *,
    model: str = DEFAULT_OLLAMA_MODEL,
    host: str = DEFAULT_OLLAMA_HOST,
    on_progress: Callable[[str], None] | None = None,
    page_index: int | None = None,
    page_count: int | None = None,
    visual_hint: str | None = None,
) -> str:
    """
    Thin wrapper around proofread_text for a single page.

    Does **not** clear the cancel flag — callers that own a multi-page run
    (proof worker / apply_proofread / proofread_pages) must clear cancel once
    at the start of the run.
    """
    return proofread_text(
        text,
        model=model,
        host=host,
        on_progress=on_progress,
        page_index=page_index,
        page_count=page_count,
        visual_hint=visual_hint,
    )


def proofread_pages(
    page_texts: list[str],
    *,
    model: str = DEFAULT_OLLAMA_MODEL,
    host: str = DEFAULT_OLLAMA_HOST,
    on_progress: Callable[[str], None] | None = None,
) -> list[str]:
    """
    Proofread each page's full text separately; return list aligned with input.

    Empty pages stay empty. Passes on_progress into proofread_text so nested
    Page i/n · chunk j/k updates reach the CLI / player status line.
    On total Ollama unavailability, raises ProofreadError after the first failed
    call (caller should warn and keep originals). ProofreadCancelled aborts the
    remaining pages (caller keeps raw OCR).
    """
    clear_proofread_cancel()
    results: list[str] = []
    n = len(page_texts)
    for i, page_text in enumerate(page_texts, start=1):
        _check_cancel()
        raw = (page_text or "").strip()
        if not raw:
            results.append("")
            continue
        fixed = proofread_text(
            raw,
            model=model,
            host=host,
            on_progress=on_progress,
            page_index=i,
            page_count=n,
        )
        results.append(fixed)
    return results


def warn_and_continue(message: str) -> None:
    """Print a clear stderr warning when proofread is skipped."""
    print(f"WARNING: {message}", file=sys.stderr, flush=True)
