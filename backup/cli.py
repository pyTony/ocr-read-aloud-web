"""Command-line interface for OCR Read Aloud."""

from __future__ import annotations

import argparse
import queue
import sys
import threading
from pathlib import Path

from ocr_read_aloud import __version__
from ocr_read_aloud.io_util import (
    corrections_path, proof_cache_path, proofed_cache_path, text_output_path,
)
from ocr_read_aloud.continue_links import compute_folio_offset
from ocr_read_aloud.proof_cache import lookup_cached_text, parse_proof_cache
from ocr_read_aloud.ocr import OcrError, iter_ocr_pages, list_tesseract_langs, normalize_lang
from ocr_read_aloud.pdf_pages import DEFAULT_DPI
from ocr_read_aloud.proofread import (
    DEFAULT_OLLAMA_HOST, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_VISION_MODEL,
    ProofreadCancelled, ProofreadError, clear_proofread_cancel, proofread_one_page,
    set_proofread_cancel, warn_and_continue, ollama_available, ollama_vision_ocr,
)
from ocr_read_aloud.tts import TtsError, Speaker, print_voices

# ... (Keep all helper functions like _load_user_corrections, _apply_user_corrections,
#      _vision_hint_for_page, build_parser, _want_preview, _want_proofread, etc.
#      exactly as they are in your original file, but make sure they are correct) ...

def _run_speak_interleaved(
    *, path, lang, args, speaker, use_preview, save_default
) -> tuple[list, object | None, int]:
    """OCR + optional interleaved proofread; open player after first page."""
    from ocr_read_aloud.player import PageUnit, PlaybackController

    ready: queue.Queue = queue.Queue()
    controller_holder: list = [None]
    pages: list[PageUnit] = []
    pages_lock = threading.Lock()
    regenerate_cache = bool(getattr(args, "regenerate_cache", False))
    do_proof = _want_proofread(args)
    use_cache = not bool(getattr(args, "no_cache", False))
    corrections = _load_user_corrections(path)
    cache_sections = _load_proof_cache_sections(path, enabled=use_cache and not regenerate_cache)
    cache_path = proofed_cache_path(path) if use_cache and do_proof else (
        proof_cache_path(path) if use_cache else None
    )
    if regenerate_cache and cache_path and cache_path.is_file():
        try:
            cache_path.unlink()
        except Exception:
            pass

    proof_q = None
    proof_thread = None
    early_proofed: set[int] = set()
    first_proof_ready = threading.Event()

    # --- PRE-SCAN FOR OFFSET (BEFORE LOADER) ---
    global_offset = 0
    temp_pages = []
    for label, image, lines in iter_ocr_pages(
        path, lang=lang,
        start_page=args.start_page,
        end_page=args.start_page + 1,  # Only need first page
        dpi=args.dpi,
    ):
        temp_pages.append(PageUnit(label=label, image=image, lines=list(lines)))
        break  # We only need the first page

    computed_offset = args.page_offset if args.page_offset > 0 else compute_folio_offset(temp_pages)
    if computed_offset != 0:
        args.start_page = args.start_page + computed_offset
        print(f"Adjusted start page to PDF {args.start_page} (printed {args.start_page - computed_offset})", flush=True)
    global_offset = computed_offset
    # ----------------------------------------------

    def on_proof_applied(index: int, _text: str) -> None:
        if index == 0:
            first_proof_ready.set()

    if do_proof:
        clear_proofread_cancel()
        proof_q, proof_thread = _start_proof_worker(
            model=args.ollama_model, host=args.ollama_host,
            controller_holder=controller_holder, pages_holder=pages,
            early_proofed=early_proofed, on_applied=on_proof_applied,
            corrections=corrections, vision_model=args.ollama_vision_model,
        )

    stop_loader = threading.Event()

    def loader() -> None:
        try:
            for label, image, lines in iter_ocr_pages(
                path, lang=lang,
                start_page=args.start_page,
                end_page=args.end_page,
                dpi=args.dpi,
            ):
                if stop_loader.is_set():
                    break
                text = _page_raw_text(lines)
                page = PageUnit(label=label, image=image, lines=list(lines))

                if do_proof:
                    vision_text = _vision_hint_for_page(
                        page, model=args.ollama_model,
                        host=args.ollama_host, page_offset=global_offset,
                    )
                    if vision_text:
                        text = vision_text
                        _apply_text_to_page_unit(page, text)

                _print_page(label, text)
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
        except BaseException as exc:
            ready.put(("error", exc))

    loader_thread = threading.Thread(target=loader, name="ocr-loader", daemon=True)
    loader_thread.start()

    # Wait for first page
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

    # Create preview and controller (in correct order)
    preview = None
    if use_preview:
        from ocr_read_aloud.preview import create_preview
        print("\nOpening player window…")
        preview = create_preview(enabled=True, title="Reading…", run_ui_on_main=True)
        if preview is None or not preview.enabled:
            preview = None
        else:
            preview.show_message("Proofreading first page…" if proof_q is not None else "Preparing…")

    active_preview = preview if (preview and preview.enabled) else None
    controller = PlaybackController(
        [page0], speaker, preview=active_preview,
        on_status=lambda m: print(f"  ({m})"),
        default_save_path=save_default, proof_cache_path=cache_path,
        use_proof_cache=use_cache, source_path=path,
        skip_ad_pages=bool(getattr(args, "skip_ad_pages", True)),
        page_offset=global_offset,
    )
    controller.set_expect_more_pages(True)
    controller_holder[0] = controller

    if active_preview is not None:
        active_preview.set_controller(controller, ollama_model=args.ollama_model, ollama_host=args.ollama_host)

    # Wait for proofread (but preview is already visible and correct)
    if proof_q is not None and 0 not in early_proofed:
        print("Waiting for proofread of first page before speaking…", flush=True)
        first_proof_ready.wait(timeout=300.0)

    for i in list(early_proofed):
        controller.mark_page_proofed(i)

    print("\n[Speaking — use preview controls or media keys]")

    # ... (Continue with the rest of the run logic: play_error, _play, pump_ready, etc.)
    # Make sure all the existing logic is kept, but ensure `controller` is only created once.