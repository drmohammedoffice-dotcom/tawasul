/**
 * Advanced anti-evasion normalization for safety matching.
 * Original text is never mutated in storage — callers keep the raw for evidence.
 */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060\u180E]/g;
const TATWEEL = /\u0640/g;

/** Franco-Arab / Arabizi digit → approximate Arabic letter (safety matching only). */
const FRANCO: Record<string, string> = {
  '2': 'ء',
  '3': 'ع',
  '5': 'خ',
  '6': 'ط',
  '7': 'ح',
  '8': 'ق',
  '9': 'ص'
};

const ARABIC_ALEF = /[أإآٱ]/g;
const ARABIC_YEH = /[ىي]/g;
const ARABIC_TEH = /[ةه]/g;

const LEET_LATIN: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's'
};

export type NormalizedBundle = {
  original: string;
  normalized: string;
  /** Extra latinized form for arabizi phrases */
  arabiziFold: string;
};

export function normalizeForSafetyAdvanced(input: string): NormalizedBundle {
  const original = input || '';
  let s = original.normalize('NFKC').toLowerCase();
  s = s.replace(ZERO_WIDTH, '');
  s = s.replace(TATWEEL, '');
  s = s.replace(/[\u064B-\u065F\u0670]/g, '');
  s = s.replace(ARABIC_ALEF, 'ا');
  s = s.replace(ARABIC_YEH, 'ي');
  s = s.replace(ARABIC_TEH, 'ه');
  // Hidden spaces / punctuation used to break keywords
  s = s.replace(/[_\-.·•*|\\/]+/g, ' ');
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  // Digits inserted inside Arabic words (اقت1لك → اقتلك) without changing standalone numbers
  s = s.replace(/(?<=[\u0600-\u06FF])[0-9٠-٩]+(?=[\u0600-\u06FF])/g, '');
  s = [...s].map((ch) => LEET_LATIN[ch] || ch).join('');
  s = s.replace(/\s+/g, ' ').trim();

  // Arabizi fold: map digits commonly used in Iraqi/Levant chat into Arabic letters then strip latin
  let arabizi = original.normalize('NFKC').toLowerCase();
  arabizi = arabizi.replace(ZERO_WIDTH, '').replace(TATWEEL, '');
  arabizi = [...arabizi]
    .map((ch) => FRANCO[ch] || LEET_LATIN[ch] || ch)
    .join('');
  arabizi = arabizi.replace(ARABIC_ALEF, 'ا').replace(ARABIC_YEH, 'ي').replace(ARABIC_TEH, 'ه');
  arabizi = arabizi.replace(/\s+/g, ' ').trim();

  return { original, normalized: s, arabiziFold: arabizi };
}
