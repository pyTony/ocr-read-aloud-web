import React from 'react';
import {
  X,
  SlidersHorizontal,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Highlighter,
  FileText,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Gauge,
  Sparkles,
  Check,
  Eye,
  Columns,
  Layers,
} from 'lucide-react';

export type ViewMode = 'tk-preview' | 'split-context' | 'full-text';

interface DisplayControlsModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  fitMode: 'page' | 'width';
  onChangeFitMode: (mode: 'page' | 'width') => void;
  zoomLevel: number;
  onChangeZoomLevel: (zoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  showHighlights: boolean;
  onToggleHighlights?: () => void;
  skipNoiseHeaderFooter: boolean;
  onToggleSkipNoiseHeaderFooter?: () => void;
  isReadingMode: boolean;
  onToggleReadingMode?: () => void;
  speechRate: number;
  onChangeSpeechRate?: (rate: number) => void;
}

export const DisplayControlsModal: React.FC<DisplayControlsModalProps> = ({
  isOpen,
  onClose,
  viewMode,
  onChangeViewMode,
  fitMode,
  onChangeFitMode,
  zoomLevel,
  onChangeZoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  showHighlights,
  onToggleHighlights,
  skipNoiseHeaderFooter,
  onToggleSkipNoiseHeaderFooter,
  isReadingMode,
  onToggleReadingMode,
  speechRate,
  onChangeSpeechRate,
}) => {
  if (!isOpen) return null;

  const zoomPresets = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  const speedPresets = [0.8, 1.0, 1.25, 1.5, 1.75, 2.0];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-xl w-full p-4 sm:p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-neutral-100 flex items-center gap-2">
                Display & Reading Controls
              </h3>
              <p className="text-[11px] text-neutral-400">
                2D layout controls for view modes, page scaling, zoom & reading options
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title="Close dialog (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2D Grid Content Area */}
        <div className="mt-4 flex-1 overflow-y-auto pr-1 space-y-4">
          {/* Section 1: View Layout Mode (2D Card Grid) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                1. Reading View Mode
              </span>
              <span className="text-[10px] text-neutral-500 font-mono">Select canvas layout</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Page View */}
              <button
                onClick={() => onChangeViewMode('tk-preview')}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  viewMode === 'tk-preview'
                    ? 'bg-amber-500/15 border-amber-500/80 text-white shadow-sm ring-1 ring-amber-500/40'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-amber-400">
                    Page
                  </span>
                  {viewMode === 'tk-preview' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                </div>
                <div>
                  <div className="text-xs font-semibold text-neutral-100 mb-0.5">Page Layout View</div>
                  <div className="text-[10.5px] text-neutral-400 leading-snug">
                    Top position strip + synchronized document page
                  </div>
                </div>
              </button>

              {/* 3-Sent Teleprompter */}
              <button
                onClick={() => onChangeViewMode('split-context')}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  viewMode === 'split-context'
                    ? 'bg-amber-500/15 border-amber-500/80 text-white shadow-sm ring-1 ring-amber-500/40'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-amber-400">
                    3-Sent
                  </span>
                  {viewMode === 'split-context' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                </div>
                <div>
                  <div className="text-xs font-semibold text-neutral-100 mb-0.5">3-Sent Teleprompter</div>
                  <div className="text-[10.5px] text-neutral-400 leading-snug">
                    3-tier rolling view (Previous, Active, Upcoming sentence)
                  </div>
                </div>
              </button>

              {/* Full Text View */}
              <button
                onClick={() => onChangeViewMode('full-text')}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  viewMode === 'full-text'
                    ? 'bg-amber-500/15 border-amber-500/80 text-white shadow-sm ring-1 ring-amber-500/40'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-amber-400">
                    Text
                  </span>
                  {viewMode === 'full-text' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                </div>
                <div>
                  <div className="text-xs font-semibold text-neutral-100 mb-0.5">Full Text Mode</div>
                  <div className="text-[10.5px] text-neutral-400 leading-snug">
                    Clean plain text OCR transcript without layout boxes
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Section 2: Page Fit & Scaling (2D Cards) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                <Maximize2 className="w-3.5 h-3.5 text-amber-400" />
                2. Page Fit & Scaling
              </span>
              <kbd className="px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-[10px] font-mono text-neutral-400">
                Shortcut: W
              </kbd>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {/* Fit to Page */}
              <button
                onClick={() => onChangeFitMode('page')}
                className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                  fitMode === 'page'
                    ? 'bg-amber-500/15 border-amber-500/80 text-white ring-1 ring-amber-500/40'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-amber-400">
                    <Minimize2 className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-semibold text-neutral-100">Fit to Page</div>
                    <div className="text-[10.5px] text-neutral-400">Entire page fits on screen without scroll</div>
                  </div>
                </div>
                {fitMode === 'page' && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
              </button>

              {/* Fit to Width */}
              <button
                onClick={() => onChangeFitMode('width')}
                className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                  fitMode === 'width'
                    ? 'bg-amber-500/15 border-amber-500/80 text-white ring-1 ring-amber-500/40'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-amber-400">
                    <Maximize2 className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-semibold text-neutral-100">Fit to Width</div>
                    <div className="text-[10.5px] text-neutral-400">100% width with vertical scrolling</div>
                  </div>
                </div>
                {fitMode === 'width' && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
              </button>
            </div>
          </div>

          {/* Section 3: Zoom Magnification (Slider + 2D Presets) */}
          <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                <ZoomIn className="w-3.5 h-3.5 text-amber-400" />
                3. Zoom Magnification
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-amber-400">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={onZoomReset}
                  className="px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-[10px] font-mono text-neutral-300 transition-colors flex items-center gap-1"
                  title="Reset zoom to 100% (Key: 0)"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>100%</span>
                </button>
              </div>
            </div>

            {/* Zoom Slider */}
            <div className="flex items-center gap-3">
              <button
                onClick={onZoomOut}
                className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 transition-colors"
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.05"
                value={zoomLevel}
                onChange={(e) => onChangeZoomLevel(parseFloat(e.target.value))}
                className="flex-1 accent-amber-500"
              />
              <button
                onClick={onZoomIn}
                className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 transition-colors"
                title="Zoom In (+)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Zoom Preset Pills */}
            <div className="grid grid-cols-6 gap-1.5 mt-2.5">
              {zoomPresets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => onChangeZoomLevel(preset)}
                  className={`py-1 rounded-md text-[11px] font-mono font-semibold transition-colors ${
                    Math.abs(zoomLevel - preset) < 0.02
                      ? 'bg-amber-500 text-neutral-950 shadow-sm font-bold'
                      : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                  }`}
                >
                  {Math.round(preset * 100)}%
                </button>
              ))}
            </div>
          </div>

          {/* Section 4: Reading & Overlay Toggles (2D Grid) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                4. Reading Enhancements & Overlays
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Highlight Boxes Toggle */}
              {onToggleHighlights && (
                <button
                  onClick={onToggleHighlights}
                  className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                    showHighlights
                      ? 'bg-amber-500/15 border-amber-500/70 text-white'
                      : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-amber-400">
                      <Highlighter className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-semibold text-neutral-100 flex items-center gap-1.5">
                        <span>Paragraph Highlights</span>
                        <kbd className="px-1 py-0.2 rounded bg-neutral-900 border border-neutral-700 text-[9px] font-mono text-amber-400">H</kbd>
                      </div>
                      <div className="text-[10.5px] text-neutral-400">Visual red OCR bounding boxes</div>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    showHighlights ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-900 text-neutral-500'
                  }`}>
                    {showHighlights ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}

              {/* Filter Noise Header/Footer Toggle */}
              {onToggleSkipNoiseHeaderFooter && (
                <button
                  onClick={onToggleSkipNoiseHeaderFooter}
                  className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                    skipNoiseHeaderFooter
                      ? 'bg-amber-500/15 border-amber-500/70 text-white'
                      : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-amber-400">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-semibold text-neutral-100 flex items-center gap-1.5">
                        <span>Filter Garbage &amp; Noise</span>
                        <kbd className="px-1 py-0.2 rounded bg-neutral-900 border border-neutral-700 text-[9px] font-mono text-amber-400">N</kbd>
                      </div>
                      <div className="text-[10.5px] text-neutral-400">Filter out garbage words, OCR noise, table lines, dates &amp; folios in read along</div>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    skipNoiseHeaderFooter ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-900 text-neutral-500'
                  }`}>
                    {skipNoiseHeaderFooter ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}

              {/* Zen Fullscreen Reading Mode Toggle */}
              {onToggleReadingMode && (
                <button
                  onClick={onToggleReadingMode}
                  className={`p-3 rounded-xl border flex items-center justify-between transition-all sm:col-span-2 ${
                    isReadingMode
                      ? 'bg-amber-500/15 border-amber-500/70 text-white'
                      : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-amber-400">
                      <Maximize className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-semibold text-neutral-100 flex items-center gap-1.5">
                        <span>Zen Fullscreen Reading Mode</span>
                        <kbd className="px-1 py-0.2 rounded bg-neutral-900 border border-neutral-700 text-[9px] font-mono text-amber-400">F</kbd>
                      </div>
                      <div className="text-[10.5px] text-neutral-400">Free full screen with floating translucent audio controls</div>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    isReadingMode ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-900 text-neutral-500'
                  }`}>
                    {isReadingMode ? 'ACTIVE' : 'OFF'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Section 5: Speech Tempo & 1x Switch (2D Grid) */}
          {onChangeSpeechRate && (
            <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-amber-400" />
                  5. Speech Tempo & Rate
                </span>
                <button
                  onClick={() => onChangeSpeechRate(1.0)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-colors ${
                    speechRate === 1.0
                      ? 'bg-amber-500 text-neutral-950 font-bold'
                      : 'bg-neutral-900 border border-neutral-700 text-amber-400 hover:text-white'
                  }`}
                  title="Reset to 1.0x Normal Speed (Key: 1)"
                >
                  Reset 1.0x Norm (Key 1)
                </button>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {speedPresets.map((rate) => (
                  <button
                    key={rate}
                    onClick={() => onChangeSpeechRate(rate)}
                    className={`py-1.5 rounded-md text-xs font-mono font-semibold transition-colors ${
                      speechRate === rate
                        ? 'bg-amber-500 text-neutral-950 shadow-sm font-bold'
                        : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    {rate.toFixed(2)}x
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-neutral-500 font-mono">
            Press Esc to close · Changes take effect instantly
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold transition-colors shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
