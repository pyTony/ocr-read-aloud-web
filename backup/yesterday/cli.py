"""Command-line interface for OCR Read Aloud."""

from __future__ import annotations

import argparse
import queue
import sys
import threading
from pathlib import Path

from ocr_read_aloud import __version__
from ocr_read_aloud.io_util import (
    corrections_path,
    proof_cache_path,
    proofed_cache_path,
    text_output_path,
)
from ocr_read_aloud.continue_links import pdf_page_number_from_label
from ocr_read_aloud.proof_cache import lookup_cached_text, parse_proof_cache
from ocr_read_aloud.ocr import (
    OcrError,
    iter_ocr_pages,
    list_tesseract_langs,
    normalize_lang,
)
from ocr_read_aloud.pdf_pages import DEFAULT_DPI
from ocr_read_aloud.proofread import (
    DEFAULT_OLLAMA_HOST,
    DEFAULT_OLLAMA_MODEL,
    DEFAULT_OLLAMA_VISION_MODEL,
    ProofreadCancelled,
    ProofreadError,
    clear_proofread_cancel,
    proofread_one_page,
    set_proofread_cancel,
    warn_and_continue,
    ollama_available,
    ollama_vision_ocr,
)
from ocr_read_aloud.tts import TtsError, Speaker, print_voices


def _load_user_corrections(source: Path) -> list[tuple[str, str]]:
    """Load durable ``wrong<TAB>right`` replacements from the corrections dir."""
    path = corrections_path(source) / "replacements.txt"
    if not path.is_file():
        return []
    out: list[tuple[str, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "\t" not in line:
            continue
        wrong, right = line.split("\t", 1)
        if wrong:
            out.append((wrong, right))
    return out


def _apply_user_corrections(text: str, corrections: list[tuple[str, str]]) -> str:
    for wrong, right in corrections:
        text = text.replace(wrong, right)
    return text


def _vision_hint_for_page(page, *, model: str, host: str) -> str:
    """Transcribe suspicious OCR line groups with a local vision model."""
    lines = list(getattr(page, "lines", []) or [])
    image = getattr(page, "image", None)
    if not lines or image is None:
        return ""
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
        raw = "\n".join(line.text for line in group)
        try:
            hints.append(
                ollama_vision_ocr(
                    image.crop((left, top, right, bottom)),
                    raw,
                    model=model,
                    host=host,
                )
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  (Vision OCR skipped: {exc})", flush=True)
    return "\n\n".join(hints)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="ocr-read-aloud",
        description=(
            "OCR scanned PDFs and images, then read the text aloud "
            "(local Tesseract + Windows SAPI5 via pyttsx3)."
        ),
    )
    p.add_argument(
        "path",
        nargs="?",
        type=Path,
        help="PDF, image file, or folder of images",
    )
    p.add_argument(
        "--lang",
        default="fin+eng",
        help="OCR language: fin, eng, or fin+eng (default: fin+eng)",
    )
    p.add_argument(
        "--voice",
        default=None,
        help="TTS voice name/id substring filter (prefer Finnish if omitted)",
    )
    p.add_argument(
        "--rate",
        type=int,
        default=None,
        help="TTS speech rate (pyttsx3 units; typical ~150–200)",
    )
    p.add_argument(
        "--list-voices",
        action="store_true",
        help="List available TTS voices and exit",
    )
    p.add_argument(
        "--list-langs",
        action="store_true",
        help="List installed Tesseract OCR languages and exit",
    )
    p.add_argument(
        "--no-speak",
        action="store_true",
        help="OCR only — do not speak",
    )
    p.add_argument(
        "--preview",
        dest="preview",
        action="store_true",
        default=None,
        help="Show reading preview/player window while speaking (default on Windows)",
    )
    p.add_argument(
        "--no-preview",
        dest="preview",
        action="store_false",
        help="Disable the reading preview window",
    )
    p.add_argument(
        "--save-text",
        action="store_true",
        help="Write OCR text to a .txt file beside the source",
    )
    p.add_argument(
        "--save-pdf",
        nargs="?",
        const="",
        metavar="PATH",
        help="Save the loaded document as a searchable image PDF (optional output path)",
    )
    p.add_argument(
        "--save-article-pdf",
        nargs="?",
        const="",
        metavar="PATH",
        help="Save the current article as a searchable image PDF (optional output path)",
    )
    p.add_argument(
        "--proofread",
        action="store_true",
        help=(
            "Lightly proofread OCR text via local Ollama (interleaved per page; "
            "requires `ollama serve`; no cloud API key)"
        ),
    )
    p.add_argument(
        "--no-proofread",
        action="store_true",
        help="Disable automatic Ollama proofreading when the local service is available",
    )
    p.add_argument(
        "--ollama-model",
        default=DEFAULT_OLLAMA_MODEL,
        metavar="NAME",
        help=f"Ollama model for --proofread (default: {DEFAULT_OLLAMA_MODEL})",
    )
    p.add_argument(
        "--ollama-host",
        default=DEFAULT_OLLAMA_HOST,
        metavar="URL",
        help=f"Ollama HTTP API base URL (default: {DEFAULT_OLLAMA_HOST})",
    )
    p.add_argument(
        "--ollama-vision-model",
        default=DEFAULT_OLLAMA_VISION_MODEL,
        metavar="NAME",
        help=f"Vision model for difficult OCR crops (default: {DEFAULT_OLLAMA_VISION_MODEL})",
    )
    p.add_argument(
        "--no-cache",
        action="store_true",
        help=(
            "Do not read or write the auto proofread cache file ({stem}.txt) "
            "beside the source"
        ),
    )
    p.add_argument(
        "--regenerate-cache",
        dest="regenerate_cache",
        action="store_true",
        help=(
            "Ignore existing proofread cache entries, proofread pages with Ollama, "
            "and write fresh cache text"
        ),
    )
    p.add_argument(
        "--start-page",
        type=int,
        default=1,
        metavar="N",
        help="First page / image index (1-based, default 1)",
    )
    p.add_argument(
        "--end-page",
        type=int,
        default=None,
        metavar="N",
        help="Last page / image index (1-based, inclusive)",
    )
    ad_skip = p.add_mutually_exclusive_group()
    ad_skip.add_argument(
        "--skip-ad-pages",
        dest="skip_ad_pages",
        action="store_true",
        default=True,
        help="Skip ad/form pages inserted in the middle of an article (default)",
    )
    ad_skip.add_argument(
        "--no-skip-ad-pages",
        dest="skip_ad_pages",
        action="store_false",
        help="Read ad/form pages in the middle of an article",
    )
    p.add_argument(
        "--dpi",
        type=int,
        default=DEFAULT_DPI,
        help=f"PDF render DPI (default {DEFAULT_DPI})",
    )
    p.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    return p


def _want_preview(args: argparse.Namespace) -> bool:
    """Preview defaults on when speaking on Windows; off otherwise."""
    if args.no_speak:
        return False
    if args.preview is not None:
        return bool(args.preview)
    return sys.platform == "win32"


def _want_proofread(args: argparse.Namespace) -> bool:
    """Proofread by default when local Ollama is available."""
    if bool(getattr(args, "no_proofread", False)):
        return False
    if bool(getattr(args, "proofread", False)) or bool(
        getattr(args, "regenerate_cache", False)
    ):
        return True
    try:
        return ollama_available(args.ollama_host)
    except Exception:  # noqa: BLE001
        return False


def _page_raw_text(lines) -> str:
    return "\n".join(ln.text for ln in lines if ln.text).strip()


def _collect_blocks_from_pages(pages) -> list[str]:
    blocks: list[str] = []
    for page in pages:
        text = _page_raw_text(page.lines)
        blocks.append(
            f"=== {page.label} ===\n{text}\n" if text else f"=== {page.label} ===\n"
        )
    return blocks


def _print_page(label: str, text: str) -> None:
    del text
    print(f"OCR ready · {label}", flush=True)


def _apply_text_to_page_unit(page, new_text: str) -> None:
    """Mutate a PageUnit's lines to a single full-page OcrLine from proof text."""
    from ocr_read_aloud.ocr import OcrLine

    new_text = (new_text or "").strip()
    if not new_text:
        page.lines = []
        return
    try:
        w, h = page.image.size
        left, top, width, height = 0, 0, int(w), int(h)
    except Exception:  # noqa: BLE001
        left, top, width, height = 0, 0, 100, 40
    page.lines = [
        OcrLine(text=new_text, left=left, top=top, width=width, height=height)
    ]


def _load_proof_cache_sections(path: Path, *, enabled: bool) -> dict[str, str]:
    """Load ``{stem}.txt`` proof cache sections when present."""
    if not enabled:
        return {}
    cache = proofed_cache_path(path)
    if not cache.is_file():
        return {}
    try:
        sections = parse_proof_cache(cache.read_text(encoding="utf-8"))
        if sections:
            print(f"Loaded proof cache: {cache} ({len(sections)} page(s))", flush=True)
        return sections
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not read proof cache {cache}: {exc}", file=sys.stderr)
        return {}


def _apply_cache_to_page(
    page, sections: dict[str, str], corrections: list[tuple[str, str]] | None = None
) -> bool:
    """If cache has text for page.label, replace lines and return True."""
    if not sections:
        return False
    cached = lookup_cached_text(sections, page.label)
    if cached is None or not str(cached).strip():
        return False
    _apply_text_to_page_unit(page, _apply_user_corrections(cached, corrections or []))
    return True


def _write_page_cache(
    path: Path,
    pages: list,
    *,
    replace_existing: bool = False,
    proofed: bool = False,
) -> None:
    """Persist page text without replacing corrected cache entries with raw OCR."""
    from ocr_read_aloud.proof_cache import format_proof_cache

    cache = proofed_cache_path(path) if proofed else proof_cache_path(path)
    sections: dict[str, str] = {}
    if cache.is_file():
        try:
            sections.update(parse_proof_cache(cache.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            pass
    for page in pages:
        if replace_existing or page.label not in sections:
            sections[page.label] = _page_raw_text(page)
    if sections:
        cache.write_text(format_proof_cache(sections), encoding="utf-8")
        print(f"Wrote proof cache: {cache}", flush=True)


def _start_proof_worker(
    *,
    model: str,
    host: str,
    controller_holder: list,
    pages_holder: list | None = None,
    early_proofed: set | None = None,
    on_applied=None,
    corrections: list[tuple[str, str]] | None = None,
    vision_model: str = DEFAULT_OLLAMA_VISION_MODEL,
) -> tuple[queue.Queue, threading.Thread]:
    """
    Single-threaded proof queue: items are (idx, raw_text) or None to stop.

    When controller_holder[0] is a PlaybackController, applies via
    replace_one_page_text. Otherwise mutates pages_holder[idx].lines in place
    and records idx in early_proofed (same PageUnit object is later given to
    the controller).
    """
    proof_q: queue.Queue = queue.Queue()
    early = early_proofed if early_proofed is not None else set()

    def worker() -> None:
        while True:
            item = proof_q.get()
            if item is None:
                break
            idx, raw = item
            raw = (raw or "").strip()
            ctrl = controller_holder[0] if controller_holder else None

            def on_progress(msg: str, _ctrl=ctrl) -> None:
                print(f"  ({msg})", flush=True)
                c = controller_holder[0] if controller_holder else _ctrl
                if c is not None:
                    try:
                        c._status(msg)  # noqa: SLF001
                    except Exception:  # noqa: BLE001
                        pass

            if not raw:
                ctrl = controller_holder[0] if controller_holder else None
                if ctrl is not None:
                    ctrl.mark_page_proofed(idx)
                else:
                    early.add(idx)
                continue
            try:
                folio = idx + 1
                if pages_holder is not None and 0 <= idx < len(pages_holder):
                    folio = pdf_page_number_from_label(pages_holder[idx].label) or folio
                visual_hint = ""
                if pages_holder is not None and 0 <= idx < len(pages_holder):
                    visual_hint = _vision_hint_for_page(
                        pages_holder[idx], model=vision_model, host=host
                    )
                fixed = proofread_one_page(
                    raw,
                    model=model,
                    host=host,
                    on_progress=on_progress,
                    page_index=int(folio),
                    page_count=None,
                    visual_hint=visual_hint,
                )
                fixed = _apply_user_corrections(fixed, corrections or [])
            except ProofreadCancelled:
                print("Proofread cancelled", flush=True)
                while True:
                    try:
                        leftover = proof_q.get_nowait()
                    except queue.Empty:
                        break
                    if leftover is None:
                        break
                break
            except ProofreadError as exc:
                warn_and_continue(
                    f"Proofread failed on page {folio}: {exc}. Keeping raw OCR."
                )
                ctrl = controller_holder[0] if controller_holder else None
                if ctrl is not None:
                    ctrl.mark_page_proofed(idx)
                else:
                    early.add(idx)
                continue
            except Exception as exc:  # noqa: BLE001
                warn_and_continue(
                    f"Proofread error on page {folio}: {exc}. Keeping raw OCR."
                )
                ctrl = controller_holder[0] if controller_holder else None
                if ctrl is not None:
                    ctrl.mark_page_proofed(idx)
                else:
                    early.add(idx)
                continue

            ctrl = controller_holder[0] if controller_holder else None
            if ctrl is not None:
                ctrl.replace_one_page_text(idx, fixed, mark_proofed=True)
            else:
                if pages_holder is not None and 0 <= idx < len(pages_holder):
                    _apply_text_to_page_unit(pages_holder[idx], fixed)
                early.add(idx)
            print(f"  (Proof applied · page {folio})", flush=True)
            if on_applied is not None:
                try:
                    on_applied(idx, fixed)
                except Exception:  # noqa: BLE001
                    pass

    t = threading.Thread(target=worker, name="ocr-proof", daemon=True)
    t.start()
    return proof_q, t


def _run_speak_interleaved(
    *,
    path: Path,
    lang: str,
    args: argparse.Namespace,
    speaker: Speaker,
    use_preview: bool,
    save_default: Path,
) -> tuple[list, object | None, int]:
    """
    OCR + optional interleaved proofread; open player after first page.

    Returns (pages_list, preview_or_None, exit_code).
    """
    from ocr_read_aloud.player import PageUnit, PlaybackController

    ready: queue.Queue = queue.Queue()
    controller_holder: list = [None]
    pages: list[PageUnit] = []
    pages_lock = threading.Lock()
    regenerate_cache = bool(getattr(args, "regenerate_cache", False))
    do_proof = _want_proofread(args)
    use_cache = not bool(getattr(args, "no_cache", False))
    corrections = _load_user_corrections(path)
    cache_sections = _load_proof_cache_sections(
        path, enabled=use_cache and not regenerate_cache
    )
    cache_path = proofed_cache_path(path) if use_cache and do_proof else (
        proof_cache_path(path) if use_cache else None
    )

    proof_q = None
    proof_thread = None
    early_proofed: set[int] = set()
    first_proof_ready = threading.Event()

    def on_proof_applied(index: int, _text: str) -> None:
        if index == 0:
            first_proof_ready.set()

    if do_proof:
        clear_proofread_cancel()
        proof_q, proof_thread = _start_proof_worker(
            model=args.ollama_model,
            host=args.ollama_host,
            controller_holder=controller_holder,
            pages_holder=pages,
            early_proofed=early_proofed,
            on_applied=on_proof_applied,
            corrections=corrections,
            vision_model=args.ollama_vision_model,
        )

    stop_loader = threading.Event()

    def loader() -> None:
        try:
            for label, image, lines in iter_ocr_pages(
                path,
                lang=lang,
                start_page=args.start_page,
                end_page=args.end_page,
                dpi=args.dpi,
            ):
                if stop_loader.is_set():
                    break
                text = _page_raw_text(lines)
                if proof_q is None:
                    _print_page(label, text)
                else:
                    print(f"\n=== {label} ===\n(queued for proofreading)", flush=True)
                page = PageUnit(label=label, image=image, lines=list(lines))
                from_cache = _apply_cache_to_page(page, cache_sections, corrections)
                with pages_lock:
                    pages.append(page)
                    idx = len(pages) - 1
                if idx == 0:
                    ready.put(("first", page))
                else:
                    ready.put(("append", page))
                if from_cache:
                    early_proofed.add(idx)
                    print(f"  (Cache hit · {label})", flush=True)
                elif proof_q is not None:
                    proof_q.put((idx, text))
            ready.put(("done", None))
        except BaseException as exc:  # noqa: BLE001
            ready.put(("error", exc))

    loader_thread = threading.Thread(target=loader, name="ocr-loader", daemon=True)
    loader_thread.start()

    # Wait for first page (or error/done with nothing)
    try:
        cmd, payload = ready.get(timeout=600)
    except queue.Empty:
        print("Error: timed out waiting for first OCR page.", file=sys.stderr)
        stop_loader.set()
        return pages, None, 1

    if cmd == "error":
        raise payload
    if cmd == "done":
        print("No pages to speak.")
        if proof_q is not None:
            proof_q.put(None)
            if proof_thread:
                proof_thread.join(timeout=5.0)
        return pages, None, 0
    if cmd != "first":
        print(f"Error: unexpected loader event {cmd!r}", file=sys.stderr)
        return pages, None, 1

    page0 = payload
    preview = None
    if use_preview:
        from ocr_read_aloud.preview import create_preview

        print("\nOpening player window…")
        preview = create_preview(
            enabled=True,
            title="Reading…",
            run_ui_on_main=True,
        )
        if preview is None or not preview.enabled:
            print(
                "WARNING: Could not open reading preview window — "
                "speaking without UI.",
                file=sys.stderr,
            )
            preview = None
        else:
            preview.show_message(
                "Proofreading first page…" if proof_q is not None else "Preparing…"
            )

    if proof_q is not None and 0 not in early_proofed:
        print("Waiting for proofread of first page before speaking…", flush=True)
        first_proof_ready.wait(timeout=300.0)

    print("\n[Speaking — use preview controls or media keys]")
    active_preview = preview if (preview and preview.enabled) else None
    controller = PlaybackController(
        [page0],
        speaker,
        preview=active_preview,
        on_status=lambda m: print(f"  ({m})"),
        default_save_path=save_default,
        proof_cache_path=cache_path,
        use_proof_cache=use_cache,
        source_path=path,
        skip_ad_pages=bool(getattr(args, "skip_ad_pages", True)),
    )
    controller.set_expect_more_pages(True)
    controller_holder[0] = controller
    # Pages proofed before the controller existed share the same PageUnit object;
    # just mark flags so proofread_done / Proof button state stay accurate.
    for i in list(early_proofed):
        controller.mark_page_proofed(i)

    if active_preview is not None:
        active_preview.set_controller(
            controller,
            ollama_model=args.ollama_model,
            ollama_host=args.ollama_host,
        )

    play_error: list[BaseException] = []
    exit_code = 0

    def _play() -> None:
        try:
            controller.run()
        except TtsError as exc:
            play_error.append(exc)
        except BaseException as exc:  # noqa: BLE001
            play_error.append(exc)
        finally:
            if active_preview is not None:
                active_preview.quit_mainloop()

    def pump_ready() -> None:
        """Drain loader events onto the controller (thread-safe append)."""
        while True:
            try:
                cmd2, payload2 = ready.get_nowait()
            except queue.Empty:
                break
            if cmd2 == "append":
                controller.append_page(payload2)
            elif cmd2 == "done":
                controller.set_expect_more_pages(False)
                if proof_q is not None:
                    proof_q.put(None)
            elif cmd2 == "error":
                controller.set_expect_more_pages(False)
                play_error.append(payload2)
                controller.stop()
                if active_preview is not None:
                    active_preview.quit_mainloop()
            elif cmd2 == "first":
                # Already consumed
                pass

    if active_preview is not None:
        play_worker = threading.Thread(target=_play, name="ocr-playback", daemon=True)
        play_worker.start()

        def _schedule_pump() -> None:
            pump_ready()
            if not play_worker.is_alive() and ready.empty():
                return
            root = getattr(active_preview, "_root", None)
            if root is not None:
                try:
                    root.after(50, _schedule_pump)
                    return
                except Exception:  # noqa: BLE001
                    pass

        started_pump = False
        root = getattr(active_preview, "_root", None)
        if root is not None:
            try:
                root.after(50, _schedule_pump)
                started_pump = True
            except Exception:  # noqa: BLE001
                started_pump = False

        if not started_pump:
            def pump_thread() -> None:
                while play_worker.is_alive() or not ready.empty():
                    pump_ready()
                    threading.Event().wait(0.05)
                pump_ready()

            threading.Thread(target=pump_thread, name="ocr-pump", daemon=True).start()

        try:
            active_preview.run_mainloop()
        except KeyboardInterrupt:
            print("\nInterrupted.")
            set_proofread_cancel(True)
            stop_loader.set()
            controller.stop()
            active_preview.quit_mainloop()
            exit_code = 130
        play_worker.join(timeout=15.0)
    else:
        # No preview: pump on a side thread, run() on main
        def pump_thread() -> None:
            while True:
                pump_ready()
                with pages_lock:
                    # Exit when loader done and queue empty and not expecting more
                    if not controller._expect_more_pages and ready.empty():  # noqa: SLF001
                        # Still need done event processed
                        pass
                if not loader_thread.is_alive() and ready.empty():
                    # Ensure done processed
                    pump_ready()
                    if not controller._expect_more_pages:  # noqa: SLF001
                        break
                threading.Event().wait(0.05)

        threading.Thread(target=pump_thread, name="ocr-pump", daemon=True).start()
        try:
            controller.run()
        except TtsError as exc:
            print(f"TTS error: {exc}", file=sys.stderr)
            exit_code = 1
        except KeyboardInterrupt:
            print("\nInterrupted.")
            set_proofread_cancel(True)
            stop_loader.set()
            controller.stop()
            exit_code = 130

    stop_loader.set()
    loader_thread.join(timeout=5.0)
    if proof_q is not None:
        try:
            proof_q.put_nowait(None)
        except Exception:  # noqa: BLE001
            pass
        if proof_thread:
            proof_thread.join(timeout=30.0)

    if play_error and exit_code == 0:
        err = play_error[0]
        if isinstance(err, TtsError):
            print(f"TTS error: {err}", file=sys.stderr)
            exit_code = 1
        elif isinstance(err, (OcrError, FileNotFoundError, NotADirectoryError, ValueError)):
            print(f"Error: {err}", file=sys.stderr)
            exit_code = 1
        else:
            raise err

    return pages, preview, exit_code


def _run_ocr_only_interleaved(
    *,
    path: Path,
    lang: str,
    args: argparse.Namespace,
) -> list:
    """OCR all pages; if --proofread, enqueue each page for background proof."""
    from ocr_read_aloud.player import PageUnit

    pages: list[PageUnit] = []
    regenerate_cache = bool(getattr(args, "regenerate_cache", False))
    do_proof = _want_proofread(args)
    use_cache = not bool(getattr(args, "no_cache", False))
    corrections = _load_user_corrections(path)
    cache_sections = _load_proof_cache_sections(
        path, enabled=use_cache and not regenerate_cache
    )
    cache_path = proofed_cache_path(path) if use_cache and do_proof else (
        proof_cache_path(path) if use_cache else None
    )
    controller_holder: list = [None]
    proof_q = None
    proof_thread = None
    if do_proof:
        clear_proofread_cancel()
        print("\n[Proofreading via Ollama (interleaved)…]", flush=True)
        proof_q, proof_thread = _start_proof_worker(
            model=args.ollama_model,
            host=args.ollama_host,
            controller_holder=controller_holder,
            pages_holder=pages,
            corrections=corrections,
            vision_model=args.ollama_vision_model,
        )

    try:
        for label, image, lines in iter_ocr_pages(
            path,
            lang=lang,
            start_page=args.start_page,
            end_page=args.end_page,
            dpi=args.dpi,
        ):
            text = _page_raw_text(lines)
            _print_page(label, text)
            page = PageUnit(label=label, image=image, lines=list(lines))
            from_cache = _apply_cache_to_page(page, cache_sections, corrections)
            pages.append(page)
            if from_cache:
                print(f"  (Cache hit · {label})", flush=True)
            elif proof_q is not None:
                proof_q.put((len(pages) - 1, text))
    except KeyboardInterrupt:
        set_proofread_cancel(True)
        print("\nInterrupted.")
        raise

    if proof_q is not None:
        proof_q.put(None)
        if proof_thread:
            proof_thread.join(timeout=600.0)
        print("\n--- After proofread ---")
        for page in pages:
            text = _page_raw_text(page.lines)
            _print_page(page.label, text)

    if use_cache and cache_path is not None and pages:
        try:
            from ocr_read_aloud.proof_cache import format_proof_cache, parse_proof_cache

            sections: dict[str, str] = {}
            if cache_path.is_file():
                try:
                    sections.update(parse_proof_cache(cache_path.read_text(encoding="utf-8")))
                except Exception:  # noqa: BLE001
                    pass
            sections.update(cache_sections)
            for page in pages:
                if regenerate_cache or page.label not in sections:
                    sections[page.label] = _page_raw_text(page.lines).strip()
            cache_path.write_text(format_proof_cache(sections), encoding="utf-8")
            print(f"Wrote proof cache: {cache_path}", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not write proof cache: {exc}", file=sys.stderr)

    return pages


def run(args: argparse.Namespace) -> int:
    if args.list_voices:
        try:
            print_voices()
        except TtsError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        return 0

    if args.list_langs:
        try:
            langs = list_tesseract_langs()
            print("Installed Tesseract languages:")
            for lang in langs:
                print(f"  {lang}")
        except OcrError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        return 0

    if args.path is None:
        print(
            "Error: path is required (unless using --list-voices / --list-langs).",
            file=sys.stderr,
        )
        return 2

    path = args.path.expanduser().resolve()
    lang = normalize_lang(args.lang)

    if args.start_page < 1:
        return 2
    if args.end_page is not None and args.end_page < args.start_page:
        print("Error: --end-page must be >= --start-page", file=sys.stderr)
        return 2

    speak = not args.no_speak
    use_preview = _want_preview(args)
    save_default = text_output_path(path)

    speaker: Speaker | None = None
    if speak:
        try:
            speaker = Speaker(voice=args.voice, rate=args.rate)
        except TtsError as exc:
            print(f"Error initializing TTS: {exc}", file=sys.stderr)
            print("Hint: use --no-speak to OCR without speech.", file=sys.stderr)
            return 1

    preview = None
    collected: list[str] = []
    try:
        if speaker:
            pages, preview, code = _run_speak_interleaved(
                path=path,
                lang=lang,
                args=args,
                speaker=speaker,
                use_preview=use_preview,
                save_default=save_default,
            )
            collected = _collect_blocks_from_pages(pages)
            if code != 0:
                if args.save_text and collected:
                    out = save_default
                    try:
                        out.write_text(
                            "\n".join(collected).strip() + "\n", encoding="utf-8"
                        )
                        print(f"\nSaved text to: {out}")
                    except OSError:
                        pass
                return code
        else:
            pages = _run_ocr_only_interleaved(path=path, lang=lang, args=args)
            collected = _collect_blocks_from_pages(pages)
    except (OcrError, FileNotFoundError, NotADirectoryError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nInterrupted.")
        set_proofread_cancel(True)
        if speaker:
            speaker.stop()
        return 130
    finally:
        if preview is not None:
            try:
                preview.close()
            except Exception:  # noqa: BLE001
                pass

    if not bool(getattr(args, "no_cache", False)) and pages:
        try:
            _write_page_cache(
                path,
                pages,
                replace_existing=bool(
                    getattr(args, "proofread", False)
                    or getattr(args, "regenerate_cache", False)
                ),
                proofed=_want_proofread(args),
            )
        except OSError as exc:
            print(f"Warning: could not write proof cache: {exc}", file=sys.stderr)

    if args.save_text:
        out = save_default
        try:
            out.write_text("\n".join(collected).strip() + "\n", encoding="utf-8")
            print(f"\nSaved text to: {out}")
        except OSError as exc:
            print(f"Error writing text file: {exc}", file=sys.stderr)
            return 1

    if args.save_pdf is not None or args.save_article_pdf is not None:
        from ocr_read_aloud.article_export import (
            article_page_indices,
            default_article_save_path,
            save_pages_pdf,
        )

        try:
            if args.save_pdf is not None:
                pdf_path = Path(args.save_pdf) if args.save_pdf else path.with_suffix(".ocr.pdf")
                save_pages_pdf(pdf_path, pages, range(len(pages)))
                print(f"Saved PDF to: {pdf_path}")
            if args.save_article_pdf is not None:
                current = 0
                indices = article_page_indices(pages, current)
                if not indices:
                    raise ValueError("No article pages available")
                default = default_article_save_path(path, pages, indices).with_suffix(".pdf")
                pdf_path = Path(args.save_article_pdf) if args.save_article_pdf else default
                save_pages_pdf(pdf_path, pages, indices)
                print(f"Saved article PDF to: {pdf_path}")
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"Error writing PDF: {exc}", file=sys.stderr)
            return 1

    return 0


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    raise SystemExit(run(args))


if __name__ == "__main__":
    main()
