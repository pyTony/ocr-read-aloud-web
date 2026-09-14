import React, { useState, useRef, useMemo, useEffect } from 'react';
import { PageUnit } from '../types';
import { splitIntoSentences } from '../lib/layoutAndColumns';
import { isTocPage, getTocArticlesForPage, findArticleLinkForChunk } from '../lib/tocLinks';
import { cleanOcrGarbageAndNoise } from '../lib/textClean';
import { ensurePageJpegImage, generateCanvasJpegForPage } from '../lib/pageImageGenerator';
import { DisplayControlsModal, ViewMode } from './DisplayControlsModal';
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
  ArrowUp,
  ArrowDown,
  ChevronsLeft,
  ChevronsRight,
  SkipForward,
  Volume2,
  FileText,
  BookOpen,
  Eye,
  Sliders,
  SlidersHorizontal,
  ExternalLink,
  ArrowRight,
  PanelLeft,
  Highlighter,
  Sparkles,
  Maximize,
  Minimize,
  RotateCw,
  Compass,
  HelpCircle,
  Loader2,
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
  onPrevChunk?: () => void;
  onNextChunk?: () => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onToggleSkipAsAd?: (pageIndex: number) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  showHighlights?: boolean;
  onToggleHighlights?: () => void;
  onOcrCurrentPage?: () => void;
  onCopyText?: () => void;
  onRunRuleCleaner?: () => void;
  onRescanTesseract?: () => void;
  isProofreading?: boolean;
  isReadingMode?: boolean;
  onToggleReadingMode?: () => void;
  speechRate?: number;
  onChangeSpeechRate?: (rate: number) => void;
  skipNoiseHeaderFooter?: boolean;
  onToggleSkipNoiseHeaderFooter?: () => void;
  onOpenHelp?: () => void;
  onOpenUploadModal?: () => void;
  onLoadSample?: () => void;
  isDisplayControlsOpen?: boolean;
  onOpenDisplayControls?: () => void;
  onCloseDisplayControls?: () => void;
  isProcessing?: boolean;
  processingStatus?: string;
  onRequestRenderPage?: (pageIndex: number) => Promise<string | void>;
}

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
  onPrevChunk,
  onNextChunk,
  onPrevPage,
  onNextPage,
  onToggleSkipAsAd,
  isSidebarOpen,
  onToggleSidebar,
  showHighlights = true,
  onToggleHighlights,
  onOcrCurrentPage,
  onCopyText,
  onRunRuleCleaner,
  onRescanTesseract,
  isProofreading = false,
  isReadingMode = false,
  onToggleReadingMode,
  speechRate = 1.0,
  onChangeSpeechRate,
  skipNoiseHeaderFooter = true,
  onToggleSkipNoiseHeaderFooter,
  onOpenHelp,
  onOpenUploadModal,
  onLoadSample,
  isDisplayControlsOpen = false,
  onOpenDisplayControls,
  onCloseDisplayControls,
  isProcessing = false,
  processingStatus = '',
  onRequestRenderPage,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('tk-preview');
  const [fitMode, setFitMode] = useState<'page' | 'width'>('page');
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isFloatingControlsMinimized, setIsFloatingControlsMinimized] = useState(false);
  const [gestureToast, setGestureToast] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const activeChunkRef = useRef<HTMLDivElement>(null);

  // Touch handling refs
  const touchStartRef = useRef<{ x: number; y: number; time: number; touches: number; pinchDist: number }>({
    x: 0,
    y: 0,
    time: 0,
    touches: 1,
    pinchDist: 0,
  });
  const initialZoomOnPinchRef = useRef<number>(1.0);
  const lastTapTimeRef = useRef<number>(0);

  const triggerToast = (msg: string) => {
    setGestureToast(msg);
    setTimeout(() => {
      setGestureToast((prev) => (prev === msg ? null : prev));
    }, 1200);
  };

  // On-demand page image rendering if current page image is not yet rendered
  useEffect(() => {
    if (currentPage && !currentPage.image && onRequestRenderPage) {
      onRequestRenderPage(currentPageIndex);
    }
  }, [currentPageIndex, currentPage?.image, onRequestRenderPage]);

  // ResizeObserver and Orientation Change listener on the viewport container
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

    const handleOrientation = () => {
      setTimeout(measure, 150);
    };
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', handleOrientation);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', handleOrientation);
    };
  }, []);

  // Keyboard shortcut listener for toggling Display Controls Dialog handled at App level

  // TOC detection and article linking
  const isToc = currentPage ? isTocPage(currentPage) : false;
  const tocArticles = useMemo(() => {
    return isToc && currentPage ? getTocArticlesForPage(currentPage, pages) : [];
  }, [isToc, currentPage, pages]);

  const currentChunk = currentPage?.chunks[currentChunkIndex];
  const activeArticleLink = useMemo(() => {
    if (!isToc || !currentChunk || !pages.length || !currentPage || currentChunk.isNoiseHeaderFooter) return null;
    return findArticleLinkForChunk(currentChunk.text, pages, currentPage.pageNumber, currentChunk.isNoiseHeaderFooter);
  }, [isToc, currentChunk, pages, currentPage]);

  const pageWidth = currentPage?.width || 800;
  const pageHeight = currentPage?.height || 1100;
  const displayPageNum = currentPage?.pageNumber || currentPageIndex + 1;

  // Viewport dimensions ensuring 100% full-page fit with responsive padding
  const containerPadding = isReadingMode ? 8 : 16;
  const availW = Math.max(180, (viewportSize.width || 800) - containerPadding);
  const availH = Math.max(180, (viewportSize.height || 600) - containerPadding);

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
    setFitMode((prev) => {
      const next = prev === 'page' ? 'width' : 'page';
      triggerToast(next === 'width' ? 'Fit to Width' : 'Fit to Page');
      return next;
    });
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  // Keyboard shortcuts: 'w' toggles Fit Mode, 'n' toggles Skip Noise Header/Footers
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
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onToggleSkipNoiseHeaderFooter?.();
        triggerToast(skipNoiseHeaderFooter ? 'Filter Noise: OFF' : 'Filter Noise: ON');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleSkipNoiseHeaderFooter, skipNoiseHeaderFooter]);

  // KEEP HIGHLIGHTING VISIBLE BY SCROLLING:
  // Smoothly scrolls viewport to ensure active red chunk/sentence is in clear view
  useEffect(() => {
    if (!activeChunkRef.current || !viewportRef.current) return;
    const vp = viewportRef.current;
    const chunkEl = activeChunkRef.current;
    const vpRect = vp.getBoundingClientRect();
    const chunkRect = chunkEl.getBoundingClientRect();

    // In Fit-to-Width or zoomed mode or small screens
    const isAbove = chunkRect.top < vpRect.top + 70;
    const isBelow = chunkRect.bottom > vpRect.bottom - 70;
    const isLeft = chunkRect.left < vpRect.left + 30;
    const isRight = chunkRect.right > vpRect.right - 30;

    if (isAbove || isBelow || isLeft || isRight) {
      chunkEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [currentChunkIndex, currentSentenceIndex, fitMode, zoomLevel, isPlaying]);

  // Split all chunks into sentences for context (filtering noise and cleaning OCR garbage when Filter H/F is active)
  const parsedChunks = useMemo(() => {
    if (!currentPage) return [];
    return currentPage.chunks
      .map((chunk, cIdx) => {
        if (skipNoiseHeaderFooter && chunk.isNoiseHeaderFooter) {
          return null;
        }
        const textToUse = skipNoiseHeaderFooter
          ? cleanOcrGarbageAndNoise(chunk.text)
          : chunk.text;
        if (!textToUse.trim()) return null;
        const s = splitIntoSentences(textToUse);
        return {
          chunk,
          chunkIdx: cIdx,
          sentences: s.length > 0 ? s : [textToUse],
        };
      })
      .filter(Boolean) as { chunk: any; chunkIdx: number; sentences: string[] }[];
  }, [currentPage, skipNoiseHeaderFooter]);

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

  // Rolling 3-sentence context (Prev, Active, Next)
  const prevSentence = activeFlatIdx > 0 ? flatSentences[activeFlatIdx - 1]?.text : null;
  const nextSentence = activeFlatIdx >= 0 && activeFlatIdx < flatSentences.length - 1 ? flatSentences[activeFlatIdx + 1]?.text : null;

  // Zoom handlers
  const zoomIn = () => setZoomLevel((z) => Math.min(3.5, +(z + 0.15).toFixed(2)));
  const zoomOut = () => setZoomLevel((z) => Math.max(0.5, +(z - 0.15).toFixed(2)));
  const zoomReset = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
    triggerToast('Zoom 100%');
  };

  // Mouse wheel zoom
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (fitMode === 'page' || e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        e.stopPropagation();

        if (e.deltaY < 0) {
          setZoomLevel((z) => Math.min(3.5, +(z + 0.1).toFixed(2)));
        } else if (e.deltaY > 0) {
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

  // Touch Gesture & Swipe handling for Mobile:
  // - Swipe Left: Next Sentence (or Next Page with long flick)
  // - Swipe Right: Prev Sentence (or Prev Page with long flick)
  // - Swipe Up/Down: Prev/Next Paragraph (in Fit-Page mode)
  // - 2-Finger Pinch: Smooth Zoom Scaling
  // - Double-tap: Zoom Toggle or Play/Pause
  const handleTouchStart = (e: React.TouchEvent) => {
    const touches = e.touches;
    if (touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        // Double tap gesture
        if (zoomLevel > 1.0) {
          zoomReset();
        } else {
          setZoomLevel(1.5);
          triggerToast('Zoom 150%');
        }
      }
      lastTapTimeRef.current = now;

      touchStartRef.current = {
        x: touches[0].clientX,
        y: touches[0].clientY,
        time: now,
        touches: 1,
        pinchDist: 0,
      };
    } else if (touches.length === 2) {
      const dist = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
      initialZoomOnPinchRef.current = zoomLevel;
      touchStartRef.current = {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
        time: Date.now(),
        touches: 2,
        pinchDist: dist,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touches = e.touches;
    if (touches.length === 2 && touchStartRef.current.pinchDist > 0) {
      // Pinch to Zoom
      const dist = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
      const scaleFactor = dist / touchStartRef.current.pinchDist;
      const newZoom = Math.min(3.5, Math.max(0.6, +(initialZoomOnPinchRef.current * scaleFactor).toFixed(2)));
      setZoomLevel(newZoom);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartRef.current.touches === 1 && e.changedTouches.length === 1) {
      const endTouch = e.changedTouches[0];
      const deltaX = endTouch.clientX - touchStartRef.current.x;
      const deltaY = endTouch.clientY - touchStartRef.current.y;
      const deltaTime = Date.now() - touchStartRef.current.time;

      // Only evaluate swipe if flick was fast (< 450ms)
      if (deltaTime < 450) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // Horizontal Swipe
        if (absX > 45 && absX > absY * 1.5) {
          if (deltaX < -130 && onNextPage) {
            onNextPage();
            triggerToast('Next Page →');
          } else if (deltaX < -45 && onNextSentence) {
            onNextSentence();
            triggerToast('Next Sentence →');
          } else if (deltaX > 130 && onPrevPage) {
            onPrevPage();
            triggerToast('← Prev Page');
          } else if (deltaX > 45 && onPrevSentence) {
            onPrevSentence();
            triggerToast('← Prev Sentence');
          }
        }
        // Vertical Swipe (in fit-page mode when no scroll needed)
        else if (fitMode === 'page' && absY > 50 && absY > absX * 1.5) {
          if (deltaY < -50 && onNextChunk) {
            onNextChunk();
            triggerToast('Next Paragraph ↓');
          } else if (deltaY > 50 && onPrevChunk) {
            onPrevChunk();
            triggerToast('Prev Paragraph ↑');
          }
        }
      }
    }
  };

  if (!currentPage) {
    if (isProcessing) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-neutral-300 bg-neutral-950 font-sans select-none">
          <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 text-center space-y-4 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto animate-pulse">
              <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-1">Opening Document...</h3>
              <p className="text-xs text-neutral-400 font-mono">
                {processingStatus || 'Rendering page 1 preview...'}
              </p>
            </div>
            <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-amber-500 h-full w-2/3 animate-pulse rounded-full" />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-neutral-300 bg-neutral-950 font-sans select-none overflow-y-auto">
        <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">OCR Read Aloud</h2>
            <p className="text-xs text-neutral-400 max-w-sm mx-auto">
              Open a document to get started with speech synthesis, synchronized bounding-box word tracking, and smart reading layouts.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            {onOpenUploadModal && (
              <button
                onClick={onOpenUploadModal}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-sm rounded-lg shadow-lg hover:shadow-amber-500/10 transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Upload PDF, Image, or Text</span>
              </button>
            )}

            {onLoadSample && (
              <button
                onClick={onLoadSample}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-neutral-950/60 hover:bg-neutral-800 text-amber-300 border border-neutral-800 hover:border-amber-500/50 text-sm font-semibold rounded-lg transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>Load 1976 BYTE Magazine Demo</span>
              </button>
            )}
          </div>

          <div className="border-t border-neutral-800/60 pt-4 text-center">
            <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950/40 px-2 py-1 rounded border border-neutral-800/40">
              Offline Rule Cleaner &amp; Speech Synthesizer Ready
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-neutral-950 overflow-hidden select-none relative h-full">
      {/* Gesture Feedback Toast */}
      {gestureToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-neutral-900/90 text-amber-300 border border-amber-500/50 px-3.5 py-1.5 rounded-full font-mono text-xs shadow-2xl z-50 animate-fade-in pointer-events-none backdrop-blur-md">
          {gestureToast}
        </div>
      )}

      {/* 
        ========================================================================
        TOP BAR (Hidden in Zen Reading Mode for maximum free screen real estate)
        ========================================================================
      */}
      {!isReadingMode && (
        <div className="bg-neutral-900 border-b border-neutral-800 shrink-0 z-20 shadow-md">
          {/* Row 2: Rolling Read-Along Teleprompter Strip (Auto-activates when starting to read or in teleprompter mode) */}
          {(isPlaying || isPaused || viewMode === 'split-context') && currentSentenceText && (
            <div className="bg-neutral-950 px-4 py-2 border-t border-neutral-800 text-xs font-serif space-y-1 select-text animate-in slide-in-from-top-1 duration-200">
              {prevSentence && (
                <div className="text-neutral-500 truncate text-[11px] flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-600 shrink-0">Prev</span>
                  <span className="truncate">{prevSentence}</span>
                </div>
              )}
              <div className="text-amber-300 font-semibold text-sm flex items-start gap-2 bg-amber-950/40 p-1.5 rounded-lg border border-amber-500/40 shadow-inner">
                <Volume2 className={`w-4 h-4 text-amber-400 shrink-0 mt-0.5 ${isPlaying ? 'animate-pulse' : ''}`} />
                <div className="flex-1 flex items-center justify-between gap-2">
                  <span className="leading-snug">{currentSentenceText}</span>
                  {skipNoiseHeaderFooter && (
                    <span className="font-mono text-[9px] font-bold text-amber-400 bg-amber-950/70 border border-amber-800/60 px-1.5 py-0.5 rounded shrink-0" title="Filter Noise is active: garbage tokens, table lines, and metadata are excluded">
                      Noise Filtered
                    </span>
                  )}
                </div>
              </div>
              {nextSentence && (
                <div className="text-neutral-400 truncate text-[11px] flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-600 shrink-0">Next</span>
                  <span className="truncate">{nextSentence}</span>
                </div>
              )}
            </div>
          )}

          {/* Row 4: TOC Article Links Ribbon */}
          {isToc && tocArticles.length > 0 && (
            <div className="bg-neutral-900/95 border-t border-amber-500/30 px-2 sm:px-3 py-1 flex items-center gap-2 overflow-x-auto text-xs scrollbar-none">
              <span className="flex items-center gap-1 font-mono font-bold text-[10px] sm:text-[11px] text-amber-400 shrink-0">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Articles:</span>
              </span>
              <div className="flex items-center gap-1.5 flex-nowrap">
                {tocArticles.map((art, idx) => (
                  <button
                    key={`toc-strip-${idx}`}
                    onClick={() => onSelectPage?.(art.targetPageIndex)}
                    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-amber-500 hover:text-neutral-950 text-neutral-200 text-[10px] sm:text-[11px] font-medium border border-neutral-700 transition-colors whitespace-nowrap flex items-center gap-1"
                    title={`Jump to Page ${art.pageNumber}: ${art.title}`}
                  >
                    <span className="font-mono text-amber-400 font-bold">p.{art.pageNumber}</span>
                    <span className="max-w-[130px] truncate">{art.title}</span>
                    <ArrowRight className="w-2.5 h-2.5 opacity-70" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 
        ========================================================================
        MAIN VIEWPORT: SCANNED PAGE PREVIEW WITH PINCH-ZOOM & SWIPE GESTURES
        ========================================================================
      */}
      <div
        ref={viewportRef}
        className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-2 sm:p-3 bg-neutral-950 relative select-none touch-manipulation"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
          {/* Page JPEG Image Canvas - Always Main Viewport */}
          {!currentPage.image && !currentPage.rawText && currentPage.chunks.length === 0 ? (
            <div
              style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
              className="flex flex-col items-center justify-center bg-white rounded text-neutral-400 p-6 text-center select-none"
            >
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 mb-3 animate-pulse">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <p className="text-xs font-bold text-neutral-700">Rendering page scan...</p>
              <p className="text-[10px] text-neutral-400 font-mono mt-1">
                {currentPage.label || `Page ${currentPage.pageNumber}`}
              </p>
            </div>
          ) : (
            <div className="relative" style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}>
              <img
                src={currentPage.image || ensurePageJpegImage(currentPage, totalPages)}
                alt={currentPage.label}
                style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
                className="block rounded select-none pointer-events-none object-fill"
                onError={(e) => {
                  const fallback = generateCanvasJpegForPage(
                    currentPage.label,
                    currentPage.pageNumber,
                    totalPages,
                    currentPage.rawText || ''
                  );
                  if (fallback) {
                    (e.currentTarget as HTMLImageElement).src = fallback;
                  }
                }}
              />
              {!currentPage.image && (
                <div className="absolute top-2 right-2 bg-neutral-900/90 text-amber-400 border border-amber-500/40 px-2.5 py-1 rounded-md text-[11px] font-mono flex items-center gap-1.5 shadow-lg z-30 pointer-events-none animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span>Loading hi-res scan...</span>
                </div>
              )}
            </div>
          )}

            {/* AI Proofreading animation */}
            {isProofreading && (
              <div className="absolute inset-0 bg-neutral-950/50 backdrop-blur-[1px] z-40 rounded flex flex-col items-center justify-center overflow-hidden">
                <div className="absolute inset-x-0 h-20 bg-gradient-to-b from-amber-500/0 via-amber-400/90 to-amber-500/0 animate-bounce shadow-[0_0_40px_rgba(251,191,36,0.9)] pointer-events-none" style={{ animationDuration: '1.2s' }} />
                <div className="bg-neutral-900/95 border border-amber-500 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-amber-300 z-50">
                  <Sparkles className="w-5 h-5 animate-spin text-amber-400 shrink-0" />
                  <div className="text-left font-mono">
                    <p className="font-bold text-xs sm:text-sm">AI Proofreading & Repair...</p>
                    <p className="text-[10px] sm:text-[11px] text-neutral-400">Scanning page and repairing split words</p>
                  </div>
                </div>
              </div>
            )}

            {/* 
              INTERACTIVE BOUNDING BOXES:
              Expressed in exact percentage of pageWidth / pageHeight
            */}
            {showHighlights && currentPage.chunks.map((chunk, idx) => {
              const isActive = idx === currentChunkIndex;

              const coversPage =
                (chunk.width / pageWidth >= 0.85 && chunk.height / pageHeight >= 0.85) ||
                chunk.width <= 0 ||
                chunk.height <= 0;

              const leftPercent = (chunk.left / pageWidth) * 100;
              const topPercent = (chunk.top / pageHeight) * 100;
              const widthPercent = (chunk.width / pageWidth) * 100;
              const heightPercent = (chunk.height / pageHeight) * 100;
              const isNoise = chunk.isNoiseHeaderFooter;
              const chunkArticleLink = isToc && pages.length && !isNoise ? findArticleLinkForChunk(chunk.text, pages, currentPage.pageNumber, isNoise) : null;
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
                        : isNoise && skipNoiseHeaderFooter
                          ? 'border border-dashed border-neutral-600/40 bg-neutral-900/10 hover:border-neutral-500 z-5 opacity-60 hover:opacity-100'
                          : 'hover:bg-amber-400/15 hover:border hover:border-amber-400/40 z-10'
                  }`}
                  style={{
                    left: `${leftPercent}%`,
                    top: `${topPercent}%`,
                    width: `${widthPercent}%`,
                    height: `${heightPercent}%`,
                  }}
                  title={
                    isNoise
                      ? `[Header/Footer Noise · ${chunk.noiseReason || 'Repeating metadata'}] ${skipNoiseHeaderFooter ? '(Skipped in playback)' : ''}\n"${chunk.text.slice(0, 70)}..."`
                      : `Paragraph ${idx + 1}: Click to play aloud\n"${chunk.text.slice(0, 70)}..."`
                  }
                >
                  {/* Paragraph Number Badge */}
                  <div
                    className={`absolute -top-2.5 -left-1 px-1 py-0.2 rounded font-mono text-[9px] font-bold shadow ${
                      shouldShowActiveRed
                        ? 'bg-red-600 text-white'
                        : isActive && !coversPage
                          ? 'bg-amber-600 text-white'
                          : isNoise
                            ? 'bg-neutral-850 text-neutral-400 border border-neutral-700'
                            : 'bg-neutral-800 text-neutral-300 opacity-60 hover:opacity-100'
                    }`}
                  >
                    {idx + 1}
                  </div>

                  {/* Noise Header/Footer Indicator Badge */}
                  {isNoise && (
                    <div
                      className={`absolute -top-2.5 right-0 px-1 py-0.2 rounded font-mono text-[8px] font-semibold tracking-tight shadow flex items-center gap-0.5 ${
                        skipNoiseHeaderFooter
                          ? 'bg-neutral-900 text-neutral-400 border border-neutral-700 opacity-80'
                          : 'bg-indigo-950 text-indigo-200 border border-indigo-700'
                      }`}
                      title={`Garbage/Noise Item: ${chunk.noiseReason || 'Garbage or metadata'}`}
                    >
                      <span>
                        {chunk.noiseType === 'page-number'
                          ? 'Page #'
                          : chunk.noiseType === 'date-stamp'
                          ? 'Date'
                          : chunk.noiseType === 'filename'
                          ? 'File'
                          : 'Noise'}
                      </span>
                      {skipNoiseHeaderFooter && <span className="text-[7px] text-amber-400 font-bold">SKIP</span>}
                    </div>
                  )}

                  {/* TOC article jump link */}
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

          {/* Floating OCR prompt if zero chunks */}
          {currentPage.chunks.length === 0 && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-neutral-900/95 border border-amber-500/50 rounded-lg px-4 py-2.5 shadow-2xl flex items-center gap-3 z-30 text-xs">
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

      {/* 
        ========================================================================
        FLOATING TRANSPARENT CONTROLS FOR ZEN READING MODE & MOBILE VIEWPORT
        Frees 100% of the screen estate with sleek translucent glassmorphism
        ========================================================================
      */}
      {isReadingMode && (
        <div className="fixed bottom-3 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all max-w-[96vw]">
          {isFloatingControlsMinimized ? (
            /* Minimized Floating Orb Button */
            <button
              onClick={() => setIsFloatingControlsMinimized(false)}
              className="flex items-center gap-2 px-3 py-2 rounded-full bg-neutral-900/85 hover:bg-neutral-800/90 text-amber-400 border border-neutral-700/80 shadow-2xl backdrop-blur-xl text-xs font-mono transition-transform hover:scale-105"
              title="Expand Floating Reading Controls"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span>p.{displayPageNum}</span>
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current ml-1" /> : <Play className="w-3.5 h-3.5 fill-current ml-1" />}
            </button>
          ) : (
            /* Expanded Glassmorphic Floating Pill Bar */
            <div className="bg-neutral-950/80 hover:bg-neutral-950/95 border border-white/15 backdrop-blur-xl shadow-2xl rounded-2xl p-1.5 sm:p-2 text-white flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none transition-all">
              {/* Play / Pause */}
              <button
                onClick={onTogglePlay}
                className={`p-2 rounded-xl text-xs font-bold transition-transform shadow-md shrink-0 active:scale-95 ${
                  isPlaying
                    ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950 ring-2 ring-amber-400/40'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>

              {/* Prev / Next Sentence */}
              <div className="flex items-center bg-neutral-900/80 rounded-xl p-0.5 border border-neutral-800 shrink-0">
                <button
                  onClick={onPrevSentence}
                  className="p-1.5 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                  title="Previous sentence (Swipe Right or Left Arrow)"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={onNextSentence}
                  className="p-1.5 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                  title="Next sentence (Swipe Left or Right Arrow)"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Prev / Next Paragraph */}
              <div className="flex items-center bg-neutral-900/80 rounded-xl p-0.5 border border-neutral-800 shrink-0">
                <button
                  onClick={onPrevChunk}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                  title="Previous paragraph (Up Arrow)"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onNextChunk}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                  title="Next paragraph (Down Arrow)"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Page Stepper */}
              <div className="flex items-center bg-neutral-900/80 rounded-xl px-1.5 py-0.5 border border-neutral-800 text-[11px] font-mono shrink-0">
                <button
                  onClick={onPrevPage}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Previous Page (PageUp)"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-1 text-amber-300 font-bold">p.{displayPageNum}/{totalPages}</span>
                <button
                  onClick={onNextPage}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Next Page (PageDown)"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Fit Mode Toggle */}
              <button
                onClick={toggleFitMode}
                className={`p-1.5 rounded-xl border text-xs font-mono transition-colors shrink-0 ${
                  fitMode === 'width'
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-neutral-900/80 border-neutral-800 text-neutral-300 hover:text-white'
                }`}
                title={fitMode === 'page' ? 'Switch to Fit Width' : 'Switch to Fit Page'}
              >
                {fitMode === 'page' ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              </button>

              {/* Zoom Buttons in Floating Controls */}
              <div className="flex items-center bg-neutral-900/80 rounded-xl p-0.5 border border-neutral-800 shrink-0 font-mono text-[10px]">
                <button
                  onClick={zoomOut}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={zoomReset}
                  className="px-1 text-neutral-300 hover:text-white"
                  title="Reset Zoom"
                >
                  {Math.round(zoomLevel * 100)}%
                </button>
                <button
                  onClick={zoomIn}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Highlights Toggle */}
              {onToggleHighlights && (
                <button
                  onClick={onToggleHighlights}
                  className={`p-1.5 rounded-xl border text-xs transition-colors shrink-0 ${
                    showHighlights
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                      : 'bg-neutral-900/80 border-neutral-800 text-neutral-400'
                  }`}
                  title="Toggle highlight boxes (Key: H)"
                >
                  <Highlighter className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Noise Header/Footer Skip Toggle in Zen Mode */}
              {onToggleSkipNoiseHeaderFooter && (
                <button
                  onClick={onToggleSkipNoiseHeaderFooter}
                  className={`px-2 py-1 rounded-xl border text-[10px] font-mono transition-colors shrink-0 flex items-center gap-1 ${
                    skipNoiseHeaderFooter
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                      : 'bg-neutral-900/80 border-neutral-800 text-neutral-400'
                  }`}
                  title="Toggle Filter Garbage & Noise (Key: N)"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{skipNoiseHeaderFooter ? 'NOISE:SKIP' : 'NOISE:ALL'}</span>
                </button>
              )}

              {/* Speed multiplier quick cycle */}
              {onChangeSpeechRate && (
                <button
                  onClick={() => {
                    const rates = [1.0, 1.25, 1.5, 1.75, 2.0, 0.8];
                    const currentIdx = rates.indexOf(speechRate);
                    const nextRate = currentIdx !== -1 ? rates[(currentIdx + 1) % rates.length] : 1.0;
                    onChangeSpeechRate(nextRate);
                    triggerToast(`Speed: ${nextRate}x`);
                  }}
                  className="px-2 py-1 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 text-amber-400 border border-neutral-800 text-[10px] font-mono shrink-0"
                  title="Cycle Speech Rate"
                >
                  {speechRate.toFixed(2)}x
                </button>
              )}

              {/* 2D Display & Reading Controls Modal Trigger in Zen Mode */}
              <button
                onClick={onOpenDisplayControls}
                className="p-1.5 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 text-amber-400 border border-neutral-850 transition-colors shrink-0"
                title="Display & View Controls Dialog [Key: D]"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>

              {/* Minimize Floating Bar to Orb */}
              <button
                onClick={() => setIsFloatingControlsMinimized(true)}
                className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800/80 transition-colors shrink-0"
                title="Minimize floating controls to bubble"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>

              {/* Exit Zen Reading Mode */}
              {onToggleReadingMode && (
                <button
                  onClick={onToggleReadingMode}
                  className="p-1.5 rounded-xl bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700 transition-colors shrink-0"
                  title="Exit Zen Reading Mode (Key: F)"
                >
                  <Minimize className="w-3.5 h-3.5 text-amber-400" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2D Space Display & Reading Controls Dialog Modal */}
      <DisplayControlsModal
        isOpen={isDisplayControlsOpen}
        onClose={onCloseDisplayControls || (() => {})}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        fitMode={fitMode}
        onChangeFitMode={(mode) => {
          setFitMode(mode);
          setZoomLevel(1.0);
          setPanOffset({ x: 0, y: 0 });
        }}
        zoomLevel={zoomLevel}
        onChangeZoomLevel={(zoom) => {
          setZoomLevel(zoom);
          if (zoom === 1.0) setPanOffset({ x: 0, y: 0 });
        }}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        showHighlights={showHighlights}
        onToggleHighlights={onToggleHighlights}
        skipNoiseHeaderFooter={skipNoiseHeaderFooter}
        onToggleSkipNoiseHeaderFooter={onToggleSkipNoiseHeaderFooter}
        isReadingMode={isReadingMode}
        onToggleReadingMode={onToggleReadingMode}
        speechRate={speechRate}
        onChangeSpeechRate={onChangeSpeechRate}
      />
    </div>
  );
};
