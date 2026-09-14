import { PageUnit } from '../types';
import { parseContinuedFrom, parseContinuedOn, pdfPageNumberFromLabel } from './continueLinks';

const AD_CUES = /(?:\b(?:advertisement|advertising|advertorial|sponsored|circle\s+(?:the\s+)?number|coupon|%\s*off|percent\s+off|discount|call\s+(?:now|today)|order\s+now|buy\s+now|limited\s+time|special\s+offer|subscribe\s+now|toll[\s-]*free|1[\s\-]*800|save\s+\$|free\s+shipping|while\s+supplies\s+last|act\s+now|buy|order|offer|price|shipping|money\s+order|cashier'?s\s+check|enclosed\s+is\s+my|ship\s+me\s+to|reader\s+service)\b|www\.|\$)/gi;
const SHOUT_WORDS = /\b(?:unbelievable|incredible|amazing|introducing|new!|only\s*\$)\b/gi;
const BANG_RUN = /!{3,}/;
const SENTENCE_END = /[.!?…]/g;
const FORM_AD = /(?:enclosed\s+is\s+my|cashier'?s\s+check|money\s+order|personal\s+check|ship\s+me\s+to|circle\s+the\s+number|reader\s+service|bingo\s+card)/i;

export function proseScore(text: string): number {
  const raw = (text || '').trim();
  if (!raw) return 0.0;
  const words = (raw.match(/[\p{L}]{2,}/gu) || []) as string[];
  if (!words.length) return 0.0;

  const sentences = Math.max(1, (raw.match(SENTENCE_END) || []).length);
  const totalChars = words.reduce((sum: number, w: string) => sum + w.length, 0);
  const avgLen = totalChars / words.length;
  const caps = words.filter((w: string) => w === w.toUpperCase() && w.length >= 3).length;
  const capsRatio = caps / words.length;

  let score = 0.0;
  score += Math.min(0.4, words.length / 80.0);
  score += Math.min(0.3, sentences / 6.0);
  score += avgLen >= 4.2 ? 0.2 : 0.0;
  score -= Math.min(0.4, capsRatio * 0.8);
  return Math.max(0.0, Math.min(1.0, score));
}

export function adWordDensity(text: string): number {
  const raw = (text || '').trim();
  if (!raw) return 0.0;
  const words = raw.match(/\S+/g) || [];
  if (!words.length) return 0.0;
  const cueHits = (raw.match(AD_CUES) || []).length;
  return cueHits / words.length;
}

export function looksLikeFormAd(page: PageUnit): boolean {
  const text = page.rawText;
  if (parseContinuedFrom(text).length > 0) return false;

  const unders = (text.match(/_{2,}/g) || []).length;
  if (unders >= 3) return true;
  if (unders >= 1 && FORM_AD.test(text)) return true;
  if (FORM_AD.test(text) && proseScore(text) < 0.55) return true;
  return false;
}

export function looksLikeAd(page: PageUnit): { isAd: boolean; reasons: string[] } {
  const text = page.rawText;
  const reasons: string[] = [];

  // Page 1 is the Cover of the document/magazine - NEVER classify Page 1 / Cover as an ad!
  const isCover = page.pageNumber === 1 || page.label === 'Page 1' || page.label.toLowerCase().includes('cover');
  if (isCover) {
    return { isAd: false, reasons: [] };
  }

  // Pages with continued from are never ads
  if (parseContinuedFrom(text).length > 0) {
    return { isAd: false, reasons: [] };
  }

  // Long article with continue on is not an ad
  if (parseContinuedOn(text).length > 0 && text.length > 250 && proseScore(text) >= 0.35) {
    return { isAd: false, reasons: [] };
  }

  const chars = text.trim().length;
  const adHits = (text.match(AD_CUES) || []).length;
  const prose = proseScore(text);
  const words = text.match(/\S+/g) || [];
  const caps = words.filter(w => w.length >= 3 && w === w.toUpperCase()).length;
  const density = adWordDensity(text);
  const alphaTokens = text.match(/[\p{L}]{2,}/gu) || [];
  const capsAlpha = alphaTokens.filter(w => w === w.toUpperCase() && w.length >= 2).length;
  const capsRatio = capsAlpha / Math.max(1, alphaTokens.length);
  const bangCount = (text.match(/!/g) || []).length;

  if (BANG_RUN.test(text) || bangCount >= 4) {
    reasons.push('Multiple exclamation marks (shouty promotional style)');
  }
  if (SHOUT_WORDS.test(text)) {
    reasons.push('Promotional shout keywords (introducing, only $, etc.)');
  }
  if (words.length < 80 && alphaTokens.length > 0 && capsRatio >= 0.25) {
    reasons.push('High proportion of all-caps advertising text');
  }
  if (adHits >= 2) {
    reasons.push(`Multiple commercial/ad cue keywords (${adHits} hits)`);
  }
  if (adHits >= 1 && chars < 450 && prose < 0.45) {
    reasons.push('Short text with ad cue and low prose score');
  }
  if (density >= 0.05 && words.length >= 12) {
    reasons.push('High density of advertising words (>=5%)');
  }
  if (looksLikeFormAd(page)) {
    reasons.push('Order form or subscription fill-in coupon layout');
  }

  const isAd = reasons.length > 0 || page.skipAsAd;
  return { isAd, reasons };
}

/**
 * Mid-article ad detection:
 * Detects if the next page (currentIdx + 1) is an advertisement insert
 * that interrupts an article continuing on currentIdx + 2.
 */
export function findAdSkip(
  pages: PageUnit[],
  currentIdx: number,
  sourceFolio: number | null,
  offset: number = 0
): { adIdx: number; contIdx: number; lineIdx: number } | null {
  if (currentIdx < 0 || currentIdx + 2 >= pages.length) return null;

  const adIdx = currentIdx + 1;
  const contIdx = currentIdx + 2;
  const adPage = pages[adIdx];
  const contPage = pages[contIdx];

  const sourceText = pages[currentIdx].rawText;
  const adText = adPage.rawText;
  const contText = contPage.rawText;

  // Never skip if next page continues this article
  const adFrom = parseContinuedFrom(adText);
  if (sourceFolio !== null && adFrom.includes(sourceFolio)) return null;
  if (adFrom.length > 0) return null;

  const contFrom = parseContinuedFrom(contText);
  const sourceOn = parseContinuedOn(sourceText);

  const curPdf = pdfPageNumberFromLabel(pages[currentIdx].label);
  const adPdf = pdfPageNumberFromLabel(adPage.label);
  const contPdf = pdfPageNumberFromLabel(contPage.label);

  const curPrinted = sourceFolio !== null ? sourceFolio : (curPdf !== null && offset ? curPdf - offset : curPdf);
  const contPrinted = contPdf !== null && offset ? contPdf - offset : contPdf;

  const linkedToSource =
    (curPrinted !== null && contFrom.includes(curPrinted)) ||
    (contPrinted !== null && sourceOn.includes(contPrinted));

  if (!linkedToSource) return null;

  const adCheck = looksLikeAd(adPage);
  if (!adCheck.isAd && !adPage.skipAsAd && proseScore(adText) >= 0.45 && adText.length > 400) {
    return null;
  }

  return {
    adIdx,
    contIdx,
    lineIdx: 0,
  };
}
