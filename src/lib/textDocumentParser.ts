import { PageUnit, OcrLine } from '../types';
import { mergeLinesToChunks } from './layoutAndColumns';
import { parseContinuedFrom, parseContinuedOn } from './continueLinks';
import { looksLikeAd } from './adDetection';
import { inferPageTitle } from './articleExport';
import { tagPagesHeaderFooters } from './headerFooterDetection';
import { generateCanvasJpegForPage } from './pageImageGenerator';

/**
 * Escapes HTML characters for SVG / XML rendering
 */
function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Strips Markdown formatting to produce clean, natural speech-ready text
 */
export function cleanMarkdownForSpeech(md: string): string {
  if (!md) return '';
  let text = md;

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, ' ');

  // Remove image tags ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');

  // Convert links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove code blocks ```code```
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, '');
  });

  // Remove inline code `code`
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove bold / italics: ***text***, **text**, *text*, ___text___, __text__, _text_
  text = text.replace(/(\*{1,3}|_{1,3})([^*_]+)\1/g, '$2');

  // Remove blockquotes >
  text = text.replace(/^>\s*/gm, '');

  // Remove header markers #, ##, ###, etc.
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove list bullets / numbers at start of line: * -, + -, 1. -, etc.
  text = text.replace(/^[\s]*[-*+]\s+/gm, '');
  text = text.replace(/^[\s]*\d+\.\s+/gm, '');

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  // Normalize excess whitespace
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Robust Client-Side RTF (Rich Text Format) Parser
 * Converts .rtf documents into clean text with paragraph and page breaks
 */
export function parseRtfToText(rtf: string): { pages: string[]; fullText: string } {
  if (!rtf) return { pages: [], fullText: '' };

  // Fast check: is this standard RTF?
  if (!rtf.includes('{\\rtf')) {
    // If not standard RTF header, treat as raw text
    return { pages: [rtf.trim()], fullText: rtf.trim() };
  }

  const pages: string[] = [];
  let currentPageText = '';
  let currentGroupLevel = 0;
  let skipGroupLevel = -1;

  // Control groups to completely skip (font tables, color tables, stylesheets, info, pics, comments)
  const skipGroups = new Set([
    'fonttbl',
    'colortbl',
    'stylesheet',
    'info',
    'pict',
    '*',
    'generator',
    'author',
    'company',
    'title',
    'subject',
    'keywords',
  ]);

  let i = 0;
  const len = rtf.length;

  while (i < len) {
    const char = rtf[i];

    // Handle group open
    if (char === '{') {
      currentGroupLevel++;
      i++;
      // Check next word to see if we should skip this group
      if (rtf[i] === '\\') {
        let wordEnd = i + 1;
        while (wordEnd < len && /[a-zA-Z*]/.test(rtf[wordEnd])) {
          wordEnd++;
        }
        const word = rtf.substring(i + 1, wordEnd).toLowerCase();
        if (skipGroups.has(word) && skipGroupLevel === -1) {
          skipGroupLevel = currentGroupLevel;
        }
      }
      continue;
    }

    // Handle group close
    if (char === '}') {
      if (currentGroupLevel === skipGroupLevel) {
        skipGroupLevel = -1;
      }
      currentGroupLevel--;
      i++;
      continue;
    }

    // If we're inside a skipped group (like font table), ignore content
    if (skipGroupLevel !== -1 && currentGroupLevel >= skipGroupLevel) {
      i++;
      continue;
    }

    // Handle control words and escapes
    if (char === '\\') {
      i++;
      if (i >= len) break;

      const nextChar = rtf[i];

      // Escaped special characters
      if (nextChar === '\\' || nextChar === '{' || nextChar === '}') {
        currentPageText += nextChar;
        i++;
        continue;
      }

      // Hex character escape \'hh
      if (nextChar === "'") {
        i++;
        const hex = rtf.substr(i, 2);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          const charCode = parseInt(hex, 16);
          // Standard Latin-1 / ASCII
          currentPageText += String.fromCharCode(charCode);
          i += 2;
        }
        continue;
      }

      // Read control word
      let wordStart = i;
      while (i < len && /[a-zA-Z]/.test(rtf[i])) {
        i++;
      }
      const controlWord = rtf.substring(wordStart, i).toLowerCase();

      // Read optional numeric parameter
      let numStart = i;
      let hasNegative = false;
      if (rtf[i] === '-') {
        hasNegative = true;
        i++;
      }
      while (i < len && /[0-9]/.test(rtf[i])) {
        i++;
      }
      const numStr = rtf.substring(numStart, i);
      const numParam = numStr ? parseInt(numStr, 10) : null;

      // Optional trailing delimiter space consumed by control word
      if (i < len && rtf[i] === ' ') {
        i++;
      }

      // Process specific control words
      switch (controlWord) {
        case 'par':
        case 'line':
          currentPageText += '\n';
          break;
        case 'page':
        case 'sect':
        case 'pagebb':
          if (currentPageText.trim()) {
            pages.push(currentPageText.trim());
            currentPageText = '';
          }
          break;
        case 'tab':
          currentPageText += ' ';
          break;
        case 'u':
          if (numParam !== null) {
            const codePoint = hasNegative || numParam < 0 ? numParam + 65536 : numParam;
            try {
              currentPageText += String.fromCodePoint(codePoint);
            } catch {
              currentPageText += String.fromCharCode(codePoint);
            }
            // Skip unicode fallback replacement characters (\ucN)
            if (i < len && rtf[i] === '?') {
              i++;
            }
          }
          break;
        case 'emdash':
          currentPageText += '—';
          break;
        case 'endash':
          currentPageText += '–';
          break;
        case 'lquote':
          currentPageText += '‘';
          break;
        case 'rquote':
          currentPageText += '’';
          break;
        case 'ldblquote':
          currentPageText += '“';
          break;
        case 'rdblquote':
          currentPageText += '”';
          break;
        case 'bullet':
          currentPageText += '•';
          break;
        default:
          // Ignore font, styling, and geometry control words
          break;
      }
      continue;
    }

    // Skip carriage returns
    if (char === '\r') {
      i++;
      continue;
    }

    // Regular plain text character
    currentPageText += char;
    i++;
  }

  if (currentPageText.trim()) {
    pages.push(currentPageText.trim());
  }

  const fullText = pages.join('\n\n');
  return { pages: pages.length > 0 ? pages : [fullText], fullText };
}

/**
 * Parses HTML document into text chunks and pages
 */
export function parseHtmlToPages(html: string): { title?: string; pages: { title: string; text: string }[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Extract title
  const title = doc.querySelector('title')?.textContent?.trim() ||
                doc.querySelector('h1')?.textContent?.trim() ||
                'Web Document';

  // Remove scripts, styles, navigation, footer
  const unwanted = doc.querySelectorAll('script, style, noscript, svg, nav, header, footer, iframe');
  unwanted.forEach(el => el.remove());

  // Extract text by paragraphs and sections
  const contentElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, blockquote, pre, li, td');
  const sections: { title: string; paragraphs: string[] }[] = [];
  let currentSection = { title: title || 'Page 1', paragraphs: [] as string[] };

  contentElements.forEach((el) => {
    const text = el.textContent?.trim();
    if (!text) return;

    const tagName = el.tagName.toLowerCase();
    if (tagName === 'h1' || tagName === 'h2') {
      if (currentSection.paragraphs.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { title: text, paragraphs: [text] };
    } else {
      currentSection.paragraphs.push(text);
    }
  });

  if (currentSection.paragraphs.length > 0) {
    sections.push(currentSection);
  }

  // If no structured headings found, fallback to body text
  if (sections.length === 0) {
    const bodyText = doc.body?.textContent?.trim() || '';
    return {
      title,
      pages: paginateRawText(bodyText, title),
    };
  }

  // Convert sections into pages
  const pages: { title: string; text: string }[] = [];
  for (const sec of sections) {
    const combinedText = sec.paragraphs.join('\n\n');
    if (combinedText.length > 3500) {
      // Split large sections into multiple pages
      const subPages = paginateRawText(combinedText, sec.title);
      pages.push(...subPages);
    } else {
      pages.push({
        title: sec.title,
        text: combinedText,
      });
    }
  }

  return { title, pages: pages.length > 0 ? pages : [{ title, text: doc.body?.textContent?.trim() || '' }] };
}

/**
 * Parses Subtitle files (.srt, .vtt) into reading pages
 */
export function parseSubtitlesToPages(subText: string, filename: string): { title: string; pages: { title: string; text: string }[] } {
  const lines = subText.split(/\r?\n/);
  const speechLines: string[] = [];
  let currentText = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentText) {
        speechLines.push(currentText);
        currentText = '';
      }
      continue;
    }

    // Skip WEBVTT header
    if (trimmed.startsWith('WEBVTT') || trimmed.startsWith('NOTE') || trimmed.startsWith('STYLE')) {
      continue;
    }

    // Skip numeric cue index (e.g. "1", "24", etc.)
    if (/^\d+$/.test(trimmed)) {
      continue;
    }

    // Skip timestamp lines: "00:00:20,000 --> 00:00:24,000" or "00:00:20.000 --> 00:00:24.000"
    if (trimmed.includes('-->')) {
      continue;
    }

    // Strip inline formatting tags like <i>, <b>, <v Voice>
    const cleaned = trimmed.replace(/<[^>]*>/g, '').trim();
    if (cleaned) {
      currentText = currentText ? `${currentText} ${cleaned}` : cleaned;
    }
  }

  if (currentText) {
    speechLines.push(currentText);
  }

  // Group speech cues into coherent paragraphs of ~3-5 sentences
  const paragraphs: string[] = [];
  let buffer = '';
  for (const line of speechLines) {
    buffer = buffer ? `${buffer} ${line}` : line;
    if (buffer.length > 350 || /[.!?]$/.test(buffer)) {
      paragraphs.push(buffer);
      buffer = '';
    }
  }
  if (buffer) {
    paragraphs.push(buffer);
  }

  const fullText = paragraphs.join('\n\n');
  const title = filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
  return {
    title,
    pages: paginateRawText(fullText, title),
  };
}

/**
 * Parses JSON transcripts, arrays of strings, or structured text dumps
 */
export function parseJsonToPages(jsonStr: string, filename: string): { title: string; pages: { title: string; text: string }[] } {
  const title = filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
  try {
    const data = JSON.parse(jsonStr);

    let extractedText = '';

    // Whisper / Audio Transcript format: { text: "...", segments: [...] }
    if (typeof data.text === 'string' && data.text.trim()) {
      extractedText = data.text.trim();
    } else if (Array.isArray(data)) {
      // Array of strings or objects with text fields
      const items = data.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return item.text || item.content || item.sentence || item.message || JSON.stringify(item);
        }
        return String(item);
      });
      extractedText = items.join('\n\n');
    } else if (typeof data === 'object' && data !== null) {
      // Object with potential text/content keys
      const candidateKeys = ['content', 'body', 'transcript', 'rawText', 'description', 'notes'];
      for (const k of candidateKeys) {
        if (typeof data[k] === 'string' && data[k].trim()) {
          extractedText = data[k].trim();
          break;
        }
      }
      if (!extractedText) {
        extractedText = JSON.stringify(data, null, 2);
      }
    }

    return {
      title,
      pages: paginateRawText(extractedText || jsonStr, title),
    };
  } catch {
    return {
      title,
      pages: paginateRawText(jsonStr, title),
    };
  }
}

/**
 * Helper to paginate raw text into ~400-600 word readable pages
 */
export function paginateRawText(
  text: string,
  baseTitle: string = 'Document'
): { title: string; text: string }[] {
  if (!text.trim()) {
    return [{ title: baseTitle, text: '' }];
  }

  // Check for explicit page break markers in text
  // Form Feed \f
  if (text.includes('\f')) {
    const parts = text.split('\f').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return parts.map((part, idx) => ({
        title: `${baseTitle} · Part ${idx + 1}`,
        text: part,
      }));
    }
  }

  // === Page X === or --- Page X --- markers
  const pageMarkerRegex = /(?:===|---|###)\s*(?:Page|PAGE)\s*(\d+|[IVXLCDM]+)\s*(?:===|---|###)/gi;
  if (pageMarkerRegex.test(text)) {
    const rawParts = text.split(/(?:===|---|###)\s*(?:Page|PAGE)\s*(?:\d+|[IVXLCDM]+)\s*(?:===|---|###)/gi);
    const pages = rawParts
      .map(p => p.trim())
      .filter(Boolean)
      .map((part, idx) => ({
        title: `${baseTitle} · Page ${idx + 1}`,
        text: part,
      }));
    if (pages.length > 0) return pages;
  }

  // Natural paragraph-based pagination
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  if (paragraphs.length <= 4 && text.length < 2500) {
    return [{ title: baseTitle, text: text.trim() }];
  }

  const pages: { title: string; text: string }[] = [];
  let currentParas: string[] = [];
  let currentWordCount = 0;
  const targetWordsPerPage = 380; // ~1-2 reading minutes per page

  for (const para of paragraphs) {
    const words = para.split(/\s+/).length;
    if (currentWordCount + words > targetWordsPerPage && currentParas.length > 0) {
      const pageIndex = pages.length + 1;
      pages.push({
        title: `${baseTitle} · Page ${pageIndex}`,
        text: currentParas.join('\n\n'),
      });
      currentParas = [para];
      currentWordCount = words;
    } else {
      currentParas.push(para);
      currentWordCount += words;
    }
  }

  if (currentParas.length > 0) {
    const pageIndex = pages.length + 1;
    pages.push({
      title: `${baseTitle} · Page ${pageIndex}`,
      text: currentParas.join('\n\n'),
    });
  }

  return pages.length > 0 ? pages : [{ title: baseTitle, text: text.trim() }];
}

/**
 * Creates a high-fidelity SVG rendered preview image of the text document page
 */
export function generateTextPageSvgImage(
  title: string,
  pageNumber: number,
  totalPages: number,
  paragraphs: string[],
  docName: string
): string {
  const width = 800;
  const height = 1100;

  const escapedDocName = escapeXml(docName);
  const escapedTitle = escapeXml(title || `Page ${pageNumber}`);

  // Pure SVG text line breaking for reliable canvas rasterization
  const svgTextNodes: string[] = [];
  const startY = 160;
  const maxY = 1040;
  const lineH = 22;
  const colX = 50;
  const maxLineChars = 78;
  let curY = startY;

  for (let idx = 0; idx < paragraphs.length; idx++) {
    const p = paragraphs[idx].trim();
    if (!p) continue;
    const isHeading = idx === 0 && p.length < 60 && !p.includes('.');

    if (isHeading) {
      if (curY + 30 > maxY) break;
      curY += 8;
      svgTextNodes.push(`<text x="${colX}" y="${curY}" font-family="'Helvetica Neue', Arial, sans-serif" font-size="16" font-weight="bold" fill="#0f172a">${escapeXml(p)}</text>`);
      curY += 26;
      continue;
    }

    const words = p.split(/\s+/);
    const lines: string[] = [];
    let curLine = '';
    for (const w of words) {
      if ((curLine ? curLine + ' ' + w : w).length > maxLineChars) {
        if (curLine) lines.push(curLine);
        curLine = w;
      } else {
        curLine = curLine ? `${curLine} ${w}` : w;
      }
    }
    if (curLine) lines.push(curLine);

    for (const line of lines) {
      if (curY + lineH > maxY) break;
      svgTextNodes.push(`<text x="${colX}" y="${curY}" font-family="Georgia, 'Merriweather', serif" font-size="14" fill="#1e293b">${escapeXml(line)}</text>`);
      curY += lineH;
    }
    curY += 12; // paragraph spacing
  }

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <linearGradient id="pageBg" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#fafaf9"/>
      </linearGradient>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.08"/>
      </filter>
    </defs>

    <!-- Page Canvas Background -->
    <rect width="100%" height="100%" fill="url(#pageBg)" stroke="#e2e8f0" stroke-width="2"/>

    <!-- Top Document Masthead Banner -->
    <rect x="40" y="30" width="720" height="46" fill="#0f172a" rx="6" filter="url(#shadow)"/>
    <text x="58" y="58" font-family="'Helvetica Neue', Arial, sans-serif" font-size="14" font-weight="bold" fill="#f8fafc" letter-spacing="0.5">
      📄 ${escapedDocName.length > 42 ? escapedDocName.substring(0, 40) + '...' : escapedDocName}
    </text>
    <text x="740" y="58" font-family="'JetBrains Mono', Consolas, monospace" font-size="12" font-weight="bold" fill="#fbbf24" text-anchor="end">
      PAGE ${pageNumber} / ${totalPages}
    </text>

    <!-- Section Title & Rule -->
    <text x="50" y="112" font-family="'Georgia', serif" font-size="21" font-weight="bold" fill="#1e293b">
      ${escapedTitle}
    </text>
    <line x1="50" y1="126" x2="750" y2="126" stroke="#cbd5e1" stroke-width="1.5"/>

    <!-- Typeset Text Flow Area (Pure SVG) -->
    ${svgTextNodes.join('\n    ')}

    <!-- Page Footer with Folio -->
    <line x1="50" y1="1055" x2="750" y2="1055" stroke="#e2e8f0" stroke-width="1"/>
    <text x="50" y="1075" font-family="'Helvetica Neue', Arial, sans-serif" font-size="10" fill="#64748b">
      Direct Ready-Text Reader · 0 OCR Errors · 100% Accuracy
    </text>
    <text x="750" y="1075" font-family="'Helvetica Neue', Arial, sans-serif" font-size="10" font-weight="bold" fill="#475569" text-anchor="end">
      Page ${pageNumber} of ${totalPages}
    </text>
  </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

/**
 * Converts a parsed text page into a standard PageUnit with bounding boxes for reading
 */
export function createPageUnitFromTextData(
  pageNumber: number,
  totalPages: number,
  title: string,
  text: string,
  filename: string
): PageUnit {
  const pageW = 800;
  const pageH = 1100;
  const topStart = 145;
  const availableHeight = 890;

  const rawParagraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  const totalParas = Math.max(1, rawParagraphs.length);
  const paraSpacing = 12;
  const paraHeight = Math.min(
    180,
    Math.max(40, (availableHeight - (totalParas * paraSpacing)) / totalParas)
  );

  // Generate bounding boxes matching visual SVG canvas
  const lines: OcrLine[] = rawParagraphs.map((paraText, idx) => {
    const top = topStart + idx * (paraHeight + paraSpacing);
    const isHeading = idx === 0 && paraText.length < 50 && !paraText.includes('.');
    return {
      text: paraText,
      left: 50,
      top: Math.round(top),
      width: 700,
      height: isHeading ? 36 : Math.round(paraHeight),
      confidence: 100, // 100% accuracy for ready text (no OCR errors!)
    };
  });

  const chunks = mergeLinesToChunks(lines, 450);
  const contOn = parseContinuedOn(text);
  const contFrom = parseContinuedFrom(text);

  const pageUnit: PageUnit = {
    pageNumber,
    label: title || `Page ${pageNumber}`,
    width: pageW,
    height: pageH,
    lines,
    chunks: chunks.length > 0 ? chunks : lines,
    rawText: text,
    isProofread: true,
    skipAsAd: false,
    adReasons: [],
    inferredTitle: title || `Page ${pageNumber}`,
    continuedOn: contOn,
    continuedFrom: contFrom,
    image: generateCanvasJpegForPage(title, pageNumber, totalPages, rawParagraphs.join('\n\n')),
  };

  const adEval = looksLikeAd(pageUnit);
  pageUnit.skipAsAd = adEval.isAd;
  pageUnit.adReasons = adEval.reasons;
  pageUnit.inferredTitle = inferPageTitle(pageUnit, pageUnit.label);

  return pageUnit;
}

/**
 * Main function to load and process ready text documents without OCR:
 * Supports: .txt, .text, .md, .markdown, .rtf, .html, .htm, .srt, .vtt, .json, .csv, .tsv
 */
export async function processReadyTextFile(
  file: File,
  onProgress?: (status: string) => void
): Promise<PageUnit[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  onProgress?.(`Reading ${file.name} directly without OCR...`);

  const fileContent = await file.text();

  let parsedPages: { title: string; text: string }[] = [];
  const baseDocTitle = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

  // 1. Markdown (.md, .markdown)
  if (ext === 'md' || ext === 'markdown') {
    onProgress?.(`Parsing Markdown formatting & chapters...`);
    // Extract first # Heading as title
    const firstHeadingMatch = fileContent.match(/^#\s+(.+)$/m);
    const docTitle = firstHeadingMatch ? firstHeadingMatch[1].trim() : baseDocTitle;

    // Check if there are multiple top-level sections # or ##
    const sections = fileContent.split(/(?=^#{1,2}\s+)/m);
    if (sections.length > 1) {
      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i].trim();
        if (!sec) continue;
        const secHeadMatch = sec.match(/^#{1,2}\s+(.+)$/m);
        const secTitle = secHeadMatch ? secHeadMatch[1].trim() : `${docTitle} · Section ${i + 1}`;
        const cleanSpeechText = cleanMarkdownForSpeech(sec);
        parsedPages.push({
          title: secTitle,
          text: cleanSpeechText,
        });
      }
    } else {
      const cleanSpeechText = cleanMarkdownForSpeech(fileContent);
      parsedPages = paginateRawText(cleanSpeechText, docTitle);
    }
  }
  // 2. Rich Text Format (.rtf)
  else if (ext === 'rtf' || file.type === 'application/rtf' || fileContent.startsWith('{\\rtf')) {
    onProgress?.(`Parsing Rich Text Format (.rtf) structure & paragraphs...`);
    const rtfResult = parseRtfToText(fileContent);
    if (rtfResult.pages.length > 1) {
      parsedPages = rtfResult.pages.map((p, idx) => ({
        title: `${baseDocTitle} · Page ${idx + 1}`,
        text: p,
      }));
    } else {
      parsedPages = paginateRawText(rtfResult.fullText, baseDocTitle);
    }
  }
  // 3. HTML (.html, .htm)
  else if (ext === 'html' || ext === 'htm' || file.type === 'text/html') {
    onProgress?.(`Extracting HTML content & structure...`);
    const htmlResult = parseHtmlToPages(fileContent);
    parsedPages = htmlResult.pages;
  }
  // 4. Subtitles / Transcripts (.srt, .vtt)
  else if (ext === 'srt' || ext === 'vtt') {
    onProgress?.(`Extracting dialogue & speech cues from subtitles...`);
    const subResult = parseSubtitlesToPages(fileContent, file.name);
    parsedPages = subResult.pages;
  }
  // 5. JSON transcripts (.json)
  else if (ext === 'json' || file.type === 'application/json') {
    onProgress?.(`Parsing JSON transcript data...`);
    const jsonResult = parseJsonToPages(fileContent, file.name);
    parsedPages = jsonResult.pages;
  }
  // 6. CSV / TSV tabular data
  else if (ext === 'csv' || ext === 'tsv') {
    onProgress?.(`Structuring tabular rows for reading...`);
    const delimiter = ext === 'tsv' ? '\t' : ',';
    const lines = fileContent.split(/\r?\n/).filter(l => l.trim());
    const headers = lines[0]?.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, '')) || [];
    const formattedRows: string[] = [];

    for (let r = 1; r < lines.length; r++) {
      const cols = lines[r].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
      if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;
      const rowText = cols.map((col, cIdx) => {
        const header = headers[cIdx] || `Col ${cIdx + 1}`;
        return `${header}: ${col}`;
      }).join(' · ');
      formattedRows.push(rowText);
    }
    const fullText = formattedRows.join('\n\n');
    parsedPages = paginateRawText(fullText, baseDocTitle);
  }
  // 7. Plain text (.txt, .text, .log, default)
  else {
    onProgress?.(`Formatting plain text for read aloud...`);
    parsedPages = paginateRawText(fileContent, baseDocTitle);
  }

  if (parsedPages.length === 0) {
    parsedPages = [{ title: baseDocTitle, text: fileContent.trim() || 'Empty document' }];
  }

  const totalPages = parsedPages.length;
  const pageUnits: PageUnit[] = parsedPages.map((p, idx) => {
    return createPageUnitFromTextData(
      idx + 1,
      totalPages,
      p.title,
      p.text,
      file.name
    );
  });

  return tagPagesHeaderFooters(pageUnits, file.name);
}
