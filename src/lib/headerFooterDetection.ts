import { OcrLine, PageUnit, NoiseHeaderFooterType } from '../types';
import { isTableLineOrRule, looksLikeSpeechGarbage } from './textClean';

/**
 * Result of evaluating an OCR line or chunk for header/footer noise.
 */
export interface HeaderFooterEvalResult {
  isNoise: boolean;
  type?: NoiseHeaderFooterType;
  reason?: string;
}

// Regex matching URLs, file paths, browser print artifacts, and file links
export const FILE_OR_URL_REGEX = /\b(?:file:\/\/\/|https?:\/\/|www\.|about:blank|chrome-extension:\/\/|blob:|data:|[a-zA-Z]:\\[^\n\r]+|\/(?:Users|home|var|tmp|etc|usr|opt)\/[^\n\r]+|\b[a-zA-Z0-9_\-]+\.(?:pdf|html|htm|doc|docx|txt|epub)\b)/i;

// Regex matching web print header/footer artifacts like "TEXT CANVAS", "Page 1 of 261", "1 of 261"
export const BROWSER_ARTIFACT_REGEX = /\b(?:text\s+canvas|page\s+\d+\s+of\s+\d+|\d+\s+of\s+\d+|\b\d+\s*\/\s*\d{1,4}\b)\b/i;

// Regex matching dates in multiple common formats:
// e.g. "7/27/26", "7/27/2026", "27.07.2026", "2026-07-27", "12:55 AM", "12:55:00 PM", "7/27/26, 12:55 AM", "August 1976", "July 27, 2026"
export const DATE_OR_TIME_REGEX = /\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)?|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4}|\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4})\b/i;

// Regex matching issue/volume/season patterns
export const ISSUE_VOL_REGEX = /\b(issue\s+(?:number\s+)?\d+|vol(?:ume)?\.?\s*\d+|no\.?\s*\d+|spring\s+\d{4}|summer\s+\d{4}|fall\s+\d{4}|autumn\s+\d{4}|winter\s+\d{4})\b/i;

// Regex matching standalone page numbers
export const STANDALONE_PAGE_NUM_REGEX = /^\s*(?:page|pg\.?|p\.?|folio|seite|pág\.?)?\s*[-–—#\[(]?\s*(\d{1,4})\s*[-–—\])]?(?:\s*(?:of|\/|\-)\s*\d{1,4})?\.?\s*$/i;

// Regex matching standalone Roman numerals
export const STANDALONE_ROMAN_NUM_REGEX = /^\s*(?:page|pg\.?|p\.?)?\s*[-–—#\[(]?\s*([ivxlcdmIVXLCDM]{1,8})\s*[-–—\])]?\.?\s*$/;

// Standard publisher/running head boilerplate keywords
export const PUBLISHER_BOILERPLATE_REGEX = /\b(published\s+monthly\s+by|all\s+rights\s+reserved|printed\s+in\s+usa|issn\s+[\d\-x]+|isbn\s+[\d\-x]+|publications?,\s+inc\.?)\b/i;

/**
 * Extract clean search tokens from document filename or title
 */
export function extractFilenameTokens(documentName?: string): string[] {
  if (!documentName) return [];
  const clean = documentName
    .replace(/\.(pdf|ocr\.txt|txt|png|jpg|jpeg|svg)$/i, '')
    .replace(/[_\-\.\/\\|:]+/g, ' ')
    .trim();

  const rawTokens = clean.split(/\s+/).map(t => t.toLowerCase().trim()).filter(t => t.length >= 3);
  return Array.from(new Set(rawTokens));
}

/**
 * Clean & normalize a string for header/footer cross-page comparison
 */
export function normalizeHeaderString(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[\s\-_.,;:'"()\[\]\/\\|#]+/g, ' ')
    .trim();
}

/**
 * Check if text contains a file URL, local file path, or browser print artifact
 */
export function isFileUrlOrArtifact(text: string): boolean {
  if (FILE_OR_URL_REGEX.test(text)) return true;
  if (BROWSER_ARTIFACT_REGEX.test(text)) return true;
  return false;
}

/**
 * Check if text contains a date or timestamp pattern
 */
export function hasDateOrTimestampPattern(text: string): boolean {
  if (DATE_OR_TIME_REGEX.test(text)) return true;
  if (ISSUE_VOL_REGEX.test(text)) return true;
  if (/\b(?:19\d\d|20\d\d)\b/.test(text) && text.length <= 40) return true;
  return false;
}

/**
 * Check if text is predominantly a page number or pagination string
 */
export function hasPageNumberPattern(text: string): boolean {
  if (STANDALONE_PAGE_NUM_REGEX.test(text)) return true;
  if (STANDALONE_ROMAN_NUM_REGEX.test(text)) return true;
  if (BROWSER_ARTIFACT_REGEX.test(text)) return true;
  if (/^\s*(?:page|pg\.?|p\.?)\s*\d+\s*(?:of|\/)\s*\d+\s*$/i.test(text)) return true;
  return false;
}

/**
 * Check if text matches the filename or main publication name tokens
 */
export function matchesFilenameOrPubTokens(text: string, filenameTokens: string[]): boolean {
  if (!filenameTokens.length) return false;
  const lower = text.toLowerCase();
  for (const token of filenameTokens) {
    if (lower.includes(token)) return true;
  }
  return false;
}

/**
 * Evaluates a single OCR Line / Chunk to determine if it represents a noise header or footer.
 */
export function evaluateHeaderFooter(
  chunk: OcrLine,
  page: { width: number; height: number; pageNumber?: number },
  options: {
    documentName?: string;
    repeatingHeaders?: Set<string>;
    repeatingFooters?: Set<string>;
  } = {}
): HeaderFooterEvalResult {
  const rawText = (chunk.text || '').trim();
  if (!rawText) {
    return { isNoise: false };
  }

  // Cover (Page 1): Magazine name, issue dates, subtitles, and headline articles on the cover are essential content, never noise!
  if (page.pageNumber === 1) {
    return { isNoise: false };
  }

  const norm = normalizeHeaderString(rawText);
  const pageH = Math.max(100, page.height || 1100);
  const topRatio = chunk.top / pageH;
  const bottomRatio = (chunk.top + (chunk.height || 20)) / pageH;

  const isTopZone = topRatio <= 0.18; // Top 18% margin
  const isBottomZone = bottomRatio >= 0.82; // Bottom 18% margin
  const charCount = rawText.length;

  // 0. Table lines, ASCII border rules, and symbol noise runs (anywhere on page)
  if (isTableLineOrRule(rawText)) {
    return {
      isNoise: true,
      type: 'table-line',
      reason: `Table border / ASCII grid rule ("${rawText}")`,
    };
  }

  // 0b. General symbol rubbish & illegible OCR specks
  if (looksLikeSpeechGarbage(rawText)) {
    return {
      isNoise: true,
      type: 'symbol-rubbish',
      reason: `Non-verbal symbol noise / unpronounceable OCR specks ("${rawText}")`,
    };
  }

  // 1. Standalone File URL or Local Path or Browser Canvas print artifact (file:///..., http://..., TEXT CANVAS)
  if (isFileUrlOrArtifact(rawText)) {
    if (isTopZone || isBottomZone || charCount <= 120) {
      return {
        isNoise: true,
        type: 'filename',
        reason: `File URL or print artifact ("${rawText}")`,
      };
    }
  }

  // 2. Standalone Date / Time stamp (e.g. "7/27/26, 12:55 AM", "12:55 AM", "2026-09-13")
  if (hasDateOrTimestampPattern(rawText)) {
    // If it's in header or footer zone or short string (< 45 chars) without sentence structure
    if (isTopZone || isBottomZone || (charCount <= 45 && !rawText.includes('.'))) {
      return {
        isNoise: true,
        type: 'date-stamp',
        reason: `Date/timestamp stamp ("${rawText}")`,
      };
    }
  }

  // 3. Standalone Page Number / Pagination Folio (e.g. "Page 4 of 261", "p. 4", "4", "iv")
  if (hasPageNumberPattern(rawText) || (isTopZone || isBottomZone) && /^\s*\d{1,4}\s*$/.test(rawText)) {
    if (charCount <= 35) {
      return {
        isNoise: true,
        type: 'page-number',
        reason: `Page number folio ("${rawText}")`,
      };
    }
  }

  // 4. Cross-Page Repeating Header / Footer Check (appearing on 2+ pages)
  if (norm.length >= 2 && charCount <= 140) {
    if (isTopZone && options.repeatingHeaders && options.repeatingHeaders.has(norm)) {
      return {
        isNoise: true,
        type: 'running-head',
        reason: `Repeating running header across pages ("${rawText}")`,
      };
    }
    if (isBottomZone && options.repeatingFooters && options.repeatingFooters.has(norm)) {
      return {
        isNoise: true,
        type: 'running-footer',
        reason: `Repeating running footer across pages ("${rawText}")`,
      };
    }
  }

  // 5. Header Margin Zone Analysis (top <= 18% of page)
  if (isTopZone && charCount <= 140) {
    const hasDate = hasDateOrTimestampPattern(rawText);
    const hasPageNum = hasPageNumberPattern(rawText) || /\b\d{1,4}\b/.test(rawText);
    const fnTokens = extractFilenameTokens(options.documentName);
    const matchesDoc = matchesFilenameOrPubTokens(rawText, fnTokens);

    // Combination of Date + Page Number + Title (e.g. "BYTE August 1976 14", "BBC BASIC Reference Manual")
    if ((hasDate && hasPageNum) || (hasDate && matchesDoc) || (hasPageNum && matchesDoc)) {
      return {
        isNoise: true,
        type: 'running-head',
        reason: `Header metadata containing date/page/title ("${rawText}")`,
      };
    }

    // Exact filename repeating header
    if (options.documentName) {
      const cleanDoc = options.documentName.toLowerCase().replace(/\.pdf$/i, '').trim();
      if (cleanDoc.length >= 4 && rawText.toLowerCase().includes(cleanDoc)) {
        return {
          isNoise: true,
          type: 'filename',
          reason: `Document title/filename in header ("${rawText}")`,
        };
      }
    }
  }

  // 6. Footer Margin Zone Analysis (bottom >= 82% of page)
  if (isBottomZone && charCount <= 150) {
    const hasDate = hasDateOrTimestampPattern(rawText);
    const hasPageNum = hasPageNumberPattern(rawText) || /\b\d{1,4}\b/.test(rawText);
    const hasBoilerplate = PUBLISHER_BOILERPLATE_REGEX.test(rawText);
    const fnTokens = extractFilenameTokens(options.documentName);
    const matchesDoc = matchesFilenameOrPubTokens(rawText, fnTokens);

    if (hasBoilerplate || (hasDate && hasPageNum) || (hasDate && matchesDoc) || (hasPageNum && matchesDoc)) {
      return {
        isNoise: true,
        type: 'running-footer',
        reason: `Running footer with date/folio/publisher ("${rawText}")`,
      };
    }
  }

  // 7. Short standalone metadata lines (e.g. "ISSUE NUMBER 12", "AUGUST 1976", "PRINTED IN USA")
  if (charCount <= 45) {
    if (ISSUE_VOL_REGEX.test(rawText)) {
      return {
        isNoise: true,
        type: 'date-stamp',
        reason: `Issue / volume indicator ("${rawText}")`,
      };
    }
    if (/^\s*(?:printed\s+in\s+usa|all\s+rights\s+reserved|\$[\d\.]+\s+in\s+[a-z\s]+)\s*$/i.test(rawText)) {
      return {
        isNoise: true,
        type: 'running-footer',
        reason: `Publication metadata line ("${rawText}")`,
      };
    }
  }

  return { isNoise: false };
}

/**
 * Process a whole collection of pages, discovering repeating header/footer patterns
 * and tagging all lines and chunks with noise evaluation results.
 */
export function tagPagesHeaderFooters(
  pages: PageUnit[],
  documentName?: string
): PageUnit[] {
  if (!pages.length) return pages;

  // 1. Build frequency map of normalized top and bottom lines across pages
  const headerCounts = new Map<string, number>();
  const footerCounts = new Map<string, number>();

  for (const page of pages) {
    const pageH = Math.max(100, page.height || 1100);
    for (const chunk of page.chunks) {
      const topRatio = chunk.top / pageH;
      const bottomRatio = (chunk.top + (chunk.height || 20)) / pageH;
      const norm = normalizeHeaderString(chunk.text || '');

      if (norm.length >= 2 && (chunk.text || '').length <= 140) {
        if (topRatio <= 0.18) {
          headerCounts.set(norm, (headerCounts.get(norm) || 0) + 1);
        } else if (bottomRatio >= 0.82) {
          footerCounts.set(norm, (footerCounts.get(norm) || 0) + 1);
        }
      }
    }

    for (const line of page.lines) {
      const topRatio = line.top / pageH;
      const bottomRatio = (line.top + (line.height || 20)) / pageH;
      const norm = normalizeHeaderString(line.text || '');

      if (norm.length >= 2 && (line.text || '').length <= 140) {
        if (topRatio <= 0.18) {
          headerCounts.set(norm, (headerCounts.get(norm) || 0) + 1);
        } else if (bottomRatio >= 0.82) {
          footerCounts.set(norm, (footerCounts.get(norm) || 0) + 1);
        }
      }
    }
  }

  // Identify strings that appear on 2 or more pages in header or footer positions
  const repeatingHeaders = new Set<string>();
  const repeatingFooters = new Set<string>();

  headerCounts.forEach((count, text) => {
    if (count >= 2) repeatingHeaders.add(text);
  });
  footerCounts.forEach((count, text) => {
    if (count >= 2) repeatingFooters.add(text);
  });

  // 2. Tag each line and chunk in each page
  return pages.map(page => {
    const taggedChunks = page.chunks.map(chunk => {
      const evalRes = evaluateHeaderFooter(chunk, page, {
        documentName,
        repeatingHeaders,
        repeatingFooters,
      });

      return {
        ...chunk,
        isNoiseHeaderFooter: evalRes.isNoise,
        noiseType: evalRes.type,
        noiseReason: evalRes.reason,
      };
    });

    const taggedLines = page.lines.map(line => {
      const evalRes = evaluateHeaderFooter(line, page, {
        documentName,
        repeatingHeaders,
        repeatingFooters,
      });

      return {
        ...line,
        isNoiseHeaderFooter: evalRes.isNoise,
        noiseType: evalRes.type,
        noiseReason: evalRes.reason,
      };
    });

    return {
      ...page,
      chunks: taggedChunks,
      lines: taggedLines,
    };
  });
}
