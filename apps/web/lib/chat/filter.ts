import { STARTER_WORDS } from './words';

export { STARTER_WORDS };

/** What a bad word becomes. */
export const MASK = '●●●';

/** A word as people type it: letters (with Bangla vowel signs), digits and the look-alike symbols @ and $. */
const TOKEN = /[\p{L}\p{M}\p{N}@$]+/gu;

const LOOK_ALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Lower-cased, look-alike symbols mapped to the letters they stand for ("$H1T" → "shit"). */
export function normalizeWord(word: string): string {
  return [...word.normalize('NFC').toLowerCase()].map((c) => LOOK_ALIKES[c] ?? c).join('');
}

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One entry → a pattern per word, each letter allowed to repeat ("shit" matches "shiiit"; "ass" never matches "as"). */
function compile(entry: string): RegExp[] {
  return normalizeWord(entry)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => new RegExp(`^${[...word].map((c) => `${escape(c)}+`).join('')}$`, 'u'));
}

/**
 * The text with every bad word (the starter list plus the venue's `extraWords`) replaced by `●●●`. Whole words
 * only, ignoring capitals, stretched letters and look-alike symbols; a phrase matches consecutive words and is
 * masked as one span. Everything else (spacing, punctuation, other words) is kept as typed.
 */
export function maskBadWords(text: string, extraWords: readonly string[] = []): string {
  const entries = [...STARTER_WORDS, ...extraWords].map(compile).filter((words) => words.length > 0);
  const tokens = [...text.matchAll(TOKEN)].map((m) => ({ start: m.index, end: m.index + m[0].length, word: normalizeWord(m[0]) }));

  const spans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < tokens.length; ) {
    let longest = 0;
    for (const words of entries) {
      if (words.length <= longest || i + words.length > tokens.length) continue;
      if (words.every((pattern, j) => pattern.test(tokens[i + j]!.word))) longest = words.length;
    }
    if (longest > 0) {
      spans.push({ start: tokens[i]!.start, end: tokens[i + longest - 1]!.end });
      i += longest;
    } else {
      i += 1;
    }
  }

  let out = '';
  let at = 0;
  for (const span of spans) {
    out += text.slice(at, span.start) + MASK;
    at = span.end;
  }
  return out + text.slice(at);
}
