import React from 'react';
import { PageUnit } from '../types';
import { FileText, ArrowRight, ArrowLeft, Sparkles, BookOpen, ExternalLink, PanelLeftClose, Upload, Layers } from 'lucide-react';
import { isTocPage, getTocArticlesForPage } from '../lib/tocLinks';
import { ensurePageJpegImage, generateCanvasJpegForPage } from '../lib/pageImageGenerator';

interface PageListSidebarProps {
  pages: PageUnit[];
  currentPageIndex: number;
  onSelectPage: (index: number) => void;
  onToggleSkipAd: (index: number) => void;
  onToggleCollapse?: () => void;
  onOpenUploadModal?: () => void;
  onLoadSample?: () => void;
  width?: number;
  isSampleDocument?: boolean;
}

export const PageListSidebar: React.FC<PageListSidebarProps> = ({
  pages,
  currentPageIndex,
  onSelectPage,
  onToggleSkipAd,
  onToggleCollapse,
  onOpenUploadModal,
  onLoadSample,
  width,
  isSampleDocument = false,
}) => {
  // Gather all indexed articles from TOC pages for sanity checking
  const indexedArticleMap = React.useMemo(() => {
    const map = new Map<number, string>();
    pages.forEach(p => {
      if (isTocPage(p)) {
        const articles = getTocArticlesForPage(p, pages);
        articles.forEach(a => {
          map.set(a.pageNumber, a.title);
        });
      }
    });
    return map;
  }, [pages]);

  return (
    <div
      style={width ? { width: `${width}px` } : undefined}
      className="w-full border-r border-neutral-800 bg-neutral-900 flex flex-col h-full select-none shrink-0 overflow-hidden"
    >
      {/* Sidebar Header */}
      <div className="p-2.5 sm:p-3 border-b border-neutral-800 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider block truncate">
            Pages &amp; Articles ({pages.length})
          </span>
          <span className="text-[10px] text-neutral-400 font-mono block truncate">
            {pages.length} Pages · Thumbnails
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onOpenUploadModal && (
            <button
              onClick={onOpenUploadModal}
              className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-amber-400 border border-neutral-700 hover:border-amber-500/50 transition-colors"
              title="Open Document / Upload File (PDF, TXT, MD, Image)"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="text-[10px] text-amber-400 font-mono px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700">
            {isSampleDocument ? 'Demo 1976' : 'Document'}
          </span>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Collapse Pages Panel ([ or Ctrl+B)"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Pages List with Mini JPEG Thumbnails */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {pages.length === 0 ? (
          <div className="p-4 text-center space-y-3">
            <p className="text-xs text-neutral-400">No pages loaded</p>
            {onOpenUploadModal && (
              <button
                onClick={onOpenUploadModal}
                className="w-full py-2 px-3 rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs flex items-center justify-center gap-2"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload File</span>
              </button>
            )}
            {onLoadSample && (
              <button
                onClick={onLoadSample}
                className="w-full py-1.5 px-3 rounded bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-xs flex items-center justify-center gap-2 border border-neutral-700"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Load 1976 Demo</span>
              </button>
            )}
          </div>
        ) : (
          pages.map((page, index) => {
            const isCurrent = index === currentPageIndex;
            const isToc = isTocPage(page);
            const tocArticles = isToc ? getTocArticlesForPage(page, pages) : [];
            const matchedTocTitle = indexedArticleMap.get(page.pageNumber);

            return (
              <div
                key={`page-${index}`}
                onClick={() => onSelectPage(index)}
                className={`p-2 rounded-lg border text-left cursor-pointer transition-all ${
                  isCurrent
                    ? 'bg-neutral-800/90 border-amber-500 shadow-md ring-1 ring-amber-500/30'
                    : 'bg-neutral-950/50 border-neutral-800/80 hover:bg-neutral-800/50 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {/* Mini JPEG Thumbnail Preview */}
                  <div
                    className={`w-12 h-16 shrink-0 rounded overflow-hidden border bg-neutral-950 relative shadow-sm transition-transform ${
                      isCurrent
                        ? 'border-amber-500 ring-1 ring-amber-500/50 scale-[1.02]'
                        : 'border-neutral-700 group-hover:border-neutral-600'
                    }`}
                  >
                    <img
                      src={ensurePageJpegImage(page, pages.length)}
                      alt={page.label || `Page ${page.pageNumber}`}
                      className="w-full h-full object-cover object-top"
                      loading="lazy"
                      onError={(e) => {
                        const fallback = generateCanvasJpegForPage(
                          page.label || `Page ${page.pageNumber}`,
                          page.pageNumber,
                          pages.length,
                          page.rawText || ''
                        );
                        if (fallback) {
                          (e.currentTarget as HTMLImageElement).src = fallback;
                        }
                      }}
                    />

                    {/* Overlaid Ad Chip */}
                    {page.skipAsAd && (
                      <div className="absolute inset-x-0 bottom-0 bg-amber-950/90 py-0.5 px-1 border-t border-amber-800 text-center">
                        <span className="text-[8px] font-bold uppercase text-amber-300 font-mono tracking-wider">
                          AD
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Page Details & Title of Main Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono text-[11px] px-1.5 py-0.2 rounded font-bold ${
                            isCurrent
                              ? 'bg-amber-500 text-neutral-950'
                              : 'bg-neutral-800 text-neutral-300'
                          }`}
                        >
                          {page.label || `Page ${page.pageNumber}`}
                        </span>

                        {isToc && (
                          <span className="text-[9px] font-semibold uppercase px-1 py-0.2 rounded bg-sky-950 text-sky-400 border border-sky-800">
                            TOC
                          </span>
                        )}

                        {matchedTocTitle && !isToc && (
                          <span
                            className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80 flex items-center gap-0.5"
                            title={`Sanity Checked against TOC Index: "${matchedTocTitle}"`}
                          >
                            <span>Indexed ✓</span>
                          </span>
                        )}

                        {page.isProofread && (
                          <span title="Proofread" className="text-emerald-400">
                            <Sparkles className="w-3 h-3" />
                          </span>
                        )}
                      </div>

                      {/* Ad Toggle Chip */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSkipAd(index);
                        }}
                        className={`text-[9px] px-1 py-0.2 rounded font-medium transition-colors ${
                          page.skipAsAd
                            ? 'bg-amber-950 text-amber-300 border border-amber-800 hover:bg-amber-900'
                            : 'text-neutral-500 hover:text-neutral-300'
                        }`}
                        title={page.skipAsAd ? 'Marked as ad (click to unmark)' : 'Mark as ad'}
                      >
                        {page.skipAsAd ? 'Ad (Skip)' : 'Not Ad'}
                      </button>
                    </div>

                    {/* Title of Main Text */}
                    <h4 className="text-xs font-semibold text-neutral-200 line-clamp-2 leading-snug mb-1">
                      {page.inferredTitle || 'Untitled Page'}
                    </h4>

                    {/* Continuation Badges */}
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                      {page.continuedOn.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-indigo-400 font-mono font-medium">
                          <ArrowRight className="w-2.5 h-2.5" />
                          <span>Cont p.{page.continuedOn.join(', ')}</span>
                        </span>
                      )}
                      {page.continuedFrom.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-emerald-400 font-mono font-medium">
                          <ArrowLeft className="w-2.5 h-2.5" />
                          <span>From p.{page.continuedFrom.join(', ')}</span>
                        </span>
                      )}
                      <span className="text-neutral-500 font-mono text-[9.5px]">
                        {page.chunks.length}p · {page.lines.length}l
                      </span>
                    </div>
                  </div>
                </div>

                {/* Table of Contents / "In the Queue" Quick Links */}
                {isToc && tocArticles.length > 0 && (
                  <div className="mt-2 pt-1.5 border-t border-neutral-800/80">
                    <div className="flex items-center gap-1 text-[10px] text-amber-400 font-semibold mb-1">
                      <BookOpen className="w-3 h-3" />
                      <span>In the Queue Articles:</span>
                    </div>
                    <div className="space-y-1">
                      {tocArticles.map((art) => (
                        <button
                          key={`toc-link-${art.pageNumber}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPage(art.targetPageIndex);
                          }}
                          className="w-full flex items-center justify-between text-left px-1.5 py-0.5 rounded bg-neutral-900 hover:bg-neutral-750 text-[10px] text-neutral-300 hover:text-amber-300 transition-colors group"
                        >
                          <span className="truncate pr-1">• {art.title}</span>
                          <span className="font-mono text-amber-400 text-[9px] shrink-0 flex items-center gap-0.5">
                            p.{art.pageNumber}
                            <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Quick Footer */}
      <div className="p-2 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-between gap-1.5 text-[10px]">
        {onOpenUploadModal && (
          <button
            onClick={onOpenUploadModal}
            className="flex-1 py-1 px-2 rounded bg-neutral-800 hover:bg-neutral-750 text-neutral-200 border border-neutral-700 flex items-center justify-center gap-1 font-medium transition-colors"
          >
            <Upload className="w-3 h-3 text-amber-400" />
            <span>Open Document...</span>
          </button>
        )}
        {onLoadSample && (
          <button
            onClick={onLoadSample}
            className="py-1 px-2 rounded bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border border-amber-800/60 flex items-center gap-1 font-mono transition-colors"
            title="Reset to 1976 BYTE Magazine Demo"
          >
            <Layers className="w-3 h-3" />
            <span>Demo</span>
          </button>
        )}
      </div>
    </div>
  );
};


