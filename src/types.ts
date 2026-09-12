export interface OcrLine {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence?: number;
}

export interface PageUnit {
  pageNumber: number; // 1-based index
  label: string;      // e.g. "Page 1"
  image?: string;     // Data URL or object URL of rendered page
  width: number;      // Page coordinate width
  height: number;     // Page coordinate height
  lines: OcrLine[];
  chunks: OcrLine[];
  rawText: string;
  proofreadText?: string;
  isProofread: boolean;
  skipAsAd: boolean;
  adReasons: string[];
  inferredTitle: string;
  continuedOn: number[];
  continuedFrom: number[];
}

export interface PlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  currentPageIndex: number; // 0-based index in pages array
  currentChunkIndex: number;
  currentSentenceIndex: number;
  currentSentenceText: string;
  currentVoiceURI: string | null;
  speechRate: number; // 0.5 to 2.0
  pitch: number;
}

export interface ContinueJumpRecord {
  originPageIndex: number;
  originChunkIndex: number;
  originSentenceIndex: number;
  targetFolio: number;
}

export interface AdJumpRecord {
  originPageIndex: number;
  originChunkIndex: number;
  originSentenceIndex: number;
  adPageIndex: number;
}

export type LlmProvider = 'ollama' | 'openai' | 'gemini' | 'rules' | 'auto';

export interface LlmConfig {
  provider: LlmProvider;
  ollamaHost: string;
  ollamaModel: string;
  openaiHost: string;
  openaiModel: string;
}
