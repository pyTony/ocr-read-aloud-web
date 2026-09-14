import React, { useState } from 'react';
import { PageUnit } from '../types';
import { FileText, Sparkles, Download, Copy, Check, X, ShieldAlert } from 'lucide-react';
import { formatPagesDump, articlePageIndices } from '../lib/articleExport';

interface TextInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  pages: PageUnit[];
  currentPageIndex: number;
  onUpdatePageText: (index: number, newText: string) => void;
}

export const TextInspectorModal: React.FC<TextInspectorModalProps> = ({
  isOpen,
  onClose,
  pages,
  currentPageIndex,
  onUpdatePageText,
}) => {
  const [activeTab, setActiveTab] = useState<'current' | 'article' | 'full'>('current');
  const [textVariant, setTextVariant] = useState<'proofread' | 'raw'>('proofread');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const currentPage = pages[currentPageIndex] || null;
  const currentArticleIndices = currentPage ? articlePageIndices(pages, currentPageIndex) : [];

  let displayText = '';
  let downloadFilename = 'document.ocr.txt';

  if (activeTab === 'current' && currentPage) {
    displayText = textVariant === 'proofread' 
      ? (currentPage.proofreadText || currentPage.rawText) 
      : currentPage.rawText;
    downloadFilename = `${currentPage.label || 'page'}_${textVariant}.txt`;
  } else if (activeTab === 'article') {
    displayText = formatPagesDump(pages, currentArticleIndices);
    downloadFilename = `${currentPage?.inferredTitle || 'article'}.txt`;
  } else {
    displayText = formatPagesDump(pages);
    downloadFilename = 'complete_issue.ocr.txt';
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(displayText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([displayText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadFilename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl max-w-3xl w-full h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-neutral-100">
              Text Inspector & Export
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls & Metadata */}
        <div className="bg-neutral-950 px-4 py-2.5 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('current')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'current'
                  ? 'bg-amber-500 text-neutral-950'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              Current Page ({currentPage?.label})
            </button>
            <button
              onClick={() => setActiveTab('article')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'article'
                  ? 'bg-amber-500 text-neutral-950'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              Full Article ({currentArticleIndices.length} {currentArticleIndices.length === 1 ? 'page' : 'pages'})
            </button>
            <button
              onClick={() => setActiveTab('full')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'full'
                  ? 'bg-amber-500 text-neutral-950'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              Complete Issue ({pages.length} pages)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-400" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Download (.txt)</span>
            </button>
          </div>
        </div>

        {/* Current Page Diagnostic Info & Text Variant Toggle */}
        {activeTab === 'current' && currentPage && (
          <div className="bg-neutral-900/90 px-4 py-2 border-b border-neutral-800 text-xs flex flex-wrap items-center justify-between gap-3 text-neutral-400 font-mono">
            <div className="flex items-center gap-4 flex-wrap">
              <span>Title: <strong className="text-neutral-200">{currentPage.inferredTitle}</strong></span>
              {currentPage.skipAsAd && (
                <span className="text-amber-400 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Ad Reasons: {currentPage.adReasons.join(', ') || 'Marked as ad'}
                </span>
              )}
            </div>

            {/* Proofread vs Raw PDF Text Segmented Toggle */}
            <div className="flex items-center bg-neutral-950 p-0.5 rounded border border-neutral-800">
              <button
                onClick={() => setTextVariant('proofread')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  textVariant === 'proofread'
                    ? 'bg-amber-500 text-neutral-950 font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title="View LLM or Rule Cleaned Proofread Text"
              >
                Proofread Text
              </button>
              <button
                onClick={() => setTextVariant('raw')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  textVariant === 'raw'
                    ? 'bg-amber-500 text-neutral-950 font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title="View Raw PDF Extracted OCR Text"
              >
                Raw PDF OCR
              </button>
            </div>
          </div>
        )}

        {/* Text View Area */}
        <div className="flex-1 p-4 overflow-y-auto bg-neutral-950 font-mono text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap select-text">
          {displayText || 'No text extracted for this view.'}
        </div>
      </div>
    </div>
  );
};
