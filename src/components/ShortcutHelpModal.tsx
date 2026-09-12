import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutHelpModal: React.FC<ShortcutHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Space', desc: 'Pause or resume speech playback' },
    { key: 'Esc', desc: 'Stop speech immediately' },
    { key: '← / →', desc: 'Rewind / advance one sentence' },
    { key: '↑ / ↓ (or Tab)', desc: 'Jump to previous / next paragraph' },
    { key: 'PageUp / PageDown', desc: 'Previous / next document page' },
    { key: '[ or Ctrl+B', desc: 'Toggle Pages sidebar (expand / collapse)' },
    { key: 'w', desc: 'Toggle Fit to Width (100%) vs Fit to Page' },
    { key: 'h', desc: 'Toggle visual highlight boxes (on / off)' },
    { key: '0', desc: 'Reset zoom to 100%' },
    { key: 'Scroll Wheel', desc: 'Zoom preview in / out (or Ctrl+Wheel)' },
    { key: 'c or Ctrl+J', desc: 'Jump to "Continued on" page (press again to return)' },
    { key: 'a', desc: 'Jump to skipped ad insert (press again to return)' },
    { key: 'Ctrl + S', desc: 'Export full document OCR text (.ocr.txt)' },
    { key: 'Ctrl + Shift + S', desc: 'Export current article or ad' },
    { key: '?', desc: 'Show this keyboard shortcuts dialog' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl max-w-md w-full p-5 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-neutral-100">Keyboard Shortcuts</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 divide-y divide-neutral-800/60 max-h-[60vh] overflow-y-auto">
          {shortcuts.map((sc, i) => (
            <div key={i} className="py-2.5 flex items-center justify-between gap-4">
              <span className="text-xs text-neutral-300">{sc.desc}</span>
              <kbd className="px-2 py-1 rounded bg-neutral-950 border border-neutral-700 text-[11px] font-mono font-semibold text-amber-400 shrink-0">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-3 border-t border-neutral-800 flex justify-end">
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
