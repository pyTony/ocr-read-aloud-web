"""Multi-column Letters-style reading order and no cross-gutter merge."""

from __future__ import annotations

import unittest

from PIL import Image

from ocr_read_aloud.ocr import OcrLine, lines_share_column, sort_lines_reading_order
from ocr_read_aloud.player import PageUnit, _merge_lines_to_chunks


class TestColumnOrder(unittest.TestCase):
    def test_three_col_letters_order(self) -> None:
        # Sparse PDF-style paragraph blocks (few per column)
        left = [
            OcrLine(text="Left letter one about disks.", left=40, top=100, width=160, height=40),
            OcrLine(text="Left letter two CA 91604", left=40, top=200, width=160, height=40),
        ]
        center = [
            OcrLine(text="Center letter mid page prose.", left=240, top=120, width=160, height=50),
            OcrLine(text="Center more after address.", left=240, top=220, width=160, height=40),
        ]
        right = [
            OcrLine(text="Right continuation worse.", left=440, top=300, width=160, height=40),
            OcrLine(text="Right bottom editorial end.", left=440, top=400, width=160, height=40),
        ]
        # Scrambled input order (as unordered PDF blocks)
        raw = [right[1], center[0], left[1], right[0], left[0], center[1]]
        ordered = sort_lines_reading_order(raw)
        texts = [ln.text for ln in ordered]
        # Left column fully before center before right
        self.assertLess(texts.index("Left letter one about disks."), texts.index("Center letter mid page prose."))
        self.assertLess(texts.index("Left letter two CA 91604"), texts.index("Center letter mid page prose."))
        self.assertLess(texts.index("Center more after address."), texts.index("Right continuation worse."))
        # Address before right-column "worse."
        self.assertLess(texts.index("Left letter two CA 91604"), texts.index("Right continuation worse."))

    def test_no_cross_column_merge(self) -> None:
        a = OcrLine(text="Left col.", left=40, top=100, width=150, height=20)
        b = OcrLine(text="Right col.", left=280, top=105, width=150, height=20)
        self.assertFalse(lines_share_column(a, b))
        chunks = _merge_lines_to_chunks([a, b])
        self.assertEqual(len(chunks), 2)


    def test_horizontal_split_above_before_below(self) -> None:
        """Two columns above a large gap, then a bottom block — all above first."""
        above_left = [
            OcrLine(text=f"AL{i}", left=40, top=80 + i * 20, width=160, height=14)
            for i in range(4)
        ]
        above_right = [
            OcrLine(text=f"AR{i}", left=280, top=90 + i * 20, width=160, height=14)
            for i in range(4)
        ]
        # Large unused vertical gap (~3× line height+) then bottom band
        below = [
            OcrLine(text=f"B{i}", left=40, top=420 + i * 22, width=400, height=16)
            for i in range(3)
        ]
        raw = list(reversed(below)) + list(reversed(above_right)) + list(reversed(above_left))
        ordered = sort_lines_reading_order(raw)
        texts = [ln.text for ln in ordered]
        above_texts = {ln.text for ln in above_left + above_right}
        below_texts = {ln.text for ln in below}
        last_above = max(i for i, t in enumerate(texts) if t in above_texts)
        first_below = min(i for i, t in enumerate(texts) if t in below_texts)
        self.assertLess(last_above, first_below)
        # All above present before any below
        for t in above_texts:
            self.assertIn(t, texts)
        for t in below_texts:
            self.assertIn(t, texts)


if __name__ == "__main__":
    unittest.main()
