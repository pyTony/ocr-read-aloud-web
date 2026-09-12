import React, { useState, useRef, useMemo, useEffect } from 'react';
import { PageUnit } from '../types';
import { splitIntoSentences } from '../lib/layoutAndColumns';
import { isTocPage, getTocArticlesForPage, findArticleLinkForChunk } from '../lib/tocLinks';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  AlertTriangle,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  SkipForward,
  Volume2,
  FileText,
  BookOpen,
  Eye,
  Sliders,
  ExternalLink,
  ArrowRight,
  PanelLeft,
  Highlighter,
  Sparkles,
} from 'lucide-react';

interface ReadingPreviewProps {
  currentPage: PageUnit | null;
  currentChunkIndex: number;
  currentSentenceIndex: number;
  currentSentenceText: string;
  isPlaying: boolean;
  isPaused: boolean;
  currentPageIndex: number;
  totalPages: number;
  totalChunks: number;
  totalSentences: number;
  pages?: PageUnit[];
  onSelectPage?: (pageIndex: number) => void;
  onSelectChunk: (chunkIdx: number) => void;
  onSelectSentence: (chunkIdx: number, sentenceIdx: number) => void;
  onTogglePlay: () => void;
  onPrevSentence?: () => void;
  onNextSentence?: () => void;
  onToggleSkipAsAd?: (pageIndex: number) => void;
  onNextPage?: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  showHighlights?: boolean;
  onToggleHighlights?: () => void;
  onOcrCurrentPage?: () => void;
}

type ViewMode = 'tk-preview' | 'split-context' | 'full-text';

export const ReadingPreview: React.FC<ReadingPreviewProps> = ({
  currentPage,
  currentChunkIndex,
  currentSentenceIndex,
  currentSentenceText,
  isPlaying,
  isPaused,
  currentPageIndex,
  totalPages,
  totalChunks,
  totalSentences,
  pages = [],
  onSelectPage,
  onSelectChunk,
  onSelectSentence,
  onTogglePlay,
  onPrevSentence,
  onNextSentence,
  onToggleSkipAsAd,
  onNextPage,
  isSidebarOpen,
  onToggleSidebar,
  showHighlights = true,
  onToggleHighlights,
  onOcrCurrentPage,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('tk-preview');
  const [fitMode, setFitMode] = useState<'page' | 'width'>('page');
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const activeChunkRef = useRef<HTMLDivElement>(null);

  // ResizeObserver on the viewport container to compute exact pixel-perfect fit
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setViewportSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // TOC detection and article linking
  const isToc = currentPage ? isTocPage(currentPage) : false;
  const tocArticles = useMemo(() => {
    return isToc && currentPage ? getTocArticlesForPage(currentPage, pages) : [];
  }, [isToc, currentPage, pages]);

  const currentChunk = currentPage?.chunks[currentChunkIndex];
  const activeArticleLink = useMemo(() => {
    if (!currentChunk || !pages.length || !currentPage) return null;
    return findArticleLinkForChunk(currentChunk.text, pages, currentPage.pageNumber);
  }, [currentChunk, pages, currentPage]);

  const pageWidth = currentPage?.width || 800;
  const pageHeight = currentPage?.height || 1100;
  const displayPageNum = currentPage?.pageNumber || currentPageIndex + 1;

  // Exact viewport dimensions ensuring 100% full-page fit with zero clipping
  const containerPadding = 24;
  const availW = Math.max(200, (viewportSize.width || 800) - containerPadding);
  const availH = Math.max(200, (viewportSize.height || 600) - containerPadding);

  let displayWidth: number;
  let displayHeight: number;

  if (fitMode === 'width') {
    displayWidth = Math.round(availW * zoomLevel);
    displayHeight = Math.round((displayWidth / pageWidth) * pageHeight);
  } else {
    const fitScale = Math.min(availW / pageWidth, availH / pageHeight);
    displayWidth = Math.round(pageWidth * fitScale * zoomLevel);
    displayHeight = Math.round(pageHeight * fitScale * zoomLevel);
  }

  // Toggle Fit Mode: Fit to Page <-> Fit to Width
  const toggleFitMode = () => {
    setFitMode((prev) => (prev === 'page' ? 'width' : 'page'));
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  // Keyboard shortcut: 'w' or 'W' toggles Fit to Page vs Fit to Width
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        toggleFitMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // In Fit-to-Width mode, gently keep the active paragraph in view if it falls outside the viewport
  useEffect(() => {
    if (fitMode !== 'width' || !activeChunkRef.current || !viewportRef.current) return;
    const vp = viewportRef.current;
    const chunkEl = activeChunkRef.current;
    const vpRect = vp.getBoundingClientRect();
    const chunkRect = chunkEl.getBoundingClientRect();

    if (chunkRect.top < vpRect.top + 60 || chunkRect.bottom > vpRect.bottom - 60) {
      chunkEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentChunkIndex, fitMode]);

  // Split all chunks into sentences for context
  const parsedChunks = useMemo(() => {
    if (!currentPage) return [];
    return currentPage.chunks.map((chunk, cIdx) => {
      const s = splitIntoSentences(chunk.text);
      return {
        chunk,
        chunkIdx: cIdx,
        sentences: s.length > 0 ? s : [chunk.text],
      };
    });
  }, [currentPage]);

  // Flatten sentences for sequential rolling context
  const flatSentences = useMemo(() => {
    const list: { chunkIdx: number; sentenceIdx: number; text: string }[] = [];
    parsedChunks.forEach(({ chunkIdx, sentences }) => {
      sentences.forEach((text, sentenceIdx) => {
        list.push({ chunkIdx, sentenceIdx, text });
      });
    });
    return list;
  }, [parsedChunks]);

  const activeFlatIdx = flatSentences.findIndex(
    (s) => s.chunkIdx === currentChunkIndex && s.sentenceIdx === currentSentenceIndex
  );

  // Rolling 3-sentence context (Prev, Active, Next) - Strictly "Show Less Text"
  const prevSentence = activeFlatIdx > 0 ? flatSentences[activeFlatIdx - 1]?.text : null;
  const nextSentence = activeFlatIdx >= 0 && activeFlatIdx < flatSentences.length - 1 ? flatSentences[activeFlatIdx + 1]?.text : null;

  // Zoom handlers matching Python Tk zoom_in / zoom_out / zoom_reset
  const zoomIn = () => setZoomLevel((z) => Math.min(3.5, +(z + 0.15).toFixed(2)));
  const zoomOut = () => setZoomLevel((z) => Math.max(0.5, +(z - 0.15).toFixed(2)));
  const zoomReset = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  // Scroll wheel on window/preview canvas to zoom in/out
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // In fitMode === 'page' (entire page visible without scrollbar) or when holding Ctrl / Cmd / Alt:
      // Allow scroll wheel to zoom in and out
      if (fitMode === 'page' || e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        e.stopPropagation();

        if (e.deltaY < 0) {
          // Scroll up = Zoom in
          setZoomLevel((z) => Math.min(3.5, +(z + 0.1).toFixed(2)));
        } else if (e.deltaY > 0) {
          // Scroll down = Zoom out
          setZoomLevel((z) => Math.max(0.5, +(z - 0.1).toFixed(2)));
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [fitMode]);

  // Mouse pan / drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel <= 1.0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  if (!currentPage) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-neutral-500 bg-neutral-950">
        <p>No document loaded. Please upload a PDF or load the sample issue.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-neutral-950 overflow-hidden select-none relative">
      {/* 
        ========================================================================
        TOP OVER JPG PREVIEW: EXACT PYTHON / TKINTER PREVIEW HEADER
        1) Current Sentence Caption (Tk: self._caption = Label(font=("Segoe UI", 11)))
        2) Position Banner (Tk: self._position = Label(font=("Segoe UI", 16, bold), bg="#333333"))
        ========================================================================
      */}
      <div className="bg-neutral-900 border-b border-neutral-800 shrink-0 z-20 shadow-md">
        {/* Row 1: Current Sentence Caption (Shows LESS text, 1-2 lines, exactly like Tk) */}
        <div className="px-3 py-2 flex items-center justify-between gap-3 bg-neutral-900/95 border-b border-neutral-800/80">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Show Pages Sidebar Button when collapsed */}
            {!isSidebarOpen && onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-xs font-medium transition-colors shrink-0"
                title="Show Pages Sidebar ([ or Ctrl+B)"
              >
                <PanelLeft className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline text-[11px] font-mono">Pages ({totalPages})</span>
              </button>
            )}

            {/* Quick Transport Stepper Buttons */}
            <button
              onClick={onTogglePlay}
              className={`p-1.5 rounded-md transition-colors shrink-0 ${
                isPlaying
                  ? 'bg-amber-500 text-neutral-950 hover:bg-amber-400'
                  : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
              }`}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            <button
              onClick={onPrevSentence}
              className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors shrink-0"
              title="Previous sentence (Left Arrow / Rew)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              onClick={onNextSentence}
              className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors shrink-0"
              title="Next sentence (Right Arrow / Fwd)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* The Active Spoken Sentence - Clean, readable, NOT truncated with giant paragraphs */}
            <div className="flex-1 min-w-0 font-serif text-sm md:text-base text-amber-200 leading-snug truncate">
              {currentSentenceText ? (
                <span title={currentSentenceText}>
                  "{currentSentenceText}"
                </span>
              ) : (
                <span className="text-neutral-500 italic font-sans text-xs">
                  Press Play or click any red region on the page to start reading...
                </span>
              )}
            </div>
          </div>

            {/* Mode switch, Fit toggle, & Zoom controls */}
          <div className="flex items-center gap-1.5 shrink-0 text-xs flex-wrap justify-end">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-neutral-950 p-0.5 rounded border border-neutral-800">
              <button
                onClick={() => setViewMode('tk-preview')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'tk-preview'
                    ? 'bg-amber-500 text-neutral-950 font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title="Python/Tk Preview: Top Caption & Position + Scanned Page"
              >
                Tk Preview
              </button>
              <button
                onClick={() => setViewMode('split-context')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'split-context'
                    ? 'bg-amber-500 text-neutral-950 font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title="Split Rolling Context: 3-Sentence Teleprompter (No scrolling flash)"
              >
                Rolling 3-Sentences
              </button>
              <button
                onClick={() => setViewMode('full-text')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'full-text'
                    ? 'bg-amber-500 text-neutral-950 font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title="Full Article OCR Text"
              >
                Article Text
              </button>
            </div>

            {/* Fit to Page vs Fit to Width Segmented Toggle */}
            {viewMode !== 'full-text' && (
              <div className="flex items-center bg-neutral-950 p-0.5 rounded border border-neutral-800">
                <button
                  onClick={() => {
                    setFitMode('page');
                    setZoomLevel(1.0);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    fitMode === 'page'
                      ? 'bg-amber-500 text-neutral-950 font-bold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                  title="Fit to Page: Show entire page without vertical scrolling (Key: W)"
                >
                  <Minimize2 className="w-3 h-3" />
                  <span>Fit Page</span>
                </button>
                <button
                  onClick={() => {
                    setFitMode('width');
                    setZoomLevel(1.0);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    fitMode === 'width'
                      ? 'bg-amber-500 text-neutral-950 font-bold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                  title="Fit to Width: Expand page to fill full width with vertical scrolling (Key: W)"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>Fit Width</span>
                </button>
              </div>
            )}

            {/* Visual Highlight Overlay Toggle */}
            {viewMode !== 'full-text' && onToggleHighlights && (
              <button
                onClick={onToggleHighlights}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono transition-colors border ${
                  showHighlights
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-white'
                }`}
                title="Toggle visual paragraph highlight boxes on/off (Key: H)"
              >
                <Highlighter className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{showHighlights ? 'Highlights' : 'Clean Scan'}</span>
              </button>
            )}

            {/* Zoom Controls */}
            {viewMode !== 'full-text' && (
              <div className="hidden sm:flex items-center gap-0.5 bg-neutral-950 px-1 py-0.5 rounded border border-neutral-800 font-mono text-[11px]">
                <button
                  onClick={zoomOut}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Zoom out (-)"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={zoomReset}
                  className="px-1.5 py-0.5 text-neutral-400 hover:text-white hover:bg-neutral-900 rounded min-w-[38px] text-center transition-colors"
                  title="Click to reset zoom to 100% (Key: 0). Use mouse scroll wheel to zoom in/out."
                >
                  {Math.round(zoomLevel * 100)}%
                </button>
                <button
                  onClick={zoomIn}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Zoom in (+)"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Exact Python Tk Position Banner (#333333 dark strip with bold white text) */}
        <div className="bg-[#333333] px-3 py-1.5 flex items-center justify-between text-white font-mono text-xs md:text-sm font-bold shadow-inner">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="tracking-wide">
              Page {displayPageNum} · para {currentChunkIndex + 1}/{Math.max(1, totalChunks)} · sent {currentSentenceIndex + 1}/{Math.max(1, totalSentences)} · page {currentPageIndex + 1}/{totalPages}
            </span>

            {/* Playback status tag */}
            <span className="text-[11px] font-sans font-normal opacity-90 px-1.5 py-0.2 rounded bg-neutral-900/60 border border-neutral-600 flex items-center gap-1">
              {isPlaying ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping inline-block" />
                  <span>Reading…</span>
                </>
              ) : isPaused ? (
                <span>Paused</span>
              ) : (
                <span>Ready</span>
              )}
            </span>
          </div>

          {/* Ad Page status & action in Position Bar */}
          {currentPage.skipAsAd && (
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1 bg-amber-900/90 text-amber-200 border border-amber-600 px-2 py-0.5 rounded text-[11px] font-sans font-semibold">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span>Commercial / Ad Insert (Auto-skips)</span>
              </span>

              {onNextPage && (
                <button
                  onClick={onNextPage}
                  className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-[11px] font-sans font-medium flex items-center gap-1 border border-neutral-600"
                  title="Skip ad to next page"
                >
                  <span>Skip Now</span>
                  <SkipForward className="w-3 h-3" />
                </button>
              )}

              {onToggleSkipAsAd && (
                <button
                  onClick={() => onToggleSkipAsAd(currentPageIndex)}
                  className="text-[10px] underline text-neutral-300 hover:text-white"
                >
                  Unmark
                </button>
              )}
            </div>
          )}
        </div>

        {/* 
          Row 3 (ONLY when in split-context mode): Rolling 3-Sentence Teleprompter Strip
          "Show less text" - Prev sentence, Current active sentence in amber, Next sentence.
          Zero downward scrolling! Zero flashing!
        */}
        {viewMode === 'split-context' && (
          <div className="bg-neutral-950 px-4 py-2 border-t border-neutral-800 text-xs font-serif space-y-1 select-text">
            {prevSentence && (
              <div className="text-neutral-500 truncate text-[11px] flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-600 shrink-0">Prev</span>
                <span className="truncate">{prevSentence}</span>
              </div>
            )}
            <div className="text-amber-300 font-semibold text-sm flex items-start gap-2 bg-amber-950/30 p-1 rounded border border-amber-500/30">
              <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
              <span>{currentSentenceText}</span>
            </div>
            {nextSentence && (
              <div className="text-neutral-400 truncate text-[11px] flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-600 shrink-0">Next</span>
                <span className="truncate">{nextSentence}</span>
              </div>
            )}
          </div>
        )}

        {/* 
          Row 4: "In the Queue" / Table of Contents Article Links Ribbon
          Enables instantaneous jumps to any article directly from Page 5 or active TOC
        */}
        {isToc && tocArticles.length > 0 && (
          <div className="bg-neutral-900/95 border-t border-amber-500/30 px-3 py-1.5 flex items-center gap-2 overflow-x-auto text-xs scrollbar-thin">
            <span className="flex items-center gap-1 font-mono font-bold text-[11px] text-amber-400 shrink-0">
              <BookOpen className="w-3.5 h-3.5" />
              <span>In the Queue:</span>
            </span>
            <div className="flex items-center gap-1.5 flex-nowrap">
              {tocArticles.map((art, idx) => (
                <button
                  key={`toc-strip-${idx}`}
                  onClick={() => onSelectPage?.(art.targetPageIndex)}
                  className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-amber-500 hover:text-neutral-950 text-neutral-200 text-[11px] font-medium border border-neutral-700 transition-colors whitespace-nowrap flex items-center gap-1"
                  title={`Jump to Page ${art.pageNumber}: ${art.title}`}
                >
                  <span className="font-mono text-amber-400 font-bold">p.{art.pageNumber}</span>
                  <span className="max-w-[140px] truncate">{art.title}</span>
                  <ArrowRight className="w-2.5 h-2.5 opacity-70" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active paragraph article link reminder (when reading an entry that points to another page) */}
        {activeArticleLink && !isToc && (
          <div className="bg-indigo-950/90 border-t border-indigo-700/60 px-3 py-1 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-indigo-200 truncate">
              <span className="font-mono text-[10px] uppercase font-bold text-indigo-400 bg-indigo-900/60 px-1 rounded">Article Jump</span>
              <span className="truncate">Related article: <strong>{activeArticleLink.title}</strong> (Page {activeArticleLink.pageNumber})</span>
            </div>
            {onSelectPage && (
              <button
                onClick={() => onSelectPage(activeArticleLink.targetPageIndex)}
                className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1 shrink-0 ml-2"
              >
                <span>Jump to p.{activeArticleLink.pageNumber}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 
        ========================================================================
        MAIN VIEWPORT: SCANNED PAGE PREVIEW OR FULL OCR TEXT
        100% FLASH-FREE MATHEMATICAL PERCENTAGE BOUNDING BOXES!
        Zero ResizeObserver re-render loops.
        ========================================================================
      */}
      {viewMode !== 'full-text' ? (
        <div
          ref={viewportRef}
          className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-3 bg-neutral-950 relative select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: zoomLevel > 1.0 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        >
          {/* Constrained Aspect-Ratio Container matching Original Page Scan */}
          <div
            className="relative shadow-2xl rounded border border-neutral-750 bg-white transition-all select-none shrink-0 m-auto"
            style={{
              width: `${displayWidth}px`,
              height: `${displayHeight}px`,
              transform: panOffset.x !== 0 || panOffset.y !== 0 ? `translate(${panOffset.x}px, ${panOffset.y}px)` : undefined,
            }}
          >
            {/* Page Scan Image */}
            {currentPage.image ? (
              <img
                src={currentPage.image}
                alt={currentPage.label}
                style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
                className="block rounded select-none pointer-events-none object-fill"
              />
            ) : (
              <div className="w-full h-full p-6 text-neutral-800 bg-amber-50/20 font-serif text-xs leading-relaxed overflow-hidden">
                <div className="text-[10px] uppercase font-mono tracking-wider text-neutral-400 mb-2 pb-1 border-b border-neutral-200">
                  {currentPage.label} · Text Canvas
                </div>
                <p className="whitespace-pre-wrap">{currentPage.rawText}</p>
              </div>
            )}

            {/* 
              INTERACTIVE BOUNDING BOXES:
              Expressed in exact percentage of pageWidth / pageHeight!
              Synchronous, GPU-aligned, perfectly responsive, zero flashing!
              Active speaking region highlighted in Tk Red (rgb(239, 68, 68)).
            */}
            {showHighlights && currentPage.chunks.map((chunk, idx) => {
              const isActive = idx === currentChunkIndex;

              // Skip highlight if the chunk covers 85%+ of the whole page (Python covers_page rule)
              const coversPage =
                (chunk.width / pageWidth >= 0.85 && chunk.height / pageHeight >= 0.85) ||
                chunk.width <= 0 ||
                chunk.height <= 0;

              const leftPercent = (chunk.left / pageWidth) * 100;
              const topPercent = (chunk.top / pageHeight) * 100;
              const widthPercent = (chunk.width / pageWidth) * 100;
              const heightPercent = (chunk.height / pageHeight) * 100;
              const chunkArticleLink = pages.length ? findArticleLinkForChunk(chunk.text, pages, currentPage.pageNumber) : null;

              // Only illuminate active Tk Red glow when active AND playing/paused AND not full-page cover
              const shouldShowActiveRed = isActive && !coversPage && (isPlaying || isPaused);

              return (
                <div
                  key={`chunk-box-${idx}`}
                  ref={isActive ? activeChunkRef : undefined}
                  onClick={() => onSelectChunk(idx)}
                  className={`absolute cursor-pointer transition-all rounded ${
                    shouldShowActiveRed
                      ? 'border-2 border-red-500 bg-red-500/20 shadow-[0_0_12px_rgba(239,68,68,0.6)] z-20'
                      : isActive && !coversPage
                        ? 'border border-amber-500/50 bg-amber-500/10 z-15'
                        : 'hover:bg-amber-400/15 hover:border hover:border-amber-400/40 z-10'
                  }`}
                  style={{
                    left: `${leftPercent}%`,
                    top: `${topPercent}%`,
                    width: `${widthPercent}%`,
                    height: `${heightPercent}%`,
                  }}
                  title={`Paragraph ${idx + 1}: Click to play aloud\n"${chunk.text.slice(0, 70)}..."`}
                >
                  {/* Paragraph Number Badge */}
                  <div
                    className={`absolute -top-2.5 -left-1 px-1 py-0.2 rounded font-mono text-[9px] font-bold shadow ${
                      shouldShowActiveRed
                        ? 'bg-red-600 text-white'
                        : isActive && !coversPage
                          ? 'bg-amber-600 text-white'
                          : 'bg-neutral-800 text-neutral-300 opacity-60 hover:opacity-100'
                    }`}
                  >
                    {idx + 1}
                  </div>

                  {/* If this chunk is a Table of Contents entry pointing to an article, show direct jump link */}
                  {chunkArticleLink && onSelectPage && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPage(chunkArticleLink.targetPageIndex);
                      }}
                      className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 font-sans font-bold text-[10px] shadow flex items-center gap-1 z-30 transition-transform hover:scale-105"
                      title={`Jump directly to Page ${chunkArticleLink.pageNumber}: ${chunkArticleLink.title}`}
                    >
                      <span>Read p.{chunkArticleLink.pageNumber}</span>
                      <ArrowRight className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Floating OCR prompt if current page has zero text chunks (e.g. Scanned PDF page) */}
          {currentPage.chunks.length === 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-neutral-900/95 border border-amber-500/50 rounded-lg px-4 py-2.5 shadow-2xl flex items-center gap-3 z-30 text-xs">
              <div className="text-amber-400 shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-neutral-200">Scanned Page (No Embedded Text)</p>
                <p className="text-[11px] text-neutral-400">Run OCR to recognize paragraphs and read this page aloud.</p>
              </div>
              {onOcrCurrentPage && (
                <button
                  onClick={onOcrCurrentPage}
                  className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold font-mono text-[11px] transition-colors shrink-0"
                >
                  Run OCR
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Full Article OCR Text View (Clean document view when explicitly requested) */
        <div className="flex-1 overflow-y-auto p-6 bg-neutral-900/60 select-text">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="border-b border-neutral-800 pb-3 flex items-center justify-between">
              <div>
                <span className="text-xs font-mono text-amber-400">{currentPage.label} · ARTICLE TEXT</span>
                <h2 className="text-lg font-bold text-neutral-100">{currentPage.inferredTitle}</h2>
              </div>
              <button
                onClick={() => setViewMode('tk-preview')}
                className="px-3 py-1 rounded bg-amber-500 text-neutral-950 font-bold text-xs hover:bg-amber-400"
              >
                Return to JPG Preview
              </button>
            </div>

            <div className="space-y-3 font-serif text-sm leading-relaxed text-neutral-200">
              {parsedChunks.map(({ chunk, chunkIdx, sentences }) => {
                const chunkArticleLink = pages.length ? findArticleLinkForChunk(chunk.text, pages, currentPage.pageNumber) : null;
                return (
                  <div
                    key={`full-text-para-${chunkIdx}`}
                    className={`p-3 rounded-lg border transition-colors ${
                      chunkIdx === currentChunkIndex
                        ? 'bg-amber-950/20 border-amber-500/50'
                        : 'bg-neutral-950/40 border-neutral-800'
                    }`}
                  >
                    <div className="text-[10px] font-mono text-neutral-500 mb-1 flex items-center justify-between">
                      <span>¶ Paragraph {chunkIdx + 1}</span>
                      {chunkArticleLink && onSelectPage && (
                        <button
                          onClick={() => onSelectPage(chunkArticleLink.targetPageIndex)}
                          className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 font-sans font-bold text-[10px] flex items-center gap-1"
                        >
                          <span>Jump to Page {chunkArticleLink.pageNumber}: {chunkArticleLink.title}</span>
                          <ArrowRight className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  <p>
                    {sentences.map((sent, sIdx) => {
                      const isSentActive = chunkIdx === currentChunkIndex && sIdx === currentSentenceIndex;
                      return (
                        <span
                          key={`para-sent-${chunkIdx}-${sIdx}`}
                          onClick={() => onSelectSentence(chunkIdx, sIdx)}
                          className={`cursor-pointer rounded px-0.5 transition-colors ${
                            isSentActive
                              ? 'bg-amber-400 text-neutral-950 font-semibold'
                              : 'hover:bg-neutral-800 hover:text-white'
                          }`}
                        >
                          {sent}{' '}
                        </span>
                      );
                    })}
                  </p>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
