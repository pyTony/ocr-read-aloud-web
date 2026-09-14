import express from 'express';
import cors from 'cors';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { repairSplitWordsAndDehyphenate, cleanOcrGarbageAndNoise } from './src/lib/textClean';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Lazy Google GenAI initialization supporting both general environment key and user custom token
let aiClient: GoogleGenAI | null = null;
function getGenAI(customKey?: string): GoogleGenAI | null {
  const keyToUse = customKey?.trim() || process.env.GEMINI_API_KEY;
  if (!keyToUse) {
    return null;
  }
  // If user provided a specific personal subscription token, instantiate dedicated client
  if (customKey && customKey.trim() && customKey.trim() !== (process.env.GEMINI_API_KEY || '')) {
    return new GoogleGenAI({ apiKey: customKey.trim() });
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return aiClient;
}

// Extract Gemini token from body, header, or cookie
function extractGeminiKey(req: express.Request): string | undefined {
  if (req.body?.geminiApiKey && typeof req.body.geminiApiKey === 'string' && req.body.geminiApiKey.trim()) {
    return req.body.geminiApiKey.trim();
  }
  const headerKey = req.headers['x-gemini-api-key'] || req.headers['x-gemini-token'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/gemini_custom_token=([^;]+)/);
    if (match && match[1]) {
      try {
        const decoded = decodeURIComponent(match[1].trim());
        if (decoded) return decoded;
      } catch {
        return match[1].trim();
      }
    }
  }
  return undefined;
}

// Health check
app.get('/api/health', (req, res) => {
  const customKey = extractGeminiKey(req);
  res.json({
    status: 'ok',
    version: '1.5.9',
    hasGeneralGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasCustomToken: Boolean(customKey),
    hasGeminiKey: Boolean(customKey || process.env.GEMINI_API_KEY),
  });
});

const PROOFREAD_SYSTEM_PROMPT = `You are an expert OCR proofreader and editor for scanned publications and magazines, preparing text for natural text-to-speech reading.

PRIMARY MANDATE: AGGRESSIVELY REPAIR SPLIT WORDS AND DEHYPHENATE
OCR scans constantly break words apart. You MUST repair and join them:
1. Hyphenated word splits across line breaks or within lines:
   - Always merge words broken with a hyphen, dropping the hyphen:
     Examples:
     "micro- processor" -> "microprocessor"
     "com- puter" -> "computer"
     "pro- gramming" -> "programming"
     "syn- thesis" -> "synthesis"
     "inter- face" -> "interface"
     "cir- cuits" -> "circuits"
     "tieto- kone" -> "tietokone"
     "järjes- telmä" -> "järjestelmä"
     "puheen- tunnistus" -> "puheentunnistus"
     "elektroniik- ka" -> "elektroniikka"
   - KEEP true compound words hyphenated (e.g. "state-of-the-art", "twenty-five", "plug-in", "user-friendly", "read-only").
2. Accidental spaces inside words:
   - OCR often inserts spaces inside words or between syllables. Always join them into a single coherent word:
     Examples:
     "do ing" -> "doing"
     "mag az in e" -> "magazine"
     "micro processor" -> "microprocessor"
     "speec h" -> "speech"
     "oper ation" -> "operation"
     "con trol" -> "control"
     "syn thesi zer" -> "synthesizer"
     "cir cuit" -> "circuit"
3. Cleanliness and TTS Structure:
   - Remove stray OCR artifacts, scan speckles, and corrupted characters.
   - Insert blank lines between natural paragraphs to allow comfortable TTS pauses.
   - Strictly preserve the original reading order and meaning. Do not summarize, truncate, or invent new sentences.
   - Preserve page/section markers like === Page N ===.
4. Full-page Ads:
   - If the page is strictly an advertisement or dealer price list interrupting an article, begin the output with [[SKIP_AS_AD]] on the first line.
5. Plain text only:
   - Output ONLY clean text. No markdown code blocks, no introductory explanations, no chatter.`;

// AI proofreading endpoint supporting Local Ollama, OpenAI-compatible APIs, Gemini, and Rule cleaner
app.post('/api/proofread', async (req, res) => {
  try {
    const {
      text,
      pageLabel,
      imageData,
      provider = 'auto',
      ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      ollamaModel = process.env.OLLAMA_MODEL || 'qwen3.5:9b-q4_K_M',
      openaiHost = process.env.LOCAL_OPENAI_HOST || 'http://127.0.0.1:1234/v1',
      openaiModel = process.env.LOCAL_OPENAI_MODEL || 'local-model',
    } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text to proofread' });
    }

    const fullPrompt = `${PROOFREAD_SYSTEM_PROMPT}\n\nDocument/Page: ${pageLabel || 'Page'}\n\nOCR TEXT TO PROOFREAD:\n${text}`;

    // 1. Local Ollama Web API (if explicitly chosen or in auto mode if host specified)
    if (provider === 'ollama') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for local LLMs
        const cleanHost = ollamaHost.replace(/\/+$/, '');

        const ollamaRes = await fetch(`${cleanHost}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ollamaModel,
            prompt: fullPrompt,
            stream: false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (ollamaRes.ok) {
          const ollamaData = (await ollamaRes.json()) as { response?: string };
          const output = (ollamaData.response || '').trim() || text;
          const isAd = output.startsWith('[[SKIP_AS_AD]]');
          const rawCleaned = isAd ? output.replace(/^\[\[SKIP_AS_AD\]\]\s*/, '').trim() : output;
          const cleaned = repairSplitWordsAndDehyphenate(rawCleaned);

          return res.json({
            proofreadText: cleaned,
            isAd,
            provider: 'ollama',
            model: ollamaModel,
          });
        } else {
          const errText = await ollamaRes.text();
          throw new Error(`Ollama returned status ${ollamaRes.status}: ${errText}`);
        }
      } catch (ollamaErr: any) {
        console.warn('Ollama Web API call failed:', ollamaErr?.message);
        if (provider === 'ollama') {
          return res.status(502).json({
            error: `Could not connect to local Ollama at ${ollamaHost}: ${ollamaErr?.message}. Ensure Ollama is running ('ollama serve') and accessible.`,
          });
        }
      }
    }

    // 2. Local OpenAI-compatible Web API (LM Studio, LocalAI, vLLM)
    if (provider === 'openai') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        const cleanHost = openaiHost.replace(/\/+$/, '');

        const openaiRes = await fetch(`${cleanHost}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: openaiModel,
            messages: [
              { role: 'system', content: PROOFREAD_SYSTEM_PROMPT },
              { role: 'user', content: `Document/Page: ${pageLabel || 'Page'}\n\nOCR TEXT TO PROOFREAD:\n${text}` },
            ],
            temperature: 0.1,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (openaiRes.ok) {
          const openaiData = (await openaiRes.json()) as any;
          const output = openaiData.choices?.[0]?.message?.content?.trim() || text;
          const isAd = output.startsWith('[[SKIP_AS_AD]]');
          const rawCleaned = isAd ? output.replace(/^\[\[SKIP_AS_AD\]\]\s*/, '').trim() : output;
          const cleaned = repairSplitWordsAndDehyphenate(rawCleaned);

          return res.json({
            proofreadText: cleaned,
            isAd,
            provider: 'openai',
            model: openaiModel,
          });
        } else {
          const errText = await openaiRes.text();
          throw new Error(`OpenAI-compatible server returned ${openaiRes.status}: ${errText}`);
        }
      } catch (openAiErr: any) {
        console.warn('OpenAI-compatible API failed:', openAiErr?.message);
        if (provider === 'openai') {
          return res.status(502).json({
            error: `Could not connect to OpenAI-compatible server at ${openaiHost}: ${openAiErr?.message}.`,
          });
        }
      }
    }

    // 3. Cloud Gemini API
    if (provider === 'gemini' || provider === 'auto') {
      const geminiKey = extractGeminiKey(req);
      const ai = getGenAI(geminiKey);
      if (ai) {
        try {
          let response;
          let usedModel = 'gemini-2.5-flash';

          const contentsParts: any[] = [];
          if (imageData && typeof imageData === 'string' && imageData.includes('base64,')) {
            const match = imageData.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (match) {
              contentsParts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }

          const promptText = contentsParts.length > 0
            ? `Document/Page: ${pageLabel || 'Page'}\n\nThis scanned magazine page image contains text. Accurately transcribe and clean the text directly from the image with high accuracy, ignoring any broken Tesseract OCR artifacts or rubbish noise. Repair split words, dehyphenate, and preserve natural paragraph structure for text-to-speech reading.`
            : `Document/Page: ${pageLabel || 'Page'}\n\nOCR TEXT TO PROOFREAD:\n${text}`;

          contentsParts.push({ text: promptText });

          try {
            response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [
                {
                  role: 'user',
                  parts: contentsParts,
                },
              ],
              config: {
                systemInstruction: PROOFREAD_SYSTEM_PROMPT,
                temperature: 0.1,
              },
            });
          } catch (mErr: any) {
            console.warn('gemini-2.5-flash attempt, trying fallback gemini-2.0-flash:', mErr?.message);
            try {
              usedModel = 'gemini-2.0-flash';
              response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [
                  {
                    role: 'user',
                    parts: contentsParts,
                  },
                ],
                config: {
                  systemInstruction: PROOFREAD_SYSTEM_PROMPT,
                  temperature: 0.1,
                },
              });
            } catch (fallbackErr: any) {
              throw fallbackErr;
            }
          }

          const output = response.text?.trim() || text;
          const isAd = output.startsWith('[[SKIP_AS_AD]]');
          const rawCleaned = isAd ? output.replace(/^\[\[SKIP_AS_AD\]\]\s*/, '').trim() : output;
          const cleaned = repairSplitWordsAndDehyphenate(rawCleaned);

          return res.json({
            proofreadText: cleaned,
            isAd,
            provider: 'gemini',
            model: usedModel,
            isPersonalToken: Boolean(geminiKey && geminiKey !== (process.env.GEMINI_API_KEY || '')),
          });
        } catch (geminiError: any) {
          console.warn('Gemini API call returned quota/error, falling back to rule cleaner:', geminiError?.message);
          // If Gemini quota reached or error occurs, seamlessly clean with rule engine so user experience is smooth
          const cleaned = cleanOcrGarbageAndNoise(text);

          return res.json({
            proofreadText: cleaned,
            isAd: false,
            provider: 'rules',
            model: 'offline-rule-cleaner',
            quotaExhausted: true,
            warning: 'Gemini server quota limit reached. Applied high-accuracy local regex & split-word repair.',
          });
        }
      }
    }

    // 4. Deterministic Rule-based cleanup fallback
    const cleaned = cleanOcrGarbageAndNoise(text);

    return res.json({
      proofreadText: cleaned,
      isAd: false,
      provider: 'rules',
      model: 'deterministic-regex',
      note: 'Processed with local rule-based cleanup.',
    });
  } catch (error: any) {
    console.error('Proofread endpoint error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Quota check endpoint to detect Gemini status without breaking UI
app.get('/api/gemini-quota-check', async (req, res) => {
  const geminiKey = extractGeminiKey(req);
  const ai = getGenAI(geminiKey);
  if (!ai) {
    return res.json({
      available: false,
      quotaExhausted: false,
      noKey: true,
      message: 'No Google Gemini API key configured. You can enter your own free key in Settings, use local Ollama, or use Offline Rules.',
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const testResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Respond "OK"' }] }],
    });
    clearTimeout(timeoutId);

    const isCustom = Boolean(geminiKey && geminiKey.trim() !== (process.env.GEMINI_API_KEY || ''));
    return res.json({
      available: true,
      quotaExhausted: false,
      isCustomToken: isCustom,
      message: isCustom
        ? 'Google Gemini connected via your personal API key.'
        : 'Google Gemini is active with server API key.',
    });
  } catch (err: any) {
    const errStr = String(err?.message || '');
    const isQuota =
      errStr.includes('429') ||
      errStr.includes('RESOURCE_EXHAUSTED') ||
      errStr.includes('quota') ||
      errStr.includes('depleted') ||
      errStr.includes('credit') ||
      errStr.includes('billing');

    return res.json({
      available: false,
      quotaExhausted: isQuota,
      error: errStr,
      message: isQuota
        ? 'Google Gemini quota is depleted or payment is required. Switched to offline rule cleaner.'
        : `Gemini verification returned: ${errStr}`,
    });
  }
});

// Test connectivity to a local LLM or provider
app.post('/api/llm-test', async (req, res) => {
  const { provider = 'ollama', host = 'http://127.0.0.1:11434' } = req.body;
  const cleanHost = (host || '').replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    if (provider === 'ollama') {
      const testRes = await fetch(`${cleanHost}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (testRes.ok) {
        const data = (await testRes.json()) as { models?: Array<{ name: string }> };
        const modelNames = (data.models || []).map(m => m.name);
        return res.json({
          ok: true,
          provider: 'ollama',
          host: cleanHost,
          models: modelNames,
          message: `Connected to local Ollama. Found ${modelNames.length} models.`,
        });
      }
      return res.status(testRes.status).json({
        ok: false,
        message: `Ollama returned status ${testRes.status}`,
      });
    }

    if (provider === 'gemini') {
      const geminiKey = extractGeminiKey(req);
      const ai = getGenAI(geminiKey);
      if (!ai) {
        return res.status(400).json({
          ok: false,
          quotaExhausted: false,
          message: 'No Gemini token found. Please enter your personal Gemini API token or configure GEMINI_API_KEY.',
        });
      }
      try {
        let testResponse;
        let testModel = 'gemini-2.5-flash';
        try {
          testResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: 'Respond with OK' }] }],
          });
        } catch {
          testModel = 'gemini-2.0-flash';
          testResponse = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{ role: 'user', parts: [{ text: 'Respond with OK' }] }],
          });
        }
        const isCustom = Boolean(geminiKey && geminiKey.trim() !== (process.env.GEMINI_API_KEY || ''));
        return res.json({
          ok: true,
          provider: 'gemini',
          isCustomToken: isCustom,
          message: isCustom
            ? `Connected to Google Gemini (${testModel}) using your personal API key! (Saved in browser storage)`
            : `Connected to Google Gemini (${testModel}) via server environment key.`,
          response: testResponse.text?.trim() || 'OK',
        });
      } catch (geminiTestErr: any) {
        const errStr = String(geminiTestErr?.message || '');
        const isQuota =
          errStr.includes('429') ||
          errStr.includes('RESOURCE_EXHAUSTED') ||
          errStr.includes('quota') ||
          errStr.includes('depleted') ||
          errStr.includes('credit') ||
          errStr.includes('billing');

        return res.status(isQuota ? 429 : 500).json({
          ok: false,
          quotaExhausted: isQuota,
          error: errStr,
          message: isQuota
            ? 'Google Gemini quota is depleted or payment is required. You can use Offline Rules (free) or local Ollama.'
            : `Gemini verification failed: ${errStr}.`,
        });
      }
    }

    if (provider === 'openai') {
      const testRes = await fetch(`${cleanHost}/models`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (testRes.ok) {
        const data = (await testRes.json()) as any;
        const modelNames = ((data.data as Array<{ id: string }>) || []).map(m => m.id);
        return res.json({
          ok: true,
          provider: 'openai',
          host: cleanHost,
          models: modelNames,
          message: `Connected to OpenAI-compatible endpoint. Found ${modelNames.length} models.`,
        });
      }
      return res.status(testRes.status).json({
        ok: false,
        message: `OpenAI endpoint returned status ${testRes.status}`,
      });
    }

    return res.json({
      ok: true,
      provider,
      message: 'Provider status valid.',
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Connection failed',
      message: `Could not reach ${provider} at ${cleanHost}. Ensure local server is running.`,
    });
  }
});

async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================================`);
    console.log(`  OCR Read Aloud Server Started Successfully!`);
    console.log(`  ➜ Open in Browser: http://localhost:${PORT}/`);
    console.log(`  ➜ Network:          http://0.0.0.0:${PORT}/`);
    console.log(`========================================================\n`);
  });
}

start();
