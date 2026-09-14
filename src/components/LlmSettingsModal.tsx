import React, { useState, useEffect } from 'react';
import { X, Sparkles, Server, Key, Cpu, Check, AlertCircle, RefreshCw, Zap, Shield, Terminal, Copy, CheckCheck, AlertTriangle } from 'lucide-react';
import { LlmConfig } from '../types';
import { saveGeminiToken } from '../lib/geminiTokenStorage';

interface LlmSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  llmConfig: LlmConfig;
  onChangeLlmConfig: (newConfig: LlmConfig) => void;
}

export const LlmSettingsModal: React.FC<LlmSettingsModalProps> = ({
  isOpen,
  onClose,
  llmConfig,
  onChangeLlmConfig,
}) => {
  const [config, setConfig] = useState<LlmConfig>(llmConfig);
  const [testStatus, setTestStatus] = useState<{
    testing?: boolean;
    success?: boolean;
    message?: string;
    quotaExhausted?: boolean;
  }>({});
  const [copiedScript, setCopiedScript] = useState(false);
  const [showLocalGuide, setShowLocalGuide] = useState(false);

  // Sync state when opened
  useEffect(() => {
    if (isOpen) {
      setConfig(llmConfig);
      setTestStatus({});
    }
  }, [isOpen, llmConfig]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (config.geminiApiKey) {
      saveGeminiToken(config.geminiApiKey);
    } else {
      saveGeminiToken('');
    }
    onChangeLlmConfig(config);
    onClose();
  };

  const handleCopyLocalCommand = () => {
    navigator.clipboard.writeText('npm install && npm run dev');
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  const handleTestConnection = async () => {
    setTestStatus({ testing: true });
    try {
      if (config.provider === 'rules') {
        setTestStatus({
          testing: false,
          success: true,
          message: 'Offline Rule Cleaner is 100% active and ready. Instant execution with zero API tokens or costs.',
        });
        return;
      }

      if (config.provider === 'gemini') {
        const res = await fetch('/api/llm-test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.geminiApiKey ? { 'x-gemini-api-key': config.geminiApiKey } : {}),
          },
          body: JSON.stringify({
            provider: 'gemini',
            geminiApiKey: config.geminiApiKey,
          }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          setTestStatus({
            testing: false,
            success: true,
            quotaExhausted: false,
            message: data.message || 'Gemini connected successfully!',
          });
          setConfig(prev => ({ ...prev, isGeminiQuotaExhausted: false }));
        } else {
          const isQuota = data.quotaExhausted || res.status === 429;
          setTestStatus({
            testing: false,
            success: false,
            quotaExhausted: isQuota,
            message: isQuota
              ? 'Google Gemini quota is depleted or payment is required for extra usage. Switched to Offline Rules (free & instant).'
              : (data.message || data.error || 'Gemini verification failed. Check your API key or quota.'),
          });
          if (isQuota) {
            setConfig(prev => ({ ...prev, isGeminiQuotaExhausted: true }));
          }
        }
        return;
      }

      // Local Ollama or OpenAI test
      const res = await fetch('/api/llm-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: config.provider,
          host: config.provider === 'ollama' ? config.ollamaHost : config.openaiHost,
          model: config.provider === 'ollama' ? config.ollamaModel : config.openaiModel,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setTestStatus({
          testing: false,
          success: true,
          message: data.message || `Successfully connected to ${config.provider}!`,
        });
      } else {
        setTestStatus({
          testing: false,
          success: false,
          message: data.message || data.error || `Could not connect to ${config.provider} at specified host.`,
        });
      }
    } catch (err: any) {
      setTestStatus({
        testing: false,
        success: false,
        message: `Connection test error: ${err.message || 'Network unreachable'}`,
      });
    }
  };

  const isGeminiDepleted = Boolean(config.isGeminiQuotaExhausted && !config.geminiApiKey);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh] text-neutral-100 font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 bg-neutral-950/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-neutral-100">AI Proofreading &amp; Engine Settings</h2>
              <p className="text-xs text-neutral-400">
                Configure proofreading engines, local Ollama, or run offline with zero costs
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Quota alert banner if depleted */}
          {isGeminiDepleted && (
            <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-600/60 text-xs text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-300">Gemini Cloud Quota Depleted (No extra payment needed)</div>
                <div className="text-[11px] text-neutral-300 mt-0.5 leading-relaxed">
                  You are not required to pay for extra API credits. The app automatically uses the built-in <strong>Offline Rule Cleaner</strong> (instant &amp; zero-cost), or you can run <strong>Ollama</strong> locally on your PC.
                </div>
              </div>
            </div>
          )}

          {/* Provider Selection Tabs */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-neutral-400 mb-2">
              Select AI / Cleanup Provider
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {/* Gemini Button (Grayed out if quota depleted and no key) */}
              <button
                type="button"
                onClick={() => setConfig({ ...config, provider: 'gemini' })}
                className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all cursor-pointer relative ${
                  config.provider === 'gemini'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 ring-1 ring-amber-500'
                    : isGeminiDepleted
                    ? 'bg-neutral-950/70 border-neutral-800/80 text-neutral-400 opacity-75 hover:opacity-100 hover:border-neutral-700'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Sparkles className={`w-4 h-4 ${isGeminiDepleted ? 'text-amber-500/60' : 'text-amber-400'}`} />
                  {config.provider === 'gemini' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                </div>
                <span className="font-bold text-xs flex items-center gap-1">
                  Gemini AI
                </span>
                <span className="text-[10px] text-neutral-400">
                  {isGeminiDepleted ? (
                    <span className="text-amber-400/90 font-medium">No Quota</span>
                  ) : (
                    'Cloud AI Studio'
                  )}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setConfig({ ...config, provider: 'rules' })}
                className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                  config.provider === 'rules'
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  {config.provider === 'rules' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
                <span className="font-bold text-xs">Offline Rules</span>
                <span className="text-[10px] text-emerald-400/90 font-medium">Instant / Free</span>
              </button>

              <button
                type="button"
                onClick={() => setConfig({ ...config, provider: 'ollama' })}
                className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                  config.provider === 'ollama'
                    ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300 ring-1 ring-indigo-500'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  {config.provider === 'ollama' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </div>
                <span className="font-bold text-xs">Ollama LLM</span>
                <span className="text-[10px] text-neutral-400">Local PC (Free)</span>
              </button>

              <button
                type="button"
                onClick={() => setConfig({ ...config, provider: 'openai' })}
                className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                  config.provider === 'openai'
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 ring-1 ring-cyan-500'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Server className="w-4 h-4 text-cyan-400" />
                  {config.provider === 'openai' && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                </div>
                <span className="font-bold text-xs">LM Studio</span>
                <span className="text-[10px] text-neutral-400">OpenAI format</span>
              </button>
            </div>
          </div>

          {/* Gemini Specific Configuration */}
          {config.provider === 'gemini' && (
            <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-xs text-neutral-200">Personal Gemini API Key (Optional)</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                  Stored Locally
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                If the server quota is exhausted, you can paste your own free Gemini API key from <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="text-amber-400 underline hover:text-amber-300">aistudio.google.com</a>, or simply switch to <strong>Offline Rules</strong>.
              </p>
              <div className="relative">
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={config.geminiApiKey || ''}
                  onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value.trim() })}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono text-amber-200 placeholder-neutral-600 focus:outline-none focus:border-amber-500"
                />
              </div>
              {config.geminiApiKey && (
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, geminiApiKey: '' })}
                  className="text-[11px] text-red-400 hover:text-red-300 underline cursor-pointer"
                >
                  Clear Saved Key
                </button>
              )}
            </div>
          )}

          {/* Offline Rules Provider Details */}
          {config.provider === 'rules' && (
            <div className="p-4 rounded-xl bg-neutral-950 border border-emerald-900/40 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <Shield className="w-4 h-4" />
                <span>Deterministic Regex &amp; Dehyphenation Engine (100% Free)</span>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Runs 100% locally in your browser and local server. Recombines broken hyphenated line wraps (e.g. <code className="text-amber-300">micro- processor → microprocessor</code>), fixes OCR intra-word spaces (e.g. <code className="text-amber-300">syn thesi zer → synthesizer</code>), and standardizes punctuation. Instant execution with zero token cost.
              </p>
            </div>
          )}

          {/* Ollama Specific Configuration */}
          {config.provider === 'ollama' && (
            <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  Ollama Host URL
                </label>
                <input
                  type="text"
                  value={config.ollamaHost}
                  onChange={(e) => setConfig({ ...config, ollamaHost: e.target.value })}
                  placeholder="http://127.0.0.1:11434"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  Model Name
                </label>
                <input
                  type="text"
                  value={config.ollamaModel}
                  onChange={(e) => setConfig({ ...config, ollamaModel: e.target.value })}
                  placeholder="qwen2.5:7b, llama3.2, mistral"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {/* OpenAI-compatible Configuration */}
          {config.provider === 'openai' && (
            <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  LM Studio / LocalAI Host URL
                </label>
                <input
                  type="text"
                  value={config.openaiHost}
                  onChange={(e) => setConfig({ ...config, openaiHost: e.target.value })}
                  placeholder="http://127.0.0.1:1234/v1"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  Model Identifier
                </label>
                <input
                  type="text"
                  value={config.openaiModel}
                  onChange={(e) => setConfig({ ...config, openaiModel: e.target.value })}
                  placeholder="local-model"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {/* Local Machine Testing Script Guide (Expandable) */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowLocalGuide(s => !s)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-neutral-300 hover:text-white hover:bg-neutral-900 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-amber-400" />
                <span>Run 100% Free on Your Own Computer (No Cloud Fees)</span>
              </div>
              <span className="text-[11px] text-amber-400 underline">{showLocalGuide ? 'Hide' : 'Show script'}</span>
            </button>
            {showLocalGuide && (
              <div className="p-4 pt-2 border-t border-neutral-800 space-y-2.5 text-xs text-neutral-300">
                <p className="text-[11px] text-neutral-400">
                  You can download and run this app locally on Linux, macOS, or Windows with unlimited usage:
                </p>
                <div className="bg-neutral-900 rounded-lg p-2.5 font-mono text-[11px] text-amber-300 flex items-center justify-between border border-neutral-800">
                  <code>npm install &amp;&amp; npm run dev</code>
                  <button
                    type="button"
                    onClick={handleCopyLocalCommand}
                    className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 flex items-center gap-1 text-[10px] cursor-pointer"
                    title="Copy command to clipboard"
                  >
                    {copiedScript ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedScript ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="text-[10px] text-neutral-400 space-y-1">
                  <div>• Included scripts: <code className="text-neutral-200">./install-local.sh</code> (Linux/Mac) or <code className="text-neutral-200">run-local.bat</code> (Windows)</div>
                  <div>• Full guide included in <code className="text-neutral-200">LOCAL-INSTALL.md</code> file in the project.</div>
                </div>
              </div>
            )}
          </div>

          {/* Auto-proofread switch */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-950 border border-neutral-800">
            <div>
              <div className="font-semibold text-xs text-neutral-200">
                Auto-Proofread upon Document Upload
              </div>
              <div className="text-[11px] text-neutral-400">
                Automatically clean and dehyphenate pages when a new file is loaded
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.autoProofread}
              onChange={(e) => setConfig({ ...config, autoProofread: e.target.checked })}
              className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
            />
          </div>

          {/* Test connection status message */}
          {testStatus.message && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                testStatus.success
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                  : 'bg-red-950/40 border-red-800 text-red-300'
              }`}
            >
              {testStatus.success ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{testStatus.message}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testStatus.testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium border border-neutral-700 transition-colors cursor-pointer"
          >
            {testStatus.testing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>{testStatus.testing ? 'Testing...' : 'Test Connection'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold transition-all shadow-md cursor-pointer"
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
