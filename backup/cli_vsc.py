"""Command-line interface for OCR Read Aloud."""

from __future__ import annotations

import argparse
import queue
import sys
import threading
from pathlib import Path

from ocr_read_aloud import __version__
from ocr_read_aloud.io_util import proof_cache_path, text_output_path
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
    ProofreadCancelled,
    ProofreadError,
    clear_proofread_cancel,
    proofread_one_page,
    set_proofread_cancel,
    warn_and_continue,
)
from ocr_read_aloud.tts import TtsError, Speaker, print_voices


def assert_requested_start_page(label: str | None, requested: int) -> None:
    """Assert the first loaded page matches the requested PDF folio for partial sessions."""
    if requested <= 1:
        return
    if label is None:
        raise AssertionError(f"Requested start page {requested}, but first loaded page had no label.")
    if "page " not in label.lower():
        return
    actual = pdf_page_number_from_label(label)
    if actual is None:
        raise AssertionError(
            f"Requested start page {requested}, but first loaded page label was {label!r}."
        )
    if actual != requested:
        raise AssertionError(
            f"Requested start page {requested}, but first loaded page was {label!r} "
            f"(folio {actual})."
        )


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
        "--proofread",
        action="store_true",
        help=(
            "Lightly proofread OCR text via local Ollama (interleaved per page; "
            "requires `ollama serve`; no cloud API key)"
        ),
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
        "--ignore-cache",
        "--no-cache",
        dest="no_cache",
        action="store_true",
        help=(
            "Do not read or write the auto proofread cache file ({stem}.txt) "
            "beside the source"
        ),
    )
    p.add_argument(
        "--prefer-pdf-text",
        action="store_true",
        help="Prefer embedded PDF text when available; keep OCR as a backup source",
    )
    p.add_argument(
        "--pdf-text-only",
        action="store_true",
        help="Use embedded PDF text only when present; otherwise fall back to OCR",
    )
    p.add_argument(
        "--debug-merge",
        action="store_true",
        help="Print PDF-vs-OCR merge differences for comparison while reading",
    )
    p.add_argument(
        "--debug-merge-alts",
        action="store_true",
        help="When using --debug-merge, also print both source alternatives for changed words",
    )
    p.add_argument(
        "--no-ad-skip",
        "--disable-ad-detection",
        dest="no_ad_skip",
        action="store_true",
        help="Disable automatic ad/ad-continue detection and skip logic; read only the selected folio range.",
    )
    p.add_argument(
        "--ocr-only",
        "--force-ocr",
        dest="force_ocr",
        action="store_true",
        help="Ignore embedded PDF text and OCR each rendered page image instead",
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
    print(f"\n=== {label} ===")
    print(text if text else "(no text recognized)")


def _apply_text_to_page_unit(page, new_text: str) -> None:
    """Mutate a PageUnit's lines to a single full-page OcrLine from proof text."""
    from ocr_read_aloud.ocr import OcrLine
    from ocr_read_aloud.player import _normalize_cached_or_proof_text

    new_text = _normalize_cached_or_proof_text(new_text)
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
    cache = proof_cache_path(path)
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


def _apply_cache_to_page(page, sections: dict[str, str]) -> bool:
    """If cache has text for page.label, replace lines and return True."""
    if not sections:
        return False
    cached = lookup_cached_text(sections, page.label)
    if cached is None or not str(cached).strip():
        return False
    _apply_text_to_page_unit(page, cached)
    return True


def _start_proof_worker(
    *,
    model: str,
    host: str,
    controller_holder: list,
    pages_holder: list | None = None,
    early_proofed: set | None = None,
    on_applied=None,
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
                fixed = proofread_one_page(
                    raw,
                    model=model,
                    host=host,
                    on_progress=on_progress,
                    page_index=int(folio),
                    page_count=None,
                )
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
    do_proof = bool(args.proofread)
    use_cache = not bool(getattr(args, "no_cache", False))
    cache_sections = _load_proof_cache_sections(path, enabled=use_cache)
    cache_path = proof_cache_path(path) if use_cache else None

    proof_q = None
    proof_thread = None
    early_proofed: set[int] = set()
    if do_proof:
        clear_proofread_cancel()
        proof_q, proof_thread = _start_proof_worker(
            model=args.ollama_model,
            host=args.ollama_host,
            controller_holder=controller_holder,
            pages_holder=pages,
            early_proofed=early_proofed,
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
                force_ocr=bool(args.force_ocr),
                prefer_pdf_text=not bool(args.force_ocr) and not bool(getattr(args, "pdf_text_only", False)),
                pdf_text_only=bool(getattr(args, "pdf_text_only", False)),
                show_debug_merge=bool(getattr(args, "debug_merge", False)),
                show_debug_merge_alternatives=bool(getattr(args, "debug_merge_alts", False)),
            ):
                if stop_loader.is_set():
                    break
                text = _page_raw_text(lines)
                _print_page(label, text)
                page = PageUnit(label=label, image=image, lines=list(lines))
                from_cache = _apply_cache_to_page(page, cache_sections)
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
    assert_requested_start_page(page0.label, args.start_page)
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
            preview.show_message("Preparing…")

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
        start_page=args.start_page,
    )
    controller._auto_continue = bool(args.start_page <= 1)
    controller._auto_ad_skip = not bool(args.no_ad_skip)
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
    do_proof = bool(args.proofread)
    use_cache = not bool(getattr(args, "no_cache", False))
    cache_sections = _load_proof_cache_sections(path, enabled=use_cache)
    cache_path = proof_cache_path(path) if use_cache else None
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
        )

    try:
        for label, image, lines in iter_ocr_pages(
            path,
            lang=lang,
            start_page=args.start_page,
            end_page=args.end_page,
            dpi=args.dpi,
            force_ocr=args.force_ocr,
            show_debug_merge=bool(getattr(args, "debug_merge", False)),
            show_debug_merge_alternatives=bool(getattr(args, "debug_merge_alts", False)),
        ):
            text = _page_raw_text(lines)
            _print_page(label, text)
            page = PageUnit(label=label, image=image, lines=list(lines))
            from_cache = _apply_cache_to_page(page, cache_sections)
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
        print("Error: --start-page must be >= 1", file=sys.stderr)
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

    if args.save_text:
        out = save_default
        try:
            out.write_text("\n".join(collected).strip() + "\n", encoding="utf-8")
            print(f"\nSaved text to: {out}")
        except OSError as exc:
            print(f"Error writing text file: {exc}", file=sys.stderr)
            return 1

    return 0


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    raise SystemExit(run(args))


if __name__ == "__main__":
    main()
