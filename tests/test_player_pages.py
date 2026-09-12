"""Unit tests for PlaybackController append_page / replace_one_page_text."""

from __future__ import annotations

import time
import unittest

from PIL import Image

from ocr_read_aloud.ocr import OcrLine
from ocr_read_aloud.player import PageUnit, PlaybackController, _split_into_sentences


def _page(label: str, text: str) -> PageUnit:
    img = Image.new("RGB", (200, 100), color=(255, 255, 255))
    lines = [OcrLine(text=text, left=0, top=0, width=200, height=20)] if text else []
    return PageUnit(label=label, image=img, lines=lines)


class FakeSpeaker:
    def speak(self, text: str) -> None:
        pass

    def stop(self) -> None:
        pass


class TestPlaybackPageApis(unittest.TestCase):
    def test_append_page_does_not_jump_index(self) -> None:
        ctrl = PlaybackController([_page("p1", "hello")], FakeSpeaker())
        self.assertEqual(ctrl.page_count, 1)
        self.assertFalse(ctrl.proofread_done)
        ctrl.append_page(_page("p2", "world"))
        self.assertEqual(ctrl.page_count, 2)
        self.assertEqual(ctrl.page_index, 0)
        self.assertFalse(ctrl.proofread_done)

    def test_replace_one_page_text_marks_proofed(self) -> None:
        ctrl = PlaybackController(
            [_page("p1", "he11o"), _page("p2", "w0rld")], FakeSpeaker()
        )
        ctrl.replace_one_page_text(0, "hello")
        self.assertFalse(ctrl.proofread_done)
        self.assertIn("hello", ctrl.document_text())
        ctrl.replace_one_page_text(1, "world")
        self.assertTrue(ctrl.proofread_done)
        self.assertIn("world", ctrl.document_text())

    def test_replace_page_texts_uses_one_page_helper(self) -> None:
        ctrl = PlaybackController(
            [_page("p1", "a"), _page("p2", "b")], FakeSpeaker()
        )
        ctrl.replace_page_texts(["A", "B"])
        self.assertTrue(ctrl.proofread_done)
        doc = ctrl.document_text()
        self.assertIn("A", doc)
        self.assertIn("B", doc)

    def test_mark_page_proofed_and_expect_more(self) -> None:
        ctrl = PlaybackController([_page("p1", "x")], FakeSpeaker())
        ctrl.set_expect_more_pages(True)
        ctrl.mark_page_proofed(0)
        self.assertTrue(ctrl.proofread_done)
        ctrl.append_page(_page("p2", "y"))
        self.assertFalse(ctrl.proofread_done)
        ctrl.set_expect_more_pages(False)

    def test_split_into_sentences_still_works(self) -> None:
        sents = _split_into_sentences("First sentence here. Second one follows!")
        self.assertGreaterEqual(len(sents), 2)
        self.assertTrue(sents[0].startswith("First"))

    def test_sentence_breaks_on_period_but_not_on_short_comma_clause(self) -> None:
        sents = _split_into_sentences(
            "This is a longer clause, and it should stay together until the final period. "
            "Next sentence starts here."
        )
        self.assertGreaterEqual(len(sents), 2)
        self.assertTrue(any("This is a longer clause" in s for s in sents))
        self.assertTrue(any("Next sentence starts here." in s for s in sents))
        self.assertEqual(
            sum(1 for s in sents if "This is a longer clause" in s),
            1,
        )

    def test_junk_text_is_hidden_from_caption(self) -> None:
        page = _page("p1", "§§§ 12345 -- 999")
        ctrl = PlaybackController([page], FakeSpeaker())
        self.assertEqual(ctrl._current_sentence_text(page.lines[0]), "")

    def test_preview_caption_does_not_use_page_label_fallback(self) -> None:
        class FakePreview:
            def __init__(self) -> None:
                self.caption = None

            def set_caption(self, text: str) -> None:
                self.caption = text

        page = _page("Page 124 [PDF+OCR]", "§§§ 12345 -- 999")
        ctrl = PlaybackController([page], FakeSpeaker())
        fake = FakePreview()
        ctrl._preview = fake
        ctrl._page_idx = 0
        ctrl._line_idx = 0
        ctrl._refresh_preview(update_region=False)
        self.assertEqual(fake.caption, "")

    def test_debug_merge_format_marks_pdf_and_ocr(self) -> None:
        from ocr_read_aloud.ocr import format_debug_merge

        text = format_debug_merge("microprocessor witha", "microprocessor with a")
        self.assertIn("PDF:", text)
        self.assertIn("OCR:", text)

        hyphenated = format_debug_merge("state- of-the-art", "state-of-the-art")
        self.assertEqual("state-of-the-art", hyphenated)

        alt = format_debug_merge("a b", "c d", show_alternatives=True)
        self.assertIn("->", alt)

    def test_proof_cache_text_is_dehyphenated(self) -> None:
        page = _page("p1", "raw")
        ctrl = PlaybackController([page], FakeSpeaker())
        ctrl.replace_one_page_text(0, "state- of-the-art")
        self.assertIn("state-of-the-art", "\n".join(ln.text for ln in page.lines))

    def test_join_lines_keeps_lowercase_continuation_together(self) -> None:
        from ocr_read_aloud.text_clean import join_lines_dehyphenate

        joined = join_lines_dehyphenate([
            "microprocessor witha .",
            "method of inputing information",
        ])
        self.assertIn("microprocessor witha method", joined)
        self.assertIn("method of inputing information", joined)
        self.assertNotIn("witha . method", joined)

        sentence_join = join_lines_dehyphenate([
            "This ends here.",
            "Next sentence starts",
        ])
        self.assertIn("This ends here.", sentence_join)
        self.assertIn("Next sentence starts", sentence_join)

    def test_speakable_does_not_explode_paragraph(self) -> None:
        """One long OCR line with two sentences -> one speakable chunk (not many)."""
        img = Image.new("RGB", (400, 80), color=(255, 255, 255))
        text = (
            "Helsinki is the capital of Finland. "
            "It sits on the southern coast by the Baltic Sea."
        )
        page = PageUnit(
            label="p1",
            image=img,
            lines=[OcrLine(text=text, left=10, top=10, width=380, height=24)],
        )
        units = page.speakable
        self.assertEqual(len(units), 1)
        self.assertIn("Helsinki", units[0].text)
        self.assertIn("Baltic", units[0].text)
        self.assertGreaterEqual(len(_split_into_sentences(units[0].text)), 2)

    def test_replace_defers_while_speaking_same_page(self) -> None:
        ctrl = PlaybackController([_page("p1", "old text")], FakeSpeaker())
        ctrl._running = True
        ctrl._page_idx = 0
        ctrl._line_idx = 3
        ctrl.replace_one_page_text(0, "new proofed text")
        self.assertEqual(ctrl._pages[0].lines[0].text, "old text")
        self.assertEqual(ctrl._line_idx, 3)
        self.assertIn(0, ctrl._deferred_proof)
        ctrl._running = False
        ctrl._page_idx = 1  # simulate leaving page before flush
        ctrl._flush_deferred_proof(0)
        self.assertEqual(ctrl._pages[0].lines[0].text, "new proofed text")
        self.assertNotIn(0, ctrl._deferred_proof)

    def test_replace_applies_immediately_when_idle(self) -> None:
        ctrl = PlaybackController([_page("p1", "old")], FakeSpeaker())
        self.assertFalse(ctrl._running)
        ctrl.replace_one_page_text(0, "fresh")
        self.assertEqual(ctrl._pages[0].lines[0].text, "fresh")
        self.assertNotIn(0, ctrl._deferred_proof)

    def test_document_text_flushes_deferred(self) -> None:
        ctrl = PlaybackController([_page("p1", "raw")], FakeSpeaker())
        ctrl._running = True
        ctrl.replace_one_page_text(0, "proofed save me")
        self.assertEqual(ctrl._pages[0].lines[0].text, "raw")
        doc = ctrl.document_text()
        self.assertIn("proofed save me", doc)
        self.assertEqual(ctrl._pages[0].lines[0].text, "proofed save me")


class TestSentenceParagraphNav(unittest.TestCase):
    def test_sentences_at_and_clamp(self) -> None:
        text = "First sentence here. Second one follows! Third ends it."
        ctrl = PlaybackController([_page("p1", text)], FakeSpeaker())
        sents = ctrl._sentences_at(0, 0)
        self.assertGreaterEqual(len(sents), 3)
        ctrl._sent_idx = 99
        with ctrl._lock:
            ctrl._clamp_sent_idx()
        self.assertEqual(ctrl._sent_idx, len(sents) - 1)

    def test_fwd_steps_sentence_then_crosses_page(self) -> None:
        p1 = _page("p1", "Only one. And two.")
        p2 = _page("p2", "Next page sentence. Another here.")
        ctrl = PlaybackController([p1, p2], FakeSpeaker())
        self.assertEqual(ctrl._sent_idx, 0)
        ctrl.fwd()
        self.assertEqual(ctrl.page_index, 0)
        self.assertEqual(ctrl._sent_idx, 1)
        ctrl.fwd()  # cross to page 2, sentence 0
        self.assertEqual(ctrl.page_index, 1)
        self.assertEqual(ctrl.line_index, 0)
        self.assertEqual(ctrl._sent_idx, 0)
        ctrl.rew()  # back to page 1 last sentence
        self.assertEqual(ctrl.page_index, 0)
        self.assertEqual(ctrl._sent_idx, 1)

    def test_para_fwd_resets_sent_idx(self) -> None:
        # Two pages = two chunks after proof-style single-line pages
        ctrl = PlaybackController(
            [_page("p1", "Alpha one. Alpha two."), _page("p2", "Beta one.")],
            FakeSpeaker(),
        )
        ctrl.fwd()
        self.assertEqual(ctrl._sent_idx, 1)
        ctrl.para_fwd()
        self.assertEqual(ctrl.page_index, 1)
        self.assertEqual(ctrl._sent_idx, 0)
        ctrl.para_rew()
        self.assertEqual(ctrl.page_index, 0)
        self.assertEqual(ctrl._sent_idx, 0)

    def test_page_down_resets_sent_idx(self) -> None:
        ctrl = PlaybackController(
            [_page("p1", "A. B."), _page("p2", "C.")], FakeSpeaker()
        )
        ctrl.fwd()
        self.assertEqual(ctrl._sent_idx, 1)
        ctrl.page_down()
        self.assertEqual(ctrl.page_index, 1)
        self.assertEqual(ctrl._sent_idx, 0)

    def test_position_label_includes_sent(self) -> None:
        ctrl = PlaybackController(
            [_page("Page 1", "Hello there. More words follow.")], FakeSpeaker()
        )
        label = ctrl.position_label()
        self.assertIn("para", label)
        self.assertIn("sent", label)
        self.assertIn("page", label)

    def test_preview_keybinds_sentence_and_para(self) -> None:
        """Ast-parse preview bindings: arrows=sentence, Tab/Up=paragraph, Prior=page."""
        import ast
        from pathlib import Path as P

        src = P(__file__).resolve().parents[1] / "ocr_read_aloud" / "preview.py"
        tree = ast.parse(src.read_text(encoding="utf-8"))
        binds: dict[str, str] = {}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            # bind_cmd("<Left>", "rew")
            if isinstance(node.func, ast.Name) and node.func.id == "bind_cmd":
                if len(node.args) >= 2 and all(
                    isinstance(a, ast.Constant) for a in node.args[:2]
                ):
                    binds[node.args[0].value] = node.args[1].value
        self.assertEqual(binds.get("<Left>"), "rew")
        self.assertEqual(binds.get("<Right>"), "fwd")
        self.assertEqual(binds.get("<Up>"), "para_rew")
        self.assertEqual(binds.get("<Down>"), "para_fwd")
        self.assertEqual(binds.get("<Tab>"), "para_fwd")
        self.assertEqual(binds.get("<Shift-Tab>"), "para_rew")
        self.assertEqual(binds.get("<Prior>"), "page_up")
        self.assertEqual(binds.get("<Next>"), "page_down")
        # Up/Down must NOT be page
        self.assertNotEqual(binds.get("<Up>"), "page_up")
        self.assertNotEqual(binds.get("<Down>"), "page_down")




class TestCaptionSentIdx(unittest.TestCase):
    def test_speak_per_sentence_advances_sent_idx(self) -> None:
        """Each Speak() advances _sent_idx so pause/resume/←→ stay in lockstep."""

        class RecordingSpeaker:
            def __init__(self) -> None:
                self.calls: list[str] = []

            def speak(self, text: str) -> None:
                self.calls.append(text)

            def stop(self) -> None:
                pass

        page = _page(
            "p1",
            "First sentence here. Second sentence follows. Third sentence ends.",
        )
        spk = RecordingSpeaker()
        ctrl = PlaybackController([page], spk)
        with ctrl._lock:
            ctrl._sent_idx = 0
            ctrl._line_idx = 0
            ctrl._page_idx = 0
        done = ctrl._speak_chunk_with_caption(page.speakable[0].text)
        self.assertTrue(done)
        self.assertEqual(len(spk.calls), 3)
        self.assertGreaterEqual(ctrl._sent_idx, 2)
        self.assertTrue(spk.calls[0].startswith("First"))
        self.assertTrue(spk.calls[1].startswith("Second"))

    def test_pause_keeps_sent_idx_on_speaking_sentence(self) -> None:
        class SlowSpeaker:
            def __init__(self) -> None:
                self._stop = False
                self.calls: list[str] = []

            def speak(self, text: str) -> None:
                self.calls.append(text)
                for _ in range(12):
                    if self._stop:
                        return
                    time.sleep(0.05)

            def stop(self) -> None:
                self._stop = True

        page = _page(
            "p1",
            "Alpha one. Bravo two. Charlie three. Delta four.",
        )
        spk = SlowSpeaker()
        ctrl = PlaybackController([page], spk)
        import threading

        t = threading.Thread(
            target=ctrl._speak_chunk_with_caption,
            args=(page.speakable[0].text,),
            daemon=True,
        )
        t.start()
        # Wait until second sentence Speak has started
        deadline = time.time() + 2.0
        while time.time() < deadline and len(spk.calls) < 2:
            time.sleep(0.02)
        ctrl.pause()
        t.join(timeout=2.0)
        # Pause leaves _sent_idx on the sentence that was speaking
        self.assertGreaterEqual(ctrl._sent_idx, 1)
        self.assertGreaterEqual(len(spk.calls), 2)
        self.assertEqual(
            ctrl._current_sentence_text(),
            ctrl._current_sentence_text(page.speakable[0]),
        )

    def test_seek_mid_chunk_breaks_without_clobber(self) -> None:
        """If ←→ changes _sent_idx mid-chunk, break and leave that index."""

        class SlowSpeaker:
            def __init__(self) -> None:
                self._stop = False
                self.calls: list[str] = []
                self.on_second = None  # optional callback fired on 2nd Speak

            def speak(self, text: str) -> None:
                self.calls.append(text)
                if len(self.calls) == 2 and self.on_second is not None:
                    self.on_second()
                for _ in range(20):
                    if self._stop:
                        return
                    time.sleep(0.02)

            def stop(self) -> None:
                self._stop = True

        page = _page(
            "p1",
            "Alpha one. Bravo two. Charlie three. Delta four.",
        )
        spk = SlowSpeaker()
        ctrl = PlaybackController([page], spk)

        def seek_fwd() -> None:
            ctrl.fwd()

        spk.on_second = seek_fwd
        done = ctrl._speak_chunk_with_caption(page.speakable[0].text)
        self.assertFalse(done)
        # fwd from sentence 1 (0-based) → sentence 2
        self.assertEqual(ctrl._sent_idx, 2)



class TestGotoPage(unittest.TestCase):
    def test_start_page_guard_rejects_mismatched_first_folio(self) -> None:
        from ocr_read_aloud.cli import assert_requested_start_page

        with self.assertRaisesRegex(AssertionError, "Requested start page 124.*Page 130.*folio 130"):
            assert_requested_start_page("Page 130", 124)

    def test_goto_page_prefers_folio_and_ignores_index_fallback_when_folios_exist(self) -> None:
        pages = [
            _page("Page 10", "alpha"),
            _page("Page 11", "bravo"),
            _page("Page 124", "charlie"),
        ]
        ctrl = PlaybackController(pages, FakeSpeaker())
        self.assertTrue(ctrl.goto_page(124))
        self.assertEqual(ctrl.page_index, 2)
        self.assertFalse(ctrl.goto_page(1))  # real folio numbers in session win over local index fallback
        self.assertEqual(ctrl.page_index, 2)
        self.assertTrue(ctrl.goto_page(11))  # folio match
        self.assertEqual(ctrl.page_index, 1)
        self.assertFalse(ctrl.goto_page(999))

    def test_goto_page_uses_index_fallback_for_unlabeled_sessions(self) -> None:
        pages = [_page("p1", "alpha"), _page("p2", "bravo")]
        ctrl = PlaybackController(pages, FakeSpeaker())
        self.assertTrue(ctrl.goto_page(1))
        self.assertEqual(ctrl.page_index, 0)

    def test_partial_session_start_page_stays_on_requested_folio(self) -> None:
        pages = [
            _page("Page 124", "alpha"),
            _page("Page 125", "bravo"),
            _page("Page 126", "charlie"),
        ]
        ctrl = PlaybackController(pages, FakeSpeaker())
        self.assertEqual(ctrl.page_index, 0)
        self.assertEqual(ctrl._pages[ctrl.page_index].label, "Page 124")
        self.assertTrue(ctrl.goto_page(124))
        self.assertEqual(ctrl.page_index, 0)
        self.assertEqual(ctrl._pages[ctrl.page_index].label, "Page 124")

    def test_auto_ad_skip_can_be_disabled(self) -> None:
        pages = [
            _page("Page 124", "This is ordinary article copy."),
            _page("Page 125", "BUY NOW! LIMITED TIME OFFER! FREE SHIPPING!"),
            _page("Page 126", "More article text."),
        ]
        ctrl = PlaybackController(pages, FakeSpeaker())
        ctrl._auto_ad_skip = False
        ctrl._page_idx = 0
        ctrl._line_idx = 0
        ctrl._after_nav_page_change(0)
        self.assertEqual(ctrl.page_index, 0)
        self.assertEqual(ctrl._pages[ctrl.page_index].label, "Page 124")


if __name__ == "__main__":
    unittest.main()
