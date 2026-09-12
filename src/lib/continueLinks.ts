import { PageUnit } from '../types';

const CONTINUED_ON_REGEX = /(?:continued|cont(?:'?d|d)?\.?)\s+on\s+(?:(?:page|p\.?|pg\.?)\s*)?(\d{1,4})/gi;
const CONTINUED_FROM_REGEX = /(?:continued|cont(?:'?d|d)?\.?)\s+from\s+(?:(?:page|p\.?|pg\.?)\s*)?(\d{1,4})/gi;
const PAGE_LABEL_REGEX = /^\s*page\s+(\d+)\b/i;
const FOLIO_LINE_REGEX = /^\s*(?:[—\-–~•·*]+\s*)?(\d{1,4})(?:\s*[—\-–~•·*]+)?\s*$/;

export function parseContinuedOn(text: string): number[] {
  if (!text) return [];
  const matches = [...text.matchAll(CONTINUED_ON_REGEX)];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const m of matches) {
    const num = parseInt(m[1], 10);
    if (!isNaN(num) && !seen.has(num)) {
      seen.add(num);
      out.push(num);
    }
  }
  return out;
}

export function parseContinuedFrom(text: string): number[] {
  if (!text) return [];
  const matches = [...text.matchAll(CONTINUED_FROM_REGEX)];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const m of matches) {
    const num = parseInt(m[1], 10);
    if (!isNaN(num) && !seen.has(num)) {
      seen.add(num);
      out.push(num);
    }
  }
  return out;
}

export function pdfPageNumberFromLabel(label: string): number | null {
  if (!label) return null;
  const m = label.trim().match(PAGE_LABEL_REGEX);
  if (m) {
    const n = parseInt(m[1], 10);
    return isNaN(n) ? null : n;
  }
  // Try generic digit
  const d = label.match(/(\d+)/);
  if (d) {
    const n = parseInt(d[1], 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

export function folioNearEdges(text: string, folio: number): boolean {
  if (!text) return false;
  const lines = text.split('\n').map(ln => ln.trim()).filter(Boolean);
  if (lines.length) {
    const edges = [...lines.slice(0, 3), ...lines.slice(-3)];
    for (const ln of edges) {
      const m = ln.match(FOLIO_LINE_REGEX);
      if (m && parseInt(m[1], 10) === folio) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Detect the printed-vs-PDF page offset (printed = pdf_index - offset).
 */
export function computeFolioOffset(pages: PageUnit[]): number {
  for (const page of pages) {
    const pdfIdx = pdfPageNumberFromLabel(page.label);
    if (pdfIdx === null) continue;

    // Check lines for folio
    for (const line of page.lines) {
      const m = line.text.trim().match(FOLIO_LINE_REGEX);
      if (m) {
        const folio = parseInt(m[1], 10);
        const offset = pdfIdx - folio;
        if (offset >= -15 && offset <= 15) {
          return offset;
        }
      }
    }
  }
  return 0;
}

export function continuedFromLineIndex(page: PageUnit, sourceFolio: number | null): number {
  const texts = page.chunks.length ? page.chunks.map(c => c.text) : page.lines.map(l => l.text);
  if (sourceFolio !== null) {
    for (let i = 0; i < texts.length; i++) {
      if (parseContinuedFrom(texts[i]).includes(sourceFolio)) {
        return i;
      }
    }
  }
  for (let i = 0; i < texts.length; i++) {
    if (parseContinuedFrom(texts[i]).length > 0) {
      return i;
    }
  }
  return 0;
}

/**
 * Find page and chunk index for "continued on page N" jump.
 */
export function findContinueLanding(
  pages: PageUnit[],
  targetFolio: number,
  sourceFolio: number | null,
  offset?: number
): { pageIndex: number; chunkIndex: number } | null {
  if (!pages.length) return null;
  const docOffset = offset !== undefined ? offset : computeFolioOffset(pages);
  const targetPdf = targetFolio + docOffset;

  // Priority 1: Direct target PDF page label match
  for (let i = 0; i < pages.length; i++) {
    const labelN = pdfPageNumberFromLabel(pages[i].label);
    if (labelN === targetPdf || labelN === targetFolio) {
      return {
        pageIndex: i,
        chunkIndex: continuedFromLineIndex(pages[i], sourceFolio),
      };
    }
  }

  // Priority 2: Pages with continued-from cues that match source folio
  for (let i = 0; i < pages.length; i++) {
    const froms = parseContinuedFrom(pages[i].rawText);
    if (sourceFolio !== null && froms.includes(sourceFolio)) {
      return {
        pageIndex: i,
        chunkIndex: continuedFromLineIndex(pages[i], sourceFolio),
      };
    }
  }

  // Priority 3: Clear printed folio near edges in OCR text
  for (let i = 0; i < pages.length; i++) {
    if (folioNearEdges(pages[i].rawText, targetFolio)) {
      return {
        pageIndex: i,
        chunkIndex: continuedFromLineIndex(pages[i], sourceFolio),
      };
    }
  }

  return null;
}
