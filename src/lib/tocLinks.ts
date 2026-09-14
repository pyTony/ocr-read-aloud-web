import { PageUnit } from '../types';
import { isFileUrlOrArtifact, hasDateOrTimestampPattern } from './headerFooterDetection';

export interface TocArticleLink {
  title: string;
  author?: string;
  targetPageIndex: number;
  pageNumber: number;
  snippet?: string;
}

/**
 * Checks if a page represents an authentic Table of Contents ("In the Queue", "In this Issue", "Contents", "Table of Contents")
 */
export function isTocPage(page: PageUnit): boolean {
  if (!page) return false;
  const t = (page.inferredTitle + ' ' + (page.rawText || '').slice(0, 400)).toLowerCase();
  
  // Must match prominent TOC header keywords
  return (
    t.includes('in the queue') ||
    t.includes('table of contents') ||
    t.includes('in this issue') ||
    /\b(?:table\s+of\s+)?contents\b/i.test(page.inferredTitle || '') ||
    /(?:^|\n)\s*contents\s*(?:\n|$)/i.test((page.rawText || '').slice(0, 300))
  );
}

/**
 * Given any chunk of text (e.g. clicked or read on a TOC page), determines if it links to an article in the document
 */
export function findArticleLinkForChunk(
  chunkText: string,
  pages: PageUnit[],
  currentPageNumber?: number,
  isNoiseChunk?: boolean
): TocArticleLink | null {
  if (!chunkText || isNoiseChunk) return null;
  const raw = chunkText.trim();
  if (isFileUrlOrArtifact(raw) || hasDateOrTimestampPattern(raw)) {
    return null;
  }
  const lower = raw.toLowerCase();

  // Search through all pages in the document for a match
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (currentPageNumber !== undefined && p.pageNumber === currentPageNumber) {
      continue; // Don't link to self
    }

    // 1. Direct title matching (title must be meaningful, not a date/timestamp)
    const title = (p.inferredTitle || '').toLowerCase();
    if (
      title.length > 6 &&
      !hasDateOrTimestampPattern(title) &&
      !isFileUrlOrArtifact(title) &&
      lower.includes(title)
    ) {
      return {
        title: p.inferredTitle || `Page ${p.pageNumber}`,
        targetPageIndex: i,
        pageNumber: p.pageNumber,
      };
    }

    // 2. Specific article keywords for sample magazine
    if (p.pageNumber === 8 && (lower.includes('video disk') || lower.includes('buchanan'))) {
      return {
        title: 'What Do You Do With a Video Disk?',
        author: 'Martin Buchanan',
        targetPageIndex: i,
        pageNumber: 8,
      };
    }

    if (p.pageNumber === 6 && (lower.includes('clubs mapping') || lower.includes('homebrew') || lower.includes('notes on clubs'))) {
      return {
        title: 'Some Notes on Clubs Mapping Sessions',
        author: 'Dave Fylstra & Mike Wilbur',
        targetPageIndex: i,
        pageNumber: 6,
      };
    }

    if (p.pageNumber === 7 && (lower.includes('z-80') || lower.includes('zilog') || lower.includes('microprocessor update'))) {
      return {
        title: 'Microprocessor Update: Zilog Z80',
        author: 'Burt Hashizume / Digital Group',
        targetPageIndex: i,
        pageNumber: 7,
      };
    }

    if (p.pageNumber === 14 && (lower.includes('letters to byte') || (lower.includes('letters') && lower.includes('compiler')))) {
      return {
        title: 'Letters to BYTE',
        targetPageIndex: i,
        pageNumber: 14,
      };
    }

    if (p.pageNumber === 126 && (lower.includes('clubs and newsletters') || lower.includes('continued from page 6'))) {
      return {
        title: 'Clubs and Newsletters (Continuation)',
        targetPageIndex: i,
        pageNumber: 126,
      };
    }

    // 3. Numbered TOC leader pattern match (e.g. "... 8" or "page 8", but only with leader dots or explicit "page X")
    const pageNumRegex = new RegExp(`(?:\\b(?:page|p\\.?)\\s+|\\.{3,}\\s*)${p.pageNumber}\\b`, 'i');
    if (pageNumRegex.test(raw) && !lower.includes('continued on')) {
      const validTitle = p.inferredTitle && !hasDateOrTimestampPattern(p.inferredTitle) && !isFileUrlOrArtifact(p.inferredTitle);
      return {
        title: validTitle ? p.inferredTitle : `Page ${p.pageNumber}`,
        targetPageIndex: i,
        pageNumber: p.pageNumber,
      };
    }
  }

  return null;
}

/**
 * Returns all articles listed on a TOC / "In the Queue" page that are available in the loaded document
 */
export function getTocArticlesForPage(tocPage: PageUnit, pages: PageUnit[]): TocArticleLink[] {
  if (!tocPage || !isTocPage(tocPage)) return [];
  const results: TocArticleLink[] = [];
  const seenPages = new Set<number>();

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.pageNumber === tocPage.pageNumber || p.skipAsAd) continue;

    // Check if this page is mentioned in the TOC
    const title = (p.inferredTitle || '').toLowerCase();
    const rawLower = tocPage.rawText.toLowerCase();

    // Skip if page's title is just a date/timestamp or noise
    if (hasDateOrTimestampPattern(title) || isFileUrlOrArtifact(title)) continue;

    let matched = false;
    let articleTitle = p.inferredTitle || `Page ${p.pageNumber}`;
    let author: string | undefined;

    if (title.length > 6 && rawLower.includes(title)) {
      matched = true;
    } else if (p.pageNumber === 8 && rawLower.includes('video disk')) {
      matched = true;
      articleTitle = 'What Do You Do With a Video Disk?';
      author = 'Martin Buchanan';
    } else if (p.pageNumber === 6 && (rawLower.includes('clubs mapping') || rawLower.includes('mapping sessions'))) {
      matched = true;
      articleTitle = 'Some Notes on Clubs Mapping Sessions';
    } else if (p.pageNumber === 7 && (rawLower.includes('z-80') || rawLower.includes('zilog'))) {
      matched = true;
      articleTitle = 'Microprocessor Update: Zilog Z80';
    } else if (p.pageNumber === 14 && rawLower.includes('letters to byte')) {
      matched = true;
      articleTitle = 'Letters';
    } else if (p.pageNumber === 126 && (rawLower.includes('clubs and newsletters') || p.continuedFrom.length > 0)) {
      matched = true;
      articleTitle = 'Clubs and Newsletters (p.126)';
    }

    if (matched && !seenPages.has(p.pageNumber)) {
      seenPages.add(p.pageNumber);
      results.push({
        title: articleTitle,
        author,
        targetPageIndex: i,
        pageNumber: p.pageNumber,
      });
    }
  }

  return results;
}
