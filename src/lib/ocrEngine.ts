import { OcrLine, PageUnit } from '../types';
import { mergeLinesToChunks, sortLinesReadingOrder } from './layoutAndColumns';
import { parseContinuedFrom, parseContinuedOn } from './continueLinks';
import { looksLikeAd } from './adDetection';
import { inferPageTitle } from './articleExport';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - Vite ?url asset import
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set up PDF.js worker using local bundled same-origin asset
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

/**
 * Load and render a PDF document into PageUnit objects.
 * Uses extractable PDF text layers with coordinates if available,
 * and renders high-res page images for preview.
 */
export async function processPdfFile(
  file: File,
  onProgress?: (current: number, total: number, status: string) => void
): Promise<PageUnit[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages: PageUnit[] = [];

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(i, numPages, `Rendering and extracting page ${i} of ${numPages}...`);
    const page = await pdf.getPage(i);

    // Compute sharp viewport scale (target ~1400px width for crystal clear text)
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const targetWidth = 1400;
    const computedScale = Math.min(2.5, Math.max(1.25, targetWidth / (unscaledViewport.width || 612)));
    const rotation = page.rotate || 0;
    const viewport = page.getViewport({ scale: computedScale, rotation });

    // Render entire page to canvas
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');

    if (ctx) {
      // Solid white background to ensure scanned or transparent PDFs render cleanly
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    }
    const pageImage = canvas.toDataURL('image/jpeg', 0.88);

    // Extract text content with precise coordinates
    const textContent = await page.getTextContent();
    const rawLines: OcrLine[] = [];

    // Collect all valid text items with canvas coordinates
    interface SpanItem {
      text: string;
      x0: number;
      x1: number;
      y0: number;
      y1: number;
      fontSize: number;
      hasEOL: boolean;
    }
    const spans: SpanItem[] = [];

    for (const item of textContent.items) {
      if ('str' in item && item.str.trim()) {
        const tx = item.transform;
        // Transform user-space coordinates to canvas coordinates using PDF.js utility
        const [x0, yBaseline] = pdfjsLib.Util.applyTransform([tx[4], tx[5]], viewport.transform);
        const fontSize = Math.max(10, Math.hypot(tx[2], tx[3]) * computedScale || (item.height || 12) * computedScale);
        const itemW = Math.max(8, item.width * computedScale);
        const y0 = Math.max(0, yBaseline - fontSize);
        const y1 = yBaseline + Math.max(2, fontSize * 0.2);

        spans.push({
          text: item.str,
          x0: Math.round(x0),
          x1: Math.round(x0 + itemW),
          y0: Math.round(y0),
          y1: Math.round(y1),
          fontSize: Math.round(fontSize),
          hasEOL: !!(item as any).hasEOL,
        });
      }
    }

    // Sort spans top-to-bottom, then left-to-right
    spans.sort((a, b) => {
      const dy = a.y0 - b.y0;
      if (Math.abs(dy) > Math.min(a.fontSize, b.fontSize) * 0.6) {
        return dy;
      }
      return a.x0 - b.x0;
    });

    // Group spans into distinct lines avoiding cross-column bridging
    interface LineGroup {
      text: string;
      x0: number;
      x1: number;
      y0: number;
      y1: number;
      fontSize: number;
    }
    const lineGroups: LineGroup[] = [];

    for (const span of spans) {
      let matchedGroup: LineGroup | null = null;

      // Find an existing line group on roughly the same baseline
      for (let j = lineGroups.length - 1; j >= 0; j--) {
        const g = lineGroups[j];
        const yDiff = Math.abs(g.y0 - span.y0);
        const fontRef = Math.max(g.fontSize, span.fontSize);

        // Same line if vertical difference is small
        if (yDiff <= fontRef * 0.6) {
          // Check horizontal adjacency (prevent merging two distinct columns)
          // Normal word gap is typically < 2.5x font size. A column gutter is usually larger.
          const xGap = span.x0 - g.x1;
          if (xGap >= -4 && xGap <= Math.max(28, fontRef * 2.2)) {
            matchedGroup = g;
            break;
          }
        }
      }

      if (matchedGroup) {
        matchedGroup.text += ' ' + span.text;
        matchedGroup.x0 = Math.min(matchedGroup.x0, span.x0);
        matchedGroup.x1 = Math.max(matchedGroup.x1, span.x1);
        matchedGroup.y0 = Math.min(matchedGroup.y0, span.y0);
        matchedGroup.y1 = Math.max(matchedGroup.y1, span.y1);
      } else {
        lineGroups.push({
          text: span.text,
          x0: span.x0,
          x1: span.x1,
          y0: span.y0,
          y1: span.y1,
          fontSize: span.fontSize,
        });
      }
    }

    for (const g of lineGroups) {
      const text = g.text.trim();
      if (!text) continue;
      rawLines.push({
        text,
        left: Math.max(0, g.x0),
        top: Math.max(0, g.y0),
        width: Math.max(16, g.x1 - g.x0),
        height: Math.max(14, g.y1 - g.y0),
        confidence: 99,
      });
    }

    // Scanned PDF Fallback: if no embedded text found and page 1, run Tesseract OCR
    if (rawLines.length === 0 && i === 1) {
      try {
        onProgress?.(i, numPages, `Page 1 is scanned (no text layer) · Performing OCR...`);
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng', 1);
        const ocrRes = await worker.recognize(canvas);
        await worker.terminate();

        if (ocrRes.data?.lines) {
          for (const l of ocrRes.data.lines) {
            if (!l.text.trim()) continue;
            rawLines.push({
              text: l.text.trim(),
              left: Math.max(0, Math.round(l.bbox.x0)),
              top: Math.max(0, Math.round(l.bbox.y0)),
              width: Math.max(16, Math.round(l.bbox.x1 - l.bbox.x0)),
              height: Math.max(14, Math.round(l.bbox.y1 - l.bbox.y0)),
              confidence: l.confidence,
            });
          }
        }
      } catch (ocrErr) {
        console.warn(`OCR fallback on scanned PDF page ${i} failed:`, ocrErr);
      }
    }

    const orderedLines = sortLinesReadingOrder(rawLines);
    const chunks = mergeLinesToChunks(orderedLines);
    const fullText = chunks.map(c => c.text).join('\n\n');

    const unit: PageUnit = {
      pageNumber: i,
      label: `Page ${i}`,
      image: pageImage,
      width: Math.ceil(viewport.width),
      height: Math.ceil(viewport.height),
      lines: orderedLines,
      chunks,
      rawText: fullText,
      isProofread: false,
      skipAsAd: false,
      adReasons: [],
      inferredTitle: '',
      continuedOn: parseContinuedOn(fullText),
      continuedFrom: parseContinuedFrom(fullText),
    };

    const adEval = looksLikeAd(unit);
    unit.skipAsAd = adEval.isAd;
    unit.adReasons = adEval.reasons;
    unit.inferredTitle = inferPageTitle(unit, `Page ${i}`);

    pages.push(unit);
  }

  return pages;
}

/**
 * Perform client-side OCR on an image file (PNG/JPEG) using Tesseract.js
 */
export async function processImageWithOcr(
  file: File,
  lang: string = 'eng',
  onProgress?: (progress: number, status: string) => void
): Promise<PageUnit> {
  // Read image dimensions and data URL
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });

  const img = new Image();
  await new Promise((resolve) => {
    img.onload = resolve;
    img.src = dataUrl;
  });

  const width = img.naturalWidth || 800;
  const height = img.naturalHeight || 1100;

  onProgress?.(0.1, 'Initializing Tesseract OCR engine...');
  const { createWorker } = await import('tesseract.js');

  const tesseractLang = lang === 'fin+eng' ? 'fin+eng' : lang === 'fin' ? 'fin' : 'eng';
  const worker = await createWorker(tesseractLang, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress?.(m.progress, `OCR recognizing text (${Math.round(m.progress * 100)}%)...`);
      } else {
        onProgress?.(0.2, m.status);
      }
    },
  });

  const ret = await worker.recognize(file);
  await worker.terminate();

  const rawLines: OcrLine[] = [];
  if (ret.data && ret.data.lines) {
    for (const l of ret.data.lines) {
      if (!l.text.trim()) continue;
      rawLines.push({
        text: l.text.trim(),
        left: l.bbox.x0,
        top: l.bbox.y0,
        width: l.bbox.x1 - l.bbox.x0,
        height: l.bbox.y1 - l.bbox.y0,
        confidence: l.confidence,
      });
    }
  }

  const orderedLines = sortLinesReadingOrder(rawLines);
  const chunks = mergeLinesToChunks(orderedLines);
  const fullText = chunks.length ? chunks.map(c => c.text).join('\n\n') : ret.data.text;

  const unit: PageUnit = {
    pageNumber: 1,
    label: file.name.replace(/\.[^/.]+$/, ''),
    image: dataUrl,
    width,
    height,
    lines: orderedLines,
    chunks,
    rawText: fullText,
    isProofread: false,
    skipAsAd: false,
    adReasons: [],
    inferredTitle: '',
    continuedOn: parseContinuedOn(fullText),
    continuedFrom: parseContinuedFrom(fullText),
  };

  const adEval = looksLikeAd(unit);
  unit.skipAsAd = adEval.isAd;
  unit.adReasons = adEval.reasons;
  unit.inferredTitle = inferPageTitle(unit, unit.label);

  return unit;
}
