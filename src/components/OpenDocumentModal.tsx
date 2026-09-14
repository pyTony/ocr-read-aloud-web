import React from 'react';
import { Upload, FileText, Layers, X, FileCode, Image as ImageIcon } from 'lucide-react';

interface OpenDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProcessFile: (file: File) => void;
  onLoadSample: () => void;
  ocrLang: string;
  onChangeOcrLang: (lang: string) => void;
  currentDocName: string;
}

export const OpenDocumentModal: React.FC<OpenDocumentModalProps> = ({
  isOpen,
  onClose,
  onProcessFile,
  onLoadSample,
  ocrLang,
  onChangeOcrLang,
  currentDocName,
}) => {
  if (!isOpen) return null;

  const handleFileSelected = (file: File) => {
    try {
      onProcessFile(file);
    } catch (err) {
      console.error('Error in onProcessFile:', err);
    }
    onClose();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        // Only close if user explicitly clicks the outer backdrop overlay itself
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh] text-neutral-100 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 bg-neutral-950/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-neutral-100">Open or Upload Document</h2>
              <p className="text-xs text-neutral-400 font-mono">
                Current: <span className="text-amber-300 truncate">{currentDocName || '1976 BYTE Demo'}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Universal Drag & Drop Zone with Direct Native File Input Overlay */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={handleDrop}
            className="relative border-2 border-dashed border-amber-500/60 hover:border-amber-400 rounded-xl p-6 bg-amber-500/5 hover:bg-amber-500/10 transition-colors flex flex-col items-center justify-center text-center group cursor-pointer"
          >
            {/* Direct native file input overlay covering 100% of zone */}
            <input
              id="modal-universal-file-input"
              type="file"
              accept=".pdf,.txt,.text,.md,.markdown,.rtf,.html,.htm,.srt,.vtt,.json,.csv,.png,.jpg,.jpeg,.tiff,.tif,.bmp,.webp,application/pdf,text/*,image/*"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              title="Click or drop file here to open"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleFileSelected(file);
                }
                e.target.value = '';
              }}
            />

            <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 mb-3 group-hover:scale-110 transition-transform pointer-events-none">
              <Upload className="w-6 h-6" />
            </div>
            <p className="font-bold text-base text-neutral-100 group-hover:text-amber-300 pointer-events-none">
              Drop any document file here, or click to browse
            </p>
            <p className="text-xs text-neutral-400 mt-1.5 max-w-sm pointer-events-none">
              Supports <strong className="text-neutral-200">PDF, TXT, Markdown (.md), RTF, HTML, Subtitles (.srt), JSON</strong>, and <strong className="text-neutral-200">Image Scans (PNG/JPG/TIFF)</strong>
            </p>

            <div className="mt-4 px-5 py-2.5 rounded-lg bg-amber-500 group-hover:bg-amber-400 text-neutral-950 font-bold text-xs shadow-md transition-all flex items-center gap-2 pointer-events-none">
              <FileText className="w-4 h-4" />
              Browse File from Computer
            </div>
          </div>

          {/* Quick Browse Buttons by Type with Direct Native Inputs */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-mono uppercase text-neutral-400 font-semibold px-1">
              Or pick specifically by format:
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="relative flex flex-col items-center justify-center p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-amber-500/60 hover:bg-neutral-800/80 cursor-pointer text-center transition-colors group select-none">
                <input
                  id="modal-pdf-file-input"
                  type="file"
                  accept=".pdf,application/pdf"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Upload PDF Document"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelected(file);
                    e.target.value = '';
                  }}
                />
                <Upload className="w-4 h-4 text-red-400 mb-1 group-hover:scale-110 transition-transform pointer-events-none" />
                <span className="text-xs font-semibold text-neutral-200 pointer-events-none">PDF Document</span>
                <span className="text-[10px] text-neutral-400 font-mono pointer-events-none">.pdf</span>
              </div>

              <div className="relative flex flex-col items-center justify-center p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-amber-500/60 hover:bg-neutral-800/80 cursor-pointer text-center transition-colors group select-none">
                <input
                  id="modal-text-file-input"
                  type="file"
                  accept=".txt,.text,.md,.markdown,.rtf,.html,.htm,.srt,.vtt,.json,.csv,text/*"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Upload Text or Markdown"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelected(file);
                    e.target.value = '';
                  }}
                />
                <FileCode className="w-4 h-4 text-blue-400 mb-1 group-hover:scale-110 transition-transform pointer-events-none" />
                <span className="text-xs font-semibold text-neutral-200 pointer-events-none">Text / Markdown</span>
                <span className="text-[10px] text-neutral-400 font-mono pointer-events-none">.txt, .md, .rtf</span>
              </div>

              <div className="relative flex flex-col items-center justify-center p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-amber-500/60 hover:bg-neutral-800/80 cursor-pointer text-center transition-colors group select-none">
                <input
                  id="modal-image-file-input"
                  type="file"
                  accept=".png,.jpg,.jpeg,.tiff,.tif,.bmp,.webp,image/*"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Upload Scanned Image for OCR"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelected(file);
                    e.target.value = '';
                  }}
                />
                <ImageIcon className="w-4 h-4 text-emerald-400 mb-1 group-hover:scale-110 transition-transform pointer-events-none" />
                <span className="text-xs font-semibold text-neutral-200 pointer-events-none">Scanned Image</span>
                <span className="text-[10px] text-neutral-400 font-mono pointer-events-none">.png, .jpg, OCR</span>
              </div>
            </div>
          </div>

          {/* OCR Language Selector for Image Scans */}
          <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-neutral-200">OCR Language for Image Scans</div>
              <div className="text-[11px] text-neutral-400">Used when opening scanned photos or diagrams</div>
            </div>
            <select
              value={ocrLang}
              onChange={(e) => onChangeOcrLang(e.target.value)}
              className="bg-neutral-900 text-xs text-amber-300 font-mono border border-neutral-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-amber-500 shrink-0 cursor-pointer"
            >
              <option value="eng">English (eng)</option>
              <option value="fin">Finnish (fin)</option>
              <option value="fin+eng">Finnish + English</option>
            </select>
          </div>

          {/* Sample 1976 Demo Issue */}
          <div className="pt-2 border-t border-neutral-800">
            <button
              onClick={() => {
                onLoadSample();
                onClose();
              }}
              className="w-full flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 hover:bg-amber-500/20 transition-all text-left group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-amber-500/20 text-amber-400">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-sm text-amber-300">
                    Load 1976 BYTE Magazine Demo
                  </div>
                  <div className="text-xs text-neutral-300">
                    August 1976 · Speech Synthesis (Real scans: Robert Tinney Cover, SWTPC PR-40, Cromemco, In The Queue TOC, Letters cartoon, &amp; Formula Int'l 28-Box Ad Grid)
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-amber-500 text-neutral-950 font-bold group-hover:bg-amber-400 shrink-0">
                Load Demo
              </span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
