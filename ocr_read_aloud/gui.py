"""Simple tkinter GUI for OCR Read Aloud."""

from __future__ import annotations

import threading
from pathlib import Path


def _require_tk():
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, scrolledtext, ttk
    except ImportError as exc:
        raise SystemExit(
            "tkinter is not available in this Python install.\n"
            "On Windows, use the official python.org installer (includes Tcl/Tk).\n"
            f"Details: {exc}"
        ) from exc
    return tk, filedialog, messagebox, scrolledtext, ttk


def main() -> None:
    tk, filedialog, messagebox, scrolledtext, ttk = _require_tk()

    from ocr_read_aloud.io_util import text_output_path
    from ocr_read_aloud.ocr import OcrError, iter_ocr_pages, normalize_lang
    from ocr_read_aloud.pdf_pages import DEFAULT_DPI
    from ocr_read_aloud.player import PageUnit, PlaybackController
    from ocr_read_aloud.preview import create_preview
    from ocr_read_aloud.tts import Speaker, TtsError

    class App(tk.Tk):
        def __init__(self) -> None:
            super().__init__()
            self.title("OCR Read Aloud")
            self.geometry("720x520")
            self.minsize(560, 400)

            self._path = tk.StringVar()
            self._lang = tk.StringVar(value="fin+eng")
            self._voice = tk.StringVar(value="")
            self._rate = tk.StringVar(value="")
            self._no_speak = tk.BooleanVar(value=False)
            self._preview_on = tk.BooleanVar(value=True)
            self._status = tk.StringVar(value="Ready")
            self._worker: threading.Thread | None = None
            self._speaker: Speaker | None = None
            self._preview = None
            self._controller: PlaybackController | None = None

            self._build()

        def _build(self) -> None:
            pad = {"padx": 8, "pady": 4}
            frm = ttk.Frame(self, padding=8)
            frm.pack(fill=tk.BOTH, expand=True)

            row0 = ttk.Frame(frm)
            row0.pack(fill=tk.X, **pad)
            ttk.Label(row0, text="File / folder:").pack(side=tk.LEFT)
            ttk.Entry(row0, textvariable=self._path).pack(
                side=tk.LEFT, fill=tk.X, expand=True, padx=4
            )
            ttk.Button(row0, text="Browse…", command=self._browse).pack(side=tk.LEFT)

            row1 = ttk.Frame(frm)
            row1.pack(fill=tk.X, **pad)
            ttk.Label(row1, text="Lang:").pack(side=tk.LEFT)
            ttk.Combobox(
                row1,
                textvariable=self._lang,
                values=["fin+eng", "fin", "eng"],
                width=12,
                state="readonly",
            ).pack(side=tk.LEFT, padx=4)
            ttk.Label(row1, text="Voice filter:").pack(side=tk.LEFT, padx=(12, 0))
            ttk.Entry(row1, textvariable=self._voice, width=18).pack(side=tk.LEFT, padx=4)
            ttk.Label(row1, text="Rate:").pack(side=tk.LEFT, padx=(12, 0))
            ttk.Entry(row1, textvariable=self._rate, width=6).pack(side=tk.LEFT, padx=4)
            ttk.Checkbutton(row1, text="OCR only", variable=self._no_speak).pack(
                side=tk.LEFT, padx=8
            )
            ttk.Checkbutton(row1, text="Preview", variable=self._preview_on).pack(
                side=tk.LEFT, padx=4
            )

            row2 = ttk.Frame(frm)
            row2.pack(fill=tk.X, **pad)
            self._start_btn = ttk.Button(row2, text="Start", command=self._start)
            self._start_btn.pack(side=tk.LEFT)
            self._stop_btn = ttk.Button(
                row2, text="Stop", command=self._stop, state=tk.DISABLED
            )
            self._stop_btn.pack(side=tk.LEFT, padx=6)
            ttk.Label(row2, textvariable=self._status).pack(side=tk.LEFT, padx=12)

            self._text = scrolledtext.ScrolledText(
                frm, wrap=tk.WORD, font=("Consolas", 11)
            )
            self._text.pack(fill=tk.BOTH, expand=True, **pad)

        def _browse(self) -> None:
            path = filedialog.askopenfilename(
                title="Select PDF or image",
                filetypes=[
                    (
                        "Documents",
                        "*.pdf;*.jpg;*.jpeg;*.png;*.tif;*.tiff;*.webp;*.bmp",
                    ),
                    ("PDF", "*.pdf"),
                    ("Images", "*.jpg;*.jpeg;*.png;*.tif;*.tiff;*.webp;*.bmp"),
                    ("All", "*.*"),
                ],
            )
            if not path:
                folder = filedialog.askdirectory(title="Or select image folder")
                if folder:
                    self._path.set(folder)
                return
            self._path.set(path)

        def _append(self, s: str) -> None:
            self._text.insert(tk.END, s + "\n")
            self._text.see(tk.END)

        def _set_running(self, running: bool) -> None:
            self._start_btn.configure(state=tk.DISABLED if running else tk.NORMAL)
            self._stop_btn.configure(state=tk.NORMAL if running else tk.DISABLED)

        def _start(self) -> None:
            path_str = self._path.get().strip()
            if not path_str:
                messagebox.showwarning(
                    "Missing path", "Choose a PDF, image, or folder."
                )
                return
            path = Path(path_str)
            if not path.exists():
                messagebox.showerror("Not found", f"Path does not exist:\n{path}")
                return

            if self._worker and self._worker.is_alive():
                return

            self._text.delete("1.0", tk.END)
            self._set_running(True)
            self._status.set("Working…")

            rate_raw = self._rate.get().strip()
            rate = int(rate_raw) if rate_raw else None
            voice = self._voice.get().strip() or None
            no_speak = self._no_speak.get()
            want_preview = self._preview_on.get() and not no_speak
            lang = normalize_lang(self._lang.get())

            preview = None
            if want_preview:
                preview = create_preview(
                    enabled=True, title="Reading…", master=self
                )
                self._preview = preview

            def work() -> None:
                controller = None
                try:
                    speaker = None
                    if not no_speak:
                        try:
                            speaker = Speaker(voice=voice, rate=rate)
                            self._speaker = speaker
                        except TtsError as exc:
                            self.after(
                                0,
                                lambda: messagebox.showerror("TTS error", str(exc)),
                            )
                            return

                    pages: list[PageUnit] = []
                    for label, image, lines in iter_ocr_pages(
                        path, lang=lang, dpi=DEFAULT_DPI
                    ):
                        text = "\n".join(ln.text for ln in lines if ln.text).strip()
                        block = (
                            f"=== {label} ===\n"
                            f"{text or '(no text recognized)'}\n"
                        )
                        self.after(0, lambda b=block: self._append(b))
                        pages.append(
                            PageUnit(label=label, image=image, lines=list(lines))
                        )

                    if speaker and pages:
                        self.after(0, lambda: self._status.set("Speaking…"))

                        def on_status(msg: str) -> None:
                            self.after(0, lambda m=msg: self._status.set(m))

                        controller = PlaybackController(
                            pages,
                            speaker,
                            preview=preview if (preview and preview.enabled) else None,
                            on_status=on_status,
                            default_save_path=text_output_path(path),
                        )
                        self._controller = controller
                        if preview is not None and preview.enabled:
                            # set_controller is thread-safe enough (just assigns)
                            preview.set_controller(controller)
                        controller.run()
                    else:
                        self.after(0, lambda: self._status.set("Done"))
                except (OcrError, FileNotFoundError, ValueError) as exc:
                    self.after(
                        0, lambda: messagebox.showerror("OCR error", str(exc))
                    )
                    self.after(0, lambda: self._status.set("Error"))
                except Exception as exc:  # noqa: BLE001
                    self.after(0, lambda: messagebox.showerror("Error", str(exc)))
                    self.after(0, lambda: self._status.set("Error"))
                finally:
                    self._speaker = None
                    self._controller = None
                    self.after(0, self._finish_run)

            self._worker = threading.Thread(target=work, daemon=True)
            self._worker.start()

        def _finish_run(self) -> None:
            if self._preview is not None:
                try:
                    self._preview.close()
                except Exception:  # noqa: BLE001
                    pass
                self._preview = None
            self._set_running(False)

        def _stop(self) -> None:
            if self._controller is not None:
                try:
                    self._controller.stop()
                except Exception:  # noqa: BLE001
                    pass
            elif self._speaker:
                try:
                    self._speaker.stop()
                except Exception:  # noqa: BLE001
                    pass
            self._status.set("Stopping…")

    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
