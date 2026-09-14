import React, { useState } from 'react';
import { Keyboard, X, Info, Gauge } from 'lucide-react';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutHelpModal: React.FC<ShortcutHelpModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'shortcuts' | 'symbols'>('shortcuts');

  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Space', desc: 'Pause or resume speech playback' },
    { key: 'Esc', desc: 'Stop speech immediately' },
    { key: '← / →', desc: 'Rewind / advance one sentence' },
    { key: '↑ / ↓ (or Tab)', desc: 'Jump to previous / next paragraph' },
    { key: 'PageUp / PageDown', desc: 'Previous / next document page' },
    { key: '1', desc: 'Reset speech speed to 1.0x (Normal tempo)' },
    { key: '+ / =', desc: 'Speed up speech (+0.1x)' },
    { key: '- / _', desc: 'Slow down speech (-0.1x)' },
    { key: '[ or Ctrl+B', desc: 'Toggle Pages sidebar (expand / collapse)' },
    { key: 'f', desc: 'Toggle Zen Reading Mode (floating translucent controls)' },
    { key: 'd', desc: 'Toggle 2D Display & Controls Dialog (view mode, zoom, fit, speed)' },
    { key: 'w', desc: 'Toggle Fit to Width (100%) vs Fit to Page' },
    { key: 'h', desc: 'Toggle visual paragraph highlight boxes (on / off)' },
    { key: 'n', desc: 'Toggle Filter Garbage & Noise (garbage tokens, table lines, metadata)' },
    { key: '0', desc: 'Reset zoom magnification to 100%' },
    { key: 'Scroll Wheel', desc: 'Zoom preview in / out (or Ctrl+Wheel)' },
    { key: 'c or Ctrl+J', desc: 'Jump to "Continued on" page (press again to return)' },
    { key: 'a', desc: 'Jump to skipped ad insert (press again to return)' },
    { key: 'Ctrl + S', desc: 'Export full document OCR text (.ocr.txt)' },
    { key: 'Ctrl + Shift + S', desc: 'Export current article or ad' },
    { key: '?', desc: 'Show this keyboard shortcuts and symbols dialog' },
  ];

  const symbols = [
    {
      symbol: '¶',
      name: 'Paragraph Symbol (Pilcrow)',
      desc: 'Indicates the active OCR paragraph block out of total paragraphs on the page (e.g. ¶ 2/18). Use Up/Down or Tab to jump.',
    },
    {
      symbol: 'sent',
      name: 'Sentence Index',
      desc: 'Indicates the currently spoken sentence number out of total sentences in the active paragraph (e.g. sent 1/4). Use Left/Right Arrow to rewind/advance.',
    },
    {
      symbol: 'p.',
      name: 'Page Folio / Sequence',
      desc: 'Physical page number in the loaded document out of total pages (e.g. p. 4/12). Use PageUp/PageDown to turn pages.',
    },
    {
      symbol: '1x / 1.00x',
      name: 'Speech Speed & 1x Switch',
      desc: 'Current speech rate multiplier. Click the speed badge to cycle tempo (0.8x - 2.0x), or click "1x" / press Key 1 to instantly reset to normal speed.',
    },
    {
      symbol: 'Page',
      name: 'Page Layout View',
      desc: 'Displays the document page layout with synchronized sentence bounding box highlights and top coordinate tracking.',
    },
    {
      symbol: '3-Sent',
      name: '3-Sentence Teleprompter',
      desc: 'Displays a rolling 3-tier view showing previous sentence (dimmed), current active sentence (golden yellow), and upcoming sentence.',
    },
    {
      symbol: 'Text',
      name: 'Clean Plain Text Mode',
      desc: 'Displays the complete recognized text of the page in a clean reading format without layout bounding boxes.',
    },
    {
      symbol: 'Page / Width',
      name: 'Fit to Page vs Fit to Width',
      desc: '"Page" fits the whole magazine on screen without scrolling. "Width" expands to 100% viewport width with vertical scrolling for crisp text reading.',
    },
    {
      symbol: 'Filter Noise',
      name: 'Filter Garbage Words & Noise',
      desc: 'Automatically filters and excludes non-verbal noise and garbage words during read-aloud and in read-along teleprompter: garbage OCR tokens, table grid lines, symbol rubbish, dates, timestamps, file paths, folios, and header/footer banners.',
    },
    {
      symbol: 'Cont→ p.X',
      name: 'Continued On Jump Link',
      desc: 'Detects "Continued on page X" markers in magazine articles and allows 1-click jump to the continuation page. Pressing it again (←Back) returns to the origin.',
    },
    {
      symbol: 'Ad← / Art→',
      name: 'Ad Bookmark Jump',
      desc: 'Allows you to temporarily jump to a skipped advertisement insert page to inspect it, and return (Art→) straight back to your reading spot.',
    },
    {
      symbol: 'Zen',
      name: 'Zen Fullscreen Reading Mode',
      desc: 'Maximizes the reading canvas to the full screen, hiding toolbars and floating a translucent audio control bar over the page.',
    },
    {
      symbol: 'TOC',
      name: 'Table of Contents Page',
      desc: 'Identifies contents / "In the Queue" pages and turns listed article titles into clickable jump links directly to those pages in the document.',
    },
    {
      symbol: 'Proof',
      name: 'AI Proofreader',
      desc: 'Uses AI (Local Ollama, LM Studio, or Google Gemini) to fix OCR typos, hyphenated word splits, and formatting errors.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              {activeTab === 'shortcuts' ? <Keyboard className="w-4 h-4" /> : <Info className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-neutral-100">
                Help & Learning Guide
              </h3>
              <p className="text-[11px] text-neutral-400">
                Quick reference for keyboard shortcuts & symbol meanings
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

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 mt-3 p-1 bg-neutral-950 rounded-lg border border-neutral-800 shrink-0">
          <button
            onClick={() => setActiveTab('shortcuts')}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'shortcuts'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>Keyboard Shortcuts ({shortcuts.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('symbols')}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'symbols'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>Symbols & Meaning ({symbols.length})</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="mt-3 flex-1 overflow-y-auto pr-1 space-y-2 divide-y divide-neutral-800/60">
          {activeTab === 'shortcuts' ? (
            shortcuts.map((sc, i) => (
              <div key={i} className="pt-2.5 pb-1 flex items-center justify-between gap-4">
                <span className="text-xs text-neutral-300 leading-snug">{sc.desc}</span>
                <kbd className="px-2.5 py-1 rounded-md bg-neutral-950 border border-neutral-700 text-[11px] font-mono font-bold text-amber-400 shrink-0 shadow-sm">
                  {sc.key}
                </kbd>
              </div>
            ))
          ) : (
            symbols.map((sym, i) => (
              <div key={i} className="pt-3 pb-2 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-neutral-950 border border-amber-500/40 text-amber-400 font-mono text-xs font-bold">
                    {sym.symbol}
                  </span>
                  <span className="text-xs font-bold text-neutral-100">
                    {sym.name}
                  </span>
                </div>
                <p className="text-[11.5px] text-neutral-400 leading-relaxed pl-1">
                  {sym.desc}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-neutral-500 font-mono">
            Hover over any button in the app for quick tooltips
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};

