"""OCR Read Aloud package."""

__version__ = "0.1.0"

def __init__(
        self,
        pages: Sequence[PageUnit],
        speaker: Speaker,
        *,
        preview: object | None = None,
        on_status: Callable[[str], None] | None = None,
        on_line: Callable[[int, int, OcrLine | None], None] | None = None,
        default_save_path: Path | str | None = None,
        document_text: str | None = None,
        proof_cache_path: Path | str | None = None,
        use_proof_cache: bool = True,
        source_path: Path | str | None = None,
        skip_ad_pages: bool = True,
        **kwargs,
    ) -> None:
        self._pages = list(pages)
        self._speaker = speaker
        self._preview = preview
        self._on_status = on_status
        self._on_line = on_line
        self._default_save_path = (
            Path(default_save_path) if default_save_path is not None else None
        )
        self._document_text_override = document_text
        self._use_proof_cache = bool(use_proof_cache)
        self._proof_cache_path: Path | None = (
            Path(proof_cache_path) if proof_cache_path is not None else None
        )
        self._source_path: Path | None = (
            Path(source_path) if source_path is not None else None
        )
        self._skip_ad_pages = bool(skip_ad_pages)