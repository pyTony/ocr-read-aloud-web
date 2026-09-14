import { OcrLine } from '../types';
import { joinLinesDehyphenate, repairSplitWordsAndDehyphenate } from './textClean';

export function linesShareColumn(a: OcrLine, b: OcrLine): boolean {
  const a0 = a.left;
  const a1 = a.left + a.width;
  const b0 = b.left;
  const b1 = b.left + b.width;
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  const minW = Math.max(1.0, Math.min(a.width, b.width));
  const maxW = Math.max(1.0, Math.max(a.width, b.width));

  // If there is no horizontal overlap or negative overlap (column gutter), never merge across columns
  if (overlap < 0.2 * minW) {
    return false;
  }
  const gap = Math.max(0.0, Math.max(a0, b0) - Math.min(a1, b1));
  if (gap > 15.0) {
    return false;
  }
  return overlap >= 0.2 * minW;
}

function lineMidX(ln: OcrLine): number {
  return ln.left + ln.width / 2.0;
}

/**
 * Cluster 1D centers into columns at large gaps
 */
function clusterColumnsByCenters(
  values: number[],
  minGap: number,
  minPerCol: number = 3
): [number, number][] {
  if (values.length < minPerCol * 2) return [];
  const xs = [...values].sort((a, b) => a - b);
  const span = xs[xs.length - 1] - xs[0];
  if (span < 120) return [];

  const gutters: number[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const gap = xs[i + 1] - xs[i];
    if (gap >= minGap) {
      gutters.push(i);
    }
  }
  if (!gutters.length) return [];

  const bounds: [number, number][] = [];
  let start = 0;
  for (const cutI of gutters) {
    bounds.push([start, cutI + 1]);
    start = cutI + 1;
  }
  bounds.push([start, xs.length]);

  const cols: [number, number][] = [];
  for (const [a, b] of bounds) {
    const cluster = xs.slice(a, b);
    if (cluster.length < minPerCol) continue;
    cols.push([cluster[0] - 1.0, cluster[cluster.length - 1] + 1.0]);
  }
  if (cols.length < 2) return [];
  return cols;
}

/**
 * Sort lines in magazine reading order:
 * 1. Checks for prominent horizontal split (top magazine columns vs bottom full-width block)
 * 2. Recognizes column gutters and clusters lines left-to-right, then top-to-bottom
 * 3. Identifies top headline/title lines and ensures they are read first
 */
export function sortLinesReadingOrder(lines: OcrLine[]): OcrLine[] {
  if (lines.length <= 1) return [...lines];

  // Check for horizontal split: a large vertical gap across the page
  const sortedByTop = [...lines].sort((a, b) => a.top - b.top);
  let maxGap = 0;
  let splitY = -1;

  for (let i = 0; i < sortedByTop.length - 1; i++) {
    const currentBottom = sortedByTop[i].top + sortedByTop[i].height;
    const nextTop = sortedByTop[i + 1].top;
    const gap = nextTop - currentBottom;
    const avgH = (sortedByTop[i].height + sortedByTop[i + 1].height) / 2;
    if (gap > Math.max(60, avgH * 2.8) && gap > maxGap) {
      maxGap = gap;
      splitY = currentBottom + gap / 2;
    }
  }

  if (splitY > 0 && maxGap > 70) {
    const above = lines.filter(l => l.top + l.height <= splitY);
    const below = lines.filter(l => l.top >= splitY);
    if (above.length >= 2 && below.length >= 2) {
      return [...sortLinesReadingOrder(above), ...sortLinesReadingOrder(below)];
    }
  }

  // Check for multi-column layout
  const centers = lines.map(lineMidX);
  const lefts = lines.map(l => l.left);
  const rights = lines.map(l => l.left + l.width);
  const pageW = Math.max(...rights) - Math.min(...lefts);

  const minGap = Math.max(45, 0.07 * pageW);
  const colRanges = clusterColumnsByCenters(centers, minGap, lines.length < 8 ? 2 : 3);

  if (colRanges.length >= 2) {
    // Assign each line to best column range
    const cols: OcrLine[][] = colRanges.map(() => []);
    const unassigned: OcrLine[] = [];

    for (const line of lines) {
      const mid = lineMidX(line);
      let bestCol = -1;
      let minDist = Infinity;

      for (let c = 0; c < colRanges.length; c++) {
        const [cMin, cMax] = colRanges[c];
        if (mid >= cMin && mid <= cMax) {
          bestCol = c;
          break;
        }
        const dist = Math.min(Math.abs(mid - cMin), Math.abs(mid - cMax));
        if (dist < minDist) {
          minDist = dist;
          bestCol = c;
        }
      }

      // If line spans across multiple columns (e.g. wide banner title), handle separately
      if (line.width > 0.65 * pageW && colRanges.length >= 2) {
        unassigned.push(line);
      } else if (bestCol >= 0) {
        cols[bestCol].push(line);
      } else {
        unassigned.push(line);
      }
    }

    // Sort each column top to bottom
    const sortedCols = cols.map(col => col.sort((a, b) => a.top - b.top));

    // Wide headers at the top go first
    const topWideHeaders = unassigned
      .filter(l => l.top < (sortedCols[0][0]?.top || Infinity))
      .sort((a, b) => a.top - b.top);

    const bottomFooters = unassigned
      .filter(l => !topWideHeaders.includes(l))
      .sort((a, b) => a.top - b.top);

    const flatColumns: OcrLine[] = [];
    for (const c of sortedCols) {
      flatColumns.push(...c);
    }

    return [...topWideHeaders, ...flatColumns, ...bottomFooters];
  }

  // Single column standard reading order (top to bottom with slight horizontal tolerance)
  return [...lines].sort((a, b) => {
    const dy = a.top - b.top;
    if (Math.abs(dy) < 12) {
      return a.left - b.left;
    }
    return dy;
  });
}

/**
 * Merge consecutive OCR lines into larger speakable chunks (paragraphs)
 * for natural TTS rhythm and smooth playback.
 */
export function mergeLinesToChunks(
  lines: OcrLine[],
  maxChars: number = 400,
  gapFactor: number = 1.4
): OcrLine[] {
  const raw = lines.filter(ln => ln.text && ln.text.trim().length > 0);
  if (!raw.length) return [];
  const ordered = sortLinesReadingOrder(raw);

  const flush = (group: OcrLine[]): OcrLine => {
    const rawJoined = joinLinesDehyphenate(group.map(g => g.text.trim()));
    const text = repairSplitWordsAndDehyphenate(rawJoined);
    const x0 = Math.min(...group.map(g => g.left));
    const y0 = Math.min(...group.map(g => g.top));
    const x1 = Math.max(...group.map(g => g.left + g.width));
    const y1 = Math.max(...group.map(g => g.top + g.height));
    return {
      text,
      left: x0,
      top: y0,
      width: x1 - x0,
      height: y1 - y0,
    };
  };

  const chunks: OcrLine[] = [];
  let cur: OcrLine[] = [ordered[0]];

  for (let i = 1; i < ordered.length; i++) {
    const prev = cur[cur.length - 1];
    const ln = ordered[i];
    const gap = ln.top - (prev.top + prev.height);
    const avgH = Math.max(1.0, (prev.height + ln.height) / 2.0);
    const curLen = cur.reduce((acc, g) => acc + g.text.length, 0) + 1 + ln.text.length;
    const sameCol = linesShareColumn(prev, ln);

    const sameBbox = (
      prev.left === ln.left &&
      prev.top === ln.top &&
      prev.width === ln.width &&
      prev.height === ln.height
    );

    // Check if ln is a distinct title, headline, item number, or product card start
    const isLnHeader = (
      (ln.text.length < 55 && ln.text === ln.text.toUpperCase() && /[A-Z]/.test(ln.text)) ||
      /^(\d+[\.\)]|[•\-\*]|MODEL|KIT|SPECIAL|TABLE|FIGURE|PAGE|SECTION|THE MOST|COMPLETE|NEW|JUMBO)/i.test(ln.text.trim())
    );
    const prevEndedWithPriceOrTerm = (
      /(\$\d+(\.\d{2})?|\b(ea|each|kit|only|total)\b|[.!?…:])$/i.test(prev.text.trim())
    );
    const isNewCardBoundary = isLnHeader && (prevEndedWithPriceOrTerm || gap > avgH * 0.4);

    if (sameCol && gap <= avgH * gapFactor && curLen <= maxChars && !sameBbox && !isNewCardBoundary) {
      cur.push(ln);
    } else {
      chunks.push(flush(cur));
      cur = [ln];
    }
  }

  chunks.push(flush(cur));
  return chunks;
}

const SENTENCE_SPLIT_REGEX = /(?<=[.!?…])\s+(?=["'“‘(\[]?[A-ZÄÖÅÀ-Ö0-9])/;

/**
 * Split a paragraph/chunk into sentence units for sentence-by-sentence TTS lockstep.
 */
export function splitIntoSentences(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];

  const pieces: string[] = [];
  const paragraphs = raw.split(/\n+/);

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(SENTENCE_SPLIT_REGEX);
    let buf = "";

    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      if (buf && buf.length < 12 && !/[.!?…]$/.test(buf)) {
        buf = `${buf} ${p}`;
      } else if (buf) {
        pieces.push(buf);
        buf = p;
      } else {
        buf = p;
      }
    }
    if (buf) {
      pieces.push(buf);
    }
  }

  return pieces.filter(p => p.trim().length > 0);
}
