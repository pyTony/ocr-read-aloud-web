/**
 * Shared text cleanup for OCR / PDF lines before speech.
 * Ported faithfully from ocr_read_aloud/text_clean.py
 */

const EOL_HYPHEN = /^(.*?[\p{L}\d])[\-\u00ad]\s*$/u;
const INLINE_DEHYPHEN = /([\p{L}\d])[\-\u00ad]\s+([a-zà-öø-ÿ][\p{L}\d\-]*)/u;

const COMPOUND_NEXT = new Set([
  "a", "an", "and", "as", "at", "based", "by", "for", "from",
  "in", "like", "of", "on", "or", "the", "to", "with"
]);

function firstToken(s: string): string {
  const m = s.match(/[\p{L}\d]+/u);
  return m ? m[0].toLowerCase() : "";
}

/**
 * Join line strings into one paragraph, removing end-of-line hyphenation.
 */
export function joinLinesDehyphenate(lines: string[]): string {
  const cleaned = lines.map(ln => (ln || "").trimEnd()).filter(ln => ln.trim().length > 0);
  if (!cleaned.length) return "";

  let out = cleaned[0];
  for (let i = 1; i < cleaned.length; i++) {
    const nxt = cleaned[i];
    const nxtS = nxt.trimStart();
    if (!nxtS) continue;

    if (".,;:!?%)]}".includes(nxtS[0]) || nxtS.startsWith("'") || nxtS.startsWith("’")) {
      out = out.trimEnd() + nxtS;
      continue;
    }

    const m = out.match(EOL_HYPHEN);
    if (m && /^\p{L}/u.test(nxtS)) {
      const head = m[1];
      const tok = firstToken(nxtS);
      const isLower = nxtS[0] === nxtS[0].toLowerCase() && nxtS[0] !== nxtS[0].toUpperCase();

      if (isLower && !COMPOUND_NEXT.has(tok)) {
        // End-of-line split: drop hyphen, no space
        out = head + nxtS;
      } else {
        // Capital or compound connector: keep hyphen
        out = head + "-" + nxtS;
      }
    } else {
      out = out.trimEnd() + " " + nxtS;
    }
  }

  return out.trim();
}

/**
 * Remove hyphen + whitespace splits inside already-joined text.
 */
export function dehyphenateInline(text: string): string {
  if (!text) return "";
  let cur = text.replace(/\u00ad/g, "");
  let prev = "";

  for (let i = 0; i < 32; i++) {
    if (cur === prev) break;
    prev = cur;
    cur = cur.replace(INLINE_DEHYPHEN, (_match, a, b) => {
      const tok = firstToken(b);
      if (COMPOUND_NEXT.has(tok)) {
        return `${a}-${b}`;
      }
      return `${a}${b}`;
    });
  }
  return cur;
}

const COMMON_PREFIXES_REGEX = /\b(micro|macro|inter|intra|multi|ultra|super|semi|anti|auto|tele|trans|sub|pseudo|mono|poly|omni|tieto|ohjel|puheen|lait|järjes|kirjoi|elektroniik)\s+([a-zà-öø-ÿäöå][\p{L}\d]*)\b/giu;

const COMMON_SUFFIXES_REGEX = /\b([a-zà-öø-ÿäöå]{3,})\s+(ing|tion|tions|ation|ations|ment|ments|able|ible|ness|less|ful|fully|sion|sions|ity|ities|ized|izing|ally)\b/giu;

// Common technical and publication words frequently broken with spaces by OCR scanners
const COMMON_SPLIT_WORDS: [RegExp, string][] = [
  [/\b(cir)\s+(cuits?)\b/giu, "$1$2"],
  [/\b(syn)\s+(thesi[sz]ers?|thetic|thesis)\b/giu, "$1$2"],
  [/\b(soft|hard)\s+(wares?)\b/giu, "$1$2"],
  [/\b(key)\s+(boards?)\b/giu, "$1$2"],
  [/\b(data)\s+(base[s]?)\b/giu, "$1$2"],
  [/\b(byte)\s+(savers?)\b/giu, "$1$2"],
  [/\b(star)\s+(ships?)\b/giu, "$1$2"],
  [/\b(fre)\s+(quenc(?:y|ies))\b/giu, "$1$2"],
  [/\b(sig)\s+(nals?)\b/giu, "$1$2"],
  [/\b(os)\s+(cillat(?:or|ors|ion))\b/giu, "$1$2"],
  [/\b(re)\s+(gist(?:er|ers|ered|ration))\b/giu, "$1$2"],
  [/\b(me)\s+(mor(?:y|ies))\b/giu, "$1$2"],
  [/\b(ca)\s+(paci(?:ty|tor|tors|tance))\b/giu, "$1$2"],
  [/\b(con)\s+(troll?ers?|trols?|trolled|trolling)\b/giu, "$1$2"],
  [/\b(trans)\s+(fer|fers|ferred|ferring)\b/giu, "$1$2"],
  [/\b(dia)\s+(grams?)\b/giu, "$1$2"],
  [/\b(wave)\s+(forms?)\b/giu, "$1$2"],
  [/\b(mag)\s+(azines?)\b/giu, "$1$2"],
  [/\b(pub)\s+(licat(?:ion|ions))\b/giu, "$1$2"],
  [/\b(pro)\s+(gramm?ers?|gramm?ing|grams?)\b/giu, "$1$2"],
  [/\b(com)\s+(puters?|puting)\b/giu, "$1$2"],
];

// Broken single-character splits caused by OCR scanner tracking
const BROKEN_INITIAL_LETTER = /\b(t|w|a|t|h)\s+(he|hat|his|hese|hose|ith|ere|hen|hich|nd|ave|ad|as)\b/giu;
const BROKEN_TERMINAL_LETTER = /\b(speec|whic|wit|eac|muc|suc|researc|approac|pitc|catc|matc|switc)\s+(h)\b/giu;
const BROKEN_ER_SUFFIX = /\b(compute|printe|characte|generato|buffe|use|membe|autho|develope)\s+(r)\b/giu;
const BROKEN_T_SUFFIX = /\b(circui|outpu|inpu|uni|digi|forma|curren)\s+(t)\b/giu;

/**
 * Robust, comprehensive split-word repair and dehyphenation.
 * Merges words broken by hyphens, newlines, or accidental OCR spaces.
 */
export function repairSplitWordsAndDehyphenate(text: string): string {
  if (!text) return "";
  let t = text;

  // 1. Remove soft hyphens and zero-width spaces
  t = t.replace(/\u00ad/g, "").replace(/\u200b/g, "");

  // 2. End-of-line hyphens across line breaks: "micro-\nprocessor" -> "microprocessor"
  t = t.replace(/([\p{L}\d]+)[\-\u2010\u2013]\s*[\r\n]+\s*([\p{L}\d]+)/gu, (_match, p1, p2) => {
    const tok = firstToken(p2);
    if (p2[0] === p2[0].toLowerCase() && !COMPOUND_NEXT.has(tok)) {
      return `${p1}${p2}`;
    }
    // All-caps continuation (e.g. "MICRO-\nPROCESSOR")
    if (p1 === p1.toUpperCase() && p2 === p2.toUpperCase() && p1.length > 1 && p2.length > 1) {
      return `${p1}${p2}`;
    }
    return `${p1}-${p2}`;
  });

  // 3. Inline hyphenated splits: "syn- thesis" -> "synthesis", "com- puter" -> "computer"
  t = dehyphenateInline(t);

  // 4. Space-hyphen-space splits: "micro - processor" -> "microprocessor"
  t = t.replace(/([\p{L}\d]{2,})\s+[\-\u2010\u2013]\s+([a-zà-öø-ÿäöå][\p{L}\d]*)/gu, (_match, p1, p2) => {
    const tok = firstToken(p2);
    if (COMPOUND_NEXT.has(tok)) {
      return `${p1}-${p2}`;
    }
    return `${p1}${p2}`;
  });

  // 5. Common prefixes detached by OCR spacing: "micro processor" -> "microprocessor"
  t = t.replace(COMMON_PREFIXES_REGEX, (_match, p1, p2) => {
    return `${p1}${p2}`;
  });

  // 6. Common suffixes detached by OCR spacing: "comput ing" -> "computing"
  t = t.replace(COMMON_SUFFIXES_REGEX, (_match, p1, p2) => {
    return `${p1}${p2}`;
  });

  // 7. Frequent technical broken words
  for (const [pat, repl] of COMMON_SPLIT_WORDS) {
    t = t.replace(pat, repl);
  }

  // 8. Broken single-letter syllables: "speec h" -> "speech", "t he" -> "the"
  t = t.replace(BROKEN_INITIAL_LETTER, "$1$2");
  t = t.replace(BROKEN_TERMINAL_LETTER, "$1$2");
  t = t.replace(BROKEN_ER_SUFFIX, "$1$2");
  t = t.replace(BROKEN_T_SUFFIX, "$1$2");

  return t;
}

const FORM_BLANKS: [RegExp, string][] = [
  [/\$\s*_{2,}/g, " dollar amount here "],
  [/\bNAME\s*_{2,}/gi, " your name here "],
  [/\bADDRESS\s*_{2,}/gi, " your address here "],
  [/\b(?:ZIP(?:\s*CODE)?|POSTAL\s*CODE)\s*_{2,}/gi, " ZIP code here "],
  [/\bCITY\s*_{2,}/gi, " city here "],
  [/\b(?:PHONE|TEL(?:EPHONE)?)\s*_{2,}/gi, " phone number here "],
  [/\bE-?MAIL\s*_{2,}/gi, " email here "],
  [/\b(?:COMPANY|ORG(?:ANIZATION)?)\s*_{2,}/gi, " company name here "],
  [/\bDATE\s*_{2,}/gi, " date here "],
  [/\bSIGNATURE\s*_{2,}/gi, " signature here "],
  [/_{2,}/g, " "],
];

export function expandFormBlanks(text: string): string {
  if (!text || !text.includes("_")) return text || "";
  let out = text;
  for (const [pat, repl] of FORM_BLANKS) {
    out = out.replace(pat, repl);
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

const TRAILING_SIGN = /(\d+[.,]\d+)\s*([-−+])(?=$|\s|[,;.)\]])/g;

export function normalizeAccountingSigns(text: string): string {
  if (!text || !/[-−+]/.test(text)) return text;
  return text.replace(TRAILING_SIGN, (_match, num, sign) => {
    const s = sign === "+" ? "+" : "-";
    return `${s}${num}`;
  });
}

const CONTRACTIONS: Record<string, string> = {
  "you'll": "you will", "we'll": "we will", "they'll": "they will",
  "i'll": "I will", "he'll": "he will", "she'll": "she will",
  "it'll": "it will", "that'll": "that will", "there'll": "there will",
  "you're": "you are", "we're": "we are", "they're": "they are",
  "it's": "it is", "that's": "that is", "what's": "what is",
  "who's": "who is", "here's": "here is", "there's": "there is",
  "let's": "let us",
  "you've": "you have", "we've": "we have", "they've": "they have",
  "i've": "I have",
  "you'd": "you would", "we'd": "we would", "i'd": "I would",
  "don't": "do not", "doesn't": "does not", "didn't": "did not",
  "won't": "will not", "wouldn't": "would not", "can't": "cannot",
  "couldn't": "could not", "shouldn't": "should not",
  "isn't": "is not", "aren't": "are not",
  "wasn't": "was not", "weren't": "were not",
  "haven't": "have not", "hasn't": "has not", "hadn't": "had not",
};

export function expandContractions(text: string): string {
  if (!text) return text;
  const t = text.replace(/[\u2018\u2019]/g, "'");
  return t.replace(/\b[A-Za-z]+(?:'[a-z]+|n't)\b/g, (match) => {
    const low = match.toLowerCase();
    const exp = CONTRACTIONS[low];
    if (!exp) return match;
    if (match[0] === match[0].toUpperCase() && exp[0] !== exp[0].toUpperCase()) {
      return exp[0].toUpperCase() + exp.slice(1);
    }
    return exp;
  });
}

const ABBREVIATIONS: Record<string, string> = {
  ea: "each", etc: "et cetera", vs: "versus",
  approx: "approximately", dept: "department", est: "established",
  ft: "feet", lb: "pounds", oz: "ounces", pt: "point",
  sec: "second", sq: "square",
  jan: "January", feb: "February", mar: "March", apr: "April",
  jun: "June", jul: "July", aug: "August",
  sep: "September", sept: "September", oct: "October",
  nov: "November", dec: "December",
};

const ABBREV_REGEX = new RegExp(
  "\\b(" + Object.keys(ABBREVIATIONS).join("|") + ")\\b\\.?",
  "gi"
);

const NUMERIC_ABBREVIATIONS: [RegExp, string][] = [
  [/\bNo\.\s*(?=\d)/gi, "Number "],
  [(/(?<=\d)\s*in\.(?=\s|$)/gi), " inches"],
  [/\bca\.\s*(?=\d)/gi, "about "],
  [(/(?<=\d)\s*"/g), " inches"],
  [(/(?<=\d)\s*'(?!\w)/g), " feet"],
];

export function expandAbbreviations(text: string): string {
  if (!text) return text;
  let t = text.replace(ABBREV_REGEX, (match, word) => {
    const exp = ABBREVIATIONS[word.toLowerCase()];
    if (!exp) return match;
    if (word[0] === word[0].toUpperCase() && exp[0] !== exp[0].toUpperCase()) {
      return exp[0].toUpperCase() + exp.slice(1);
    }
    return exp;
  });

  t = t.replace(/\bi\.e\.?\b/gi, "that is");
  for (const [pat, repl] of NUMERIC_ABBREVIATIONS) {
    t = t.replace(pat, repl);
  }
  return t;
}

export function sanitizeForSpeech(text: string): string {
  if (!text) return text;
  let t = text;
  // Normalize quotes
  t = t.replace(/["""]/g, "").replace(/[''’]/g, "'");
  // Possessives: word's -> words
  t = t.replace(/\b([A-Za-z]+)'s\b/g, "$1s");
  // Mid-word apostrophe
  t = t.replace(/(\w)'(\w)/g, "$1$2");
  return t;
}

const LONG_DASH_RUN = /[-\u2013\u2014]{4,}/;
const MIDWORD_PUNCT = /\w["'(),;:](?!\s|$)/g;
const GARBAGE_COMMON_SHORT = new Set([
  "a", "i", "an", "am", "pm", "no", "in", "on", "at", "to", "of", "or",
  "is", "it", "as", "by", "up", "so", "ok", "us", "we", "ea", "ft",
  "lb", "oz", "pt", "sq", "vs", "dc", "ac", "hz",
]);

export function looksLikeSpeechGarbage(text: string): boolean {
  const t = (text || "").trim();
  if (!t || t.length < 8) return false;
  if (LONG_DASH_RUN.test(t)) return true;

  const tokens = t.split(/\s+/);
  if (!tokens.length) return false;

  const tiny = tokens.filter(w => {
    const clean = w.replace(/[^\w]/g, "");
    return clean.length <= 2 && !GARBAGE_COMMON_SHORT.has(clean.toLowerCase());
  }).length;

  const tinyRatio = tiny / tokens.length;
  const midwordHits = (t.match(MIDWORD_PUNCT) || []).length;
  const alphaChars = (t.match(/\p{L}/gu) || []).length;
  const alphaRatio = alphaChars / Math.max(1, t.length);

  let signals = 0;
  if (tinyRatio > 0.45) signals++;
  if (midwordHits >= 3) signals++;
  if (alphaRatio < 0.35) signals++;

  return signals >= 2;
}

/**
 * Full pre-speech normalization pipeline
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return "";
  let t = text;
  t = repairSplitWordsAndDehyphenate(t);
  t = expandFormBlanks(t);
  t = normalizeAccountingSigns(t);
  t = expandContractions(t);
  t = expandAbbreviations(t);
  t = sanitizeForSpeech(t);
  return t.replace(/[ \t]{2,}/g, " ").trim();
}
