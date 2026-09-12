"""Create a tiny synthetic image with clear printed-style text for OCR smoke tests."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    out = Path(__file__).resolve().parent / "sample_ocr.png"
    # Large enough for Tesseract; white background, black text
    img = Image.new("RGB", (640, 200), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 36)
    except OSError:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)
        except OSError:
            font = ImageFont.load_default()

    lines = [
        "Hello World",
        "OCR Read Aloud Test",
        "1234567890",
    ]
    y = 30
    for line in lines:
        draw.text((40, y), line, fill=(0, 0, 0), font=font)
        y += 50

    img.save(out)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
