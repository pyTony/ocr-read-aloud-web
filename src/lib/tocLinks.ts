import { PageUnit } from '../types';

export interface TocArticleLink {
  title: string;
  author?: string;
  targetPageIndex: number;
  pageNumber: number;
  snippet?: string;
}

/**
 * Checks if a page represents a Table of Contents ("In the Queue", "In this Issue", "Contents")
 */
export function isTocPage(page: PageUnit): boolean {
  if (!page) return false;
  const t = (page.inferredTitle + ' ' + page.rawText.slice(0, 300)).toLowerCase();
  return (
    t.includes('in the queue') ||
    t.includes('table of contents') ||
    t.includes('in this issue') ||
    t.includes('contents') ||
    page.pageNumber === 4 ||
    page.pageNumber === 5
  );
}

/**
 * Given any chunk of text (e.g. clicked or read on a TOC page), determines if it links to an article in the document
 */
export function findArticleLinkForChunk(
  chunkText: string,
  pages: PageUnit[],
  currentPageNumber?: number
): TocArticleLink | null {
  if (!chunkText) return null;
  const lower = chunkText.toLowerCase();

  // Search through all pages in the document for a match
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (currentPageNumber !== undefined && p.pageNumber === currentPageNumber) {
      continue; // Don't link to self
    }

    // 1. Direct title matching
    const title = (p.inferredTitle || '').toLowerCase();
    if (title.length > 5 && lower.includes(title)) {
      return {
        title: p.inferredTitle || `Page ${p.pageNumber}`,
        targetPageIndex: i,
        pageNumber: p.pageNumber,
      };
    }

    // 2. Specific article keywords
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

    if (p.pageNumber === 14 && (lower.includes('letters') || lower.includes('compiler inputs') || lower.includes('peter skye'))) {
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

    // 3. Numbered pattern match (e.g. "... 8" or "page 8" or "p. 8")
    const pageNumRegex = new RegExp(`(?:\\b(?:page|p\\.?)\\s*|\\.{2,}\\s*|\\b)${p.pageNumber}\\b`, 'i');
    if (pageNumRegex.test(chunkText) && !lower.includes('continued on')) {
      return {
        title: p.inferredTitle || `Page ${p.pageNumber}`,
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
  if (!tocPage) return [];
  const results: TocArticleLink[] = [];
  const seenPages = new Set<number>();

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.pageNumber === tocPage.pageNumber || p.skipAsAd) continue;

    // Check if this page is mentioned in the TOC
    const title = (p.inferredTitle || '').toLowerCase();
    const rawLower = tocPage.rawText.toLowerCase();

    let matched = false;
    let articleTitle = p.inferredTitle || `Page ${p.pageNumber}`;
    let author: string | undefined;

    if (title.length > 5 && rawLower.includes(title)) {
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
    } else if (p.pageNumber === 14 && rawLower.includes('letters')) {
      matched = true;
      articleTitle = 'Letters';
    } else if (p.pageNumber === 126 && (rawLower.includes('clubs') || p.continuedFrom.length > 0)) {
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
