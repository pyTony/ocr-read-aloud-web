import { PageUnit } from '../types';
import { looksLikeAd } from './adDetection';
import { parseContinuedFrom, parseContinuedOn } from './continueLinks';

const CONT_NOISE = /^\s*(?:continued\s+(?:on|from)|cont\.?\s+(?:on|from))/i;

export function sanitizeFilenameStem(title: string, maxLen: number = 80): string {
  let s = (title || '').trim();
  s = s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '');
  s = s.replace(/[\r\n]+/g, ' ');
  s = s.replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  if (!s) return 'untitled';
  if (s.length > maxLen) {
    s = s.slice(0, maxLen - 1).trimEnd() + '…';
  }
  return s;
}

export function inferPageTitle(page: PageUnit, fallback: string = 'untitled'): string {
  const texts = page.lines.map(l => l.text.trim()).filter(Boolean);
  if (!texts.length) {
    const rawLines = page.rawText.split('\n').map(l => l.trim()).filter(Boolean);
    texts.push(...rawLines);
  }

  const candidates: [number, string][] = [];
  for (let i = 0; i < Math.min(12, texts.length); i++) {
    const line = texts[i];
    if (CONT_NOISE.test(line)) continue;
    if (/^\d{1,4}$/.test(line)) continue;
    if (line.length < 3) continue;

    let score = 10.0 - i * 0.5;
    if (line.length >= 8 && line.length <= 60) score += 3.0;
    else if (line.length > 80) score -= 2.0;

    const letters = line.match(/[\p{L}]/gu) || [];
    const caps = letters.filter(c => c === c.toUpperCase()).length;
    if (letters.length && caps / letters.length > 0.7) {
      score += 2.0; // ALL-CAPS heading
    }
    if (/^[A-Z]/.test(line) && line.includes(' ') && !line.endsWith('.')) {
      score += 1.5;
    }

    candidates.push([score, line]);
  }

  if (!candidates.length) return fallback;
  candidates.sort((a, b) => b[0] - a[0]);
  return candidates[0][1];
}

/**
 * Gather page indices that form the article starting at startIdx
 * based on continuation cues.
 */
export function articlePageIndices(pages: PageUnit[], startIdx: number): number[] {
  if (startIdx < 0 || startIdx >= pages.length) return [];
  const result: number[] = [startIdx];
  const visited = new Set<number>([startIdx]);

  let currentIdx = startIdx;
  while (true) {
    const text = pages[currentIdx].rawText;
    const targets = parseContinuedOn(text);
    if (!targets.length) break;

    const targetFolio = targets[0];
    let nextIdx = -1;

    // Look for continued from cue matching target folio or page label
    for (let i = 0; i < pages.length; i++) {
      if (visited.has(i)) continue;
      const pText = pages[i].rawText;
      const froms = parseContinuedFrom(pText);
      if (froms.length > 0 || pages[i].label.includes(String(targetFolio))) {
        nextIdx = i;
        break;
      }
    }

    if (nextIdx >= 0 && !visited.has(nextIdx)) {
      visited.add(nextIdx);
      result.push(nextIdx);
      currentIdx = nextIdx;
    } else {
      break;
    }
  }

  return result;
}

export function formatPagesDump(pages: PageUnit[], indices?: number[]): string {
  const targetIndices = indices || pages.map((_, i) => i);
  const sections: string[] = [];

  for (const idx of targetIndices) {
    const p = pages[idx];
    const header = `=== ${p.label || `Page ${idx + 1}`} ===`;
    const body = p.proofreadText || p.rawText;
    sections.push(`${header}\n${body}`);
  }

  return sections.join('\n\n');
}
