import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PageUnit, ContinueJumpRecord, AdJumpRecord, LlmConfig } from './types';
import { getSampleMagazinePages } from './lib/sampleDocument';
import { processPdfFile, processImageWithOcr } from './lib/ocrEngine';
import { splitIntoSentences } from './lib/layoutAndColumns';
import { cleanTextForSpeech, repairSplitWordsAndDehyphenate } from './lib/textClean';
import { findContinueLanding, parseContinuedOn } from './lib/continueLinks';
import { formatPagesDump, articlePageIndices, sanitizeFilenameStem } from './lib/articleExport';

import { Header } from './components/Header';
import { TransportControls } from './components/TransportControls';
import { ReadingPreview } from './components/ReadingPreview';
import { PageListSidebar } from './components/PageListSidebar';
import { TextInspectorModal } from './components/TextInspectorModal';
import { ShortcutHelpModal } from './components/ShortcutHelpModal';

export default function App() {
  // Document State
  const [documentName, setDocumentName] = useState<string>('BYTE Magazine (Aug 1976) · Speech Synthesis');
  const [pages, setPages] = useState<PageUnit[]>(() => getSampleMagazinePages());
  const [isSampleDocument, setIsSampleDocument] = useState<boolean>(true);
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

  // UI / Processing State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [ocrLang, setOcrLang] = useState<string>('eng');
  const [isProofreading, setIsProofreading] = useState<boolean>(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);

  // Local / Cloud LLM Settings
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({
    provider: 'auto',
    ollamaHost: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3.5:9b-q4_K_M',
    openaiHost: 'http://127.0.0.1:1234/v1',
    openaiModel: 'local-model',
  });

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

  const [isDraggingDivider, setIsDraggingDivider] = useState(false);

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

  // Sentences for current chunk
  const currentSentences = React.useMemo(() => {
    if (!currentChunk?.text) return [];
    return splitIntoSentences(currentChunk.text);
  }, [currentChunk]);

  // Update caption text when indices or sentences change
  useEffect(() => {
    if (currentSentences.length > 0 && currentSentenceIndex < currentSentences.length) {
      setCurrentSentenceText(currentSentences[currentSentenceIndex]);
    } else if (currentChunk?.text) {
      setCurrentSentenceText(currentChunk.text);
    } else {
      setCurrentSentenceText('');
    }
  }, [currentSentences, currentSentenceIndex, currentChunk]);

  // Stop playback cleanly
  const stopPlayback = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  // Forward sentence or wrap to next chunk/page
  const advanceSentence = useCallback((advanceAdPages = true) => {
    if (!currentPage) return;

    // Next sentence in same chunk
    if (currentSentenceIndex + 1 < currentSentences.length) {
      setCurrentSentenceIndex(prev => prev + 1);
      return;
    }

    // Next chunk in same page
    if (currentChunkIndex + 1 < currentPage.chunks.length) {
      setCurrentChunkIndex(prev => prev + 1);
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
        setCurrentPageIndex(landing.pageIndex);
        setCurrentChunkIndex(landing.chunkIndex);
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
      setCurrentPageIndex(nextP);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
    } else {
      // Reached end of document
      stopPlayback();
    }
  }, [currentPage, currentSentenceIndex, currentSentences.length, currentChunkIndex, currentPageIndex, pages, stopPlayback]);

  // Rewind sentence or jump to previous chunk/page
  // Accurately handles returning across continuation jumps (e.g. from p.126 back to last sentence on p.6)
  const rewindSentence = useCallback(() => {
    if (currentSentenceIndex > 0) {
      setCurrentSentenceIndex(prev => prev - 1);
      return;
    }

    if (currentChunkIndex > 0) {
      const prevChunkIdx = currentChunkIndex - 1;
      setCurrentChunkIndex(prevChunkIdx);
      const prevChunk = currentPage?.chunks[prevChunkIdx];
      const prevSentences = prevChunk ? splitIntoSentences(prevChunk.text) : [];
      setCurrentSentenceIndex(Math.max(0, prevSentences.length - 1));
      return;
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
        const lastChunkIdx = Math.max(0, originPage.chunks.length - 1);
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
      const lastChunkIdx = Math.max(0, prevPage.chunks.length - 1);
      setCurrentChunkIndex(lastChunkIdx);
      const lastChunk = prevPage.chunks[lastChunkIdx];
      const prevSentences = lastChunk ? splitIntoSentences(lastChunk.text) : [];
      setCurrentSentenceIndex(Math.max(0, prevSentences.length - 1));
    }
  }, [currentSentenceIndex, currentChunkIndex, currentPageIndex, currentPage, pages, continueJump]);

  // Core Speech Speaking Effect
  useEffect(() => {
    if (!isPlaying || isPaused || !currentSentenceText.trim()) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

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
  }, [isPlaying, isPaused, currentSentenceText, selectedVoiceURI, speechRate, voices, advanceSentence]);

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
    }
  }, [isPlaying]);

  // Paragraph navigation
  const prevChunk = () => {
    if (currentChunkIndex > 0) {
      setCurrentChunkIndex(prev => prev - 1);
      setCurrentSentenceIndex(0);
    } else {
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
          setCurrentPageIndex(originPageIdx);
          setCurrentChunkIndex(Math.max(0, originPage.chunks.length - 1));
          setCurrentSentenceIndex(0);
          return;
        }
      }
      let prevP = currentPageIndex - 1;
      while (prevP >= 0 && pages[prevP].skipAsAd && prevP > 0) {
        prevP--;
      }
      if (prevP >= 0) {
        setCurrentPageIndex(prevP);
        setCurrentChunkIndex(Math.max(0, pages[prevP].chunks.length - 1));
        setCurrentSentenceIndex(0);
      }
    }
  };

  const nextChunk = () => {
    if (currentPage && currentChunkIndex + 1 < currentPage.chunks.length) {
      setCurrentChunkIndex(prev => prev + 1);
      setCurrentSentenceIndex(0);
    } else if (currentPageIndex + 1 < pages.length) {
      setCurrentPageIndex(prev => prev + 1);
      setCurrentChunkIndex(0);
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
        setCurrentPageIndex(originPageIdx);
        setCurrentChunkIndex(0);
        setCurrentSentenceIndex(0);
        return;
      }
    }
    let prevP = currentPageIndex - 1;
    while (prevP >= 0 && pages[prevP].skipAsAd && prevP > 0) {
      prevP--;
    }
    if (prevP >= 0) {
      setCurrentPageIndex(prevP);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
    }
  };

  const nextPage = () => {
    if (currentPageIndex + 1 < pages.length) {
      setCurrentPageIndex(prev => prev + 1);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
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
      // Escape: Stop
      else if (e.code === 'Escape') {
        e.preventDefault();
        stopPlayback();
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
      // [ or Ctrl+B: Toggle Pages sidebar
      else if (e.key === '[' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b')) {
        e.preventDefault();
        toggleSidebar();
      }
      // ?: Shortcut help
      else if (e.key === '?') {
        e.preventDefault();
        setIsShortcutsOpen(true);
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
      setIsProcessing(false);
      setProcessingStatus('');
    }, 200);
  };

  // Upload PDF
  const handleUploadPdf = async (file: File) => {
    try {
      stopPlayback();
      setIsProcessing(true);
      setProcessingStatus(`Parsing PDF: ${file.name}...`);
      const pdfPages = await processPdfFile(file, (_cur, _total, status) => {
        setProcessingStatus(status);
      });
      setPages(pdfPages);
      setDocumentName(file.name);
      setIsSampleDocument(false);
      setCurrentPageIndex(0);
      setCurrentChunkIndex(0);
      setCurrentSentenceIndex(0);
      setContinueJump(null);
      setAdJump(null);
      setLastSkippedAdIndex(null);
    } catch (err: any) {
      console.error('PDF error:', err);
      alert(`Could not process PDF: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Upload Image with OCR
  const handleUploadImage = async (file: File, lang: string) => {
    try {
      stopPlayback();
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
    } catch (err: any) {
      console.error('Page OCR error:', err);
      alert(`Could not OCR page: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Proofread current page
  const handleProofreadCurrentPage = async () => {
    if (!currentPage || isProofreading) return;
    try {
      setIsProofreading(true);

      // 1. Direct browser-to-Ollama attempt (if provider is ollama or auto with local host)
      if (llmConfig.provider === 'ollama') {
        const cleanHost = (llmConfig.ollamaHost || 'http://localhost:11434').replace(/\/+$/, '');
        try {
          const directCtrl = new AbortController();
          const tid = setTimeout(() => directCtrl.abort(), 60000);
          const directRes = await fetch(`${cleanHost}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: llmConfig.ollamaModel || 'qwen3.5:9b-q4_K_M',
              prompt: `You are an expert OCR proofreader and editor for scanned publications.
PRIMARY MANDATE: AGGRESSIVELY REPAIR SPLIT WORDS AND DEHYPHENATE.
1. End-of-line or hyphenated word splits: Merge broken words dropping the hyphen (e.g. "micro- processor" -> "microprocessor", "com- puter" -> "computer", "pro- gramming" -> "programming", "syn- thesis" -> "synthesis", "inter- face" -> "interface", "cir- cuits" -> "circuits", "tieto- kone" -> "tietokone", "järjes- telmä" -> "järjestelmä"). Keep true compounds like "state-of-the-art".
2. Accidental spaces inside words: Merge accidental spaces inside words (e.g. "do ing" -> "doing", "mag az in e" -> "magazine", "speec h" -> "speech", "oper ation" -> "operation", "com puter" -> "computer").
3. Preserve reading order and meaning. Do NOT summarize or invent text.
4. If this page is strictly an advertisement, prefix with [[SKIP_AS_AD]]. Return plain text only.

Document/Page: ${currentPage.label}

OCR TEXT TO PROOFREAD:
${currentPage.rawText}`,
              stream: false,
            }),
            signal: directCtrl.signal,
          });
          clearTimeout(tid);

          if (directRes.ok) {
            const directData = await directRes.json();
            const output = (directData.response || '').trim() || currentPage.rawText;
            const isAd = output.startsWith('[[SKIP_AS_AD]]');
            const rawCleaned = isAd ? output.replace(/^\[\[SKIP_AS_AD\]\]\s*/, '').trim() : output;
            const cleaned = repairSplitWordsAndDehyphenate(rawCleaned);

            setPages(prev => prev.map((p, idx) => {
              if (idx === currentPageIndex) {
                return {
                  ...p,
                  proofreadText: cleaned,
                  isProofread: true,
                  skipAsAd: isAd || p.skipAsAd,
                };
              }
              return p;
            }));
            return;
          }
        } catch (directErr: any) {
          console.log('Direct browser Ollama request did not succeed, trying server route...', directErr);
        }
      }

      // 2. Server route (Google Gemini, Cloud proxy, or local Node runtime)
      const res = await fetch('/api/proofread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: currentPage.rawText,
          pageLabel: currentPage.label,
          provider: llmConfig.provider,
          ollamaHost: llmConfig.ollamaHost,
          ollamaModel: llmConfig.ollamaModel,
          openaiHost: llmConfig.openaiHost,
          openaiModel: llmConfig.openaiModel,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Proofreading request failed (${res.status})`);
      }
      const data = await res.json();
      const cleanedServerText = repairSplitWordsAndDehyphenate(data.proofreadText || '');

      setPages(prev => prev.map((p, idx) => {
        if (idx === currentPageIndex) {
          return {
            ...p,
            proofreadText: cleanedServerText,
            isProofread: true,
            skipAsAd: data.isAd || p.skipAsAd,
          };
        }
        return p;
      }));
    } catch (err: any) {
      console.error('Proofread failed:', err);
      alert(`Proofreading note: ${err.message}\n\nTip: For local Ollama, ensure it was started with web access: OLLAMA_ORIGINS="*" ollama serve, or select Google Gemini 2.5 Flash in LLM Settings.`);
    } finally {
      setIsProofreading(false);
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

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden select-none">
      {/* Top Header */}
      <Header
        documentName={documentName}
        isSampleDocument={isSampleDocument}
        onLoadSample={handleLoadSample}
        onUploadPdf={handleUploadPdf}
        onUploadImage={handleUploadImage}
        isProcessing={isProcessing}
        processingStatus={processingStatus}
        ocrLang={ocrLang}
        onChangeOcrLang={setOcrLang}
        onOpenInspector={() => setIsInspectorOpen(true)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={toggleSidebar}
      />

      {/* Main Content Workspace: Sidebar + Draggable Divider + Visual Page Preview */}
      <div className="flex-1 flex overflow-hidden relative">
        {isSidebarOpen && (
          <div
            style={{ width: `${sidebarWidth}px` }}
            className="h-full shrink-0 flex overflow-hidden"
          >
            <PageListSidebar
              pages={pages}
              isSampleDocument={isSampleDocument}
              currentPageIndex={currentPageIndex}
              onSelectPage={(idx) => {
                setCurrentPageIndex(idx);
                setCurrentChunkIndex(0);
                setCurrentSentenceIndex(0);
              }}
              onToggleSkipAd={handleToggleSkipAd}
              onToggleCollapse={toggleSidebar}
              width={sidebarWidth}
            />
          </div>
        )}

        {/* Draggable Divider */}
        {isSidebarOpen && (
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
          <ReadingPreview
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
            showHighlights={showHighlights}
            onToggleHighlights={() => setShowHighlights((prev) => !prev)}
            onOcrCurrentPage={handleOcrCurrentPage}
            onSelectPage={(idx) => {
              setCurrentPageIndex(idx);
              setCurrentChunkIndex(0);
              setCurrentSentenceIndex(0);
            }}
            onTogglePlay={togglePlay}
            onPrevSentence={rewindSentence}
            onNextSentence={() => advanceSentence(false)}
            onToggleSkipAsAd={handleToggleSkipAd}
            onNextPage={nextPage}
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
          />
        </div>
      </div>

      {/* Bottom Transport Controls */}
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
        isProofreading={isProofreading}
        llmConfig={llmConfig}
        onChangeLlmConfig={setLlmConfig}
        onSaveArticle={handleSaveArticle}
        onSaveAllOcr={handleSaveAllOcr}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        voices={voices}
        selectedVoiceURI={selectedVoiceURI}
        onSelectVoice={setSelectedVoiceURI}
        speechRate={speechRate}
        onChangeSpeechRate={setSpeechRate}
      />

      {/* Text Inspector & Export Modal */}
      <TextInspectorModal
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        pages={pages}
        currentPageIndex={currentPageIndex}
        onUpdatePageText={(idx, newText) => {
          setPages(prev => prev.map((p, i) => i === idx ? { ...p, proofreadText: newText, isProofread: true } : p));
        }}
      />

      {/* Shortcut Cheat Sheet Modal */}
      <ShortcutHelpModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}
