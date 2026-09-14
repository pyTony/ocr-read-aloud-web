import React, { useState, useRef, useEffect } from 'react';
import {
  Square,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ChevronsLeft,
  ChevronsRight,
  ArrowRightCircle,
  Undo2,
  Sparkles,
  FileText,
  FileCode,
  Download,
  Volume2,
  Sliders,
  SlidersHorizontal,
  HelpCircle,
  Settings,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Maximize,
  Minimize,
  Gauge,
  Key,
  Eye,
  EyeOff,
  Cookie,
  ShieldCheck,
  Trash2,
  PanelLeft,
  BookOpen,
  Upload,
  Layers,
  ChevronUp,
} from 'lucide-react';
import { ContinueJumpRecord, AdJumpRecord, LlmConfig, LlmProvider } from '../types';

interface TransportControlsProps {
  isPlaying: boolean;
  isPaused: boolean;
  onStop: () => void;
  onTogglePlay: () => void;
  onPrevSentence: () => void;
  onNextSentence: () => void;
  onPrevChunk: () => void;
  onNextChunk: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  // Continue jump
  continueJump: ContinueJumpRecord | null;
  targetContinueFolio: number | null;
  continuedFromFolio?: number | null;
  onContinueAction: () => void;
  // Ad jump
  adJump: AdJumpRecord | null;
  canJumpToAd: boolean;
  onAdAction: () => void;
  // Extras
  onProofread: () => void;
  onProofreadAll?: () => void;
  onOpenProofreadModal?: () => void;
  isProofreading: boolean;
  llmConfig: LlmConfig;
  onChangeLlmConfig: (cfg: LlmConfig) => void;
  onSaveArticle: () => void;
  onSaveAllOcr: () => void;
  onOpenShortcuts: () => void;
  onOpenDisplayControls?: () => void;
  onOpenLlmSettings?: () => void;
  // Voices & Speed
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string | null;
  onSelectVoice: (voiceURI: string) => void;
  speechRate: number;
  onChangeSpeechRate: (rate: number) => void;
  isReadingMode?: boolean;
  onToggleReadingMode?: () => void;
  skipNoiseHeaderFooter?: boolean;
  onToggleSkipNoiseHeaderFooter?: () => void;
  // File & Document Management (United with bottom panel)
  documentName?: string;
  isSampleDocument?: boolean;
  onLoadSample?: () => void;
  onProcessFile?: (file: File) => void;
  onUploadPdf?: (file: File) => void;
  onUploadImage?: (file: File, lang: string) => void;
  onUploadText?: (file: File) => void;
  onOpenUploadModal?: () => void;
  isProcessing?: boolean;
  processingStatus?: string;
  ocrLang?: string;
  onChangeOcrLang?: (lang: string) => void;
  onOpenInspector?: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  currentPageIndex?: number;
  totalPages?: number;
  onSelectPage?: (pageIndex: number) => void;
  onJumpPages?: (delta: number) => void;
  onJumpToCover?: () => void;
}

export const TransportControls: React.FC<TransportControlsProps> = ({
  isPlaying,
  isPaused,
  onStop,
  onTogglePlay,
  onPrevSentence,
  onNextSentence,
  onPrevChunk,
  onNextChunk,
  onPrevPage,
  onNextPage,
  currentPageIndex = 0,
  totalPages = 1,
  onSelectPage,
  onJumpPages,
  onJumpToCover,
  continueJump,
  targetContinueFolio,
  continuedFromFolio,
  onContinueAction,
  adJump,
  canJumpToAd,
  onAdAction,
  onProofread,
  onProofreadAll,
  onOpenProofreadModal,
  isProofreading,
  llmConfig,
  onChangeLlmConfig,
  onSaveArticle,
  onSaveAllOcr,
  onOpenShortcuts,
  onOpenDisplayControls,
  onOpenLlmSettings,
  voices,
  selectedVoiceURI,
  onSelectVoice,
  speechRate,
  onChangeSpeechRate,
  isReadingMode = false,
  onToggleReadingMode,
  skipNoiseHeaderFooter = true,
  onToggleSkipNoiseHeaderFooter,
  documentName,
  isSampleDocument = false,
  onLoadSample,
  onProcessFile,
  onUploadPdf,
  onUploadImage,
  onUploadText,
  onOpenUploadModal,
  isProcessing = false,
  processingStatus = '',
  ocrLang = 'eng',
  onChangeOcrLang,
  onOpenInspector,
  isSidebarOpen,
  onToggleSidebar,
}) => {
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [showDocMenu, setShowDocMenu] = useState(false);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showGeminiTokenPassword, setShowGeminiTokenPassword] = useState(false);

  const universalInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const docMenuRef = useRef<HTMLDivElement>(null);

  const handleUniversalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (onProcessFile) {
        onProcessFile(file);
      } else if (onUploadPdf) {
        onUploadPdf(file);
      }
      e.target.value = '';
      setShowDocMenu(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (docMenuRef.current && !docMenuRef.current.contains(event.target as Node)) {
        setShowDocMenu(false);
      }
    };
    if (showDocMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDocMenu]);

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadPdf) {
      onUploadPdf(file);
      e.target.value = '';
      setShowDocMenu(false);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadImage) {
      onUploadImage(file, ocrLang);
      e.target.value = '';
      setShowDocMenu(false);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadText) {
      onUploadText(file);
      e.target.value = '';
      setShowDocMenu(false);
    }
  };

  const handleTestLlm = async () => {
    setIsTestingLlm(true);
    setTestResult(null);

    // If testing Gemini Cloud API
    if (llmConfig.provider === 'gemini') {
      try {
        const res = await fetch('/api/llm-test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(llmConfig.geminiApiKey ? { 'x-gemini-api-key': llmConfig.geminiApiKey } : {}),
          },
          body: JSON.stringify({
            provider: 'gemini',
            geminiApiKey: llmConfig.geminiApiKey,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setTestResult({
            ok: true,
            message: data.message || (llmConfig.geminiApiKey ? 'Connected with personal subscription token!' : 'Connected with server key.'),
          });
        } else {
          setTestResult({
            ok: false,
            message: data.message || data.error || 'Gemini authentication failed. Please verify your token/subscription.',
          });
        }
      } catch (err: any) {
        setTestResult({
          ok: false,
          message: `Network error reaching Gemini service: ${err.message}`,
        });
      }
      setIsTestingLlm(false);
      return;
    }

    const isOllama = llmConfig.provider === 'ollama' || llmConfig.provider === 'auto';
    const rawHost = llmConfig.provider === 'openai' ? llmConfig.openaiHost : llmConfig.ollamaHost;
    const cleanHost = (rawHost || (isOllama ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234/v1')).replace(/\/+$/, '');

    // STEP 1: Direct Browser-to-Ollama / OpenAI check (Runs on user's machine directly!)
    try {
      const clientCtrl = new AbortController();
      const tid = setTimeout(() => clientCtrl.abort(), 3500);
      const testPath = isOllama ? `${cleanHost}/api/tags` : `${cleanHost}/models`;

      const directRes = await fetch(testPath, {
        method: 'GET',
        signal: clientCtrl.signal,
      });
      clearTimeout(tid);

      if (directRes.ok) {
        const data = await directRes.json();
        const models = isOllama
          ? ((data.models as any[]) || []).map((m: any) => m.name)
          : ((data.data as any[]) || []).map((m: any) => m.id);

        setTestResult({
          ok: true,
          message: `Connected directly to local ${isOllama ? 'Ollama' : 'OpenAI'} on your computer! Found ${models.length} model(s)${
            models.length ? `: ${models.slice(0, 3).join(', ')}` : ''
          }.`,
        });
        setIsTestingLlm(false);
        return;
      }
    } catch (browserDirectErr: any) {
      console.log('Browser direct test to local LLM failed:', browserDirectErr?.message);
    }

    // STEP 2: Check if local Ollama port is open and alive (no-cors mode check)
    let isPortListening = false;
    try {
      const pingCtrl = new AbortController();
      const pid = setTimeout(() => pingCtrl.abort(), 2000);
      await fetch(`${cleanHost}/`, {
        mode: 'no-cors',
        signal: pingCtrl.signal,
      });
      clearTimeout(pid);
      isPortListening = true;
    } catch {
      isPortListening = false;
    }

    // STEP 3: Fallback check through backend API route
    try {
      const res = await fetch('/api/llm-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: llmConfig.provider === 'auto' ? 'ollama' : llmConfig.provider,
          host: cleanHost,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult({ ok: true, message: data.message || 'Connected successfully!' });
        setIsTestingLlm(false);
        return;
      }
    } catch (serverErr) {
      console.log('Server proxy test failed:', serverErr);
    }

    // STEP 4: Accurate diagnosis based on network status
    if (isPortListening) {
      setTestResult({
        ok: false,
        message: `Ollama is active and running on your computer (${cleanHost}/ responded!), but the browser was blocked by Ollama's default CORS security. Fix: start Ollama with browser access enabled by running 'OLLAMA_ORIGINS="*" ollama serve' (or set OLLAMA_ORIGINS=* in your system environment variables for the GUI app), then click Test again. Or choose 'Google Gemini' for instant cloud proofreading.`,
      });
    } else {
      setTestResult({
        ok: false,
        message: `Could not connect to ${cleanHost}. Ensure Ollama is running on your computer with browser access: 'OLLAMA_ORIGINS="*" ollama serve', or try host 'http://localhost:11434', or switch engine to Google Gemini.`,
      });
    }

    setIsTestingLlm(false);
  };

  const handleCycleSpeed = () => {
    const rates = [1.0, 1.25, 1.5, 1.75, 2.0, 0.8];
    const currentIdx = rates.indexOf(speechRate);
    const nextRate = currentIdx !== -1 ? rates[(currentIdx + 1) % rates.length] : 1.0;
    onChangeSpeechRate(nextRate);
  };

  return (
    <div className="bg-neutral-950 border-t border-neutral-800 px-2 sm:px-4 py-1.5 sm:py-2 shrink-0 select-none z-30 shadow-lg relative">
      {/* Universal and Format-Specific File Inputs */}
      <input
        ref={universalInputRef}
        type="file"
        accept=".pdf,.txt,.text,.md,.markdown,.rtf,.html,.htm,.srt,.vtt,.json,.csv,.png,.jpg,.jpeg,.tiff,.tif,.bmp,.webp,application/pdf,text/*,image/*"
        className="sr-only"
        style={{ position: 'fixed', top: '-1000px', left: '-1000px', opacity: 0 }}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleUniversalChange}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        style={{ position: 'fixed', top: '-1000px', left: '-1000px', opacity: 0 }}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handlePdfChange}
      />
      <input
        ref={textInputRef}
        type="file"
        accept=".txt,.text,.md,.markdown,.rtf,.html,.htm,.srt,.vtt,.json,.csv,text/*"
        className="sr-only"
        style={{ position: 'fixed', top: '-1000px', left: '-1000px', opacity: 0 }}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleTextChange}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.tiff,.tif,.bmp,.webp,image/*"
        className="sr-only"
        style={{ position: 'fixed', top: '-1000px', left: '-1000px', opacity: 0 }}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleImageChange}
      />

      <div className="max-w-7xl mx-auto flex items-center justify-between gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none py-0.5 flex-nowrap">
        {/* Left Section: Document / File Menu */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Document / File Menu */}
          <div className="relative" ref={docMenuRef}>
            <button
              onClick={() => {
                if (onOpenUploadModal) {
                  onOpenUploadModal();
                } else {
                  setShowDocMenu((prev) => !prev);
                }
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 hover:border-amber-500/60 text-xs font-medium transition-colors shrink-0 max-w-[170px] sm:max-w-[220px] cursor-pointer"
              title="Open Document / File Upload Dialog (PDF, Text, Markdown, Image OCR, Demo)"
            >
              <Upload className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate text-[11px] font-medium">{documentName || 'Open Document'}</span>
              <ChevronUp className={`w-3 h-3 text-neutral-400 transition-transform ${showDocMenu ? 'rotate-180' : ''}`} />
            </button>

            {/* Document Menu Dropdown */}
            {showDocMenu && (
              <div className="absolute bottom-full left-0 mb-2 w-64 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl p-2 z-50 text-xs space-y-1">
                <div className="px-2 py-1 text-[10px] font-mono uppercase text-neutral-400 border-b border-neutral-800 mb-1 flex items-center justify-between">
                  <span>Open & Load Content</span>
                  {isSampleDocument && <span className="text-amber-400 font-bold">Demo</span>}
                </div>

                <div className="relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-neutral-800 text-neutral-200 text-left transition-colors cursor-pointer group">
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    title="Upload PDF Document"
                    onChange={(e) => {
                      setShowDocMenu(false);
                      handlePdfChange(e);
                    }}
                  />
                  <Upload className="w-3.5 h-3.5 text-amber-400 shrink-0 pointer-events-none" />
                  <div className="pointer-events-none">
                    <div className="font-medium">Upload PDF</div>
                    <div className="text-[10px] text-neutral-400">PDF document with page images</div>
                  </div>
                </div>

                <div className="relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-neutral-800 text-neutral-200 text-left transition-colors cursor-pointer group">
                  <input
                    type="file"
                    accept=".txt,.text,.md,.markdown,.rtf,.html,.htm,.srt,.vtt,.json,.csv,text/*"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    title="Upload Text / Markdown"
                    onChange={(e) => {
                      setShowDocMenu(false);
                      handleTextChange(e);
                    }}
                  />
                  <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0 pointer-events-none" />
                  <div className="pointer-events-none">
                    <div className="font-medium">Upload Text / Markdown</div>
                    <div className="text-[10px] text-neutral-400">TXT, MD, RTF, HTML, Subtitles</div>
                  </div>
                </div>

                <div className="relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-neutral-800 text-neutral-200 text-left transition-colors cursor-pointer group">
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.tiff,.tif,.bmp,.webp,image/*"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    title="Upload Image (OCR)"
                    onChange={(e) => {
                      setShowDocMenu(false);
                      handleImageChange(e);
                    }}
                  />
                  <Upload className="w-3.5 h-3.5 text-neutral-400 shrink-0 pointer-events-none" />
                  <div className="flex-1 min-w-0 pointer-events-none">
                    <div className="font-medium">Upload Image (OCR)</div>
                    <div className="text-[10px] text-neutral-400">PNG, JPG, TIFF image</div>
                  </div>
                  {onChangeOcrLang && (
                    <select
                      value={ocrLang}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onChangeOcrLang(e.target.value)}
                      className="relative z-20 bg-neutral-950 text-[10px] text-amber-300 font-mono border border-neutral-700 rounded px-1 py-0.5"
                    >
                      <option value="eng">ENG</option>
                      <option value="fin">FIN</option>
                      <option value="fin+eng">FIN+ENG</option>
                    </select>
                  )}
                </div>

                {onOpenUploadModal && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDocMenu(false);
                      onOpenUploadModal();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-neutral-800 text-amber-400 text-left transition-colors cursor-pointer border-t border-neutral-800"
                  >
                    <Upload className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-medium">Open Document Dialog...</div>
                      <div className="text-[10px] text-neutral-400">Full upload and drop interface</div>
                    </div>
                  </button>
                )}

                {onLoadSample && (
                  <button
                    type="button"
                    onClick={() => {
                      onLoadSample();
                      setShowDocMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-amber-500/20 text-amber-300 text-left transition-colors border-t border-neutral-800 pt-1.5"
                  >
                    <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-semibold">Load 1976 BYTE Demo</div>
                      <div className="text-[10px] text-amber-200/70">Speech Synthesis Issue 12</div>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Processing Indicator */}
          {isProcessing && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-950/80 border border-amber-800 text-amber-300 text-[11px] animate-pulse">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping shrink-0" />
              <span className="hidden sm:inline truncate max-w-[120px]">{processingStatus || 'Processing...'}</span>
            </div>
          )}

          <div className="h-6 w-px bg-neutral-800 mx-0.5 hidden sm:block" />
        </div>

        {/* Core Transport Buttons */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Stop */}
          <button
            onClick={onStop}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-800 text-xs font-semibold transition-colors shrink-0"
            title="Stop Speech (■) — Halt audio read-aloud and reset playback position [Key: Esc]"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span className="hidden sm:inline">Stop</span>
          </button>

          {/* Play / Pause */}
          <button
            onClick={onTogglePlay}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs font-bold transition-all shadow-sm shrink-0 ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
            title={
              isPlaying
                ? 'Pause Speech (❚❚) — Temporarily pause audio read-aloud [Key: Space]'
                : 'Play Speech (▶) — Start reading text aloud from current position [Key: Space]'
            }
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Play</span>
              </>
            )}
          </button>

          <div className="h-6 w-px bg-neutral-800 mx-1 hidden sm:block" />

          {/* Rew / Fwd Sentence */}
          <div className="flex items-center rounded-md bg-neutral-900 border border-neutral-800 p-0.5">
            <button
              onClick={onPrevSentence}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Rewind Sentence (Rew) — Step backward to previous spoken sentence [Key: Left Arrow]"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Rew</span>
            </button>
            <div className="h-4 w-px bg-neutral-800" />
            <button
              onClick={onNextSentence}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Forward Sentence (Fwd) — Step forward to next spoken sentence [Key: Right Arrow]"
            >
              <span>Fwd</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Para Prev / Next */}
          <div className="flex items-center rounded-md bg-neutral-900 border border-neutral-800 p-0.5">
            <button
              onClick={onPrevChunk}
              className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Previous Paragraph (¶ ▲) — Jump to previous OCR paragraph block [Key: Up Arrow or Shift+Tab]"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <span
              className="text-[11px] font-mono px-1.5 text-neutral-400 cursor-help"
              title="Paragraph Navigation (¶) — Jump across recognized text blocks on current page [Keys: Up/Down Arrow]"
            >
              Para
            </span>
            <button
              onClick={onNextChunk}
              className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Next Paragraph (¶ ▼) — Jump to next OCR paragraph block [Key: Down Arrow or Tab]"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Cover & Rapid Page Navigation Steppers */}
          <div className="flex items-center rounded-md bg-neutral-900 border border-neutral-800 p-0.5">
            {/* Cover Button */}
            {onJumpToCover && (
              <>
                <button
                  type="button"
                  onClick={onJumpToCover}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-semibold transition-colors ${
                    currentPageIndex === 0
                      ? 'bg-amber-500 text-neutral-950 font-bold'
                      : 'text-amber-400 hover:text-amber-300 hover:bg-neutral-800'
                  }`}
                  title="Jump to Cover (Page 1) — Return immediately to publication cover [Key: Home]"
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span>Cover</span>
                </button>
                <div className="h-4 w-px bg-neutral-800" />
              </>
            )}

            {/* Jump -10 Pages */}
            {onJumpPages && totalPages > 10 && (
              <>
                <button
                  type="button"
                  onClick={() => onJumpPages(-10)}
                  disabled={currentPageIndex <= 0}
                  className="px-1.5 py-1.5 rounded text-[11px] font-mono text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Step Back 10 Pages (◄ 10) — Rapidly browse backward through pages [Key: Shift+PageUp or Shift+ArrowLeft]"
                >
                  -10
                </button>
                <div className="h-4 w-px bg-neutral-800" />
              </>
            )}

            {/* PgUp */}
            <button
              type="button"
              onClick={onPrevPage}
              className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Previous Page (p. ◀) — Navigate to previous page in document [Key: PageUp]"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">PgUp</span>
            </button>
            <div className="h-4 w-px bg-neutral-800" />

            {/* PgDn */}
            <button
              type="button"
              onClick={onNextPage}
              className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Next Page (p. ▶) — Navigate to next page in document [Key: PageDown]"
            >
              <span className="hidden sm:inline">PgDn</span>
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>

            {/* Jump +10 Pages */}
            {onJumpPages && totalPages > 10 && (
              <>
                <div className="h-4 w-px bg-neutral-800" />
                <button
                  type="button"
                  onClick={() => onJumpPages(10)}
                  disabled={currentPageIndex >= totalPages - 1}
                  className="px-1.5 py-1.5 rounded text-[11px] font-mono text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Step Forward 10 Pages (10 ►) — Rapidly browse forward through pages [Key: Shift+PageDown or Shift+ArrowRight]"
                >
                  +10
                </button>
              </>
            )}
          </div>

          {/* Fast Page Scrubber Slider (Instant Visual Page Browsing across 10s of pages) */}
          {totalPages > 1 && onSelectPage && (
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 bg-neutral-900 rounded-md border border-neutral-800 text-xs">
              <span className="font-mono text-[11px] text-amber-400 font-bold whitespace-nowrap">
                p. {currentPageIndex + 1} / {totalPages}
              </span>
              <input
                type="range"
                min="1"
                max={totalPages}
                value={currentPageIndex + 1}
                onChange={(e) => onSelectPage(Math.max(0, Math.min(totalPages - 1, Number(e.target.value) - 1)))}
                className="w-20 lg:w-32 h-1.5 bg-neutral-700 rounded appearance-none cursor-ew-resize accent-amber-500"
                title="Fast Page Scrubber — Drag or click to rapidly browse through dozens of pages visually"
              />
            </div>
          )}
        </div>

        {/* Magazine Special Controls, Speech Speed & Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap shrink-0">
          {/* Cont→ / ←Back Button */}
          {(targetContinueFolio !== null || continueJump !== null || (continuedFromFolio !== undefined && continuedFromFolio !== null)) && (
            <button
              onClick={onContinueAction}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                continueJump || (continuedFromFolio !== undefined && continuedFromFolio !== null)
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700'
              }`}
              title={
                continueJump
                  ? 'Return to Origin Page (←Back) — Return to original reading spot before continuation jump [Key: c or Ctrl+J]'
                  : continuedFromFolio
                  ? `Return to Origin Page ${continuedFromFolio} (←From p.${continuedFromFolio}) [Key: c or Ctrl+J]`
                  : `Continuation Jump (Cont→ p.${targetContinueFolio}) — Follow "Continued on page ${targetContinueFolio}" [Key: c or Ctrl+J]`
              }
            >
              {continueJump ? (
                <>
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>←Back</span>
                </>
              ) : continuedFromFolio ? (
                <>
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>←From p.{continuedFromFolio}</span>
                </>
              ) : (
                <>
                  <ArrowRightCircle className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Cont→ {targetContinueFolio ? `p.${targetContinueFolio}` : ''}</span>
                </>
              )}
            </button>
          )}

          {/* Ad← / Art→ button */}
          {(canJumpToAd || adJump !== null) && (
            <button
              onClick={onAdAction}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                adJump
                  ? 'bg-amber-600 hover:bg-amber-500 text-neutral-950'
                  : 'bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-800'
              }`}
              title={
                adJump
                  ? 'Return to Article (Art→) — Jump back to your article reading position [Key: a]'
                  : 'Visit Skipped Ad Insert (Ad←) — Jump to inspect the skipped advertisement page [Key: a]'
              }
            >
              {adJump ? <span>Art→</span> : <span>Ad←</span>}
            </button>
          )}

          {/* Filter Repeating Noise Headers/Footers Toggle */}
          {onToggleSkipNoiseHeaderFooter && (
            <button
              onClick={onToggleSkipNoiseHeaderFooter}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                skipNoiseHeaderFooter
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
              }`}
              title="Filter Garbage Words & Noise — Automatically filter out garbage words, OCR symbol rubbish, table grid lines, dates, timestamps, and page metadata during reading [Key: N]"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Filter Noise</span>
              <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${skipNoiseHeaderFooter ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}`}>
                {skipNoiseHeaderFooter ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* DIRECT SPEECH SPEED & 1X RESET CONTROLS (Always accessible when not in full screen) */}
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-md p-0.5 font-mono text-xs">
            {/* Quick Speed Cycle Button */}
            <button
              onClick={handleCycleSpeed}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                speechRate !== 1.0
                  ? 'text-amber-400 font-bold bg-amber-500/15'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              }`}
              title="Speech Speed (Rate) — Click to cycle tempo (0.8x → 1.0x → 1.25x → 1.5x → 1.75x → 2.0x) [Keys: + / -]"
            >
              <Gauge className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{speechRate.toFixed(2)}x</span>
            </button>

            {/* Quick 1x Normal Speed Switch Button */}
            <button
              onClick={() => onChangeSpeechRate(1.0)}
              className={`px-1.5 py-1 rounded text-[11px] font-bold transition-colors ${
                speechRate === 1.0
                  ? 'bg-amber-500 text-neutral-950 font-bold'
                  : 'text-amber-400 hover:text-white hover:bg-neutral-800'
              }`}
              title="Switch to 1.0x Normal Speed — Instantly reset speech tempo back to 1.0x standard pace [Key: 1]"
            >
              1x
            </button>
          </div>

          {/* Voice / Audio Settings Button & Popover */}
          <div className="relative">
            <button
              onClick={() => setShowVoiceSettings(!showVoiceSettings)}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                showVoiceSettings
                  ? 'bg-neutral-800 border-neutral-600 text-white'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
              }`}
              title="Voice & Audio Settings — Select installed synthesis voice and fine-tune speech parameters"
            >
              <Volume2 className="w-3.5 h-3.5 text-neutral-400" />
              <span className="hidden sm:inline">Voice</span>
            </button>

            {/* Voice Dropdown Popover */}
            {showVoiceSettings && (
              <div className="absolute bottom-full right-0 mb-2 w-72 bg-neutral-900 border border-neutral-700 rounded-xl p-3 shadow-2xl z-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-amber-400" />
                    Speech Configuration
                  </span>
                  <button
                    onClick={() => setShowVoiceSettings(false)}
                    className="text-neutral-400 hover:text-white text-xs p-1"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-neutral-400 mb-1">
                      Installed TTS Voice:
                    </label>
                    <select
                      value={selectedVoiceURI || ''}
                      onChange={(e) => onSelectVoice(e.target.value)}
                      className="w-full text-xs bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-neutral-200 focus:outline-none focus:border-amber-500"
                    >
                      {voices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                      <span>Speed / Rate:</span>
                      <span className="font-mono text-amber-400 font-bold">{speechRate.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.6"
                      max="2.0"
                      step="0.1"
                      value={speechRate}
                      onChange={(e) => onChangeSpeechRate(parseFloat(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                    
                    {/* Instant Speed Preset Pills */}
                    <div className="flex items-center justify-between gap-1 mt-2">
                      {[0.8, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => onChangeSpeechRate(rate)}
                          className={`flex-1 py-1 rounded text-[10px] font-mono font-semibold transition-colors ${
                            speechRate === rate
                              ? 'bg-amber-500 text-neutral-950'
                              : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                          }`}
                        >
                          {rate === 1.0 ? '1.0x (Norm)' : `${rate}x`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Proofread & Local LLM Group */}
          <div className="relative flex items-center gap-1">
            <div className="flex items-center">
              <button
                onClick={() => onOpenProofreadModal ? onOpenProofreadModal() : onProofread()}
                disabled={isProofreading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 text-xs font-semibold transition-colors disabled:opacity-50"
                title="AI Proofread Selection Dialog — Choose between current page or whole document background batch proofing"
              >
                <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isProofreading ? 'animate-spin' : ''}`} />
                <span>{isProofreading ? 'Proofing...' : 'Proof'}</span>
              </button>
              <button
                onClick={() => onOpenLlmSettings ? onOpenLlmSettings() : setShowLlmSettings(s => !s)}
                className={`p-1.5 rounded-r-md bg-neutral-900 hover:bg-neutral-800 text-xs transition-colors border-y border-r border-neutral-800 ${
                  llmConfig.geminiApiKey ? 'text-emerald-400 hover:text-emerald-300' : 'text-neutral-400 hover:text-white'
                }`}
                title="AI Proofreading Settings (⚙) — Select AI engine, configure keys, or switch to offline rules"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>

            {Boolean(llmConfig.geminiApiKey) && (
              <span
                className="hidden lg:inline-flex items-center gap-0.5 px-1 py-0.2 text-[9px] font-mono text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 rounded"
                title="Personal Gemini Token Active (Saved in Cookie)"
              >
                <Key className="w-2.5 h-2.5" />
                <span>My Key</span>
              </span>
            )}

            {llmConfig.isGeminiQuotaExhausted && (
              <span
                className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono text-amber-300 bg-amber-950/80 border border-amber-700/60 rounded"
                title="Gemini quota limit reached or payment required. Offline Rule Cleaner is active."
              >
                Offline Rules
              </span>
            )}

            {/* LLM Settings Popover */}
            {showLlmSettings && (
              <div className="absolute bottom-full right-0 mb-2 w-84 sm:w-96 bg-neutral-900 border border-neutral-700 rounded-xl p-3.5 shadow-2xl z-50 text-xs space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                  <span className="font-semibold text-neutral-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    LLM Proofreading Settings
                  </span>
                  <button
                    onClick={() => setShowLlmSettings(false)}
                    className="text-neutral-400 hover:text-white text-sm"
                  >
                    ×
                  </button>
                </div>

                {/* Provider Selector */}
                <div>
                  <label className="text-[11px] font-medium text-neutral-400 block mb-1">
                    AI Engine / Provider:
                  </label>
                  <select
                    value={llmConfig.provider}
                    onChange={(e) =>
                      onChangeLlmConfig({
                        ...llmConfig,
                        provider: e.target.value as LlmProvider,
                      })
                    }
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-md p-1.5 text-neutral-200 text-xs focus:border-amber-500 focus:outline-none"
                  >
                    <option value="gemini">Google Gemini 2.5 Flash (Personal Token / Cloud)</option>
                    <option value="auto">Auto (Local Ollama / Cloud Fallback)</option>
                    <option value="ollama">Local Ollama (Web API)</option>
                    <option value="openai">Local OpenAI-compatible (LM Studio / vLLM)</option>
                    <option value="rules">Offline Rule Cleaner (Instant Regex)</option>
                  </select>
                </div>

                {/* Gemini Personal Token Section */}
                <div className="space-y-2 bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-neutral-200 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-amber-400" />
                      Gemini Account Token / API Key
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] bg-amber-950/60 text-amber-300 border border-amber-800/60 font-medium">
                      <Cookie className="w-3 h-3 text-amber-400" />
                      Saved in Cookie
                    </span>
                  </div>

                  <p className="text-[10px] text-neutral-400 leading-normal">
                    Enter your Google Gemini subscription / API key to use your own account quota instead of the general key:
                  </p>

                  <div className="relative flex items-center">
                    <input
                      type={showGeminiTokenPassword ? 'text' : 'password'}
                      value={llmConfig.geminiApiKey || ''}
                      onChange={(e) =>
                        onChangeLlmConfig({
                          ...llmConfig,
                          geminiApiKey: e.target.value.trim(),
                        })
                      }
                      placeholder="AIzaSy... (leave blank for general key)"
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1.5 pr-16 text-xs text-neutral-200 font-mono focus:border-amber-500 focus:outline-none placeholder:text-neutral-600"
                    />
                    <div className="absolute right-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowGeminiTokenPassword((s) => !s)}
                        className="p-1 text-neutral-400 hover:text-neutral-200 transition-colors"
                        title={showGeminiTokenPassword ? 'Hide token' : 'Reveal token'}
                      >
                        {showGeminiTokenPassword ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {Boolean(llmConfig.geminiApiKey) && (
                        <button
                          type="button"
                          onClick={() =>
                            onChangeLlmConfig({
                              ...llmConfig,
                              geminiApiKey: '',
                            })
                          }
                          className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
                          title="Clear saved token and return to general key"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] pt-0.5">
                    {llmConfig.geminiApiKey ? (
                      <span className="text-emerald-400 font-medium flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        Personal subscription key active in cookie
                      </span>
                    ) : (
                      <span className="text-neutral-500">
                        No custom key set · Using default fallback
                      </span>
                    )}
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-400 hover:underline inline-flex items-center gap-0.5"
                    >
                      Get Gemini key ↗
                    </a>
                  </div>
                </div>

                {/* Local Ollama Details */}
                {(llmConfig.provider === 'ollama' || llmConfig.provider === 'auto') && (
                  <div className="space-y-2 bg-neutral-950/60 p-2.5 rounded-lg border border-neutral-800/80">
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-neutral-400">Ollama Host URL</span>
                        <div className="flex items-center gap-1 font-mono text-[9px]">
                          <button
                            type="button"
                            onClick={() => onChangeLlmConfig({ ...llmConfig, ollamaHost: 'http://localhost:11434' })}
                            className="text-amber-400 hover:underline"
                          >
                            localhost
                          </button>
                          <span className="text-neutral-600">·</span>
                          <button
                            type="button"
                            onClick={() => onChangeLlmConfig({ ...llmConfig, ollamaHost: 'http://127.0.0.1:11434' })}
                            className="text-amber-400 hover:underline"
                          >
                            127.0.0.1
                          </button>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={llmConfig.ollamaHost}
                        onChange={(e) =>
                          onChangeLlmConfig({ ...llmConfig, ollamaHost: e.target.value })
                        }
                        placeholder="http://localhost:11434"
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-200 font-mono"
                      />
                      <p className="text-[9.5px] text-neutral-500 mt-1 leading-normal">
                        Ollama web access requires: <code className="text-neutral-300">OLLAMA_ORIGINS="*" ollama serve</code>
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-neutral-400 block mb-0.5">Model Name</span>
                      <input
                        type="text"
                        value={llmConfig.ollamaModel}
                        onChange={(e) =>
                          onChangeLlmConfig({ ...llmConfig, ollamaModel: e.target.value })
                        }
                        placeholder="qwen3.5:9b-q4_K_M"
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-200 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Local OpenAI Details */}
                {llmConfig.provider === 'openai' && (
                  <div className="space-y-2 bg-neutral-950/60 p-2.5 rounded-lg border border-neutral-800/80">
                    <div>
                      <span className="text-[10px] text-neutral-400 block mb-0.5">Endpoint URL</span>
                      <input
                        type="text"
                        value={llmConfig.openaiHost}
                        onChange={(e) =>
                          onChangeLlmConfig({ ...llmConfig, openaiHost: e.target.value })
                        }
                        placeholder="http://127.0.0.1:1234/v1"
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-200 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-neutral-400 block mb-0.5">Model</span>
                      <input
                        type="text"
                        value={llmConfig.openaiModel}
                        onChange={(e) =>
                          onChangeLlmConfig({ ...llmConfig, openaiModel: e.target.value })
                        }
                        placeholder="local-model"
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-200 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Auto-proofread on OCR Checkbox */}
                <div className="pt-1 pb-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={llmConfig.autoProofread}
                      onChange={(e) =>
                        onChangeLlmConfig({
                          ...llmConfig,
                          autoProofread: e.target.checked,
                        })
                      }
                      className="rounded bg-neutral-950 border-neutral-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-neutral-900 w-3.5 h-3.5"
                    />
                    <span className="text-neutral-300 font-medium text-[11px]">
                      Auto-proofread on OCR / initial scan
                    </span>
                  </label>
                </div>

                {/* Test Connection Button */}
                <div className="pt-1">
                  <button
                    onClick={handleTestLlm}
                    disabled={isTestingLlm}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isTestingLlm ? 'animate-spin' : ''}`} />
                    <span>
                      {isTestingLlm
                        ? 'Testing Engine...'
                        : llmConfig.provider === 'gemini'
                        ? 'Test Gemini Token & Connection'
                        : 'Test Connection'}
                    </span>
                  </button>

                  {testResult && (
                    <div
                      className={`mt-2 p-2 rounded text-[11px] flex items-start gap-1.5 ${
                        testResult.ok
                          ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                          : 'bg-red-950/80 border border-red-800 text-red-300'
                      }`}
                    >
                      {testResult.ok ? (
                        <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      )}
                      <span>{testResult.message}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Zen Reading Mode Toggle */}
          {onToggleReadingMode && (
            <button
              onClick={onToggleReadingMode}
              className={`p-1.5 rounded-md border text-xs font-medium transition-colors shrink-0 ${
                isReadingMode
                  ? 'bg-amber-500 text-neutral-950 border-amber-400'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
              }`}
              title={
                isReadingMode
                  ? 'Exit Zen Reading Mode (Zen) [Key: F]'
                  : 'Zen Reading Mode (Zen) — Free screen space with floating translucent audio bar [Key: F]'
              }
            >
              {isReadingMode ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5 text-amber-400" />}
            </button>
          )}

          {/* Text Inspector & Export Modal */}
          {onOpenInspector && (
            <button
              onClick={onOpenInspector}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 text-xs font-semibold transition-colors shrink-0 hover:border-amber-500/50"
              title="Inspect OCR text, continue links, ad scores, and export"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}

          {/* Save Article */}
          <button
            onClick={onSaveArticle}
            className="hidden lg:flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 text-xs font-medium transition-colors shrink-0"
            title="Save Article (Art) — Export formatted text of current article/ad [Key: Ctrl+Shift+S]"
          >
            <FileText className="w-3.5 h-3.5 text-neutral-400" />
            <span>Art</span>
          </button>

          {/* Save All OCR */}
          <button
            onClick={onSaveAllOcr}
            className="hidden lg:flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 text-xs font-medium transition-colors shrink-0"
            title="Save Full Document OCR (Save) — Export complete text transcript (.ocr.txt) [Key: Ctrl+S]"
          >
            <Download className="w-3.5 h-3.5 text-neutral-400" />
            <span>Save</span>
          </button>

          {/* Display & View Controls Dialog Button */}
          {onOpenDisplayControls && (
            <button
              onClick={onOpenDisplayControls}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 text-xs font-semibold shadow-sm transition-colors shrink-0 hover:border-amber-500/50"
              title="Display & View Controls (Controls) — Open 2D settings for view modes, zoom, fit, highlights, and speech rate [Key: D]"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Controls</span>
            </button>
          )}

          {/* Shortcuts & Symbols Help */}
          <button
            onClick={onOpenShortcuts}
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors shrink-0"
            title="Keyboard Shortcuts & Symbols Guide (?) — View full cheat-sheet and icon explanations"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
