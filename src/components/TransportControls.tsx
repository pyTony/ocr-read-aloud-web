import React, { useState } from 'react';
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
  Download,
  Volume2,
  Sliders,
  HelpCircle,
  Settings,
  CheckCircle,
  AlertCircle,
  RefreshCw,
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
  isProofreading: boolean;
  llmConfig: LlmConfig;
  onChangeLlmConfig: (cfg: LlmConfig) => void;
  onSaveArticle: () => void;
  onSaveAllOcr: () => void;
  onOpenShortcuts: () => void;
  // Voices & Speed
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string | null;
  onSelectVoice: (voiceURI: string) => void;
  speechRate: number;
  onChangeSpeechRate: (rate: number) => void;
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
  continueJump,
  targetContinueFolio,
  continuedFromFolio,
  onContinueAction,
  adJump,
  canJumpToAd,
  onAdAction,
  onProofread,
  isProofreading,
  llmConfig,
  onChangeLlmConfig,
  onSaveArticle,
  onSaveAllOcr,
  onOpenShortcuts,
  voices,
  selectedVoiceURI,
  onSelectVoice,
  speechRate,
  onChangeSpeechRate,
}) => {
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTestLlm = async () => {
    setIsTestingLlm(true);
    setTestResult(null);

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
      // 'no-cors' mode fetch allows pinging if http://localhost:11434 is listening without throwing CORS network errors
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
        message: `Ollama is active and running on your computer (${cleanHost}/ responded!), but the browser was blocked by Ollama's default CORS security. Fix: start Ollama with browser access enabled by running 'OLLAMA_ORIGINS="*" ollama serve' (or set OLLAMA_ORIGINS=* in your system environment variables for the GUI app), then click Test again. Or choose 'Google Gemini 2.5 Flash' for instant cloud proofreading.`,
      });
    } else {
      setTestResult({
        ok: false,
        message: `Could not connect to ${cleanHost}. Ensure Ollama is running on your computer with browser access: 'OLLAMA_ORIGINS="*" ollama serve', or try host 'http://localhost:11434', or switch engine to Google Gemini 2.5 Flash.`,
      });
    }

    setIsTestingLlm(false);
  };

  return (
    <div className="bg-neutral-950 border-t border-neutral-800 p-3 shadow-lg">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Core Transport Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Stop */}
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold transition-colors"
            title="Stop playback (Esc)"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>

          {/* Play / Pause */}
          <button
            onClick={onTogglePlay}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-all shadow-sm ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
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
              title="Previous Sentence (Left Arrow)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Rew</span>
            </button>
            <div className="h-4 w-px bg-neutral-800" />
            <button
              onClick={onNextSentence}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Next Sentence (Right Arrow)"
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
              title="Previous Paragraph (Up Arrow / Shift+Tab)"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-neutral-400">Para</span>
            <button
              onClick={onNextChunk}
              className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Next Paragraph (Down Arrow / Tab)"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* PgUp / PgDn */}
          <div className="flex items-center rounded-md bg-neutral-900 border border-neutral-800 p-0.5">
            <button
              onClick={onPrevPage}
              className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Previous Page (PageUp)"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
              <span>PgUp</span>
            </button>
            <div className="h-4 w-px bg-neutral-800" />
            <button
              onClick={onNextPage}
              className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Next Page (PageDown)"
            >
              <span>PgDn</span>
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Magazine Special Controls & Tools */}
        <div className="flex items-center gap-2 flex-wrap">
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
                  ? 'Return to origin sentence/page (c / Ctrl+J)'
                  : continuedFromFolio
                  ? `Return to previous sentence on page ${continuedFromFolio} (c / Ctrl+J)`
                  : `Jump to Continued on page ${targetContinueFolio} (c / Ctrl+J)`
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
              title={adJump ? 'Return to article (a)' : 'Visit skipped ad insert (a)'}
            >
              {adJump ? <span>Art→</span> : <span>Ad←</span>}
            </button>
          )}

          {/* Voice / Audio Settings Button */}
          <div className="relative">
            <button
              onClick={() => setShowVoiceSettings(!showVoiceSettings)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                showVoiceSettings
                  ? 'bg-neutral-800 border-neutral-600 text-white'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
              }`}
              title="Voice & Speed Settings"
            >
              <Volume2 className="w-3.5 h-3.5 text-neutral-400" />
              <span>Voice</span>
              <span className="text-[10px] text-neutral-400 font-mono">({speechRate}x)</span>
            </button>

            {/* Voice Dropdown Popover */}
            {showVoiceSettings && (
              <div className="absolute bottom-full right-0 mb-2 w-72 bg-neutral-900 border border-neutral-700 rounded-lg p-3 shadow-2xl z-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-amber-400" />
                    Speech Configuration
                  </span>
                  <button
                    onClick={() => setShowVoiceSettings(false)}
                    className="text-neutral-400 hover:text-white text-xs"
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
                      <span className="font-mono text-amber-400">{speechRate.toFixed(2)}x</span>
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
                    <div className="flex justify-between text-[10px] text-neutral-500 font-mono mt-0.5">
                      <span>0.6x</span>
                      <span>1.0x (Normal)</span>
                      <span>2.0x</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Proofread & Local LLM Group */}
          <div className="relative flex items-center">
            <button
              onClick={onProofread}
              disabled={isProofreading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 text-xs font-semibold transition-colors disabled:opacity-50"
              title={`Proofread page with ${llmConfig.provider.toUpperCase()} AI`}
            >
              <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isProofreading ? 'animate-spin' : ''}`} />
              <span>{isProofreading ? 'Proofing...' : 'Proof'}</span>
            </button>
            <button
              onClick={() => setShowLlmSettings(s => !s)}
              className="p-1.5 rounded-r-md bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border-y border-r border-neutral-800 text-xs transition-colors"
              title="LLM Settings & Provider (Local Ollama / OpenAI / Gemini)"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>

            {/* LLM Settings Popover */}
            {showLlmSettings && (
              <div className="absolute bottom-full right-0 mb-2 w-80 bg-neutral-900 border border-neutral-700 rounded-xl p-3.5 shadow-2xl z-50 text-xs space-y-3">
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
                    <option value="auto">Auto (Local Ollama / Cloud Fallback)</option>
                    <option value="ollama">Local Ollama (Web API)</option>
                    <option value="openai">Local OpenAI-compatible (LM Studio / vLLM)</option>
                    <option value="gemini">Google Gemini 3.6 Flash</option>
                    <option value="rules">Offline Rule Cleaner (Instant Regex)</option>
                  </select>
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

                {/* Test Connection Button */}
                <div className="pt-1">
                  <button
                    onClick={handleTestLlm}
                    disabled={isTestingLlm}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isTestingLlm ? 'animate-spin' : ''}`} />
                    <span>{isTestingLlm ? 'Testing...' : 'Test Connection'}</span>
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

          {/* Save Article */}
          <button
            onClick={onSaveArticle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 text-xs font-medium transition-colors"
            title="Save current article / ad text (Ctrl+Shift+S)"
          >
            <FileText className="w-3.5 h-3.5 text-neutral-400" />
            <span>Art</span>
          </button>

          {/* Save All OCR */}
          <button
            onClick={onSaveAllOcr}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 text-xs font-medium transition-colors"
            title="Save full document as .ocr.txt (Ctrl+S)"
          >
            <Download className="w-3.5 h-3.5 text-neutral-400" />
            <span>Save</span>
          </button>

          {/* Shortcuts Help */}
          <button
            onClick={onOpenShortcuts}
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title="Keyboard shortcuts (?)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
