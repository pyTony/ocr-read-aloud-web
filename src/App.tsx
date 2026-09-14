import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, FileCheck, PanelLeft, AlertTriangle, SkipForward, FileText, SlidersHorizontal, HelpCircle } from 'lucide-react';
import { PageUnit, ContinueJumpRecord, AdJumpRecord, LlmConfig } from './types';
import { getSampleMagazinePages } from './lib/sampleDocument';
import {
  processPdfFile,
  processImageWithOcr,
  rescanPageWithTesseract,
  getActivePdfDocument,
  renderPdfPageToDataUrl,
  restorePdfFromIndexedDb,
} from './lib/ocrEngine';
import { getPageImageFromIndexedDb } from './lib/pdfStorage';
import { processReadyTextFile } from './lib/textDocumentParser';
import { splitIntoSentences } from './lib/layoutAndColumns';
import { cleanTextForSpeech, repairSplitWordsAndDehyphenate, cleanOcrGarbageAndNoise, isHighGarbageText } from './lib/textClean';
import { findContinueLanding, parseContinuedOn } from './lib/continueLinks';
import { formatPagesDump, articlePageIndices, sanitizeFilenameStem } from './lib/articleExport';
import { getGeminiToken, saveGeminiToken } from './lib/geminiTokenStorage';

import { TransportControls } from './components/TransportControls';
import { ReadingPreview } from './components/ReadingPreview';
import { PageListSidebar } from './components/PageListSidebar';
import { TextInspectorModal } from './components/TextInspectorModal';
import { ShortcutHelpModal } from './components/ShortcutHelpModal';
import { FeatureHelpModal } from './components/FeatureHelpModal';
import { ProofreadSelectionModal } from './components/ProofreadSelectionModal';
import { OpenDocumentModal } from './components/OpenDocumentModal';
import { LlmSettingsModal } from './components/LlmSettingsModal';

export default function App() {
  // Document State with localStorage persistence
  const [documentName, setDocumentName] = useState<string>(() => {
    try {
      return localStorage.getItem('ocr_document_name') || 'BYTE Magazine (Aug 1976) · Speech Synthesis';
    } catch {
      return 'BYTE Magazine (Aug 1976) · Speech Synthesis';
    }
  });

  const [isSampleDocument, setIsSampleDocument] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ocr_is_sample');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const [pages, setPages] = useState<PageUnit[]>(() => {
    try {
      const isSample = localStorage.getItem('ocr_is_sample');
      if (isSample === 'false') {
        const saved = localStorage.getItem('ocr_pages_data');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      }
    } catch {}
    return getSampleMagazinePages();
  });

  // Save document state to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('ocr_document_name', documentName);
      localStorage.setItem('ocr_is_sample', String(isSampleDocument));
      if (!isSampleDocument) {
        const lightweightPages = pages.map(p => ({
          ...p,
          image: p.image && p.image.length > 50000 ? undefined : p.image
        }));
        localStorage.setItem('ocr_pages_data', JSON.stringify(lightweightPages));
      } else {
        localStorage.removeItem('ocr_pages_data');
      }
    } catch (e) {
      console.warn('Could not persist pages to localStorage:', e);
    }
  }, [pages, documentName, isSampleDocument]);
  const [showHighlights, setShowHighlights] = useState<boolean>(true);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(0);

  // Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [currentSentenceText, setCurrentSentenceText] = useState<string>('');

  // Jumps
  const [continueJump, setContinueJump] = useState<ContinueJumpRecord | null>(null);
  const [adJump, setAdJump] = useState<AdJumpRecord | null>(null);
  const [lastSkippedAdIndex, setLastSkippedAdIndex] = useState<number | null>(null);

  // Audio / Speech Engine
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const appFileInputRef = useRef<HTMLInputElement>(null);

  // UI / Processing State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [backgroundLoadingProgress, setBackgroundLoadingProgress] = useState<{
    current: number;
    total: number;
    isComplete: boolean;
  } | null>(null);
  const [ocrLang, setOcrLang] = useState<string>('eng');
  const [isProofreading, setIsProofreading] = useState<boolean>(false);
  const [isBackgroundProofreading, setIsBackgroundProofreading] = useState<boolean>(false);
  const [backgroundProofreadStatus, setBackgroundProofreadStatus] = useState<string>('');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [isProofreadModalOpen, setIsProofreadModalOpen] = useState<boolean>(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isLlmSettingsOpen, setIsLlmSettingsOpen] = useState<boolean>(false);
  const [isDisplayControlsOpen, setIsDisplayControlsOpen] = useState<boolean>(false);

  // Local / Cloud LLM Settings with Cookie-backed Gemini Token
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(() => {
    const savedGeminiToken = getGeminiToken();
    return {
      provider: savedGeminiToken ? 'gemini' : 'rules',
      ollamaHost: 'http://127.0.0.1:11434',
      ollamaModel: 'qwen3.5:9b-q4_K_M',
      openaiHost: 'http://127.0.0.1:1234/v1',
      openaiModel: 'local-model',
      autoProofread: false,
      geminiApiKey: savedGeminiToken,
    };
  });

  // Notification Banner (for Quota Exhaustion or Important System Alerts)
  const [quotaBanner, setQuotaBanner] = useState<{ message: string; isWarning?: boolean } | null>(null);
  const [documentLoadNotification, setDocumentLoadNotification] = useState<{ filename: string; pageCount: number; type: string } | null>(null);

  // Proactive Gemini Quota Check on Startup
  useEffect(() => {
    const checkQuota = async () => {
      try {
        const token = getGeminiToken();
        const res = await fetch('/api/gemini-quota-check', {
          headers: token ? { 'x-gemini-api-key': token } : {},
        });
        const data = await res.json();
        if (data.quotaExhausted) {
          setLlmConfig((prev) => ({
            ...prev,
            isGeminiQuotaExhausted: true,
            provider: token ? prev.provider : 'rules',
          }));
          if (!token) {
            setQuotaBanner({
              message: 'Gemini free quota is depleted. Switched to built-in Offline Rule Cleaner (Zero cost, instant). You can also run Ollama locally or enter a token in AI Settings (⚙).',
              isWarning: true,
            });
          }
        }
      } catch (err) {
        console.warn('Startup quota check completed with fallback:', err);
      }
    };
    checkQuota();
  }, []);

  const handleUpdateLlmConfig = useCallback((newConfig: LlmConfig) => {
    if (newConfig.geminiApiKey !== undefined) {
      saveGeminiToken(newConfig.geminiApiKey);
    }
    setLlmConfig(newConfig);
  }, []);

  // Reading Mode / Zen Fullscreen State
  const [isReadingMode, setIsReadingMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ocr_reading_mode') === 'true';
    } catch {
      return false;
    }
  });

  const toggleReadingMode = useCallback(() => {
    setIsReadingMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ocr_reading_mode', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Sidebar Visibility & Draggable Divider Resizing
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ocr_sidebar_open');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ocr_sidebar_width');
      return saved ? Math.max(180, Math.min(650, parseInt(saved, 10))) : 320;
    } catch {
      return 320;
    }
  });

  const [skipNoiseHeaderFooter, setSkipNoiseHeaderFooter] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ocr_skip_noise_hf');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleSkipNoiseHeaderFooter = useCallback(() => {
    setSkipNoiseHeaderFooter((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ocr_skip_noise_hf', String(next));
      } catch {}
      return next;
    });
  }, []);

  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ocr_sidebar_open', String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingDivider(true);
  };

  useEffect(() => {
    if (!isDraggingDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      const maxWidth = Math.max(240, window.innerWidth - 350);
      const newWidth = Math.max(180, Math.min(maxWidth, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
      try {
        localStorage.setItem('ocr_sidebar_width', String(sidebarWidth));
      } catch {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingDivider, sidebarWidth]);

  // Initialize Speech Synthesis Voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const updateVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available.length > 0) {
        setVoices(available);
        // Default to English or first voice
        if (!selectedVoiceURI) {
          const eng = available.find(v => v.lang.startsWith('en') && !v.name.includes('Google')) ||
                      available.find(v => v.lang.startsWith('en')) ||
                      available[0];
          if (eng) setSelectedVoiceURI(eng.voiceURI);
        }
      }
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;
  }, [selectedVoiceURI]);

  // Derived current page & chunk
  const currentPage = pages[currentPageIndex] || null;
  const currentChunk = currentPage?.chunks[currentChunkIndex] || null;

  // Sentences for current chunk (dynamically filtered when Junk/Header/Footer filter is ON)
  const currentSentences = React.useMemo(() => {
    if (!currentChunk?.text) return [];
    const textToSplit = skipNoiseHeaderFooter
      ? cleanOcrGarbageAndNoise(currentChunk.text)
      : currentChunk.text;
    return splitIntoSentences(textToSplit);
  }, [currentChunk, skipNoiseHeaderFooter]);

  // Update caption text when indices, sentences, or filter mode change
  useEffect(() => {
    if (currentSentences.length > 0 && currentSentenceIndex < currentSentences.length) {
      const raw = currentSentences[currentSentenceIndex];
      const cleaned = skipNoiseHeaderFooter ? cleanOcrGarbageAndNoise(raw) : raw;
      setCurrentSentenceText(cleaned);
    } else if (currentChunk?.text) {
      const raw = currentChunk.text;
      const cleaned = skipNoiseHeaderFooter ? cleanOcrGarbageAndNoise(raw) : raw;
      setCurrentSentenceText(cleaned);
    } else {
      setCurrentSentenceText('');
    }
  }, [currentSentences, currentSentenceIndex, currentChunk, skipNoiseHeaderFooter]);

  // Stop playback cleanly
  const stopPlayback = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  // On-demand rendering of a page scan from the active PDF document
  const handleRequestRenderPage = useCallback(async (pageIdx: number): Promise<string | void> => {
    let activePdf = getActivePdfDocument();
    if (!activePdf) {
      activePdf = await restorePdfFromIndexedDb();
    }
    
    // Check if the page image is already stored in IndexedDB
    const storedImg = await getPageImageFromIndexedDb(pageIdx + 1);
    if (storedImg) {
      setPages((prev) => {
        if (!prev[pageIdx]) return prev;
        const updated = [...prev];
        updated[pageIdx] = {
          ...updated[pageIdx],
          image: storedImg,
        };
        return updated;
      });
      return storedImg;
    }

    if (!activePdf) return;

    try {
      const result = await renderPdfPageToDataUrl(activePdf, pageIdx + 1, 1150, true);
      if (result?.dataUrl) {
        setPages((prev) => {
          if (!prev[pageIdx]) return prev;
          const updated = [...prev];
          updated[pageIdx] = {
            ...updated[pageIdx],
            image: result.dataUrl,
            width: result.width,
            height: result.height,
          };
          return updated;
        });
        return result.dataUrl;
      }
    } catch (e) {
      console.warn(`On-demand render for page ${pageIdx + 1} failed:`, e);
    }
  }, []);

  // Ensure the current page's image is rendered whenever currentPageIndex changes or on mount
  useEffect(() => {
    if (pages[currentPageIndex] && !pages[currentPageIndex].image && !isSampleDocument) {
      handleRequestRenderPage(currentPageIndex);
    }
  }, [currentPageIndex, pages, isSampleDocument, handleRequestRenderPage]);

  // Restore PDF and preload current page image on app mount if not sample document
  useEffect(() => {
    if (!isSampleDocument) {
      restorePdfFromIndexedDb().then((pdf) => {
        if (pdf) {
          handleRequestRenderPage(currentPageIndex);
        }
      });
    }
  }, []);

  // Forward sentence or wrap to next chunk/page (skipping repeating noise headers/footers if enabled)
  const advanceSentence = useCallback((advanceAdPages = true) => {
    if (!currentPage) return;

    // Next sentence in same chunk
    if (currentSentenceIndex + 1 < currentSentences.length) {
      setCurrentSentenceIndex(prev => prev + 1);
      return;
    }

    // Next chunk in same page
    let nextChunkIdx = currentChunkIndex + 1;
    if (skipNoiseHeaderFooter) {
      while (nextChunkIdx < currentPage.chunks.length && currentPage.chunks[nextChunkIdx].isNoiseHeaderFooter) {
        nextChunkIdx++;
      }
    }

    if (nextChunkIdx < currentPage.chunks.length) {
      setCurrentChunkIndex(nextChunkIdx);
      setCurrentSentenceIndex(0);
      return;
    }

    // Next page or continuation jump
    if (currentPage.continuedOn && currentPage.continuedOn.length > 0) {
      const targetFolio = currentPage.continuedOn[0];
      const landing = findContinueLanding(pages, targetFolio, currentPage.pageNumber);
      if (landing) {
        setContinueJump({
          originPageIndex: currentPageIndex,
          originChunkIndex: currentChunkIndex,
          originSentenceIndex: currentSentenceIndex,
          targetFolio,
        });
        let targetC = landing.chunkIndex;
        if (skipNoiseHeaderFooter) {
          const targetPage = pages[landing.pageIndex];
          while (targetC < targetPage.chunks.length && targetPage.chunks[targetC].isNoiseHeaderFooter) {
            targetC++;
          }
          if (targetC >= targetPage.chunks.length) targetC = 0;
        }
        setCurrentPageIndex(landing.pageIndex);
        setCurrentChunkIndex(targetC);
        setCurrentSentenceIndex(0);
        return;
      }
    }

    let nextP = currentPageIndex + 1;
    if (nextP < pages.length) {
      // Check if next page is an ad to skip during forward playback
      if (advanceAdPages && pages[nextP].skipAsAd && nextP + 1 < pages.length) {
        setLastSkippedAdIndex(nextP);
        nextP = nextP + 1; // Jump past the ad insert!
      }

      let startingChunkIdx = 0;
      if (skipNoiseHeaderFooter && pages[nextP]) {
        while (startingChunkIdx < pages[nextP].chunks.length && pages[nextP].chunks[startingChunkIdx].isNoiseHeaderFooter) {
          startingChunkIdx++;
        }
        if (startingChunkIdx >= pages[nextP].chunks.length) startingChunkIdx = 0;
      }

      setCurrentPageIndex(nextP);
      setCurrentChunkIndex(startingChunkIdx);
      setCurrentSentenceIndex(0);
    } else {
      // Reached end of document
      stopPlayback();
    }
  }, [currentPage, currentSentenceIndex, currentSentences.length, currentChunkIndex, currentPageIndex, pages, stopPlayback, skipNoiseHeaderFooter]);

  // Rewind sentence or jump to previous chunk/page
  // Accurately handles returning across continuation jumps (e.g. from p.126 back to last sentence on p.6)
  const rewindSentence = useCallback(() => {
    if (currentSentenceIndex > 0) {
      setCurrentSentenceIndex(prev => prev - 1);
      return;
    }

    if (currentChunkIndex > 0) {
      let prevChunkIdx = currentChunkIndex - 1;
      if (skipNoiseHeaderFooter && currentPage) {
        while (prevChunkIdx >= 0 && currentPage.chunks[prevChunkIdx].isNoiseHeaderFooter) {
          prevChunkIdx--;
        }
      }

      if (prevChunkIdx >= 0) {
        setCurrentChunkIndex(prevChunkIdx);
        const prevChunk = currentPage?.chunks[prevChunkIdx];
        const prevSentences = prevChunk ? splitIntoSentences(prevChunk.text) : [];
        setCurrentSentenceIndex(Math.max(0, prevSentences.length - 1));
        return;
      }
    }

    // At the beginning of the current page (chunk 0, sentence 0):
    // 1. If we jumped here via a continuation jump (e.g. from page 6 to page 126):
    if (continueJump && continueJump.originPageIndex >= 0 && continueJump.originPageIndex < pages.length) {
      const origP = continueJump.originPageIndex;
      const origC = continueJump.originChunkIndex;
      const origS = continueJump.originSentenceIndex;
      setCurrentPageIndex(origP);
      setCurrentChunkIndex(origC);
      setCurrentSentenceIndex(origS);
      setContinueJump(null);
      return;
    }

    // 2. If this page is a continuation ("continued from page X"), e.g. p.126 from p.6:
    if (currentPage && currentPage.continuedFrom && currentPage.continuedFrom.length > 0) {
      const originFolio = currentPage.continuedFrom[0];
      const originPageIdx = pages.findIndex(p => p.pageNumber === originFolio);
      if (originPageIdx >= 0) {
        const originPage = pages[originPageIdx];
        let lastChunkIdx = Math.max(0, originPage.chunks.length - 1);
        if (skipNoiseHeaderFooter) {
          while (lastChunkIdx >= 0 && originPage.chunks[lastChunkIdx].isNoiseHeaderFooter) {
            lastChunkIdx--;
          }
          if (lastChunkIdx < 0) lastChunkIdx = 0;
        }
        const lastChunk = originPage.chunks[lastChunkIdx];
        const prevSentences = lastChunk ? splitIntoSentences(lastChunk.text) : [];
        setCurrentPageIndex(originPageIdx);
        setCurrentChunkIndex(lastChunkIdx);
        setCurrentSentenceIndex(Math.max(0, prevSentences.length - 1));
        return;
      }
    }

    // 3. Regular previous page navigation (skipping ads if needed)
    let prevP = currentPageIndex - 1;
    while (prevP >= 0 && pages[prevP].skipAsAd && prevP > 0) {
      prevP--;
    }

    if (prevP >= 0) {
      setCurrentPageIndex(prevP);
      const prevPage = pages[prevP];
      let lastChunkIdx = Math.max(0, prevPage.chunks.length - 1);
      if (skipNoiseHeaderFooter) {
        while (lastChunkIdx >= 0 && prevPage.chunks[lastChunkIdx].isNoiseHeaderFooter) {
          lastChunkIdx--;
        }
        if (lastChunkIdx < 0) lastChunkIdx = 0;
      }
      setCurrentChunkIndex(lastChunkIdx);
      const lastChunk = prevPage.chunks[lastChunkIdx];
      const prevSentences = lastChunk ? splitIntoSentences(lastChunk.text) : [];
      setCurrentSentenceIndex(Math.max(0, prevSentences.length - 1));
    }
  }, [currentSentenceIndex, currentChunkIndex, currentPageIndex, currentPage, pages, continueJump, skipNoiseHeaderFooter]);

  // Core Speech Speaking Effect
  useEffect(() => {
    if (!isPlaying || isPaused || !currentSentenceText.trim()) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // If active chunk is flagged as repeating noise header/footer and skip is active, skip automatically
    if (skipNoiseHeaderFooter && currentChunk?.isNoiseHeaderFooter) {
      advanceSentence();
      return;
    }

    window.speechSynthesis.cancel();

    const cleanedSpeechText = cleanTextForSpeech(currentSentenceText);
    if (!cleanedSpeechText) {
      advanceSentence();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanedSpeechText);
    utteranceRef.current = utterance;

    if (selectedVoiceURI) {
      const foundVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
      if (foundVoice) utterance.voice = foundVoice;
    }

    utterance.rate = speechRate;

    utterance.onend = () => {
      if (isPlaying && !isPaused) {
        advanceSentence();
      }
    };

    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('SpeechSynthesis error:', e);
      }
    };

    window.speechSynthesis.speak(utterance);

    return () => {
      // Don't cancel on standard rerenders unless unmounting or changing text
    };
  }, [isPlaying, isPaused, currentSentenceText, currentChunk, skipNoiseHeaderFooter, selectedVoiceURI, speechRate, voices, advanceSentence]);

  // Toggle Play / Pause
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsPlaying(false);
      setIsPaused(true);
    } else {
      setIsPlaying(true);
      setIsPaused(false);
      if (pages[currentPageIndex] && !pages[currentPageIndex].image && !isSampleDocument) {
        handleRequestRenderPage(currentPageIndex);
      }
    }
  }, [isPlaying, pages, currentPageIndex, isSampleDocument, handleRequestRenderPage]);

  // Paragraph navigation
  const prevChunk = () => {
    if (currentChunkIndex > 0) {
      let prevIdx = currentChunkIndex - 1;
      if (skipNoiseHeaderFooter && currentPage) {
        while (prevIdx >= 0 && currentPage.chunks[prevIdx].isNoiseHeaderFooter) {
          prevIdx--;
        }
      }
      if (prevIdx >= 0) {
        setCurrentChunkIndex(prevIdx);
        setCurrentSentenceIndex(0);
        return;
      }
    }

    if (continueJump && continueJump.originPageIndex >= 0 && continueJump.originPageIndex < pages.length) {
      setCurrentPageIndex(continueJump.originPageIndex);
      setCurrentChunkIndex(continueJump.originChunkIndex);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      return;
    }
    if (currentPage && currentPage.continuedFrom && currentPage.continuedFrom.length > 0) {
      const originFolio = currentPage.continuedFrom[0];
      const originPageIdx = pages.findIndex(p => p.pageNumber === originFolio);
      if (originPageIdx >= 0) {
        const originPage = pages[originPageIdx];
        let lastIdx = Math.max(0, originPage.chunks.length - 1);
        if (skipNoiseHeaderFooter) {
          while (lastIdx >= 0 && originPage.chunks[lastIdx].isNoiseHeaderFooter) {
            lastIdx--;
          }
          if (lastIdx < 0) lastIdx = 0;
        }
        setCurrentPageIndex(originPageIdx);
        setCurrentChunkIndex(lastIdx);
        setCurrentSentenceIndex(0);
        return;
      }
    }
    let prevP = currentPageIndex - 1;
    while (prevP >= 0 && pages[prevP].skipAsAd && prevP > 0) {
      prevP--;
    }
    if (prevP >= 0) {
      const prevPage = pages[prevP];
      let lastIdx = Math.max(0, prevPage.chunks.length - 1);
      if (skipNoiseHeaderFooter) {
        while (lastIdx >= 0 && prevPage.chunks[lastIdx].isNoiseHeaderFooter) {
          lastIdx--;
        }
        if (lastIdx < 0) lastIdx = 0;
      }
      setCurrentPageIndex(prevP);
      setCurrentChunkIndex(lastIdx);
      setCurrentSentenceIndex(0);
    }
  };

  const getFirstReadableChunkIndex = useCallback((page: PageUnit | undefined): number => {
    if (!page || !page.chunks.length) return 0;
    if (!skipNoiseHeaderFooter) return 0;
    for (let i = 0; i < page.chunks.length; i++) {
      if (!page.chunks[i].isNoiseHeaderFooter) return i;
    }
    return 0;
  }, [skipNoiseHeaderFooter]);

  const handleSelectPage = useCallback((idx: number) => {
    if (idx < 0 || idx >= pages.length) return;
    const targetPage = pages[idx];
    const startChunk = getFirstReadableChunkIndex(targetPage);
    setCurrentPageIndex(idx);
    setCurrentChunkIndex(startChunk);
    setCurrentSentenceIndex(0);
    if (targetPage && !targetPage.image) {
      handleRequestRenderPage(idx);
    }
  }, [pages, getFirstReadableChunkIndex, handleRequestRenderPage]);

  // Next chunk handler (skipping repeating noise headers/footers if enabled)
  const nextChunk = () => {
    if (!currentPage) return;
    let nextIdx = currentChunkIndex + 1;
    if (skipNoiseHeaderFooter) {
      while (nextIdx < currentPage.chunks.length && currentPage.chunks[nextIdx].isNoiseHeaderFooter) {
        nextIdx++;
      }
    }

    if (nextIdx < currentPage.chunks.length) {
      setCurrentChunkIndex(nextIdx);
      setCurrentSentenceIndex(0);
      return;
    }
    
    if (currentPageIndex + 1 < pages.length) {
      const nextP = currentPageIndex + 1;
      const startIdx = getFirstReadableChunkIndex(pages[nextP]);
      setCurrentPageIndex(nextP);
      setCurrentChunkIndex(startIdx);
      setCurrentSentenceIndex(0);
    }
  };

  // Page navigation
  const prevPage = () => {
    if (continueJump && continueJump.originPageIndex >= 0 && continueJump.originPageIndex < pages.length) {
      setCurrentPageIndex(continueJump.originPageIndex);
      setCurrentChunkIndex(continueJump.originChunkIndex);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      return;
    }
    if (currentPage && currentPage.continuedFrom && currentPage.continuedFrom.length > 0) {
      const originFolio = currentPage.continuedFrom[0];
      const originPageIdx = pages.findIndex(p => p.pageNumber === originFolio);
      if (originPageIdx >= 0) {
        handleSelectPage(originPageIdx);
        return;
      }
    }
    let prevP = currentPageIndex - 1;
    while (prevP >= 0 && pages[prevP].skipAsAd && prevP > 0) {
      prevP--;
    }
    if (prevP >= 0) {
      handleSelectPage(prevP);
    }
  };

  const nextPage = () => {
    if (currentPageIndex + 1 < pages.length) {
      handleSelectPage(currentPageIndex + 1);
    }
  };

  // Continuation Jump (c / Ctrl+J)
  const targetContinueFolio = currentPage?.continuedOn[0] ?? null;

  const handleContinueAction = useCallback(() => {
    if (continueJump) {
      // Return to origin!
      setCurrentPageIndex(continueJump.originPageIndex);
      setCurrentChunkIndex(continueJump.originChunkIndex);
      setCurrentSentenceIndex(continueJump.originSentenceIndex);
      setContinueJump(null);
      return;
    }

    if (currentPage && currentPage.continuedFrom && currentPage.continuedFrom.length > 0) {
      const originFolio = currentPage.continuedFrom[0];
      const originPageIdx = pages.findIndex(p => p.pageNumber === originFolio);
      if (originPageIdx >= 0) {
        const originPage = pages[originPageIdx];
        const lastChunkIdx = Math.max(0, originPage.chunks.length - 1);
        const lastChunk = originPage.chunks[lastChunkIdx];
        const prevSentences = lastChunk ? splitIntoSentences(lastChunk.text) : [];
        setCurrentPageIndex(originPageIdx);
        setCurrentChunkIndex(lastChunkIdx);
        setCurrentSentenceIndex(Math.max(0, prevSentences.length - 1));
        return;
      }
    }

    if (!currentPage) return;
    const contTargets = currentPage.continuedOn.length
      ? currentPage.continuedOn
      : parseContinuedOn(currentPage.rawText);

    if (!contTargets.length) return;
    const targetFolio = contTargets[0];
    const sourceFolio = currentPage.pageNumber;

    const landing = findContinueLanding(pages, targetFolio, sourceFolio);
    if (landing) {
      setContinueJump({
        originPageIndex: currentPageIndex,
        originChunkIndex: currentChunkIndex,
        originSentenceIndex: currentSentenceIndex,
        targetFolio,
      });
      setCurrentPageIndex(landing.pageIndex);
      setCurrentChunkIndex(landing.chunkIndex);
      setCurrentSentenceIndex(0);
    }
  }, [continueJump, currentPage, currentPageIndex, currentChunkIndex, currentSentenceIndex, pages]);

  // Ad Jump (a)
  const canJumpToAd = lastSkippedAdIndex !== null && !adJump;

  const handleAdAction = useCallback(() => {
    if (adJump) {
      // Return to article!
      setCurrentPageIndex(adJump.originPageIndex);
      setCurrentChunkIndex(adJump.originChunkIndex);
      setCurrentSentenceIndex(adJump.originSentenceIndex);
      setAdJump(null);
      return;
    }

    if (lastSkippedAdIndex !== null && lastSkippedAdIndex < pages.length) {
      setAdJump({
        originPageIndex: currentPageIndex,
        originChunkIndex: currentChunkIndex,
        originSentenceIndex: currentSentenceIndex,
        adPageIndex: lastSkippedAdIndex,
      });
      setCurrentPageIndex(lastSkippedAdIndex);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
    }
  }, [adJump, lastSkippedAdIndex, currentPageIndex, currentChunkIndex, currentSentenceIndex, pages.length]);

  // Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is inside an input or modal textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      // Space: Play / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      // Escape: Stop or close Display Controls Modal
      else if (e.code === 'Escape') {
        e.preventDefault();
        if (isDisplayControlsOpen) {
          setIsDisplayControlsOpen(false);
        } else {
          stopPlayback();
        }
      }
      // ArrowLeft: Rewind sentence
      else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        rewindSentence();
      }
      // ArrowRight: Forward sentence
      else if (e.code === 'ArrowRight') {
        e.preventDefault();
        advanceSentence(false);
      }
      // ArrowUp or Shift+Tab: Previous paragraph
      else if (e.code === 'ArrowUp' || (e.shiftKey && e.code === 'Tab')) {
        e.preventDefault();
        prevChunk();
      }
      // ArrowDown or Tab: Next paragraph
      else if (e.code === 'ArrowDown' || e.code === 'Tab') {
        e.preventDefault();
        nextChunk();
      }
      // PageUp: Previous page
      else if (e.code === 'PageUp') {
        e.preventDefault();
        prevPage();
      }
      // PageDown: Next page
      else if (e.code === 'PageDown') {
        e.preventDefault();
        nextPage();
      }
      // c or Ctrl+J: Continuation jump
      else if (e.key.toLowerCase() === 'c' || (e.ctrlKey && e.key.toLowerCase() === 'j')) {
        e.preventDefault();
        handleContinueAction();
      }
      // a: Ad jump
      else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleAdAction();
      }
      // Ctrl+S: Save full OCR
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault();
        handleSaveAllOcr();
      }
      // Ctrl+Shift+S: Save article
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && e.shiftKey) {
        e.preventDefault();
        handleSaveArticle();
      }
      // h: Toggle visual highlights
      else if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowHighlights((prev) => !prev);
      }
      // n: Toggle Skip Repeating Noise Header/Footer
      else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleSkipNoiseHeaderFooter();
      }
      // [ or Ctrl+B: Toggle Pages sidebar
      else if (e.key === '[' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b')) {
        e.preventDefault();
        toggleSidebar();
      }
      // f or F: Zen Fullscreen Reading Mode
      else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleReadingMode();
      }
      // 1: Switch / Reset to 1.0x normal speed
      else if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSpeechRate(1.0);
      }
      // + or =: Speed up speech rate
      else if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSpeechRate((prev) => Math.min(2.0, Math.round((prev + 0.1) * 10) / 10));
      }
      // - or _: Slow down speech rate
      else if ((e.key === '-' || e.key === '_') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSpeechRate((prev) => Math.max(0.6, Math.round((prev - 0.1) * 10) / 10));
      }
      // ?: Shortcut help
      else if (e.key === '?') {
        e.preventDefault();
        setIsShortcutsOpen(true);
      }
      // d or D: Toggle Display Controls Modal
      else if (e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsDisplayControlsOpen((prev) => !prev);
      }
      // Ctrl+O or Cmd+O: Open Document Dialog
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setIsUploadModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    togglePlay,
    stopPlayback,
    rewindSentence,
    advanceSentence,
    handleContinueAction,
    handleAdAction,
    toggleSidebar,
    toggleReadingMode,
    toggleSkipNoiseHeaderFooter,
    isDisplayControlsOpen,
  ]);

  // Load 1976 Sample Document
  const handleLoadSample = () => {
    stopPlayback();
    setIsProcessing(true);
    setProcessingStatus('Loading 1976 BYTE Magazine issue...');
    setTimeout(() => {
      const sample = getSampleMagazinePages();
      setPages(sample);
      setDocumentName('BYTE Magazine (Aug 1976) · Speech Synthesis');
      setIsSampleDocument(true);
      setCurrentPageIndex(0);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      setAdJump(null);
      setLastSkippedAdIndex(null);
      setDocumentLoadNotification({
        filename: 'BYTE Magazine (Aug 1976)',
        pageCount: sample.length,
        type: 'Sample Magazine Issue',
      });
      setIsProcessing(false);
      setProcessingStatus('');
    }, 200);
  };

  // Upload PDF
  const handleUploadPdf = async (file: File) => {
    try {
      stopPlayback();

      // Immediately clear out old document so it doesn't linger in view
      setPages([]);
      setDocumentName(file.name);
      setIsSampleDocument(false);
      setCurrentPageIndex(0);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      setAdJump(null);
      setLastSkippedAdIndex(null);
      setDocumentLoadNotification(null);
      setBackgroundLoadingProgress(null);

      // Start initial processing
      setIsProcessing(true);
      setProcessingStatus(`Opening ${file.name}...`);

      await processPdfFile(file, {
        onProgress: (_cur, _total, status) => {
          setProcessingStatus(status);
        },
        onFirstPageReady: (page1, totalPages) => {
          // Immediately populate page 1 and skeleton entries for the rest
          const initialPages: PageUnit[] = Array.from({ length: totalPages }, (_, idx) => {
            if (idx === 0) return page1;
            return {
              pageNumber: idx + 1,
              label: `Page ${idx + 1}`,
              image: '',
              width: page1.width,
              height: page1.height,
              lines: [],
              chunks: [],
              rawText: '',
              isProofread: false,
              skipAsAd: false,
              adReasons: [],
              inferredTitle: `Page ${idx + 1}`,
              continuedOn: [],
              continuedFrom: [],
            };
          });

          setPages(initialPages);
          setCurrentPageIndex(0);
          setCurrentChunkIndex(0);
          setCurrentSentenceIndex(0);

          // Page 1 is now visible! Unlock main screen for immediate reading & speech
          setIsProcessing(false);
          setProcessingStatus('');

          if (totalPages > 1) {
            setBackgroundLoadingProgress({
              current: 1,
              total: totalPages,
              isComplete: false,
            });
          }

          if (llmConfig.autoProofread) {
            setTimeout(() => handleProofreadCurrentPage(), 400);
          }
        },
        onPageUpdate: (pageIndex, unit, totalPages) => {
          setPages((prev) => {
            if (prev.length !== totalPages) return prev;
            const updated = [...prev];
            updated[pageIndex] = unit;
            return updated;
          });
          setBackgroundLoadingProgress({
            current: pageIndex + 1,
            total: totalPages,
            isComplete: pageIndex + 1 >= totalPages,
          });
        },
        onAllDone: (finalPages) => {
          setPages(finalPages);
          setBackgroundLoadingProgress({
            current: finalPages.length,
            total: finalPages.length,
            isComplete: true,
          });
          setDocumentLoadNotification({
            filename: file.name,
            pageCount: finalPages.length,
            type: 'PDF Document',
          });
          setTimeout(() => {
            setBackgroundLoadingProgress(null);
          }, 3500);
        },
      });
    } catch (err: any) {
      console.error('PDF error:', err);
      alert(`Could not process PDF: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Upload & Read Ready Text Document without OCR (.txt, .md, .rtf, .html, .srt, .vtt, .json, .csv)
  const handleUploadText = async (file: File) => {
    try {
      stopPlayback();
      setPages([]);
      setDocumentName(file.name);
      setIsSampleDocument(false);
      setCurrentPageIndex(0);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      setAdJump(null);
      setLastSkippedAdIndex(null);
      setDocumentLoadNotification(null);
      setBackgroundLoadingProgress(null);

      setIsProcessing(true);
      setProcessingStatus(`Loading ${file.name} directly without OCR...`);
      const textPages = await processReadyTextFile(file, (status) => {
        setProcessingStatus(status);
      });
      setPages(textPages);
      setDocumentName(file.name);
      setIsSampleDocument(false);
      setCurrentPageIndex(0);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      setAdJump(null);
      setLastSkippedAdIndex(null);
      setDocumentLoadNotification({
        filename: file.name,
        pageCount: textPages.length,
        type: 'Text Document',
      });
    } catch (err: any) {
      console.error('Text parsing error:', err);
      alert(`Could not process text document: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Universal Dropped File Processor
  const handleProcessDroppedFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (file.type === 'application/pdf' || ext === 'pdf') {
      handleUploadPdf(file);
    } else if (
      file.type.startsWith('image/') ||
      ['png', 'jpg', 'jpeg', 'tiff', 'tif', 'bmp', 'webp'].includes(ext)
    ) {
      handleUploadImage(file, ocrLang);
    } else {
      handleUploadText(file);
    }
  };

  // Upload Image with OCR
  const handleUploadImage = async (file: File, lang: string) => {
    try {
      stopPlayback();
      setPages([]);
      setDocumentName(file.name);
      setIsSampleDocument(false);
      setCurrentPageIndex(0);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      setAdJump(null);
      setLastSkippedAdIndex(null);
      setDocumentLoadNotification(null);
      setBackgroundLoadingProgress(null);

      setIsProcessing(true);
      setProcessingStatus(`Running OCR on ${file.name} (${lang})...`);
      const imgPage = await processImageWithOcr(file, lang, (_progress, status) => {
        setProcessingStatus(status);
      });
      setPages([imgPage]);
      setDocumentName(file.name);
      setIsSampleDocument(false);
      setCurrentPageIndex(0);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      setAdJump(null);
      setLastSkippedAdIndex(null);
      setDocumentLoadNotification({
        filename: file.name,
        pageCount: 1,
        type: `Image OCR (${lang})`,
      });
      if (llmConfig.autoProofread) {
        setTimeout(() => handleProofreadCurrentPage(), 400);
      }
    } catch (err: any) {
      console.error('Image OCR error:', err);
      alert(`Could not process image OCR: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // On-demand OCR for current page (e.g. scanned PDF page with 0 text chunks)
  const handleOcrCurrentPage = async () => {
    if (!currentPage || isProcessing) return;
    try {
      stopPlayback();
      setIsProcessing(true);
      setProcessingStatus(`Running OCR on ${currentPage.label}...`);

      const res = await fetch(currentPage.image);
      const blob = await res.blob();
      const file = new File([blob], `${currentPage.label}.jpg`, { type: 'image/jpeg' });
      const ocrPage = await processImageWithOcr(file, ocrLang, (_p, status) => {
        setProcessingStatus(status);
      });

      setPages((prev) => {
        const copy = [...prev];
        copy[currentPageIndex] = {
          ...copy[currentPageIndex],
          lines: ocrPage.lines,
          chunks: ocrPage.chunks,
          rawText: ocrPage.rawText,
        };
        return copy;
      });
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
      if (llmConfig.autoProofread) {
        setTimeout(() => handleProofreadCurrentPage(), 400);
      }
    } catch (err: any) {
      console.error('Page OCR error:', err);
      alert(`Could not OCR page: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Helper for direct browser LLM call + fallback to express server
  const executeAiProofread = async (rawText: string, pageLabel: string, imageData?: string) => {
    const provider = llmConfig.provider;

    // 1. Direct browser fetch for local Ollama (Connects directly from browser on user's machine)
    if (provider === 'ollama' || (provider === 'auto' && llmConfig.ollamaHost)) {
      const hostsToTry = [
        llmConfig.ollamaHost,
        'http://127.0.0.1:11434',
        'http://localhost:11434',
      ].filter(Boolean);
      const uniqueHosts = Array.from(new Set(hostsToTry));

      const systemPrompt = `You are an expert OCR proofreader and editor for scanned publications and magazines, preparing text for natural text-to-speech reading.
PRIMARY MANDATE: AGGRESSIVELY REPAIR SPLIT WORDS AND DEHYPHENATE
- Merge words broken with hyphens: "micro- processor" -> "microprocessor", "syn- thesis" -> "synthesis".
- Merge words broken with accidental spaces: "do ing" -> "doing", "cir cuit" -> "circuit".
- Remove stray OCR artifacts, scan speckles, and corrupted characters.
- Insert blank lines between natural paragraphs.
- Strictly preserve original reading order and meaning. Do not summarize or truncate.`;

      for (const host of uniqueHosts) {
        const cleanHost = host.replace(/\/+$/, '');
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 60000);
          const fullPrompt = `${systemPrompt}\n\nDocument/Page: ${pageLabel || 'Page'}\n\nOCR TEXT TO PROOFREAD:\n${rawText}`;

          const directRes = await fetch(`${cleanHost}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: llmConfig.ollamaModel || 'qwen3.5:9b-q4_K_M',
              prompt: fullPrompt,
              stream: false,
            }),
            signal: controller.signal,
          });
          clearTimeout(tid);

          if (directRes.ok) {
            const data = await directRes.json();
            const output = (data.response || '').trim() || rawText;
            const isAd = output.startsWith('[[SKIP_AS_AD]]');
            const rawCleaned = isAd ? output.replace(/^\[\[SKIP_AS_AD\]\]\s*/, '').trim() : output;
            return {
              proofreadText: repairSplitWordsAndDehyphenate(rawCleaned),
              isAd,
            };
          }
        } catch (browserOllamaErr: any) {
          console.log(`Direct browser Ollama fetch to ${cleanHost} failed:`, browserOllamaErr?.message);
        }
      }
    }

    // 2. Direct browser fetch for local OpenAI
    if (provider === 'openai') {
      const hostsToTry = [
        llmConfig.openaiHost,
        'http://127.0.0.1:1234/v1',
        'http://localhost:1234/v1',
      ].filter(Boolean);
      const uniqueHosts = Array.from(new Set(hostsToTry));

      for (const host of uniqueHosts) {
        const cleanHost = host.replace(/\/+$/, '');
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 60000);
          const prompt = `You are an expert OCR proofreader. Repair split words and dehyphenate the following text:\n\n${rawText}`;

          const directRes = await fetch(`${cleanHost}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: llmConfig.openaiModel || 'local-model',
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.2,
            }),
            signal: controller.signal,
          });
          clearTimeout(tid);

          if (directRes.ok) {
            const data = await directRes.json();
            const output = (data.choices?.[0]?.message?.content || '').trim() || rawText;
            const isAd = output.startsWith('[[SKIP_AS_AD]]');
            const rawCleaned = isAd ? output.replace(/^\[\[SKIP_AS_AD\]\]\s*/, '').trim() : output;
            return {
              proofreadText: repairSplitWordsAndDehyphenate(rawCleaned),
              isAd,
            };
          }
        } catch (err) {
          // ignore
        }
      }
    }

    // 3. Fallback to Express backend /api/proofread (with multimodal vision image support)
    try {
      const res = await fetch('/api/proofread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(llmConfig.geminiApiKey ? { 'x-gemini-api-key': llmConfig.geminiApiKey } : {}),
        },
        body: JSON.stringify({
          text: rawText,
          pageLabel,
          imageData,
          provider: llmConfig.provider,
          ollamaHost: llmConfig.ollamaHost,
          ollamaModel: llmConfig.ollamaModel,
          openaiHost: llmConfig.openaiHost,
          openaiModel: llmConfig.openaiModel,
          geminiApiKey: llmConfig.geminiApiKey,
        }),
      });

      const data = await res.json();
      if (data.quotaExhausted || res.status === 429) {
        setLlmConfig(prev => ({ ...prev, isGeminiQuotaExhausted: true, provider: 'rules' }));
        setQuotaBanner({
          message: 'Gemini free quota is exhausted. Automatically cleaned using Offline Rule Cleaner (100% free & zero cost).',
          isWarning: true,
        });
      }

      if (res.ok && data.proofreadText) {
        return {
          proofreadText: repairSplitWordsAndDehyphenate(data.proofreadText || ''),
          isAd: data.isAd,
        };
      } else if (provider === 'ollama') {
        setQuotaBanner({
          message: `Local Ollama (${llmConfig.ollamaHost}) could not be reached. Ensure 'ollama serve' is running and start it with CORS allowed: OLLAMA_ORIGINS="*" ollama serve. Or switch engine to Google Gemini.`,
          isWarning: true,
        });
      }
    } catch (aiErr: any) {
      console.warn('AI proofread enhancement skipped/failed:', aiErr?.message);
      if (provider === 'ollama') {
        setQuotaBanner({
          message: `Local Ollama (${llmConfig.ollamaHost}) could not be reached. Ensure Ollama is running with CORS enabled: OLLAMA_ORIGINS="*" ollama serve, or select Google Gemini.`,
          isWarning: true,
        });
      }
    }

    return null;
  };

  // Proofread current page
  const handleProofreadCurrentPage = async () => {
    if (!currentPage || isProofreading) return;
    try {
      setIsProofreading(true);

      // Clean in-place preserving exact coordinates
      const instantCleaned = repairSplitWordsAndDehyphenate(currentPage.rawText || '');
      const instantChunks = currentPage.chunks.map(c => ({
        ...c,
        text: repairSplitWordsAndDehyphenate(c.text),
      }));

      setPages(prev => prev.map((p, idx) => {
        if (idx === currentPageIndex) {
          return {
            ...p,
            proofreadText: instantCleaned,
            chunks: instantChunks,
            isProofread: true,
          };
        }
        return p;
      }));

      // If user selected 'rules' provider, we are done
      if (llmConfig.provider === 'rules') {
        return;
      }

      const aiResult = await executeAiProofread(currentPage.rawText, currentPage.label, currentPage.image);
      if (aiResult && aiResult.proofreadText) {
        setPages(prev => prev.map((p, idx) => {
          if (idx === currentPageIndex) {
            const serverUpdatedChunks = p.chunks.map(c => ({
              ...c,
              text: repairSplitWordsAndDehyphenate(c.text),
            }));
            return {
              ...p,
              proofreadText: aiResult.proofreadText,
              chunks: serverUpdatedChunks,
              isProofread: true,
              skipAsAd: aiResult.isAd || p.skipAsAd,
            };
          }
          return p;
        }));
      }
    } catch (err: any) {
      console.error('Proofread failed:', err);
    } finally {
      setIsProofreading(false);
      setProcessingStatus('');
    }
  };

  // Proofread all pages in background (Non-blocking: speech playback & reading continue uninterrupted)
  const handleProofreadAllPages = async () => {
    if (isBackgroundProofreading || pages.length === 0) return;
    try {
      setIsBackgroundProofreading(true);
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (page.isProofread && page.proofreadText) continue;

        setBackgroundProofreadStatus(`Background Proofreading: Page ${i + 1} of ${pages.length} (${page.label})...`);

        const aiResult = await executeAiProofread(page.rawText, page.label, page.image);
        const cleanedText = aiResult?.proofreadText || repairSplitWordsAndDehyphenate(page.rawText || '');

        setPages(prev => prev.map((p, idx) => {
          if (idx === i) {
            const updatedChunks = p.chunks.map(c => ({
              ...c,
              text: repairSplitWordsAndDehyphenate(c.text),
            }));
            return {
              ...p,
              proofreadText: cleanedText,
              chunks: updatedChunks,
              isProofread: true,
              skipAsAd: aiResult?.isAd || p.skipAsAd,
            };
          }
          return p;
        }));
      }
    } catch (err: any) {
      console.error('Background batch proofread failed:', err);
    } finally {
      setIsBackgroundProofreading(false);
      setBackgroundProofreadStatus('');
    }
  };

  // Save full OCR document (.ocr.txt)
  const handleSaveAllOcr = () => {
    const dump = formatPagesDump(pages);
    const stem = sanitizeFilenameStem(documentName || 'document');
    const blob = new Blob([dump], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stem}.ocr.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setIsInspectorOpen(true);
  };

  // Save current article text
  const handleSaveArticle = () => {
    if (!currentPage) return;
    const indices = articlePageIndices(pages, currentPageIndex);
    const text = formatPagesDump(pages, indices);
    const stem = sanitizeFilenameStem(currentPage.inferredTitle || 'article');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stem}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setIsInspectorOpen(true);
  };

  // Toggle skip-as-ad manually
  const handleToggleSkipAd = (pageIdx: number) => {
    setPages(prev => prev.map((p, idx) => {
      if (idx === pageIdx) {
        return { ...p, skipAsAd: !p.skipAsAd };
      }
      return p;
    }));
  };

  const handleCopyText = () => {
    if (!currentPage) return;
    const textToCopy = currentPage.proofreadText || currentPage.rawText || '';
    navigator.clipboard.writeText(textToCopy).then(() => {
      alert('Page text copied to clipboard successfully!');
    }).catch(() => {
      alert('Failed to copy text to clipboard.');
    });
  };

  const handleRunRuleCleaner = () => {
    if (!currentPage) return;
    const cleanedRaw = repairSplitWordsAndDehyphenate(currentPage.rawText || '');
    const cleanedChunks = currentPage.chunks.map(chunk => ({
      ...chunk,
      text: repairSplitWordsAndDehyphenate(chunk.text || ''),
    }));
    setPages(prev => prev.map((p, idx) => {
      if (idx === currentPageIndex) {
        return {
          ...p,
          rawText: cleanedRaw,
          chunks: cleanedChunks,
          proofreadText: p.proofreadText ? repairSplitWordsAndDehyphenate(p.proofreadText) : p.proofreadText,
        };
      }
      return p;
    }));
    alert('Offline rule cleaner applied: hyphens and split words repaired across chunks.');
  };

  const handleRescanTesseract = async () => {
    if (!currentPage) return;
    setIsProcessing(true);
    try {
      const res = await rescanPageWithTesseract(currentPage.image, ocrLang, (status) => {
        setProcessingStatus(status);
      });
      setPages(prev => prev.map((p, idx) => {
        if (idx === currentPageIndex) {
          return {
            ...p,
            lines: res.lines,
            chunks: res.chunks,
            rawText: res.rawText,
            proofreadText: undefined,
            isProofread: false,
          };
        }
        return p;
      }));
      alert('Page successfully rescanned with Tesseract OCR!');
    } catch (err: any) {
      alert(`Tesseract rescan failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessDroppedFile(file);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden select-none relative"
    >
      {/* Global Persistent Hidden File Input */}
      <input
        ref={appFileInputRef}
        id="app-global-file-input"
        type="file"
        accept=".pdf,.txt,.text,.md,.markdown,.rtf,.html,.htm,.srt,.vtt,.json,.csv,.png,.jpg,.jpeg,.tiff,.tif,.bmp,.webp,application/pdf,text/*,image/*"
        className="sr-only"
        style={{ position: 'fixed', top: '-1000px', left: '-1000px', opacity: 0 }}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleProcessDroppedFile(file);
          }
          e.target.value = '';
        }}
      />

      {/* Universal Drag & Drop File Indicator */}
      {isDraggingFile && (
        <div className="absolute inset-0 bg-neutral-950/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-6 border-4 border-dashed border-amber-500 rounded-xl m-4 pointer-events-none animate-pulse">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Drop Document to Open</h2>
          <p className="text-sm text-neutral-300 max-w-md text-center">
            Supports <span className="text-amber-400 font-semibold">Text (.txt), Markdown (.md), Rich Text (.rtf), HTML, Subtitles (.srt/.vtt), JSON</span> without OCR, plus <span className="text-amber-400 font-semibold">PDFs and Scanned Images</span>.
          </p>
        </div>
      )}

      {/* Universal Top Bar - Covers both preview and thumbnails sidebar */}
      {!isReadingMode && (
        <div className="bg-neutral-900 border-b border-neutral-800 shrink-0 z-20 shadow-md">
          <div className="bg-[#333333] px-2.5 sm:px-3 py-1.5 flex items-center justify-between text-white font-mono text-xs md:text-sm font-bold shadow-inner">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              {/* Single Top Thumbnails / Pages Sidebar Toggle */}
              <button
                onClick={toggleSidebar}
                className={`px-2 py-1 rounded border transition-colors flex items-center gap-1.5 text-xs font-semibold shrink-0 cursor-pointer shadow-sm ${
                  isSidebarOpen
                    ? 'bg-neutral-800 border-neutral-600 text-neutral-200 hover:text-white hover:bg-neutral-700'
                    : 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                }`}
                title={`${isSidebarOpen ? 'Hide' : 'Show'} Page Thumbnails Sidebar (Shortcut: [ or Ctrl+B)`}
              >
                <PanelLeft className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-mono">Thumbnails</span>
              </button>

              <div className="flex items-center gap-1.5 tracking-wide text-[11px] sm:text-xs md:text-sm truncate">
                {/* Folio */}
                <span
                  className="cursor-help hover:text-amber-300 transition-colors underline decoration-dotted decoration-neutral-500 underline-offset-2"
                  title="Magazine Folio (Page Number) — The printed page number in the original magazine issue"
                >
                  Page {currentPage?.pageNumber || currentPageIndex + 1}
                </span>
                <span className="text-neutral-500">·</span>

                {/* Paragraph */}
                <span
                  className="cursor-help hover:text-amber-300 transition-colors underline decoration-dotted decoration-neutral-500 underline-offset-2"
                  title="Paragraph (¶) — The active paragraph chunk index out of total OCR paragraphs on this page [Navigate: Up/Down Arrow]"
                >
                  ¶ {currentChunkIndex + 1}/{Math.max(1, currentPage?.chunks?.length || 0)}
                </span>
                <span className="text-neutral-500">·</span>

                {/* Sentence */}
                <span
                  className="cursor-help hover:text-amber-300 transition-colors underline decoration-dotted decoration-neutral-500 underline-offset-2"
                  title="Sentence (sent) — The current spoken sentence index out of total sentences in the active paragraph [Navigate: Left/Right Arrow]"
                >
                  sent {currentSentenceIndex + 1}/{Math.max(1, currentSentences.length)}
                </span>
                <span className="text-neutral-500">·</span>

                {/* PDF Page */}
                <span
                  className="cursor-help hover:text-amber-300 transition-colors underline decoration-dotted decoration-neutral-500 underline-offset-2"
                  title="Document Page (p.) — The physical page number in this PDF document out of total pages [Navigate: PgUp/PgDn]"
                >
                  p.{currentPageIndex + 1}/{pages.length}
                </span>
              </div>

              {/* Playback status tag */}
              <span
                className="text-[10px] sm:text-[11px] font-sans font-normal opacity-90 px-1.5 py-0.2 rounded bg-neutral-900/60 border border-neutral-600 flex items-center gap-1 shrink-0 cursor-help"
                title={
                  isPlaying
                    ? 'Reading… — Speech synthesizer is actively reading aloud'
                    : isPaused
                    ? 'Paused — Audio speech is paused. Press Space to resume.'
                    : 'Ready — Standby. Press Space or click a paragraph to begin reading.'
                }
              >
                {isPlaying ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping inline-block" />
                    <span>Reading…</span>
                  </>
                ) : isPaused ? (
                  <span>Paused</span>
                ) : (
                  <span>Ready</span>
                )}
              </span>
            </div>

            {/* Right Side: Ad status & Settings/Controls Button */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Ad Page status in Position Bar */}
              {currentPage?.skipAsAd && (
                <div className="flex items-center gap-1.5 text-xs shrink-0">
                  <span
                    className="flex items-center gap-1 bg-amber-900/90 text-amber-200 border border-amber-600 px-1.5 py-0.2 rounded text-[10px] font-sans font-semibold cursor-help"
                    title="Ad Page — This page was identified as an advertisement insert and is automatically skipped during continuous reading. Press 'a' to toggle or view."
                  >
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    <span className="hidden sm:inline">Ad Page</span>
                  </span>
                  <button
                    onClick={nextPage}
                    className="px-1.5 py-0.2 rounded bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-[10px] font-sans font-medium flex items-center gap-0.5 border border-neutral-600"
                    title="Skip Ad (Skip) — Immediately advance to the next article page"
                  >
                    <span>Skip</span>
                    <SkipForward className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Open / Upload Document Button */}
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold shadow-sm transition-all shrink-0 cursor-pointer"
                title="Open or Upload Document (PDF, Text, Markdown, Image Scan OCR, Demo)"
              >
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs font-bold">Open File</span>
              </button>

              {/* Settings / Display Controls Button */}
              <button
                onClick={() => setIsDisplayControlsOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-600 hover:border-amber-400 text-xs font-semibold shadow-sm transition-all shrink-0 cursor-pointer"
                title="Display & View Controls Dialog — 2D space for layout modes, page fit, zoom slider, highlights & reading options [Key: D]"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-xs font-medium">Settings</span>
              </button>

              {/* Feature Help Question Mark Button */}
              <button
                onClick={() => setIsHelpOpen(true)}
                className="p-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-amber-400 border border-neutral-600 hover:border-amber-400 text-xs shadow-sm transition-all shrink-0 cursor-pointer"
                title="Feature Guide & Help (?) — Learn about OCR, AI proofreading, speech navigation, and document export"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Workspace: Sidebar + Draggable Divider + Visual Page Preview */}
      <div className="flex-1 flex overflow-hidden relative">
        {!isReadingMode && isSidebarOpen && (
          <div
            style={{ width: `${sidebarWidth}px` }}
            className="h-full shrink-0 flex overflow-hidden"
          >
            <PageListSidebar
              pages={pages}
              isSampleDocument={isSampleDocument}
              currentPageIndex={currentPageIndex}
              onSelectPage={handleSelectPage}
              onToggleSkipAd={handleToggleSkipAd}
              onToggleCollapse={toggleSidebar}
              onOpenUploadModal={() => setIsUploadModalOpen(true)}
              onLoadSample={handleLoadSample}
              width={sidebarWidth}
            />
          </div>
        )}

        {/* Draggable Divider */}
        {!isReadingMode && isSidebarOpen && (
          <div
            onMouseDown={handleDividerMouseDown}
            onDoubleClick={() => {
              setSidebarWidth(320);
              try {
                localStorage.setItem('ocr_sidebar_width', '320');
              } catch {}
            }}
            className={`w-1.5 hover:w-2 active:w-2 bg-neutral-800 hover:bg-amber-500 active:bg-amber-400 cursor-col-resize relative flex items-center justify-center transition-all select-none z-30 group shrink-0 ${
              isDraggingDivider ? 'bg-amber-500 w-2' : ''
            }`}
            title="Drag to resize sidebar & preview (Double-click to reset to 320px)"
          >
            <div className="w-0.5 h-8 rounded-full bg-neutral-600 group-hover:bg-neutral-950 group-active:bg-neutral-950 transition-colors" />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {documentLoadNotification && (
            <div className="bg-emerald-950/95 border-b border-emerald-500/70 px-4 py-2.5 text-xs text-emerald-200 flex items-center justify-between shrink-0 z-40 shadow-lg animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-xs sm:text-sm">{documentLoadNotification.filename}</span>
                  <span className="text-[11px] text-emerald-300 font-mono bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-700/50">
                    {documentLoadNotification.pageCount} Page{documentLoadNotification.pageCount === 1 ? '' : 's'} Loaded · {documentLoadNotification.type}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setDocumentLoadNotification(null)}
                className="px-2.5 py-1 rounded bg-emerald-900 hover:bg-emerald-800 text-emerald-200 hover:text-white text-[11px] font-mono border border-emerald-700 ml-3 shrink-0 cursor-pointer transition-colors"
              >
                ✕ Dismiss
              </button>
            </div>
          )}

          {quotaBanner && (
            <div className="bg-amber-950/90 border-b border-amber-600/60 px-3.5 py-2 text-xs text-amber-200 flex items-center justify-between shrink-0 z-30 shadow-md">
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-400">Notice:</span>
                <span className="text-[11px] sm:text-xs leading-tight">{quotaBanner.message}</span>
              </div>
              <button
                onClick={() => setQuotaBanner(null)}
                className="px-2 py-0.5 rounded bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] font-mono border border-neutral-700 ml-2 shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {isBackgroundProofreading && (
            <div className="bg-emerald-950/90 border-b border-emerald-600/60 px-3.5 py-2 text-xs text-emerald-200 flex items-center justify-between shrink-0 z-30 shadow-md animate-in fade-in duration-300">
              <div className="flex items-center gap-2.5">
                <div className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </div>
                <span className="font-semibold text-emerald-300 text-xs sm:text-sm">
                  {backgroundProofreadStatus || 'Proofreading whole document in background...'}
                </span>
                <span className="text-[10px] text-emerald-400 font-mono bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-700/50 hidden sm:inline">
                  Background Active · Speech Reading Uninterrupted
                </span>
              </div>
              <span className="text-[10px] text-emerald-300/80 font-mono">
                Background Worker Running
              </span>
            </div>
          )}

          {backgroundLoadingProgress && !backgroundLoadingProgress.isComplete && (
            <div className="bg-neutral-900/95 border-b border-amber-600/40 px-3.5 py-1.5 text-xs text-neutral-200 flex items-center justify-between shrink-0 z-30 shadow-sm animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="font-semibold text-amber-300 text-xs">
                  Loading pages in background: {backgroundLoadingProgress.current} / {backgroundLoadingProgress.total}
                </span>
                <span className="text-[10px] text-neutral-400 font-mono hidden sm:inline">
                  · First page preview ready & readable
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-amber-400 font-mono">
                  {Math.round((backgroundLoadingProgress.current / backgroundLoadingProgress.total) * 100)}%
                </span>
                <div className="w-24 bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-amber-500 h-full transition-all duration-150 rounded-full"
                    style={{
                      width: `${Math.round((backgroundLoadingProgress.current / backgroundLoadingProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <ReadingPreview
            key={`${documentName}-${currentPageIndex}`}
            currentPage={currentPage}
            currentChunkIndex={currentChunkIndex}
            currentSentenceIndex={currentSentenceIndex}
            currentSentenceText={currentSentenceText}
            isPlaying={isPlaying}
            isPaused={isPaused}
            currentPageIndex={currentPageIndex}
            totalPages={pages.length}
            totalChunks={currentPage?.chunks.length || 0}
            totalSentences={currentSentences.length}
            pages={pages}
            isProcessing={isProcessing}
            processingStatus={processingStatus}
            onRequestRenderPage={handleRequestRenderPage}
            showHighlights={showHighlights}
            onToggleHighlights={() => setShowHighlights((prev) => !prev)}
            onOcrCurrentPage={handleOcrCurrentPage}
            onSelectPage={handleSelectPage}
            onTogglePlay={togglePlay}
            onPrevSentence={rewindSentence}
            onNextSentence={() => advanceSentence(false)}
            onPrevChunk={prevChunk}
            onNextChunk={nextChunk}
            onPrevPage={prevPage}
            onNextPage={nextPage}
            onToggleSkipAsAd={handleToggleSkipAd}
            onSelectChunk={(idx) => {
              setCurrentChunkIndex(idx);
              setCurrentSentenceIndex(0);
              if (!isPlaying) {
                setIsPlaying(true);
                setIsPaused(false);
              }
            }}
            onSelectSentence={(chunkIdx, sentenceIdx) => {
              setCurrentChunkIndex(chunkIdx);
              setCurrentSentenceIndex(sentenceIdx);
              if (!isPlaying) {
                setIsPlaying(true);
                setIsPaused(false);
              }
            }}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={toggleSidebar}
            onCopyText={handleCopyText}
            onRunRuleCleaner={handleRunRuleCleaner}
            onRescanTesseract={handleRescanTesseract}
            isProofreading={isProofreading}
            isReadingMode={isReadingMode}
            onToggleReadingMode={toggleReadingMode}
            speechRate={speechRate}
            onChangeSpeechRate={setSpeechRate}
            skipNoiseHeaderFooter={skipNoiseHeaderFooter}
            onToggleSkipNoiseHeaderFooter={toggleSkipNoiseHeaderFooter}
            onOpenHelp={() => setIsHelpOpen(true)}
            onOpenUploadModal={() => setIsUploadModalOpen(true)}
            onLoadSample={handleLoadSample}
            isDisplayControlsOpen={isDisplayControlsOpen}
            onOpenDisplayControls={() => setIsDisplayControlsOpen(true)}
            onCloseDisplayControls={() => setIsDisplayControlsOpen(false)}
          />
        </div>
      </div>

      {/* Bottom Transport Controls (Hidden in Zen Reading Mode) */}
      {!isReadingMode && (
        <TransportControls
          isPlaying={isPlaying}
          isPaused={isPaused}
          onStop={stopPlayback}
          onTogglePlay={togglePlay}
          onPrevSentence={rewindSentence}
          onNextSentence={() => advanceSentence(false)}
          onPrevChunk={prevChunk}
          onNextChunk={nextChunk}
          onPrevPage={prevPage}
          onNextPage={nextPage}
          continueJump={continueJump}
          targetContinueFolio={targetContinueFolio}
          continuedFromFolio={currentPage?.continuedFrom[0] ?? null}
          onContinueAction={handleContinueAction}
          adJump={adJump}
          canJumpToAd={canJumpToAd}
          onAdAction={handleAdAction}
          onProofread={handleProofreadCurrentPage}
          onProofreadAll={handleProofreadAllPages}
          onOpenProofreadModal={() => setIsProofreadModalOpen(true)}
          isProofreading={isProofreading}
          llmConfig={llmConfig}
          onChangeLlmConfig={handleUpdateLlmConfig}
          onSaveArticle={handleSaveArticle}
          onSaveAllOcr={handleSaveAllOcr}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          onOpenLlmSettings={() => setIsLlmSettingsOpen(true)}
          voices={voices}
          selectedVoiceURI={selectedVoiceURI}
          onSelectVoice={setSelectedVoiceURI}
          speechRate={speechRate}
          onChangeSpeechRate={setSpeechRate}
          isReadingMode={isReadingMode}
          onToggleReadingMode={toggleReadingMode}
          skipNoiseHeaderFooter={skipNoiseHeaderFooter}
          onToggleSkipNoiseHeaderFooter={toggleSkipNoiseHeaderFooter}
          documentName={documentName}
          isSampleDocument={isSampleDocument}
          onLoadSample={handleLoadSample}
          onProcessFile={handleProcessDroppedFile}
          onUploadPdf={handleUploadPdf}
          onUploadImage={handleUploadImage}
          onUploadText={handleUploadText}
          onOpenUploadModal={() => setIsUploadModalOpen(true)}
          isProcessing={isProcessing}
          processingStatus={processingStatus}
          ocrLang={ocrLang}
          onChangeOcrLang={setOcrLang}
          onOpenInspector={() => setIsInspectorOpen(true)}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={toggleSidebar}
        />
      )}

      {/* Open / Upload Document Modal */}
      <OpenDocumentModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onProcessFile={handleProcessDroppedFile}
        onLoadSample={handleLoadSample}
        ocrLang={ocrLang}
        onChangeOcrLang={setOcrLang}
        currentDocName={documentName}
      />

      {/* Text Inspector & Export Modal */}
      <TextInspectorModal
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        pages={pages}
        currentPageIndex={currentPageIndex}
        onUpdatePageText={(idx, newText) => {
          setPages(prev => prev.map((p, i) => {
            if (i !== idx) return p;
            const newChunks = newText.split(/\n\s*\n/).map((par, pIdx) => ({
              text: par.trim(),
              left: p.chunks[0]?.left || 50,
              top: p.chunks[0]?.top || (50 + pIdx * 80),
              width: p.chunks[0]?.width || 500,
              height: p.chunks[0]?.height || 60,
            })).filter(c => c.text);
            return {
              ...p,
              proofreadText: newText,
              chunks: newChunks.length > 0 ? newChunks : p.chunks,
              isProofread: true,
            };
          }));
        }}
      />

      {/* Shortcut Cheat Sheet Modal */}
      <ShortcutHelpModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* Feature Help Modal */}
      <FeatureHelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />

      {/* Proofread Selection Modal */}
      <ProofreadSelectionModal
        isOpen={isProofreadModalOpen}
        onClose={() => setIsProofreadModalOpen(false)}
        onProofreadCurrent={handleProofreadCurrentPage}
        onProofreadAll={handleProofreadAllPages}
        onOpenSettings={() => setIsLlmSettingsOpen(true)}
        isProofreading={isProofreading || isBackgroundProofreading}
        llmConfig={llmConfig}
        totalPages={pages.length}
      />

      {/* AI Proofreading & Engine Settings Modal */}
      <LlmSettingsModal
        isOpen={isLlmSettingsOpen}
        onClose={() => setIsLlmSettingsOpen(false)}
        llmConfig={llmConfig}
        onChangeLlmConfig={handleUpdateLlmConfig}
      />
    </div>
  );
}
