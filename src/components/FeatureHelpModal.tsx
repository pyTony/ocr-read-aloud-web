import React from 'react';
import { X, Sparkles, BookOpen, Volume2, FileText, Download, HelpCircle, ShieldAlert } from 'lucide-react';

interface FeatureHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FeatureHelpModal: React.FC<FeatureHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center gap-2 text-neutral-100 font-semibold text-base">
            <HelpCircle className="w-5 h-5 text-amber-400" />
            <span>OCR Read Aloud — Feature Guide</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-neutral-300 font-sans">
          {/* Section 1: AI Proofreading */}
          <div className="space-y-2">
            <h3 className="text-amber-400 font-semibold flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4" />
              <span>AI Proofreading & OCR Cleanup</span>
            </h3>
            <p className="text-neutral-300 leading-relaxed">
              Scanning old magazines and publications often produces OCR garbage, split words at line breaks, and hyphenation artifacts. Clicking the <strong className="text-white">Proof</strong> button opens a selection dialog where you can choose:
            </p>
            <ul className="list-disc list-inside space-y-1 text-neutral-300 pl-2">
              <li><strong className="text-white">Proofread Current Page:</strong> Instantly repairs split words, removes hyphens, and cleans OCR artifacts on the active page.</li>
              <li><strong className="text-white">Proofread Whole Document (Background):</strong> Runs a background batch job across all pages in your document so the entire issue is fully cleaned and ready.</li>
              <li><strong className="text-white">LLM Engines:</strong> Supports Google Gemini (with your personal subscription token), local Ollama (e.g. Qwen / Llama), OpenAI-compatible APIs, or instant offline rule-based cleaning.</li>
            </ul>
          </div>

          {/* Section 2: Reading & Speech */}
          <div className="space-y-2">
            <h3 className="text-amber-400 font-semibold flex items-center gap-2 text-base">
              <Volume2 className="w-4 h-4" />
              <span>Text-to-Speech & Navigation</span>
            </h3>
            <p className="text-neutral-300 leading-relaxed">
              Listen to your publication with synchronized sentence and paragraph highlighting. Use transport controls to jump between sentences, paragraphs, and pages.
            </p>
          </div>

          {/* Section 3: Ad Skipping */}
          <div className="space-y-2">
            <h3 className="text-amber-400 font-semibold flex items-center gap-2 text-base">
              <ShieldAlert className="w-4 h-4" />
              <span>Advertisement Detection & Skipping</span>
            </h3>
            <p className="text-neutral-300 leading-relaxed">
              Advertisements are automatically detected and marked as <strong className="text-amber-300">Ad Page</strong>. During continuous playback, ads are cleanly skipped so you can enjoy uninterrupted reading.
            </p>
          </div>

          {/* Section 4: Exporting */}
          <div className="space-y-2">
            <h3 className="text-amber-400 font-semibold flex items-center gap-2 text-base">
              <Download className="w-4 h-4" />
              <span>Article Extraction & Export</span>
            </h3>
            <p className="text-neutral-300 leading-relaxed">
              Extract individual multi-page articles or export the entire OCR document text (`.txt` or `.ocr.txt`) for archiving, summarization, or sharing.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold rounded-lg text-xs transition-colors"
          >
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
};
