import React from 'react';
import { Volume2, VolumeX, Pause, Play, AlertTriangle, ChevronLeft, ChevronRight, SkipForward } from 'lucide-react';

interface LiveCaptionBarProps {
  currentSentence: string;
  isPlaying: boolean;
  isPaused: boolean;
  pageIndex: number;
  currentPageNumber?: number;
  totalPages: number;
  chunkIndex: number;
  totalChunks: number;
  sentenceIndex: number;
  totalSentences: number;
  isAdPage: boolean;
  onTogglePlay: () => void;
  onPrevSentence?: () => void;
  onNextSentence?: () => void;
  onSkipAd?: () => void;
}

export const LiveCaptionBar: React.FC<LiveCaptionBarProps> = ({
  currentSentence,
  isPlaying,
  isPaused,
  pageIndex,
  currentPageNumber,
  totalPages,
  chunkIndex,
  totalChunks,
  sentenceIndex,
  totalSentences,
  isAdPage,
  onTogglePlay,
  onPrevSentence,
  onNextSentence,
  onSkipAd,
}) => {
  const displayPageNum = currentPageNumber || pageIndex + 1;

  return (
    <div className="bg-neutral-900 border-b border-neutral-800 px-4 py-3 shadow-md select-none">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        {/* Caption & Play Section */}
        <div className="flex-1 min-w-0 flex items-start gap-3 w-full">
          {/* Main Play / Pause Button */}
          <button
            onClick={onTogglePlay}
            className={`p-2.5 rounded-lg transition-all shrink-0 mt-0.5 shadow-sm ${
              isPlaying
                ? 'bg-amber-500 text-neutral-950 hover:bg-amber-400 ring-2 ring-amber-400/40'
                : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
            }`}
            title={isPlaying ? 'Pause playback (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          {/* Stepper Buttons for Sentences */}
          <div className="hidden sm:flex items-center gap-1 shrink-0 mt-1">
            <button
              onClick={onPrevSentence}
              className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
              title="Previous sentence (Left Arrow / h)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onNextSentence}
              className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
              title="Next sentence (Right Arrow / l)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-w-0">
            {/* Telemetry Tracking Line (Exact Python App Format: Page 14 · para 1/1 · sent 2/24 · page 1/11) */}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
                {isPlaying ? (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                ) : (
                  <span className="inline-block h-2 w-2 rounded-full bg-neutral-600"></span>
                )}
                {isPlaying ? 'Reading...' : isPaused ? 'Paused' : 'Ready'}
              </span>

              {totalPages > 0 && (
                <span className="text-xs text-neutral-200 font-mono px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800">
                  Page {displayPageNum} · para {chunkIndex + 1}/{Math.max(1, totalChunks)} · sent {sentenceIndex + 1}/{Math.max(1, totalSentences)} · page {pageIndex + 1}/{totalPages}
                </span>
              )}

              {isAdPage && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Commercial / Ad Insert (Auto-skips on continuous play)</span>
                  {onSkipAd && (
                    <button
                      onClick={onSkipAd}
                      className="ml-1 text-[10px] underline hover:text-white flex items-center gap-0.5"
                    >
                      <span>Skip Now</span>
                      <SkipForward className="w-3 h-3" />
                    </button>
                  )}
                </span>
              )}
            </div>

            {/* Complete Full Text Sentence - NO line-clamp truncation! */}
            <div className="text-base md:text-lg font-serif font-medium text-neutral-100 leading-relaxed select-text bg-neutral-950/40 p-2 rounded-lg border border-neutral-800/60 max-h-36 overflow-y-auto">
              {currentSentence ? (
                <span className="text-amber-300 font-semibold bg-amber-950/30 px-1 py-0.5 rounded border-b-2 border-amber-500/50">
                  "{currentSentence}"
                </span>
              ) : (
                <span className="text-neutral-500 italic font-sans text-sm">
                  Press Play or click any sentence below to start reading aloud...
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status indicator */}
        <div className="hidden xl:flex items-center gap-2 text-xs text-neutral-400 bg-neutral-950/80 px-3 py-2 rounded-lg border border-neutral-800 shrink-0 font-mono">
          {isPlaying ? (
            <Volume2 className="w-4 h-4 text-amber-400 animate-pulse" />
          ) : (
            <VolumeX className="w-4 h-4 text-neutral-500" />
          )}
          <span>Sentence Lockstep</span>
        </div>
      </div>
    </div>
  );
};
