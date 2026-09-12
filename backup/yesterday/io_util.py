"""Shared I/O helpers (paths, etc.) — keep free of CLI/preview imports."""

from __future__ import annotations

from pathlib import Path


def text_output_path(source: Path) -> Path:
    """Default path for saved OCR/read text beside the source.

    - File: ``{stem}.ocr.txt`` next to the source
    - Directory: ``ocr_output.txt`` inside the folder
    """
    source = Path(source)
    if source.is_dir():
        return source / "ocr_output.txt"
    return source.with_name(source.stem + ".ocr.txt")


def proof_cache_path(source: Path) -> Path:
    """Auto proofread cache path for the next reading session.

    - File: ``{stem}.txt`` next to the source (e.g. ``Speech_Synthesis.pdf`` →
      ``Speech_Synthesis.txt``)
    - Directory: ``proof_cache.txt`` inside the folder
    """
    source = Path(source)
    if source.is_dir():
        return source / "proof_cache.txt"
    return source.with_suffix(".txt")


def proofed_cache_path(source: Path) -> Path:
    """Marked cache path containing completed Ollama proofreading."""
    source = Path(source)
    if source.is_dir():
        return source / "proof_cache.proofed.txt"
    return source.with_name(source.stem + ".proofed.txt")


def corrections_path(source: Path) -> Path:
    """Directory for durable user spelling corrections."""
    source = Path(source)
    if source.is_dir():
        return source / "corrections"
    return source.with_name(source.stem + ".corrections")
