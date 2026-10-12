import { describe, expect, it } from 'vitest';
import {
  asOffered,
  forbiddenBy,
  getTranslationInfo,
  OFFERED_CODES,
  TRANSLATIONS,
  translationGlossary,
} from '@/services/bible/translationCatalog';

/**
 * Which translations the app may offer, what it must print under them, and
 * what each licence lets the app do with the text. All three are licence terms
 * rather than design choices, which is what earns them a test: a translation
 * offered without a licence, a rights holder's notice "tidied" into different
 * words, or a restriction dropped from the catalog, fails nothing else.
 */

/** Exactly as the Genfer Bibelgesellschaft supplied it. */
const SCHLACHTER_2000_NOTICE = [
  [
    'Bibeltext der Schlachter',
    'Copyright © 2000 Genfer Bibelgesellschaft',
    'Wiedergegeben mit freundlicher Genehmigung. Alle Rechte vorbehalten.',
    'https://www.bibelgesellschaft.com/de',
  ],
  ['Die offizielle Hörbibel ist beim CLV Verlag erhältlich', 'https://clv.de/hoerbibel'],
];

/** No licence (the first three), or not yet known whether one is needed (Schlachter 1951). */
const HIDDEN = ['ESV', 'NKJV', 'HFA', 'S51'] as const;

describe('which translations are offered', () => {
  it('offers none of the translations it is not cleared to offer', () => {
    for (const code of HIDDEN) {
      expect(OFFERED_CODES, code).not.toContain(code);
      expect(asOffered(code), code).toBeUndefined();
    }
  });

  it('never names one in the key the model is given', () => {
    for (const code of HIDDEN) {
      expect(translationGlossary(), code).not.toMatch(new RegExp(`\\b${code}\\b`));
    }
  });

  it('accepts an offered code and nothing that is not a string', () => {
    expect(asOffered('S00')).toBe('S00');
    expect(asOffered(undefined)).toBeUndefined();
    expect(asOffered(42)).toBeUndefined();
  });
});

describe('copyright notices', () => {
  it('gives every translation one, hidden or not — content may still name a hidden one', () => {
    for (const t of TRANSLATIONS) {
      expect(t.notice.flat().join('').trim(), t.code).not.toBe('');
    }
  });

  it('prints the Schlachter 2000 notice word for word as its rights holder wrote it', () => {
    expect(getTranslationInfo('S00').notice).toEqual(SCHLACHTER_2000_NOTICE);
  });
});

describe('what each licence permits', () => {
  /** Ours for Schlachter 2000 rules out both; nothing else is restricted. */
  it('rules out endless scroll and continuous play for Schlachter 2000, and only there', () => {
    for (const t of TRANSLATIONS) {
      const allowed = t.code !== 'S00';
      expect(t.features, t.code).toEqual({ endlessScroll: allowed, continuousPlay: allowed });
    }
  });

  it('names the first text in play that rules a feature out', () => {
    expect(forbiddenBy(['KJV', 'LUT'], 'endlessScroll')).toBeUndefined();
    expect(forbiddenBy(['KJV', 'S00'], 'continuousPlay')?.name).toBe('Schlachter 2000');
    expect(forbiddenBy([], 'continuousPlay')).toBeUndefined();
  });
});
