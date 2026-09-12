from pathlib import Path

from PIL import Image

from ocr_read_aloud import ocr
from ocr_read_aloud.ocr import OcrLine


def test_iter_ocr_pages_force_ocr_ignores_pdf_text(monkeypatch, tmp_path):
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"not-a-real-pdf")

    def fake_iter_pdf_pages_with_lines(path, *, dpi, start_page=1, end_page=None):
        assert path == pdf_path
        yield 1, Image.new("RGB", (20, 20), "white"), [
            OcrLine(text="bad pdf text", left=0, top=0, width=20, height=20)
        ]

    def fake_ocr_image_lines(img, lang="fin+eng"):
        assert img.size == (20, 20)
        return [OcrLine(text="real ocr text", left=0, top=0, width=20, height=20)]

    monkeypatch.setattr(ocr, "ocr_image_lines", fake_ocr_image_lines)
    import ocr_read_aloud.pdf_pages as pdf_pages

    monkeypatch.setattr(pdf_pages, "iter_pdf_pages_with_lines", fake_iter_pdf_pages_with_lines)

    got = list(ocr.iter_ocr_pages(pdf_path, lang="fin+eng", force_ocr=True))

    assert len(got) == 1
    assert got[0][2][0].text == "real ocr text"


def test_pdf_text_and_ocr_merge_keeps_better_word(monkeypatch, tmp_path):
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"not-a-real-pdf")

    def fake_iter_pdf_pages_with_lines(path, *, dpi, start_page=1, end_page=None):
        yield 1, Image.new("RGB", (40, 40), "white"), [
            OcrLine(text="The br0wn fox", left=0, top=0, width=40, height=20)
        ]

    def fake_ocr_image_lines(img, lang="fin+eng"):
        return [OcrLine(text="The brown fox", left=0, top=0, width=40, height=20)]

    monkeypatch.setattr(ocr, "ocr_image_lines", fake_ocr_image_lines)
    import ocr_read_aloud.pdf_pages as pdf_pages

    monkeypatch.setattr(pdf_pages, "iter_pdf_pages_with_lines", fake_iter_pdf_pages_with_lines)

    got = list(ocr.iter_ocr_pages(pdf_path, lang="fin+eng"))

    assert len(got) == 1
    assert got[0][2][0].text == "The brown fox"


def test_junk_pdf_text_is_ignored_in_favor_of_ocr(monkeypatch, tmp_path):
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"not-a-real-pdf")

    def fake_iter_pdf_pages_with_lines(path, *, dpi, start_page=1, end_page=None):
        yield 1, Image.new("RGB", (40, 40), "white"), [
            OcrLine(text="§§§ 12345 |||", left=0, top=0, width=40, height=20)
        ]

    def fake_ocr_image_lines(img, lang="fin+eng"):
        return [OcrLine(text="This is readable text", left=0, top=0, width=40, height=20)]

    monkeypatch.setattr(ocr, "ocr_image_lines", fake_ocr_image_lines)
    import ocr_read_aloud.pdf_pages as pdf_pages

    monkeypatch.setattr(pdf_pages, "iter_pdf_pages_with_lines", fake_iter_pdf_pages_with_lines)

    got = list(ocr.iter_ocr_pages(pdf_path, lang="fin+eng"))

    assert len(got) == 1
    assert got[0][2][0].text == "This is readable text"
