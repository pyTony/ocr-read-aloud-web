"""Always-on-top reading preview / player with transport + media keys."""

from __future__ import annotations

import queue
import sys
import threading
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from PIL import Image

_TK_WARNED = False


def _warn_no_tk(reason: str) -> None:
    global _TK_WARNED
    if not _TK_WARNED:
        print(f"Warning: reading preview disabled ({reason})", file=sys.stderr)
        _TK_WARNED = True


# Windows virtual-key / appcommand helpers for multimedia keys.
# Tk on Windows often delivers these as keysyms or via <Key> with keycode.
_MEDIA_KEYSYMS = {
    "XF86AudioPlay",
    "XF86AudioPause",
    "XF86AudioStop",
    "XF86AudioNext",
    "XF86AudioPrev",
    "Media_Play_Pause",
    "Media_Stop",
    "Media_Next",
    "Media_Prev",
}


class ReadingPreview:
    """
    Compact always-on-top player window: full-page preview (fit to window) + transport.

    Thread-safe display updates via a queue drained with after().
    Control buttons / keys call into a bound PlaybackController.

    - CLI main-thread (main_thread=True): Tk root + mainloop on the caller
      (required on Windows — Tk must not run on a background thread).
    - CLI legacy (no master, main_thread=False): own Tk root on a daemon
      thread + mainloop (kept for non-Windows / experiments).
    - GUI (master=existing Tk): Toplevel on that root.

    If tkinter is unavailable, methods are no-ops (one-line warning).
    """

    WINDOW_W = 720
    WINDOW_H = 520
    DEFAULT_PAD = 40

    def __init__(
        self,
        *,
        enabled: bool = True,
        title: str = "Reading…",
        master: Any = None,
        main_thread: bool = False,
    ) -> None:
        self._enabled = enabled
        self._title = title
        self._master = master
        self._main_thread = bool(main_thread) and master is None
        self._q: queue.Queue[tuple[str, Any]] = queue.Queue()
        self._root: Any = None
        self._label: Any = None
        self._preview_frame: Any = None
        self._caption: Any = None
        self._position: Any = None
        self._status_lbl: Any = None
        self._photo: Any = None
        self._closed = False
        self._owns_mainloop = False
        self._pump_scheduled = False
        self._tk = None
        self._ImageTk = None
        self._Image = None
        self._ImageDraw = None
        self._ui_thread: threading.Thread | None = None
        self._ui_ready = threading.Event()
        self._ui_error: str | None = None
        self._controller: Any = None  # PlaybackController
        self._btn_pause: Any = None
        self._btn_continue: Any = None
        self._btn_ad: Any = None
        self._btn_art: Any = None
        self._ollama_model: str | None = None
        self._ollama_host: str | None = None
        self._proof_busy = False
        self._last_pil = None  # last full RGB image shown (for re-fit on resize)
        self._fit_after_id = None
        self._zoom = 1.0
        self._pan_x = 0
        self._pan_y = 0
        self._drag_origin: tuple[int, int] | None = None
        self._drag_pan: tuple[int, int] = (0, 0)

        if not enabled:
            return

        try:
            import tkinter as tk
        except ImportError:
            _warn_no_tk("tkinter not available")
            self._enabled = False
            return

        try:
            from PIL import Image as PILImage
            from PIL import ImageDraw, ImageTk
        except ImportError:
            _warn_no_tk("Pillow ImageTk not available")
            self._enabled = False
            return

        self._tk = tk
        self._Image = PILImage
        self._ImageDraw = ImageDraw
        self._ImageTk = ImageTk

        if master is not None:
            self._build_window(master, toplevel=True)
            self._schedule_pump()
            return

        # CLI: build Tk on the calling (main) thread — required on Windows.
        if self._main_thread:
            try:
                self._build_window(None, toplevel=False)
                self._owns_mainloop = True
                self._apply("status", "Preparing…")
                self._schedule_pump()
                if self._root is not None:
                    try:
                        self._root.update_idletasks()
                        self._root.deiconify()
                        self._root.lift()
                        self._root.update()
                    except Exception:  # noqa: BLE001
                        pass
            except Exception as exc:  # noqa: BLE001
                _warn_no_tk(f"tkinter UI error: {exc}")
                self._enabled = False
            return

        # Legacy: background daemon thread (may fail silently on Windows).
        self._ui_thread = threading.Thread(target=self._ui_main, daemon=True)
        self._ui_thread.start()
        if not self._ui_ready.wait(timeout=5.0):
            _warn_no_tk("preview UI failed to start in time")
            self._enabled = False
            return
        if self._ui_error:
            _warn_no_tk(self._ui_error)
            self._enabled = False

    # --- controller wiring ---

    def set_controller(
        self,
        controller: Any,
        *,
        ollama_model: str | None = None,
        ollama_host: str | None = None,
    ) -> None:
        """Attach a PlaybackController; buttons/keys call its methods."""
        self._controller = controller
        if ollama_model is not None:
            self._ollama_model = ollama_model
        if ollama_host is not None:
            self._ollama_host = ollama_host
        self._enqueue("controller", None)

    def _ctrl(self, name: str, *args: object) -> None:
        # Stop / Esc should abort an in-progress Proof (Ollama) as well as TTS.
        if name == "stop" and self._proof_busy:
            try:
                from ocr_read_aloud.proofread import set_proofread_cancel

                set_proofread_cancel(True)
                self.set_status("Proofread cancelled…")
            except Exception:  # noqa: BLE001
                pass
        c = self._controller
        if c is None:
            return
        fn = getattr(c, name, None)
        if callable(fn):
            try:
                fn(*args)
            except Exception as exc:  # noqa: BLE001
                print(f"Warning: control '{name}' failed: {exc}", file=sys.stderr)

    # --- UI construction ---

    def _build_window(self, master: Any, *, toplevel: bool) -> None:
        assert self._tk is not None
        tk = self._tk
        win = tk.Toplevel(master) if toplevel else tk.Tk()
        win.title(self._title)
        # Extra height for caption + transport + status
        win.geometry(f"{self.WINDOW_W}x{self.WINDOW_H + 120}")
        win.minsize(320, 260)
        # Not always-on-top: stays minimized / behind other windows when Tony
        # switches away. (Old -topmost kept popping the player over everything.)
        try:
            win.attributes("-topmost", False)
        except Exception:  # noqa: BLE001
            pass
        win.protocol("WM_DELETE_WINDOW", self._on_user_close)

        # Current sentence at the very top (updates each speak unit).
        self._caption = tk.Label(
            win,
            text="",
            anchor="w",
            justify="left",
            wraplength=self.WINDOW_W - 16,
            font=("Segoe UI", 11),
        )
        self._caption.pack(side="top", fill="x", padx=8, pady=(6, 2))

        top = tk.Frame(win)
        top.pack(side="top", fill="x", padx=6, pady=(0, 0))
        self._position = tk.Label(top, text="", anchor="w", font=("Segoe UI", 9), fg="#555")
        self._position.pack(fill="x")

        # Bottom chrome first so the page image cannot expand over controls.
        bottom = tk.Frame(win)
        bottom.pack(side="bottom", fill="x")

        # Transport bar
        bar = tk.Frame(bottom)
        bar.pack(fill="x", padx=4, pady=4)

        def btn(text: str, cmd: Callable[[], None], width: int = 6) -> Any:
            b = tk.Button(bar, text=text, width=width, command=cmd)
            b.pack(side="left", padx=2)
            return b

        btn("PgUp", lambda: self._ctrl("page_up"), 5)
        btn("Rew", lambda: self._ctrl("rew"), 5)
        btn("Stop", lambda: self._ctrl("stop"), 5)
        self._btn_pause = btn("Pause", lambda: self._ctrl("toggle_pause"), 6)
        btn("Play", lambda: self._ctrl("play"), 5)
        btn("Fwd", lambda: self._ctrl("fwd"), 5)
        btn("PgDn", lambda: self._ctrl("page_down"), 5)
        btn("Save", self._on_save, 5)
        self._btn_art = btn("Art", self._on_save_article, 4)
        btn("Proof", self._on_proof, 5)
        self._btn_continue = btn("Cont→", lambda: self._ctrl("jump_continue"), 6)
        try:
            self._btn_continue.configure(state="disabled")
        except Exception:  # noqa: BLE001
            pass
        self._btn_ad = btn("Ad←", lambda: self._ctrl("jump_ad"), 5)
        self._btn_ad_default_bg = None
        self._btn_ad_default_fg = None
        try:
            self._btn_ad_default_bg = self._btn_ad.cget("bg")
            self._btn_ad_default_fg = self._btn_ad.cget("fg")
        except Exception:  # noqa: BLE001
            pass
        try:
            self._btn_ad.configure(state="disabled")
        except Exception:  # noqa: BLE001
            pass
        # Right-click: pick from ad queue when multiple ads known
        try:
            self._btn_ad.bind("<Button-3>", lambda e: self._on_ad_queue_menu(e))
        except Exception:  # noqa: BLE001
            pass
        self._ad_notice_until = 0.0
        btn("Voice", self._on_voice, 5)
        btn("Go…", self._on_goto_page, 5)
        btn("-", self.zoom_out, 3)
        btn("+", self.zoom_in, 3)
        btn("Fit", self.zoom_reset, 4)

        self._status_lbl = tk.Label(
            bottom, text="Ready", anchor="w", fg="#444", font=("Segoe UI", 9)
        )
        self._status_lbl.pack(fill="x", padx=8, pady=(0, 4))

        # Preview pane: fixed slot; pack_propagate False so PhotoImage cannot grow it
        self._preview_frame = tk.Frame(win, bg="#222222")
        self._preview_frame.pack(side="top", fill="both", expand=True, padx=4, pady=2)
        try:
            self._preview_frame.pack_propagate(False)
        except Exception:
            pass
        self._label = tk.Label(self._preview_frame, bg="#222222")
        self._label.pack(fill="both", expand=True)
        self._label.bind("<ButtonPress-1>", self._start_drag)
        self._label.bind("<B1-Motion>", self._drag_image)
        self._label.bind("<ButtonRelease-1>", self._end_drag)

        self._root = win
        self._bind_keys(win)
        try:
            win.bind("<Configure>", self._on_configure, add="+")
            self._preview_frame.bind("<Configure>", self._on_configure, add="+")
            self._label.bind("<Configure>", self._on_configure, add="+")
        except Exception:  # noqa: BLE001
            pass
        # Focus so key bindings work immediately
        try:
            win.focus_force()
        except Exception:  # noqa: BLE001
            pass

    def _bind_keys(self, win: Any) -> None:
        """Keyboard shortcuts + multimedia / media keys (Windows-first)."""
        # Standard shortcuts (return break so <Key> media handler does not double-fire)
        def bind_cmd(seq: str, method: str) -> None:
            try:
                win.bind(seq, lambda e, m=method: (self._ctrl(m), "break")[1])
            except Exception:
                # Some Windows Tk builds reject media keysyms (e.g. Media_Play_Pause).
                pass

        bind_cmd("<space>", "toggle_pause")
        bind_cmd("<Escape>", "stop")
        try:
            win.bind("+", lambda e: (self.zoom_in(), "break")[1])
            win.bind("=", lambda e: (self.zoom_in(), "break")[1])
            win.bind("-", lambda e: (self.zoom_out(), "break")[1])
            win.bind("<Key-0>", lambda e: (self.zoom_reset(), "break")[1])
        except Exception:
            pass
        # Sentence step (←/→); Rew/Fwd buttons + media prev/next use same methods
        bind_cmd("<Left>", "rew")
        bind_cmd("<Right>", "fwd")
        # Paragraph / speakable-chunk step (↑/↓ and Tab / Shift+Tab)
        bind_cmd("<Up>", "para_rew")
        bind_cmd("<Down>", "para_fwd")
        bind_cmd("<Tab>", "para_fwd")
        bind_cmd("<Shift-Tab>", "para_rew")
        bind_cmd("<ISO_Left_Tab>", "para_rew")  # some X11 Tk builds
        # Page step — Prior/Next only (not Up/Down)
        bind_cmd("<Prior>", "page_up")  # Page Up
        bind_cmd("<Next>", "page_down")  # Page Down
        try:
            win.bind("<Control-s>", lambda e: (self._on_save(), "break")[1])
            win.bind("<Control-S>", lambda e: (self._on_save(), "break")[1])
        except Exception:  # noqa: BLE001
            pass
        # Jump to “continued on page N” when Cont→ is available
        bind_cmd("<c>", "jump_continue")
        bind_cmd("<C>", "jump_continue")
        try:
            win.bind("<Control-j>", lambda e: (self._ctrl("jump_continue"), "break")[1])
            win.bind("<Control-J>", lambda e: (self._ctrl("jump_continue"), "break")[1])
        except Exception:  # noqa: BLE001
            pass
        try:
            win.bind("<Control-g>", lambda e: (self._on_goto_page(), "break")[1])
            win.bind("<Control-G>", lambda e: (self._on_goto_page(), "break")[1])
        except Exception:  # noqa: BLE001
            pass
        bind_cmd("<a>", "jump_ad")
        bind_cmd("<A>", "jump_ad")
        try:
            win.bind("<Control-Shift-s>", lambda e: (self._on_save_article(), "break")[1])
            win.bind("<Control-Shift-S>", lambda e: (self._on_save_article(), "break")[1])
        except Exception:  # noqa: BLE001
            pass

        # Named media keysyms — best-effort; keycode catch-all below covers Win32.
        for ks in (
            "XF86AudioPlay",
            "XF86AudioPause",
            "Media_Play_Pause",
            "XF86AudioStop",
            "Media_Stop",
            "XF86AudioNext",
            "Media_Next",
            "XF86AudioPrev",
            "Media_Prev",
        ):
            method = "toggle_pause"
            low = ks.lower()
            if "stop" in low:
                method = "stop"
            elif "next" in low:
                method = "fwd"
            elif "prev" in low:
                method = "rew"
            bind_cmd(f"<{ks}>", method)

        # Catch-all for Windows VK_MEDIA_* keycodes / odd keysyms
        try:
            win.bind("<Key>", self._on_any_key)
        except Exception:
            pass

        # Standalone CLI only: bind_all so media keys work without focus quirks.
        # Do NOT bind_all in GUI mode (would steal keys from text fields).
        if self._master is None:
            try:
                win.bind_all("<Key>", self._on_any_key_media_only)
            except Exception:  # noqa: BLE001
                pass

    def _on_any_key(self, event: Any) -> str | None:
        """Handle media keys; ignore ordinary keys (already bound above)."""
        if self._dispatch_media_event(event):
            return "break"
        return None

    def _on_any_key_media_only(self, event: Any) -> str | None:
        if self._dispatch_media_event(event):
            return "break"
        return None

    def _dispatch_media_event(self, event: Any) -> bool:
        """
        Return True if event was handled as a media key.

        Windows WM_APPCOMMAND often surfaces as keysym names above, or as
        keycodes. Common Win32 multimedia VK codes (when exposed):
          VK_MEDIA_NEXT_TRACK=0xB0, PREV=0xB1, STOP=0xB2, PLAY_PAUSE=0xB3
        """
        keysym = (getattr(event, "keysym", None) or "")
        if keysym in _MEDIA_KEYSYMS or keysym.startswith("XF86Audio"):
            ks = keysym.lower()
            if "play" in ks or "pause" in ks:
                self._ctrl("toggle_pause")
                return True
            if "stop" in ks:
                self._ctrl("stop")
                return True
            if "next" in ks:
                self._ctrl("fwd")
                return True
            if "prev" in ks:
                self._ctrl("rew")
                return True

        # Virtual-key codes (Windows)
        try:
            kc = int(getattr(event, "keycode", 0) or 0)
        except (TypeError, ValueError):
            kc = 0
        # Map Win32 VK_MEDIA_* when Tk reports them as keycodes
        if kc in (0xB3, 179):  # VK_MEDIA_PLAY_PAUSE
            self._ctrl("toggle_pause")
            return True
        if kc in (0xB2, 178):  # VK_MEDIA_STOP
            self._ctrl("stop")
            return True
        if kc in (0xB0, 176):  # VK_MEDIA_NEXT_TRACK
            self._ctrl("fwd")
            return True
        if kc in (0xB1, 177):  # VK_MEDIA_PREV_TRACK
            self._ctrl("rew")
            return True
        return False

    def _on_goto_page(self) -> None:
        """Small dialog: jump by printed folio or 1-based PDF page index."""
        if self._root is None or self._tk is None:
            return
        tk = self._tk
        parent = self._root
        dlg = tk.Toplevel(parent)
        dlg.title("Go to page")
        dlg.transient(parent)
        try:
            dlg.grab_set()
        except Exception:  # noqa: BLE001
            pass
        dlg.geometry("280x110")
        dlg.resizable(False, False)

        tk.Label(
            dlg,
            text="Printed page or PDF index:",
            anchor="w",
            font=("Segoe UI", 9),
        ).pack(fill="x", padx=10, pady=(10, 2))
        entry = tk.Entry(dlg, width=12, font=("Segoe UI", 11))
        entry.pack(padx=10, pady=4, anchor="w")
        try:
            entry.focus_set()
        except Exception:  # noqa: BLE001
            pass

        def do_jump(_event: object | None = None) -> None:
            raw = entry.get().strip()
            try:
                dlg.destroy()
            except Exception:  # noqa: BLE001
                pass
            if not raw:
                self.set_status("Go… · cancelled")
                return
            self._ctrl("goto_page", raw)

        def cancel() -> None:
            try:
                dlg.destroy()
            except Exception:  # noqa: BLE001
                pass

        entry.bind("<Return>", do_jump)
        btn_row = tk.Frame(dlg)
        btn_row.pack(fill="x", padx=10, pady=(4, 10))
        tk.Button(btn_row, text="Jump", width=8, command=do_jump).pack(side="right", padx=4)
        tk.Button(btn_row, text="Cancel", width=8, command=cancel).pack(side="right")

    def _on_voice(self) -> None:
        """Open a simple voice chooser for installed TTS voices."""
        c = self._controller
        voices: list = []
        try:
            if c is not None and hasattr(c, "list_voices"):
                voices = list(c.list_voices() or [])
            else:
                from ocr_read_aloud.tts import list_voices

                voices = list(list_voices() or [])
        except Exception as exc:  # noqa: BLE001
            self.set_status(f"Voice list failed: {exc}")
            return
        if not voices:
            self.set_status("No voices found")
            return
        self._show_voice_chooser(voices)

    def _show_voice_chooser(self, voices: list) -> None:
        """Small Toplevel listbox of voice names; OK / double-click applies."""
        if self._root is None or self._tk is None:
            return
        tk = self._tk
        parent = self._root
        dlg = tk.Toplevel(parent)
        dlg.title("Select voice")
        dlg.transient(parent)
        try:
            dlg.grab_set()
        except Exception:  # noqa: BLE001
            pass
        dlg.geometry("420x320")
        dlg.minsize(320, 200)

        frame = tk.Frame(dlg)
        frame.pack(fill="both", expand=True, padx=8, pady=8)
        scroll = tk.Scrollbar(frame)
        scroll.pack(side="right", fill="y")
        lb = tk.Listbox(frame, exportselection=False, yscrollcommand=scroll.set)
        lb.pack(side="left", fill="both", expand=True)
        scroll.config(command=lb.yview)

        ids: list[str] = []
        names: list[str] = []
        for v in voices:
            name = str(v.get("name") or v.get("id") or "(unnamed)")
            vid = str(v.get("id") or name)
            names.append(name)
            ids.append(vid)
            lb.insert("end", name)

        current = ""
        c = self._controller
        if c is not None and hasattr(c, "current_voice_name"):
            try:
                current = str(c.current_voice_name() or "")
            except Exception:  # noqa: BLE001
                current = ""
        if current:
            cur_l = current.lower()
            for i, (name, vid) in enumerate(zip(names, ids)):
                if cur_l == name.lower() or cur_l == vid.lower() or cur_l in name.lower() or cur_l in vid.lower():
                    try:
                        lb.selection_set(i)
                        lb.see(i)
                        lb.activate(i)
                    except Exception:  # noqa: BLE001
                        pass
                    break

        status = tk.Label(dlg, text="", anchor="w", fg="#555", font=("Segoe UI", 8))
        status.pack(fill="x", padx=8)

        def on_select(_event: object | None = None) -> None:
            sel = lb.curselection()
            if not sel:
                return
            i = int(sel[0])
            try:
                status.configure(text=f"id: {ids[i]}")
            except Exception:  # noqa: BLE001
                pass

        def apply_voice(_event: object | None = None) -> None:
            sel = lb.curselection()
            if not sel:
                self.set_status("No voice selected")
                return
            i = int(sel[0])
            chosen_id = ids[i]
            chosen_name = names[i]
            ctrl = self._controller
            if ctrl is None or not hasattr(ctrl, "set_voice"):
                self.set_status("Voice control unavailable")
                try:
                    dlg.destroy()
                except Exception:  # noqa: BLE001
                    pass
                return
            try:
                # Prefer id so substring match is unambiguous.
                applied = ctrl.set_voice(chosen_id)
            except Exception as exc:  # noqa: BLE001
                self.set_status(f"Voice failed · {exc}")
                return
            display = applied or chosen_name
            self.set_status(f"Voice · {display}")
            try:
                dlg.destroy()
            except Exception:  # noqa: BLE001
                pass

        def cancel() -> None:
            try:
                dlg.destroy()
            except Exception:  # noqa: BLE001
                pass

        lb.bind("<<ListboxSelect>>", on_select)
        lb.bind("<Double-Button-1>", apply_voice)
        btn_row = tk.Frame(dlg)
        btn_row.pack(fill="x", padx=8, pady=(0, 8))
        tk.Button(btn_row, text="OK", width=8, command=apply_voice).pack(side="right", padx=4)
        tk.Button(btn_row, text="Cancel", width=8, command=cancel).pack(side="right")
        on_select()
        try:
            dlg.focus_force()
            lb.focus_set()
        except Exception:  # noqa: BLE001
            pass

    def _on_save(self) -> None:
        """Save full OCR/read text to .ocr.txt (or ask for path)."""
        c = self._controller
        if c is None or not hasattr(c, "save_text"):
            self.set_status("Nothing to save")
            return
        try:
            default = getattr(c, "default_save_path", None)
            path = default
            if path is None:
                from tkinter import filedialog

                path = filedialog.asksaveasfilename(
                    parent=self._root,
                    title="Save OCR text",
                    defaultextension=".txt",
                    filetypes=[("Text", "*.txt"), ("All", "*.*")],
                    initialfile="ocr_output.txt",
                )
                if not path:
                    self.set_status("Save cancelled")
                    return
            out = c.save_text(path)
            self.set_status(f"Saved: {out}")
        except Exception as exc:  # noqa: BLE001
            self.set_status(f"Save failed: {exc}")
            print(f"Warning: save failed: {exc}", file=sys.stderr)

    def _on_save_article(self) -> None:
        """Save current article (or ad) with title-based default filename."""
        c = self._controller
        if c is None or not hasattr(c, "save_article"):
            self.set_status("Nothing to save")
            return
        try:
            default = None
            if hasattr(c, "default_article_save_path"):
                try:
                    default = c.default_article_save_path()
                except Exception:  # noqa: BLE001
                    default = None
            path = None
            # Prefer default path without dialog when we have a sensible name
            if default is not None:
                path = default
            else:
                from tkinter import filedialog

                path = filedialog.asksaveasfilename(
                    parent=self._root,
                    title="Save article / ad text",
                    defaultextension=".txt",
                    filetypes=[("Text", "*.txt"), ("All", "*.*")],
                    initialfile="article.txt",
                )
                if not path:
                    self.set_status("Save cancelled")
                    return
            out = c.save_article(path)
            # Status already set inside save_article; reinforce for UI
            is_ad = bool(getattr(c, "is_viewing_ad", lambda: False)())
            kind = "ad" if is_ad else "article"
            self.set_status(f"Saved {kind} · {out}")
        except Exception as exc:  # noqa: BLE001
            self.set_status(f"Save article failed: {exc}")
            print(f"Warning: save article failed: {exc}", file=sys.stderr)

    def _on_proof(self) -> None:
        """Run Ollama proofread on all pages (background thread)."""
        c = self._controller
        if c is None or not hasattr(c, "apply_proofread"):
            self.set_status("Nothing to proofread")
            return
        if self._proof_busy:
            self.set_status("Proofread already running…")
            return
        if getattr(c, "proofread_done", False):
            self.set_status("Already proofread")
            return

        self._proof_busy = True
        self.set_status("Proofreading (Ollama)…")

        model = self._ollama_model
        host = self._ollama_host

        def work() -> None:
            try:
                ok = c.apply_proofread(model=model, host=host)
                if ok:
                    self.set_status("Proofread done — hit Play")
                # failure / cancel status already set inside apply_proofread
            finally:
                self._proof_busy = False

        threading.Thread(target=work, name="ocr-proofread", daemon=True).start()

    def _ui_main(self) -> None:
        assert self._tk is not None
        try:
            self._build_window(None, toplevel=False)
            self._owns_mainloop = True
            self._ui_ready.set()
            self._schedule_pump()
            assert self._root is not None
            self._root.mainloop()
        except Exception as exc:  # noqa: BLE001
            self._ui_error = f"tkinter UI error: {exc}"
            self._ui_ready.set()

    def _on_user_close(self) -> None:
        # Closing the window stops playback and ends CLI mainloop if we own it.
        self._ctrl("stop")
        if self._root is not None:
            try:
                self._root.withdraw()
            except Exception:  # noqa: BLE001
                pass
        if self._owns_mainloop:
            self.quit_mainloop()

    def _schedule_pump(self) -> None:
        if self._root is None or self._closed:
            return
        if not self._pump_scheduled:
            self._pump_scheduled = True
            try:
                self._root.after(50, self._pump)
            except Exception:  # noqa: BLE001
                self._pump_scheduled = False

    def _pump(self) -> None:
        self._pump_scheduled = False
        if self._closed or self._root is None:
            return
        try:
            while True:
                cmd, payload = self._q.get_nowait()
                self._apply(cmd, payload)
        except queue.Empty:
            pass
        # Sync pause / continue button labels with controller state
        self._sync_pause_button()
        self._sync_continue_button()
        self._sync_ad_button()
        if not self._closed:
            self._schedule_pump()

    def _sync_pause_button(self) -> None:
        if self._btn_pause is None or self._controller is None:
            return
        try:
            paused = bool(getattr(self._controller, "paused", False))
            self._btn_pause.configure(text="Resume" if paused else "Pause")
        except Exception:  # noqa: BLE001
            pass

    def _sync_continue_button(self) -> None:
        """Enable Cont→ / →N / ←Back when continue cue or resume-after-continue is active."""
        if self._btn_continue is None:
            return
        c = self._controller
        mode = None
        target = None
        if c is not None:
            if hasattr(c, "continue_button_mode"):
                try:
                    mode = c.continue_button_mode()
                except Exception:  # noqa: BLE001
                    mode = None
            if hasattr(c, "current_continue_target"):
                try:
                    target = c.current_continue_target()
                except Exception:  # noqa: BLE001
                    target = None
        try:
            if mode == "resume":
                self._btn_continue.configure(text="←Back", state="normal")
            elif mode == "forward" or target is not None:
                n = int(target[0]) if target is not None else 0
                label = f"→{n}" if n else "Cont→"
                self._btn_continue.configure(text=label, state="normal")
            else:
                self._btn_continue.configure(text="Cont→", state="disabled")
        except Exception:  # noqa: BLE001
            pass

    def _sync_ad_button(self) -> None:
        """Enable Ad← / Art→ when a skipped/queued ad (or resume) is available."""
        if self._btn_ad is None:
            return
        import time

        c = self._controller
        mode = None
        info = None
        notice = False
        queue_n = 0
        if c is not None:
            if hasattr(c, "ad_button_mode"):
                try:
                    mode = c.ad_button_mode()
                except Exception:  # noqa: BLE001
                    mode = None
            if hasattr(c, "current_skipped_ad"):
                try:
                    info = c.current_skipped_ad()
                except Exception:  # noqa: BLE001
                    info = None
            if hasattr(c, "ad_skip_notice_active"):
                try:
                    notice = bool(c.ad_skip_notice_active())
                except Exception:  # noqa: BLE001
                    notice = False
            if hasattr(c, "ad_queue"):
                try:
                    queue_n = len(c.ad_queue() or [])
                except Exception:  # noqa: BLE001
                    queue_n = 0
        if notice:
            self._ad_notice_until = time.time() + 45.0
        flash = notice or (time.time() < getattr(self, "_ad_notice_until", 0))
        try:
            bg = "#ff9800" if flash and mode == "visit" else (self._btn_ad_default_bg or None)
            fg = "#000000" if flash and mode == "visit" else (self._btn_ad_default_fg or None)
            kw: dict = {}
            if bg is not None:
                kw["bg"] = bg
            if fg is not None:
                kw["fg"] = fg
            if mode is None or info is None:
                self._btn_ad.configure(text="Ad←", state="disabled", **kw)
            elif mode == "resume":
                self._btn_ad.configure(text="Art→", state="normal", **kw)
            else:
                folio = int(info[1]) if info[1] else 0
                if flash:
                    label = f"Ad←{folio}!" if folio else "Ad←!"
                elif queue_n > 1:
                    label = f"Ad←·{queue_n}" if not folio else f"Ad←{folio}·{queue_n}"
                else:
                    label = f"Ad←{folio}" if folio else "Ad←"
                self._btn_ad.configure(text=label, state="normal", **kw)
            # Status bar emphasis while notice is live
            if flash and mode == "visit" and self._status_lbl is not None:
                try:
                    self._status_lbl.configure(fg="#b71c1c")
                except Exception:  # noqa: BLE001
                    pass
            elif self._status_lbl is not None and not flash:
                try:
                    self._status_lbl.configure(fg="#444")
                except Exception:  # noqa: BLE001
                    pass
        except Exception:  # noqa: BLE001
            pass

    def flash_ad_skip_notice(self, msg: str) -> None:
        """High-visibility cue after auto-skip (status + Ad← flash)."""
        import time

        self._ad_notice_until = time.time() + 45.0
        self.set_status(msg or "Skipped ad — push Ad← to see/read it!")
        self._enqueue("ad_flash", msg or "")

    def _on_ad_queue_menu(self, event: object = None) -> None:
        """Right-click Ad←: list queued/skipped ads to open on demand."""
        c = self._controller
        if c is None or self._root is None:
            return
        entries = []
        try:
            if hasattr(c, "ad_queue"):
                entries = list(c.ad_queue() or [])
        except Exception:  # noqa: BLE001
            entries = []
        if not entries:
            return
        try:
            import tkinter as tk
        except Exception:  # noqa: BLE001
            return
        menu = tk.Menu(self._root, tearoff=0)
        for idx, folio in entries:
            label = f"Ad p.{folio}" if folio else f"Ad page {idx + 1}"
            menu.add_command(
                label=label,
                command=lambda i=idx: self._jump_ad_index(i),
            )
        try:
            x = getattr(event, "x_root", 0)
            y = getattr(event, "y_root", 0)
            menu.tk_popup(int(x), int(y))
        except Exception:  # noqa: BLE001
            pass

    def _jump_ad_index(self, ad_idx: int) -> None:
        c = self._controller
        if c is None:
            return
        # Prefer controller helper if present; else emulate via skipped list.
        if hasattr(c, "jump_ad_at"):
            try:
                c.jump_ad_at(ad_idx)
                return
            except Exception:  # noqa: BLE001
                pass
        try:
            with c._lock:
                if ad_idx not in c._skipped_ads:
                    c._skipped_ads.append(ad_idx)
                # Move to end so jump_skipped_ad picks it
                c._skipped_ads = [i for i in c._skipped_ads if i != ad_idx] + [ad_idx]
            c.jump_skipped_ad()
        except Exception:  # noqa: BLE001
            pass

    def _apply(self, cmd: str, payload: Any) -> None:
        if cmd == "image":
            self._set_photo(payload)
        elif cmd == "caption":
            if self._caption is not None:
                try:
                    self._caption.configure(text=(payload or "")[:800])
                except Exception:  # noqa: BLE001
                    pass
        elif cmd == "position":
            if self._position is not None:
                try:
                    self._position.configure(text=(payload or ""))
                except Exception:  # noqa: BLE001
                    pass
        elif cmd == "status":
            if self._status_lbl is not None:
                try:
                    self._status_lbl.configure(text=(payload or ""))
                except Exception:  # noqa: BLE001
                    pass
        elif cmd == "ad_flash":
            if self._status_lbl is not None:
                try:
                    self._status_lbl.configure(
                        text=(payload or "Skipped ad — push Ad← to see/read it!"),
                        fg="#b71c1c",
                    )
                except Exception:  # noqa: BLE001
                    pass
            self._sync_ad_button()
        elif cmd == "close":
            self._closed = True
            if self._root is not None:
                try:
                    self._root.destroy()
                except Exception:  # noqa: BLE001
                    pass
                self._root = None
        elif cmd == "show":
            if self._root is not None:
                try:
                    self._root.deiconify()
                    self._root.lift()
                    self._root.focus_force()
                except Exception:  # noqa: BLE001
                    pass
        elif cmd == "controller":
            pass  # controller already set on self

    def _fit_target_size(self) -> tuple[int, int]:
        """Preview pane pixel size (not image-driven label request size)."""
        w = h = 0
        pane = getattr(self, "_preview_frame", None) or self._label
        if pane is not None:
            try:
                pane.update_idletasks()
                w = int(pane.winfo_width())
                h = int(pane.winfo_height())
            except Exception:  # noqa: BLE001
                w = h = 0
        if w < 50 or h < 50:
            w = max(50, self.WINDOW_W - 8)
            h = max(50, self.WINDOW_H - 8)
        return w, h

    def _on_configure(self, _event: Any = None) -> None:
        """Debounced re-fit when the player window / image pane resizes."""
        if self._root is None or self._closed or self._last_pil is None:
            return
        if self._fit_after_id is not None:
            try:
                self._root.after_cancel(self._fit_after_id)
            except Exception:  # noqa: BLE001
                pass
            self._fit_after_id = None

        def _refit() -> None:
            self._fit_after_id = None
            if self._closed or self._last_pil is None:
                return
            if self._caption is not None and self._root is not None:
                try:
                    ww = max(120, int(self._root.winfo_width()) - 16)
                    self._caption.configure(wraplength=ww)
                except Exception:  # noqa: BLE001
                    pass
            self._set_photo(self._last_pil, store=False)

        try:
            self._fit_after_id = self._root.after(100, _refit)
        except Exception:  # noqa: BLE001
            self._fit_after_id = None

    def _set_photo(self, pil_image: Image.Image, *, store: bool = True) -> None:
        if self._label is None or self._ImageTk is None or self._Image is None:
            return
        img = pil_image.convert("RGB")
        if store:
            self._last_pil = img.copy()
            self._pan_x = 0
            self._pan_y = 0
        tw, th = self._fit_target_size()
        try:
            resample = self._Image.Resampling.LANCZOS
        except AttributeError:
            resample = self._Image.LANCZOS  # type: ignore[attr-defined]
        # Fit to the pane, then apply optional zoom so the page may exceed it.
        try:
            iw, ih = img.size
            fit_scale = min(tw / max(1, iw), th / max(1, ih))
            scale = max(0.1, fit_scale * self._zoom)
            fitted = img.resize(
                (max(1, int(iw * scale)), max(1, int(ih * scale))),
                resample,
            )
        except Exception:  # noqa: BLE001
            iw, ih = img.size
            if iw <= 0 or ih <= 0:
                return
            scale = min(tw / iw, th / ih)
            nw = max(1, int(iw * scale))
            nh = max(1, int(ih * scale))
            fitted = img.resize((nw, nh), resample)
        canvas = self._Image.new("RGB", (tw, th), "#222222")
        x = (tw - fitted.width) // 2 + self._pan_x
        y = (th - fitted.height) // 2 + self._pan_y
        max_pan_x = max(0, (fitted.width - tw) // 2)
        max_pan_y = max(0, (fitted.height - th) // 2)
        self._pan_x = max(-max_pan_x, min(max_pan_x, self._pan_x))
        self._pan_y = max(-max_pan_y, min(max_pan_y, self._pan_y))
        x = (tw - fitted.width) // 2 + self._pan_x
        y = (th - fitted.height) // 2 + self._pan_y
        canvas.paste(fitted, (x, y))
        photo = self._ImageTk.PhotoImage(canvas)
        self._photo = photo
        try:
            self._label.configure(image=photo)
        except Exception:  # noqa: BLE001
            pass

    def _set_zoom(self, value: float) -> None:
        self._zoom = max(1.0, min(4.0, float(value)))
        if self._zoom == 1.0:
            self._pan_x = 0
            self._pan_y = 0
        if self._last_pil is not None:
            self._set_photo(self._last_pil, store=False)
        self.set_status(f"Zoom {self._zoom:.1f}×" if self._zoom != 1.0 else "Fit")

    def _start_drag(self, event: Any) -> str:
        self._drag_origin = (int(event.x), int(event.y))
        self._drag_pan = (self._pan_x, self._pan_y)
        return "break"

    def _drag_image(self, event: Any) -> str:
        if self._drag_origin is None or self._last_pil is None:
            return "break"
        ox, oy = self._drag_origin
        px, py = self._drag_pan
        self._pan_x = px + int(event.x) - ox
        self._pan_y = py + int(event.y) - oy
        self._set_photo(self._last_pil, store=False)
        return "break"

    def _end_drag(self, _event: Any) -> str:
        self._drag_origin = None
        return "break"

    def zoom_in(self) -> None:
        """Increase preview scale; the page may become larger than the pane."""
        self._set_zoom(self._zoom * 1.25)

    def zoom_out(self) -> None:
        """Decrease preview scale, stopping at fit-to-window."""
        self._set_zoom(self._zoom / 1.25)

    def zoom_reset(self) -> None:
        """Restore the full-page fit view."""
        self._set_zoom(1.0)

    def _enqueue(self, cmd: str, payload: Any = None) -> None:
        if not self._enabled or self._closed:
            return
        self._q.put((cmd, payload))

    # --- public display API ---

    def show_page(self, image: Image.Image) -> None:
        if not self._enabled:
            return
        self._enqueue("show")
        self._enqueue("image", image.copy())

    def show_region(
        self,
        image: Image.Image,
        bbox: tuple[int, int, int, int],
        pad: int = DEFAULT_PAD,
        *,
        highlight: bool = True,
    ) -> None:
        """Show the full page fitted to the window, with the spoken bbox highlighted.

        ``pad`` is unused (kept for call-site compatibility); highlight uses a
        fixed outline width so the block stays visible at page scale.
        """
        del pad  # full-page fit; pad no longer crops
        if not self._enabled or self._Image is None or self._ImageDraw is None:
            return
        left, top, width, height = bbox
        page = image.convert("RGBA")
        if highlight and width > 0 and height > 0:
            overlay = self._Image.new("RGBA", page.size, (0, 0, 0, 0))
            draw = self._ImageDraw.Draw(overlay)
            x0 = max(0, left)
            y0 = max(0, top)
            x1 = min(page.width, left + width)
            y1 = min(page.height, top + height)
            if x1 > x0 and y1 > y0:
                draw.rectangle(
                    [x0, y0, x1, y1],
                    outline=(220, 40, 40, 255),
                    width=4,
                    fill=(255, 60, 60, 70),
                )
                page = self._Image.alpha_composite(page, overlay)
        page = page.convert("RGB")
        self._enqueue("show")
        self._enqueue("image", page)

    def set_caption(self, text: str) -> None:
        self._enqueue("caption", text or "")

    def set_position(self, text: str) -> None:
        self._enqueue("position", text or "")

    def set_status(self, text: str) -> None:
        self._enqueue("status", text or "")

    def show_message(self, text: str) -> None:
        """Show a status-line message (alias for set_status; thread-safe)."""
        self.set_status(text or "")

    def run_mainloop(self) -> None:
        """
        Run Tk mainloop on the calling thread (main_thread / owns-mainloop mode).

        Blocks until quit_mainloop() / window close / destroy.
        """
        if not self._enabled or self._root is None or self._closed:
            return
        self._owns_mainloop = True
        self._schedule_pump()
        try:
            self._root.mainloop()
        except Exception as exc:  # noqa: BLE001
            _warn_no_tk(f"tkinter mainloop error: {exc}")

    def quit_mainloop(self) -> None:
        """Ask the Tk mainloop to exit (safe from worker threads via after)."""
        root = self._root
        if root is None:
            return
        try:
            root.after(0, root.quit)
        except Exception:  # noqa: BLE001
            try:
                root.quit()
            except Exception:  # noqa: BLE001
                pass

    def close(self) -> None:
        if not self._enabled:
            return
        # Main-thread ownership: quit loop then destroy on this thread.
        if self._owns_mainloop and self._ui_thread is None:
            self.quit_mainloop()
            self._closed = True
            if self._root is not None:
                try:
                    self._root.destroy()
                except Exception:  # noqa: BLE001
                    pass
                self._root = None
            return
        self._enqueue("close")
        if self._ui_thread is not None and self._ui_thread.is_alive():
            self._ui_thread.join(timeout=1.5)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def __enter__(self) -> ReadingPreview:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def create_preview(
    *,
    enabled: bool,
    title: str = "Reading…",
    master: Any = None,
    run_ui_on_main: bool = False,
) -> ReadingPreview:
    """Factory used by CLI/GUI.

    Pass master=app for a Toplevel on the GUI root.
    Pass run_ui_on_main=True for CLI so Tk mainloop runs on the main thread
    (required for a visible window on Windows).
    """
    return ReadingPreview(
        enabled=enabled,
        title=title,
        master=master,
        main_thread=run_ui_on_main,
    )