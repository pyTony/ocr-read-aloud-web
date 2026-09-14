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

// Valid standalone short English words that must NOT be merged blindly into adjacent words
const VALID_STANDALONE_SHORT_WORDS = new Set([
  // 1 letter
  "a", "i",
  // 2 letters
  "am", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it",
  "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "re", "hi", "ok", "ex", "ox",
  // 3 letters
  "all", "and", "any", "are", "bad", "bar", "bed", "big", "bit", "box", "boy", "bus",
  "but", "buy", "can", "car", "cat", "cut", "day", "did", "dog", "dry", "due", "ear",
  "eat", "end", "eye", "far", "few", "fit", "fly", "for", "get", "god", "got", "guy",
  "had", "has", "hat", "her", "him", "his", "hit", "how", "its", "job", "key", "kid",
  "law", "lay", "let", "lot", "low", "man", "may", "new", "not", "now", "off", "old",
  "one", "our", "out", "own", "pay", "per", "put", "red", "run", "saw", "say", "see",
  "set", "she", "sir", "sit", "six", "son", "sun", "ten", "the", "too", "top", "try",
  "two", "use", "war", "way", "who", "why", "win", "yes", "yet", "you",
  // 4 letters
  "also", "best", "both", "call", "came", "care", "case", "cost", "data", "deal",
  "does", "done", "down", "each", "even", "fact", "fast", "find", "fine", "fire",
  "form", "free", "full", "game", "gave", "give", "good", "hand", "hard", "have",
  "help", "here", "high", "home", "hope", "idea", "just", "keep", "kind", "know",
  "land", "last", "late", "left", "less", "life", "like", "line", "list", "long",
  "look", "love", "make", "many", "mind", "most", "move", "much", "must", "name",
  "need", "next", "open", "part", "plan", "play", "post", "real", "same", "seem",
  "show", "side", "some", "such", "take", "team", "tell", "text", "than", "that",
  "them", "then", "they", "this", "time", "true", "turn", "type", "unit", "view",
  "want", "week", "well", "went", "were", "what", "when", "will", "with", "word",
  "work", "year"
]);

/**
 * Reassembles runs of short OCR syllables/fragments into complete words.
 * Strictly skips joining if the run contains valid English standalone words (e.g. "our prices are the lowest in the industry").
 * e.g. "co m p ut er" -> "computer"
 */
export function repairGenericSpacedSyllables(text: string): string {
  if (!text) return "";
  return text.replace(/(?:^|\s)((?:[a-zA-Z]{1,3}\s+){2,}[a-zA-Z]{1,3})(?=\s|[.,;:!?]|$)/g, (match, chunkRun) => {
    const tokens = chunkRun.split(/\s+/);
    // Count valid English short words present in the sequence
    const validWordCount = tokens.filter(tok => VALID_STANDALONE_SHORT_WORDS.has(tok.toLowerCase())).length;
    
    // If ANY valid English words exist in this sequence (or if all/most tokens are valid words),
    // DO NOT merge them together!
    if (validWordCount === 0) {
      const joined = tokens.join('');
      if (joined.length >= 4) {
        return match.startsWith(" ") ? ` ${joined}` : joined;
      }
    }
    return match;
  });
}

/**
 * Repair OCR syllable fragment splits, space-fragmented words, and common OCR character typos.
 * e.g. "lin eof" -> "line of", "homc" -> "home", "co m p ut er" -> "computer",
 * "ex pc rimc nt a ti on" -> "experimentation", "th e" -> "the", "wh o" -> "who", "des ign" -> "design"
 */
export function repairOcrSyllablesAndTypos(text: string): string {
  if (!text) return "";
  let t = text;

  // 1. Line of / Line eof / Line e
  t = t.replace(/\blin\s*e\s*of\b/gi, "line of");
  t = t.replace(/\blin\s*eof\b/gi, "line of");
  t = t.replace(/\blin\s+e\b/gi, "line");

  // Common final 'c' misread as 'e' in OCR
  t = t.replace(/\b(homc|timc|somc|namc|samc|makc|takc|comc|havc|givc|pagc|linc|widc|lifc|wifc|drivc|sidc)\b/gi, (match) => {
    return match.slice(0, -1) + 'e';
  });

  // Computer / Microprocessor / Experimentation
  t = t.replace(/\bco\s+m\s+p\s+ut\s+er\b/gi, "computer");
  t = t.replace(/\bcom\s+put\s+er\b/gi, "computer");
  t = t.replace(/\bco\s+mpu\s+ter\b/gi, "computer");
  t = t.replace(/\bc\s+o\s+m\s+p\s+u\s+t\s+e\s+r\b/gi, "computer");
  t = t.replace(/\bcom\s+put\s+ers\b/gi, "computers");

  t = t.replace(/\bex\s+pc?\s*rimc?\s*nt\s*a?\s*ti\s*on\b/gi, "experimentation");
  t = t.replace(/\bex\s+per\s+i\s+men\s+ta\s+tion\b/gi, "experimentation");
  t = t.replace(/\bex\s+peri\s+men\s+ta\s+tion\b/gi, "experimentation");
  t = t.replace(/\bex\s+per\s+i\s+ment\s+a\s+tion\b/gi, "experimentation");
  t = t.replace(/\bex\s+per\s+i\s+ment\b/gi, "experiment");
  t = t.replace(/\bex\s+pc\s+rimc\s+nt\b/gi, "experiment");

  // Short syllable splits
  t = t.replace(/\bth\s+e\b/gi, "the");
  t = t.replace(/\bwh\s+o\b/gi, "who");
  t = t.replace(/\bwh\s+at\b/gi, "what");
  t = t.replace(/\bwh\s+ere\b/gi, "where");
  t = t.replace(/\bwh\s+ich\b/gi, "which");
  t = t.replace(/\bwh\s+en\b/gi, "when");
  t = t.replace(/\bth\s+at\b/gi, "that");
  t = t.replace(/\bth\s+is\b/gi, "this");
  t = t.replace(/\bth\s+ese\b/gi, "these");
  t = t.replace(/\bth\s+ose\b/gi, "those");
  t = t.replace(/\bth\s+eir\b/gi, "their");
  t = t.replace(/\bth\s+ere\b/gi, "there");
  t = t.replace(/\bsh\s+e\b/gi, "she");
  t = t.replace(/\bdes\s+ign\b/gi, "design");
  t = t.replace(/\bdes\s+igns\b/gi, "designs");
  t = t.replace(/\bdes\s+igned\b/gi, "designed");
  t = t.replace(/\bdes\s+igning\b/gi, "designing");
  t = t.replace(/\bper\s+son\b/gi, "person");
  t = t.replace(/\bper\s+sons\b/gi, "persons");
  t = t.replace(/\bstart\s+ed\b/gi, "started");
  t = t.replace(/\bwrit\s+es\b/gi, "writes");
  t = t.replace(/\bwrit\s+ing\b/gi, "writing");
  t = t.replace(/\ban\s+d\b/gi, "and");

  // Technical terms
  t = t.replace(/\bmi\s+cro\s+pro\s+ces\s+sors?\b/gi, (m) => m.endsWith('s') ? "microprocessors" : "microprocessor");
  t = t.replace(/\bmicro\s+pro\s+cessors?\b/gi, (m) => m.endsWith('s') ? "microprocessors" : "microprocessor");
  t = t.replace(/\belec\s+tron\s+ics?\b/gi, (m) => m.endsWith('s') ? "electronics" : "electronic");
  t = t.replace(/\bpro\s+gram\s+ming\b/gi, "programming");
  t = t.replace(/\bpro\s+gram\s+mers?\b/gi, (m) => m.endsWith('s') ? "programmers" : "programmer");
  t = t.replace(/\bsyn\s+the\s+si\s+zers?\b/gi, (m) => m.endsWith('s') ? "synthesizers" : "synthesizer");
  t = t.replace(/\bin\s+ter\s+fa\s+ces?\b/gi, (m) => m.endsWith('s') ? "interfaces" : "interface");
  t = t.replace(/\bkey\s+boards?\b/gi, (m) => m.endsWith('s') ? "keyboards" : "keyboard");
  t = t.replace(/\bdis\s+plays?\b/gi, (m) => m.endsWith('s') ? "displays" : "display");
  t = t.replace(/\bsys\s+tems?\b/gi, (m) => m.endsWith('s') ? "systems" : "system");

  // Multi-syllable chunk merger
  t = repairGenericSpacedSyllables(t);

  return t;
}

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

  // 2. First pass: repair OCR syllable fragment splits & character typos
  t = repairOcrSyllablesAndTypos(t);

  // 3. End-of-line hyphens across line breaks: "micro-\nprocessor" -> "microprocessor"
  t = t.replace(/([\p{L}\d]+)[\-\u2010\u2013]\s*[\r\n]+\s*([\p{L}\d]+)/gu, (_match, p1, p2) => {
    const tok = firstToken(p2);
    if (p2[0] === p2[0].toLowerCase() && !COMPOUND_NEXT.has(tok)) {
      return `${p1}${p2}`;
    }
    if (p1 === p1.toUpperCase() && p2 === p2.toUpperCase() && p1.length > 1 && p2.length > 1) {
      return `${p1}${p2}`;
    }
    return `${p1}-${p2}`;
  });

  // 4. Inline hyphenated splits: "syn- thesis" -> "synthesis", "com- puter" -> "computer"
  t = dehyphenateInline(t);

  // 5. Space-hyphen-space splits: "micro - processor" -> "microprocessor"
  t = t.replace(/([\p{L}\d]{2,})\s+[\-\u2010\u2013]\s+([a-zà-öø-ÿäöå][\p{L}\d]*)/gu, (_match, p1, p2) => {
    const tok = firstToken(p2);
    if (COMPOUND_NEXT.has(tok)) {
      return `${p1}-${p2}`;
    }
    return `${p1}${p2}`;
  });

  // 6. Common prefixes detached by OCR spacing: "micro processor" -> "microprocessor"
  t = t.replace(COMMON_PREFIXES_REGEX, (_match, p1, p2) => {
    return `${p1}${p2}`;
  });

  // 7. Common suffixes detached by OCR spacing: "comput ing" -> "computing"
  t = t.replace(COMMON_SUFFIXES_REGEX, (_match, p1, p2) => {
    return `${p1}${p2}`;
  });

  // 8. Frequent technical broken words
  for (const [pat, repl] of COMMON_SPLIT_WORDS) {
    t = t.replace(pat, repl);
  }

  // 9. Broken single-letter syllables: "speec h" -> "speech", "t he" -> "the"
  t = t.replace(BROKEN_INITIAL_LETTER, "$1$2");
  t = t.replace(BROKEN_TERMINAL_LETTER, "$1$2");
  t = t.replace(BROKEN_ER_SUFFIX, "$1$2");
  t = t.replace(BROKEN_T_SUFFIX, "$1$2");

  // 10. Fix spaced-out letters from wide OCR character tracking (e.g. "s h e l i e d" -> "shelied", "d a t a" -> "data")
  t = reassembleSpacedLetters(t);

  // 11. Final pass pass to catch any lingering syllable splits after letter reassembly
  t = repairOcrSyllablesAndTypos(t);

  return t;
}

/**
 * Reassembles spaced-out individual letters caused by OCR scanner tracking or loose kerning.
 * e.g. "d a t a b a s e" -> "database", "s y n t h e s i s" -> "synthesis", "p r o c e s s o r" -> "processor"
 */
export function reassembleSpacedLetters(text: string): string {
  if (!text) return "";
  // Find sequences of 3 or more single letters separated by single spaces: "d a t a", "s y s t e m", "c i r c u i t"
  let out = text.replace(/(?:^|\s)((?:[a-zA-Z]\s+){2,}[a-zA-Z])(?=\s|[.,;:!?]|$)/g, (match, letterRun) => {
    const joined = letterRun.replace(/\s+/g, "");
    // If length is at least 3 letters, join it into a proper word
    if (joined.length >= 3) {
      return match.startsWith(" ") ? ` ${joined}` : joined;
    }
    return match;
  });

  return out;
}

/**
 * Comprehensive OCR Garbage, Junk Words, Symbol, and Table Pipe Cleaner.
 * Cleans messy OCR scans containing table border pipes (|), stray braces ({, }), backslashes (\),
 * tildes (~), math noise (=, +), advertisement callouts, publication boilerplate, and scanner speckles.
 */
export function cleanOcrGarbageAndNoise(text: string): string {
  if (!text) return "";
  let t = text;

  // 1. Remove table border rules and box drawing
  t = t.replace(/[\u2500-\u257F\u2580-\u259F]/g, " ");

  // 2. Strip table column pipes and standalone delimiters: " | Word | " -> " Word "
  t = t.replace(/^\s*\|\s*/gm, "");
  t = t.replace(/\s*\|\s*$/gm, "");
  t = t.replace(/\s*\|\s*/g, " ");

  // 3. Remove OCR scanner noise symbols: backslashes, braces, stray tildes, backticks, stray pound/currency symbols
  t = t.replace(/[{}\[\]\\~`^@£$§°%+=_<>#*]/g, " ");

  // 4. Clean isolated symbol runs: e.g. "---", "===", "...", "~~~", "***"
  t = t.replace(/(?:^|\s)[|+\-=_~#*•·—–^\\/]{2,}(?:\s|$)/g, " ");

  // 5. Filter advertisement callouts, order form coupons, and magazine publication boilerplate lines
  t = filterJunkPhrasesAndBoilerplate(t);

  // 6. Reassemble spaced-out OCR letters ("d a t a" -> "data")
  t = reassembleSpacedLetters(t);

  // 7. Repair split words and dehyphenate
  t = repairSplitWordsAndDehyphenate(t);

  // 8. Clean word tokens line by line and drop OCR gibberish / single floating consonants
  const lines = t.split(/\r?\n/);
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isTableLineOrRule(trimmed)) continue;
    if (isJunkLineOrBoilerplate(trimmed)) continue;
    if (isHighGarbageText(trimmed)) continue;

    const words = trimmed.split(/\s+/);
    const validWords: string[] = [];

    for (const w of words) {
      const cleanW = cleanWordLevelSymbolRubbish(w);
      if (!cleanW) continue;
      // Skip pure single noise punctuation
      if (/^[~`^|\\/{}\[\]_+=$%*#@<>]$/.test(cleanW)) continue;
      // Skip OCR gibberish tokens (e.g. x7k9p, bcz, brftk, single floating consonants)
      if (isOcrGibberishToken(cleanW)) continue;
      validWords.push(cleanW);
    }

    if (validWords.length > 0) {
      const joinedLine = validWords.join(" ").replace(/\s{2,}/g, " ").trim();
      if (joinedLine && /[\p{L}\d]/u.test(joinedLine)) {
        cleanedLines.push(joinedLine);
      }
    }
  }

  return cleanedLines.join("\n\n");
}

/**
 * Filter out advertisement coupons, order forms, and magazine boilerplate lines.
 */
export function filterJunkPhrasesAndBoilerplate(text: string): string {
  if (!text) return "";
  let t = text;

  // Magazine Ad Callouts & Inquiry Cards
  t = t.replace(/\bCircle\s+\d{1,4}\s+on\s+(?:inquiry|reader|service)\s+(?:card|coupon)\b/gi, "");
  t = t.replace(/\b(?:send|mail)\s+(?:check|money\s+order|coupon|order)\s+to\b[^\n\r.]*/gi, "");
  t = t.replace(/\bpostage\s+paid\s+at\b[^\n\r.]*/gi, "");
  t = t.replace(/\b(?:write|call)\s+for\s+(?:free|our)\s+(?:catalog|brochure|info|details)\b[^\n\r.]*/gi, "");
  t = t.replace(/\b(?:order|get)\s+yours\s+(?:today|now)\b/gi, "");
  t = t.replace(/\b(?:satisfaction\s+guaranteed|money[\s-]back\s+guarantee)\b/gi, "");
  t = t.replace(/\b(?:dealer|distributor)\s+inquiries\s+invited\b/gi, "");
  t = t.replace(/\b(?:california|new\s+york|massachusetts|illinois)\s+residents\s+add\s+\d+%\s+tax\b/gi, "");
  t = t.replace(/\ballow\s+\d+\s+weeks\s+for\s+delivery\b/gi, "");
  t = t.replace(/\b(?:dept\.?\s*\w+|p\.?o\.?\s*box\s*\d+)\b/gi, "");

  // Page Continuations and Pagination Lines
  t = t.replace(/\b(?:continued\s+on\s+page|continued\s+from\s+page|see\s+page)\s+\d{1,4}\b/gi, "");

  // Form Blanks (NAME ________ ADDRESS ________)
  t = t.replace(/\b(?:NAME|ADDRESS|CITY|STATE|ZIP|PHONE|EMAIL)\s*_{2,}/gi, "");
  t = t.replace(/_{2,}/g, " ");

  return t;
}

/**
 * Check if a single line is an advertisement, order form, or publication copyright line.
 */
export function isJunkLineOrBoilerplate(line: string): boolean {
  if (!line) return false;
  const l = line.trim();
  if (l.length < 3) return false;

  // Copyright / All Rights Reserved / Published Monthly
  if (/\b(?:copyright|©|\(c\))\s+(?:\d{4}|19\d\d|20\d\d)/i.test(l)) return true;
  if (/\ball\s+rights\s+reserved\b/i.test(l)) return true;
  if (/\bprinted\s+in\s+u\.?s\.?a\.?\b/i.test(l)) return true;
  if (/\bpublished\s+monthly\s+by\b/i.test(l)) return true;
  if (/\b(?:second\s+class\s+postage\s+paid)\b/i.test(l)) return true;
  if (/\b(?:subscription\s+rates?|single\s+copy\s+price)\b/i.test(l)) return true;

  // Circle XX on inquiry card
  if (/\bCircle\s+\d{1,4}\s+on\s+(?:inquiry|reader)\s+card\b/i.test(l)) return true;

  return false;
}

const VALID_TWO_LETTER_TOKENS = new Set([
  "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi", "if", "in", "is", "it",
  "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "re", "ex", "ox",
  "ok", "fi", "se", "id", "tv", "pc", "db", "io", "ai", "ui", "os", "ip", "vr", "ar",
  "st", "nd", "rd", "th"
]);

/**
 * Detect OCR garbage tokens like "x7k9p", "a8f9d0", "brftk", "xqwz", "rkdedpiHN", or single floating consonants.
 */
export function isOcrGibberishToken(token: string): boolean {
  if (!token) return false;
  const raw = token.trim();
  if (!raw) return false;

  const t = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
  if (!t) return false;

  // Preserve valid standard numbers and known short words
  if (/^\d+(?:\.\d+)?$/.test(t)) return false; // Pure numbers
  if (/^(?:[aI]|a\.m\.|p\.m\.|e\.g\.|i\.e\.|vs|ft|in|cm|mm|kg|ms|ns|v|w|a|k|m|g|c|p|d|x|y|z)$/i.test(t)) return false;

  // 1. Single isolated consonants standing alone
  if (/^[bcdfghjklmnpqrstvwxyz]$/i.test(t)) {
    return true;
  }

  // 2. Non-word 2-letter fragments (e.g. "ra", "pl", "di", "ea", "Cy", "da", "pr", "Ek", "sh", "Lo", "PAH", "AE")
  if (t.length === 2 && /^[a-z]{2}$/i.test(t) && !VALID_TWO_LETTER_TOKENS.has(t.toLowerCase())) {
    return true;
  }

  // 3. Mixed case OCR artifacts (e.g. "rkdedpiHN", "PESeealk", "aBcdEF", "pIe")
  if (t.length >= 4 && /[a-z]{2,}[A-Z]{2,}|[A-Z]{2,}[a-z]{2,}[A-Z]/.test(t)) {
    return true;
  }

  // 4. Random mixed digits and letters mid-word (e.g. x7k9p, 1a2b3c, a8f9d0)
  if (/\d/.test(t) && /[a-z]/i.test(t)) {
    if (/^(?:\d+[KkMbGg]|\d+th|\d+st|\d+nd|\d+rd|z80|8080|6800|6502|8086|8088|rs232|v\d+[\.\d]*|\d+[ad]c|\d+hz|\d+mhz|\d+kb|\d+mb|\d+bit|mpu\d*|\d+d)$/i.test(t)) {
      return false;
    }
    if (/[a-z]\d[a-z]|\d[a-z]\d[a-z]/i.test(t)) {
      return true;
    }
  }

  // 5. Unpronounceable long consonant clusters (4+ consonants without vowels or 'y')
  if (t.length >= 3 && !/[aeiouy]/i.test(t) && /^[bcdfghjklmnpqrstvwxz]+$/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Detects if a line or paragraph of text is severe OCR garbage/rubbish.
 */
export function isHighGarbageText(text: string): boolean {
  if (!text || !text.trim()) return false;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;

  let garbageTokens = 0;
  for (const tok of tokens) {
    if (isOcrGibberishToken(tok)) {
      garbageTokens++;
    }
  }

  const garbageRatio = garbageTokens / tokens.length;
  return garbageRatio >= 0.28 || (tokens.length >= 5 && garbageTokens >= 3);
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

/**
 * Common table/box border characters, ASCII art lines, and pseudo-table rules.
 */
const TABLE_LINE_PATTERNS: RegExp[] = [
  // Box-drawing characters (single, double, rounded, heavy, dotted): ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ │ ─ ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬ ╭ ╮ ╯ ╰
  /^[\s\u2500-\u257F\u2580-\u259F|+\-=_~#*•·—–:;.,\\/]{3,}$/u,
  // Markdown / ASCII table dividers: |---|---| or +---+---+ or :---:|
  /^[\s|:+*\-=_~#•]{3,}$/,
  // Repetitive underline / dash / dot runs: e.g. "--------------------", "...................", "==================="
  /^[\s\-_=.·•*~^#\/\\|]{3,}$/,
  // Dot leader lines commonly used in indexes/tables of contents: "Introduction ......... 5" or ".........."
  /^[.\s·•…_-]{4,}$/,
  // OCR table column grid cells containing only punctuation or 1 isolated non-word symbol: e.g. "| + | - |" or "| | |"
  /^[\s|:+*\-=_~#•\\]*$/,
];

/**
 * Check if a line/chunk of text is a text-style table divider line, border rule, or ASCII grid.
 */
export function isTableLineOrRule(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Check against table line patterns
  for (const pat of TABLE_LINE_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }

  // Check character composition: if line has >= 3 chars and contains ZERO letters or digits, and is composed of table symbols
  const hasAlphanumeric = /[\p{L}\d]/u.test(trimmed);
  if (!hasAlphanumeric && trimmed.length >= 2) {
    // If it's purely symbols like "| | + - * = # _ ~", it's a table line/symbol rule
    return true;
  }

  // Repetitive symbol sequences with very few letters: e.g. "|--------- Chapter 1 ---------|" or "+=====+=====+"
  const symbolCount = (trimmed.match(/[\u2500-\u257F|+\-=_~#*•·—–:;\\/]/g) || []).length;
  if (symbolCount >= 8 && symbolCount / trimmed.length > 0.65) {
    return true;
  }

  return false;
}

/**
 * Clean word-level symbol rubbish and OCR noise from a single word/token.
 * Handles:
 * - Scatted stray punctuation and OCR scanner specks: ".,:~^`"
 * - Weird mid-word OCR character garbage: "w*o*r*d", "s.y.s.t.e.m" (unless acronym)
 * - Bracketed empty symbols: "[ ]", "( )", "< >", "{ }"
 * - Currency/bullet symbol duplication: "$$$", "•••", "###"
 * - Leading/trailing stray non-word punctuation: "~word~", "#word#", "@word@"
 */
export function cleanWordLevelSymbolRubbish(word: string): string {
  if (!word) return "";
  let w = word.trim();
  if (!w) return "";

  // 1. Box drawing and block characters: ┌─┐│└─┘█▓▒░ etc.
  w = w.replace(/[\u2500-\u257F\u2580-\u259F]/g, "");

  // 2. Decorative bullets, geometric shapes, wingdings, dingbats
  w = w.replace(/[\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF]/g, "");

  // 3. Isolated or repeated symbol runs: e.g. "===", "---", "###", "***", "~~~", "|||", "<<<", ">>>"
  w = w.replace(/^[|+\-=_~#*•·—–^\\/]{2,}$/g, "");
  if (!w) return "";

  // 4. Dot leader runs inside word tokens: "Chapter......" -> "Chapter"
  w = w.replace(/[.\u00B7\u2022_]{3,}/g, " ");

  // 5. Empty brackets/boxes: "[ ]", "()", "{}", "<>", "[x]", "[X]", "[*]", "(•)"
  w = w.replace(/\[\s*[xX*•\-_\s]?\s*\]/g, "");
  w = w.replace(/\(\s*[xX*•\-_\s]?\s*\)/g, "");
  w = w.replace(/\{\s*[xX*•\-_\s]?\s*\}/g, "");
  w = w.replace(/<\s*[xX*•\-_\s]?\s*>/g, "");

  // 6. Strip leading/trailing stray non-alphanumeric noise symbols except valid punctuation quotes/periods/commas
  // e.g. "~hello~" -> "hello", "#synthesis#" -> "synthesis", "•word" -> "word", "|data|" -> "data"
  w = w.replace(/^[|~#*•·^/\\=_+`§°©®™%[\]{}<>]*(.*?)[|~#*•·^/\\=_+`§°©®™%[\]{}<>]*$/u, "$1");

  // 7. Repeated internal symbols: e.g. "com***puter" -> "computer", "data///base" -> "database"
  w = w.replace(/([\p{L}\d])[|*~#^\\=_+/]{2,}([\p{L}\d])/gu, "$1 $2");

  // 8. OCR scanner specks/glitches inside words (e.g. single stray pipe or tilde between letters): "syn|thesis" -> "synthesis"
  w = w.replace(/([\p{L}])([|~^\\_])([\p{L}])/gu, "$1$3");

  // 9. If after stripping it's just pure punctuation without letters or digits (e.g. "@", "~", "#", "$$"), discard
  if (!/[\p{L}\d]/u.test(w)) {
    // Keep standard single punctuation like comma, dot, question, exclamation for sentence prosody if isolated
    if (/^[.,;:!?…]$/.test(w)) {
      return w;
    }
    return "";
  }

  return w.trim();
}

/**
 * Thoroughly clean an entire text paragraph/sentence of table symbols and word-level noise.
 */
export function removeTableLinesAndSymbolRubbish(text: string): string {
  if (!text) return "";

  // Process line by line if text contains line breaks
  const lines = text.split(/[\r\n]+/);
  const cleanLines: string[] = [];

  for (const line of lines) {
    // Skip entire line if it is a table line / border rule
    if (isTableLineOrRule(line)) {
      continue;
    }

    let l = line;

    // Remove embedded ASCII table borders: e.g. "| Column 1 | Column 2 |" -> "Column 1 Column 2"
    l = l.replace(/^\s*\|\s*/, " ").replace(/\s*\|\s*$/, " ");
    l = l.replace(/\s*\|\s*/g, " | ");

    // Remove box-drawing characters
    l = l.replace(/[\u2500-\u257F\u2580-\u259F]/g, " ");

    // Remove dot leaders: e.g. "Section A .................... 45" -> "Section A 45"
    l = l.replace(/[.\u00B7\u2022_]{3,}/g, " ");

    // Split into words and clean word-level symbol rubbish
    const words = l.split(/\s+/);
    const cleanedWords: string[] = [];

    for (const word of words) {
      const cleanedWord = cleanWordLevelSymbolRubbish(word);
      if (cleanedWord) {
        cleanedWords.push(cleanedWord);
      }
    }

    const processedLine = cleanedWords.join(" ").trim();
    if (processedLine) {
      cleanLines.push(processedLine);
    }
  }

  return cleanLines.join("\n");
}

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
  if (!t) return true;
  if (isTableLineOrRule(t)) return true;
  if (t.length < 8) {
    // If short and contains no letters or digits, it's garbage
    return !/[\p{L}\d]/u.test(t);
  }
  if (LONG_DASH_RUN.test(t)) return true;

  const tokens = t.split(/\s+/);
  if (!tokens.length) return true;

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

  // 1. If line is entirely a table rule or ASCII divider, strip to empty
  if (isTableLineOrRule(t)) {
    return "";
  }

  // 2. Remove table dividers, dot leaders, and word-level symbol rubbish
  t = removeTableLinesAndSymbolRubbish(t);
  if (!t.trim() || !/[\p{L}\d]/u.test(t)) {
    return "";
  }

  // 3. Split-word repair and dehyphenation
  t = repairSplitWordsAndDehyphenate(t);

  // 4. Expand fill-in-the-blank forms
  t = expandFormBlanks(t);

  // 5. Accounting signs and symbols
  t = normalizeAccountingSigns(t);

  // 6. Expand contractions and abbreviations for natural speech
  t = expandContractions(t);
  t = expandAbbreviations(t);

  // 7. Sanitize possessives, quotes, and punctuation
  t = sanitizeForSpeech(t);

  // 8. Final word-level cleanup pass for remaining isolated noise symbols
  const finalTokens = t.split(/\s+/).map(w => cleanWordLevelSymbolRubbish(w)).filter(Boolean);
  const out = finalTokens.join(" ").replace(/[ \t]{2,}/g, " ").trim();

  // If result has no pronounceable words/letters/digits, skip speech
  if (!/[\p{L}\d]/u.test(out)) {
    return "";
  }

  return out;
}
