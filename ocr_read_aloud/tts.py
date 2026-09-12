"""Text-to-speech via Windows SAPI5 (dedicated thread) or pyttsx3 fallback."""

from __future__ import annotations

import queue
import sys
import threading
import time
from collections.abc import Callable, Sequence
from typing import Any
import re

def _escape_for_sapi(text: str) -> str:
    """Escape XML-special characters so Windows SAPI5 doesn't choke on < > &."""
    import xml.sax.saxutils as _xml
    return _xml.escape(text, {'"': "&quot;", "'": "&apos;"})

_BULLET_LINE = re.compile(
    r"^[\t ]*(?:[*\u2022\u2023\u25E6\u2043\u2219\-–—]+|\d+[.)])\s+"
)
_STAR_RUNS = re.compile(r"\*+")
_MULTI_SPACE = re.compile(r"[ \t]{2,}")

def normalize_for_speech(text: str) -> str:
    """Clean text for TTS: drop bullets; dehyphenate; expand abbreviations/contractions."""
    if not text:
        return ""
    from ocr_read_aloud.text_clean import (
        dehyphenate_inline,
        expand_abbreviations,
        expand_contractions,
        expand_form_blanks,
        join_lines_dehyphenate,
        looks_like_speech_garbage,
        normalize_accounting_signs, 
        sanitize_for_speech,
    )

    parts: list[str] = []
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    for line in normalized.split("\n"):
        s = _BULLET_LINE.sub("", line)
        s = _STAR_RUNS.sub(" ", s)
        s = _MULTI_SPACE.sub(" ", s).strip()
        if s:
            parts.append(s)
    joined = join_lines_dehyphenate(parts) if parts else ""
    out = expand_form_blanks(dehyphenate_inline(joined))
    # Abbreviations before contractions before sanitize: each later step can
    # strip punctuation (periods, quotes, apostrophes) the earlier steps
    # still need to see.
    out = expand_abbreviations(out)
    out = expand_contractions(out)
    out = sanitize_for_speech(out)
    if looks_like_speech_garbage(out):
        return ""
    return out


class TtsError(RuntimeError):
    """Raised when TTS engine cannot be initialized or used."""


def _init_engine():
    try:
        import pyttsx3
    except ImportError as exc:
        raise TtsError(
            "pyttsx3 is not installed. Run: pip install pyttsx3"
        ) from exc

    try:
        engine = pyttsx3.init()
    except Exception as exc:  # noqa: BLE001
        hint = ""
        if sys.platform != "win32":
            hint = (
                "\nNote: On Linux, pyttsx3 needs espeak/espeak-ng. "
                "This project targets Windows SAPI5; full TTS is verified there."
            )
        raise TtsError(f"Could not initialize TTS engine: {exc}{hint}") from exc
    return engine


def list_voices() -> list[dict[str, Any]]:
    """Return voice metadata: id, name, languages (best-effort)."""
    if sys.platform == "win32":
        try:
            return _list_voices_sapi()
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: SAPI voice list failed ({exc}); trying pyttsx3", file=sys.stderr)

    engine = _init_engine()
    voices = []
    for v in engine.getProperty("voices") or []:
        langs = getattr(v, "languages", None) or []
        lang_strs: list[str] = []
        for lang in langs:
            if isinstance(lang, bytes):
                try:
                    lang_strs.append(lang.decode("utf-8", errors="replace"))
                except Exception:  # noqa: BLE001
                    lang_strs.append(repr(lang))
            else:
                lang_strs.append(str(lang))
        voices.append(
            {
                "id": getattr(v, "id", ""),
                "name": getattr(v, "name", ""),
                "languages": lang_strs,
            }
        )
    try:
        engine.stop()
    except Exception:  # noqa: BLE001
        pass
    return voices


def _list_voices_sapi() -> list[dict[str, Any]]:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        voice = win32com.client.Dispatch("SAPI.SpVoice")
        tokens = voice.GetVoices()
        out: list[dict[str, Any]] = []
        for i in range(int(tokens.Count)):
            tok = tokens.Item(i)
            try:
                desc = str(tok.GetDescription())
            except Exception:  # noqa: BLE001
                desc = f"Voice {i}"
            try:
                vid = str(tok.Id)
            except Exception:  # noqa: BLE001
                vid = desc

            # SAPI stores the primary language as an LCID under the token's
            # "Language" attribute (e.g. 0x040C for Finnish, 0x0409 for en-US).
            # Convert to a BCP-47-ish tag via locale.windows_locale.
            langs: list[str] = []
            try:
                raw = tok.GetAttribute("Language")
                if raw:
                    if isinstance(raw, str):
                        lcid = int(raw, 16)
                    else:
                        lcid = int(raw)
                    import locale
                    tag = locale.windows_locale.get(lcid)
                    langs.append(tag.replace("_", "-") if tag else f"0x{lcid:04X}")
            except Exception:  # noqa: BLE001
                pass

            out.append({"id": vid, "name": desc, "languages": langs})
        return out
    finally:
        # Explicitly drop every COM reference *before* CoUninitialize, or
        # win32com prints "Win32 exception occurred releasing IUnknown at
        # 0x..." on interpreter shutdown. The loop variable 'tok' is the
        # sneaky one — Python keeps it alive after the for-loop ends.
        tok = None
        tokens = None
        voice = None
        try:
            import gc as _gc
            _gc.collect()
        except Exception:  # noqa: BLE001
            pass
        try:
            pythoncom.CoUninitialize()
        except Exception:  # noqa: BLE001
            pass

def print_voices() -> None:
    """Print available voices to stdout."""
    voices = list_voices()
    if not voices:
        print("No voices found.")
        return
    for i, v in enumerate(voices):
        langs = ", ".join(v["languages"]) if v["languages"] else "(unknown)"
        print(f"[{i}] {v['name']}")
        #print(f"     id: {v['id']}")
        print(f"     languages: {langs}")

_LANG_VOICE_NEEDLES = {
    "fin": ("finnish", "suomi", "fin", "fi-fi", "fi_fi", "helsinki"),
    "eng": ("english", "en-us", "en_us", "en-gb", "en_gb", "en-"),
    "swe": ("swedish", "svenska", "swe", "sv-se", "sv_se"),
    "deu": ("german", "deutsch", "de-de", "de_de"),
    "fra": ("french", "français", "fr-fr", "fr_fr"),
}


def _prefer_voice_for_lang(
    voices: list[dict[str, Any]], lang_hint: str
) -> str | None:
    """Pick the first installed voice whose metadata matches ``lang_hint``.

    ``lang_hint`` may be ``"fin"``, ``"fin+eng"``, ``"eng"``, etc. — the
    first token that has a known needle list wins.
    """
    if not voices or not lang_hint:
        return None
    tokens = [t.strip().lower() for t in lang_hint.replace("+", ",").split(",")]
    for tok in tokens:
        needles = _LANG_VOICE_NEEDLES.get(tok)
        if not needles:
            continue
        for v in voices:
            hay = (
                f"{v.get('name', '')} "
                f"{' '.join(v.get('languages') or [])} "
                f"{v.get('id', '')}"
            ).lower()
            if any(n in hay for n in needles):
                return v["id"]
    return None

def prefer_finnish_voice_id(voices: list[dict[str, Any]]) -> str | None:
    """Pick a Finnish-sounding voice id if one exists."""
    needles = ("finnish", "suomi", "fin", "fi-fi", "fi_fi", "helsinki")
    for v in voices:
        hay = f"{v.get('name', '')} {' '.join(v.get('languages') or [])} {v.get('id', '')}".lower()
        if any(n in hay for n in needles):
            return v["id"]
    return None

def select_voice_id(
    voice_filter: str | None,
    *,
    lang_hint: str | None = None,
) -> str | None:
    """
    Resolve a voice id from an optional substring filter.

    If filter is None/empty:
      - if lang_hint is given, prefer a voice matching that language;
      - otherwise fall back to the historical "prefer Finnish" behavior.
    """
    voices = list_voices()
    if not voices:
        return None

    if voice_filter:
        needle = voice_filter.lower().strip()
        for v in voices:
            hay = f"{v.get('name', '')} {v.get('id', '')}".lower()
            if needle in hay:
                return v["id"]
        raise TtsError(
            f"No voice matched --voice '{voice_filter}'. "
            "Use --list-voices to see options."
        )

    if lang_hint:
        picked = _prefer_voice_for_lang(voices, lang_hint)
        if picked:
            return picked

    return prefer_finnish_voice_id(voices)

def voice_display_name(
    voice_id: str | None,
    voice_filter: str | None = None,
    *,
    voices: list[dict[str, Any]] | None = None,
) -> str:
    """Best-effort human-readable name for a resolved voice id / filter."""
    if voice_id:
        try:
            catalog = voices if voices is not None else list_voices()
        except Exception:  # noqa: BLE001
            catalog = []
        needle = voice_id.lower()
        for v in catalog:
            vid = str(v.get("id", ""))
            name = str(v.get("name", "") or vid)
            if vid == voice_id or needle == vid.lower() or needle in vid.lower():
                return name
            if needle and needle in name.lower():
                return name
        return voice_id
    if voice_filter:
        return str(voice_filter)
    return "(default)"


def _match_sapi_token(tokens: Any, voice_id: str | None, voice_filter: str | None) -> Any:
    """Pick a SAPI voice token matching id and/or filter substring."""
    needle = (voice_filter or voice_id or "").lower()
    if not needle and not voice_id:
        return None
    for i in range(int(tokens.Count)):
        tok = tokens.Item(i)
        try:
            hay = f"{tok.Id} {tok.GetDescription()}".lower()
        except Exception:  # noqa: BLE001
            continue
        if voice_id:
            vid = voice_id.lower()
            if vid in hay or hay in vid:
                return tok
        if needle and needle in hay:
            return tok
    return None


# SAPI Speak flags
_SVSFDefault = 0
_SVSFlagsAsync = 1
_SVSFPurgeBeforeSpeak = 2


class Speaker:
    """
    Thread-safe TTS.

    On Windows, a dedicated worker thread owns SAPI SpVoice (pyttsx3 is not
    reliable across threads with a Tk mainloop). Elsewhere, pyttsx3 is used
    on a dedicated thread as well.
    """

    def __init__(
        self,
        *,
        voice: str | None = None,
        rate: int | None = None,
        lang: str | None = None,
    ) -> None:
        self._voice_filter = voice
        self._rate = rate
        self._voice_lang = lang
        # Resolve voice on the caller thread before COM worker starts
        self._voice_id = select_voice_id(voice, lang_hint=lang)
        self._stopped = False
        self._cmd_q: queue.Queue[tuple[str, Any] | None] = queue.Queue()
        self._ready = threading.Event()
        self._init_error: str | None = None
        self._thread = threading.Thread(
            target=self._worker, name="ocr-tts", daemon=True
        )
        self._thread.start()
        if not self._ready.wait(timeout=15.0):
            raise TtsError("TTS worker failed to start in time")
        if self._init_error:
            raise TtsError(self._init_error)

    def _worker(self) -> None:
        try:
            if sys.platform == "win32":
                self._worker_sapi()
            else:
                self._worker_pyttsx3()
        except Exception as exc:  # noqa: BLE001
            self._init_error = f"TTS worker crashed: {exc}"
            self._ready.set()

    def _worker_sapi(self) -> None:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        try:
            voice = win32com.client.Dispatch("SAPI.SpVoice")
            if self._voice_id or self._voice_filter:
                try:
                    tokens = voice.GetVoices()
                    chosen = _match_sapi_token(tokens, self._voice_id, self._voice_filter)
                    if chosen is not None:
                        voice.Voice = chosen
                except Exception as exc:  # noqa: BLE001
                    print(f"Warning: could not set SAPI voice: {exc}", file=sys.stderr)

            if self._rate is not None:
                # Map pyttsx3-ish rate (~150–200) to SAPI Rate (-10..10)
                try:
                    r = int(self._rate)
                    if r > 20:  # treat as pyttsx3 words-per-minute style
                        sapi_rate = max(-10, min(10, int((r - 150) / 10)))
                    else:
                        sapi_rate = max(-10, min(10, r))
                    voice.Rate = sapi_rate
                except Exception as exc:  # noqa: BLE001
                    print(f"Warning: could not set SAPI rate: {exc}", file=sys.stderr)

            self._ready.set()

            while True:
                item = self._cmd_q.get()
                if item is None:
                    break
                cmd, payload = item
                if cmd == "speak":
                    text, done_event = payload
                    self._stopped = False
                    try:
                        # Async speak; WaitUntilDone is the reliable completion signal.
                        # Speak returns a stream number, not an HRESULT.
                        voice.Speak(_escape_for_sapi(text), _SVSFlagsAsync)
                        while True:
                            if self._stopped:
                                try:
                                    voice.Speak(
                                        "",
                                        _SVSFPurgeBeforeSpeak | _SVSFlagsAsync,
                                    )
                                except Exception:  # noqa: BLE001
                                    pass
                                break
                            # WaitUntilDone(ms) -> True when utterance finished
                            try:
                                done_now = bool(voice.WaitUntilDone(20))
                            except Exception:  # noqa: BLE001
                                # Fallback: short sleep + RunningState
                                pythoncom.PumpWaitingMessages()
                                time.sleep(0.05)
                                try:
                                    done_now = int(voice.Status.RunningState) != 2
                                except Exception:  # noqa: BLE001
                                    done_now = True
                            if done_now:
                                break
                            pythoncom.PumpWaitingMessages()
                    except Exception as exc:  # noqa: BLE001
                        print(f"Warning: SAPI speak failed: {exc}", file=sys.stderr)
                    finally:
                        done_event.set()
                elif cmd == "stop":
                    self._stopped = True
                    try:
                        voice.Speak("", _SVSFPurgeBeforeSpeak | _SVSFlagsAsync)
                    except Exception:  # noqa: BLE001
                        pass
                elif cmd == "set_voice":
                    voice_id_or_filter = payload
                    try:
                        tokens = voice.GetVoices()
                        chosen = _match_sapi_token(
                            tokens,
                            str(voice_id_or_filter) if voice_id_or_filter else None,
                            str(voice_id_or_filter) if voice_id_or_filter else None,
                        )
                        if chosen is not None:
                            voice.Voice = chosen
                    except Exception as exc:  # noqa: BLE001
                        print(f"Warning: could not set SAPI voice: {exc}", file=sys.stderr)
        finally:
            try:
                pythoncom.CoUninitialize()
            except Exception:  # noqa: BLE001
                pass

    def _worker_pyttsx3(self) -> None:
        try:
            engine = _init_engine()
        except TtsError as exc:
            self._init_error = str(exc)
            self._ready.set()
            return

        voice_id = self._voice_id
        if voice_id:
            try:
                engine.setProperty("voice", voice_id)
            except Exception as exc:  # noqa: BLE001
                print(f"Warning: could not set voice: {exc}", file=sys.stderr)
        if self._rate is not None:
            try:
                engine.setProperty("rate", int(self._rate))
            except Exception as exc:  # noqa: BLE001
                print(f"Warning: could not set rate: {exc}", file=sys.stderr)

        self._ready.set()
        while True:
            item = self._cmd_q.get()
            if item is None:
                break
            cmd, payload = item
            if cmd == "speak":
                text, done_event = payload
                self._stopped = False
                try:
                    engine.say(text)
                    engine.runAndWait()
                except Exception as exc:  # noqa: BLE001
                    print(f"Warning: TTS speak failed: {exc}", file=sys.stderr)
                finally:
                    done_event.set()
            elif cmd == "stop":
                self._stopped = True
                try:
                    engine.stop()
                except Exception:  # noqa: BLE001
                    pass
            elif cmd == "set_voice":
                voice_id_or_filter = payload
                if voice_id_or_filter:
                    try:
                        engine.setProperty("voice", str(voice_id_or_filter))
                    except Exception as exc:  # noqa: BLE001
                        print(f"Warning: could not set voice: {exc}", file=sys.stderr)

    def speak(self, text: str) -> None:
        """Speak text (blocking until finished or stop())."""
        text = normalize_for_speech(text or "")
        if not text:
            return
        done = threading.Event()
        self._cmd_q.put(("speak", (text, done)))
        # Wait until utterance finishes (or stop interrupts worker)
        while not done.wait(timeout=0.2):
            if self._stopped:
                # still wait briefly for worker to clear
                done.wait(timeout=1.0)
                break

    def speak_chunks(
        self,
        chunks: Sequence[str],
        on_start: Callable[[str, int], None] | None = None,
    ) -> None:
        """Speak each non-empty chunk sequentially."""
        self._stopped = False
        for i, raw in enumerate(chunks):
            if self._stopped:
                break
            text = (raw or "").strip()
            if not text:
                continue
            if on_start is not None:
                try:
                    on_start(text, i)
                except Exception as exc:  # noqa: BLE001
                    print(f"Warning: on_start callback failed: {exc}", file=sys.stderr)
            if self._stopped:
                break
            self.speak(text)
            if self._stopped:
                break

    def set_voice(self, voice_filter: str | None) -> str:
        """
        Resolve and apply a voice at runtime (COM-safe via worker queue).

        ``voice_filter`` may be a substring of the voice name/id, or None to
        prefer Finnish when available. Returns the chosen display name.
        """
        voice_id = select_voice_id(voice_filter)
        self._voice_filter = voice_filter
        self._voice_id = voice_id
        payload = voice_id or voice_filter
        # Purge any in-flight utterance, then apply voice on the TTS thread.
        try:
            self._cmd_q.put(("stop", None))
            self._cmd_q.put(("set_voice", payload))
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not queue set_voice: {exc}", file=sys.stderr)
        # Clear stop flag so the next Speak is not aborted by the purge above.
        self._stopped = False
        return self.current_voice_name()

    def current_voice_name(self) -> str:
        """Best-effort display name for the currently selected voice."""
        return voice_display_name(self._voice_id, self._voice_filter)

    def stop(self) -> None:
        """Stop current speech."""
        self._stopped = True
        # Flag is checked inside the speak wait loop; also queue a purge.
        try:
            self._cmd_q.put_nowait(("stop", None))
        except Exception:  # noqa: BLE001
            pass

    def close(self) -> None:
        """Shut down the TTS worker thread."""
        try:
            self.stop()
        except Exception:  # noqa: BLE001
            pass
        self._cmd_q.put(None)

    @property
    def stopped(self) -> bool:
        return self._stopped
