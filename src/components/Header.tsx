import React, { useRef } from 'react';
import { BookOpen, Upload, FileText, Sparkles, Download, Layers, PanelLeft } from 'lucide-react';

interface HeaderProps {
  documentName: string;
  onLoadSample: () => void;
  onUploadPdf: (file: File) => void;
  onUploadImage: (file: File, lang: string) => void;
  isProcessing: boolean;
  processingStatus: string;
  ocrLang: string;
  onChangeOcrLang: (lang: string) => void;
  onOpenInspector: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isSampleDocument?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  documentName,
  onLoadSample,
  onUploadPdf,
  onUploadImage,
  isProcessing,
  processingStatus,
  ocrLang,
  onChangeOcrLang,
  onOpenInspector,
  isSidebarOpen,
  onToggleSidebar,
  isSampleDocument = false,
}) => {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadPdf(file);
      e.target.value = '';
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadImage(file, ocrLang);
      e.target.value = '';
    }
  };

  return (
    <header className="bg-neutral-900 border-b border-neutral-800 px-3 sm:px-4 py-2 flex items-center justify-between gap-3 select-none">
      {/* Brand & Document Name */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className={`p-1.5 rounded border transition-colors flex items-center gap-1.5 text-xs font-medium shrink-0 ${
              isSidebarOpen
                ? 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-750'
                : 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
            }`}
            title={`${isSidebarOpen ? 'Collapse' : 'Expand'} Pages Sidebar (Shortcut: [ or Ctrl+B)`}
          >
            <PanelLeft className="w-4 h-4" />
            <span className="hidden sm:inline text-[11px] font-mono">
              {isSidebarOpen ? 'Hide Pages' : 'Pages'}
            </span>
          </button>
        )}

        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-bold text-neutral-100 flex items-center gap-1.5">
              <span>OCR Read Aloud</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800 text-amber-400">
                v1.6.0
              </span>
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[11px] text-neutral-400 truncate max-w-[240px] md:max-w-xs">
                {documentName || 'BYTE Magazine Issue 12 (1976)'}
              </p>
              {isSampleDocument && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80 shrink-0"
                  title="Curated 1976 BYTE Magazine excerpt including Editorial, Speech Synthesis, Page 14 Letters, and Page 123 Ads. You can also upload any PDF."
                >
                  Curated Demo Excerpt
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Processing Status Banner */}
      {isProcessing && (
        <div className="flex items-center gap-2 px-3 py-1 rounded bg-amber-950/80 border border-amber-800 text-amber-300 text-xs animate-pulse">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>{processingStatus || 'Processing...'}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {/* Sample Document Button */}
        <button
          onClick={onLoadSample}
          disabled={isProcessing}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors"
          title="Load 1976 BYTE Magazine Speech Synthesis Sample"
        >
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <span>Load 1976 BYTE Sample</span>
        </button>

        {/* Upload PDF */}
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handlePdfChange}
        />
        <button
          onClick={() => pdfInputRef.current?.click()}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors"
          title="Upload PDF document"
        >
          <Upload className="w-3.5 h-3.5 text-neutral-400" />
          <span>Upload PDF</span>
        </button>

        {/* Upload Image (OCR) */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/tiff,image/bmp"
          className="hidden"
          onChange={handleImageChange}
        />
        <div className="hidden lg:flex items-center rounded-md bg-neutral-800 p-0.5 text-xs">
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200 hover:text-white font-medium transition-colors"
            title="Upload scanned image for OCR"
          >
            <Upload className="w-3.5 h-3.5 text-neutral-400" />
            <span>OCR Image</span>
          </button>
          <div className="h-4 w-px bg-neutral-700 mx-1" />
          <select
            value={ocrLang}
            onChange={(e) => onChangeOcrLang(e.target.value)}
            className="bg-transparent text-[11px] text-neutral-300 font-mono focus:outline-none pr-1"
            title="OCR Language (Tesseract)"
          >
            <option value="eng" className="bg-neutral-900">ENG</option>
            <option value="fin" className="bg-neutral-900">FIN</option>
            <option value="fin+eng" className="bg-neutral-900">FIN+ENG</option>
          </select>
        </div>

        {/* Text Inspector & Export Modal */}
        <button
          onClick={onOpenInspector}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors"
          title="Inspect OCR text, continue links, ad scores, and export"
        >
          <FileText className="w-3.5 h-3.5 text-neutral-400" />
          <span>Text & Export</span>
        </button>
      </div>
    </header>
  );
};
