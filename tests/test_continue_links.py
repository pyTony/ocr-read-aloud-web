"""Tests for magazine continued-on/from parsing and landing."""

from __future__ import annotations

import unittest

from PIL import Image

from ocr_read_aloud.continue_links import (
    find_continue_landing,
    parse_continued_from,
    parse_continued_on,
    pdf_page_number_from_label,
)
from ocr_read_aloud.ocr import OcrLine
from ocr_read_aloud.player import PageUnit, PlaybackController


def _page(label: str, text: str) -> PageUnit:
    img = Image.new("RGB", (200, 100), color=(255, 255, 255))
    lines = [OcrLine(text=text, left=0, top=0, width=200, height=20)] if text else []
    return PageUnit(label=label, image=img, lines=lines)


def _page_lines(label: str, texts: list[str]) -> PageUnit:
    img = Image.new("RGB", (200, 200), color=(255, 255, 255))
    lines = [
        OcrLine(text=t, left=0, top=i * 30, width=200, height=20)
        for i, t in enumerate(texts)
    ]
    return PageUnit(label=label, image=img, lines=lines)


class FakeSpeaker:
    def speak(self, text: str) -> None:
        pass

    def stop(self) -> None:
        pass


class TestParseContinued(unittest.TestCase):
    def test_continued_on_variants(self) -> None:
        cases = [
            ("… story continued on page 108.", [108]),
            ("Continued on p. 108", [108]),
            ("cont. on page 108", [108]),
            ("continued on 108", [108]),
            ("CONT. ON PAGE 12", [12]),
            ("no jump here", []),
            ("continued on page 3 and continued on p. 99", [3, 99]),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(parse_continued_on(text), expected)

    def test_continued_from_variants(self) -> None:
        cases = [
            ("continued from page 14", [14]),
            ("Continued from p. 14 — more body", [14]),
            ("cont. from page 14", [14]),
            ("continued from 14", [14]),
            ("nothing", []),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(parse_continued_from(text), expected)

    def test_pdf_page_number_from_label(self) -> None:
        self.assertEqual(pdf_page_number_from_label("Page 14"), 14)
        self.assertEqual(pdf_page_number_from_label("page 108"), 108)
        self.assertEqual(pdf_page_number_from_label("Page 3 · scan"), 3)
        self.assertIsNone(pdf_page_number_from_label("cover"))
        self.assertIsNone(pdf_page_number_from_label(""))


class TestFindContinueLanding(unittest.TestCase):
    def test_prefers_continued_from_over_bare_label(self) -> None:
        """Source match on continued-from beats a bare Page N label."""
        pages = [
            _page("Page 14", "End of part one. Continued on page 108."),
            _page("Page 108", "Unrelated page with no continue cue."),
            _page(
                "Page 200",
                "continued from page 14\nThe story resumes here with more text.",
            ),
        ]
        landing = find_continue_landing(pages, target_folio=108, source_folio=14)
        self.assertIsNotNone(landing)
        assert landing is not None
        page_idx, line_idx = landing
        self.assertEqual(page_idx, 2)  # Page 200 with continued from 14
        self.assertIn("continued from", pages[page_idx].speakable[line_idx].text.lower())

    def test_example_page_14_to_108(self) -> None:
        pages = [
            _page("Page 14", "… the adventure continued on page 108"),
            _page(
                "Page 108",
                "continued from page 14 The hero stepped into the light.",
            ),
        ]
        landing = find_continue_landing(pages, target_folio=108, source_folio=14)
        self.assertEqual(landing, (1, 0))
        # Landing line contains continued from
        assert landing is not None
        self.assertIn(
            "continued from",
            pages[landing[0]].speakable[landing[1]].text.lower(),
        )

    def test_falls_back_to_pdf_label(self) -> None:
        pages = [
            _page("Page 14", "continued on page 108"),
            _page("Page 108", "Body with no continued-from header."),
        ]
        landing = find_continue_landing(pages, target_folio=108, source_folio=14)
        self.assertEqual(landing, (1, 0))

    def test_folio_near_edge(self) -> None:
        pages = [
            _page("Page 50", "— 108 —\ncontinued from page 14\nBody text."),
        ]
        # Label is not 108, but clear folio + continued from source
        landing = find_continue_landing(pages, target_folio=108, source_folio=14)
        self.assertIsNotNone(landing)
        assert landing is not None
        self.assertEqual(landing[0], 0)

    def test_line_index_points_at_continued_from_chunk(self) -> None:
        pages = [
            _page_lines(
                "Page 108",
                [
                    "Magazine header junk",
                    "continued from page 14",
                    "Then the body of the story continues at length.",
                ],
            )
        ]
        landing = find_continue_landing(pages, target_folio=108, source_folio=14)
        self.assertIsNotNone(landing)
        assert landing is not None
        _pi, li = landing
        texts = [ln.text for ln in pages[0].speakable]
        # Merging may combine lines; ensure we land on a chunk containing the cue
        self.assertIn("continued from", texts[li].lower())

    def test_not_found(self) -> None:
        pages = [_page("Page 1", "hello world")]
        self.assertIsNone(
            find_continue_landing(pages, target_folio=108, source_folio=14)
        )


class TestJumpContinueController(unittest.TestCase):
    def test_current_continue_target_from_refresh(self) -> None:
        pages = [
            _page("Page 14", "Story end. Continued on page 108."),
            _page("Page 108", "continued from page 14 Body."),
        ]
        ctrl = PlaybackController(pages, FakeSpeaker())
        ctrl._refresh_preview(update_region=False)
        target = ctrl.current_continue_target()
        self.assertIsNotNone(target)
        assert target is not None
        self.assertEqual(target[0], 108)
        self.assertEqual(target[1], 14)

    def test_jump_continue_lands_on_from_page(self) -> None:
        pages = [
            _page("Page 14", "… continued on page 108"),
            _page("Page 108", "continued from page 14 More story."),
        ]
        ctrl = PlaybackController(pages, FakeSpeaker())
        ctrl._refresh_preview(update_region=False)
        ok = ctrl.jump_continue()
        self.assertTrue(ok)
        self.assertEqual(ctrl.page_index, 1)

    def test_pending_continue_waits_then_jumps(self) -> None:
        pages = [_page("Page 14", "… continued on page 108")]
        ctrl = PlaybackController(pages, FakeSpeaker())
        ctrl.set_expect_more_pages(True)
        ctrl._refresh_preview(update_region=False)
        ok = ctrl.jump_continue()
        self.assertFalse(ok)
        self.assertEqual(ctrl.page_index, 0)
        self.assertIsNotNone(ctrl._pending_continue)
        ctrl.append_page(_page("Page 108", "continued from page 14 Body."))
        self.assertEqual(ctrl.page_index, 1)
        self.assertIsNone(ctrl._pending_continue)

    def test_not_found_after_load_complete(self) -> None:
        pages = [_page("Page 14", "continued on page 108")]
        ctrl = PlaybackController(pages, FakeSpeaker())
        ctrl.set_expect_more_pages(True)
        ctrl._refresh_preview(update_region=False)
        self.assertFalse(ctrl.jump_continue())
        ctrl.set_expect_more_pages(False)
        self.assertIsNone(ctrl._pending_continue)

    def test_jump_continue_then_back_to_origin(self) -> None:
        """Cont→ stores origin; same control returns with ←Back (no chain)."""
        pages = [
            _page("Page 14", "… continued on page 108"),
            _page("Page 108", "continued from page 14 More story. Continued on page 200."),
            _page("Page 200", "continued from page 108 Tail."),
        ]
        ctrl = PlaybackController(pages, FakeSpeaker())
        ctrl._refresh_preview(update_region=False)
        self.assertEqual(ctrl.continue_button_mode(), "forward")
        self.assertTrue(ctrl.jump_continue())
        self.assertEqual(ctrl.page_index, 1)
        self.assertEqual(ctrl._resume_after_continue, (0, 0))
        self.assertEqual(ctrl.continue_button_mode(), "resume")
        # Same button must resume, not chain Cont→200
        self.assertTrue(ctrl.jump_continue())
        self.assertEqual(ctrl.page_index, 0)
        self.assertIsNone(ctrl._resume_after_continue)
        self.assertEqual(ctrl.continue_button_mode(), "forward")


if __name__ == "__main__":
    unittest.main()
