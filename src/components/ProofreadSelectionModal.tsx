import React from 'react';
import { X, Sparkles, FileText, Layers, Key, Settings } from 'lucide-react';
import { LlmConfig } from '../types';

interface ProofreadSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProofreadCurrent: () => void;
  onProofreadAll: () => void;
  onOpenSettings: () => void;
  isProofreading: boolean;
  llmConfig: LlmConfig;
  totalPages: number;
}

export const ProofreadSelectionModal: React.FC<ProofreadSelectionModalProps> = ({
  isOpen,
  onClose,
  onProofreadCurrent,
  onProofreadAll,
  onOpenSettings,
  isProofreading,
  llmConfig,
  totalPages,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center gap-2 text-neutral-100 font-semibold text-base">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <span>AI Proofreading & Cleanup</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm text-neutral-300 font-sans">
          {llmConfig.isGeminiQuotaExhausted && !llmConfig.geminiApiKey && (
            <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-600/50 text-[11px] text-amber-200">
              ⚡ <strong>Zero Cost Mode:</strong> Gemini cloud quota is depleted. Running with <strong>Offline Rule Cleaner</strong> (instant dehyphenation &amp; split-word repair).
            </div>
          )}

          <p className="text-neutral-400 text-xs">
            Clean OCR artifacts, remove stray hyphens, and aggressively repair split words using <strong className="text-neutral-200 uppercase">{llmConfig.isGeminiQuotaExhausted && !llmConfig.geminiApiKey ? 'Offline Rules' : llmConfig.provider}</strong> engine.
          </p>

          <div className="space-y-2.5">
            {/* Option 1: Current Page */}
            <button
              onClick={() => {
                onClose();
                onProofreadCurrent();
              }}
              disabled={isProofreading}
              className="w-full text-left p-3.5 rounded-xl bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700 hover:border-amber-500/60 transition-all flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 group-hover:scale-105 transition-transform">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-white flex items-center justify-between">
                  <span>Proofread Current Page</span>
                  <span className="text-[10px] font-mono text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">Instant</span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Clean OCR typos, dehyphenate, and repair broken words on the active page.
                </p>
              </div>
            </button>

            {/* Option 2: Whole Document */}
            <button
              onClick={() => {
                onClose();
                onProofreadAll();
              }}
              disabled={isProofreading}
              className="w-full text-left p-3.5 rounded-xl bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700 hover:border-emerald-500/60 transition-all flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 group-hover:scale-105 transition-transform">
                <Layers className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-white flex items-center justify-between">
                  <span>Proofread Whole Document</span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60">{totalPages} Pages (Background)</span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Process all pages in the background with status progress for a fully polished issue.
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-between">
          <button
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configure AI Engine</span>
          </button>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium rounded-lg text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
